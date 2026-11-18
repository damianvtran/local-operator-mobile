import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/ui/components/button";
import { TOUCH_FLOOR } from "@/ui/layout";
import { BUTTON_VISUAL_HEIGHT } from "@/ui/variants";

/**
 * `Button.fillFloor`: a `md` button is 44 pt to look at, and on Android and the
 * web its TARGET is padded to the 48 pt floor around that box. Beside a text
 * field — whose own box IS the floor — that left the button 4 pt shorter than
 * the field it shares a row with (the Past screen's Search). `fillFloor` grows
 * the visible box to the floor instead, so the pair line up on every platform;
 * on iOS, where the floor is 44, nothing changes.
 *
 * Rendered through react-native-web, the `input.test.ts` pattern.
 */
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000",
	useKeyboardAppearance: () => "default",
}));

const render = (fillFloor?: boolean): string =>
	renderToStaticMarkup(
		h(Button, {
			label: "Search",
			onPress: () => {},
			variant: "outline",
			fillFloor,
			testID: "search",
		}),
	);

/** Every inline `min-height` in the markup, in document order. */
const minHeights = (markup: string): number[] =>
	[...markup.matchAll(/min-height:\s*([\d.]+)px/g)].map((m) => Number(m[1]));

describe("Button: fillFloor", () => {
	it("is a real difference on this platform (the web floor is above md's box)", () => {
		expect(TOUCH_FLOOR).toBeGreaterThan(BUTTON_VISUAL_HEIGHT.md);
	});

	it("pads only the target by default, so the visible box stays md", () => {
		expect(minHeights(render())).toEqual([TOUCH_FLOOR]);
	});

	it("grows the visible box to the floor when asked", () => {
		expect(minHeights(render(true))).toEqual([TOUCH_FLOOR, TOUCH_FLOOR]);
	});
});
