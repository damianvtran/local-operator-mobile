import { describe, expect, it } from "vitest";

import {
	apiVersionSupported,
	chiefsOfStaff,
	conversationTitle,
	dmWithAgent,
	dmWithPerson,
	draftCreateInput,
	eligibility,
	isPreview,
	mergeMessages,
	notifyOf,
	organizationsFrom,
	personRowState,
	preferredOrganization,
	rowUnread,
	sections,
	senderLabel,
	showsMutedGlyph,
	threadItems,
} from "@/team-bridge/model";

import {
	ADA,
	agentDm,
	BEN,
	CY,
	conversation,
	dm,
	message,
	OTHER_TENANT,
	person,
	SELF,
	status,
	TENANT,
} from "./fixtures";

describe("eligibility ladder (desktop teamBridgeEligibility order)", () => {
	it("signed out wins over everything", () => {
		expect(eligibility({ kind: "signed_out" })).toBe("signed_out");
	});

	it("a 503 messaging_unavailable is unavailable", () => {
		expect(eligibility({ kind: "unavailable" })).toBe("unavailable");
	});

	it("an api_version this build does not implement is update_required, compared EXACTLY", () => {
		expect(
			eligibility({ kind: "ok", status: status({ api_version: "2" }) }),
		).toBe("update_required");
		expect(
			eligibility({ kind: "ok", status: status({ api_version: "0" }) }),
		).toBe("update_required");
		expect(
			eligibility({ kind: "ok", status: status({ api_version: "v1" }) }),
		).toBe("update_required");
		expect(apiVersionSupported("1")).toBe(true);
		expect(apiVersionSupported(1)).toBe(true);
	});

	it("update_required outranks plan_required (update before anything else)", () => {
		expect(
			eligibility({
				kind: "ok",
				status: status({
					api_version: "2",
					tenants: [{ tenant_id: TENANT, tenant_name: "X", eligible: false }],
				}),
			}),
		).toBe("update_required");
	});

	it("no eligible organization is plan_required", () => {
		expect(
			eligibility({
				kind: "ok",
				status: status({
					available: false,
					tenants: [
						{ tenant_id: TENANT, tenant_name: "Example Org", eligible: false },
					],
				}),
			}),
		).toBe("plan_required");
		expect(eligibility({ kind: "ok", status: status({ tenants: [] }) })).toBe(
			"plan_required",
		);
	});

	it("one eligible organization opens the surface", () => {
		expect(eligibility({ kind: "ok", status: status() })).toBeNull();
	});
});

describe("organizations", () => {
	it("lists eligible first, retained (endpoint-holding) as read-only, and drops the rest", () => {
		const orgs = organizationsFrom([
			{
				tenant_id: "t-lapsed",
				tenant_name: "Lapsed",
				eligible: false,
				endpoint: { id: "e", label: "A", state: "active" },
			},
			{
				tenant_id: "t-none",
				tenant_name: "Never",
				eligible: false,
				endpoint: null,
			},
			{ tenant_id: TENANT, tenant_name: "Example Org", eligible: true },
		]);
		expect(orgs.map((o) => [o.tenantId, o.readOnly])).toEqual([
			[TENANT, false],
			["t-lapsed", true],
		]);
	});

	it("a remembered org the account lost is not resurrected", () => {
		const orgs = organizationsFrom([
			{ tenant_id: TENANT, tenant_name: "A", eligible: true },
			{ tenant_id: OTHER_TENANT, tenant_name: "B", eligible: true },
		]);
		expect(preferredOrganization(orgs, OTHER_TENANT)?.tenantId).toBe(
			OTHER_TENANT,
		);
		expect(preferredOrganization(orgs, "gone")?.tenantId).toBe(TENANT);
		expect(preferredOrganization([], null)).toBeNull();
	});

	it("never shows a blank organization name", () => {
		expect(
			organizationsFrom([
				{ tenant_id: TENANT, tenant_name: "  ", eligible: true },
			])[0]?.name,
		).toBe("Unnamed organization");
	});
});

