/**
 * Reply threads: the wire parse, the pure rules, the hub client's two routes,
 * the store's load/read/send transitions and the push tap's destination.
 *
 * The wire shapes are the hub's (agent-server `internal/responses/
 * bridge_conversation.go` `BridgeConversationRepliesResponse` and
 * `BridgeConversationThreadReadView`, origin/main 2026-11-17); the cases mirror
 * what the desktop's parse tolerates.
 */
import { describe, expect, it, vi } from "vitest";
import {
	createHubClient,
	type HubClient,
	HubError,
} from "@/team-bridge/client";
import {
	messagePageSchema,
	messageSchema,
	replyThreadPageSchema,
	replyThreadReadStateSchema,
} from "@/team-bridge/contract";
import {
	teamBridgePushFromData,
	teamBridgeThreadPath,
} from "@/team-bridge/push-payload";
import {
	isReplyRootGone,
	isReplyThreadPageFor,
	newestDisplayedReplySeq,
	protectHeldThreadCursors,
	replierLabel,
	replyThreadKey,
	replyThreadPath,
	replyThreadSummary,
	rootAfterThreadRead,
	rootFromServedPage,
	showsThreadUnread,
} from "@/team-bridge/reply-threads";
import {
	createTeamBridgeStore,
	REPLY_PAGE_LIMIT,
	threadKey,
} from "@/team-bridge/store";
import { ADA, message, person, SELF, status, TENANT } from "./fixtures";

const CONV = "bcv_channel_general";
const ROOT = "bcm_2";
const target = { tenantId: TENANT, conversationId: CONV, rootId: ROOT };

const root = (overrides: Record<string, unknown> = {}) =>
	message(2, ADA, "2026-11-17T10:00:00Z", {
		reply_count: 3,
		last_reply_at: "2026-11-17T10:05:00Z",
		reply_participants: ["Ada", "Ben's agent"],
		reply_participant_ids: [
			{ account_id: ADA, kind: "human" },
			{ account_id: "acct_ben", kind: "agent" },
		],
		thread_unread_count: 2,
		thread_last_read_seq: 5,
		...overrides,
	});
const reply = (seq: number, overrides: Record<string, unknown> = {}) =>
	message(seq, ADA, `2026-11-17T10:0${seq}:00Z`, {
		thread_root_id: ROOT,
		...overrides,
	});

describe("reply-thread wire parse", () => {
	it("keeps every served thread field on a root", () => {
		const parsed = messageSchema.parse(root());
		expect(parsed).toMatchObject({
			reply_count: 3,
			reply_participants: ["Ada", "Ben's agent"],
			reply_participant_ids: [
				{ account_id: ADA, kind: "human" },
				{ account_id: "acct_ben", kind: "agent" },
			],
			thread_unread_count: 2,
			thread_last_read_seq: 5,
		});
	});

	it("parses a message from a hub older than threads unchanged", () => {
		const parsed = messageSchema.parse(message(1, ADA, "2026-11-17T09:00:00Z"));
		expect(parsed.reply_count).toBeUndefined();
		expect(parsed.thread_unread_count).toBeUndefined();
		expect(parsed.thread_root_id).toBeUndefined();
	});

	it("a malformed thread field costs that field, never the message or the page", () => {
		const page = messagePageSchema.parse({
			messages: [
				root({
					reply_count: -1,
					thread_unread_count: "two",
					reply_participants: "Ada",
					reply_participant_ids: [
						{ account_id: ADA, kind: "robot" },
						{ account_id: "acct_ben", kind: "agent" },
					],
				}),
			],
			has_more: false,
		});
		const [parsed] = page.messages;
		expect(parsed?.body).toBe("message 2");
		expect(parsed?.reply_count).toBeUndefined();
		expect(parsed?.thread_unread_count).toBeUndefined();
		expect(parsed?.reply_participants).toBeUndefined();
		// Caught per entry: the unknown kind costs only its own plate.
		expect(parsed?.reply_participant_ids).toEqual([
			null,
			{ account_id: "acct_ben", kind: "agent" },
		]);
	});

	it("parses the replies page and tolerates a lenient thread-read answer", () => {
		const page = replyThreadPageSchema.parse({
			root: root(),
			replies: [reply(5), reply(6)],
			next_after_seq: 7,
			has_more: false,
			order: "sideways",
		});
		expect(page.replies.map((m) => m.thread_root_id)).toEqual([ROOT, ROOT]);
		expect(page.order).toBeUndefined();
		expect(
			replyThreadReadStateSchema.parse({
				conversation_id: CONV,
				root_id: ROOT,
				thread_last_read_seq: 6,
				thread_unread_count: 0,
			}),
		).toMatchObject({ thread_unread_count: 0, thread_last_read_seq: 6 });
		expect(
			replyThreadReadStateSchema.parse({ thread_unread_count: "x" })
				.thread_unread_count,
		).toBeUndefined();
	});
});

