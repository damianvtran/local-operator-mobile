/**
 * TestFlight 1295 (operator, iPhone): "The model search doesn't properly work on
 * mobile, the search input doesn't move up with the keyboard so I can't see
 * what I'm typing or what the matched options are".
 *
 * The cause: `Sheet` lives in a native `Modal`, which is not resized for the
 * keyboard, and the sheet had no keyboard handling at all — its cap assumed the
 * column shrinks with the keyboard, which only the web does. These tests mount
 * the REAL `Sheet` (and the real `RunSettingsPicker`) through react-dom and drive the
 * keyboard through #216's keyboard store, the one boundary that is native.
 *
 * `react-native` is reduced to recording hosts: every kit node registers its
 * latest props and its ancestry under a key (its `testID`, or `dialog` for the
 * surface), so a test reads the geometry the sheet ASKED for — the spacer's
 * height, the body's `maxHeight` — and where a node sits in the tree. Layout
 * itself is native and is not what these assert.
 */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelEntry } from "@/contracts";
import type { HomeModelRow } from "@/features/home/home-defaults";
import type { KeyboardFrame } from "@/features/session/keyboard-frame";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/* `Sheet` imports reanimated and gesture-handler; Node has neither (see the
 * shared reduction's own note). */
vi.mock("react-native-reanimated", async () => {
	const { reanimatedModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return reanimatedModuleMock();
});
vi.mock("react-native-gesture-handler", async () => {
	const { gestureHandlerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return gestureHandlerModuleMock();
});

const WINDOW = { width: 390, height: 844 };
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
const KEYBOARD = 336;

type Rec = { props: Record<string, unknown>; path: string[] };
const host = vi.hoisted(() => ({
	nodes: new Map<string, Rec>(),
	platform: "ios" as string,
	layoutAnimations: [] as { duration: number; type: string }[],
	/* What `useModalExit` reports: true while a closed sheet's exit runs. */
	exiting: false,
	/* Every ScrollView's latest props, keyed or not (the slash sheet's nested
	 *  list has no testID). */
	scrollViews: [] as Record<string, unknown>[],
}));

/** #216's keyboard store, controllable: same exports, same contract. */
const store = vi.hoisted(() => {
	const listeners = new Set<(frame: KeyboardFrame) => void>();
	const hidden: KeyboardFrame = { visible: false, overlap: 0, duration: 200 };
	return {
		hidden,
		current: hidden,
		listeners,
		emit(frame: KeyboardFrame) {
			this.current = frame;
			for (const listener of [...listeners]) listener(frame);
		},
	};
});
vi.mock("@/features/session/keyboard-frame", async () => {
	/* The REAL event→frame arithmetic, so the Android case below is fed what
	 *  the store would make of a resizing window's event. */
	const actual = await vi.importActual<
		typeof import("@/features/session/keyboard-frame")
	>("@/features/session/keyboard-frame");
	return {
		KEYBOARD_HIDDEN: store.hidden,
		keyboardFrameFrom: actual.keyboardFrameFrom,
		subscribeKeyboardFrame: (listener: (f: KeyboardFrame) => void) => {
			store.listeners.add(listener);
			return () => {
				store.listeners.delete(listener);
			};
		},
		keyboardFrameNow: () => store.current,
	};
});

vi.mock("react-native", async () => {
	const React = await import("react");
	const Path = React.createContext<string[]>([]);
	/** A host that renders its children and records its props under a key. */
	const recorder = (kind: string) =>
		function Recorded(props: Record<string, unknown>) {
			const path = React.useContext(Path);
			const key =
				(props.testID as string | undefined) ??
				(props.role === "dialog" ? "dialog" : undefined);
			React.useLayoutEffect(() => {
				if (key === undefined) return;
				host.nodes.set(key, { props, path });
			});
			React.useLayoutEffect(
				() => () => {
					if (key !== undefined) host.nodes.delete(key);
				},
				[key],
			);
			const children =
				typeof props.children === "function"
					? (props.children as (s: { pressed: boolean }) => ReactNode)({
							pressed: false,
						})
					: (props.children as ReactNode);
			return React.createElement(
				Path.Provider,
				{ value: key === undefined ? path : [...path, key] },
				React.createElement(kind === "Text" ? "span" : "div", null, children),
			);
		};
	class Value {
		constructor(public v: number) {}
		setValue(v: number) {
			this.v = v;
		}
		interpolate() {
			return 0;
		}
	}
	const done = { start: (cb?: () => void) => cb?.() };
	const ScrollRecorder = recorder("ScrollView");
	return {
		AccessibilityInfo: { setAccessibilityFocus: () => {} },
		Animated: {
			View: recorder("View"),
			Value,
			timing: () => done,
			parallel: () => done,
		},
		Easing: { bezier: () => () => 0 },
		findNodeHandle: () => null,
		LayoutAnimation: {
			configureNext: (c: { update: { duration: number; type: string } }) => {
				host.layoutAnimations.push(c.update);
			},
			Types: { keyboard: "keyboard", easeInEaseOut: "easeInEaseOut" },
		},
		Modal: (p: { visible: boolean; children?: ReactNode }) =>
			p.visible ? React.createElement(React.Fragment, null, p.children) : null,
		Platform: {
			get OS() {
				return host.platform;
			},
			select: (o: Record<string, unknown>) => o[host.platform] ?? o.default,
		},
		Pressable: recorder("Pressable"),
		ScrollView: (props: Record<string, unknown>) => {
			host.scrollViews.push(props);
			return React.createElement(ScrollRecorder, props);
		},
		Text: recorder("Text"),
		TextInput: recorder("TextInput"),
		View: recorder("View"),
		useWindowDimensions: () => WINDOW,
	};
});
vi.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => INSETS,
}));
vi.mock("react-native-svg", () => {
	const Null = () => null;
	return {
		default: Null,
		Defs: Null,
		LinearGradient: Null,
		Rect: Null,
		Stop: Null,
	};
});
vi.mock("uniwind", () => ({
	ScopedVariables: (p: { children?: ReactNode }) => p.children ?? null,
}));
vi.mock("lucide-react-native", () => ({ X: () => null, Folder: () => null }));
vi.mock("@/lib/haptics", () => ({ haptic: () => {} }));
vi.mock("@/ui/appearance", () => ({
	useReducedMotion: () => false,
	useTokenColor: () => "#000000",
	useTheme: () => ({ isDark: false }),
}));
vi.mock("@/ui/elevation", () => ({ useShadow: () => ({}) }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ variables: {}, effectiveScale: 1 }),
}));
/* The sheet's column: recorded under `column` so a test can fire its onLayout. */
vi.mock("@/ui/direction", async () => {
	const React = await import("react");
	const { View } = await import("react-native");
	return {
		DirectionView: (p: Record<string, unknown>) =>
			React.createElement(View, { ...p, testID: "column" }),
		/* The run-settings sheet's section headings (`SectionHeader`) read it. */
		useDirection: () => "ltr",
		/* Its summary line states the page's base; `{}` on an LTR page. */
		useComposedDir: () => ({}),
	};
});
vi.mock("@/ui/components/modal-stack-entry", async () => {
	const React = await import("react");
	return {
		ModalScopeContext: React.createContext(null),
		useModalStackEntry: () => ({ covered: false, dims: true, scope: null }),
	};
});
vi.mock("@/ui/modal-dismissal-ledger", () => ({
	useModalDismissal: () => () => {},
}));
vi.mock("@/ui/modal-exit", () => ({
	createTransitionTick: () => () => {},
	exitPointerEvents: () => "auto",
	useModalExit: () => host.exiting,
}));
vi.mock("@/ui/components/input", async () => {
	const { TextInput } = await import("react-native");
	return { Input: TextInput };
});
/* Leaves the picker draws that this contract does not read. The barrel is
 *  narrowed to `Sheet` because it re-exports every kit component (and with
 *  them reanimated's native worklets, which do not load in Node). */