describe("conversation titles", () => {
	it("a DM is named for the other party, not 'Direct message'", () => {
		expect(conversationTitle(dm(ADA, "Ada"), SELF)).toBe("Ada");
	});

	it("an unnamed group lists up to three, then +N", () => {
		const members = ["Ada", "Ben", "Cy", "Di"].map((label, i) => ({
			account_id: `a${i}`,
			kind: "human" as const,
			display_label: label,
			role: "member",
			state: "active" as const,
		}));
		const group = conversation({ kind: "group", name: undefined, members });
		expect(conversationTitle(group, SELF)).toBe("Ada, Ben +2");
		expect(
			conversationTitle({ ...group, members: members.slice(0, 3) }, SELF),
		).toBe("Ada, Ben, Cy");
	});

	it("a DM whose other party was erased has no title rather than a blank one", () => {
		const erased = dm(ADA, "");
		expect(conversationTitle(erased, SELF)).toBeNull();
	});
});

describe("notify, mute glyph and badges", () => {
	it("reads the enum, falling back to the legacy boolean", () => {
		expect(notifyOf({ notify: "mention", muted: false })).toBe("mention");
		expect(notifyOf({ muted: true })).toBe("mute");
		expect(notifyOf({ muted: false })).toBe("all");
	});

	it("muted rows keep their count but lose the loud badge", () => {
		expect(rowUnread({ unread_count: 3, notify: "mute", muted: true })).toEqual(
			{ count: 3, loud: false },
		);
		expect(rowUnread({ unread_count: 3, notify: "all", muted: false })).toEqual(
			{ count: 3, loud: true },
		);
		expect(
			rowUnread({ unread_count: 0, notify: "all", muted: false }).loud,
		).toBe(false);
		expect(showsMutedGlyph({ notify: "mention", muted: false })).toBe(true);
		expect(showsMutedGlyph({ notify: "all", muted: false })).toBe(false);
	});

	it("only an explicit discoverable/non-member pair is a preview", () => {
		expect(isPreview({ discoverable: true, member: false })).toBe(true);
		expect(isPreview({ discoverable: true })).toBe(false);
		expect(isPreview({})).toBe(false);
	});
});

describe("sections", () => {
	it("built-ins lead channels in a fixed order, archived rows are dropped", () => {
		const rows = [
			conversation({ id: "c-design", name: "design" }),
			conversation({ id: "c-agents", name: "agents", builtin: "agents" }),
			conversation({ id: "g-1", kind: "group", name: "launch" }),
			conversation({ id: "c-humans", name: "humans", builtin: "humans" }),
			conversation({ id: "c-old", name: "old", status: "archived" }),
			dm(ADA, "Ada"),
		];
		const s = sections(rows);
		expect(s.channels.map((c) => c.id)).toEqual([
			"c-humans",
			"c-agents",
			"c-design",
		]);
		expect(s.groups.map((c) => c.id)).toEqual(["g-1"]);
		expect(s.directs.map((c) => c.id)).toEqual(["bcv_dm_acct_ada_0002"]);
	});
});

describe("a person's row IS their DM", () => {
	it("matches a human DM, never the person's agent DM", () => {
		const rows = [agentDm(ADA, "Aida"), dm(ADA, "Ada")];
		expect(dmWithPerson(rows, ADA, SELF)?.id).toBe("bcv_dm_acct_ada_0002");
		expect(dmWithAgent(rows, ADA)?.id).toBe("bcv_dm_agent_acct_ada_0002");
	});

	it("skips archived DMs and DMs the reader is not in", () => {
		expect(
			dmWithPerson([dm(ADA, "Ada", { status: "archived" })], ADA, SELF),
		).toBeNull();
		const foreign = dm(ADA, "Ada", {
			members: [
				{
					account_id: BEN,
					kind: "human",
					display_label: "Ben",
					role: "owner",
					state: "active",
				},
				{
					account_id: ADA,
					kind: "human",
					display_label: "Ada",
					role: "member",
					state: "active",
				},
			],
		});
		expect(dmWithPerson([foreign], ADA, SELF)).toBeNull();
	});

	it("a draft's first send creates a DM with the right member kind", () => {
		expect(
			draftCreateInput({
				kind: "person",
				tenantId: TENANT,
				accountId: ADA,
				label: "Ada",
			}),
		).toEqual({
			kind: "dm",
			agentCapable: false,
			members: [{ account_id: ADA, kind: "human", display_label: "Ada" }],
		});
		expect(
			draftCreateInput({
				kind: "agent",
				tenantId: TENANT,
				ownerAccountId: BEN,
				endpointId: "bep_ben",
				label: "Aida (Ben)",
			}),
		).toEqual({
			kind: "dm",
			agentCapable: true,
			members: [
				{
					account_id: BEN,
					kind: "agent",
					endpoint_id: "bep_ben",
					display_label: "Aida (Ben)",
				},
			],
		});
	});
});

