import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProfileDetails } from "@/features/team-bridge/profile-details";
import { directorySchema } from "@/team-bridge/contract";
import { profileCard } from "@/team-bridge/profile";
import { Avatar } from "@/ui/components/avatar";

/**
 * What the card and the avatar actually put on screen, rendered through the
 * same react-native-web the web export ships (`vitest.config.ts` aliases
 * `react-native` to it). Not a native render: it proves the markup, not pixels.
 */

const NOW = new Date("2026-10-26T14:05:00Z");

const row = directorySchema.parse({
	members: [
		{
			account_id: "acct_ada_0002",
			display_label: "Ada",
			role: "member",
			bridge_enabled: true,
			bridge_state: "active",
			profile: {
				display_name: "Ada",
				title: "Staff engineer",
				description: "Builds the mobile client.",
				pronouns: "she/her",
				timezone: "Europe/London",
			},
		},
	],
}).members[0];

describe("profile details on the web target", () => {
	it("renders title, description, badge and local time, and never pronouns", () => {
		if (!row) throw new Error("row");
		const card = profileCard({ person: row, agent: false }, NOW, "en-GB");
		const html = renderToStaticMarkup(h(ProfileDetails, { card, photo: null }));
		expect(html).toContain("Staff engineer");
		expect(html).toContain("Builds the mobile client.");
		expect(html).toContain("Person");
		expect(html).toContain("Local time 14:05");
		expect(html).not.toContain("she/her");
		expect(html.toLowerCase()).not.toContain("pronoun");
	});

	it("an agent card names its owner", () => {
		if (!row) throw new Error("row");
		const agentRow = {
			...row,
			agent: { endpoint_id: "bep_ada", name: "Nova", state: "active" },
		};
		const card = profileCard({ person: agentRow, agent: true }, NOW);
		const html = renderToStaticMarkup(h(ProfileDetails, { card, photo: null }));
		expect(card.name).toBe("Nova (Ada)");
		expect(html).toContain("Agent");
		expect(html).toContain("Ada’s chief of staff");
	});

	it("D1: the full, long name is the body's heading, not left to the one-line title", () => {
		if (!row) throw new Error("row");
		const long = {
			...row,
			display_label: "Maximiliana Konstantinopoulou-Whitfield-Abernathy",
		};
		const card = profileCard({ person: long, agent: false }, NOW);
		const html = renderToStaticMarkup(h(ProfileDetails, { card, photo: null }));
		expect(html).toContain("Maximiliana Konstantinopoulou-Whitfield-Abernathy");
		expect(html).toContain('data-testid="team-bridge-profile-name"');
		// Name, then the job title, then the badge: the desktop's order.
		const at = (text: string) => html.indexOf(text);
		expect(at("Maximiliana")).toBeLessThan(at("Staff engineer"));
		expect(at("Staff engineer")).toBeLessThan(at(">Person<"));
	});

	it("D4: the local time line carries the clock glyph, hidden from assistive tech", () => {
		if (!row) throw new Error("row");
		const card = profileCard({ person: row, agent: false }, NOW, "en-GB");
		const html = renderToStaticMarkup(
			h(ProfileDetails, {
				card,
				photo: null,
				clock: h("span", { "data-glyph": "clock" }),
			}),
		);
		expect(html).toContain('data-glyph="clock"');
		expect(html.indexOf('data-glyph="clock"')).toBeLessThan(
			html.indexOf("Local time"),
		);
	});

	it("D5: an agent card groups the owner's details under the owner", () => {
		if (!row) throw new Error("row");
		const agentRow = {
			...row,
			agent: { endpoint_id: "bep_ada", name: "Nova", state: "active" },
		};
		const card = profileCard({ person: agentRow, agent: true }, NOW);
		const html = renderToStaticMarkup(h(ProfileDetails, { card, photo: null }));
		expect(html.indexOf("About Ada")).toBeGreaterThan(-1);
		expect(html.indexOf("About Ada")).toBeLessThan(
			html.indexOf("Staff engineer"),
		);
		expect(html.indexOf(">Agent<")).toBeLessThan(html.indexOf("About Ada"));
	});

	it("an invalid timezone shows no clock line at all", () => {
		if (!row) throw new Error("row");
		const broken = {
			...row,
			profile: { ...row.profile, timezone: "Mars/Olympus_Mons" },
		};
		const card = profileCard({ person: broken, agent: false }, NOW);
		const html = renderToStaticMarkup(h(ProfileDetails, { card, photo: null }));
		expect(html).not.toContain("Local time");
	});
});

describe("avatar primitive", () => {
	it("no photo: initials only, no image element", () => {
		const html = renderToStaticMarkup(h(Avatar, { initials: "AD" }));
		expect(html).toContain("AD");
		expect(html).not.toContain("data:image");
	});

	it("with a photo: the image over the initials, which stay as the fallback", () => {
		const uri = "data:image/png;base64,iVBORw0KGgo=";
		const html = renderToStaticMarkup(
			h(Avatar, { initials: "AD", imageUri: uri }),
		);
		expect(html).toContain("AD");
		expect(html).toContain(uri);
	});
});
