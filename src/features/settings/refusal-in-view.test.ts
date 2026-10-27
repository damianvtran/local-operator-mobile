import { describe, expect, it } from "vitest";
import {
	REFUSAL_SCROLL_MARGIN,
	refusalAppeared,
	refusalOutOfView,
	refusalRevealReady,
	refusalScrollY,
	retryLanded,
	retryStillOwned,
	retryTargetMatches,
} from "./refusal-in-view";

/**
 * The decisions behind Settings bringing a refused switch into view (PR #122 UX
 * round 3, U16) and moving focus after its own Try now (U18). The bands are the
 * ux-reviewer's measured round-3 frames (refusal top/height, viewport top/height in
 * window pixels), so a regression here is a regression in a case a reader hit.
 */
describe("when Settings scrolls to a refusal (U16)", () => {
	it("acts only on the render where the refusal first appears", () => {
		expect(refusalAppeared(false, true)).toBe(true);
		expect(refusalAppeared(true, true)).toBe(false);
		expect(refusalAppeared(true, false)).toBe(false);
		expect(refusalAppeared(false, false)).toBe(false);
	});

	it("reveals every refusal on web, waiting only for a dismissal that is owed (U16, R5-M1)", () => {
		const web = { platform: "web", sheetVisible: false };
		/* No sheet involved — failed Sign out behind a Dialog, a background restore:
		 *  nothing is owed, so the reveal happens at once. */
		expect(
			refusalRevealReady({ ...web, sheetCloses: 0, sheetDismissals: 0 }),
		).toBe(true);
		/* A failed pick closes the sheet: down, but RNW has not restored focus to the
		 *  opener yet, so the reveal waits... */
		expect(
			refusalRevealReady({ ...web, sheetCloses: 3, sheetDismissals: 2 }),
		).toBe(false);
		/* ...and goes on the dismissal. */
		expect(
			refusalRevealReady({ ...web, sheetCloses: 3, sheetDismissals: 3 }),
		).toBe(true);
		/* A re-failing Try now on Settings, long after any sheet settled: at once. */
		expect(
			refusalRevealReady({ ...web, sheetCloses: 5, sheetDismissals: 5 }),
		).toBe(true);
		/* Up: never, on any platform. */
		expect(
			refusalRevealReady({
				...web,
				sheetVisible: true,
				sheetCloses: 1,
				sheetDismissals: 1,
			}),
		).toBe(false);
	});

	it("keeps native on the sheet-down path: no dismissal event there (U16)", () => {
		/* Native never reports a dismissal, so the counts drift apart; they must not
		 *  hold a reveal hostage. */
		for (const platform of ["ios", "android"]) {
			expect(
				refusalRevealReady({
					platform,
					sheetVisible: false,
					sheetCloses: 4,
					sheetDismissals: 0,
				}),
			).toBe(true);
			expect(
				refusalRevealReady({
					platform,
					sheetVisible: true,
					sheetCloses: 4,
					sheetDismissals: 0,
				}),
			).toBe(false);
		}
	});

	it("does not fire a stale reveal on a later, unrelated close (R5-M1)", () => {
		/* Settings' arm/disarm, replayed: a refusal arms; it reveals at once (none
		 *  owed); a refusal that clears before revealing disarms. Then the reader opens
		 *  and closes the switcher with no refusal on screen — nothing is armed, so the
		 *  dismissal has nothing to reveal. */
		let armed = false;
		let wasRefused = false;
		let revealed = 0;
		const step = (
			refused: boolean,
			sheet: {
				sheetVisible: boolean;
				sheetCloses: number;
				sheetDismissals: number;
			},
		) => {
			if (refusalAppeared(wasRefused, refused)) armed = true;
			if (!refused) armed = false;
			wasRefused = refused;
			if (armed && refusalRevealReady({ platform: "web", ...sheet })) {
				armed = false;
				revealed += 1;
			}
		};
		// a refusal appears while the sheet is closing: armed, waiting
		step(true, { sheetVisible: false, sheetCloses: 1, sheetDismissals: 0 });
		expect(revealed).toBe(0);
		// it clears before the dismissal (a pick from elsewhere succeeded)
		step(false, { sheetVisible: false, sheetCloses: 1, sheetDismissals: 0 });
		// the late dismissal, then an unrelated open/close/dismiss
		step(false, { sheetVisible: false, sheetCloses: 1, sheetDismissals: 1 });
		step(false, { sheetVisible: true, sheetCloses: 1, sheetDismissals: 1 });
		step(false, { sheetVisible: false, sheetCloses: 2, sheetDismissals: 2 });
		expect(revealed).toBe(0);
		// a sheetless refusal reveals once, at once, and not again on later closes
		step(true, { sheetVisible: false, sheetCloses: 2, sheetDismissals: 2 });
		step(true, { sheetVisible: false, sheetCloses: 3, sheetDismissals: 3 });
		expect(revealed).toBe(1);
	});

	it("scrolls for every measured off-screen case, and leaves the visible one alone", () => {
		/* Header ~116 at 390x844 with a 59 pt inset; the content viewport below it. */
		const viewport = (height: number) => ({ top: 116, height: height - 116 });
		const offscreen: Array<[string, number, number, number]> = [
			["375x667 from the top", -246, 332, 667],
			["375x667 scrolled 200", -227, 332, 667],
			["390x844 scrolled 300", -327, 332, 844],
			["390x844 at 150 % text", -275, 473, 844],
			["320x640", -257, 354, 640],
			["390x844 keyboard-opened", -157, 332, 844],
		];
		for (const [, top, height, screen] of offscreen)
			expect(refusalOutOfView({ top, height }, viewport(screen))).toBe(true);
		/* 390x844 from the top: 162-494, wholly inside. */
		expect(refusalOutOfView({ top: 162, height: 332 }, viewport(844))).toBe(
			false,
		);
	});

	it("brings a panel taller than the viewport to the top, headline first", () => {
		expect(
			refusalOutOfView({ top: 120, height: 600 }, { top: 100, height: 500 }),
		).toBe(true);
	});

	it("puts the refusal's top under a margin, never above the content's start", () => {
		expect(refusalScrollY(400)).toBe(400 - REFUSAL_SCROLL_MARGIN);
		expect(refusalScrollY(4)).toBe(0);
		expect(refusalScrollY(250.6)).toBe(235);
	});
});

