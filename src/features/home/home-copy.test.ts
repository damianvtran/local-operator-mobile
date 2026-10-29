import { describe, expect, it } from "vitest";

import {
	connectDisabledReason,
	draftExistsFor,
	foldersReadFailed,
	greeting,
	HOME_SUGGESTION_KEYS,
	HOME_TIP_KEYS,
	HOME_TIP_ROTATE_MS,
	homeSuggestions,
	homeTips,
	SUGGESTION_CHAR_BUDGET,
	startingLine,
	startupQueueState,
	suggestionCharBudget,
	suggestionCountFor,
	suggestionSlotFor,
	TIP_CHAR_BUDGET,
	tipAt,
} from "@/features/home/home-copy";
import { renderFor, SHIPPED_LOCALES } from "@/i18n";

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
		expect(greeting()).toBe("What can I help you with today?");
	});

	it("shows 3 suggestions at 390 and 2 at 320", () => {
		expect(suggestionCountFor(390)).toBe(3);
		expect(suggestionCountFor(430)).toBe(3);
		// A 375 pt phone is nearer the 320 case's pressure than the 390 case's.
		expect(suggestionCountFor(375)).toBe(2);
		expect(suggestionCountFor(320)).toBe(2);
	});

	it("keeps every suggestion inside its character ceiling", () => {
		for (const suggestion of homeSuggestions()) {
			expect(suggestion.length).toBeLessThanOrEqual(suggestionCharBudget("en"));
		}
	});

	it("pins English at 24 and gives no locale a tighter row than English", () => {
		/* English is the calibrated number the spec fixes, and every other budget
		 *  is a MEASURED widening of it (`home-copy.ts`): a locale that got a
		 *  smaller ceiling than English would be truncation dressed as a limit. */
		expect(SUGGESTION_CHAR_BUDGET.en).toBe(24);
		for (const budget of Object.values(SUGGESTION_CHAR_BUDGET)) {
			expect(Number.isInteger(budget)).toBe(true);
			expect(budget).toBeGreaterThanOrEqual(24);
		}
	});

	it("keeps the pool's two composition rules", () => {
		const leadingVerbs = homeSuggestions().map((s) =>
			s.split(" ")[0]?.toLowerCase(),
		);
		// No two entries open with the same verb: the rows are read as a set, and
		// two "Create …"s read as one idea twice.
		expect(new Set(leadingVerbs).size).toBe(homeSuggestions().length);
		// At most one entry creates an agent, for the same reason.
		const agentMakers = homeSuggestions().filter((s) => AGENT_MAKER.test(s));
		expect(agentMakers.length).toBeLessThanOrEqual(1);
	});

	it("keeps every tip inside its line and rotates on the desktop's 12 s", () => {
		for (const tip of homeTips()) {
			expect(tip.length).toBeLessThanOrEqual(TIP_CHAR_BUDGET);
			// A tip is a fragment on purpose: a full stop reads as a closed thought
			// and competes with the field for the eye.
			expect(tip.endsWith(".")).toBe(false);
		}
		expect(HOME_TIP_ROTATE_MS).toBe(12_000);
		// The ring wraps, so a long session never strands on the last entry.
		expect(tipAt(homeTips().length)).toBe(homeTips()[0]);
		expect(tipAt(homeTips().length + 2)).toBe(homeTips()[2]);
	});

	it("states the fixed sentences", () => {
		// The splash's one-line replacement while the first send is in flight: a
		// second line would move the composer.
		expect(startingLine()).toBe("Starting…");
		expect(startingLine().includes("\n")).toBe(false);
		// The disabled reason is the sentence the composer's own surface carries.
		expect(connectDisabledReason()).toBe("Connect a computer to send.");
		// The folders read's failure sentence, `/new`'s verbatim (review M2).
		expect(foldersReadFailed()).toBe(
			"We couldn't read this computer's folders just now.",
		);
	});
});

/**
 * THE SAME ROW, EVERY SHIPPED LANGUAGE.
 *
 * The budgets above read the ACTIVE catalogue, which in a test run is the
 * English one — so a translation could ship a line three times the width of the
 * row it has to fit and still pass. A row that clips is a fragment, not a
 * suggestion, and French runs longer than English by construction, so the check
 * is per shipped locale: every key the pool exports, rendered source-direct
 * through `renderFor` (no locale source, no provider), measured against THAT
 * locale's own ceiling (`suggestionCharBudget(locale)`) rather than English's 24
 * — see the calibration comment on `SUGGESTION_CHAR_BUDGET`.
 *
 * The composition rules above stay English-only on purpose: they are rules about
 * the SOURCE pool's wording, and a translation answers them in its own verbs.
 */
describe("every shipped locale fits the same rows", () => {
	for (const locale of SHIPPED_LOCALES) {
		it(`${locale}: every suggestion fits its one-line row`, () => {
			for (const key of HOME_SUGGESTION_KEYS) {
				const rendered = renderFor(key, {}, locale);
				expect(rendered.trim().length).toBeGreaterThan(0);
				expect(rendered.length).toBeLessThanOrEqual(
					suggestionCharBudget(locale),
				);
			}
		});

		it(`${locale}: every tip fits its line and stays a fragment`, () => {
			for (const key of HOME_TIP_KEYS) {
				const rendered = renderFor(key, {}, locale);
				expect(rendered.trim().length).toBeGreaterThan(0);
				expect(rendered.length).toBeLessThanOrEqual(TIP_CHAR_BUDGET);
				expect(rendered.endsWith(".")).toBe(false);
			}
		});
	}

	it("fr: the chip that creates an agent still names the agent", () => {
		/* THE DEFECT THE PER-LOCALE BUDGET REPLACED (review m6): at English's 24,
		 *  French rendered "Créez une équipe" — "Create a team" — and the agent, the
		 *  only reason the chip exists, was the word the budget bought back. 31
		 *  characters covers "Créez une équipe d’agents" (25) and keeps the row on
		 *  one line; this assertion is what stops a future copy edit from quietly
		 *  dropping the noun again to fit a narrower guess. */
		expect(renderFor("mobile.home.suggestion.team_of_agents", {}, "fr")).toBe(
			"Créez une équipe d’agents",
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

describe("the queue row says the state once", () => {
	it("names an unconfirmed start instead of claiming something is waiting", () => {
		expect(startupQueueState("unconfirmed", null)).toBe("Start not confirmed");
		expect(startupQueueState("unconfirmed", null)).not.toContain("Waiting");
	});

	it("maps the states that can still drain, or cannot start at all", () => {
		expect(startupQueueState("ready", "sid")).toBe("Sending queued messages…");
		expect(startupQueueState("refused", null)).toBe("Not started");
	});

	it("stays silent while starting — the splash already says it (UX U2)", () => {
		expect(startupQueueState("starting", null)).toBeNull();
		expect(startupQueueState("starting", "sid")).toBeNull();
		expect(startingLine()).toBe("Starting…");
	});

	it("does not claim to be sending while delivery is blocked", () => {
		expect(startupQueueState("blocked", "sid")).toBe(
			"Retry to send queued messages",
		);
	});

	it("never repeats the count — the composer's chip owns it (UX U2)", () => {
		for (const phase of [
			"draft",
			"starting",
			"ready",
			"refused",
			"unconfirmed",
			"blocked",
		] as const)
			for (const sid of [null, "sid"])
				expect(startupQueueState(phase, sid) ?? "").not.toMatch(
					/queued \d|\d queued/,
				);
	});
});