describe("reply-thread rules", () => {
	it("summarises a root as served, and nothing for a reply or an empty thread", () => {
		expect(replyThreadSummary(root())).toEqual({
			count: 3,
			lastReplyAt: "2026-11-17T10:05:00Z",
			participants: [
				{ label: "Ada", accountId: ADA, kind: "human" },
				{ label: "Ben's agent", accountId: "acct_ben", kind: "agent" },
			],
			unread: 2,
		});
		expect(replyThreadSummary(reply(5, { reply_count: 3 }))).toBeNull();
		expect(replyThreadSummary(root({ reply_count: 0 }))).toBeNull();
		expect(
			replyThreadSummary(message(1, ADA, "2026-11-17T09:00:00Z")),
		).toBeNull();
	});

	it("never manufactures a last-reply time from missing or invalid rollups", () => {
		expect(
			replyThreadSummary(root({ last_reply_at: undefined }))?.lastReplyAt,
		).toBeUndefined();
		expect(
			replyThreadSummary(root({ last_reply_at: "not-a-time" }))?.lastReplyAt,
		).toBeUndefined();
		expect(
			replyThreadSummary(reply(5, { last_reply_at: "2026-11-17T10:05:00Z" })),
		).toBeNull();
	});

	it("absent unread is not zero, and only a positive served count shows a badge", () => {
		const unknown = replyThreadSummary(
			root({ thread_unread_count: undefined }),
		);
		expect(unknown?.unread).toBeNull();
		expect(showsThreadUnread(unknown)).toBe(false);
		expect(showsThreadUnread(replyThreadSummary(root()))).toBe(true);
		expect(
			showsThreadUnread(replyThreadSummary(root({ thread_unread_count: 0 }))),
		).toBe(false);
	});

	it("drops blank repliers and caps the facepile at three", () => {
		expect(
			replyThreadSummary(
				root({ reply_participants: ["Ada", " ", "", "Ben", "Cy", "Dee"] }),
			)?.participants.map((p) => p.label),
		).toEqual(["Ada", "Ben", "Cy"]);
	});

	it("ids enrich repliers by index; a missing or unreadable id leaves the plain label", () => {
		expect(
			replyThreadSummary(
				root({
					reply_participants: ["Ada", "Aida", "Cy"],
					reply_participant_ids: [{ account_id: ADA, kind: "human" }, null],
				}),
			)?.participants,
		).toEqual([
			{ label: "Ada", accountId: ADA, kind: "human" },
			{ label: "Aida" },
			{ label: "Cy" },
		]);
	});

	it("an agent replier keeps its agent mark (design D1), a human resolves, no id stays plain", () => {
		const people = [
			person(ADA, "Ada Lovelace"),
			person("acct_aida", "Ben", {
				agent: { endpoint_id: "ep_aida", name: "Aida", state: "active" },
			}),
		];
		// The same `Aida (Ben)` the agent's own rows read.
		expect(
			replierLabel(
				{ label: "Aida", accountId: "acct_aida", kind: "agent" },
				people,
			),
		).toBe("Aida (Ben)");
		// Not in the directory yet (a cold push): still says it is an agent.
		expect(
			replierLabel({ label: "Aida", accountId: "acct_x", kind: "agent" }, []),
		).toBe("Aida (Agent)");
		expect(
			replierLabel({ label: "Ada", accountId: ADA, kind: "human" }, people),
		).toBe("Ada Lovelace");
		expect(replierLabel({ label: "Ada" }, people)).toBe("Ada");
	});

	it("an older GET never replaces a newer cursor/unread pair, but its other fields land", () => {
		const held = root({ thread_last_read_seq: 8, thread_unread_count: 0 });
		const stale = root({
			thread_last_read_seq: 5,
			thread_unread_count: 2,
			reply_count: 4,
		});
		expect(rootFromServedPage(held, stale)).toMatchObject({
			thread_last_read_seq: 8,
			thread_unread_count: 0,
			reply_count: 4,
		});
		const fresh = root({ thread_last_read_seq: 9, thread_unread_count: 1 });
		expect(rootFromServedPage(held, fresh)).toBe(fresh);
		expect(rootFromServedPage(null, stale)).toBe(stale);
		// The timeline form: only held roots with a cursor are touched, and a
		// page needing no protection comes back as the same array.
		const other = message(1, ADA, "2026-11-17T09:00:00Z");
		const freshPage = [other, fresh];
		expect(protectHeldThreadCursors([held], freshPage)).toBe(freshPage);
		expect(protectHeldThreadCursors([other], [stale])).toEqual([stale]);
		const guarded = protectHeldThreadCursors([held], [other, stale]);
		expect(guarded[0]).toBe(other);
		expect(guarded[1]).toMatchObject({
			thread_last_read_seq: held.thread_last_read_seq,
			thread_unread_count: held.thread_unread_count,
			reply_count: stale.reply_count,
		});
	});

	it("only a missing root is final; other failures stay retryable (UX U3)", () => {
		expect(
			isReplyRootGone(
				new HubError({
					kind: "not_found",
					message: "gone",
					status: 404,
					code: "message_not_found",
				}),
			),
		).toBe(true);
		expect(
			isReplyRootGone(
				new HubError({ kind: "unreachable", message: "offline" }),
			),
		).toBe(false);
		expect(isReplyRootGone(null)).toBe(false);
	});

	it("refuses a page that is not this thread", () => {
		const good = replyThreadPageSchema.parse({
			root: root(),
			replies: [reply(5)],
		});
		expect(isReplyThreadPageFor(good, target)).toBe(true);
		expect(
			isReplyThreadPageFor(
				{ ...good, root: { ...good.root, id: "bcm_9" } },
				target,
			),
		).toBe(false);
		expect(
			isReplyThreadPageFor(
				{ ...good, root: { ...good.root, conversation_id: "bcv_other" } },
				target,
			),
		).toBe(false);
		expect(
			isReplyThreadPageFor(
				{ ...good, root: { ...good.root, thread_root_id: "bcm_1" } },
				target,
			),
		).toBe(false);
		expect(
			isReplyThreadPageFor(
				{ ...good, replies: [{ ...reply(5), thread_root_id: "bcm_9" }] },
				target,
			),
		).toBe(false);
	});

	it("only displayed replies of this root advance the cursor; the root never does", () => {
		expect(newestDisplayedReplySeq([], ROOT)).toBeNull();
		expect(
			newestDisplayedReplySeq(
				[root() as never, reply(6), reply(5), { seq: 99, thread_root_id: "x" }],
				ROOT,
			),
		).toBe(6);
	});

	it("takes the hub's count after a read, and an older answer never resurrects a badge", () => {
		const held = messageSchema.parse(root());
		const read = rootAfterThreadRead(held, {
			thread_unread_count: 0,
			thread_last_read_seq: 7,
		});
		expect(read.thread_unread_count).toBe(0);
		expect(read.thread_last_read_seq).toBe(7);
		// A slower answer for an older cursor arrives afterwards.
		expect(
			rootAfterThreadRead(read, {
				thread_unread_count: 2,
				thread_last_read_seq: 5,
			}),
		).toBe(read);
		// A lenient answer with no count leaves the root alone.
		expect(rootAfterThreadRead(held, {})).toBe(held);
	});

	it("routes and keys a thread by tenant, conversation and root", () => {
		expect(replyThreadPath({ ...target, rootId: "bcm 2" })).toBe(
			`/team-bridge/${TENANT}/${CONV}/thread/bcm%202`,
		);
		expect(replyThreadKey(target)).toBe(`${TENANT}/${CONV}/${ROOT}`);
	});
});