describe("people and chiefs of staff", () => {
	it("dims a bridge-off person with the reason; paused stays openable", () => {
		expect(personRowState(person(ADA, "Ada"), SELF)).toBe("openable");
		expect(
			personRowState(person(ADA, "Ada", { bridge_state: "paused" }), SELF),
		).toBe("paused");
		expect(
			personRowState(
				person(ADA, "Ada", { bridge_enabled: false, bridge_state: "none" }),
				SELF,
			),
		).toBe("unavailable");
		// An enabled bit beside `disabled` is inconsistent and fails closed.
		expect(
			personRowState(person(ADA, "Ada", { bridge_state: "disabled" }), SELF),
		).toBe("unavailable");
		expect(personRowState(person(SELF, "Sam"), SELF)).toBe("self");
	});

	it("labels a chief of staff with its CURRENT name and its person, excluding the reader's own", () => {
		const people = [
			person(SELF, "Sam", {
				agent: { endpoint_id: "bep_self", name: "Aida", state: "active" },
			}),
			person(BEN, "Ben", {
				agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
			}),
			person(CY, "Cy", {
				agent: { endpoint_id: "bep_cy", name: "Rex", state: "disabled" },
			}),
			person(ADA, "Ada"),
		];
		const chiefs = chiefsOfStaff(people, SELF);
		expect(chiefs.map((c) => c.label)).toEqual(["Aida (Ben)"]);
	});

	it("names a sender from the live directory first, an agent as '{agent} ({person})'", () => {
		const people = [
			person(BEN, "Ben Live", {
				agent: { endpoint_id: "e", name: "Nova", state: "active" },
			}),
		];
		expect(
			senderLabel(
				{ account_id: BEN, kind: "human", display_label: "Member" },
				people,
			),
		).toBe("Ben Live");
		expect(
			senderLabel(
				{ account_id: BEN, kind: "agent", display_label: "old" },
				people,
			),
		).toBe("Nova (Ben Live)");
		expect(
			senderLabel(
				{ account_id: "gone", kind: "human", display_label: "" },
				people,
			),
		).toBe("Former member");
	});
});

describe("thread items", () => {
	const now = new Date("2026-10-21T18:00:00");

	it("adds a day divider per calendar day and folds same-sender runs within five minutes", () => {
		const items = threadItems(
			[
				message(3, ADA, new Date("2026-10-21T09:03:00").toISOString()),
				message(1, ADA, new Date("2026-10-20T09:00:00").toISOString()),
				message(2, ADA, new Date("2026-10-21T09:00:00").toISOString()),
				message(4, ADA, new Date("2026-10-21T09:20:00").toISOString()),
				message(5, BEN, new Date("2026-10-21T09:21:00").toISOString()),
			],
			now,
			"en-US",
		);
		expect(
			items.map((i) =>
				i.type === "day"
					? i.label
					: `${i.message.seq}${i.continuation ? "+" : ""}`,
			),
		).toEqual(["Yesterday", "1", "Today", "2", "3+", "4", "5"]);
	});

	it("a person and their own agent are different speakers", () => {
		const at = new Date("2026-10-21T09:00:00").toISOString();
		const items = threadItems(
			[
				message(1, ADA, at),
				message(2, ADA, at, {
					sender: { account_id: ADA, kind: "agent", display_label: "Aida" },
				}),
			],
			now,
		);
		const rows = items.filter((i) => i.type === "message");
		expect(rows.map((r) => r.type === "message" && r.continuation)).toEqual([
			false,
			false,
		]);
	});

	it("an unparseable time never glues runs and gets no divider", () => {
		const items = threadItems(
			[
				message(1, ADA, new Date("2026-10-21T09:00:00").toISOString()),
				message(2, ADA, "not a date"),
			],
			now,
		);
		expect(items.filter((i) => i.type === "day")).toHaveLength(1);
		expect(items.at(-1)).toMatchObject({
			type: "message",
			continuation: false,
		});
	});

	it("merging a page dedupes by id and keeps seq order", () => {
		const held = [
			message(3, ADA, "2026-10-21T09:00:00Z"),
			message(4, ADA, "2026-10-21T09:01:00Z"),
		];
		const merged = mergeMessages(held, [
			message(1, ADA, "2026-10-21T08:00:00Z"),
			message(3, ADA, "2026-10-21T09:00:00Z"),
		]);
		expect(merged.map((m) => m.seq)).toEqual([1, 3, 4]);
	});
});
