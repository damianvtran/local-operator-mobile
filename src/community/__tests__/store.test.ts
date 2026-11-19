import { describe, expect, it, vi } from "vitest";
import {
	type CommunityClient,
	CommunityError,
	createCommunityClient,
} from "@/community/client";
import type { SubmissionOutcome } from "@/community/contract";
import { conversationKey, createCommunityStore } from "@/community/store";

/**
 * The store's flow rules: one idempotency key per attempt reused on Retry,
 * sender-only outcomes, best-effort Cancel, drafts in memory, and the events
 * loop's resync. The client is the real one with its methods stubbed, so a
 * method name drifting between the two is a type error here.
 */

const CID = "local-operator-community";
const CONV = "ch-general";
const KEY = conversationKey(CID, CONV);

function fakeClient(overrides: Partial<CommunityClient>): CommunityClient {
	return {
		...createCommunityClient({
			accessToken: async () => "t",
			fetchImpl: async () => {
				throw new Error("unexpected transport");
			},
		}),
		messages: async () => ({ items: [], next_cursor: null }),
		...overrides,
	};
}

function setup(overrides: Partial<CommunityClient>) {
	let n = 0;
	const keys: string[] = [];
	const client = fakeClient(overrides);
	const scope = createCommunityStore({
		client: () => client,
		now: () => 1_000,
		newKey: async () => {
			const key = `key-${++n}`.padEnd(16, "x");
			keys.push(key);
			return key;
		},
		sleep: async () => undefined,
	});
	return { ...scope, keys };
}

const published = (key: string): SubmissionOutcome => ({
	idempotency_key: key,
	state: "published",
	message_id: "m1",
});

