import { describe, expect, it } from "vitest";
import { CommunityError } from "@/community/client";
import type { Bootstrap, CommunityMessage } from "@/community/contract";
import {
	attemptStateFromError,
	communityGroup,
	communityUnread,
	expiryLeft,
	guidelinesStep,
	hoursLeft,
	isPlaceholderName,
	joinedMonthLabel,
	mergeMessages,
	openingRoute,
	openingSelection,
	pendingApprovals,
	postingBlock,
	replaceNewestWindow,
	retryKeepsKey,
	startsGroup,
} from "@/community/model";

const org = (tenantId: string, invited = false) => ({ tenantId, invited });
const community = (communityId: string, unread = 0) => ({
	communityId,
	name: communityId,
	unread,
	readOnly: false,
});

describe("opening selection (Amendment A §3)", () => {
	it("a pending private invitation wins even over this session's community", () => {
		expect(
			openingSelection({
				organizations: [org("minerva"), org("acme", true)],
				communities: [community("loc")],
				session: { kind: "community", communityId: "loc" },
			}),
		).toEqual({ kind: "private", tenantId: "acme" });
	});

	it("this session's pick stands until restart (memory only)", () => {
		expect(
			openingSelection({
				organizations: [org("minerva")],
				communities: [community("loc")],
				session: { kind: "community", communityId: "loc" },
				defaultTenantId: "minerva",
			}),
		).toEqual({ kind: "community", communityId: "loc" });
	});

	it("without a session pick, the default private org opens, never the community", () => {
		expect(
			openingSelection({
				organizations: [org("acme"), org("minerva")],
				communities: [community("loc")],
				defaultTenantId: "minerva",
			}),
		).toEqual({ kind: "private", tenantId: "minerva" });
		expect(
			openingSelection({
				organizations: [org("acme")],
				communities: [community("loc")],
			}),
		).toEqual({ kind: "private", tenantId: "acme" });
	});

	it("a stale session pick (left the community) falls through to the rules", () => {
		expect(
			openingSelection({
				organizations: [org("acme")],
				communities: [],
				session: { kind: "community", communityId: "gone" },
			}),
		).toEqual({ kind: "private", tenantId: "acme" });
	});

	it("a community is the launch default only with no private org at all", () => {
		expect(
			openingSelection({ organizations: [], communities: [community("loc")] }),
		).toEqual({ kind: "community", communityId: "loc" });
		expect(openingSelection({ organizations: [], communities: [] })).toBeNull();
	});
});

describe("Communities group", () => {
	it("is drawn with the flag on even with nothing joined (Browse stays reachable)", () => {
		expect(communityGroup({ communities: [], enabled: true }).show).toBe(true);
		expect(communityGroup({ communities: [], enabled: false }).show).toBe(
			false,
		);
	});

	it("draws nothing community-shaped with the flag off, even for a member", () => {
		expect(
			communityGroup({ communities: [community("loc")], enabled: false }).show,
		).toBe(false);
	});

	it("adds search past six joined, decided on the joined count", () => {
		const many = Array.from({ length: 7 }, (_, i) => community(`c${i}`));
		const group = communityGroup({
			communities: many,
			enabled: true,
			query: "c3",
		});
		expect(group.search).toBe(true);
		expect(group.rows.map((r) => r.communityId)).toEqual(["c3"]);
	});

	it("a community's unread is its own: channels it sits in plus DMs", () => {
		expect(
			communityUnread(
				[
					{ unread: 3, member: true },
					{ unread: 9, member: false },
					{ unread: 1 },
				],
				[{ unread: 2 }],
			),
		).toBe(6);
	});
});

describe("guidelines", () => {
	const boot = (
		membership: Bootstrap["membership"],
		state: "active" | "read_only" = "active",
	): Bootstrap => ({
		community_id: "loc",
		community: {
			id: "loc",
			slug: "local-operator",
			name: "Local Operator Community",
			state,
		},
		guidelines: { version: "2026-11", text: "Be kind." },
		membership,
	});
	it("non-member: join; stale acceptance: re-accept; current: none", () => {
		expect(guidelinesStep(boot(null))).toBe("join");
		expect(
			guidelinesStep(
				boot({
					status: "active",
					guidelines_version: "2026-10",
					accepted_at: "x",
				}),
			),
		).toBe("reaccept");
		expect(
			guidelinesStep(
				boot({
					status: "active",
					guidelines_version: "2026-11",
					accepted_at: "x",
				}),
			),
		).toBe("none");
	});
	it("a read-only community cannot be joined", () => {
		expect(guidelinesStep(boot(null, "read_only"))).toBe("closed");
	});
});

