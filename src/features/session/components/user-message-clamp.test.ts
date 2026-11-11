import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The reader's own long message: clipped to the desktop's eight lines under a
 * fade, with `Show more` / `Show less` (operator report, iOS build 836: his
 * messages were cut to one line with no way to open them).
 *
 * Three layers, the repo's convention for a component whose contract is
 * behaviour rather than pixels (`collapsed-row.test.ts`):
 *  - the clamp DECISION, a pure function of the content's height in lines;
 *  - the WRAPPER, rendered through `react-dom` with a stubbed `react-native`
 *    host so a layout and a press can be driven by hand;
 *  - the ROW, as a source check (`transcript-row.test.ts` gives why: it reaches
 *    `uniwind`, which Node cannot render) — the condensed path must keep the
 *    message behind the same clamp, never the old one-line `numberOfLines`.
 */

type HostProps = {
	children?: unknown;
	className?: string;
	style?: { maxHeight?: number; overflow?: string; minHeight?: number };
	onLayout?: (event: { nativeEvent: { layout: { height: number } } }) => void;
	onPress?: () => void;
	accessibilityRole?: string;
	accessibilityLabel?: string;
	accessibilityState?: { expanded?: boolean };
	testID?: string;
	stopColor?: string;
	stopOpacity?: number;
};
const rig = vi.hoisted(() => ({
	/** Every host element drawn in the latest render pass, in order. */
	hosts: [] as { host: string; props: HostProps }[],
	scale: 1,
}));

vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: rig.scale, scale: rig.scale }),
}));

vi.mock("@/ui/appearance", async () => {
	const { THEMES } = await import("@/ui/tokens.gen");
	return { useTheme: () => ({ active: THEMES[0] }) };
});

const host =
	(name: string) => (props: HostProps & { children?: React.ReactNode }) => {
		rig.hosts.push({ host: name, props });
		return props.children ?? null;
	};

vi.mock("react-native", () => ({
	Platform: { OS: "ios" },
	View: host("View"),
	Text: host("Text"),
	Pressable: host("Pressable"),
	StyleSheet: { create: (v: unknown) => v, flatten: (v: unknown) => v },
}));

vi.mock("react-native-svg", () => ({
	default: host("Svg"),
	Defs: host("Defs"),
	LinearGradient: host("LinearGradient"),
	Rect: host("Rect"),
	Stop: host("Stop"),
}));

const { UserMessageClamp } = await import(
	"@/features/session/components/user-message-clamp"
);
const {
	USER_MESSAGE_CLAMP_LINES,
	needsUserMessageClamp,
	nextUserMessageExpanded,
	userMessageClipHeight,
	userMessageLineHeight,
} = await import("@/features/session/user-message-clamp");
const { userBubbleFill } = await import("@/features/session/user-bubble");
const { THEMES } = await import("@/ui/tokens.gen");
const { TOUCH_FLOOR } = await import("@/ui/layout");

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;

type Controlled = { expanded: boolean; onToggle: (next: boolean) => void };

const render = async (controlled?: Controlled) => {
	rig.hosts.length = 0;
	await act(async () =>
		root?.render(
			createElement(
				UserMessageClamp,
				{ testID: "row-more", ...controlled } as unknown as Parameters<
					typeof UserMessageClamp
				>[0],
				createElement("span", null, "the message"),
			),
		),
	);
};

/** The latest pass's elements of one host kind. */
const last = (name: string) => {
	const all = rig.hosts.filter((h) => h.host === name);
	return all;
};
/** Presses the latest control, then keeps only the pass the press caused. */
const press = async () => {
	const onPress = control()?.onPress;
	rig.hosts.length = 0;
	await act(async () => onPress?.());
};
const control = () =>
	rig.hosts.filter((h) => h.host === "Pressable").at(-1)?.props;
/** Lays the content out `lines` lines tall and lets React settle. */
const layOut = async (lines: number) => {
	const content = rig.hosts.find((h) => h.props.onLayout)?.props;
	rig.hosts.length = 0;
	await act(async () =>
		content?.onLayout?.({
			nativeEvent: {
				layout: { height: lines * userMessageLineHeight(rig.scale) },
			},
		}),
	);
};

beforeEach(() => {
	rig.scale = 1;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
});

describe("the clamp decision, by line count", () => {
	it("is the desktop's eight lines of the bubble's body-read step", () => {
		expect(USER_MESSAGE_CLAMP_LINES).toBe(8);
		// 14 pt x 1.55 = 21.7 pt a line; 8 lines = 173.6 (the desktop's 174 px).
		expect(userMessageClipHeight(1)).toBeCloseTo(173.6, 5);
	});

	it.each([1, 2])("clamps only past eight lines at %sx text", (scale) => {
		const line = userMessageLineHeight(scale);
		expect(needsUserMessageClamp(1 * line, scale)).toBe(false);
		expect(needsUserMessageClamp(8 * line, scale)).toBe(false);
		// Layout rounding can add a hair to an exact fit: no control for it.
		expect(needsUserMessageClamp(8 * line + 0.9, scale)).toBe(false);
		expect(needsUserMessageClamp(9 * line, scale)).toBe(true);
	});

	it("a press flips the state", () => {
		expect(nextUserMessageExpanded(false)).toBe(true);
		expect(nextUserMessageExpanded(true)).toBe(false);
	});
});

