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
	/** Index into `THEMES` the mocked `useTheme` reports as active. */
	theme: 0,
}));

vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: rig.scale, scale: rig.scale }),
}));

vi.mock("@/ui/appearance", async () => {
	const { THEMES } = await import("@/ui/tokens.gen");
	return { useTheme: () => ({ active: THEMES[rig.theme] }) };
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

const { UserMessageClamp, UserMessageCollapseContext } = await import(
	"@/features/session/components/user-message-clamp"
);
const {
	USER_MESSAGE_CLAMP_LINES,
	needsUserMessageClamp,
	nextUserMessageExpanded,
	userMessageClipHeight,
	userMessageLineHeight,
	userMessageControlMarginTop,
	collapseScrollOffset,
	USER_MESSAGE_MORE_GROWTH,
	USER_MESSAGE_COLLAPSE_INSET,
} = await import("@/features/session/user-message-clamp");
const { userBubbleFill } = await import("@/features/session/user-bubble");
const { THEMES } = await import("@/ui/tokens.gen");
const { TOUCH_FLOOR } = await import("@/ui/layout");

/** An opaque fill: a full-opacity stop on it composites exactly to the bubble. */
const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;

type Controlled = { expanded: boolean; onToggle: (next: boolean) => void };

type RenderOptions = {
	/** The scroller's keep-in-view hook (D2); omitted, no provider at all. */
	keepInView?: (anchor: unknown) => void;
	anchorRef?: { current: unknown };
	/** A render-function body, handed the clamp's `expand` (R1-m1). */
	body?: (expand: () => void) => React.ReactNode;
};

const render = async (controlled?: Controlled, options: RenderOptions = {}) => {
	rig.hosts.length = 0;
	const clamp = createElement(UserMessageClamp, {
		testID: "row-more",
		...controlled,
		anchorRef: options.anchorRef,
		children: options.body ?? createElement("span", null, "the message"),
	} as unknown as Parameters<typeof UserMessageClamp>[0]);
	await act(async () =>
		root?.render(
			options.keepInView
				? createElement(
						UserMessageCollapseContext.Provider,
						{ value: options.keepInView as never },
						clamp,
					)
				: clamp,
		),
	);
};

/** Every recorded element of one host kind — the latest pass's only because
 *  each driver (`render`, `press`, `layOut`) clears `rig.hosts` first. */
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
	rig.theme = 0;
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

	// Every palette, light and dark (review PR #235 R1 m2): the fade must end
	// at full opacity on that palette's own bubble fill, or it shows as a band.
	it.each(
		THEMES.map(
			(theme, index) => [`${theme.id} (${theme.mode})`, index, theme] as const,
		),
	)("fades into the bubble's fill in theme %s", async (_name, index, theme) => {
		rig.theme = index;
		await render();
		await layOut(20);
		const fill = userBubbleFill(theme).backgroundColor;
		expect(fill).toMatch(OPAQUE_HEX);
		expect(
			last("Stop").map((s) => [s.props.stopColor, s.props.stopOpacity]),
		).toEqual([
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

/* Design follow-up to PR #235, D1: the collapsed control added a full 48 pt
 *  band under every long prompt. It keeps the touch floor but overlaps the
 *  fade, so only 32 pt is new height; expanded it sits below the text. */
describe("the control's footprint (D1)", () => {
	it("pulls the collapsed floor up over the fade so only 32 pt is added", () => {
		expect(USER_MESSAGE_MORE_GROWTH).toBe(32);
		expect(userMessageControlMarginTop(false, 48)).toBe(-16);
		expect(userMessageControlMarginTop(false, 44)).toBe(-12);
		for (const floor of [44, 48]) {
			expect(floor + userMessageControlMarginTop(false, floor)).toBe(32);
		}
		// Expanded: no fade to overlap, and Show less must not sit on the text.
		expect(userMessageControlMarginTop(true, 48)).toBe(0);
		// A floor at or under the growth has nothing to pull up.
		expect(userMessageControlMarginTop(false, 30)).toBe(-0);
	});

	it("keeps the whole touch floor and overlaps only while collapsed", async () => {
		await render();
		await layOut(20);
		expect(control()?.style).toEqual({
			minHeight: TOUCH_FLOOR,
			marginTop: -(TOUCH_FLOOR - 32),
		});
		await press();
		expect(control()?.style).toEqual({ minHeight: TOUCH_FLOOR, marginTop: 0 });
	});
});

/* D2: Show less on a message whose top scrolled above the list brings that
 *  top back to just under the edge; one already on screen does not move. */
describe("keeping the bubble in view on Show less (D2)", () => {
	it("leaves a bubble whose top is on screen where it is", () => {
		expect(
			collapseScrollOffset({ bubbleTop: 300, viewportTop: 100, offsetY: 900 }),
		).toBeNull();
		// Flush with the edge is on screen too: no motion for nothing.
		expect(
			collapseScrollOffset({ bubbleTop: 100, viewportTop: 100, offsetY: 900 }),
		).toBeNull();
	});

	it("brings a top above the viewport to 8-12 pt under the list's edge", () => {
		expect(USER_MESSAGE_COLLAPSE_INSET).toBeGreaterThanOrEqual(8);
		expect(USER_MESSAGE_COLLAPSE_INSET).toBeLessThanOrEqual(12);
		const viewportTop = 100;
		const offsetY = 2000;
		const bubbleTop = -600;
		const offset = collapseScrollOffset({ bubbleTop, viewportTop, offsetY });
		expect(offset).toBe(2000 - 700 - USER_MESSAGE_COLLAPSE_INSET);
		// Where the bubble's top lands once the list is at that offset.
		const landed = bubbleTop + (offsetY - (offset ?? 0));
		expect(landed - viewportTop).toBe(USER_MESSAGE_COLLAPSE_INSET);
	});

	it("never scrolls past the head of the content", () => {
		expect(
			collapseScrollOffset({ bubbleTop: 95, viewportTop: 100, offsetY: 3 }),
		).toBe(0);
	});

	it("asks the scroller to keep the bubble in view on Show less, never on Show more", async () => {
		const keepInView = vi.fn();
		const bubble = { current: { bubble: true } };
		await render(undefined, { keepInView, anchorRef: bubble });
		await layOut(20);
		await press();
		expect(control()?.accessibilityLabel).toBe("Show less");
		expect(keepInView).not.toHaveBeenCalled();
		await press();
		expect(control()?.accessibilityLabel).toBe("Show more");
		expect(keepInView).toHaveBeenCalledTimes(1);
		expect(keepInView).toHaveBeenCalledWith(bubble.current);
	});

	it("asks on the controlled path too (the list's row-open map)", async () => {
		const keepInView = vi.fn();
		const onToggle = vi.fn();
		const bubble = { current: { bubble: true } };
		await render(
			{ expanded: true, onToggle },
			{ keepInView, anchorRef: bubble },
		);
		await layOut(20);
		await act(async () => control()?.onPress?.());
		expect(onToggle).toHaveBeenCalledWith(false);
		expect(keepInView).toHaveBeenCalledWith(bubble.current);
	});

	it("collapses in place outside a scroller", async () => {
		await render(undefined, { anchorRef: { current: {} } });
		await layOut(20);
		await press();
		await press();
		expect(control()?.accessibilityLabel).toBe("Show more");
	});
});

/* PR #237 review, R1-m1: the iOS selection view inside a closed clamp was
 *  clipped at eight lines, its end handle out of reach. The body is handed
 *  `expand`, which opens a clamped, closed message and does nothing else. */
describe("opening before selection (R1-m1)", () => {
	const withExpand = () => {
		const holder: { expand?: () => void } = {};
		const body = (expand: () => void) => {
			holder.expand = expand;
			return createElement("span", null, "the message");
		};
		return { holder, body };
	};

	it("opens a clamped, closed message", async () => {
		const { holder, body } = withExpand();
		await render(undefined, { body });
		await layOut(20);
		expect(control()?.accessibilityLabel).toBe("Show more");
		rig.hosts.length = 0;
		await act(async () => holder.expand?.());
		expect(control()?.accessibilityLabel).toBe("Show less");
		expect(rig.hosts.some((h) => h.props.style?.maxHeight)).toBe(false);
	});

	it("asks the list to open it when the list owns the state", async () => {
		const { holder, body } = withExpand();
		const onToggle = vi.fn();
		await render({ expanded: false, onToggle }, { body });
		await layOut(20);
		await act(async () => holder.expand?.());
		expect(onToggle).toHaveBeenCalledWith(true);
	});

	it("writes nothing for a message with nothing hidden, or already open", async () => {
		const { holder, body } = withExpand();
		const onToggle = vi.fn();
		await render({ expanded: false, onToggle }, { body });
		await layOut(3);
		await act(async () => holder.expand?.());
		await render({ expanded: true, onToggle }, { body });
		await layOut(20);
		await act(async () => holder.expand?.());
		expect(onToggle).not.toHaveBeenCalled();
	});
});

const read = (file: string): string =>
	readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const code = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
/** Every non-empty message is clamped, steer or prompt (operator report, iOS
 *  2026-11-11: a steer now takes the bubble, so it takes the clamp too). */
const CLAMP_EVERY_MESSAGE =
	/entry\.text\.length === 0 \? null : \(\s*<UserMessageClamp/;
const ECHO_CLAMP_EVERY_MESSAGE =
	/echo\.text\.length === 0 \? null : \(\s*<UserMessageClamp[^>]*>\s*<Text[^>]*>\{echo\.text\}<\/Text>\s*<\/UserMessageClamp>/;
const CLAMP_GATED_ON_CONDENSED = /condensed[^;]*UserMessageClamp/;
const ROW = code(read("./transcript-row.tsx"));
const userArm = ROW.slice(
	ROW.indexOf('if (kind === "user" || kind === "steer")'),
	ROW.indexOf('if (kind === "reasoning")'),
);

const ECHO = code(read("./pending-echo-row.tsx"));

describe("the pending echo (the same message in flight)", () => {
	// The echo IS the settled message before the daemon echoes it
	// (`user-bubble.ts`): a long prompt must be clipped in flight exactly as
	// the settled row clips it, or it shrinks at handover (review R1-M1).
	it("puts every message, steer or prompt, behind the same clamp", () => {
		expect(ECHO).toContain(
			'import { UserMessageClamp } from "@/features/session/components/user-message-clamp";',
		);
		expect(ECHO).toMatch(ECHO_CLAMP_EVERY_MESSAGE);
		// The settled arm chooses the same way.
		expect(userArm).toMatch(CLAMP_EVERY_MESSAGE);
	});

	it("is uncontrolled: an echo has no row-open state to defer to", () => {
		const clamp = ECHO.slice(ECHO.indexOf("<UserMessageClamp"));
		const open = clamp.slice(0, clamp.indexOf(">"));
		expect(open).not.toContain("expanded=");
		expect(open).not.toContain("onToggle=");
	});
});

describe("the user row (condensed or live)", () => {
	it("never clamps the prompt to an unexpandable line", () => {
		expect(userArm.length).toBeGreaterThan(0);
		expect(userArm).not.toContain("numberOfLines");
	});

	it("puts every prompt behind the clamp, whatever `condensed` says", () => {
		// Every message is clamped; `condensed` reaches the image strip and
		// nothing else.
		expect(userArm).toMatch(CLAMP_EVERY_MESSAGE);
		expect(userArm).toContain("expanded={fold.open}");
		expect(userArm).toContain("onToggle={fold.onToggle}");
		expect(userArm).toContain("const holdImages = condensed && !isSteer;");
		expect(userArm).not.toMatch(CLAMP_GATED_ON_CONDENSED);
	});
});

describe("the scroller and the bubbles it keeps in view (D2)", () => {
	const LIST = code(read("./transcript-list.tsx"));

	it("the list provides the keep-in-view hook around its scroller", () => {
		expect(LIST).toContain(
			"<UserMessageCollapseContext.Provider value={keepCollapsedTopInView}>",
		);
		const hook = LIST.slice(LIST.indexOf("const keepCollapsedTopInView"));
		const body = hook.slice(0, hook.indexOf("[sessionId]"));
		expect(body).toContain("collapseScrollOffset(");
		// The move is the reader's: it must take them off the tail first, or
		// the collapse's content-size change re-pins them to the end.
		expect(body.indexOf("atTail.current = false")).toBeLessThan(
			body.indexOf("scrollToOffset"),
		);
	});

	it("settled rows and pending echoes anchor on their bubble", () => {
		expect(userArm).toContain("anchorRef={bubble}");
		expect(ECHO).toContain("anchorRef={bubble}");
		expect(ECHO).toContain("ref={bubble}");
	});
});