describe("posting", () => {
	it("staff-only channels refuse members but not moderators", () => {
		expect(
			postingBlock(
				{ posting: "staff" },
				{ role: "member", readOnlyCommunity: false },
			),
		).toBe("staff_only");
		expect(
			postingBlock(
				{ posting: "staff" },
				{ role: "moderator", readOnlyCommunity: false },
			),
		).toBeNull();
		expect(
			postingBlock(
				{ locked: true },
				{ role: "staff", readOnlyCommunity: false },
			),
		).toBe("locked");
		expect(postingBlock({}, { role: "member", readOnlyCommunity: true })).toBe(
			"read_only",
		);
	});
});

describe("history", () => {
	const m = (id: string, seq: number, revision = 0): CommunityMessage => ({
		id,
		conversation_id: "c",
		seq,
		revision,
		author: { kind: "human", display_name: "Ada" },
		text: `${id}@${revision}`,
		created_at: "2026-11-18T00:00:00Z",
	});
	it("merges newest-first pages oldest-first and keeps the newest revision", () => {
		const merged = mergeMessages(
			[m("a", 1), m("b", 2)],
			[m("c", 3), m("b", 2, 1)],
		);
		expect(merged.map((x) => x.text)).toEqual(["a@0", "b@1", "c@0"]);
	});
});

describe("attempt outcomes (sender only)", () => {
	const now = 1_000_000;
	it("refused keeps category and reference; never retried under the same key", () => {
		const state = attemptStateFromError(
			new CommunityError({
				kind: "refused",
				refusal: {
					status: "refused",
					category: "harassment_or_abuse",
					reference: "MOD-AAAA-BBBB",
				},
			}),
			now,
		);
		expect(state).toEqual({
			kind: "refused",
			category: "harassment_or_abuse",
			reference: "MOD-AAAA-BBBB",
		});
		expect(retryKeepsKey(state)).toBe(false);
	});
	it("a limit carries when Retry may run and keeps the key", () => {
		const state = attemptStateFromError(
			new CommunityError({ kind: "rate_limited", retryAfterMs: 5_000 }),
			now,
		);
		expect(state).toEqual({ kind: "limited", retryAt: now + 5_000 });
		expect(retryKeepsKey(state)).toBe(true);
	});
	it.each([
		["moderation_unavailable", "unavailable"],
		["auth_unavailable", "unavailable"],
		["images_unavailable", "images_unavailable"],
		["guidelines_changed", "guidelines"],
		["forbidden", "forbidden"],
		["unreachable", "failed"],
	] as const)("%s → %s", (kind, expected) => {
		expect(attemptStateFromError(new CommunityError({ kind }), now).kind).toBe(
			expected,
		);
	});
});

describe("agent approvals", () => {
	const stub = (
		id: string,
		state: "pending" | "declined",
		expiresInH: number,
	) => ({
		approval_id: id,
		target_kind: "channel" as const,
		channel_id: "feedback",
		state,
		created_at: "x",
		expires_at: new Date(
			Date.UTC(2026, 10, 18) + expiresInH * 3_600_000,
		).toISOString(),
	});
	const now = Date.UTC(2026, 10, 18);
	it("lists only pending, unexpired stubs, soonest first", () => {
		const list = pendingApprovals(
			[
				stub("late", "pending", 20),
				stub("done", "declined", 5),
				stub("soon", "pending", 2),
				stub("old", "pending", -1),
			],
			now,
		);
		expect(list.map((a) => a.approval_id)).toEqual(["soon", "late"]);
	});
	it("rounds hours up and never shows zero while pending", () => {
		expect(hoursLeft(stub("a", "pending", 24).expires_at, now)).toBe(24);
		expect(hoursLeft(new Date(now + 60_000).toISOString(), now)).toBe(1);
	});
});

/* ---------------------------------------------------------------------------
 * Review round 1 remediation (R1-2, R1-3, R1-7, R1-8; design D1, D6, D9).
 * ------------------------------------------------------------------------- */

