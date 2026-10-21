import { describe, expect, it, vi } from "vitest";

import {
	createHubClient,
	type HubClient,
	HubError,
} from "@/team-bridge/client";
import {
	accountIdFromToken,
	createTeamBridgeStore,
	threadKey,
} from "@/team-bridge/store";

import {
	ADA,
	conversation,
	dm,
	message,
	person,
	SELF,
	status,
	TENANT,
} from "./fixtures";

/** A JWT-shaped token whose `sub` is the given account (signature irrelevant). */
const token = (sub: string) =>
	`h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

function fakeHub(overrides: Partial<HubClient> = {}): HubClient {
	return {
		...createHubClient({
			accessToken: async () => token(SELF),
			fetchImpl: async () => {
				throw new Error("Unexpected transport");
			},
		}),
		status: vi.fn(async () => status()),
		listConversations: vi.fn(async () => ({
			conversations: [conversation(), dm(ADA, "Ada")],
			has_more: false,
		})),
		getConversation: vi.fn(),
		createConversation: vi.fn(),
		listMessages: vi.fn(async () => ({
			messages: [
				message(3, ADA, "2026-10-21T10:00:00Z"),
				message(4, ADA, "2026-10-21T10:01:00Z"),
			],
			has_more: true,
		})),
		send: vi.fn(),
		markRead: vi.fn(async (_t: string, id: string) => ({
			conversation_id: id,
			last_read_seq: 4,
			unread_count: 0,
			muted: false,
			notify: "all" as const,
		})),
		accountUnread: vi.fn(async () => ({
			total: 5,
			organizations: [
				{
					tenant_id: TENANT,
					tenant_name: "Example Org",
					unread: 5,
					eligible: true,
				},
			],
		})),
		directory: vi.fn(async () => ({
			members: [person(ADA, "Ada")],
			unavailable_count: 0,
		})),
		registerDevice: vi.fn(),
		unregisterDevice: vi.fn(),
		...overrides,
	};
}

describe("team bridge store", () => {
	it("reads the caller's account id from the access token's subject", () => {
		expect(accountIdFromToken(token(SELF))).toBe(SELF);
		expect(accountIdFromToken("not-a-jwt")).toBeNull();
		expect(accountIdFromToken(null)).toBeNull();
	});

	it("signed out without a request when there is no token", async () => {
		const hub = fakeHub();
		const { store, actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => null,
		});
		await actions.checkStatus();
		expect(store.getState().gate).toBe("signed_out");
		expect(hub.status).not.toHaveBeenCalled();
	});

	it("opens on an eligible org, selects the remembered one, and learns the reader's id", async () => {
		const hub = fakeHub();
		const { store, actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => token(SELF),
			recallOrg: () => TENANT,
		});
		await actions.checkStatus();
		expect(store.getState()).toMatchObject({
			gate: "open",
			selectedTenantId: TENANT,
			selfAccountId: SELF,
		});
	});

	it("gates on the plan when no org is eligible, and on the hub's 503", async () => {
		const plan = createTeamBridgeStore({
			hub: () =>
				fakeHub({
					status: vi.fn(async () =>
						status({
							available: false,
							tenants: [
								{ tenant_id: TENANT, tenant_name: "X", eligible: false },
							],
						}),
					),
				}),
			accessToken: async () => token(SELF),
		});
		await plan.actions.checkStatus();
		expect(plan.store.getState().gate).toBe("plan_required");

		const dark = createTeamBridgeStore({
			hub: () =>
				fakeHub({
					status: vi.fn(async () => {
						throw new HubError({
							kind: "unavailable",
							message: "x",
							status: 503,
							code: "messaging_unavailable",
						});
					}),
				}),
			accessToken: async () => token(SELF),
		});
		await dark.actions.checkStatus();
		expect(dark.store.getState().gate).toBe("unavailable");
	});

	it("a failed refresh after the surface opened keeps it open", async () => {
		let fail = false;
		const hub = fakeHub({
			status: vi.fn(async () => {
				if (fail) throw new HubError({ kind: "unreachable", message: "x" });
				return status();
			}),
		});
		const { store, actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => token(SELF),
		});
		await actions.checkStatus();
		fail = true;
		await actions.checkStatus();
		expect(store.getState().gate).toBe("open");
		expect(store.getState().gateError?.kind).toBe("unreachable");
	});

	it("loads conversations and people in parallel; one failing half leaves the other", async () => {
		const hub = fakeHub({
			directory: vi.fn(async () => {
				throw new HubError({ kind: "server", message: "x", status: 500 });
			}),
		});
		const { store, actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => token(SELF),
		});
		await actions.loadOrganization(TENANT);
		const org = store.getState().orgs[TENANT];
		expect(org?.conversationsState).toBe("ready");
		expect(org?.conversations).toHaveLength(2);
		expect(org?.peopleState).toBe("error");
	});

	it("a plan refusal on the list read turns the surface into the plan gate", async () => {
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				throw new HubError({
					kind: "plan",
					message: "x",
					status: 403,
					code: "bridge_not_available",
				});
			}),
		});
		const { store, actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => token(SELF),
		});
		await actions.loadOrganization(TENANT);
		expect(store.getState().gate).toBe("plan_required");
	});

	it("single-flights concurrent reads of the same org", async () => {
		const hub = fakeHub();
		const { actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => token(SELF),
		});
		await Promise.all([
			actions.loadOrganization(TENANT),
			actions.loadOrganization(TENANT),
			actions.loadOrganization(TENANT),
		]);
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
	});

	it("pages older history with an exclusive before_seq and stops when the hub says so", async () => {
		const listMessages = vi
			.fn()
			.mockResolvedValueOnce({
				messages: [
					message(3, ADA, "2026-10-21T10:00:00Z"),
					message(4, ADA, "2026-10-21T10:01:00Z"),
				],
				has_more: true,
			})
			.mockResolvedValueOnce({
				messages: [
					message(1, ADA, "2026-10-21T09:00:00Z"),
					message(2, ADA, "2026-10-21T09:01:00Z"),
				],
				has_more: false,
			});
		const hub = fakeHub({ listMessages });
		const { store, actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => token(SELF),
		});
		await actions.loadThread(TENANT, "c1");
		await actions.loadOlder(TENANT, "c1");
		expect(listMessages).toHaveBeenLastCalledWith(TENANT, "c1", {
			beforeSeq: 3,
			limit: 50,
		});
		const thread = store.getState().threads[threadKey(TENANT, "c1")];
		expect(thread?.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
		expect(thread?.hasMore).toBe(false);
		await actions.loadOlder(TENANT, "c1");
		expect(listMessages).toHaveBeenCalledTimes(2);
	});

	it("a refresh of the tail never drops older pages already held", async () => {
		const listMessages = vi
			.fn()
			.mockResolvedValueOnce({
				messages: [message(3, ADA, "x"), message(4, ADA, "x")],
				has_more: true,
			})
			.mockResolvedValueOnce({
				messages: [message(1, ADA, "x"), message(2, ADA, "x")],
				has_more: false,
			})
			.mockResolvedValueOnce({
				messages: [message(4, ADA, "x"), message(5, ADA, "x")],
				has_more: true,
			});
		const { store, actions } = createTeamBridgeStore({
			hub: () => fakeHub({ listMessages }),
			accessToken: async () => token(SELF),
		});
		await actions.loadThread(TENANT, "c1");
		await actions.loadOlder(TENANT, "c1");
		await actions.loadThread(TENANT, "c1");
		const thread = store.getState().threads[threadKey(TENANT, "c1")];
		expect(thread?.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
		expect(thread?.hasMore).toBe(false);
	});

	it("marking read clears the row and the account badge optimistically", async () => {
		const hub = fakeHub();
		const { store, actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => token(SELF),
		});
		await actions.checkStatus();
		await actions.refreshUnread();
		await actions.loadOrganization(TENANT);
		expect(store.getState().totalUnread).toBe(5);
		await actions.markRead(TENANT, "bcv_channel_general", 4);
		const row = store
			.getState()
			.orgs[TENANT]?.conversations.find((c) => c.id === "bcv_channel_general");
		expect(row?.unread_count).toBe(0);
		expect(store.getState().totalUnread).toBe(3);
		expect(hub.markRead).toHaveBeenCalledWith(TENANT, "bcv_channel_general", {
			seq: 4,
		});
	});

	it("reset forgets everything of the previous account", async () => {
		const { store, actions } = createTeamBridgeStore({
			hub: () => fakeHub(),
			accessToken: async () => token(SELF),
		});
		await actions.checkStatus();
		await actions.loadOrganization(TENANT);
		actions.reset();
		expect(store.getState()).toMatchObject({
			gate: "checking",
			orgs: {},
			threads: {},
			selfAccountId: null,
		});
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const setup = (hub: HubClient) =>
	createTeamBridgeStore({
		hub: () => hub,
		accessToken: async () => token(SELF),
	});
const receipt = (seq: number, unread = 0, muted = false) => ({
	conversation_id: "bcv_channel_general",
	last_read_seq: seq,
	unread_count: unread,
	muted,
});

describe("account ownership and concurrent reconciliation", () => {
	it("disowns pending status and preserves a newer status single-flight", async () => {
		const old = deferred<Awaited<ReturnType<HubClient["status"]>>>();
		const fresh = deferred<Awaited<ReturnType<HubClient["status"]>>>();
		const hub = fakeHub({
			status: vi
				.fn()
				.mockImplementationOnce(() => old.promise)
				.mockImplementationOnce(() => fresh.promise),
		});
		const { store, actions } = setup(hub);
		const first = actions.checkStatus();
		await Promise.resolve();
		actions.reset();
		const second = actions.checkStatus();
		await Promise.resolve();
		old.resolve(status());
		await first;
		expect(store.getState().gate).toBe("checking");
		expect(actions.checkStatus()).toBe(second);
		fresh.resolve(status());
		await second;
		expect(hub.status).toHaveBeenCalledTimes(2);
		expect(store.getState().gate).toBe("open");
	});

	it("disowns old org, directory, unread, thread, send, receipt and notification writes", async () => {
		const org = deferred<Awaited<ReturnType<HubClient["listConversations"]>>>();
		const directory = deferred<Awaited<ReturnType<HubClient["directory"]>>>();
		const unread = deferred<Awaited<ReturnType<HubClient["accountUnread"]>>>();
		const thread = deferred<Awaited<ReturnType<HubClient["listMessages"]>>>();
		const sent = deferred<Awaited<ReturnType<HubClient["send"]>>>();
		const read = deferred<Awaited<ReturnType<HubClient["markRead"]>>>();
		const hub = fakeHub({
			listConversations: () => org.promise,
			directory: () => directory.promise,
			accountUnread: () => unread.promise,
			listMessages: () => thread.promise,
			send: () => sent.promise,
			markRead: () => read.promise,
		});
		const { store, actions } = setup(hub);
		actions.adopt(conversation());
		const pending = [
			actions.loadOrganization(TENANT),
			actions.refreshUnread(),
			actions.loadThread(TENANT, "bcv_channel_general"),
			actions.markRead(TENANT, "bcv_channel_general", 4),
			actions.setNotify(TENANT, "bcv_channel_general", "mute"),
		];
		const sending = actions.send(TENANT, "bcv_channel_general", "Hi", "ref");
		const denied = expect(sending).rejects.toMatchObject({ kind: "sign_in" });
		actions.reset();
		actions.adopt(conversation({ name: "New account" }));
		const before = store.getState();
		org.resolve({ conversations: [conversation()], has_more: false });
		directory.resolve({ members: [person(ADA, "Ada")], unavailable_count: 0 });
		unread.resolve({ total: 99, organizations: [] });
		thread.resolve({ messages: [message(4, ADA, "x")], has_more: true });
		sent.resolve(message(5, SELF, "x"));
		read.resolve(receipt(4));
		await Promise.all([...pending, denied]);
		expect(store.getState()).toBe(before);
	});

	it("disowns late older history on reset", async () => {
		const page = deferred<Awaited<ReturnType<HubClient["listMessages"]>>>();
		const hub = fakeHub();
		const { store, actions } = setup(hub);
		await actions.loadThread(TENANT, "c1");
		hub.listMessages = () => page.promise;
		const older = actions.loadOlder(TENANT, "c1");
		actions.reset();
		page.resolve({ messages: [message(1, ADA, "x")], has_more: false });
		await older;
		expect(store.getState().threads).toEqual({});
	});

	it("a signed-out status clears identity, selected org and account total", async () => {
		const hub = fakeHub();
		const { store, actions } = setup(hub);
		await actions.checkStatus();
		await actions.refreshUnread();
		hub.status = async () => {
			throw new HubError({ kind: "sign_in", message: "Expired" });
		};
		await actions.checkStatus();
		expect(store.getState()).toMatchObject({
			gate: "signed_out",
			selfAccountId: null,
			selectedTenantId: null,
			totalUnread: 0,
			orgs: {},
			threads: {},
		});
	});

	it("merges a tail response against concurrent send and older-page commits", async () => {
		const tail = deferred<Awaited<ReturnType<HubClient["listMessages"]>>>();
		const older = deferred<Awaited<ReturnType<HubClient["listMessages"]>>>();
		const hub = fakeHub({ send: async () => message(5, SELF, "x") });
		const { store, actions } = setup(hub);
		await actions.loadThread(TENANT, "c1");
		hub.listMessages = (_t, _c, options) =>
			options?.beforeSeq ? older.promise : tail.promise;
		const loading = actions.loadThread(TENANT, "c1");
		const paging = actions.loadOlder(TENANT, "c1");
		await actions.send(TENANT, "c1", "Hi", "ref");
		older.resolve({
			messages: [message(1, ADA, "x"), message(2, ADA, "x")],
			has_more: false,
		});
		await paging;
		tail.resolve({
			messages: [message(3, ADA, "x"), message(4, ADA, "x")],
			has_more: true,
		});
		await loading;
		expect(
			store
				.getState()
				.threads[threadKey(TENANT, "c1")]?.messages.map((m) => m.seq),
		).toEqual([1, 2, 3, 4, 5]);
		expect(store.getState().threads[threadKey(TENANT, "c1")]?.hasMore).toBe(
			false,
		);
	});

	it("does not optimistically clear later unseen messages and reconciles authoritative deltas", async () => {
		const answer = deferred<Awaited<ReturnType<HubClient["markRead"]>>>();
		const { store, actions } = setup(
			fakeHub({ markRead: () => answer.promise }),
		);
		await actions.checkStatus();
		await actions.refreshUnread();
		actions.adopt(conversation({ latest_seq: 10, unread_count: 8 }));
		const pending = actions.markRead(TENANT, "bcv_channel_general", 4);
		expect(store.getState().orgs[TENANT]?.conversations[0]?.unread_count).toBe(
			8,
		);
		expect(store.getState().totalUnread).toBe(5);
		answer.resolve(receipt(4, 6));
		await pending;
		expect(store.getState().orgs[TENANT]?.conversations[0]?.unread_count).toBe(
			6,
		);
		expect(store.getState().totalUnread).toBe(3);
		expect(store.getState().organizations[0]?.unread).toBe(3);
	});

	it("keeps newer receipt and unread badges when older answer arrives last", async () => {
		const first = deferred<Awaited<ReturnType<HubClient["markRead"]>>>();
		const second = deferred<Awaited<ReturnType<HubClient["markRead"]>>>();
		const { store, actions } = setup(
			fakeHub({
				markRead: vi
					.fn()
					.mockImplementationOnce(() => first.promise)
					.mockImplementationOnce(() => second.promise),
			}),
		);
		await actions.checkStatus();
		await actions.refreshUnread();
		actions.adopt(conversation({ latest_seq: 10, unread_count: 5 }));
		const a = actions.markRead(TENANT, "bcv_channel_general", 4);
		const b = actions.markRead(TENANT, "bcv_channel_general", 8);
		second.resolve(receipt(8, 2));
		await b;
		first.resolve(receipt(4, 4));
		await a;
		expect(store.getState().orgs[TENANT]?.conversations[0]).toMatchObject({
			last_read_seq: 8,
			unread_count: 2,
		});
		expect(store.getState().totalUnread).toBe(2);
	});

	it("restores failed optimistic values and retries the same sequence", async () => {
		const first = deferred<Awaited<ReturnType<HubClient["markRead"]>>>();
		const hub = fakeHub({
			markRead: vi
				.fn()
				.mockImplementationOnce(() => first.promise)
				.mockResolvedValueOnce(receipt(4)),
		});
		const { store, actions } = setup(hub);
		await actions.checkStatus();
		await actions.refreshUnread();
		actions.adopt(conversation());
		const pending = actions.markRead(TENANT, "bcv_channel_general", 4);
		expect(store.getState().totalUnread).toBe(3);
		first.reject(new Error("offline"));
		await pending;
		expect(store.getState().totalUnread).toBe(5);
		expect(store.getState().orgs[TENANT]?.conversations[0]).toMatchObject({
			last_read_seq: 2,
			unread_count: 2,
		});
		await actions.markRead(TENANT, "bcv_channel_general", 4);
		expect(hub.markRead).toHaveBeenCalledTimes(2);
		expect(store.getState().totalUnread).toBe(3);
	});

	it("does not subtract muted unread from account totals", async () => {
		const { store, actions } = setup(
			fakeHub({ markRead: async () => receipt(4, 0, true) }),
		);
		await actions.checkStatus();
		await actions.refreshUnread();
		actions.adopt(conversation({ muted: true }));
		await actions.markRead(TENANT, "bcv_channel_general", 4);
		expect(store.getState().totalUnread).toBe(5);
	});

	it("reports the pagination ceiling instead of publishing a truncated list as ready", async () => {
		const hub = fakeHub({
			listConversations: async () => ({
				conversations: [conversation()],
				has_more: true,
				next_cursor: "more",
			}),
		});
		const { store, actions } = setup(hub);
		await actions.loadOrganization(TENANT);
		expect(store.getState().orgs[TENANT]).toMatchObject({
			conversationsState: "error",
			conversations: [],
			conversationsError: { kind: "unavailable" },
		});
	});

	it("keeps cached people but exposes a later directory failure", async () => {
		const hub = fakeHub();
		const { store, actions } = setup(hub);
		await actions.loadOrganization(TENANT);
		hub.directory = async () => {
			throw new HubError({ kind: "unavailable", message: "Offline" });
		};
		await actions.loadOrganization(TENANT, { silent: true });
		expect(store.getState().orgs[TENANT]).toMatchObject({
			peopleState: "error",
			peopleError: { kind: "unavailable" },
			people: [person(ADA, "Ada")],
		});
	});
});

describe("status credential failures", () => {
	it("clears identity, selection, badges and disowns other reads on hub sign-out", async () => {
		const hub = fakeHub();
		const { store, actions } = setup(hub);
		await actions.checkStatus();
		await actions.refreshUnread();
		await actions.loadOrganization(TENANT);
		const pending = deferred<Awaited<ReturnType<HubClient["listMessages"]>>>();
		hub.listMessages = () => pending.promise;
		const thread = actions.loadThread(TENANT, "c1");
		hub.status = async () => {
			throw new HubError({ kind: "sign_in", message: "Expired" });
		};
		await actions.checkStatus();
		pending.resolve({ messages: [message(4, ADA, "x")], has_more: false });
		await thread;
		expect(store.getState()).toMatchObject({
			gate: "signed_out",
			selfAccountId: null,
			selectedTenantId: null,
			totalUnread: 0,
			organizations: [],
			orgs: {},
			threads: {},
		});
	});

	it("classifies transient accessor failure as retryable without requesting with stale credentials", async () => {
		const hub = fakeHub();
		let fail = true;
		const { store, actions } = createTeamBridgeStore({
			hub: () => hub,
			accessToken: async () => {
				if (fail) throw new Error("offline");
				return token(SELF);
			},
		});
		await actions.checkStatus();
		expect(store.getState()).toMatchObject({
			gate: "unavailable",
			gateError: { kind: "unreachable" },
		});
		expect(hub.status).not.toHaveBeenCalled();
		fail = false;
		await actions.checkStatus();
		expect(store.getState().gate).toBe("open");
		fail = true;
		await actions.checkStatus();
		expect(store.getState()).toMatchObject({
			gate: "open",
			gateError: { kind: "unreachable" },
		});
	});
});

describe("read rollback ownership", () => {
	it("refreshes authoritative values when another write replaced a failed optimistic row", async () => {
		const pending = deferred<Awaited<ReturnType<HubClient["markRead"]>>>();
		const hub = fakeHub({ markRead: () => pending.promise });
		const { store, actions } = setup(hub);
		await actions.checkStatus();
		await actions.refreshUnread();
		actions.adopt(conversation());
		const read = actions.markRead(TENANT, "bcv_channel_general", 4);
		actions.adopt(
			conversation({ name: "Updated while receipt pending", unread_count: 0 }),
		);
		pending.reject(new Error("offline"));
		await read;
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
		expect(hub.accountUnread).toHaveBeenCalledTimes(2);
		expect(store.getState().orgs[TENANT]?.conversations[0]).toMatchObject({
			unread_count: 2,
			last_read_seq: 2,
		});
		expect(store.getState().totalUnread).toBe(5);
	});

	it("a list started before a successful receipt cannot regress that cursor", async () => {
		const pending =
			deferred<Awaited<ReturnType<HubClient["listConversations"]>>>();
		const hub = fakeHub({ listConversations: () => pending.promise });
		const { store, actions } = setup(hub);
		actions.adopt(conversation());
		const list = actions.loadOrganization(TENANT);
		await actions.markRead(TENANT, "bcv_channel_general", 4);
		pending.resolve({ conversations: [conversation()], has_more: false });
		await list;
		expect(store.getState().orgs[TENANT]?.conversations[0]).toMatchObject({
			unread_count: 0,
			last_read_seq: 4,
		});
	});
});

describe("tail refresh interval recovery", () => {
	const range = (start: number, end: number) =>
		Array.from({ length: end - start + 1 }, (_, offset) =>
			message(start + offset, ADA, "x"),
		);
	it("bridges a deferred tail jump backwards to overlap without losing concurrently held pages", async () => {
		const bridge = deferred<Awaited<ReturnType<HubClient["listMessages"]>>>();
		const listMessages = vi
			.fn<HubClient["listMessages"]>()
			.mockResolvedValueOnce({ messages: range(1, 50), has_more: false })
			.mockResolvedValueOnce({ messages: range(101, 150), has_more: true })
			.mockImplementationOnce(() => bridge.promise)
			.mockResolvedValueOnce({ messages: range(1, 50), has_more: false });
		const { store, actions } = setup(
			fakeHub({ listMessages, send: async () => message(151, SELF, "x") }),
		);
		await actions.loadThread(TENANT, "c1");
		const tail = actions.loadThread(TENANT, "c1");
		await Promise.resolve();
		expect(
			store.getState().threads[threadKey(TENANT, "c1")]?.messages,
		).toHaveLength(50);
		await actions.send(TENANT, "c1", "new", "ref");
		bridge.resolve({ messages: range(51, 100), has_more: true });
		await tail;
		expect(listMessages).toHaveBeenNthCalledWith(3, TENANT, "c1", {
			beforeSeq: 101,
			limit: 50,
		});
		expect(listMessages).toHaveBeenNthCalledWith(4, TENANT, "c1", {
			beforeSeq: 51,
			limit: 50,
		});
		const thread = store.getState().threads[threadKey(TENANT, "c1")];
		expect(thread?.messages.map((m) => m.seq)).toEqual(
			range(1, 151).map((m) => m.seq),
		);
		expect(thread?.hasMore).toBe(false);
	});

	it("accepts legitimate sequence gaps once a backward page overlaps", async () => {
		const listMessages = vi
			.fn<HubClient["listMessages"]>()
			.mockResolvedValueOnce({
				messages: [message(1, ADA, "x"), message(50, ADA, "x")],
				has_more: false,
			})
			.mockResolvedValueOnce({
				messages: [message(101, ADA, "x")],
				has_more: true,
			})
			.mockResolvedValueOnce({
				messages: [message(50, ADA, "x"), message(90, ADA, "x")],
				has_more: true,
			});
		const { store, actions } = setup(fakeHub({ listMessages }));
		await actions.loadThread(TENANT, "c1");
		await actions.loadThread(TENANT, "c1");
		expect(
			store
				.getState()
				.threads[threadKey(TENANT, "c1")]?.messages.map((m) => m.seq),
		).toEqual([1, 50, 90, 101]);
	});

	it("retains the connected interval and exposes a failed bridge instead of publishing a hole", async () => {
		const listMessages = vi
			.fn<HubClient["listMessages"]>()
			.mockResolvedValueOnce({ messages: range(1, 50), has_more: false })
			.mockResolvedValueOnce({ messages: range(101, 150), has_more: true })
			.mockResolvedValueOnce({ messages: [], has_more: false });
		const { store, actions } = setup(fakeHub({ listMessages }));
		await actions.loadThread(TENANT, "c1");
		await actions.loadThread(TENANT, "c1");
		expect(store.getState().threads[threadKey(TENANT, "c1")]).toMatchObject({
			state: "error",
			error: { kind: "malformed" },
			hasMore: false,
		});
		expect(
			store.getState().threads[threadKey(TENANT, "c1")]?.messages,
		).toHaveLength(50);
	});
});

describe("terminal authorization refusals", () => {
	it.each([
		"status",
		"thread",
		"older",
		"organization",
		"directory",
		"unread",
		"read",
		"notify",
		"send",
	] as const)(
		"gates an already open account after %s refuses its plan",
		async (operation) => {
			const hub = fakeHub();
			const { store, actions } = setup(hub);
			await actions.checkStatus();
			await actions.loadOrganization(TENANT);
			await actions.loadThread(TENANT, "c1");
			const denied = async () => {
				throw new HubError({
					kind: "plan",
					message: "Plan no longer eligible",
				});
			};
			if (operation === "status") {
				hub.status = denied;
				await actions.checkStatus();
			}
			if (operation === "thread") {
				hub.listMessages = denied;
				await actions.loadThread(TENANT, "c1");
			}
			if (operation === "older") {
				hub.listMessages = denied;
				await actions.loadOlder(TENANT, "c1");
			}
			if (operation === "organization") {
				hub.listConversations = denied;
				await actions.loadOrganization(TENANT);
			}
			if (operation === "directory") {
				hub.directory = denied;
				await actions.loadOrganization(TENANT);
			}
			if (operation === "unread") {
				hub.accountUnread = denied;
				await actions.refreshUnread();
			}
			if (operation === "read") {
				hub.markRead = denied;
				await actions.markRead(TENANT, "bcv_channel_general", 4);
			}
			if (operation === "notify") {
				hub.markRead = denied;
				await expect(
					actions.setNotify(TENANT, "bcv_channel_general", "mute"),
				).rejects.toMatchObject({ kind: "plan" });
			}
			if (operation === "send") {
				hub.send = denied;
				await expect(
					actions.send(TENANT, "c1", "hello", "ref"),
				).rejects.toMatchObject({ kind: "plan" });
			}
			expect(store.getState().gate).toBe("plan_required");
			const send = vi.fn<HubClient["send"]>();
			hub.send = send;
			await expect(
				actions.send(TENANT, "c1", "no longer allowed", "ref2"),
			).rejects.toMatchObject({ kind: "plan" });
			expect(send).not.toHaveBeenCalled();
		},
	);

	it.each(["thread", "older", "read", "send"] as const)(
		"signs out and forgets prior-account state when %s refuses authentication",
		async (operation) => {
			const hub = fakeHub();
			const { store, actions } = setup(hub);
			await actions.checkStatus();
			await actions.loadOrganization(TENANT);
			await actions.loadThread(TENANT, "c1");
			const denied = async () => {
				throw new HubError({ kind: "sign_in", message: "Grant refused" });
			};
			if (operation === "thread") {
				hub.listMessages = denied;
				await actions.loadThread(TENANT, "c1");
			}
			if (operation === "older") {
				hub.listMessages = denied;
				await actions.loadOlder(TENANT, "c1");
			}
			if (operation === "read") {
				hub.markRead = denied;
				await actions.markRead(TENANT, "bcv_channel_general", 4);
			}
			if (operation === "send") {
				hub.send = denied;
				await expect(
					actions.send(TENANT, "c1", "hello", "ref"),
				).rejects.toMatchObject({ kind: "sign_in" });
			}
			expect(store.getState()).toMatchObject({
				gate: "signed_out",
				selfAccountId: null,
				orgs: {},
				threads: {},
				totalUnread: 0,
			});
		},
	);
});
