import { afterEach, describe, expect, it } from "vitest";
import {
	renderFor,
	resetLocaleSource,
	SHIPPED_LOCALES,
	setLocaleSource,
} from "@/i18n";
import { chiefsOfStaff, senderLabel } from "@/team-bridge/model";
import {
	localTime,
	profileCard,
	profileMessageTarget,
	subjectMarkLabel,
} from "@/team-bridge/profile";
import { ADA, person, SELF, TENANT } from "./fixtures";

const now = new Date("2026-11-01T12:30:00Z");
const owner = person(ADA, "Ada Atlas", {
	profile: {
		title: "Fixture job title",
		description: "Fixture user description",
		timezone: "UTC",
	},
	agent: { endpoint_id: "bep_ada", name: "Nova", state: "active" },
});

afterEach(() => resetLocaleSource());

describe("profile presentation follows the current catalogue", () => {
	it.each(SHIPPED_LOCALES)(
		"keeps names, owner attribution and protocol identity distinct in %s",
		(locale) => {
			setLocaleSource(() => locale);
			const subject = { person: owner, agent: true };
			const card = profileCard(subject, now);
			expect(card.name).toBe(
				renderFor(
					"mobile.team_bridge.profile.name_with_owner",
					{ agent: "Nova", owner: "Ada Atlas" },
					locale,
				),
			);
			expect(card.badge).toBe(
				renderFor("mobile.team_bridge.profile.badge_agent", {}, locale),
			);
			expect(card.owner).toBe(
				renderFor("mobile.team_bridge.profile.chief", {}, locale),
			);
			expect(card.detailsLabel).toBe(
				renderFor(
					"mobile.team_bridge.profile.about_owner",
					{ owner: "Ada Atlas" },
					locale,
				),
			);
			expect(card.localTime).toBe(localTime("UTC", now, locale));
			// User-authored profile content is data, not catalogue prose.
			expect(card.title).toBe("Fixture job title");
			expect(card.description).toBe("Fixture user description");
			expect(chiefsOfStaff([owner], SELF)[0]?.label).toBe(card.name);
			expect(
				senderLabel({ account_id: ADA, kind: "agent", display_label: "Nova" }, [
					owner,
				]),
			).toBe(card.name);
			expect(profileCard({ person: owner, agent: false }, now).badge).toBe(
				renderFor("mobile.team_bridge.profile.badge_person", {}, locale),
			);
			expect(profileMessageTarget(subject, [], SELF, TENANT)).toMatchObject({
				kind: "agent",
				ownerAccountId: ADA,
				endpointId: "bep_ada",
			});
		},
	);
	it.each(SHIPPED_LOCALES)(
		"localizes empty-name identity fallbacks in %s without altering the row",
		(locale) => {
			setLocaleSource(() => locale);
			const unnamed = person(ADA, "", {
				agent: { endpoint_id: "bep_ada", name: "", state: "active" },
			});
			const before = JSON.stringify(unnamed);
			const subject = { person: unnamed, agent: true };
			const card = profileCard(subject, now);
			expect(subjectMarkLabel(subject)).toBe(
				renderFor("mobile.team_bridge.profile.chief", {}, locale),
			);
			expect(card.name).toBe(
				renderFor(
					"mobile.team_bridge.profile.name_with_owner",
					{
						agent: renderFor("mobile.team_bridge.profile.chief", {}, locale),
						owner: renderFor(
							"mobile.team_bridge.profile.former_member",
							{},
							locale,
						),
					},
					locale,
				),
			);
			expect(chiefsOfStaff([unnamed], SELF)[0]?.label).toBe(card.name);
			expect(JSON.stringify(unnamed)).toBe(before);
		},
	);
	it("does not capture English at import time or keep an old badge after a locale switch", () => {
		setLocaleSource(() => "en");
		const english = profileCard({ person: owner, agent: false }, now);
		setLocaleSource(() => "fr");
		const french = profileCard({ person: owner, agent: false }, now);
		expect(french.badge).toBe(
			renderFor("mobile.team_bridge.profile.badge_person", {}, "fr"),
		);
		expect(french.badge).not.toBe(english.badge);
		expect(french.name).toBe(english.name);
	});
});
