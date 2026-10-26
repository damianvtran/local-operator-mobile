import { describe, expect, it } from "vitest";

import { directorySchema } from "@/team-bridge/contract";
import {
	dmSubject,
	localTime,
	profileCard,
	profileMessageTarget,
	senderSubject,
	subjectMarkLabel,
} from "@/team-bridge/profile";

import { ADA, agentDm, BEN, CY, dm, person, SELF, TENANT } from "./fixtures";

/* 14:05 UTC: 14:05 in London (BST ended 2026-10-25), 10:05 in New York (EDT until 1 Nov). */
const NOW = new Date("2026-10-26T14:05:00Z");

const ben = person(BEN, "Ben", {
	agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
	profile: {
		title: "Founder",
		description: "Runs the org.",
		timezone: "America/New_York",
	},
});

describe("local time", () => {
	it("formats the person's own zone, not the reader's", () => {
		expect(localTime("Europe/London", NOW, "en-GB")).toBe("14:05");
		expect(localTime("America/New_York", NOW, "en-US")).toBe("10:05 AM");
	});

	it("is null for a missing, blank or invalid zone rather than the reader's clock", () => {
		expect(localTime(undefined, NOW)).toBeNull();
		expect(localTime("  ", NOW)).toBeNull();
		expect(localTime("Mars/Olympus_Mons", NOW)).toBeNull();
		expect(localTime("not a zone", NOW)).toBeNull();
	});
});

describe("profile card", () => {
	it("a person: their resolved label, Person badge, title, description, local time", () => {
		const card = profileCard({ person: ben, agent: false }, NOW, "en-US");
		expect(card).toEqual({
			name: "Ben",
			markLabel: "Ben",
			kind: "human",
			badge: "Person",
			owner: null,
			detailsLabel: null,
			title: "Founder",
			description: "Runs the org.",
			localTime: "10:05 AM",
		});
	});

	it("an agent: 'Name (Owner)', Agent badge and whose agent it is", () => {
		const card = profileCard({ person: ben, agent: true }, NOW, "en-US");
		expect(card.name).toBe("Aida (Ben)");
		expect(card.markLabel).toBe("Aida");
		expect(card.kind).toBe("agent");
		expect(card.badge).toBe("Agent");
		expect(card.owner).toBe("Ben’s chief of staff");
		expect(card.detailsLabel).toBe("About Ben");
	});

	it("an agent's initials come from its own name, never the 'Name (Owner)' label", () => {
		expect(subjectMarkLabel({ person: ben, agent: true })).toBe("Aida");
		expect(subjectMarkLabel({ person: ben, agent: false })).toBe("Ben");
	});

	it("an agent with a blank name still names its owner", () => {
		const blank = person(BEN, "Ben", {
			agent: { endpoint_id: "bep_ben", name: "  ", state: "active" },
		});
		expect(profileCard({ person: blank, agent: true }, NOW).name).toBe(
			"Chief of staff (Ben)",
		);
	});

	it("absent details stay absent; an old hub's row still makes a card", () => {
		const card = profileCard({ person: person(CY, "Cy"), agent: false }, NOW);
		expect(card.title).toBeNull();
		expect(card.description).toBeNull();
		expect(card.localTime).toBeNull();
	});

	it("never carries pronouns, even when the hub sent them", () => {
		const row = directorySchema.parse({
			members: [
				{
					account_id: ADA,
					display_label: "Ada",
					role: "member",
					bridge_enabled: true,
					bridge_state: "active",
					profile: { pronouns: "she/her", title: "Engineer" },
				},
			],
		}).members[0];
		if (!row) throw new Error("row");
		const card = profileCard({ person: row, agent: false }, NOW);
		expect(JSON.stringify(card)).not.toContain("she/her");
		expect(Object.keys(card)).not.toContain("pronouns");
	});
});

describe("profile Message target", () => {
	it("opens an existing DM with the person", () => {
		const existing = dm(ADA, "Ada");
		expect(
			profileMessageTarget(
				{ person: person(ADA, "Ada"), agent: false },
				[existing],
				SELF,
				TENANT,
			),
		).toEqual({
			kind: "conversation",
			tenantId: existing.tenant_id,
			conversationId: existing.id,
		});
	});

	it("drafts a DM through the existing first-send path when there is none", () => {
		expect(
			profileMessageTarget(
				{ person: person(ADA, "Ada"), agent: false },
				[],
				SELF,
				TENANT,
			),
		).toEqual({
			kind: "person",
			tenantId: TENANT,
			accountId: ADA,
			label: "Ada",
		});
		expect(
			profileMessageTarget({ person: ben, agent: true }, [], SELF, TENANT),
		).toEqual({
			kind: "agent",
			tenantId: TENANT,
			ownerAccountId: BEN,
			endpointId: "bep_ben",
			label: "Aida (Ben)",
		});
	});

	it("opens the existing agent DM", () => {
		const existing = agentDm(BEN, "Aida (Ben)");
		expect(
			profileMessageTarget(
				{ person: ben, agent: true },
				[existing],
				SELF,
				TENANT,
			),
		).toMatchObject({ kind: "conversation", conversationId: existing.id });
	});

	it("offers nothing for yourself, a bridge that is off, or a disabled agent", () => {
		expect(
			profileMessageTarget(
				{ person: person(SELF, "Sam"), agent: false },
				[],
				SELF,
				TENANT,
			),
		).toBeNull();
		expect(
			profileMessageTarget(
				{
					person: person(CY, "Cy", {
						bridge_enabled: false,
						bridge_state: "none",
					}),
					agent: false,
				},
				[],
				SELF,
				TENANT,
			),
		).toBeNull();
		expect(
			profileMessageTarget(
				{
					person: person(BEN, "Ben", {
						agent: { endpoint_id: "bep_ben", name: "Aida", state: "disabled" },
					}),
					agent: true,
				},
				[],
				SELF,
				TENANT,
			),
		).toBeNull();
	});
});

describe("who a row or message is about", () => {
	const people = [person(SELF, "Sam"), person(ADA, "Ada"), ben];

	it("a message sender resolves to the directory row; an agent sender to its owner's", () => {
		expect(
			senderSubject({ account_id: ADA, kind: "human" }, people),
		).toMatchObject({ agent: false, person: { account_id: ADA } });
		expect(
			senderSubject({ account_id: BEN, kind: "agent" }, people),
		).toMatchObject({ agent: true, person: { account_id: BEN } });
		expect(
			senderSubject({ account_id: "acct_gone", kind: "human" }, people),
		).toBeNull();
	});

	it("a DM row is about the other party; channels are about no one", () => {
		expect(dmSubject(dm(ADA, "Ada"), people, SELF)).toMatchObject({
			agent: false,
			person: { account_id: ADA },
		});
		expect(dmSubject(agentDm(BEN, "Aida (Ben)"), people, SELF)).toMatchObject({
			agent: true,
			person: { account_id: BEN },
		});
	});
});
