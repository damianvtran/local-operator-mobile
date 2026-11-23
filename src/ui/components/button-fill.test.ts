import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/ui/components/button";

/**
 * `Button.fill`: the button's visible box takes the height its container gives
 * it, instead of its own size's height.
 *
 * The Past screen's Search button shares a row with the search field and has to
 * be exactly as tall as the field at EVERY text size (design review round 1,
 * D2): the field grows with the reader's type (48 pt at 100 %, 66 pt at 200 %)
 * while a `md` button stays 44 pt to look at. A fixed floor matched only at
 * 100 %. With `fill`, the caller sizes the container to the field and the
 * button's target AND visible box follow it.
 *
 * Rendered through react-native-web, the `input.test.ts` pattern.
 */
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000",
	useKeyboardAppearance: () => "default",
}));

const render = (fill?: boolean): string =>
	renderToStaticMarkup(
		h(Button, {
			label: "Search",
			onPress: () => {},
			variant: "outline",
			fill,
			testID: "search",
		}),
	);

/** How many elements in the markup grow along their parent's main axis. */
const growers = (markup: string): number =>
	[...markup.matchAll(/flex-grow:\s*1/g)].length;

describe("Button: fill", () => {
	it("keeps its own size's height by default", () => {
		expect(growers(render())).toBe(0);
	});

	it("grows the target and the visible box into the container when asked", () => {
		expect(growers(render(true))).toBe(2);
	});
});
