import { describe, expect, it } from "vitest";
import { composerStackLayout, NOTICE_STACK_STYLE } from "./composer-stack";

/* QA round 2, Q-R2-1, measured in the rendered home at 320 × 568 pt, 200 %
 * text: the header ends at 64, the composer rests at y 434 (so it is
 * 568 − 434 = 134 tall with its safe area), and the two alerts are 191.8 and
 * 232.4 pt tall, each with its 8 pt `pb-2` gap included. */
const SCREEN = 568;
const HEADER = 64;
const COMPOSER_REST_Y = 434;
const FOLDER = 191.8;
const MODEL = 232.4;

const at320x200 = (notices: number[]) =>
	composerStackLayout({
		column: SCREEN - HEADER,
		composer: SCREEN - COMPOSER_REST_Y,
		notices,
	});

describe("the home's notice stack never moves the composer (Q-R2-1)", () => {
	it("keeps the composer's y identical for none / folder / model / both at 320 × 568 @200 %", () => {
		const ys = [[], [FOLDER], [MODEL], [FOLDER, MODEL]].map(
			(notices) => HEADER + at320x200(notices).composerY,
		);
		expect(ys).toEqual([434, 434, 434, 434]);
		// And it stays on the screen: the composer's bottom is the screen's.
		expect(
			HEADER +
				at320x200([FOLDER, MODEL]).composerY +
				(SCREEN - COMPOSER_REST_Y),
		).toBe(SCREEN);
	});

	it("gives the hero what one notice leaves, and caps two at the room, which then scrolls", () => {
		const one = at320x200([FOLDER]);
		expect(one.scrolls).toBe(false);
		expect(one.stack).toBeCloseTo(FOLDER);
		expect(one.heroBand).toBeCloseTo(370 - FOLDER);

		const both = at320x200([FOLDER, MODEL]);
		// 432.2 pt of notices in 370 pt of room: capped, scrolled, band 0 not negative.
		expect(both.stack).toBe(370);
		expect(both.scrolls).toBe(true);
		expect(both.heroBand).toBe(0);
	});

	it("leaves the stack exactly its content height when there is room", () => {
		const roomy = composerStackLayout({
			column: 874 - 64,
			composer: 116,
			notices: [66.6, 66.6],
		});
		expect(roomy.stack).toBeCloseTo(133.2);
		expect(roomy.scrolls).toBe(false);
	});

	it("is a stack that may shrink but never grow (ScrollView defaults to flexGrow 1)", () => {
		expect(NOTICE_STACK_STYLE).toEqual({ flexGrow: 0, flexShrink: 1 });
	});
});
