import { describe, expect, it } from "vitest";

import { blockUnpaintedFrame } from "./audit.ts";
import {
	type AuditNode,
	type AuditState,
	frameHasNothingToMeasure,
	runChecks,
} from "./checks.ts";
import { floorsFromTokens } from "./color.ts";

/**
 * THE PAINTED-NOTHING GATE, IN BOTH DIRECTIONS.
 *
 * The gate exists for one measured shape: a render that painted nothing produced rows that
 * read `PASS` about a page with nothing on it ("`0 text/control boxes`, no pair overlapping
 * >25%" was the U-08 row), so those rows become BLOCKED/unmeasurable and the cell counts as
 * a gap.
 *
 * The other direction is review round 1's F1, and it is why this file exists rather than
 * only the case in `checks.test.ts`: an EMPTY text/control set does not mean no rule
 * measured anything. Two shapes reach the branch while a rule has already read a real
 * defect — a frame whose only text node is clipped away by an ancestor (`isGhost` drops it,
 * and U-07 measured the clip) and a frame with no boxes whose document overflows the
 * viewport (U-06 measured the overflow). Rewriting those rows traded a FAIL for a gap: the
 * report's `failures` fell to 0, the exit became 3, and `--allow-blocked` turned a real
 * clipping defect into exit 0.
 */
const floors = floorsFromTokens(null);

/** A node with every field the checks read, so a case states only what it varies. */
const node = (over: Partial<AuditNode> = {}): AuditNode =>
	({
		index: 0,
		tag: "div",
		path: "div",
		ancestors: [],
		rect: { x: 0, y: 0, w: 320, h: 20 },
		visibleRect: { x: 0, y: 0, w: 320, h: 20 },
		paintedRect: null,
		ownText: "",
		text: "",
		style: {},
		colour: "rgb(240, 240, 240)",
		background: "",
		ownBackground: "",
		position: "static",
		display: "block",
		overflowX: "visible",
		overflowY: "visible",
		textOverflow: "clip",
		whiteSpace: "normal",
		scrollWidth: 320,
		scrollHeight: 20,
		clientWidth: 320,
		clientHeight: 20,
		borderWidth: 0,
		padding: { top: 0, bottom: 0, left: 0, right: 0 },
		margin: { top: 0, bottom: 0, left: 0, right: 0 },
		rowGap: 0,
		columnGap: 0,
		scrollLeft: 0,
		testId: null,
		clippedAway: false,
		escapedClip: false,
		ariaHidden: false,
		inModalDialog: false,
		modalRoot: null,
		ownInk: true,
		interactive: false,
		disabled: false,
		isControl: false,
		childImages: 0,
		containerText: "",
		controlText: "",
		hasGlyph: false,
		semanticColour: "",
		semanticBackground: "",
		semanticBorder: "",
		...over,
	}) as AuditNode;

/** A state with everything the checks read, empty by default. */
const state = (over: Partial<AuditState> = {}): AuditState =>
	({
		nodes: [],
		platform: "web",
		scale: "100",
		url: "http://127.0.0.1:1/",
		viewport: { width: 320, height: 568, dpr: 2 },
		document: {
			scrollWidth: 320,
			clientWidth: 320,
			scrollHeight: 568,
			clientHeight: 568,
			bodyScrollWidth: 320,
		},
		insets: { top: 0, bottom: 0, left: 0, right: 0 },
		textScale: "100",
		theme: "dark",
		canvas: { root: "rgb(34, 32, 28)", body: "rgb(34, 32, 28)" },
		nodeCount: 0,
		tables: [],
		summaries: [],
		ax: [],
		screen: "S9",
		state: "spinner",
		...over,
	}) as AuditState;

const run = (s: AuditState, checks: string[]) =>
	runChecks(s, {
		floors,
		semantic: new Set<string>(),
		checks,
		scaleIsLive: true,
	});

describe("the painted-nothing gate", () => {
	it("blocks a blank frame's PASS rows, so an empty page is a gap and not a clean cell", () => {
		const blankState = state({});
		const produced = runBlank(blankState);
		expect(frameHasNothingToMeasure(blankState)).toBe(true);
		// Precondition: the search produced PASS rows about the empty page, which is the
		// false green — with no FAIL among them, the gate has work to do.
		expect(produced.some((row) => row.verdict === "PASS")).toBe(true);
		expect(produced.some((row) => row.verdict === "FAIL")).toBe(false);

		const gated = blockUnpaintedFrame(produced, blankState);
		expect(gated.every((row) => row.verdict === "BLOCKED")).toBe(true);
		expect(gated.every((row) => row.blockedKind === "unmeasurable")).toBe(true);
		// The rows say what is true of them: a row about an empty page is not a
		// measurement of the cell.
		expect(gated[0]?.detail).toContain(
			"the frame painted nothing: 0 text/control boxes",
		);
	});

	it("leaves a measured U-06 FAIL alone when a boxless frame overflows the viewport", () => {
		const overflowed = state({
			nodes: [],
			document: {
				scrollWidth: 511,
				clientWidth: 320,
				scrollHeight: 568,
				clientHeight: 568,
				bodyScrollWidth: 511,
			},
		});
		const produced = runOverflow(overflowed);
		const failed = produced.find((row) => row.check === "U-06");
		// The premise of F1, asserted rather than assumed: the frame has no text/control
		// box AND a rule measured a real defect on it.
		expect(frameHasNothingToMeasure(overflowed)).toBe(true);
		expect(failed?.verdict).toBe("FAIL");
		expect(failed?.measured).toContain("511px wide in a 320px viewport");

		const gated = blockUnpaintedFrame(produced, overflowed);
		expect(gated).toEqual(produced);
		const stillFailed = gated.filter((row) => row.verdict === "FAIL");
		// One FAIL survives, which is what keeps `report.failures` at 1 and the exit at 1
		// — and what stops `--allow-blocked` from reading a real overflow as exit 0.
		expect(stillFailed).toHaveLength(1);
		expect(stillFailed[0]?.measured).toContain(
			"511px wide in a 320px viewport",
		);
	});

	it("leaves a measured EXCEPTION alone too, because it records a pair the rule saw", () => {
		const overflowed = state({
			nodes: [],
			document: {
				scrollWidth: 511,
				clientWidth: 320,
				scrollHeight: 568,
				clientHeight: 568,
				bodyScrollWidth: 511,
			},
		});
		const produced = [
			...runOverflow(overflowed),
			{
				check: "U-08",
				verdict: "EXCEPTION" as const,
				measured: "suppressed: the painted regions do not intersect",
				detail: "div ∩ div",
			},
		];
		expect(blockUnpaintedFrame(produced, overflowed)).toEqual(produced);
	});

	it("does nothing at all to a frame that painted something (negative control)", () => {
		const painted = state({ nodes: [node({ ownText: "hello" })] });
		const produced = runBlank(painted);
		expect(frameHasNothingToMeasure(painted)).toBe(false);
		expect(blockUnpaintedFrame(produced, painted)).toEqual(produced);
	});
});

/** Every check, on a frame that painted nothing: the blank-frame case. */
const runBlank = (s: AuditState) => run(s, ["U-06", "U-07", "U-08", "U-42"]);
/** The rules that read the document rather than a box. */
const runOverflow = (s: AuditState) => run(s, ["U-06", "U-07"]);
