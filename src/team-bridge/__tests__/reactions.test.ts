/**
 * Team Bridge reactions (spec "Mobile Team Bridge: reactions and
 * start-a-thread", slice PR b): the pure model ported from the desktop, the
 * wire (contract + client), and the store's toggle — optimistic rows, the one
 * in-flight write per message, exact rollback, the poll-vs-pending guard and
 * the "hub without the route" switch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createHubClient,
	type HubClient,
	HubError,
} from "@/team-bridge/client";
import { messageSchema, type Reaction } from "@/team-bridge/contract";
import {
	clearTeamBridgeEmoji,
	teamBridgeFrequentEmoji,
} from "@/team-bridge/emoji-usage";
import {
	firstEmoji,
	frequentEmoji,
	isSingleEmoji,
	QUICK_EMOJI,
	reactionAdds,
	recordEmojiUsage,
	toggleReaction,
} from "@/team-bridge/reactions";
import { replyThreadKey } from "@/team-bridge/reply-threads";
import {
	createTeamBridgeStore,
	reactionKey,
	type ThreadData,
	threadKey,
} from "@/team-bridge/store";
import { message, SELF, status, TENANT } from "./fixtures";

const THUMBS = "👍";
const PARTY = "🎉";
const r = (
	emoji: string,
	count: number,
	mine = false,
	labels: string[] = [],
): Reaction => ({ emoji, count, reacted_by_me: mine, sample_labels: labels });

describe("toggleReaction (the desktop's projection, ported)", () => {
	it("absent → appended as mine with count 1", () => {
		expect(toggleReaction([r(THUMBS, 2)], PARTY)).toEqual([
			r(THUMBS, 2),
			r(PARTY, 1, true),
		]);
	});
	it("another's → +1 and mine; mine → -1 and not mine", () => {
		const up = toggleReaction([r(THUMBS, 2, false, ["Ada"])], THUMBS);
		expect(up).toEqual([r(THUMBS, 3, true, ["Ada"])]);
		expect(toggleReaction(up, THUMBS)).toEqual([r(THUMBS, 2, false, ["Ada"])]);
	});
	it("my sole reaction → the pill is removed", () => {
		expect(toggleReaction([r(PARTY, 1, true), r(THUMBS, 1)], PARTY)).toEqual([
			r(THUMBS, 1),
		]);
	});
	it("reactionAdds: PUT unless the emoji is already mine", () => {
		expect(reactionAdds([r(THUMBS, 1)], THUMBS)).toBe(true);
		expect(reactionAdds([r(THUMBS, 1, true)], THUMBS)).toBe(false);
		expect(reactionAdds([], PARTY)).toBe(true);
	});
});

describe("frequent emoji (decayed usage, per account)", () => {
	const DAY = 86_400_000;
	it("with no usage, the quick set in the desktop's order", () => {
		expect(frequentEmoji({}, 0)).toEqual([...QUICK_EMOJI]);
	});
	it("ranks used emoji first and tops up from the quick set, eight in all", () => {
		let usage = recordEmojiUsage({}, "🦄", 0);
		usage = recordEmojiUsage(usage, "🦄", 0);
		usage = recordEmojiUsage(usage, "🔥", 0);
		const list = frequentEmoji(usage, 0);
		expect(list.slice(0, 2)).toEqual(["🦄", "🔥"]);
		expect(list).toHaveLength(8);
		expect(new Set(list).size).toBe(8);
	});
	it("halves a score every 30 days, so recent use beats old habit", () => {
		let usage = recordEmojiUsage({}, "🦄", 0);
		usage = recordEmojiUsage(usage, "🦄", 0); // score 2 at t=0
		usage = recordEmojiUsage(usage, "🐙", 61 * DAY); // score 1 at 61 d
		// 🦄 decays to 2 × 2^(-61/30) ≈ 0.49 < 1.
		expect(frequentEmoji(usage, 61 * DAY)[0]).toBe("🐙");
	});
});

describe("isSingleEmoji / firstEmoji (the keyboard picker's filter)", () => {
	it.each([
		["👍", true],
		["👍🏽", true],
		["❤️", true],
		["👨‍👩‍👧", true],
		["1️⃣", true],
		["🇫🇷", true],
		["a", false],
		["1", false],
		["#", false],
		["👍👍", false],
		["", false],
	])("%s → %s", (value, expected) => {
		expect(isSingleEmoji(value)).toBe(expected);
	});
	it("takes the first emoji grapheme and ignores letters around it", () => {
		expect(firstEmoji("ab🎉c")).toBe("🎉");
		expect(firstEmoji("hello")).toBeNull();
	});
});

describe("contract: reactions on a message", () => {
	const base = message(1, SELF, "2026-11-19T09:00:00Z");
	it("absent on an older hub: the message parses with no reactions", () => {
		expect(messageSchema.parse(base).reactions).toBeUndefined();
	});
	it("a malformed list costs the pills, never the message", () => {
		const parsed = messageSchema.parse({ ...base, reactions: "nope" });
		expect(parsed.id).toBe(base.id);
		expect(parsed.reactions).toBeUndefined();
	});
	it("trims to the desktop's bounds (≤ 50 rows, ≤ 3 labels) rather than failing", () => {
		const rows = Array.from({ length: 60 }, (_, i) => ({
			emoji: String.fromCodePoint(0x1f600 + i),
			count: 1,
			reacted_by_me: false,
			sample_labels: ["a", "b", "c", "d"],
		}));
		const parsed = messageSchema.parse({ ...base, reactions: rows });
		expect(parsed.reactions).toHaveLength(50);
		expect(parsed.reactions?.[0]?.sample_labels).toEqual(["a", "b", "c"]);
	});
});

describe("client.react: the wire (spec §2.1)", () => {
	const answer = {
		msg: "ok",
		result: { message_id: "bcm_1", reactions: [r(THUMBS, 1, true)] },
	};
	const rig = () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const client = createHubClient({
			accessToken: async () => "token-a",
			baseUrl: "https://hub.example/",
			fetchImpl: (async (url: string, init: RequestInit) => {
				calls.push({ url: String(url), init });
				return new Response(JSON.stringify(answer), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}) as unknown as typeof fetch,
		});
		return { client, calls };
	};
	it("add: PUT with tenant_id in the body, the emoji percent-encoded", async () => {
		const { client, calls } = rig();
		const out = await client.react(TENANT, "bcv_1", "bcm_1", THUMBS, true);
		expect(out.reactions).toEqual([r(THUMBS, 1, true)]);
		expect(calls[0]?.init.method).toBe("PUT");
		expect(calls[0]?.url).toContain(
			`/conversations/bcv_1/messages/bcm_1/reactions/${encodeURIComponent(THUMBS)}`,
		);
		const body = JSON.parse(String(calls[0]?.init.body));
		expect(body).toEqual({ tenant_id: TENANT });
		// The human plane never carries the agent identity or the daemon receipt.
		expect(body).not.toHaveProperty("actor_endpoint_id");
		expect(body).not.toHaveProperty("expected_account_id");
	});
	it("remove: DELETE with tenant_id in the QUERY and no body", async () => {
		const { client, calls } = rig();
		await client.react(TENANT, "bcv_1", "bcm_1", THUMBS, false);
		expect(calls[0]?.init.method).toBe("DELETE");
		expect(new URL(calls[0]?.url ?? "").searchParams.get("tenant_id")).toBe(
			TENANT,
		);
		expect(calls[0]?.init.body ?? null).toBeNull();
	});
	it("NFC-normalises the emoji, so one glyph typed two ways is one pill", async () => {
		const { client, calls } = rig();
		// "é" decomposed (e + U+0301) — any NFD input makes the point.
		await client.react(TENANT, "c", "m", "e\u0301", true);
		expect(calls[0]?.url).toContain(`/reactions/${encodeURIComponent("é")}`);
	});
});

/* ---- the store ------------------------------------------------------ */

