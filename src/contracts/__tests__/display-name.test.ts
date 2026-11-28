import { describe, expect, it } from "vitest";

import { DISPLAY_NAME_MAX_CODE_POINTS, displayName } from "../display-name";
import { parsePayload } from "../parse";

const DIGEST = `sha256:${"a".repeat(64)}`;

describe("displayName: a host-supplied org name made safe to put in a question", () => {
	it("leaves an ordinary name byte-identical", () => {
		for (const name of [
			"Example Org",
			"Acme, Inc.",
			"Éclair & Fils",
			"株式会社",
		])
			expect(displayName(name)).toBe(name);
	});

	it("reads a newline as a space and removes bidi controls (security S-4)", () => {
		expect(displayName("Acme\u202E\n\nNothing leaves your computer.\n")).toBe(
			"Acme Nothing leaves your computer.",
		);
		expect(displayName("A\u2066B\u2069C\u200E\u200F\u061C")).toBe("ABC");
		expect(displayName("A\u200BB\u0007C\u00ADD")).toBe("ABCD");
		expect(displayName("A\u2028B\u2029C\u0085D")).toBe("A B C D");
	});

	it("keeps ZWNJ and ZWJ, which spell Urdu/Persian words and emoji sequences", () => {
		expect(displayName("می\u200Cخواهم")).toBe("می\u200Cخواهم");
		expect(displayName("\u{1F469}\u200D\u{1F4BB} Team")).toBe(
			"\u{1F469}\u200D\u{1F4BB} Team",
		);
	});

	it("caps a forged paragraph at the host's 80 code points, never splitting a pair", () => {
		const out = displayName(`${"x".repeat(500)}`);
		expect(Array.from(out)).toHaveLength(DISPLAY_NAME_MAX_CODE_POINTS);
		expect(out.endsWith("…")).toBe(true);
		const emoji = displayName("\u{1F600}".repeat(200));
		expect(Array.from(emoji)).toHaveLength(DISPLAY_NAME_MAX_CODE_POINTS);
		expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
	});

	it("an empty or invisible-only name becomes the empty string", () => {
		expect(displayName("\u200B\u202E \n")).toBe("");
	});
});

describe("the Guard wire schemas apply it on parse", () => {
	const hostile = "Acme\u202E\n\nNothing leaves your computer.\n";
	const clean = "Acme Nothing leaves your computer.";

	it("the consent card's org (the question's subject)", () => {
		const card = parsePayload("guardConsentCard", {
			approval_id: "req_1",
			state: "requested",
			tenant: "t1",
			org: hostile,
			reason: "new_org",
			widening: false,
			asked_scopes: ["decisions"],
			request_digest: DIGEST,
			disclosure_digest: DIGEST,
			signable: true,
		});
		expect(card.org).toBe(clean);
		expect(card.tenant).toBe("t1");
	});

	it("each status org, the non-Team org, and the report/notice/insight rows", () => {
		const status = parsePayload("guardStatus", {
			mode: "orgs",
			team_url: "https://console.radienthq.com/dashboard/team",
			orgs: [
				{
					tenant: "t1",
					org: hostile,
					role: "member",
					state: "waiting",
					can_revoke: false,
					can_share_again: false,
				},
			],
			reports: [
				{ id: "r", tenant: "t1", org: hostile, kind: "k", created_at: 1 },
			],
			notices: [
				{ id: 1, tenant: "t1", kind: "k", org: hostile, scopes: [], at: 1 },
			],
			insights: [{ tenant: "t1", org: hostile, url: "u" }],
			non_team: { trial_days: null, org: hostile, url: "u" },
		});
		expect(status.orgs[0]?.org).toBe(clean);
		expect(status.reports[0]?.org).toBe(clean);
		expect(status.notices[0]?.org).toBe(clean);
		expect(status.insights[0]?.org).toBe(clean);
		expect(status.non_team?.org).toBe(clean);
	});
});