describe("focus after this screen's Try now (U18)", () => {
	it("drops retry ownership on failure and on a different target (R4-m1)", () => {
		const armed = {
			retriedHere: true,
			retrySettled: false,
			refused: true,
			live: false,
			sameTarget: true,
		};
		/* In flight on the same computer: still the retry's move to make. */
		expect(retryStillOwned(armed)).toBe(true);
		/* Settled and still refused: the retry failed, so a later success — a pick
		 *  from the switcher — must not move focus on its behalf. */
		expect(retryStillOwned({ ...armed, retrySettled: true })).toBe(false);
		/* Settled and live: the move is still owed until the focus effect consumes it. */
		expect(
			retryStillOwned({
				...armed,
				retrySettled: true,
				refused: false,
				live: true,
			}),
		).toBe(true);
		/* A different computer selected, in flight or settled. */
		expect(retryStillOwned({ ...armed, sameTarget: false })).toBe(false);
		expect(retryStillOwned({ ...armed, retriedHere: false })).toBe(false);
	});

	it("owns an account-side retry by its start state, not tunnel equality (R5-m2)", () => {
		/* Started with no computer selected: the restore landing on one is the retry
		 *  working, so focus still moves to Status. */
		expect(retryTargetMatches(null, "t1")).toBe(true);
		expect(retryTargetMatches(null, null)).toBe(true);
		/* Started on a computer: a pick of another one is not this retry. */
		expect(retryTargetMatches("t1", "t1")).toBe(true);
		expect(retryTargetMatches("t1", "t2")).toBe(false);
		expect(retryTargetMatches("t1", null)).toBe(false);
		expect(
			retryStillOwned({
				retriedHere: true,
				retrySettled: true,
				refused: false,
				live: true,
				sameTarget: retryTargetMatches(null, "t1"),
			}),
		).toBe(true);
	});

	it("moves only when this screen retried, the refusal cleared and the route is live", () => {
		expect(retryLanded({ retriedHere: true, refused: false, live: true })).toBe(
			true,
		);
		expect(
			retryLanded({ retriedHere: false, refused: false, live: true }),
		).toBe(false);
		expect(retryLanded({ retriedHere: true, refused: true, live: false })).toBe(
			false,
		);
		expect(
			retryLanded({ retriedHere: true, refused: false, live: false }),
		).toBe(false);
	});
});