const CONV = "bcv_channel_general";
const target = { tenantId: TENANT, conversationId: CONV, messageId: "bcm_1" };
const deferred = <T>() => {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

function rigStore(react: HubClient["react"]) {
	const hub = { react: vi.fn(react) } as unknown as HubClient;
	const bridge = createTeamBridgeStore({
		hub: () => hub,
		accessToken: async () => "t",
		now: () => 1_000,
	});
	const held = message(1, "acct_ada", "2026-11-19T09:00:00Z", {
		reactions: [r(THUMBS, 2, false, ["Ada", "Ben"])],
	});
	bridge.store.setState({
		selfAccountId: SELF,
		threads: {
			[threadKey(TENANT, CONV)]: {
				messages: [held],
				state: "ready",
				error: null,
				hasMore: false,
				loadingOlder: false,
				olderError: null,
			},
		},
	});
	const timelineRows = () =>
		bridge.store.getState().threads[threadKey(TENANT, CONV)]?.messages[0]
			?.reactions;
	const shown = () =>
		bridge.store.getState().reactionPending[reactionKey(target)]?.rows ??
		timelineRows();
	return { bridge, hub, held, timelineRows, shown };
}

afterEach(() => {
	clearTeamBridgeEmoji();
	vi.restoreAllMocks();
});

describe("store.toggleReaction (spec §4.8)", () => {
	it("shows the optimistic +1 at once, then the server's summary replaces it", async () => {
		const write = deferred<{ message_id: string; reactions: Reaction[] }>();
		const { bridge, hub, shown, timelineRows } = rigStore(() => write.promise);
		const outcome = bridge.actions.toggleReaction(target, THUMBS);
		expect(shown()).toEqual([r(THUMBS, 3, true, ["Ada", "Ben"])]);
		// The held message is untouched until the write settles.
		expect(timelineRows()).toEqual([r(THUMBS, 2, false, ["Ada", "Ben"])]);
		expect(hub.react).toHaveBeenCalledWith(TENANT, CONV, "bcm_1", THUMBS, true);
		const served = [r(THUMBS, 3, true, ["Sam", "Ada", "Ben"])];
		write.resolve({ message_id: "bcm_1", reactions: served });
		expect(await outcome).toBe("added");
		expect(timelineRows()).toEqual(served);
		expect(bridge.store.getState().reactionPending).toEqual({});
	});

	it("a confirmed ADD feeds the quick row for this account; a remove does not", async () => {
		const { bridge } = rigStore(async () => ({
			message_id: "bcm_1",
			reactions: [r("🦄", 1, true)],
		}));
		await bridge.actions.toggleReaction(target, "🦄");
		expect(teamBridgeFrequentEmoji(SELF, 1_000)[0]).toBe("🦄");
		expect(teamBridgeFrequentEmoji("someone_else", 1_000)[0]).toBe(
			QUICK_EMOJI[0],
		);
	});

	it("a refusal restores the EXACT prior rows and marks the message failed", async () => {
		const { bridge, held, shown } = rigStore(async () => {
			throw new HubError({ kind: "server", message: "boom", status: 500 });
		});
		const before = held.reactions;
		expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe("failed");
		expect(shown()).toBe(before);
		expect(bridge.store.getState().reactionFailed[reactionKey(target)]).toBe(
			true,
		);
		expect(bridge.store.getState().reactionsUnserved).toBe(false);
	});

	it("a failed add is not usage", async () => {
		const { bridge } = rigStore(async () => {
			throw new HubError({ kind: "server", message: "boom", status: 500 });
		});
		await bridge.actions.toggleReaction(target, "🦄");
		expect(teamBridgeFrequentEmoji(SELF, 1_000)[0]).toBe(QUICK_EMOJI[0]);
	});

	it("the next tap clears the error line and retries", async () => {
		let fail = true;
		const { bridge } = rigStore(async () => {
			if (fail) throw new HubError({ kind: "unreachable", message: "x" });
			return { message_id: "bcm_1", reactions: [r(THUMBS, 3, true)] };
		});
		await bridge.actions.toggleReaction(target, THUMBS);
		fail = false;
		expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe("added");
		expect(bridge.store.getState().reactionFailed).toEqual({});
	});

	it("one toggle in flight per message: a double tap sends ONE request", async () => {
		const write = deferred<{ message_id: string; reactions: Reaction[] }>();
		const { bridge, hub, shown } = rigStore(() => write.promise);
		const first = bridge.actions.toggleReaction(target, THUMBS);
		expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe("ignored");
		expect(await bridge.actions.toggleReaction(target, PARTY)).toBe("ignored");
		expect(hub.react).toHaveBeenCalledTimes(1);
		expect(shown()).toEqual([r(THUMBS, 3, true, ["Ada", "Ben"])]);
		write.resolve({ message_id: "bcm_1", reactions: [r(THUMBS, 3, true)] });
		await first;
	});

	it("a poll landing mid-write does not overwrite the optimistic rows; it shows after a refusal", async () => {
		const write = deferred<{ message_id: string; reactions: Reaction[] }>();
		const { bridge, held, shown } = rigStore(() => write.promise);
		const outcome = bridge.actions.toggleReaction(target, THUMBS);
		// The 20 s poll replaces the held message with a newer hub copy.
		const polled = { ...held, reactions: [r(THUMBS, 2), r("👀", 1)] };
		bridge.store.setState((s) => ({
			threads: {
				...s.threads,
				[threadKey(TENANT, CONV)]: {
					...(s.threads[threadKey(TENANT, CONV)] as ThreadData),
					messages: [polled],
				},
			},
		}));
		expect(shown()).toEqual([r(THUMBS, 3, true, ["Ada", "Ben"])]);
		write.reject(new HubError({ kind: "server", message: "x", status: 500 }));
		expect(await outcome).toBe("failed");
		// Applied after the write settled (spec step 5).
		expect(shown()).toEqual(polled.reactions);
	});

	it("patches every held copy: the timeline row and the reply thread's root", async () => {
		const { bridge, held, timelineRows } = rigStore(async () => ({
			message_id: "bcm_1",
			reactions: [r(PARTY, 1, true)],
		}));
		const rKey = replyThreadKey({
			tenantId: TENANT,
			conversationId: CONV,
			rootId: "bcm_1",
		});
		bridge.store.setState({
			replyThreads: {
				[rKey]: {
					root: held,
					replies: [message(2, SELF, "2026-11-19T09:01:00Z")],
					state: "ready",
					error: null,
					moreAfterSeq: null,
				},
			},
		});
		await bridge.actions.toggleReaction(target, PARTY);
		expect(timelineRows()).toEqual([r(PARTY, 1, true)]);
		expect(bridge.store.getState().replyThreads[rKey]?.root?.reactions).toEqual(
			[r(PARTY, 1, true)],
		);
	});

	it("reacts to a REPLY held only in its thread", async () => {
		const { bridge } = rigStore(async () => ({
			message_id: "bcm_2",
			reactions: [r(THUMBS, 1, true)],
		}));
		const rKey = replyThreadKey({
			tenantId: TENANT,
			conversationId: CONV,
			rootId: "bcm_1",
		});
		bridge.store.setState({
			replyThreads: {
				[rKey]: {
					root: null,
					replies: [message(2, SELF, "2026-11-19T09:01:00Z")],
					state: "ready",
					error: null,
					moreAfterSeq: null,
				},
			},
		});
		await bridge.actions.toggleReaction(
			{ ...target, messageId: "bcm_2" },
			THUMBS,
		);
		expect(
			bridge.store.getState().replyThreads[rKey]?.replies[0]?.reactions,
		).toEqual([r(THUMBS, 1, true)]);
	});

	it("an UNCODED 404 (old hub, no route) hides reactions for the session, no error", async () => {
		const { bridge, hub, held, shown } = rigStore(async () => {
			throw new HubError({ kind: "not_found", message: "x", status: 404 });
		});
		expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe(
			"unserved",
		);
		const s = bridge.store.getState();
		expect(s.reactionsUnserved).toBe(true);
		expect(s.reactionFailed).toEqual({});
		expect(shown()).toBe(held.reactions);
		// Every later tap is refused locally: nothing more reaches the hub.
		expect(await bridge.actions.toggleReaction(target, PARTY)).toBe("unserved");
		expect(hub.react).toHaveBeenCalledTimes(1);
	});

	it("an uncoded 405 counts as unserved too; a CODED 404 is an ordinary failure", async () => {
		const a = rigStore(async () => {
			throw new HubError({ kind: "server", message: "x", status: 405 });
		});
		expect(await a.bridge.actions.toggleReaction(target, THUMBS)).toBe(
			"unserved",
		);
		const b = rigStore(async () => {
			throw new HubError({
				kind: "not_found",
				message: "x",
				status: 404,
				code: "message_not_found",
			});
		});
		expect(await b.bridge.actions.toggleReaction(target, THUMBS)).toBe(
			"failed",
		);
		expect(b.bridge.store.getState().reactionsUnserved).toBe(false);
	});

	it("a sign-out mid-write drops the answer: nothing of the old account is written", async () => {
		const write = deferred<{ message_id: string; reactions: Reaction[] }>();
		const { bridge } = rigStore(() => write.promise);
		const outcome = bridge.actions.toggleReaction(target, THUMBS);
		bridge.actions.reset();
		write.resolve({ message_id: "bcm_1", reactions: [r(THUMBS, 9, true)] });
		expect(await outcome).toBe("ignored");
		const s = bridge.store.getState();
		expect(s.reactionPending).toEqual({});
		expect(s.threads).toEqual({});
		expect(teamBridgeFrequentEmoji(SELF, 1_000)[0]).toBe(QUICK_EMOJI[0]);
	});
});

describe("reaction remediation regressions", () => {
	it.each(["absent", "undefined"])(
		"preserves full emoji with Intl.Segmenter %s and rejects malformed clusters",
		async (mode) => {
			const original = Intl.Segmenter;
			try {
				if (mode === "absent") Reflect.deleteProperty(Intl, "Segmenter");
				else
					Object.defineProperty(Intl, "Segmenter", {
						value: undefined,
						configurable: true,
					});
				vi.resetModules();
				const fallback = await import("@/team-bridge/reactions");
				for (const emoji of [
					"👍🏽",
					"👩🏽‍💻",
					"🇻🇳",
					"1️⃣",
					"🏴\u{E0067}\u{E0062}\u{E007F}",
				]) {
					expect(fallback.firstEmoji(emoji)).toBe(emoji);
					expect(fallback.isSingleEmoji(emoji)).toBe(true);
				}
				for (const invalid of ["👍‍", "👍🏽🏽", "👍a", "🇻", "👍\u{E0067}"]) {
					expect(fallback.isSingleEmoji(invalid)).toBe(false);
				}
				expect(fallback.firstEmoji("👍‍")).toBeNull();
			} finally {
				Object.defineProperty(Intl, "Segmenter", {
					value: original,
					configurable: true,
				});
				vi.resetModules();
			}
		},
	);
	it("retires pending on a concurrent plan refusal, recovers through status, and protects the successor", async () => {
		const old = deferred<{ message_id: string; reactions: Reaction[] }>();
		const next = deferred<{ message_id: string; reactions: Reaction[] }>();
		const { bridge, hub } = rigStore(
			vi
				.fn()
				.mockReturnValueOnce(old.promise)
				.mockReturnValueOnce(next.promise),
		);
		hub.listMessages = vi
			.fn()
			.mockRejectedValue(
				new HubError({ kind: "plan", message: "Plan required" }),
			);
		hub.status = vi.fn().mockResolvedValue(status());
		const pending = bridge.actions.toggleReaction(target, THUMBS);
		await bridge.actions.loadThread(TENANT, CONV);
		expect(bridge.store.getState().reactionPending).toEqual({});
		expect(bridge.store.getState().gate).toBe("plan_required");
		expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe("ignored");
		await bridge.actions.checkStatus();
		expect(bridge.store.getState().gate).toBe("open");
		const successor = bridge.actions.toggleReaction(target, PARTY);
		old.resolve({
			message_id: target.messageId,
			reactions: [r(THUMBS, 9, true)],
		});
		expect(await pending).toBe("ignored");
		expect(
			bridge.store.getState().reactionPending[reactionKey(target)]?.emoji,
		).toBe(PARTY);
		next.resolve({
			message_id: target.messageId,
			reactions: [r(PARTY, 1, true)],
		});
		expect(await successor).toBe("added");
		expect(bridge.store.getState().reactionPending).toEqual({});
	});
	it("blocks another write and optimistic change for the server Retry-After", async () => {
		let now = 1000;
		const react = vi
			.fn()
			.mockRejectedValueOnce(
				new HubError({
					kind: "rate_limited",
					message: "Wait",
					status: 429,
					retryAfterMs: 20000,
				}),
			)
			.mockResolvedValue({ reactions: [] });
		const bridge = createTeamBridgeStore({
			hub: () => ({ react }) as unknown as HubClient,
			accessToken: async () => "synthetic",
			now: () => now,
		});
		expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe("failed");
		expect(
			await bridge.actions.toggleReaction(
				{ ...target, messageId: "other" },
				PARTY,
			),
		).toBe("ignored");
		expect(react).toHaveBeenCalledTimes(1);
		expect(bridge.store.getState().reactionPending).toEqual({});
		now += 20001;
		expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe("added");
	});
});

describe("reaction rate-limit transport and ownership", () => {
	it.each(["60", "Thu, 19 Nov 2026 00:01:00 GMT"])(
		"honours parsed Retry-After %s and resets account waits",
		async (header) => {
			let now = Date.parse("2026-11-19T00:00:00Z");
			vi.spyOn(Date, "now").mockImplementation(() => now);
			const fetchImpl = vi
				.fn()
				.mockResolvedValueOnce(
					new Response("{}", {
						status: 429,
						headers: { "Retry-After": header },
					}),
				)
				.mockImplementation(() =>
					Promise.resolve(
						new Response(
							JSON.stringify({
								result: { message_id: target.messageId, reactions: [] },
							}),
							{ status: 200 },
						),
					),
				);
			const hub = createHubClient({
				baseUrl: "https://synthetic.invalid",
				accessToken: async () => "synthetic",
				fetchImpl,
			});
			const bridge = createTeamBridgeStore({
				hub: () => hub,
				accessToken: async () => "synthetic",
				now: () => now,
			});
			expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe(
				"failed",
			);
			const snapshot = bridge.store.getState();
			now += 59999;
			expect(await bridge.actions.toggleReaction(target, PARTY)).toBe(
				"ignored",
			);
			expect(bridge.store.getState()).toBe(snapshot);
			expect(fetchImpl).toHaveBeenCalledTimes(1);
			now += 2;
			expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe("added");
			expect(fetchImpl).toHaveBeenCalledTimes(2);
			fetchImpl.mockResolvedValueOnce(
				new Response("{}", { status: 429, headers: { "Retry-After": "60" } }),
			);
			expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe(
				"failed",
			);
			bridge.actions.reset();
			expect(await bridge.actions.toggleReaction(target, THUMBS)).toBe("added");
			expect(fetchImpl).toHaveBeenCalledTimes(4);
		},
	);
	it("a success already in flight cannot erase a newer refusal", async () => {
		const old = deferred<{ message_id: string; reactions: Reaction[] }>();
		const react = vi
			.fn()
			.mockReturnValueOnce(old.promise)
			.mockRejectedValueOnce(
				new HubError({
					kind: "rate_limited",
					status: 429,
					message: "Wait",
					retryAfterMs: 60000,
				}),
			);
		const { bridge } = rigStore(react);
		const first = bridge.actions.toggleReaction(target, THUMBS);
		expect(
			await bridge.actions.toggleReaction(
				{ ...target, messageId: "other" },
				PARTY,
			),
		).toBe("failed");
		old.resolve({ message_id: target.messageId, reactions: [] });
		expect(await first).toBe("added");
		expect(await bridge.actions.toggleReaction(target, PARTY)).toBe("ignored");
		expect(react).toHaveBeenCalledTimes(2);
	});
});

describe("reaction snapshot fences on neighbouring history paths", () => {
	it.each(["root", "reply"])(
		"keeps confirmed %s reactions when a pre-write reply read settles late",
		async (kind) => {
			const { bridge, hub, held, timelineRows } = rigStore(
				async (_tenant, _conv, messageId, _emoji, active) => ({
					message_id: messageId,
					reactions: [r(THUMBS, active ? 3 : 2, active)],
				}),
			);
			const reply = message(2, SELF, "2026-11-19T09:01:00Z", {
				thread_root_id: held.id,
				reactions: [r(THUMBS, 2)],
			});
			const replyTarget = {
				tenantId: TENANT,
				conversationId: CONV,
				rootId: held.id,
			};
			const key = replyThreadKey(replyTarget);
			bridge.store.setState({
				replyThreads: {
					[key]: {
						root: held,
						replies: [reply],
						state: "ready",
						error: null,
						moreAfterSeq: null,
					},
				},
			});
			const page = { root: held, replies: [reply], has_more: false };
			const delayed = deferred<typeof page>();
			hub.listReplies = vi
				.fn()
				.mockReturnValueOnce(delayed.promise)
				.mockResolvedValue(page);
			const read = bridge.actions.loadReplyThread(replyTarget);
			const reactionTarget = {
				...target,
				messageId: kind === "root" ? held.id : reply.id,
			};
			expect(await bridge.actions.toggleReaction(reactionTarget, THUMBS)).toBe(
				"added",
			);
			delayed.resolve({
				...page,
				root: { ...held, body: "Fresh body from delayed history" },
			});
			await read;
			const shown = () =>
				kind === "root"
					? bridge.store.getState().replyThreads[key]?.root
					: bridge.store.getState().replyThreads[key]?.replies[0];
			expect(shown()?.reactions).toEqual([r(THUMBS, 3, true)]);
			expect(bridge.store.getState().replyThreads[key]?.root?.body).toBe(
				"Fresh body from delayed history",
			);
			if (kind === "root") expect(timelineRows()).toEqual([r(THUMBS, 3, true)]);
			expect(await bridge.actions.toggleReaction(reactionTarget, THUMBS)).toBe(
				"removed",
			);
			expect(vi.mocked(hub.react).mock.calls.map((call) => call[4])).toEqual([
				true,
				false,
			]);
			await bridge.actions.loadReplyThread(replyTarget);
			expect(shown()?.reactions?.[0]?.reacted_by_me).toBe(false);
		},
	);
	it("protects reactions, not message content, in a delayed older page", async () => {
		const { bridge, hub, held, timelineRows } = rigStore(async () => ({
			message_id: target.messageId,
			reactions: [r(THUMBS, 3, true)],
		}));
		const key = threadKey(TENANT, CONV);
		bridge.store.setState((s) => ({
			threads: {
				...s.threads,
				[key]: { ...(s.threads[key] as ThreadData), hasMore: true },
			},
		}));
		const page = deferred<{ messages: (typeof held)[]; has_more: boolean }>();
		hub.listMessages = vi.fn().mockReturnValue(page.promise);
		const read = bridge.actions.loadOlder(TENANT, CONV);
		await bridge.actions.toggleReaction(target, THUMBS);
		page.resolve({
			messages: [{ ...held, body: "Updated body" }],
			has_more: false,
		});
		await read;
		expect(timelineRows()).toEqual([r(THUMBS, 3, true)]);
		expect(bridge.store.getState().threads[key]?.messages[0]?.body).toBe(
			"Updated body",
		);
	});
});
