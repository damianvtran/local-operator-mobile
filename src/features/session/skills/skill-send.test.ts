import { describe, expect, it } from "vitest";
import { receiptForError } from "@/features/session/composer";
import { RelayError } from "@/relay";
import {
	SKILLS_TOO_LARGE,
	skillsTooLargeMessage,
	skippedSkillsNotice,
	wantsSkillExpansion,
} from "./skill-send";

const SENT_WITHOUT = /^Sent without/;
const REMOVE_ONE = /Remove one skill/;

describe("wantsSkillExpansion", () => {
	const base = { available: true, text: "use $research", slash: false };
	it("only when the relay licenses it AND the text carries a $", () => {
		expect(wantsSkillExpansion(base)).toBe(true);
		expect(wantsSkillExpansion({ ...base, available: false })).toBe(false);
		expect(wantsSkillExpansion({ ...base, text: "no mention" })).toBe(false);
	});
	it("never for a slash command", () => {
		expect(wantsSkillExpansion({ ...base, slash: true })).toBe(false);
	});
});

describe("skippedSkillsNotice", () => {
	it("is silent when nothing was skipped, or the relay sent no block", () => {
		expect(skippedSkillsNotice(undefined)).toBeNull();
		expect(skippedSkillsNotice({ attached: ["a"], skipped: [] })).toBeNull();
	});
	it("names every skipped skill with its $ in ONE sentence", () => {
		const notice = skippedSkillsNotice({
			attached: [],
			skipped: ["alpha", "beta"],
		});
		expect(notice).toContain("$alpha");
		expect(notice).toContain("$beta");
		expect(notice).toMatch(SENT_WITHOUT);
		expect(notice).toContain("those skills have");
		expect(skippedSkillsNotice({ attached: [], skipped: ["alpha"] })).toContain(
			"that skill has",
		);
	});
});

describe("skills_too_large", () => {
	const refusal = new RelayError(
		"rejected",
		"the selected skills are too large to send together",
		{
			status: 422,
			code: SKILLS_TOO_LARGE,
			serverError: "the selected skills are too large to send together",
			envelope: "clear",
			retry: "never",
		},
	);
	it("is the localized remedy, not the relay's English sentence", () => {
		const receipt = receiptForError(refusal, "prompt");
		expect(receipt.kind).toBe("rejected");
		expect(receipt.message).toBe(skillsTooLargeMessage());
		expect(receipt.message).toMatch(REMOVE_ONE);
	});
});
