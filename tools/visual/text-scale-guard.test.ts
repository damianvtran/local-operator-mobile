import { describe, expect, it } from "vitest";

import { judgeTextScale } from "./capture.ts";

/**
 * The text-scale guard's ARITHMETIC, at a factor the live table does not declare.
 *
 * `declaredScaleFactor()` reads `SCALES` for the pair the guard pairs — 200 over 100 — and
 * that ratio is 2 today, so no run of the real harness can tell a table-driven factor from
 * a hard-coded one. The arithmetic inside `judgeTextScale` used to be the hard-coded one:
 * `px200` was `rem * root * 2`, the frozen-role lookup was `rem / 2`, the two messages
 * printed `px(rem) * 2`, and `sameSizes` scaled the second frame by `2` as well. A table
 * that stopped declaring 2 for `200` — or a guard that paired two other ids — would have
 * measured one thing and reported another, silently.
 *
 * These cases drive the function at 1.5 (`SCALES`' own `150` row), where the correct and
 * the hard-coded answers disagree, and assert WHICH BRANCH fires. Read as the pair: before
 * the fix the frozen role in a mixed page came back as a note that named `40px` (its
 * counterpart by the wrong factor), and a wholly frozen page came back as per-role notes
 * instead of the single inert fact.
 */
const ROOT_100 = 16;
const ROOT_150 = 24;
const FACTOR_150 = 1.5;

/** One 14 px role at 100 %, and the same node frozen at 14 px under the 150 % root. */
const allFrozen = () => ({
	at100: new Map([[14 / ROOT_100, 1]]),
	at150: new Map([[14 / ROOT_150, 1]]),
});

/**
 * A page with two roles, one of which scales and one of which does not.
 *
 * The mixed page matters: a single frozen role is also a page that rendered one size at
 * both scales, so it takes the WHOLE-PAGE branch and never reaches the per-role lookup.
 */
const mixed = () => ({
	// 14 px and 20 px at the 100 % root; the 14 px role followed the factor (21 px at
	// 150 %) and the 20 px label did not.
	at100: new Map([
		[14 / ROOT_100, 1],
		[20 / ROOT_100, 1],
	]),
	at150: new Map([
		[21 / ROOT_150, 1],
		[20 / ROOT_150, 1],
	]),
});

describe("the text-scale guard's declared factor", () => {
	it("finds a frozen role by dividing the node's size by the factor, not by 2", () => {
		const { at100, at150 } = mixed();
		const verdict = judgeJudge(at100, at150);
		expect(verdict.live).toBe(false);
		const said = verdict.problems.join(" ");
		// The frozen 20 px label is a PROBLEM, not a note: it is still there at its old
		// size. `20 / 1.5` lands on the 150 % frame's own key; `20 / 2` does not.
		expect(said).toContain("did not scale");
		// The expected size is named in the 150 % frame's px, which is what a screenshot
		// shows: `20 * 1.5`, never `20 * 2`.
		expect(said).toContain("30px was expected");
		expect(said).not.toContain("40px");
	});

	it("recognises a wholly frozen page at the factor the table declares", () => {
		const { at100, at150 } = allFrozen();
		const verdict = judgeJudge(at100, at150);
		expect(verdict.live).toBe(false);
		/* `sameSizes` compares the two frames in px, the second at `root100 * factor`.
		 * The hard-coded `* 2` scaled that frame by 32 px instead of 24, so one frozen
		 * page read as a per-role difference instead of as one frozen page — the single
		 * fact a reader needs first. */
		expect(verdict.problems.join(" ")).toContain(
			"renders the same text sizes as the 100% frame",
		);
	});

	it("still reads a page whose roles followed the factor as live (negative control)", () => {
		// Every 100 % role has its `* 1.5` counterpart at 150 %, and nothing else.
		const at100 = new Map([
			[14 / ROOT_100, 1],
			[20 / ROOT_100, 1],
		]);
		const at150 = new Map([
			[21 / ROOT_150, 1],
			[30 / ROOT_150, 1],
		]);
		const verdict = judgeJudge(at100, at150);
		expect(verdict.live).toBe(true);
		expect(verdict.problems).toEqual([]);
	});

	it("fails a pair whose 150% root is not the declared factor", () => {
		// The precondition, still checked first: a page that pinned its root renders both
		// frames at one size, and no reading below it is a measurement.
		const { at100, at150 } = mixed();
		const verdict = judgeTextScale(
			"S8/populated-long__iphone-se__dark",
			at100,
			at150,
			ROOT_100,
			ROOT_100,
			FACTOR_150,
		);
		expect(verdict.live).toBe(false);
		expect(verdict.problems.join(" ")).toContain(
			"the harness's root font size did not take effect",
		);
	});
});

/** The 100 %/150 % pair, judged the way `verifyTextScale` calls it. */
function judgeJudge(at100: Map<number, number>, at150: Map<number, number>) {
	return judgeTextScale(
		"S8/populated-long__iphone-se__dark",
		at100,
		at150,
		ROOT_100,
		ROOT_150,
		FACTOR_150,
	);
}