vi.mock("@/ui/components/alert", () => ({ Alert: () => null }));
vi.mock("@/ui/components/badge", () => ({ Badge: () => null }));
vi.mock("@/ui/components/button", () => ({ Button: () => null }));
vi.mock("@/ui/components", async () => ({
	Sheet: (await import("./sheet")).Sheet,
}));

const { Sheet } = await import("./sheet");
const { SURFACE, CONTROL } = await import("@/ui/a11y");
const { RunSettingsPicker } = await import("@/features/home/home-pickers");
const { modelOptionId, slashCommandId } = await import("@/ui/a11y");
const { MODEL_SEARCH_THRESHOLD } = await import(
	"@/features/home/picker-search-threshold"
);

const node = (key: string) => host.nodes.get(key);
const spacerHeight = () =>
	(node(SURFACE.sheetKeyboardSpacer)?.props.style as { height?: number })
		?.height ?? 0;
const bodyPadding = () =>
	(
		node(SURFACE.sheetBody)?.props.contentContainerStyle as
			| { paddingBottom?: number }
			| undefined
	)?.paddingBottom;
const bodyMinHeight = () =>
	(node(SURFACE.sheetBody)?.props.style as { minHeight?: number } | undefined)
		?.minHeight;
const bodyMaxHeight = () =>
	(node(SURFACE.sheetBody)?.props.style as { maxHeight?: number } | undefined)
		?.maxHeight;