describe("sending", () => {
	it("Retry after a dropped request reuses the attempt's key", async () => {
		const seen: string[] = [];
		const submit = vi
			.fn<CommunityClient["submit"]>()
			.mockImplementationOnce(async (input) => {
				seen.push(input.idempotencyKey);
				throw new CommunityError({ kind: "unreachable" });
			})
			.mockImplementationOnce(async (input) => {
				seen.push(input.idempotencyKey);
				return published(input.idempotencyKey);
			});
		const { store, actions, keys } = setup({ submit });
		actions.setDraft(CID, CONV, "hello");
		await actions.send(CID, CONV);
		expect(store.getState().attempts[KEY]?.state.kind).toBe("failed");
		expect(store.getState().drafts[KEY]).toBe("hello");
		await actions.retry(CID, CONV);
		expect(seen).toEqual([keys[0], keys[0]]);
		expect(keys).toHaveLength(1);
		expect(store.getState().attempts[KEY]).toBeUndefined();
		expect(store.getState().drafts[KEY]).toBe("");
	});

	it("a refusal is sender-only, keeps the draft, and a new send mints a new key", async () => {
		const seen: string[] = [];
		const submit = vi.fn<CommunityClient["submit"]>(async (input) => {
			seen.push(input.idempotencyKey);
			throw new CommunityError({
				kind: "refused",
				refusal: {
					status: "refused",
					category: "private_information",
					reference: "MOD-AAAA-BBBB",
				},
			});
		});
		const { store, actions } = setup({ submit });
		actions.setDraft(CID, CONV, "my phone is …");
		await actions.send(CID, CONV);
		expect(store.getState().attempts[KEY]?.state).toEqual({
			kind: "refused",
			category: "private_information",
			reference: "MOD-AAAA-BBBB",
		});
		expect(store.getState().threads[KEY]?.messages ?? []).toEqual([]);
		/* Same text again is NOT a retry of a final outcome: it is a new attempt. */
		await actions.send(CID, CONV);
		expect(new Set(seen).size).toBe(2);
	});

	it("a limit blocks Retry until its retry time, then reuses the key", async () => {
		let clock = 1_000;
		const seen: string[] = [];
		const submit = vi
			.fn<CommunityClient["submit"]>()
			.mockImplementationOnce(async (input) => {
				seen.push(input.idempotencyKey);
				throw new CommunityError({
					kind: "rate_limited",
					retryAfterMs: 10_000,
				});
			})
			.mockImplementation(async (input) => {
				seen.push(input.idempotencyKey);
				return published(input.idempotencyKey);
			});
		const scope = createCommunityStore({
			client: () => fakeClient({ submit }),
			now: () => clock,
			newKey: async () => "only-key-xxxxxxxxxx",
			sleep: async () => undefined,
		});
		scope.actions.setDraft(CID, CONV, "hi");
		await scope.actions.send(CID, CONV);
		expect(scope.store.getState().attempts[KEY]?.state).toEqual({
			kind: "limited",
			retryAt: 11_000,
		});
		await scope.actions.retry(CID, CONV);
		expect(seen).toHaveLength(1);
		clock = 11_000;
		await scope.actions.retry(CID, CONV);
		expect(seen).toEqual(["only-key-xxxxxxxxxx", "only-key-xxxxxxxxxx"]);
	});

	it("Cancel shows the server's answer: posted stays posted", async () => {
		let release: (outcome: SubmissionOutcome) => void = () => undefined;
		const submit = vi.fn<CommunityClient["submit"]>(
			(input) =>
				new Promise<SubmissionOutcome>((resolve, reject) => {
					release = resolve;
					input.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		const cancelSubmission = vi.fn<CommunityClient["cancelSubmission"]>(
			async (_cid, key) => published(key),
		);
		const { store, actions } = setup({ submit, cancelSubmission });
		actions.setDraft(CID, CONV, "hi");
		const sending = actions.send(CID, CONV);
		await vi.waitFor(() => expect(submit).toHaveBeenCalled());
		expect(store.getState().attempts[KEY]?.state.kind).toBe("checking");
		await actions.cancel(CID, CONV);
		release(published("unused"));
		await sending;
		expect(store.getState().attempts[KEY]).toBeUndefined();
		expect(store.getState().drafts[KEY]).toBe("");
	});

	it("Cancel before the key was claimed stops the upload and keeps the draft", async () => {
		const submit = vi.fn<CommunityClient["submit"]>(
			(input) =>
				new Promise<SubmissionOutcome>((_resolve, reject) => {
					input.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		const cancelSubmission = vi.fn<CommunityClient["cancelSubmission"]>(
			async () => {
				throw new CommunityError({ kind: "not_found" });
			},
		);
		const { store, actions } = setup({ submit, cancelSubmission });
		actions.setDraft(CID, CONV, "hi");
		const sending = actions.send(CID, CONV);
		await vi.waitFor(() => expect(submit).toHaveBeenCalled());
		await actions.cancel(CID, CONV);
		await sending;
		expect(store.getState().attempts[KEY]?.state.kind).toBe("cancelled");
		expect(store.getState().drafts[KEY]).toBe("hi");
	});

	it("a replay still checking is polled by key, never resubmitted", async () => {
		const submit = vi.fn<CommunityClient["submit"]>(async (input) => ({
			idempotency_key: input.idempotencyKey,
			state: "checking",
		}));
		const submission = vi
			.fn<CommunityClient["submission"]>()
			.mockResolvedValueOnce({ idempotency_key: "k", state: "checking" })
			.mockResolvedValueOnce(published("k"));
		const { store, actions } = setup({ submit, submission });
		actions.setDraft(CID, CONV, "hi");
		await actions.send(CID, CONV);
		expect(submit).toHaveBeenCalledTimes(1);
		expect(submission).toHaveBeenCalledTimes(2);
		expect(store.getState().attempts[KEY]).toBeUndefined();
	});

	it("an expired key is never replayed: Retry mints a new one", async () => {
		const seen: string[] = [];
		const submit = vi
			.fn<CommunityClient["submit"]>()
			.mockImplementationOnce(async (input) => {
				seen.push(input.idempotencyKey);
				return { idempotency_key: input.idempotencyKey, state: "expired" };
			})
			.mockImplementationOnce(async (input) => {
				seen.push(input.idempotencyKey);
				return published(input.idempotencyKey);
			});
		const { store, actions, keys } = setup({ submit });
		actions.setDraft(CID, CONV, "hi");
		await actions.send(CID, CONV);
		expect(store.getState().attempts[KEY]?.state.kind).toBe("failed");
		await actions.retry(CID, CONV);
		expect(keys).toHaveLength(2);
		expect(seen).toEqual(keys);
		expect(store.getState().attempts[KEY]).toBeUndefined();
	});
});

describe("approvals", () => {
	it("parses a pending stub whose answered_surface is null (server shape)", async () => {
		const fetchImpl = (async () =>
			new Response(
				JSON.stringify({
					items: [
						{
							approval_id: "a1",
							target_kind: "channel",
							channel_id: "c1",
							state: "pending",
							answered_surface: null,
							created_at: "2026-11-18T12:45:07.332Z",
							expires_at: "2026-11-19T12:45:07.332Z",
							answered_at: null,
						},
					],
					next_cursor: null,
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;
		const client = createCommunityClient({
			accessToken: async () => "t",
			fetchImpl,
		});
		const { store, actions } = createCommunityStore({ client: () => client });
		await actions.loadApprovals(CID);
		expect(store.getState().approvals[CID]?.state).toBe("ready");
		expect(store.getState().approvals[CID]?.data).toHaveLength(1);
	});
});

describe("join", () => {
	it("a guidelines change during join reloads the text and joins nothing", async () => {
		const join = vi.fn<CommunityClient["join"]>(async () => {
			throw new CommunityError({
				kind: "guidelines_changed",
				guidelinesVersion: "2026-12",
			});
		});
		const bootstrap = vi.fn<CommunityClient["bootstrap"]>(async () => ({
			community_id: CID,
			community: {
				id: CID,
				slug: "local-operator",
				name: "Local Operator Community",
				state: "active",
			},
			guidelines: { version: "2026-12", text: "New rules." },
			membership: null,
		}));
		const { store, actions } = setup({ join, bootstrap });
		expect(await actions.join(CID, "2026-11")).toBe("changed");
		expect(store.getState().bootstraps[CID]?.data?.guidelines.version).toBe(
			"2026-12",
		);
	});
});

describe("events", () => {
	it("refetches the open thread on conversation_changed and resyncs from the tail on 410", async () => {
		const afters: (string | null)[] = [];
		let calls = 0;
		const events = vi.fn<CommunityClient["events"]>(async (_cid, after) => {
			afters.push(after);
			calls += 1;
			if (calls === 1) return { events: [], next: "c1" };
			if (calls === 2)
				return {
					events: [{ type: "conversation_changed", conversation_id: CONV }],
					next: "c2",
				};
			if (calls === 3) throw new CommunityError({ kind: "resync_required" });
			/* Park the loop until the test unwatches. */
			return new Promise(() => undefined);
		});
		const messages = vi.fn<CommunityClient["messages"]>(async () => ({
			items: [],
			next_cursor: null,
		}));
		const bootstrap = vi.fn<CommunityClient["bootstrap"]>(async () => {
			throw new CommunityError({ kind: "not_found" });
		});
		const { actions } = setup({
			events,
			messages,
			bootstrap,
			channels: async () => ({ items: [], next_cursor: null }),
			directConversations: async () => [],
		});
		await actions.loadThread(CID, CONV);
		const reads = messages.mock.calls.length;
		const unwatch = actions.watch(CID);
		await vi.waitFor(() => expect(calls).toBe(4));
		unwatch();
		expect(afters).toEqual([null, "c1", "c2", null]);
		expect(messages.mock.calls.length).toBeGreaterThan(reads);
		expect(bootstrap).toHaveBeenCalled();
	});
});

/* ---------------------------------------------------------------------------
 * Review round 1 remediation (R1-1, R1-2, R1-3, R1-4, R1-6).
 * ------------------------------------------------------------------------- */

const message = (id: string, seq: number) => ({
	id,
	conversation_id: CONV,
	seq,
	author: { kind: "human" as const, public_id: "p1", display_name: "Ada" },
	text: id,
	created_at: "2026-11-18T10:00:00Z",
});

describe("history refresh (R1-2)", () => {
	it("a message deleted between two reads leaves the screen", async () => {
		const messages = vi
			.fn<CommunityClient["messages"]>()
			.mockResolvedValueOnce({
				items: [message("m2", 2), message("m1", 1)],
				next_cursor: null,
			})
			/* m2 deleted by its author (or removed by a moderator) since. */
			.mockResolvedValueOnce({ items: [message("m1", 1)], next_cursor: null });
		const { store, actions } = setup({ messages });
		await actions.loadThread(CID, CONV);
		expect(store.getState().threads[KEY]?.messages.map((m) => m.id)).toEqual([
			"m1",
			"m2",
		]);
		await actions.refreshThread(CID, CONV);
		expect(store.getState().threads[KEY]?.messages.map((m) => m.id)).toEqual([
			"m1",
		]);
	});

	it("older pages survive a refresh, and so does their deeper cursor", async () => {
		const messages = vi
			.fn<CommunityClient["messages"]>()
			.mockResolvedValueOnce({
				items: [message("m4", 4), message("m3", 3)],
				next_cursor: "older-1",
			})
			.mockResolvedValueOnce({
				items: [message("m2", 2), message("m1", 1)],
				next_cursor: "older-2",
			})
			.mockResolvedValueOnce({
				items: [message("m5", 5), message("m4", 4)],
				next_cursor: "older-1b",
			});
		const { store, actions } = setup({ messages });
		await actions.loadThread(CID, CONV);
		await actions.loadOlder(CID, CONV);
		await actions.refreshThread(CID, CONV);
		const thread = store.getState().threads[KEY];
		/* The refreshed page's window starts at seq 4, so m1..m3 are older
		 * history the reader loaded and stay, with the deeper cursor. */
		expect(thread?.messages.map((m) => m.id)).toEqual([
			"m1",
			"m2",
			"m3",
			"m4",
			"m5",
		]);
		expect(thread?.olderCursor).toBe("older-2");
	});
});

describe("reports (R1-1)", () => {
	it("passes the caller's key through and sends the DM fields", async () => {
		const report = vi.fn<CommunityClient["report"]>(
			async () => "MOD-AAAA-BBBB",
		);
		const { actions } = setup({ report });
		const key = await actions.reportKey();
		const input = {
			targetKind: "dm" as const,
			targetId: "m1",
			category: "harassment_or_abuse" as const,
			dmConsent: true,
			revision: 2,
			idempotencyKey: key,
		};
		expect(await actions.report(CID, input)).toEqual({
			reference: "MOD-AAAA-BBBB",
		});
		await actions.report(CID, input);
		expect(report.mock.calls.map(([, sent]) => sent.idempotencyKey)).toEqual([
			key,
			key,
		]);
		expect(report.mock.calls[0]?.[1]).toMatchObject({
			dmConsent: true,
			revision: 2,
		});
	});
});

describe("events loop lifetime (R1-4)", () => {
	it("a loop that ended on sign_in is started again by the next watch", async () => {
		let calls = 0;
		const events = vi.fn<CommunityClient["events"]>(async () => {
			calls += 1;
			if (calls === 1) throw new CommunityError({ kind: "sign_in" });
			return new Promise(() => undefined);
		});
		const { actions } = setup({ events });
		const first = actions.watch(CID);
		await vi.waitFor(() => expect(calls).toBe(1));
		/* The first screen is still mounted; a second one watches. */
		const second = actions.watch(CID);
		await vi.waitFor(() => expect(calls).toBe(2));
		first();
		second();
	});
});

describe("opening hold and previews (R1-3, R1-6)", () => {
	it("holdOpening is spent by exactly one take", () => {
		const { actions } = setup({});
		expect(actions.takeOpeningHold()).toBe(false);
		actions.holdOpening();
		expect(actions.takeOpeningHold()).toBe(true);
		expect(actions.takeOpeningHold()).toBe(false);
	});

	it("a previewed channel is remembered without any join call", () => {
		const joinChannel = vi.fn<CommunityClient["joinChannel"]>();
		const { store, actions } = setup({ joinChannel });
		actions.previewChannel(CID, {
			id: CONV,
			name: "general",
			visibility: "public",
			member: false,
		} as never);
		expect(store.getState().previews[KEY]?.name).toBe("general");
		expect(joinChannel).not.toHaveBeenCalled();
	});
});
