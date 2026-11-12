import {
	act,
	type ComponentProps,
	createElement,
	Fragment,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drag-to-select in the transcript (operator report, iOS TestFlight: "you
 * can't really tap to select and drag a selection to copy").
 *
 * A real reconciler over recording host components: what is pinned is the
 * CONTRACT handed to the native views — which leaf carries `selectable`, that a
 * long-press swaps the body for a read-only multiline `TextInput` holding the
 * plain text with everything pre-selected (iOS), and every way the mode ends.
 * Whether UIKit draws the handles is device QA, not this layer.
 */
const host = vi.hoisted(() => ({
	os: "ios" as "ios" | "android" | "web",
	pressables: [] as {
		onLongPress?: () => void;
		onPress?: () => void;
		accessible?: boolean;
	}[],
	inputs: [] as Record<string, unknown>[],
	/* Imperative `setSelection` calls on the mounted input (PR #233 R1, B1). */
	setSelections: [] as [number, number][],
	texts: [] as Record<string, unknown>[],
}));

vi.mock("react-native", async () => {
	const { createElement, useImperativeHandle } = await import("react");
	const record =
		(bucket: Record<string, unknown>[] | null, tag: string) =>
		({ children, ...props }: { children?: ReactNode }) => {
			bucket?.push(props);
			return createElement(tag, null, children);
		};
	return {
		Platform: {
			get OS() {
				return host.os;
			},
		},
		View: record(null, "div"),
		Text: record(host.texts, "span"),
		// React 19 hands `ref` to a function component as a prop; the handle
		// records select-all the way RN's `TextInput.setSelection` would send it.
		TextInput: ({
			value,
			ref,
			...props
		}: {
			value?: string;
			ref?: unknown;
		}) => {
			useImperativeHandle(ref as never, () => ({
				setSelection: (start: number, end: number) =>
					host.setSelections.push([start, end]),
			}));
			host.inputs.push({ value, ...props });
			return createElement("textarea", null, value);
		},
		Pressable: ({
			children,
			...props
		}: {
			children?: ReactNode;
			onLongPress?: () => void;
		}) => {
			host.pressables.push(props);
			return createElement("div", null, children);
		},
	};
});
/* A real hex for the accent (the default light palette's), so the Android
 *  highlight derivation (`selectionHighlight`) runs for real. */
const ACCENT = "#137742";
vi.mock("@/ui/appearance", async () => {
	const { themeEntry } = await import("@/ui/tokens.gen");
	// The default light palette, whose accent is ACCENT: the Android highlight
	// derivation runs on real token values.
	const colors = themeEntry(null, "light").colors as Record<string, string>;
	return {
		useTokenColor: (role: string) => colors[role] ?? `token:${role}`,
	};
});

const { installDomShim } = await import("@/testing/dom-shim");
const selection = await import("@/features/session/text-selection");

/** The component reads `Platform.OS` at module scope (the leaf policy), so each
 *  platform gets a fresh module graph. */
const load = async (os: "ios" | "android" | "web") => {
	host.os = os;
	vi.resetModules();
	const store = await import("@/features/session/text-selection");
	const module = await import(
		"@/features/session/components/selectable-message"
	);
	return { ...module, store };
};

type Selectable =
	typeof import("@/features/session/components/selectable-message").SelectableMessage;
/** `createElement` with the child folded into props: the component's
 *  `children` is required, which the variadic overload does not satisfy. */
const message = (
	component: Selectable,
	props: Omit<ComponentProps<Selectable>, "children">,
	children: ReactNode,
) => createElement(component, { ...props, children });

let dom: ReturnType<typeof installDomShim>;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	// Cleared in place: the mocked host components hold these arrays.
	host.pressables.length = 0;
	host.inputs.length = 0;
	host.texts.length = 0;
	host.setSelections.length = 0;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

const lastInput = () => host.inputs.at(-1);
/** The mounted input, or a failed test naming why — never `undefined()`. */
const mountedInput = () => {
	const input = lastInput();
	if (!input) throw new Error("no selection TextInput is mounted");
	return input;
};

describe("iOS: long-press enters a read-only UITextView selection", () => {
	it("renders the formatted body until a long-press, then the plain text pre-selected", async () => {
		const { SelectableMessage, SelectableLeafText, store } = await load("ios");
		const plain = vi.fn(() => "First paragraph.\n\nSecond paragraph.");
		await act(async () =>
			root.render(
				message(
					SelectableMessage,
					{
						text: plain,
						textClassName: "text-body-read text-ink",
					},
					createElement(SelectableLeafText, null, "**rendered**"),
				),
			),
		);
		expect(host.inputs).toHaveLength(0);
		// Lazy: a streamed answer is never flattened for a mode nobody opened.
		expect(plain).not.toHaveBeenCalled();
		// The Fabric `selectable` long-press menu would fire on the same hold.
		expect(host.texts.at(-1)?.selectable).toBe(false);
		const press = host.pressables.at(-1);
		expect(press?.onPress).toBeUndefined();

		await act(async () => press?.onLongPress?.());
		const input = lastInput();
		expect(input).toMatchObject({
			editable: false,
			multiline: true,
			scrollEnabled: false,
			autoFocus: true,
			value: "First paragraph.\n\nSecond paragraph.",
			selectionColor: ACCENT,
			className: "text-body-read text-ink",
		});
		// Select-all is sent ONCE, imperatively; the input is never controlled.
		expect(input).not.toHaveProperty("selection");
		expect(host.setSelections).toEqual([[0, 35]]);
		expect(store.activeTextSelection()).not.toBeNull();
	});

	/* PR #233 review R1, B1: a controlled `selection={{0, len}}` made RN re-send
	 *  select-all after every native selection event, snapping each drag back to
	 *  the whole message. The reader's range must survive re-renders. */
	it("never re-imposes select-all after the reader drags a range", async () => {
		const { SelectableMessage, store } = await load("ios");
		const tree = (theme: string) =>
			message(
				SelectableMessage,
				{ text: "hello world", textClassName: theme },
				"hello world",
			);
		await act(async () => root.render(tree("a")));
		await act(async () => host.pressables.at(-1)?.onLongPress?.());
		const rendersBefore = host.inputs.length;
		await act(async () =>
			(mountedInput().onSelectionChange as (e: unknown) => void)({
				nativeEvent: { selection: { start: 6, end: 11 } },
			}),
		);
		// An unrelated parent re-render (a theme flip) while the range is held.
		await act(async () => root.render(tree("b")));
		expect(host.inputs.length).toBeGreaterThan(rendersBefore);
		for (const props of host.inputs)
			expect(props).not.toHaveProperty("selection");
		expect(host.setSelections).toEqual([[0, 11]]);
		expect(store.activeTextSelection()).not.toBeNull();
	});

	/* Review R1, m3: a streamed token must not swap the text (and move the
	 *  caret) under the reader's handles; the view is the entry-time snapshot. */
	it("selects a snapshot taken on entry, not the still-streaming text", async () => {
		const { SelectableMessage } = await load("ios");
		const tree = (body: string) =>
			message(
				SelectableMessage,
				{ text: () => body, textClassName: "x" },
				body,
			);
		await act(async () => root.render(tree("partial")));
		await act(async () => host.pressables.at(-1)?.onLongPress?.());
		await act(async () => root.render(tree("partial answer, longer")));
		expect(mountedInput().value).toBe("partial");
		expect(host.setSelections).toEqual([[0, 7]]);
	});

	/* Review R1, M1: an accessible iOS container hides its descendants from
	 *  VoiceOver; the wrapper must not be one, and the leaf offers the mode. */
	it("keeps the wrapper out of VoiceOver and offers a Select text action", async () => {
		const { SelectableMessage, SelectableLeafText, SELECT_TEXT_ACTION, store } =
			await load("ios");
		await act(async () =>
			root.render(
				message(
					SelectableMessage,
					{ text: "body", textClassName: "x" },
					createElement(SelectableLeafText, null, "body"),
				),
			),
		);
		expect(host.pressables.at(-1)?.accessible).toBe(false);
		const leaf = host.texts.at(-1) as {
			accessibilityActions?: { name: string; label: string }[];
			onAccessibilityAction?: (event: unknown) => void;
		};
		expect(leaf.accessibilityActions).toEqual([
			{ name: SELECT_TEXT_ACTION, label: "Select text" },
		]);
		await act(async () =>
			leaf.onAccessibilityAction?.({ nativeEvent: { actionName: "magicTap" } }),
		);
		expect(store.activeTextSelection()).toBeNull();
		await act(async () =>
			leaf.onAccessibilityAction?.({
				nativeEvent: { actionName: SELECT_TEXT_ACTION },
			}),
		);
		expect(store.activeTextSelection()).not.toBeNull();
		expect(mountedInput().value).toBe("body");
	});

	it("ends on a collapsed selection only after a real range was seen", async () => {
		const { SelectableMessage, store } = await load("ios");
		await act(async () =>
			root.render(
				message(
					SelectableMessage,
					{
						text: "hello world",
						textClassName: "x",
					},
					"hello world",
				),
			),
		);
		await act(async () => host.pressables.at(-1)?.onLongPress?.());
		type Change = (event: {
			nativeEvent: { selection: { start: number; end: number } };
		}) => void;
		const change = (start: number, end: number) =>
			(mountedInput().onSelectionChange as Change)({
				nativeEvent: { selection: { start, end } },
			});
		// The mount-time caret report precedes select-all: must not close it.
		await act(async () => change(0, 0));
		expect(store.activeTextSelection()).not.toBeNull();
		await act(async () => change(0, 11));
		await act(async () => change(6, 11));
		expect(store.activeTextSelection()).not.toBeNull();
		// The reader taps the text: the range collapses, the mode ends and the
		// formatted body (the long-press Pressable) is what renders again.
		const pressablesBefore = host.pressables.length;
		await act(async () => change(3, 3));
		expect(store.activeTextSelection()).toBeNull();
		expect(host.pressables.length).toBe(pressablesBefore + 1);
	});

	it("ends on blur; another message's long-press takes over", async () => {
		const { SelectableMessage, store } = await load("ios");
		await act(async () =>
			root.render(
				createElement(
					"div",
					null,
					message(
						SelectableMessage,
						{
							text: "a",
							textClassName: "x",
						},
						"a",
					),
					message(
						SelectableMessage,
						{
							text: "b",
							textClassName: "x",
						},
						"b",
					),
				),
			),
		);
		const [first, second] = host.pressables.slice(-2);
		await act(async () => first?.onLongPress?.());
		expect(lastInput()?.value).toBe("a");
		await act(async () => second?.onLongPress?.());
		expect(lastInput()?.value).toBe("b");
		// Only one input is mounted at a time: the first row went back.
		const mounted = host.inputs.filter((p) => p.value === "a").length;
		expect(mounted).toBe(1);
		await act(async () => (mountedInput().onBlur as () => void)());
		expect(store.activeTextSelection()).toBeNull();

		await act(async () => host.pressables.at(-1)?.onLongPress?.());
		expect(store.activeTextSelection()).not.toBeNull();
		await act(async () => store.exitTextSelection());
		expect(store.activeTextSelection()).toBeNull();
	});

	/* Design R1, D3: a scroll no longer ends the mode, so a row that windowing
	 *  unmounts must end it itself — and only if it is still the active one. */
	it("a row that unmounts while selecting ends the mode; a stale row does not", async () => {
		const { SelectableMessage, store } = await load("ios");
		// Keyed, as FlatList rows are, so removing "a" unmounts "a" — not the
		// positional second child.
		const row = (text: string) =>
			createElement(
				Fragment,
				{ key: text },
				message(SelectableMessage, { text, textClassName: "x" }, text),
			);
		await act(async () =>
			root.render(createElement("div", null, row("a"), row("b"))),
		);
		const [first, second] = host.pressables.slice(-2);
		await act(async () => first?.onLongPress?.());
		await act(async () => second?.onLongPress?.());
		const active = store.activeTextSelection();
		expect(active).not.toBeNull();
		// The first row (no longer active) leaves the window: the second keeps it.
		await act(async () => root.render(createElement("div", null, row("b"))));
		expect(store.activeTextSelection()).toBe(active);
		// The selecting row itself leaves: nothing is left "active" off-screen.
		await act(async () => root.render(createElement("div", null)));
		expect(store.activeTextSelection()).toBeNull();
	});

	/* PR #237 review, R1-m1: inside a closed `Show more` clamp the selection
	 *  view was clipped at eight lines, its end handle out of reach. `onEnter`
	 *  lets the host open the clamp, and it must run IN the long-press, before
	 *  the view mounts, so the first frame of the mode is already open. */
	it("calls onEnter as the mode is entered, before the selection view mounts", async () => {
		const { SelectableMessage, store } = await load("ios");
		const seen: { inputs: number; active: string | null }[] = [];
		const onEnter = vi.fn(() => {
			seen.push({
				inputs: host.inputs.length,
				active: store.activeTextSelection(),
			});
		});
		await act(async () =>
			root.render(
				message(
					SelectableMessage,
					{ text: "prompt", textClassName: "x", onEnter },
					"prompt",
				),
			),
		);
		expect(onEnter).not.toHaveBeenCalled();
		await act(async () => host.pressables.at(-1)?.onLongPress?.());
		expect(onEnter).toHaveBeenCalledTimes(1);
		// Not yet selecting, and no input mounted, when the host is asked.
		expect(seen).toEqual([{ inputs: 0, active: null }]);
		expect(host.inputs.length).toBeGreaterThan(0);
	});

	it("never calls onEnter where there is no mode to enter", async () => {
		const { SelectableMessage } = await load("ios");
		const onEnter = vi.fn();
		await act(async () =>
			root.render(
				message(
					SelectableMessage,
					{ text: "prompt", textClassName: "x", disabled: true, onEnter },
					"prompt",
				),
			),
		);
		expect(host.pressables).toHaveLength(0);
		expect(onEnter).not.toHaveBeenCalled();
	});

	it("gives a clamped preview no mode", async () => {
		const { SelectableMessage } = await load("ios");
		await act(async () =>
			root.render(
				message(
					SelectableMessage,
					{
						text: "prompt",
						textClassName: "x",
						disabled: true,
					},
					"prompt",
				),
			),
		);
		expect(host.pressables).toHaveLength(0);
	});
});

describe("Android and web: native selection on the leaf, no mode", () => {
	for (const os of ["android", "web"] as const) {
		it(`${os}: leaf Text is selectable with the ~30 % accent highlight, no wrapper Pressable`, async () => {
			const { SelectableMessage, SelectableLeafText, store } = await load(os);
			const { themeEntry } = await import("@/ui/tokens.gen");
			// The per-theme derivation over the palette the mock serves (design
			// R1, D1) — never the old `accent-wash`, never the opaque accent.
			const expected = store.selectionHighlight(
				themeEntry(null, "light").colors,
			);
			expect(expected).toMatch(new RegExp(`^${ACCENT}[0-9a-f]{2}$`));
			await act(async () =>
				root.render(
					message(
						SelectableMessage,
						{
							text: "body",
							textClassName: "x",
						},
						createElement(SelectableLeafText, null, "body"),
					),
				),
			);
			expect(host.pressables).toHaveLength(0);
			expect(host.inputs).toHaveLength(0);
			expect(host.texts.at(-1)).toMatchObject({
				selectable: true,
				selectionColor: expected,
			});
			// The leaf selects natively: no VoiceOver detour into a mode.
			expect(host.texts.at(-1)).not.toHaveProperty("accessibilityActions");
		});
	}
});

describe("the mode store", () => {
	beforeEach(() => selection.exitTextSelection());

	it("a tap outside the selecting row ends the mode; one inside does not", () => {
		selection.enterTextSelection("row-1");
		selection.noteTextSelectionTouch();
		selection.textSelectionContainerTouch();
		selection.textSelectionContainerTouchEnd();
		expect(selection.activeTextSelection()).toBe("row-1");
		selection.textSelectionContainerTouch();
		// Undecided until the touch lifts: it could still become a scroll.
		expect(selection.activeTextSelection()).toBe("row-1");
		selection.textSelectionContainerTouchEnd();
		expect(selection.activeTextSelection()).toBeNull();
	});

	/* Design R1, D3: the reader scrolls to reach a long message's far handle,
	 *  so a drag that scrolls the list — from inside the row or outside it —
	 *  keeps the mode, whether the touch then ends or is cancelled. */
	it("a scroll keeps the mode", () => {
		selection.enterTextSelection("row-1");
		selection.textSelectionContainerTouch();
		selection.textSelectionContainerScroll();
		selection.textSelectionContainerTouchEnd();
		expect(selection.activeTextSelection()).toBe("row-1");

		selection.textSelectionContainerTouch();
		selection.textSelectionContainerTouchCancel();
		selection.textSelectionContainerTouchEnd();
		expect(selection.activeTextSelection()).toBe("row-1");

		selection.noteTextSelectionTouch();
		selection.textSelectionContainerTouch();
		selection.textSelectionContainerScroll();
		selection.textSelectionContainerTouchEnd();
		expect(selection.activeTextSelection()).toBe("row-1");

		// And a later plain tap outside still ends it.
		selection.textSelectionContainerTouch();
		selection.textSelectionContainerTouchEnd();
		expect(selection.activeTextSelection()).toBeNull();
	});

	it("a touch end with no mode or no pending outside touch is a no-op", () => {
		selection.textSelectionContainerTouchEnd();
		expect(selection.activeTextSelection()).toBeNull();
		selection.enterTextSelection("row-1");
		selection.textSelectionContainerTouchEnd();
		expect(selection.activeTextSelection()).toBe("row-1");
	});

	it("a stale row's exit does not close the row that took over", () => {
		selection.enterTextSelection("row-1");
		selection.enterTextSelection("row-2");
		selection.exitTextSelection("row-1");
		expect(selection.activeTextSelection()).toBe("row-2");
	});

	it("notifies subscribers only on a change", () => {
		const listener = vi.fn();
		const off = selection.subscribeTextSelection(listener);
		selection.enterTextSelection("row-1");
		selection.enterTextSelection("row-1");
		selection.exitTextSelection();
		selection.exitTextSelection();
		off();
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("the platform policy: iOS uses the mode, everything else the leaf", () => {
		expect(selection.usesSelectionMode("ios")).toBe(true);
		expect(selection.leafSelectable("ios")).toBe(false);
		expect(selection.usesSelectionMode("android")).toBe(false);
		expect(selection.leafSelectable("android")).toBe(true);
		expect(selection.leafSelectable("web")).toBe(true);
		expect(selection.selectionEndsMode({ start: 0, end: 0 }, false)).toBe(
			false,
		);
		expect(selection.selectionEndsMode({ start: 2, end: 2 }, true)).toBe(true);
		expect(selection.selectionEndsMode({ start: 0, end: 4 }, true)).toBe(false);
	});
});