describe("reply-thread push", () => {
	const data = {
		v: 1,
		type: "team_bridge_message",
		tenant_id: TENANT,
		conversation_id: CONV,
		message_id: "bcm_6",
		seq: 6,
	};

	it("a reply push opens its thread", () => {
		const push = teamBridgePushFromData({ ...data, thread_root_id: ROOT });
		expect(push?.threadRootId).toBe(ROOT);
		expect(push && teamBridgeThreadPath(push)).toBe(
			`/team-bridge/${TENANT}/${CONV}/thread/${ROOT}`,
		);
	});

	it("without thread_root_id (today's hub) the tap opens the conversation as before", () => {
		const push = teamBridgePushFromData(data);
		expect(push).not.toHaveProperty("threadRootId");
		expect(push && teamBridgeThreadPath(push)).toBe(
			`/team-bridge/${TENANT}/${CONV}?messageId=bcm_6&seq=6`,
		);
	});

	it("an unsafe thread_root_id is ignored, never routed", () => {
		const push = teamBridgePushFromData({ ...data, thread_root_id: "../x/.." });
		expect(push).not.toHaveProperty("threadRootId");
		expect(
			teamBridgePushFromData({ ...data, thread_root_id: ".." }),
		).not.toHaveProperty("threadRootId");
	});
});

