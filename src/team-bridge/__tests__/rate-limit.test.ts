/**
 * Team Bridge under the hub's per-account rate limits (TestFlight 1157: the
 * drawer showed "Radient refused the request (HTTP 429)." and "The people
 * directory could not load." while the channel rows were still held).
 *
 * The hub keys `conversation-reads` and `reads` on the ACCOUNT, 120/min each,
 * and the phone shares both buckets with the desktop app and every agent on
 * that account. These tests pin the phone's half of the fix: it re-reads less
 * (freshness window, directory TTL), it waits out a 429 on the server's
 * `Retry-After` instead of re-asking on every drawer open, and a 429 never
 * becomes an error banner over rows it already holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	conversationsStatus,
	peopleStatus,
} from "@/features/team-bridge/section-status";
import {
	createHubClient,
	type HubClient,
	HubError,
} from "@/team-bridge/client";
import {
	CONVERSATIONS_FRESH_MS,
	createTeamBridgeStore,
	DIRECTORY_TTL_MS,
	RATE_LIMIT_FALLBACK_MS,
	RATE_LIMIT_MAX_MS,
	threadKey,
} from "@/team-bridge/store";
import {
	ADA,
	conversation,
	dm,
	message,
	person,
	SELF,
	TENANT,
} from "./fixtures";

const token = (sub: string) =>
	`h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

const limited = (retryAfterMs: number | null = 7_000) =>
	new HubError({
		kind: "rate_limited",
		message: "Radient refused the request (HTTP 429).",
		status: 429,
		code: "rate_limited",
		retryAfterMs,
	});

function fakeHub(overrides: Partial<HubClient> = {}): HubClient {
	return {
		...createHubClient({
			accessToken: async () => token(SELF),
			fetchImpl: async () => {
				throw new Error("Unexpected transport");
			},
		}),
		listConversations: vi.fn(async () => ({
			conversations: [conversation(), dm(ADA, "Ada")],
			has_more: false,
		})),
		directory: vi.fn(async () => ({
			members: [person(ADA, "Ada")],
			unavailable_count: 0,
		})),
		listMessages: vi.fn(async () => ({
			messages: [message(3, ADA, "2026-10-21T10:00:00Z")],
			has_more: false,
		})),
		...overrides,
	};
}

let clock = 1_000_000;
const now = () => clock;
/** Advance the injected clock AND the fake timers together. */
async function advance(ms: number) {
	clock += ms;
	await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
	clock = 1_000_000;
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

function bridge(hub: HubClient) {
	return createTeamBridgeStore({
		hub: () => hub,
		accessToken: async () => token(SELF),
		now,
	});
}

describe("drawer re-opens reuse fresh reads", () => {
	it("a re-open inside the freshness window sends nothing", async () => {
		const hub = fakeHub();
		const { actions } = bridge(hub);
		await actions.loadOrganization(TENANT, { ifStale: true });
		await advance(CONVERSATIONS_FRESH_MS - 1);
		await actions.loadOrganization(TENANT, { ifStale: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
		expect(hub.directory).toHaveBeenCalledTimes(1);
	});

	it("past the window only the conversations are re-read; the directory waits for its TTL", async () => {
		const hub = fakeHub();
		const { actions } = bridge(hub);
		await actions.loadOrganization(TENANT, { ifStale: true });
		await advance(CONVERSATIONS_FRESH_MS);
		await actions.loadOrganization(TENANT, { ifStale: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		expect(hub.directory).toHaveBeenCalledTimes(1);
		await advance(DIRECTORY_TTL_MS);
		await actions.loadOrganization(TENANT, { ifStale: true });
		expect(hub.directory).toHaveBeenCalledTimes(2);
	});

	it("an explicit retry (force) re-reads both halves at once", async () => {
		const hub = fakeHub();
		const { actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		await actions.loadOrganization(TENANT, { force: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		expect(hub.directory).toHaveBeenCalledTimes(2);
	});
});

describe("a 429 is waited out, never shown raw", () => {
	it("keeps held rows and people on screen with no error banner", async () => {
		let refuse = false;
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				if (refuse) throw limited();
				return {
					conversations: [conversation(), dm(ADA, "Ada")],
					has_more: false,
				};
			}),
			directory: vi.fn(async () => {
				if (refuse) throw limited();
				return { members: [person(ADA, "Ada")], unavailable_count: 0 };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		refuse = true;
		await actions.loadOrganization(TENANT, { force: true });
		const org = store.getState().orgs[TENANT];
		expect(org?.conversationsState).toBe("ready");
		expect(org?.conversationsError).toBeNull();
		expect(org?.conversations).toHaveLength(2);
		expect(org?.peopleState).toBe("ready");
		expect(org?.peopleError).toBeNull();
		expect(org?.people).toHaveLength(1);
		// The first refusal is silent: no "Catching up…" yet.
		expect(org?.conversationsCatchingUp).toBe(false);
		expect(org?.peopleCatchingUp).toBe(false);
	});

	it("a cold 429 keeps the skeleton (loading), not an error", async () => {
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				throw limited();
			}),
			directory: vi.fn(async () => {
				throw limited();
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		const org = store.getState().orgs[TENANT];
		expect(org?.conversationsState).toBe("loading");
		expect(org?.conversationsError).toBeNull();
		expect(org?.peopleState).toBe("loading");
		expect(org?.peopleError).toBeNull();
	});

	it("re-opens during Retry-After send nothing; the scheduled retry recovers silently", async () => {
		let refuse = true;
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				if (refuse) throw limited(7_000);
				return { conversations: [conversation()], has_more: false };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
		// Five drawer opens and a Retry tap inside the server's wait: no request.
		for (let i = 0; i < 5; i += 1) {
			await advance(1_000);
			await actions.loadOrganization(TENANT, { ifStale: true });
		}
		// A pull/Retry (force) still may not re-ask the refused half; it does
		// re-read the directory, whose bucket refused nothing.
		await actions.loadOrganization(TENANT, { force: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
		expect(hub.directory).toHaveBeenCalledTimes(2);
		refuse = false;
		// The store's own retry fires once the wait has elapsed (t = 7 s).
		await advance(2_000);
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		const org = store.getState().orgs[TENANT];
		expect(org?.conversationsState).toBe("ready");
		expect(org?.conversations).toHaveLength(1);
		// The directory is inside its TTL: the scheduled retry does not re-read it.
		expect(hub.directory).toHaveBeenCalledTimes(2);
	});

	it("a refusal that persists past the backoff says Catching up, and backs off further", async () => {
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				throw limited(5_000);
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		expect(store.getState().orgs[TENANT]?.conversationsCatchingUp).toBe(false);
		await advance(5_000);
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		expect(store.getState().orgs[TENANT]?.conversationsCatchingUp).toBe(true);
		expect(store.getState().orgs[TENANT]?.conversationsError).toBeNull();
		// Second strike waits max(Retry-After, 2 × previous) = 10 s, not 5 s.
		await advance(9_999);
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		await advance(1);
		expect(hub.listConversations).toHaveBeenCalledTimes(3);
	});

	it("the wait never exceeds the ceiling, and a missing Retry-After uses the fallback", async () => {
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				throw limited(null);
			}),
		});
		const { actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		await advance(RATE_LIMIT_FALLBACK_MS - 1);
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
		await advance(1);
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		// Walk the doubling until it pins at the ceiling.
		let calls = 2;
		for (let wait = RATE_LIMIT_FALLBACK_MS * 2; ; wait *= 2) {
			const step = Math.min(wait, RATE_LIMIT_MAX_MS);
			await advance(step);
			calls += 1;
			expect(hub.listConversations).toHaveBeenCalledTimes(calls);
			if (step === RATE_LIMIT_MAX_MS) break;
		}
		await advance(RATE_LIMIT_MAX_MS);
		expect(hub.listConversations).toHaveBeenCalledTimes(calls + 1);
	});

	it("success clears Catching up and the backoff", async () => {
		let refusals = 2;
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				if (refusals > 0) {
					refusals -= 1;
					throw limited(1_000);
				}
				return { conversations: [conversation()], has_more: false };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		await advance(1_000);
		expect(store.getState().orgs[TENANT]?.conversationsCatchingUp).toBe(true);
		await advance(2_000);
		const org = store.getState().orgs[TENANT];
		expect(org?.conversationsCatchingUp).toBe(false);
		expect(org?.conversationsState).toBe("ready");
		// Backoff cleared: an explicit retry goes straight out.
		await actions.loadOrganization(TENANT, { force: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(4);
	});

	it("a refused pull over fresh rows leaves no strike behind for a later 429", async () => {
		let refuse = false;
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				if (refuse) throw limited(2_000);
				return { conversations: [conversation()], has_more: false };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT, { ifStale: true });
		refuse = true;
		await actions.loadOrganization(TENANT, { force: true });
		// The retry finds the rows fresh and reads nothing.
		await advance(2_000);
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		// An hour later, a stale re-open is refused once: a FIRST strike, silent.
		await advance(60 * 60_000);
		await actions.loadOrganization(TENANT, { ifStale: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(3);
		expect(store.getState().orgs[TENANT]?.conversationsCatchingUp).toBe(false);
	});

	it("definitive failures keep their existing error state", async () => {
		const hub = fakeHub({
			directory: vi.fn(async () => {
				throw new HubError({ kind: "not_found", message: "x", status: 404 });
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		expect(store.getState().orgs[TENANT]?.peopleState).toBe("error");
	});

	it("reset retires a scheduled retry", async () => {
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				throw limited(1_000);
			}),
		});
		const { actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		actions.reset();
		await advance(60_000);
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
	});
});

describe("thread polls under a 429", () => {
	it("keep held messages, skip polls inside Retry-After, and show no error", async () => {
		let refuse = false;
		const hub = fakeHub({
			listMessages: vi.fn(async () => {
				if (refuse) throw limited(30_000);
				return {
					messages: [message(3, ADA, "2026-10-21T10:00:00Z")],
					has_more: false,
				};
			}),
		});
		const { store, actions } = bridge(hub);
		const key = threadKey(TENANT, "c1");
		await actions.loadThread(TENANT, "c1");
		refuse = true;
		await actions.loadThread(TENANT, "c1");
		expect(store.getState().threads[key]?.state).toBe("ready");
		expect(store.getState().threads[key]?.error).toBeNull();
		expect(store.getState().threads[key]?.messages).toHaveLength(1);
		// The screen's 20 s poll lands inside the 30 s wait: no request.
		await advance(20_000);
		await actions.loadThread(TENANT, "c1");
		expect(hub.listMessages).toHaveBeenCalledTimes(2);
		refuse = false;
		await advance(10_000);
		await actions.loadThread(TENANT, "c1");
		expect(hub.listMessages).toHaveBeenCalledTimes(3);
	});
});

/* Round-1 remediation (PR #297). Each test below fails on f0596c02. */

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("an active wait survives drawer re-opens (QA Q1)", () => {
	it("directory: load, +31 s pull refused by the WAF, +10 s re-open, +11 s pull sends 0", async () => {
		let refuse = false;
		const hub = fakeHub({
			directory: vi.fn(async () => {
				if (refuse) throw limited(300_000);
				return { members: [person(ADA, "Ada")], unavailable_count: 0 };
			}),
		});
		const { actions } = bridge(hub);
		await actions.loadOrganization(TENANT, { ifStale: true });
		await advance(31_000);
		refuse = true;
		await actions.loadOrganization(TENANT, { force: true });
		expect(hub.directory).toHaveBeenCalledTimes(2);
		await advance(10_000);
		// The cached directory is still inside its TTL: "fresh" for this open.
		await actions.loadOrganization(TENANT, { ifStale: true });
		await advance(11_000);
		await actions.loadOrganization(TENANT, { force: true });
		expect(hub.directory).toHaveBeenCalledTimes(2);
	});

	it("conversations: Retry-After 60, re-open, pull sends 0", async () => {
		let refuse = false;
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				if (refuse) throw limited(60_000);
				return { conversations: [conversation()], has_more: false };
			}),
		});
		const { actions } = bridge(hub);
		await actions.loadOrganization(TENANT, { ifStale: true });
		await advance(5_000);
		refuse = true;
		await actions.loadOrganization(TENANT, { force: true });
		await advance(1_000);
		await actions.loadOrganization(TENANT, { ifStale: true });
		await advance(2_000);
		await actions.loadOrganization(TENANT, { force: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
	});
});

describe("a retry that lands inside an in-flight load (review M1)", () => {
	it("re-reads the refused half once the in-flight load ends", async () => {
		const held = deferred<Awaited<ReturnType<HubClient["directory"]>>>();
		let directoryCalls = 0;
		let refuse = true;
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				if (refuse) throw limited(7_000);
				return { conversations: [conversation()], has_more: false };
			}),
			directory: vi.fn(async () => {
				directoryCalls += 1;
				if (directoryCalls === 1)
					return { members: [person(ADA, "Ada")], unavailable_count: 0 };
				return held.promise;
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		refuse = false;
		await advance(6_500);
		// A pull inside the wait: conversations skipped, directory held open.
		const pull = actions.loadOrganization(TENANT, { force: true });
		// The 7 s retry fires into that in-flight load and is merged away.
		await advance(500);
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
		held.resolve({ members: [person(ADA, "Ada")], unavailable_count: 0 });
		await pull;
		await advance(1);
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		expect(store.getState().orgs[TENANT]?.conversationsState).toBe("ready");
		expect(store.getState().orgs[TENANT]?.conversations).toHaveLength(1);
		// And nothing loops afterwards.
		await advance(10 * 60_000);
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
	});
});

describe("a definitive failure ends the rate-limit episode (review m1)", () => {
	it("conversations: two 429s then a 404 clears Catching up and the strike", async () => {
		const answers: Array<() => never | undefined> = [
			() => {
				throw limited(1_000);
			},
			() => {
				throw limited(1_000);
			},
			() => {
				throw new HubError({ kind: "not_found", message: "gone", status: 404 });
			},
			() => {
				throw limited(1_000);
			},
		];
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				answers.shift()?.();
				return { conversations: [conversation()], has_more: false };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		await advance(1_000);
		expect(store.getState().orgs[TENANT]?.conversationsCatchingUp).toBe(true);
		await advance(2_000);
		let org = store.getState().orgs[TENANT];
		expect(hub.listConversations).toHaveBeenCalledTimes(3);
		expect(org?.conversationsState).toBe("error");
		expect(org?.conversationsCatchingUp).toBe(false);
		// The record went with it: Retry goes straight out, and its 429 is a
		// FIRST strike (silent), not a third.
		await actions.loadOrganization(TENANT, { force: true });
		org = store.getState().orgs[TENANT];
		expect(hub.listConversations).toHaveBeenCalledTimes(4);
		expect(org?.conversationsCatchingUp).toBe(false);
	});

	it("people: two 429s then a 404 clears Catching up", async () => {
		let calls = 0;
		const hub = fakeHub({
			directory: vi.fn(async () => {
				calls += 1;
				if (calls <= 2) throw limited(1_000);
				throw new HubError({ kind: "not_found", message: "x", status: 404 });
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		await advance(1_000);
		expect(store.getState().orgs[TENANT]?.peopleCatchingUp).toBe(true);
		await advance(2_000);
		const org = store.getState().orgs[TENANT];
		expect(org?.peopleState).toBe("error");
		expect(org?.peopleCatchingUp).toBe(false);
		expect(peopleStatus(org)).toEqual({
			skeleton: false,
			catchingUp: false,
			alert: true,
		});
	});
});

describe("the people half waits out its own 429 (review m4)", () => {
	it("cold directory 429s: skeleton, then Catching up after the second, recovery after the doubled wait", async () => {
		let refusals = 2;
		const hub = fakeHub({
			directory: vi.fn(async () => {
				if (refusals > 0) {
					refusals -= 1;
					throw limited(1_000);
				}
				return { members: [person(ADA, "Ada")], unavailable_count: 0 };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		expect(peopleStatus(store.getState().orgs[TENANT])).toEqual({
			skeleton: true,
			catchingUp: false,
			alert: false,
		});
		await advance(1_000);
		expect(hub.directory).toHaveBeenCalledTimes(2);
		expect(peopleStatus(store.getState().orgs[TENANT])).toEqual({
			skeleton: true,
			catchingUp: true,
			alert: false,
		});
		// The second wait doubled to 2 s: nothing at +1.999 s, the read at +2 s.
		await actions.loadOrganization(TENANT, { force: true });
		await advance(1_999);
		expect(hub.directory).toHaveBeenCalledTimes(2);
		await advance(1);
		expect(hub.directory).toHaveBeenCalledTimes(3);
		expect(peopleStatus(store.getState().orgs[TENANT])).toEqual({
			skeleton: false,
			catchingUp: false,
			alert: false,
		});
	});
});

describe("what the list renders under a 429 (review m4, design D2)", () => {
	it("cold: skeleton plus Catching up, never the alert; held rows: no skeleton", async () => {
		let refuse = true;
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				if (refuse) throw limited(1_000);
				return { conversations: [conversation()], has_more: false };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		await advance(1_000);
		// Strike 2, nothing held: the skeleton stays (so Groups stays hidden)
		// and the heading says Catching up. No red banner.
		expect(conversationsStatus(store.getState().orgs[TENANT])).toEqual({
			skeleton: true,
			catchingUp: true,
			alert: false,
		});
		refuse = false;
		await advance(2_000);
		expect(store.getState().orgs[TENANT]?.conversations).toHaveLength(1);
		// Past the freshness window, so the scheduled retry re-reads the rows.
		await advance(CONVERSATIONS_FRESH_MS);
		refuse = true;
		await actions.loadOrganization(TENANT, { force: true });
		await advance(1_000);
		// Held rows under a second strike: rows, Catching up, no skeleton, no alert.
		expect(conversationsStatus(store.getState().orgs[TENANT])).toEqual({
			skeleton: false,
			catchingUp: true,
			alert: false,
		});
	});
});

describe("account boundaries clear pending retries (review m4)", () => {
	it("retire() mid-wait sends nothing afterwards", async () => {
		const hub = fakeHub({
			listConversations: vi.fn(async () => {
				throw limited(1_000);
			}),
		});
		const { actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		actions.retire();
		expect(vi.getTimerCount()).toBe(0);
		await advance(RATE_LIMIT_MAX_MS);
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
	});
});

describe("unread changes drop the list reuse (review m2)", () => {
	const seedOrg = (store: ReturnType<typeof bridge>["store"], unread: number) =>
		store.setState({
			organizations: [
				{
					tenantId: TENANT,
					name: "Org",
					eligible: true,
					readOnly: false,
					unread,
				},
			],
		});
	const unreadHub = (unread: number) =>
		fakeHub({
			accountUnread: vi.fn(async () => ({
				total: unread,
				organizations: [
					{ tenant_id: TENANT, tenant_name: "Org", unread, eligible: true },
				],
			})),
		});

	it("a changed count makes the next open re-read the list", async () => {
		const hub = unreadHub(3);
		const { store, actions } = bridge(hub);
		seedOrg(store, 0);
		await actions.loadOrganization(TENANT, { ifStale: true });
		await advance(10_000);
		await actions.refreshUnread();
		await actions.loadOrganization(TENANT, { ifStale: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(2);
		// The directory is not part of it.
		expect(hub.directory).toHaveBeenCalledTimes(1);
	});

	it("an unchanged count keeps the reuse", async () => {
		const hub = unreadHub(3);
		const { store, actions } = bridge(hub);
		seedOrg(store, 3);
		await actions.loadOrganization(TENANT, { ifStale: true });
		await advance(10_000);
		await actions.refreshUnread();
		await actions.loadOrganization(TENANT, { ifStale: true });
		expect(hub.listConversations).toHaveBeenCalledTimes(1);
	});
});

describe("abandoned thread waits are pruned (review n1)", () => {
	it("a 429 long after an abandoned thread's wait starts from the served wait", async () => {
		let refuse = true;
		const hub = fakeHub({
			listMessages: vi.fn(async () => {
				if (refuse) throw limited(30_000);
				return {
					messages: [message(3, ADA, "2026-10-21T10:00:00Z")],
					has_more: false,
				};
			}),
		});
		const { actions } = bridge(hub);
		await actions.loadThread(TENANT, "c1");
		// The reader leaves; an hour later another thread is refused, then c1.
		await advance(60 * 60_000);
		await actions.loadThread(TENANT, "c2");
		await actions.loadThread(TENANT, "c1");
		expect(hub.listMessages).toHaveBeenCalledTimes(3);
		// A fresh first strike waits the served 30 s, not a doubled 60 s.
		refuse = false;
		await advance(30_000);
		await actions.loadThread(TENANT, "c1");
		expect(hub.listMessages).toHaveBeenCalledTimes(4);
	});
});

/*
 * TestFlight 1157, 2026-11-17: the red "The people directory could not load."
 * sat above a people list already on screen. Every failure that says "ask
 * again later" now keeps held rows exactly like a 429 does.
 */
const server500 = () =>
	new HubError({ kind: "server", message: "x", status: 500 });
const TRANSIENT: Array<[string, () => HubError]> = [
	["429", () => limited(1_000)],
	["500", server500],
	[
		"502 edge",
		() => new HubError({ kind: "server", message: "x", status: 502 }),
	],
	[
		"503",
		() => new HubError({ kind: "unavailable", message: "x", status: 503 }),
	],
	[
		"504 edge",
		() => new HubError({ kind: "server", message: "x", status: 504 }),
	],
	["timeout", () => new HubError({ kind: "unreachable", message: "slow" })],
	[
		"messaging_unavailable",
		() =>
			new HubError({
				kind: "unavailable",
				message: "x",
				status: 502,
				code: "messaging_unavailable",
			}),
	],
];

describe("transient failures over held rows are silent (TestFlight 1157)", () => {
	it.each(TRANSIENT)(
		"%s: people and conversations stay, no alert; Catching up from the 2nd failure; silent recovery",
		async (_name, failure) => {
			let refuse = false;
			const hub = fakeHub({
				listConversations: vi.fn(async () => {
					if (refuse) throw failure();
					return { conversations: [conversation()], has_more: false };
				}),
				directory: vi.fn(async () => {
					if (refuse) throw failure();
					return { members: [person(ADA, "Ada")], unavailable_count: 0 };
				}),
			});
			const { store, actions } = bridge(hub);
			await actions.loadOrganization(TENANT);
			// The 1157 shape: rows on screen, a drawer re-open after the
			// directory's reuse window, and that re-read fails.
			await advance(DIRECTORY_TTL_MS);
			refuse = true;
			await actions.loadOrganization(TENANT, { ifStale: true });
			let org = store.getState().orgs[TENANT];
			expect(peopleStatus(org)).toEqual({
				skeleton: false,
				catchingUp: false,
				alert: false,
			});
			expect(conversationsStatus(org)).toEqual({
				skeleton: false,
				catchingUp: false,
				alert: false,
			});
			expect(org?.people).toHaveLength(1);
			expect(org?.conversations).toHaveLength(1);
			// The scheduled silent retry fails again: now "Catching up…".
			const before = vi.mocked(hub.directory).mock.calls.length;
			await advance(failure().retryAfterMs ?? RATE_LIMIT_FALLBACK_MS);
			expect(vi.mocked(hub.directory).mock.calls.length).toBe(before + 1);
			org = store.getState().orgs[TENANT];
			expect(peopleStatus(org)).toEqual({
				skeleton: false,
				catchingUp: true,
				alert: false,
			});
			expect(conversationsStatus(org).alert).toBe(false);
			expect(conversationsStatus(org).catchingUp).toBe(true);
			// It clears by itself once the hub answers.
			refuse = false;
			await advance(RATE_LIMIT_MAX_MS);
			org = store.getState().orgs[TENANT];
			expect(org?.peopleCatchingUp).toBe(false);
			expect(org?.conversationsCatchingUp).toBe(false);
			expect(org?.peopleState).toBe("ready");
		},
	);

	it("retries only the failed half even while both held results are fresh", async () => {
		const hub = fakeHub();
		const directory = vi.mocked(hub.directory);
		const conversations = vi.mocked(hub.listConversations);
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		// A named factory, not `TRANSIENT[1][1]`: an index into the table is
		// `undefined` to the type checker (TS2532) and silently becomes a
		// different failure if the table is reordered.
		directory.mockRejectedValueOnce(server500());
		directory.mockRejectedValueOnce(server500());
		await actions.loadOrganization(TENANT, { force: true });
		await advance(RATE_LIMIT_FALLBACK_MS);
		expect(directory).toHaveBeenCalledTimes(3);
		expect(conversations).toHaveBeenCalledTimes(2);
		expect(peopleStatus(store.getState().orgs[TENANT])).toEqual({
			skeleton: false,
			catchingUp: true,
			alert: false,
		});
		await advance(2 * RATE_LIMIT_FALLBACK_MS);
		expect(directory).toHaveBeenCalledTimes(4);
		expect(conversations).toHaveBeenCalledTimes(2);
		expect(store.getState().orgs[TENANT]?.peopleCatchingUp).toBe(false);
	});

	/*
	 * Review R2-1 / QA Q2: fresh rows, a transport failure, then the scheduled
	 * retry is refused with a 429. Once that Retry-After ends the timer finds
	 * the rows still fresh and drops the record instead of re-reading; the
	 * heading must drop "Catching up…" with it, and nothing may be sent while
	 * the 429 is still in force.
	 */
	it.each(["people", "conversations"] as const)(
		"%s: clears Catching up when an expired 429 yields to fresh rows",
		async (half) => {
			const hub = fakeHub();
			const read = vi.mocked(
				half === "people" ? hub.directory : hub.listConversations,
			);
			const other = vi.mocked(
				half === "people" ? hub.listConversations : hub.directory,
			);
			const status = half === "people" ? peopleStatus : conversationsStatus;
			const { store, actions } = bridge(hub);
			await actions.loadOrganization(TENANT);
			read.mockRejectedValueOnce(
				new HubError({
					kind: "unavailable",
					message: "x",
					status: 503,
					retryAfterMs: 1_000,
				}),
			);
			read.mockRejectedValueOnce(limited(1_000));
			// Inside both freshness windows, so only the refusal drives reads.
			await actions.loadOrganization(TENANT, { ifStale: true, force: true });
			const otherCalls = other.mock.calls.length;
			await advance(1_000);
			expect(read).toHaveBeenCalledTimes(3);
			expect(status(store.getState().orgs[TENANT])).toEqual({
				skeleton: false,
				catchingUp: true,
				alert: false,
			});
			// The 429 doubled the wait to 2 s: nothing goes out inside it.
			await advance(1_999);
			expect(read).toHaveBeenCalledTimes(3);
			await advance(1);
			await actions.loadOrganization(TENANT, { ifStale: true });
			// Fresh rows are reused, not re-read, and the heading is settled.
			expect(read).toHaveBeenCalledTimes(3);
			expect(other).toHaveBeenCalledTimes(otherCalls);
			const org = store.getState().orgs[TENANT];
			expect(status(org)).toEqual({
				skeleton: false,
				catchingUp: false,
				alert: false,
			});
			expect(
				half === "people" ? org?.peopleState : org?.conversationsState,
			).toBe("ready");
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it("an unmapped 4xx with the server kind is not transient", async () => {
		let refuse = false;
		const hub = fakeHub({
			directory: vi.fn(async () => {
				if (refuse)
					throw new HubError({ kind: "server", message: "x", status: 418 });
				return { members: [person(ADA, "Ada")], unavailable_count: 0 };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		refuse = true;
		await actions.loadOrganization(TENANT, { force: true });
		expect(peopleStatus(store.getState().orgs[TENANT]).alert).toBe(true);
	});

	it("404 over held rows is still the definitive error", async () => {
		let refuse = false;
		const hub = fakeHub({
			directory: vi.fn(async () => {
				if (refuse)
					throw new HubError({ kind: "not_found", message: "x", status: 404 });
				return { members: [person(ADA, "Ada")], unavailable_count: 0 };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		refuse = true;
		await actions.loadOrganization(TENANT, { force: true });
		expect(peopleStatus(store.getState().orgs[TENANT]).alert).toBe(true);
	});

	it("401 still goes to the sign-in gate, not a section error", async () => {
		let refuse = false;
		const hub = fakeHub({
			directory: vi.fn(async () => {
				if (refuse)
					throw new HubError({ kind: "sign_in", message: "x", status: 401 });
				return { members: [person(ADA, "Ada")], unavailable_count: 0 };
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		refuse = true;
		await actions.loadOrganization(TENANT, { force: true });
		expect(store.getState().gate).toBe("signed_out");
	});
});

describe("transient failures with nothing held (TestFlight 1157)", () => {
	it("first 500: skeleton and one silent retry; still failing: the red error with a Retry that re-reads", async () => {
		const hub = fakeHub({
			directory: vi.fn(async () => {
				throw new HubError({ kind: "server", message: "x", status: 500 });
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		expect(peopleStatus(store.getState().orgs[TENANT])).toEqual({
			skeleton: true,
			catchingUp: false,
			alert: false,
		});
		await advance(RATE_LIMIT_FALLBACK_MS);
		expect(hub.directory).toHaveBeenCalledTimes(2);
		expect(peopleStatus(store.getState().orgs[TENANT]).alert).toBe(true);
		// Retry inside this client's own wait still goes out (only a 429's
		// Retry-After holds a forced read back).
		await actions.loadOrganization(TENANT, { force: true });
		expect(hub.directory).toHaveBeenCalledTimes(3);
	});

	it("a cold 429 keeps #297's skeleton + Catching up, never the alert", async () => {
		const hub = fakeHub({
			directory: vi.fn(async () => {
				throw limited(1_000);
			}),
		});
		const { store, actions } = bridge(hub);
		await actions.loadOrganization(TENANT);
		await advance(1_000);
		expect(peopleStatus(store.getState().orgs[TENANT])).toEqual({
			skeleton: true,
			catchingUp: true,
			alert: false,
		});
	});
});
