import { describe, expect, it } from "vitest";

import {
	CONNECT_DISABLED_REASON,
	draftExistsFor,
	FOLDERS_READ_FAILED,
	GREETING,
	HOME_SUGGESTIONS,
	HOME_TIP_ROTATE_MS,
	HOME_TIPS,
	STARTING,
	SUGGESTION_CHAR_BUDGET,
	suggestionCountFor,
	suggestionSlotFor,
	TIP_CHAR_BUDGET,
	tipAt,
} from "@/features/home/home-copy";

/** Hoisted so the check is compiled once (the same rule the kit's own modules
 *  follow — an inline regex in a callback is re-created per call). */
const AGENT_MAKER = /agent/i;

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
		const agentMakers = HOME_SUGGESTIONS.filter((s) => AGENT_MAKER.test(s));
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

	it("states the fixed sentences", () => {
		// The splash's one-line replacement while the first send is in flight: a
		// second line would move the composer.
		expect(STARTING).toBe("Starting…");
		expect(STARTING.includes("\n")).toBe(false);
		// The disabled reason is the sentence the composer's own surface carries.
		expect(CONNECT_DISABLED_REASON).toBe("Connect a computer to send.");
		// The folders read's failure sentence, `/new`'s verbatim (review M2).
		expect(FOLDERS_READ_FAILED).toBe(
			"We couldn't read this computer's folders just now.",
		);
	});
});

/**
 * The draft gate — review B1's fix, asserted on the helpers the splash renders
 * from (the splash itself needs the RN renderer + uniwind + lucide, which is the
 * e2e layer's job per `vitest.config.ts`; these are the plain modules it
 * renders, the same split every other screen's logic uses).
 */
describe("the draft gate", () => {
	it("treats only whitespace as no draft at all", () => {
		// `trim()` — the state marker's own reading (review n2): a whitespace-only
		// draft is EMPTY, so the tip rotates and the marker declares `idle`.
		expect(draftExistsFor("")).toBe(false);
		expect(draftExistsFor("   ")).toBe(false);
		expect(draftExistsFor("\n\t")).toBe(false);
		expect(draftExistsFor("x")).toBe(true);
		expect(draftExistsFor(" x ")).toBe(true);
	});

	it("empties the suggestions' slot while a draft is held", () => {
		// The regression QA reproduced on `306121b6`: a live suggestion row beside
		// a held draft, whose tap silently replaced the text (data loss, P-4).
		const held = suggestionSlotFor({
			connected: true,
			draft: "QAtest keep-this-draft",
			width: 390,
		});
		expect(held.kind).toBe("none");
	});

	it("fills the slot with the pool's head while the draft is empty", () => {
		const wide = suggestionSlotFor({ connected: true, draft: "", width: 390 });
		expect(wide.kind).toBe("suggestions");
		if (wide.kind === "suggestions") expect(wide.rows.length).toBe(3);
		// The 320 pt count does not change the gate, only the row count.
		const narrow = suggestionSlotFor({
			connected: true,
			draft: "",
			width: 320,
		});
		if (narrow.kind === "suggestions") expect(narrow.rows.length).toBe(2);
	});

	it("still shows the connect row while a draft is held", () => {
		// The connect row replaces nothing — it navigates — so it is not a
		// data-loss control and stays; only the text-replacing suggestions hide.
		expect(
			suggestionSlotFor({ connected: false, draft: "typed", width: 390 }).kind,
		).toBe("connect");
	});
});