/** Fire the native layout the sheet measures its chrome from. */
const layout = (key: string, height: number) =>
	act(() => {
		(node(key)?.props.onLayout as (e: unknown) => void)?.({
			nativeEvent: { layout: { height, width: WINDOW.width } },
		});
	});
const showKeyboard = (overlap = KEYBOARD) =>
	act(() =>
		store.emit({ visible: true, overlap, duration: 250 } as KeyboardFrame),
	);
const hideKeyboard = () => act(() => store.emit(store.hidden));

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	host.nodes.clear();
	host.platform = "ios";
	host.layoutAnimations = [];
	host.exiting = false;
	host.scrollViews = [];
	store.current = store.hidden;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

/** The title row's seed (`CHROME_SEED_HEADER`): it has no testID, so its
 *  onLayout is never fired here and the sheet spends the seed. */
const TITLE_ROW = 64;
const PINNED = 56;
const mountSheet = async (pinned?: ReactNode, visible = true) => {
	await act(async () =>
		root.render(
			<Sheet
				visible={visible}
				onClose={() => {}}
				title="Model"
				detent="full"
				pinned={pinned}
			>
				<p>rows</p>
			</Sheet>,
		),
	);
};

describe("Sheet over the software keyboard (TestFlight 1295)", () => {
	it("lifts the surface onto the keyboard and caps it between the safe top and the keyboard top", async () => {
		await mountSheet();
		/* The column fills the Modal's window: a native Modal does not resize. */
		await layout("column", WINDOW.height);
		const keyboardDownCap = bodyMaxHeight();
		expect(keyboardDownCap).toBe(Math.round(WINDOW.height * 0.92) - TITLE_ROW);
		expect(node(SURFACE.sheetKeyboardSpacer)).toBeUndefined();

		await showKeyboard();
		/* The spacer under the bottom-anchored surface IS the lift. */
		expect(spacerHeight()).toBe(KEYBOARD);
		/* Surface = title row + body ≤ window − safe top − keyboard. */
		expect(bodyMaxHeight()).toBe(
			WINDOW.height - INSETS.top - KEYBOARD - TITLE_ROW,
		);
		/* The home-indicator inset is behind the keyboard: not spent. */
		expect(bodyPadding()).toBe(24);
		/* Moved on iOS's own keyboard curve, at the keyboard's duration. */
		expect(host.layoutAnimations).toEqual([
			{ duration: 250, type: "keyboard" },
		]);

		await hideKeyboard();
		expect(node(SURFACE.sheetKeyboardSpacer)).toBeUndefined();
		expect(bodyMaxHeight()).toBe(keyboardDownCap);
		expect(bodyPadding()).toBe(24 + INSETS.bottom);
	});

	it("starts above a keyboard that is already open when it mounts", async () => {
		store.current = { visible: true, overlap: KEYBOARD, duration: 250 };
		await mountSheet();
		expect(spacerHeight()).toBe(KEYBOARD);
	});

	it("spends the pinned region out of the keyboard room too", async () => {
		await mountSheet(<p>search</p>);
		await layout(SURFACE.sheetPinned, PINNED);
		await showKeyboard();
		expect(bodyMaxHeight()).toBe(
			WINDOW.height - INSETS.top - KEYBOARD - TITLE_ROW - PINNED,
		);
	});

	it("holds the cap under a pinned slot so the field does not move as results change (design D2)", async () => {
		await mountSheet(<p>search</p>);
		await layout(SURFACE.sheetPinned, PINNED);
		await showKeyboard();
		const cap = WINDOW.height - INSETS.top - KEYBOARD - TITLE_ROW - PINNED;
		expect(bodyMaxHeight()).toBe(cap);
		expect(bodyMinHeight()).toBe(cap);
	});

	it("keeps hugging its content without a pinned slot", async () => {
		await mountSheet();
		await showKeyboard();
		expect(bodyMaxHeight()).toBeGreaterThan(0);
		expect(bodyMinHeight()).toBeUndefined();
	});

	it("marks the pinned edge with a hairline, and fades rows scrolled under it (design D1)", async () => {
		await mountSheet(<p>search</p>);
		await layout(SURFACE.sheetPinned, PINNED);
		expect(node(SURFACE.sheetPinned)?.props.className).toContain(
			"border-hairline",
		);
		const scroll = (y: number) =>
			act(() =>
				(node(SURFACE.sheetBody)?.props.onScroll as (e: unknown) => void)?.({
					nativeEvent: { contentOffset: { y } },
				}),
			);
		expect(node(SURFACE.sheetPinnedFade)).toBeUndefined();
		await scroll(40);
		const fade = node(SURFACE.sheetPinnedFade)?.props.style as {
			top?: number;
		};
		/* Placed at the pinned region's bottom edge (title seed + pinned). */
		expect(fade?.top).toBe(TITLE_ROW + PINNED);
		await scroll(0);
		expect(node(SURFACE.sheetPinnedFade)).toBeUndefined();
	});

	it("stays on the keyboard through the exit of a sheet closed with the keyboard up (R1-m1)", async () => {
		await mountSheet();
		await showKeyboard();
		expect(spacerHeight()).toBe(KEYBOARD);
		/* A pick closes the sheet; the focused field keeps the keyboard up while
		 *  the Modal stays mounted for the exit. */
		host.exiting = true;
		await mountSheet(undefined, false);
		expect(spacerHeight()).toBe(KEYBOARD);
		/* The exit landed: the frame is dropped with the subscription. */
		host.exiting = false;
		await mountSheet(undefined, false);
		expect(node(SURFACE.sheetKeyboardSpacer)).toBeUndefined();
	});

	it("restores the home-indicator inset with the overlap, not at didHide (R1-n1)", async () => {
		await mountSheet();
		await showKeyboard();
		expect(bodyPadding()).toBe(24);
		/* iOS's hide `willChangeFrame`: overlap 0 while `visible` holds. */
		await act(() =>
			store.emit({ visible: true, overlap: 0, duration: 250 } as KeyboardFrame),
		);
		expect(bodyPadding()).toBe(24 + INSETS.bottom);
	});

	it("does not double-lift on Android when the window already resized for the keyboard", async () => {
		host.platform = "android";
		const { keyboardFrameFrom } = await import(
			"@/features/session/keyboard-frame"
		);
		await mountSheet();
		/* adjustResize that really resized: the column measures the shorter
		 *  window, while `Dimensions` still reports the full one and the event's
		 *  keyboard top sits 336 pt above it — the store's overlap is 336. */
		const resized = WINDOW.height - KEYBOARD;
		await layout("column", resized);
		const frame = keyboardFrameFrom(store.hidden, WINDOW.height, {
			duration: 0,
			endCoordinates: {
				screenX: 0,
				screenY: WINDOW.height - KEYBOARD,
				width: WINDOW.width,
				height: KEYBOARD,
			},
		});
		expect(frame.overlap).toBe(KEYBOARD);
		await act(() => store.emit(frame));
		expect(node(SURFACE.sheetKeyboardSpacer)).toBeUndefined();
		expect(bodyMaxHeight()).toBe(resized - INSETS.top - TITLE_ROW);
		/* Android has no keyboard curve: the generic ease, not `keyboard`. */
		expect(host.layoutAnimations).toEqual([
			{ duration: 200, type: "easeInEaseOut" },
		]);
	});

	it("lifts on Android edge-to-edge, where the window is not resized", async () => {
		host.platform = "android";
		await mountSheet();
		await layout("column", WINDOW.height);
		await showKeyboard();
		expect(spacerHeight()).toBe(KEYBOARD);
	});
});

