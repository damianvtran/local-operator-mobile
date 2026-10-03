import { describe, expect, it } from "vitest";

import {
	CONNECT_DISABLED_REASON,
	GREETING,
	HOME_SUGGESTIONS,
	HOME_TIP_ROTATE_MS,
	HOME_TIPS,
	STARTING,
	SUGGESTION_CHAR_BUDGET,
	suggestionCountFor,
	TIP_CHAR_BUDGET,
	tipAt,
} from "@/features/home/home-copy";

/**
 * The home's copy budgets, asserted rather than argued in review.
 *
 * These are the numbers the design spec fixes: the greeting is the desktop's
 * verbatim line; a suggestion fits ONE full-width row inside its 48 pt at
 * 320 pt; a tip fits its `text-meta` line; and the pool obeys the desktop's own
 * two composition rules. A copy edit that breaks one of these is a layout
 * change in disguise, which is why it fails here rather than in a screenshot
 * round later.
 */
describe("the home's copy", () => {
	it("greets with the desktop's verbatim line", () => {
		// Verbatim is the point: the two surfaces say the same first sentence.
		expect(GREETING).toBe("What can I help you with today?");
	});

	it("shows 3 suggestions at 390 and 2 at 320", () => {
		expect(suggestionCountFor(390)).toBe(3);
		expect(suggestionCountFor(430)).toBe(3);
		// A 375 pt phone is nearer the 320 case's pressure than the 390 case's.
		expect(suggestionCountFor(375)).toBe(2);
		expect(suggestionCountFor(320)).toBe(2);
	});

	it("keeps every suggestion inside its character ceiling", () => {
		for (const suggestion of HOME_SUGGESTIONS) {
			expect(suggestion.length).toBeLessThanOrEqual(SUGGESTION_CHAR_BUDGET);
		}
	});

	it("keeps the pool's two composition rules", () => {
		const leadingVerbs = HOME_SUGGESTIONS.map((s) =>
			s.split(" ")[0]?.toLowerCase(),
		);
		// No two entries open with the same verb: the rows are read as a set, and
		// two "Create …"s read as one idea twice.
		expect(new Set(leadingVerbs).size).toBe(HOME_SUGGESTIONS.length);
		// At most one entry creates an agent, for the same reason.
		const agentMakers = HOME_SUGGESTIONS.filter((s) => /agent/i.test(s));
		expect(agentMakers.length).toBeLessThanOrEqual(1);
	});

	it("keeps every tip inside its line and rotates on the desktop's 12 s", () => {
		for (const tip of HOME_TIPS) {
			expect(tip.length).toBeLessThanOrEqual(TIP_CHAR_BUDGET);
			// A tip is a fragment on purpose: a full stop reads as a closed thought
			// and competes with the field for the eye.
			expect(tip.endsWith(".")).toBe(false);
		}
		expect(HOME_TIP_ROTATE_MS).toBe(12_000);
		// The ring wraps, so a long session never strands on the last entry.
		expect(tipAt(HOME_TIPS.length)).toBe(HOME_TIPS[0]);
		expect(tipAt(HOME_TIPS.length + 2)).toBe(HOME_TIPS[2]);
	});

	it("states the two fixed sentences", () => {
		// The splash's one-line replacement while the first send is in flight: a
		// second line would move the composer.
		expect(STARTING).toBe("Starting…");
		expect(STARTING.includes("\n")).toBe(false);
		// The disabled reason is the sentence the composer's own surface carries.
		expect(CONNECT_DISABLED_REASON).toBe("Connect a computer to send.");
	});
});