const msg = (
	id: string,
	seq: number,
	extra: Partial<CommunityMessage> = {},
): CommunityMessage => ({
	id,
	conversation_id: "c",
	seq,
	author: { kind: "human", public_id: "p1", display_name: "Ada" },
	text: id,
	created_at: "2026-11-18T10:00:00Z",
	...extra,
});

describe("a newest-page refresh (R1-2)", () => {
	it("drops a message the server stopped serving (the reviewer's repro)", () => {
		/* Before: mergeMessages([m1, m2], [m1]) kept m2 for the whole session. */
		expect(
			mergeMessages([msg("m1", 1), msg("m2", 2)], [msg("m1", 1)]).map(
				(m) => m.id,
			),
		).toEqual(["m1", "m2"]);
		const next = replaceNewestWindow(
			[msg("m1", 1), msg("m2", 2)],
			[msg("m1", 1)],
			true,
		);
		expect(next.messages.map((m) => m.id)).toEqual(["m1"]);
		expect(next.keptOlder).toBe(false);
	});

	it("replaces only the window the page covers and keeps older pages", () => {
		const held = [msg("m1", 1), msg("m2", 2), msg("m3", 3), msg("m4", 4)];
		/* m3 deleted; m5 new; the page starts at seq 2 and has older history. */
		const next = replaceNewestWindow(
			held,
			[msg("m5", 5), msg("m4", 4), msg("m2", 2)],
			false,
		);
		expect(next.messages.map((m) => m.id)).toEqual(["m1", "m2", "m4", "m5"]);
		expect(next.keptOlder).toBe(true);
	});

	it("an empty newest page is an empty history", () => {
		expect(replaceNewestWindow([msg("m1", 1)], [], false).messages).toEqual([]);
	});

	it("the page's revision wins inside its window", () => {
		const next = replaceNewestWindow(
			[msg("m1", 1, { revision: 3, text: "old" })],
			[msg("m1", 1, { revision: 2, text: "served" })],
			true,
		);
		expect(next.messages[0]?.text).toBe("served");
	});
});

describe("opening order matches the desktop's resolveDefaultSelection (R1-3)", () => {
	it("this session's community outranks the default org (Amendment A §3 rule 2)", () => {
		expect(
			openingSelection({
				organizations: [org("acme"), org("home")],
				communities: [community("loc")],
				session: { kind: "community", communityId: "loc" },
				defaultTenantId: "home",
			}),
		).toEqual({ kind: "community", communityId: "loc" });
	});

	it("default org, then the only org, then the durable last-used, then the first", () => {
		const orgs = [org("acme"), org("home"), org("zeta")];
		expect(
			openingSelection({
				organizations: orgs,
				communities: [],
				defaultTenantId: "home",
				stored: "zeta",
			}),
		).toEqual({ kind: "private", tenantId: "home" });
		expect(
			openingSelection({
				organizations: [org("solo")],
				communities: [],
				stored: "gone",
			}),
		).toEqual({ kind: "private", tenantId: "solo" });
		expect(
			openingSelection({
				organizations: orgs,
				communities: [],
				stored: "zeta",
			}),
		).toEqual({ kind: "private", tenantId: "zeta" });
		expect(
			openingSelection({
				organizations: orgs,
				communities: [],
				stored: "gone",
			}),
		).toEqual({ kind: "private", tenantId: "acme" });
	});

	it("a stored value never brings back a community", () => {
		expect(
			openingSelection({
				organizations: [org("acme"), org("b")],
				communities: [community("loc")],
				stored: "loc",
			}),
		).toEqual({ kind: "private", tenantId: "acme" });
	});
});