/* One past `MODEL_SEARCH_THRESHOLD`: the list long enough to earn a search. */
const MODELS: ModelEntry[] = Array.from(
	{ length: MODEL_SEARCH_THRESHOLD + 1 },
	(_, i) => ({
		selector: `openai/m-${i}`,
		provider: "openai",
		model_id: `m-${i}`,
		name: `Model ${i}`,
	}),
);
const ROWS = MODELS.map((model) => ({
	kind: "model",
	model,
	selected: false,
	isDefault: false,
})) as unknown as HomeModelRow[];

/* #335 (maintainer's ruling, 2026-11-24): the run-settings sheet leads with
 *  the effort rungs, and the model search is pinned — #343's keyboard fix —
 *  but only once the reader has scrolled to the model list it filters. */
describe("RunSettingsPicker model search (TestFlight 1295, #335)", () => {
	const MODEL_TOP = 180;
	const mountPicker = async (
		onPick: (m: ModelEntry | null) => void,
		{ visible = true, models = MODELS } = {},
	) =>
		act(async () =>
			root.render(
				<RunSettingsPicker
					visible={visible}
					onClose={() => {}}
					editable
					summary="Model 0"
					model={{
						models,
						rows: ROWS.slice(0, models.length),
						chosen: false,
						loading: false,
						failure: null,
						onRetry: () => {},
						retrying: false,
						onPick,
					}}
					effort={{
						offer: { kind: "ladder", rungs: ["low", "high"], exact: true },
						chosen: null,
						defaultEffort: null,
						onPick: () => {},
					}}
				/>,
			),
		);
	/** The model section's place in the body, as native layout reports it. */
	const layoutModels = (y = MODEL_TOP) =>
		act(() => {
			(node(CONTROL.homeModelPicker)?.props.onLayout as (e: unknown) => void)?.(
				{
					nativeEvent: {
						layout: { x: 0, y, width: WINDOW.width, height: 900 },
					},
				},
			);
		});
	/** The body's viewport, content and offset — the three scroll facts. */
	const scrollBody = (y: number, viewport = 400, content = 1200) =>
		act(() => {
			const body = node(SURFACE.sheetBody)?.props;
			(body?.onLayout as (e: unknown) => void)?.({
				nativeEvent: { layout: { height: viewport, width: WINDOW.width } },
			});
			(body?.onContentSizeChange as (w: number, h: number) => void)?.(
				WINDOW.width,
				content,
			);
			(body?.onScroll as (e: unknown) => void)?.({
				nativeEvent: { contentOffset: { x: 0, y } },
			});
		});
	const reachModels = async () => {
		await layoutModels();
		await scrollBody(MODEL_TOP);
	};

	it("leads with the effort rungs: no search field at the top of the sheet", async () => {
		await mountPicker(() => {});
		await layoutModels();
		await scrollBody(0);
		expect(node(CONTROL.homeModelSearch)).toBeUndefined();
		expect(node(SURFACE.sheetPinned)).toBeUndefined();
		// Effort, then the models: the rungs are above the list in the body.
		expect(node(CONTROL.homeEffortPicker)?.path).toContain(SURFACE.sheetBody);
	});

	it("pins the search field above the scrolling results once the reader reaches the models", async () => {
		await mountPicker(() => {});
		await layoutModels();
		await scrollBody(MODEL_TOP - 1);
		expect(node(CONTROL.homeModelSearch)).toBeUndefined();
		await scrollBody(MODEL_TOP);
		const search = node(CONTROL.homeModelSearch);
		expect(search).toBeDefined();
		expect(search?.path).toContain(SURFACE.sheetPinned);
		expect(search?.path).not.toContain(SURFACE.sheetBody);
	});

	it("keeps the search for the visit, and starts the next visit at effort again", async () => {
		await mountPicker(() => {});
		await reachModels();
		/* Scrolling back up does not pull the field out from under a query. */
		await scrollBody(0);
		expect(node(CONTROL.homeModelSearch)?.path).toContain(SURFACE.sheetPinned);
		await mountPicker(() => {}, { visible: false });
		await mountPicker(() => {});
		await layoutModels();
		await scrollBody(0);
		expect(node(CONTROL.homeModelSearch)).toBeUndefined();
	});

	it("shows the search at once when the body does not scroll: the models are already on screen (D3)", async () => {
		await mountPicker(() => {});
		await layoutModels();
		await scrollBody(0, 1200, 1100);
		expect(node(CONTROL.homeModelSearch)?.path).toContain(SURFACE.sheetPinned);
	});

	it("keeps the rows still when the search appears over a scrolled body (design D1)", async () => {
		await mountPicker(() => {});
		await layoutModels();
		/* The mocked ScrollView keeps no instance; React 19 hands the Sheet's
		 *  ref through as a prop, so the test gives it the one method used. */
		const scrollTo = vi.fn();
		const body = node(SURFACE.sheetBody)?.props.ref as {
			current: unknown;
		};
		body.current = { scrollTo };
		await scrollBody(MODEL_TOP);
		expect(scrollTo).not.toHaveBeenCalled();
		await layout(SURFACE.sheetPinned, PINNED);
		expect(scrollTo).toHaveBeenCalledTimes(1);
		expect(scrollTo).toHaveBeenCalledWith({
			y: MODEL_TOP + PINNED,
			animated: false,
		});
		/* A later re-measure of the same region (rotation, text size) is not a
		 *  second appearance. */
		await layout(SURFACE.sheetPinned, PINNED + 10);
		expect(scrollTo).toHaveBeenCalledTimes(1);
	});

	it("never pins a search over a list short enough to see whole", async () => {
		await mountPicker(() => {}, {
			models: MODELS.slice(0, MODEL_SEARCH_THRESHOLD),
		});
		await reachModels();
		expect(node(CONTROL.homeModelSearch)).toBeUndefined();
		expect(node(SURFACE.sheetPinned)).toBeUndefined();
	});

	it("picks a model row in one tap with the keyboard up", async () => {
		const onPick = vi.fn();
		await mountPicker(onPick);
		await reachModels();
		await showKeyboard();
		expect(node(SURFACE.sheetBody)?.props.keyboardShouldPersistTaps).toBe(
			"handled",
		);
		const row = [...host.nodes.entries()].find(
			([key, r]) =>
				MODELS.some((m) => modelOptionId(m.model_id) === key) &&
				r.path.includes(SURFACE.sheetBody) &&
				typeof r.props.onPress === "function",
		);
		expect(row).toBeDefined();
		const press = row?.[1].props.onPress as () => void;
		act(() => press());
		expect(onPick).toHaveBeenCalledTimes(1);
		expect(onPick).toHaveBeenCalledWith(
			MODELS.find((m) => modelOptionId(m.model_id) === row?.[0]),
		);
	});

	it("keeps the search field where it was while typing narrows the results (design D2)", async () => {
		await mountPicker(() => {});
		await reachModels();
		await layout("column", WINDOW.height);
		await layout(SURFACE.sheetPinned, PINNED);
		await showKeyboard();
		const rowCount = () =>
			[...host.nodes.keys()].filter((k) =>
				MODELS.some((m) => modelOptionId(m.model_id) === k),
			).length;
		const before = {
			rows: rowCount(),
			min: bodyMinHeight(),
			max: bodyMaxHeight(),
		};
		expect(before.min).toBe(before.max);
		const search = node(CONTROL.homeModelSearch);
		await act(() =>
			(search?.props.onChangeText as (q: string) => void)?.("m-1"),
		);
		/* Fewer rows, the same body: the bottom-anchored surface keeps its height,
		 *  so the field's y (keyboard top − surface height + title row) holds. */
		expect(rowCount()).toBeLessThan(before.rows);
		expect(bodyMinHeight()).toBe(before.min);
		expect(bodyMaxHeight()).toBe(before.max);
		expect(spacerHeight()).toBe(KEYBOARD);
	});
});

describe("SlashSheet with the keyboard up (review R1-m2)", () => {
	it("lets its results take a row tap in one tap", async () => {
		const { SlashSheet } = await import(
			"@/features/session/components/slash-sheet"
		);
		await act(async () =>
			root.render(
				<SlashSheet
					visible
					onClose={() => {}}
					commands={[{ name: "goal", description: "Set a goal" } as never]}
					query=""
					onPick={() => {}}
				/>,
			),
		);
		/* RN's tap capture is per ScrollView, so every scroller between the
		 *  keyboard and a row must persist handled taps. #312 removed the nested
		 *  `max-h-72` list: the rows sit in the Sheet body, so the body is the
		 *  only scroller, and a second one coming back would need `handled` too. */
		const latest = new Map<string, Record<string, unknown>>();
		for (const p of host.scrollViews)
			latest.set((p.testID as string | undefined) ?? "nested", p);
		expect([...latest.keys()]).toEqual([SURFACE.sheetBody]);
		for (const p of latest.values())
			expect(p.keyboardShouldPersistTaps).toBe("handled");
		const row = node(slashCommandId("goal"));
		expect(row?.path).toContain(SURFACE.sheetBody);
	});
});
