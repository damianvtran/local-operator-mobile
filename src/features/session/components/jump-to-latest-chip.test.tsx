import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	JUMP_CHIP_MIN_VIEWPORT_PT,
	JumpToLatestChip,
} from "@/features/session/components/jump-to-latest-chip";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL, ROLE } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";

/**
 * The chip's own contract (the list's decision is
 * `transcript-jump-to-latest.test.ts`'s): a real 44 pt target, the arrow-free
 * accessible name at every width, the short VISIBLE label on a 320 pt phone and
 * at large text, nothing at all when the transcript is too short to hold it, the
 * arrival announced, and the trailing-edge placement expressed logically so an
 * RTL layout puts it on the correct side.
 */
const rn = vi.hoisted(() => ({
	width: 390,
	textScale: 1,
	pressable: null as null | {
		accessibilityLabel?: string;
		accessibilityRole?: string;
		testID?: string;
		onPress?: () => void;
		style?: Record<string, unknown>;
	},
	text: null as null | string,
	announced: [] as string[],
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: rn.textScale }),
}));
vi.mock("react-native", () => ({
	Platform: { OS: "web" },
	AccessibilityInfo: {
		announceForAccessibility: (message: string) => {
			rn.announced.push(message);
		},
	},
	Pressable: (props: { children?: unknown; onPress?: () => void }) => {
		rn.pressable = props as never;
		return props.children ?? null;
	},
	Text: (props: { children?: unknown }) => {
		rn.text = props.children as string;
		return null;
	},
	useWindowDimensions: () => ({
		width: rn.width,
		height: 844,
		fontScale: 1,
		scale: 2,
	}),
}));

let root: ReturnType<typeof createRoot> | null = null;
let dom: DomShim | null = null;
const render = (onPress: () => void, viewportPt = 600) =>
	act(async () =>
		root?.render(createElement(JumpToLatestChip, { onPress, viewportPt })),
	);
beforeEach(() => {
	rn.width = 390;
	rn.textScale = 1;
	rn.pressable = null;
	rn.text = null;
	rn.announced = [];
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
});

describe("JumpToLatestChip", () => {
	it("is a real 44 pt button whose accessible name has no arrow in it", async () => {
		const onPress = vi.fn();
		await render(onPress);
		expect(rn.pressable?.accessibilityRole).toBe(ROLE.button);
		/* QA/design/UX round 1, Q3: the visible label keeps the glyph, the name a
		 *  screen reader speaks does not — "↓ Jump to latest" reads as "down arrow". */
		expect(rn.pressable?.accessibilityLabel).toBe("Jump to latest");
		expect(rn.pressable?.testID).toBe(CONTROL.transcriptJumpToLatest);
		expect(Number(rn.pressable?.style?.minHeight)).toBeGreaterThanOrEqual(
			TOUCH_FLOOR,
		);
		act(() => rn.pressable?.onPress?.());
		expect(onPress).toHaveBeenCalledTimes(1);
	});

	it("shows the full label on a normal phone", async () => {
		await render(() => {});
		expect(rn.text).toBe("↓ Jump to latest");
	});

	it("shortens the visible label on the 320 pt phone, never the accessible name", async () => {
		rn.width = 320;
		await render(() => {});
		expect(rn.text).toBe("↓ Latest");
		expect(rn.pressable?.accessibilityLabel).toBe("Jump to latest");
	});

	/* Design round 1, D2: the ladder used the window width alone, so at 200 % text
	 * a 390 pt phone still showed the full sentence — 247 pt wide, across a whole
	 * row and over the turn header's trailing counter. The width that matters is
	 * the one the text gets. */
	it("shortens the visible label at large text on the same width", async () => {
		rn.textScale = 2;
		await render(() => {});
		expect(rn.text).toBe("↓ Latest");
	});

	/* Design round 1, D1: in compact landscape the transcript is a strip a few
	 * points tall; anchored to its bottom edge the chip spilled above it and
	 * covered the activity-summary control (U-08 FAIL at 100 % and 200 %). */
	it("renders nothing when the transcript is too short to hold it", async () => {
		await render(() => {}, JUMP_CHIP_MIN_VIEWPORT_PT - 1);
		expect(rn.pressable).toBeNull();
		expect(rn.text).toBeNull();
		expect(rn.announced).toEqual([]);
	});

	it("takes the space it needs from the viewport it is given", async () => {
		await render(() => {}, JUMP_CHIP_MIN_VIEWPORT_PT);
		expect(rn.pressable).not.toBeNull();
	});

	/* UX round 1, U2: a VoiceOver reader who left the end heard nothing when
	 * output landed below them. The appearance is announced, in the control's own
	 * translated words (no new sentence to translate). */
	it("announces its arrival when it appears", async () => {
		await render(() => {});
		expect(rn.announced).toEqual(["Jump to latest"]);
	});

	it("anchors to the trailing edge above the bottom fade, in logical terms", async () => {
		await render(() => {});
		const style = rn.pressable?.style ?? {};
		expect(style.end).toBeGreaterThan(0);
		expect(style.bottom).toBeGreaterThan(24);
		expect(style.left).toBeUndefined();
		expect(style.right).toBeUndefined();
	});
});