describe("the wrapper", () => {
	it("clips from the first frame, before any measurement, with no control yet", async () => {
		await render();
		const outer = rig.hosts.find((h) => h.props.style?.maxHeight);
		expect(outer?.props.style).toEqual({
			maxHeight: userMessageClipHeight(1),
			overflow: "hidden",
		});
		expect(control()).toBeUndefined();
		expect(last("Svg")).toHaveLength(0);
	});

	it("shows a short message in full, with no control and no fade", async () => {
		await render();
		await layOut(3);
		expect(control()).toBeUndefined();
		expect(last("Svg")).toHaveLength(0);
	});

	it("clamps a long message under a fade in the bubble's own fill, with Show more", async () => {
		await render();
		await layOut(20);
		const press = control();
		expect(press?.accessibilityRole).toBe("button");
		expect(press?.accessibilityLabel).toBe("Show more");
		expect(press?.accessibilityState).toEqual({ expanded: false });
		expect(press?.testID).toBe("row-more");
		// A 44 pt (iOS) / 48 dp floor of real geometry.
		expect(press?.style?.minHeight).toBe(TOUCH_FLOOR);
		expect(TOUCH_FLOOR).toBeGreaterThanOrEqual(44);
		const fill = userBubbleFill(THEMES[0]).backgroundColor;
		const stops = last("Stop").map((s) => s.props);
		expect(stops.map((s) => [s.stopColor, s.stopOpacity])).toEqual([
			[fill, 0],
			[fill, 1],
		]);
	});

	it("Show more releases the clip and the fade; Show less restores both", async () => {
		await render();
		await layOut(20);
		await press();
		expect(control()?.accessibilityLabel).toBe("Show less");
		expect(control()?.accessibilityState).toEqual({ expanded: true });
		expect(rig.hosts.some((h) => h.props.style?.maxHeight)).toBe(false);
		expect(last("Svg")).toHaveLength(0);

		await press();
		expect(control()?.accessibilityLabel).toBe("Show more");
		expect(rig.hosts.some((h) => h.props.style?.maxHeight)).toBe(true);
		expect(last("Svg")).toHaveLength(1);
	});

	it("defers to the list's row-open state when the caller owns it", async () => {
		const onToggle = vi.fn();
		await render({ expanded: false, onToggle });
		await layOut(20);
		await act(async () => control()?.onPress?.());
		expect(onToggle).toHaveBeenCalledWith(true);
		// Not flipped locally: the list re-renders the row with its new state.
		expect(control()?.accessibilityLabel).toBe("Show more");

		await render({ expanded: true, onToggle });
		expect(control()?.accessibilityLabel).toBe("Show less");
		expect(rig.hosts.some((h) => h.props.style?.maxHeight)).toBe(false);
	});

	it("re-measures at large text against the scaled clip", async () => {
		rig.scale = 2;
		await render();
		await layOut(8);
		expect(control()).toBeUndefined();
		await layOut(9);
		expect(control()?.accessibilityLabel).toBe("Show more");
	});
});

const read = (file: string): string =>
	readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const code = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const CLAMP_BY_STEER_ONLY =
	/isSteer \? \(\s*text\s*\) : \(\s*<UserMessageClamp/;
const CLAMP_GATED_ON_CONDENSED = /condensed[^;]*UserMessageClamp/;
const ROW = code(read("./transcript-row.tsx"));
const userArm = ROW.slice(
	ROW.indexOf('if (kind === "user" || kind === "steer")'),
	ROW.indexOf('if (kind === "reasoning")'),
);

describe("the user row (condensed or live)", () => {
	it("never clamps the prompt to an unexpandable line", () => {
		expect(userArm.length).toBeGreaterThan(0);
		expect(userArm).not.toContain("numberOfLines");
	});

	it("puts every prompt behind the clamp, whatever `condensed` says", () => {
		// The clamp is chosen by steer-or-not only; `condensed` reaches the
		// image strip and nothing else.
		expect(userArm).toMatch(CLAMP_BY_STEER_ONLY);
		expect(userArm).toContain("expanded={fold.open}");
		expect(userArm).toContain("onToggle={fold.onToggle}");
		expect(userArm).toContain("const holdImages = condensed && !isSteer;");
		expect(userArm).not.toMatch(CLAMP_GATED_ON_CONDENSED);
	});
});
