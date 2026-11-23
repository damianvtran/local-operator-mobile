import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The `Other` door's WIRING in the asks sheet.
 *
 * The door's semantics live in `asks.ts` as pure functions with their own tests
 * (`asks.test.ts`): where it stands (every non-secret option question, never a
 * free-text-only or secret one), what an `Other` answer does on a single- vs a
 * multi-select question, and that an empty one is not an answer. This file pins
 * the half no pure test can see — that the sheet RENDERS the door through those
 * functions rather than through a second, private copy of the rules that could
 * drift from them. The door is deliberate (design §5.0; the operator
 * requirement of 2026-10-05 that every question accepts free text), and this is
 * what stops it silently unhooking.
 *
 * Asserted over the SOURCE, because the module reaches `uniwind` through
 * `@/ui/components/sheet`, which the Node test environment cannot import — the
 * same constraint that puts `model-sheet.test.ts` and `segmented.test.ts` on
 * the source. Reads are name-following rather than literal where the name is
 * the point (`door`, the field's element), so a rename keeps passing while a
 * divergence — the failure this exists for — fails by name.
 */
const SOURCE = readFileSync(
	fileURLToPath(new URL("./asks-sheet.tsx", import.meta.url)),
	"utf8",
);

/** The sheet's binding of `hasOtherDoor`'s result: `const <name> = hasOtherDoor(`. */
const DOOR_BINDING = /const (\w+) = hasOtherDoor\(/;

/** The door field's writer: `onChangeText={(text) => onOtherChange(`. */
const FIELD_WRITER = /onChangeText=\{\(\w+\) => onOtherChange\(/;

/** The dead class: `border-control` without its `border-` prefix — a token name
 *  the web export never generates (only `border-border-control` exists), so it
 *  left every ask border at full ink instead of the control token's. */
const DEAD_BORDER_CLASS = /(?<!-)border-control/;

/** The dropped hint conditional: `other.open ? null :` — the shape that
 *  unmounted the hint and shrank the row while the door was open (D1). */
const DROPPED_HINT_CONDITIONAL = /other\.open \? null :/;

describe("the asks sheet's Other door", () => {
	it("gates the row on the tested predicate, not a private condition", () => {
		const bound = SOURCE.match(DOOR_BINDING)?.[1] ?? "";
		expect(bound, "the sheet must bind hasOtherDoor's result").not.toBe("");
		expect(SOURCE).toMatch(new RegExp(`\\{${bound} \\? \\(`));
	});

	it("gives the row and its input the declared identifiers", () => {
		/* The a11y contract's families (`ask-other-`) are the selectors the
		 * harness and the capture reach the door by; the renderer names them in
		 * the same change that renders them (the rule `src/ui/a11y.ts` states). */
		expect(SOURCE).toContain("askOtherId(");
		expect(SOURCE).toContain("askOtherFieldId(");
	});

	it("writes typed text into the door's own record — never the option cell", () => {
		const at = SOURCE.indexOf("askOtherFieldId(");
		expect(at, "the door must render its own TextInput").toBeGreaterThan(-1);
		const open = SOURCE.lastIndexOf("<TextInput", at);
		const close = SOURCE.indexOf("/>", at);
		const field = SOURCE.slice(open, close + 2);
		/* The field READS the record untrimmed and WRITES it whole: a value
		 * derived from the answer cell would lose the space between typed words
		 * and could read a label-equal text back as an option tick (the desktop
		 * card's named regressions, UI #892). */
		expect(field).toContain("value={other.text}");
		expect(field).toMatch(FIELD_WRITER);
	});

	it("wires the door's own press: untick on multi, re-select on single", () => {
		const at = SOURCE.indexOf("if (question.multi && other.open)");
		expect(
			at,
			"the press must distinguish the two select modes",
		).toBeGreaterThan(-1);
		/* To the door's own `testID`, not a fixed window: the press carries notes
		 *  that grow, and a shorter slice then fails on a comment rather than on
		 *  the wiring it pins. */
		const end = SOURCE.indexOf("testID={askOtherId(", at);
		expect(end).toBeGreaterThan(at);
		const toggle = SOURCE.slice(at, end);
		expect(toggle).toContain("open: false");
		expect(toggle).toContain("open: true");
	});

	it("closes the door when an option is pressed — the exclusion's card half", () => {
		const at = SOURCE.indexOf("onChange([option.label])");
		expect(at).toBeGreaterThan(-1);
		const press = SOURCE.slice(at, at + 420);
		expect(press).toContain("onOtherChange({ ...other, open: false })");
	});

	it("submits and gates through the shared composition rules", () => {
		/* `askResponseBody` builds the whole-ask body; `questionIsAnswered` is
		 * the Answer button's gate. Both read `asks.ts`'s ONE composition — a
		 * sheet that inlined either would be the second copy this pins out. */
		expect(SOURCE).toContain("askResponseBody(");
		expect(SOURCE).toContain("questionIsAnswered(");
	});

	it("keeps the hint line in every state — the row neither shrinks nor jumps (D1)", () => {
		/* Opening the door used to unmount the hint and shrink the row 51.1 →
		 * 34.3 pt, below the sheet's own touch floor, exactly as the field
		 * arrived. The hint stays (with a kept-text sentence of its own) and the
		 * desktop's one prompt is the string it says. */
		expect(SOURCE).not.toMatch(DROPPED_HINT_CONDITIONAL);
		expect(SOURCE).toContain('t("mobile.asks.other_hint")');
		expect(SOURCE).toContain('t("mobile.asks.other_kept")');
	});

	it("pins the answering verbs in Sheet's footer — the three-region rule (D2)", () => {
		/* The actions must not scroll with the questions: on iphone-se they sat
		 * wholly below the fold. The sheet passes `footer`, and its controls read
		 * the shared composition through the same gate the body does. */
		expect(SOURCE).toContain("footer={");
		expect(SOURCE).toContain("settleFromFooter(");
	});

	it("uses the control border token and the muted placeholder ink (D4/D5)", () => {
		/* `border-control` generates no CSS in the web export, so it left every
		 * ask border at full ink; and a raw `TextInput` takes its placeholder
		 * colour as a VALUE, so it must come from the same `ink-muted` token
		 * `Input` reads. */
		expect(SOURCE).not.toMatch(DEAD_BORDER_CLASS);
		expect(SOURCE).toContain('useTokenColor("ink-muted")');
		expect(SOURCE).toContain("placeholderTextColor={placeholderColour}");
	});
});

describe("the asks sheet's walk after a settle (UX r1 U1)", () => {
	it("advances through the tested predicate, which counts a lapsed ask's Dismiss", () => {
		/* Keyed on `isAnswerable`, a lapsed-only sheet collapsed after the first
		 * Dismiss; `nextActionableAsk` (tested in `asks.test.ts`) keys on verbs. */
		expect(SOURCE).toMatch(
			/const next = nextActionableAsk\(shownRows, row\.ask_id\)/,
		);
	});
});

describe("the asks sheet's card layout (ask-panel parity N1/N2/N4)", () => {
	/** The index of a needle in the sheet's own JSX, so ORDER can be pinned. */
	const at = (needle: string): number => {
		const index = SOURCE.lastIndexOf(needle);
		expect(index, `${needle} must be rendered`).toBeGreaterThan(-1);
		return index;
	};

	it("draws the open card first, then the waiting rows, then Earlier, then the honesty line", () => {
		/* The honesty line was "ALWAYS first (§5)"; Ben moved it to the bottom
		 * (2026-11-23), under everything the reader came to read. */
		const card = at("openCard(openInBand)");
		const waiting = at("waitingBand.map(");
		const earlier = at('t("mobile.asks.settled")');
		const honesty = at('t("mobile.asks.honesty")');
		expect(card).toBeLessThan(waiting);
		expect(waiting).toBeLessThan(earlier);
		expect(earlier).toBeLessThan(honesty);
		expect(SOURCE).not.toContain("ALWAYS first");
	});

	it("never draws a settled ask between the card's options and the pinned buttons", () => {
		/* Settled asks come from the `earlier` band only, and that band renders
		 * after the card and the waiting rows. */
		expect(SOURCE).toContain("bands.earlier.map(");
		expect(SOURCE).toContain("askBands(shownRows)");
	});

	it("keeps the scroll-to-field ref on the question block, and scrolls the card to its top", () => {
		/* #378's `blockRefs` drive `revealField`; the card's own scroll is a
		 * second, separate mechanism (`scrollToBlock`). */
		expect(SOURCE).toContain("blockRefs.current.set(id, node)");
		expect(SOURCE).toContain("scroll?.scrollToBlock(cardRef.current)");
	});

	it("puts the state line first in the card, as a status region", () => {
		const card = SOURCE.slice(at("const openCard = "), at("const waitingBand"));
		expect(card.indexOf("role={ROLE.status}")).toBeGreaterThan(-1);
		expect(card.indexOf("role={ROLE.status}")).toBeLessThan(
			card.indexOf("detailOf(row)"),
		);
	});

	it("moves the reader's place to the next ask's question after a send", () => {
		expect(SOURCE).toContain("setFocusAsk(next ? next.ask_id : null)");
		expect(SOURCE).toContain("moveReadingPlace(node)");
	});

	it("draws the option rows through one shell with a trailing check, not colour alone", () => {
		expect(SOURCE).toContain("<ChoiceRow");
		expect(SOURCE).toContain("<Check ");
		expect(SOURCE).toContain("choiceRowClasses(");
	});

	it("takes the pinned verbs' words from the catalogue, in the card's order", () => {
		expect(SOURCE).toContain('t("mobile.asks.send_answers")');
		expect(SOURCE).toContain('t("mobile.asks.send_answer")');
		expect(SOURCE).toContain('t("mobile.asks.decline")');
		expect(SOURCE).toContain('t("mobile.asks.dismiss_open")');
		expect(SOURCE).not.toContain('label="Answer"');
		const progress = at("progressLine ??");
		const send = at('t("mobile.asks.send_answer")');
		const dismiss = at('t("mobile.asks.dismiss_open")');
		/* The pair, then ONE row holding why Send is grey and the quiet way out. */
		expect(send).toBeLessThan(progress);
		expect(progress).toBeLessThan(dismiss);
	});

	it("dismisses a waiting ask only WITH a reason, and a lapsed one without", () => {
		/* The request gate, not only the button's: a waiting ask without a reason
		 * never leaves, and the lapsed ask's body stays the one older daemons take. */
		expect(SOURCE).toContain("dismissNeedsReason(String(row.status");
		expect(SOURCE).toContain("reason === undefined ? {} : { reason }");
		expect(SOURCE).toContain("DISMISS_REASONS.map(");
	});
});