describe("the Team Bridge list's opening route (R1-3)", () => {
	const base = {
		organizations: [org("acme")],
		communitiesState: "ready" as const,
		communities: [community("loc")],
	};
	it("waits for the hub status and for the joined-communities read", () => {
		expect(openingRoute({ ...base, gate: "checking" })).toEqual({
			kind: "wait",
		});
		expect(
			openingRoute({ ...base, gate: "open", communitiesState: "loading" }),
		).toEqual({ kind: "wait" });
		expect(
			openingRoute({ ...base, gate: "open", communitiesState: "idle" }),
		).toEqual({ kind: "wait" });
	});

	it("rule 7: no private org lands in the joined community, not the no-plan gate", () => {
		expect(
			openingRoute({ ...base, gate: "plan_required", organizations: [] }),
		).toEqual({ kind: "community", communityId: "loc" });
	});

	it("rule 2: this session's community wins over a private org", () => {
		expect(
			openingRoute({
				...base,
				gate: "open",
				session: { kind: "community", communityId: "loc" },
			}),
		).toEqual({ kind: "community", communityId: "loc" });
	});

	it("a private org with no session community stays on the list", () => {
		expect(openingRoute({ ...base, gate: "open" })).toEqual({ kind: "stay" });
	});

	it("a session community no longer joined, a failed read, or an error gate stays", () => {
		expect(
			openingRoute({
				...base,
				gate: "open",
				communities: [],
				session: { kind: "community", communityId: "loc" },
			}),
		).toEqual({ kind: "stay" });
		expect(
			openingRoute({
				...base,
				gate: "plan_required",
				organizations: [],
				communitiesState: "error",
			}),
		).toEqual({ kind: "stay" });
		expect(
			openingRoute({
				...base,
				gate: "signed_out",
				session: { kind: "community", communityId: "loc" },
			}),
		).toEqual({ kind: "stay" });
	});
});

describe("a request the server can never accept (R1-8)", () => {
	it("400 and 413 are invalid, and invalid has no same-key Retry", () => {
		for (const kind of ["invalid", "too_large"] as const) {
			const state = attemptStateFromError(new CommunityError({ kind }), 0);
			expect(state).toEqual({ kind: "invalid" });
			expect(retryKeepsKey(state)).toBe(false);
		}
	});
});

describe("expiry units (D6)", () => {
	const now = Date.parse("2026-11-18T00:00:00Z");
	it("hours up to 48, whole days beyond", () => {
		expect(expiryLeft("2026-11-18T05:00:00Z", now)).toEqual({
			unit: "hours",
			count: 5,
		});
		expect(expiryLeft("2026-11-20T00:00:00Z", now)).toEqual({
			unit: "hours",
			count: 48,
		});
		/* A DM request's 7 days read as "7 days", not "168 h". */
		expect(expiryLeft("2026-11-25T00:00:00Z", now)).toEqual({
			unit: "days",
			count: 7,
		});
		expect(expiryLeft("2026-11-20T01:00:00Z", now)).toEqual({
			unit: "days",
			count: 3,
		});
	});
});

describe("joined month in the app locale (R1-7)", () => {
	it("names the month in the given locale, never raw YYYY-MM", () => {
		expect(joinedMonthLabel("2026-11", "en")).toBe("November 2026");
		expect(joinedMonthLabel("2026-11", "ru")).toMatch(/ноябр/);
		expect(joinedMonthLabel("2026-11", "fr")).toBe("novembre 2026");
	});
	it("is not shifted by the device timezone at a month boundary", () => {
		expect(joinedMonthLabel("2026-01", "en")).toBe("January 2026");
	});
	it("shows an unreadable value as served", () => {
		expect(joinedMonthLabel("2026-13", "en")).toBe("2026-13");
		expect(joinedMonthLabel("soon", "en")).toBe("soon");
	});
});

describe("member avatars and author runs (D1, D9)", () => {
	it("recognises only the server's pending-name placeholder", () => {
		expect(isPlaceholderName("New member · 1164")).toBe(true);
		expect(isPlaceholderName("New member · ")).toBe(false);
		expect(isPlaceholderName("New Member Fan")).toBe(false);
		expect(isPlaceholderName("Ada Lovelace")).toBe(false);
	});

	it("a run of one author within five minutes shares one header", () => {
		const a = msg("a", 1);
		const b = msg("b", 2, { created_at: "2026-11-18T10:04:00Z" });
		const c = msg("c", 3, { created_at: "2026-11-18T10:10:00Z" });
		const other = msg("d", 4, {
			created_at: "2026-11-18T10:10:30Z",
			author: { kind: "human", public_id: "p2", display_name: "Bo" },
		});
		expect(startsGroup(undefined, a)).toBe(true);
		expect(startsGroup(a, b)).toBe(false);
		expect(startsGroup(b, c)).toBe(true);
		expect(startsGroup(c, other)).toBe(true);
	});

	it("an agent post opens its own run even under its owner's id", () => {
		const human = msg("a", 1);
		const agent = msg("b", 2, {
			author: { kind: "agent", public_id: "p1", display_name: "Ada's agent" },
		});
		expect(startsGroup(human, agent)).toBe(true);
	});
});