/** A fetch that answers from a queue and records what it was asked. */
function fakeFetch(answers: Array<() => Response>) {
	const calls: { url: string; init: RequestInit }[] = [];
	const impl = vi.fn(
		async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			const next = answers.shift();
			if (!next) throw new Error("unexpected request");
			return next();
		},
	);
	return { impl: impl as unknown as typeof fetch, calls };
}
const ok = (result: unknown) =>
	new Response(JSON.stringify({ msg: "ok", result }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

describe("reply-thread hub client", () => {
	it("reads, acknowledges and replies on the hub's thread routes", async () => {
		const { impl, calls } = fakeFetch([
			() => ok({ root: root(), replies: [reply(5)], has_more: false }),
			() =>
				ok({
					conversation_id: CONV,
					root_id: ROOT,
					thread_last_read_seq: 5,
					thread_unread_count: 0,
				}),
			() =>
				ok(
					reply(7, {
						sender: { account_id: SELF, kind: "human", display_label: "Sam" },
					}),
				),
			() => ok(message(8, SELF, "2026-11-17T11:00:00Z")),
		]);
		const client = createHubClient({
			accessToken: async () => "token-a",
			fetchImpl: impl,
		});
		const page = await client.listReplies(TENANT, CONV, ROOT, {
			afterSeq: 5,
			limit: 50,
		});
		expect(page.replies).toHaveLength(1);
		const read = await client.markThreadRead(TENANT, CONV, ROOT, 5);
		expect(read.thread_unread_count).toBe(0);
		await client.send(TENANT, CONV, {
			clientRef: "ref-1",
			body: "on it",
			threadRootId: ROOT,
		});
		await client.send(TENANT, CONV, { clientRef: "ref-2", body: "top" });

		const [list, ack, replySend, topSend] = calls;
		expect(new URL(list?.url ?? "").pathname).toBe(
			`/v1/messaging/conversations/${CONV}/messages/${ROOT}/replies`,
		);
		expect(Object.fromEntries(new URL(list?.url ?? "").searchParams)).toEqual({
			tenant_id: TENANT,
			after_seq: "5",
			limit: "50",
		});
		expect(ack?.init.method).toBe("POST");
		expect(new URL(ack?.url ?? "").pathname).toBe(
			`/v1/messaging/conversations/${CONV}/messages/${ROOT}/read`,
		);
		expect(JSON.parse(String(ack?.init.body))).toEqual({
			tenant_id: TENANT,
			seq: 5,
		});
		expect(JSON.parse(String(replySend?.init.body))).toEqual({
			tenant_id: TENANT,
			client_ref: "ref-1",
			body: "on it",
			thread_root_id: ROOT,
		});
		// A top-level send stays byte-identical to before threads existed.
		expect(JSON.parse(String(topSend?.init.body))).not.toHaveProperty(
			"thread_root_id",
		);
	});
});

const token = (sub: string) =>
	`h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

function storeWith(overrides: Partial<HubClient>) {
	const hub = {
		...createHubClient({
			accessToken: async () => token(SELF),
			fetchImpl: async () => {
				throw new Error("Unexpected transport");
			},
		}),
		status: vi.fn(async () => status()),
		listMessages: vi.fn(async () => ({
			messages: [message(1, ADA, "2026-11-17T09:00:00Z"), root()],
			has_more: false,
		})),
		accountUnread: vi.fn(async () => ({ total: 0, organizations: [] })),
		...overrides,
	} as HubClient;
	const bridge = createTeamBridgeStore({
		hub: () => hub,
		accessToken: async () => token(SELF),
	});
	return { hub, ...bridge };
}

describe("reply-thread store", () => {
	it("loads every page, publishes the served root to the timeline, and keeps replies out of it", async () => {
		const listReplies = vi
			.fn()
			.mockResolvedValueOnce({
				root: root({ reply_count: 3 }),
				replies: [reply(5), reply(6)],
				next_after_seq: 7,
				has_more: true,
			})
			.mockResolvedValueOnce({
				root: root({ reply_count: 4, thread_unread_count: 3 }),
				replies: [reply(7), reply(8)],
				has_more: false,
			});
		const { store, actions } = storeWith({ listReplies });
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);
		await actions.loadReplyThread(target);

		expect(listReplies).toHaveBeenNthCalledWith(1, TENANT, CONV, ROOT, {
			afterSeq: undefined,
			limit: 50,
		});
		expect(listReplies).toHaveBeenNthCalledWith(2, TENANT, CONV, ROOT, {
			afterSeq: 7,
			limit: 50,
		});
		const held = store.getState().replyThreads[`${TENANT}/${CONV}/${ROOT}`];
		expect(held?.state).toBe("ready");
		expect(held?.replies.map((m) => m.seq)).toEqual([5, 6, 7, 8]);
		const timeline = store.getState().threads[threadKey(TENANT, CONV)];
		// The timeline's root now carries the NEWEST served rollup...
		expect(timeline?.messages.find((m) => m.id === ROOT)).toMatchObject({
			reply_count: 4,
			thread_unread_count: 3,
		});
		// ...and still holds no reply.
		expect(timeline?.messages.map((m) => m.seq)).toEqual([1, 2]);
	});

	it("a cursor that does not advance stops paging instead of looping", async () => {
		const listReplies = vi.fn(async () => ({
			root: root(),
			replies: [reply(5)],
			next_after_seq: 5,
			has_more: true,
		}));
		const { actions } = storeWith({ listReplies });
		await actions.checkStatus();
		await actions.loadReplyThread(target);
		expect(listReplies).toHaveBeenCalledTimes(2);
	});

	it("a page for another thread is an error, never painted", async () => {
		const listReplies = vi.fn(async () => ({
			root: root({ id: "bcm_other" }),
			replies: [],
		}));
		const { store, actions } = storeWith({ listReplies });
		await actions.checkStatus();
		await actions.loadReplyThread(target);
		const held = store.getState().replyThreads[replyThreadKey(target)];
		expect(held?.state).toBe("error");
		expect(held?.root).toBeNull();
	});

	it("a thread read clears the root's badge with the hub's count and re-reads the account badge", async () => {
		const markThreadRead = vi.fn(async () => ({
			thread_unread_count: 0,
			thread_last_read_seq: 8,
		}));
		const listReplies = vi.fn(async () => ({
			root: root(),
			replies: [reply(5), reply(8)],
			has_more: false,
		}));
		const { hub, store, actions } = storeWith({ listReplies, markThreadRead });
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);
		await actions.loadReplyThread(target);
		const unreadReads = vi.mocked(hub.accountUnread).mock.calls.length;

		await expect(actions.markReplyThreadRead(target, 8)).resolves.toBe(true);

		expect(markThreadRead).toHaveBeenCalledWith(TENANT, CONV, ROOT, 8);
		const timelineRoot = store
			.getState()
			.threads[threadKey(TENANT, CONV)]?.messages.find((m) => m.id === ROOT);
		expect(timelineRoot?.thread_unread_count).toBe(0);
		expect(
			store.getState().replyThreads[replyThreadKey(target)]?.root
				?.thread_unread_count,
		).toBe(0);
		expect(vi.mocked(hub.accountUnread).mock.calls.length).toBe(
			unreadReads + 1,
		);
	});

	it("a failed thread read reports false and leaves the badge as served", async () => {
		const markThreadRead = vi.fn(async () => {
			throw new HubError({ kind: "unreachable", message: "offline" });
		});
		const { store, actions } = storeWith({ markThreadRead });
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);
		await expect(actions.markReplyThreadRead(target, 8)).resolves.toBe(false);
		expect(
			store
				.getState()
				.threads[threadKey(TENANT, CONV)]?.messages.find((m) => m.id === ROOT)
				?.thread_unread_count,
		).toBe(2);
	});

	it("a reply joins the thread (not the timeline) and the root's count is re-read from the hub", async () => {
		const sent = reply(9, {
			sender: { account_id: SELF, kind: "human", display_label: "Sam" },
		});
		const send = vi.fn(async () => sent);
		const listReplies = vi
			.fn()
			.mockResolvedValueOnce({ root: root(), replies: [reply(5)] })
			.mockResolvedValueOnce({
				root: root({ reply_count: 4, thread_unread_count: 0 }),
				replies: [reply(5), sent],
			});
		const { store, actions } = storeWith({ send, listReplies });
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);
		await actions.loadReplyThread(target);

		await actions.sendReply(target, "on it", "ref-1");
		expect(send).toHaveBeenCalledWith(TENANT, CONV, {
			clientRef: "ref-1",
			body: "on it",
			threadRootId: ROOT,
		});
		await vi.waitFor(() => expect(listReplies).toHaveBeenCalledTimes(2));
		await vi.waitFor(() =>
			expect(
				store
					.getState()
					.threads[threadKey(TENANT, CONV)]?.messages.find((m) => m.id === ROOT)
					?.reply_count,
			).toBe(4),
		);
		expect(
			store
				.getState()
				.replyThreads[replyThreadKey(target)]?.replies.map((m) => m.seq),
		).toEqual([5, 9]);
		expect(
			store
				.getState()
				.threads[threadKey(TENANT, CONV)]?.messages.map((m) => m.seq),
		).toEqual([1, 2]);
	});

	it("a GET that answers after a thread read keeps the read's cursor and unread (review R1)", async () => {
		let release: (() => void) | null = null;
		const listReplies = vi
			.fn()
			// The warm-up read: the thread as the hub served it before any read.
			.mockResolvedValueOnce({
				root: root({ thread_last_read_seq: 0, thread_unread_count: 2 }),
				replies: [reply(3)],
				has_more: false,
			})
			// The poll: leaves BEFORE the read, answers AFTER it.
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = () =>
							resolve({
								root: root({
									thread_last_read_seq: 0,
									thread_unread_count: 2,
									reply_count: 4,
								}),
								replies: [reply(3)],
								has_more: false,
							});
					}),
			);
		const markThreadRead = vi.fn(async () => ({
			thread_unread_count: 0,
			thread_last_read_seq: 3,
		}));
		const { store, actions } = storeWith({
			listReplies,
			markThreadRead,
			listMessages: vi.fn(async () => ({
				messages: [
					message(1, ADA, "2026-11-17T09:00:00Z"),
					root({ thread_last_read_seq: 0, thread_unread_count: 2 }),
				],
				has_more: false,
			})),
		});
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);
		await actions.loadReplyThread(target);

		const poll = actions.loadReplyThread(target);
		await vi.waitFor(() => expect(release).not.toBeNull());
		await expect(actions.markReplyThreadRead(target, 3)).resolves.toBe(true);
		(release as unknown as () => void)();
		await poll;

		const timelineRoot = store
			.getState()
			.threads[threadKey(TENANT, CONV)]?.messages.find((m) => m.id === ROOT);
		const threadRoot =
			store.getState().replyThreads[replyThreadKey(target)]?.root;
		for (const held of [timelineRoot, threadRoot]) {
			// Observed before the fix: unread 0 -> 2, cursor 3 -> 0.
			expect(held?.thread_unread_count).toBe(0);
			expect(held?.thread_last_read_seq).toBe(3);
			// Everything else the late page carried still lands.
			expect(held?.reply_count).toBe(4);
		}
	});

	/*
	 * The same race as R1, on the two other routes that carry the root: the
	 * conversation timeline's refresh and its older-page read. Both GETs leave
	 * holding cursor 0 / unread 2, a thread read lands 3 / 0 meanwhile, and the
	 * page answers afterwards with a changed reply count. The held pair must
	 * survive; the count must not be lost with it.
	 */
	function deferredTimeline() {
		let release: (() => void) | null = null;
		const page = (overrides: Record<string, unknown>) => ({
			messages: [
				message(1, ADA, "2026-11-17T09:00:00Z"),
				root({ thread_last_read_seq: 0, thread_unread_count: 2, ...overrides }),
			],
			has_more: false,
		});
		const listMessages = vi
			.fn()
			.mockResolvedValueOnce(page({}))
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = () => resolve(page({ reply_count: 4 }));
					}),
			);
		const markThreadRead = vi.fn(async () => ({
			thread_unread_count: 0,
			thread_last_read_seq: 3,
		}));
		return {
			listMessages,
			markThreadRead,
			release: () => (release as unknown as () => void)(),
			started: () => release !== null,
		};
	}
	const timelineRoot = (store: ReturnType<typeof storeWith>["store"]) =>
		store
			.getState()
			.threads[threadKey(TENANT, CONV)]?.messages.find((m) => m.id === ROOT);

	it("a timeline refresh that answers after a thread read keeps the read's cursor and unread", async () => {
		const rig = deferredTimeline();
		const { store, actions } = storeWith({
			listMessages: rig.listMessages,
			markThreadRead: rig.markThreadRead,
		});
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);
		expect(timelineRoot(store)?.thread_last_read_seq).toBe(0);

		const refresh = actions.loadThread(TENANT, CONV);
		await vi.waitFor(() => expect(rig.started()).toBe(true));
		await expect(actions.markReplyThreadRead(target, 3)).resolves.toBe(true);
		expect(timelineRoot(store)).toMatchObject({
			thread_unread_count: 0,
			thread_last_read_seq: 3,
		});
		rig.release();
		await refresh;

		// Observed before the fix: unread 0 -> 2, cursor 3 -> 0.
		expect(timelineRoot(store)).toMatchObject({
			thread_unread_count: 0,
			thread_last_read_seq: 3,
			reply_count: 4,
		});
	});

	it("an older page that answers after a thread read keeps the read's cursor and unread", async () => {
		let release: (() => void) | null = null;
		const listMessages = vi
			.fn()
			// Newest page: only the root, more history behind it.
			.mockResolvedValueOnce({
				messages: [
					root({ seq: 5, thread_last_read_seq: 0, thread_unread_count: 2 }),
				],
				has_more: true,
			})
			// The older page overlaps the root (an edit/rollup restated).
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = () =>
							resolve({
								messages: [
									message(1, ADA, "2026-11-17T09:00:00Z"),
									root({
										seq: 5,
										thread_last_read_seq: 0,
										thread_unread_count: 2,
										reply_count: 4,
									}),
								],
								has_more: false,
							});
					}),
			);
		const markThreadRead = vi.fn(async () => ({
			thread_unread_count: 0,
			thread_last_read_seq: 3,
		}));
		const { store, actions } = storeWith({ listMessages, markThreadRead });
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);

		const older = actions.loadOlder(TENANT, CONV);
		await vi.waitFor(() => expect(release).not.toBeNull());
		await expect(actions.markReplyThreadRead(target, 3)).resolves.toBe(true);
		(release as unknown as () => void)();
		await older;

		expect(timelineRoot(store)).toMatchObject({
			thread_unread_count: 0,
			thread_last_read_seq: 3,
			reply_count: 4,
		});
		expect(
			store
				.getState()
				.threads[threadKey(TENANT, CONV)]?.messages.map((m) => m.seq),
		).toEqual([1, 5]);
	});

	it("a timeline page at an equal or newer cursor takes the served unread", async () => {
		const listMessages = vi
			.fn()
			.mockResolvedValueOnce({
				messages: [root({ thread_last_read_seq: 3, thread_unread_count: 0 })],
				has_more: false,
			})
			.mockResolvedValueOnce({
				// Same cursor, a new reply arrived: the served count is the truth.
				messages: [root({ thread_last_read_seq: 3, thread_unread_count: 1 })],
				has_more: false,
			})
			.mockResolvedValueOnce({
				messages: [root({ thread_last_read_seq: 6, thread_unread_count: 0 })],
				has_more: false,
			})
			.mockResolvedValueOnce({
				// No cursor served: the held pair stays.
				messages: [
					root({
						thread_last_read_seq: undefined,
						thread_unread_count: 4,
					}),
				],
				has_more: false,
			});
		const { store, actions } = storeWith({ listMessages });
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);
		await actions.loadThread(TENANT, CONV);
		expect(timelineRoot(store)).toMatchObject({
			thread_last_read_seq: 3,
			thread_unread_count: 1,
		});
		await actions.loadThread(TENANT, CONV);
		expect(timelineRoot(store)).toMatchObject({
			thread_last_read_seq: 6,
			thread_unread_count: 0,
		});
		await actions.loadThread(TENANT, CONV);
		expect(timelineRoot(store)).toMatchObject({
			thread_last_read_seq: 6,
			thread_unread_count: 0,
		});
	});

	it("an unchanged timeline poll behind a held cursor keeps the held array", async () => {
		const rig = deferredTimeline();
		rig.listMessages.mockResolvedValue({
			messages: [
				message(1, ADA, "2026-11-17T09:00:00Z"),
				root({
					thread_last_read_seq: 0,
					thread_unread_count: 2,
					reply_count: 4,
				}),
			],
			has_more: false,
		});
		const { store, actions } = storeWith({
			listMessages: rig.listMessages,
			markThreadRead: rig.markThreadRead,
		});
		await actions.checkStatus();
		await actions.loadThread(TENANT, CONV);
		const refresh = actions.loadThread(TENANT, CONV);
		await vi.waitFor(() => expect(rig.started()).toBe(true));
		await actions.markReplyThreadRead(target, 3);
		rig.release();
		await refresh;
		const before = store.getState().threads[threadKey(TENANT, CONV)]?.messages;
		// A stale-cursor poll that otherwise restates what is held changes nothing.
		await actions.loadThread(TENANT, CONV);
		expect(store.getState().threads[threadKey(TENANT, CONV)]?.messages).toBe(
			before,
		);
	});

	it("reply 501 is reachable: the capped cursor is kept and continued (review R2)", async () => {
		// 501 replies at seq 2..502; the hub pages 50 at a time with the
		// inclusive cursor pointing at the next unread seq.
		const all = Array.from({ length: 501 }, (_, i) => reply(i + 2));
		const listReplies = vi.fn(
			async (
				_t: string,
				_c: string,
				_r: string,
				options: { afterSeq?: number; limit?: number } = {},
			) => {
				const from = options.afterSeq ?? 0;
				const rest = all.filter((m) => m.seq >= from);
				const page = rest.slice(0, options.limit ?? 50);
				const more = rest.length > page.length;
				return {
					root: root({ reply_count: 501 }),
					replies: page,
					has_more: more,
					...(more ? { next_after_seq: rest[page.length]?.seq } : {}),
				};
			},
		);
		const { store, actions } = storeWith({ listReplies });
		await actions.checkStatus();
		await actions.loadReplyThread(target);
		const key = replyThreadKey(target);
		let held = store.getState().replyThreads[key];
		expect(listReplies).toHaveBeenCalledTimes(REPLY_PAGE_LIMIT);
		expect(held?.replies).toHaveLength(500);
		expect(held?.moreAfterSeq).toBe(502);

		await actions.loadMoreReplies(target);
		held = store.getState().replyThreads[key];
		expect(listReplies).toHaveBeenLastCalledWith(TENANT, CONV, ROOT, {
			afterSeq: 502,
			limit: 50,
		});
		expect(held?.replies).toHaveLength(501);
		expect(held?.replies.at(-1)?.seq).toBe(502);
		expect(held?.moreAfterSeq).toBeNull();

		// A later poll re-reads from the top and hits the cap again; it resumes
		// from what is already held, never back at reply ~500.
		await actions.loadReplyThread(target);
		held = store.getState().replyThreads[key];
		expect(held?.replies).toHaveLength(501);
		expect(held?.moreAfterSeq).toBe(502);
		// Nothing to load past it: the continuation ends on the hub's own "no more".
		await actions.loadMoreReplies(target);
		expect(store.getState().replyThreads[key]?.moreAfterSeq).toBeNull();
	});

	it("reset forgets every reply thread", async () => {
		const listReplies = vi.fn(async () => ({
			root: root(),
			replies: [reply(5)],
		}));
		const { store, actions } = storeWith({ listReplies });
		await actions.checkStatus();
		await actions.loadReplyThread(target);
		actions.reset();
		expect(store.getState().replyThreads).toEqual({});
	});
});
