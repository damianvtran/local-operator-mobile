import { act, createElement, type ReactNode } from "react";
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
	pressables: [] as { onLongPress?: () => void; onPress?: () => void }[],
	inputs: [] as Record<string, unknown>[],
	texts: [] as Record<string, unknown>[],
}));

vi.mock("react-native", async () => {
	const { createElement } = await import("react");
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
		TextInput: ({ value, ...props }: { value?: string }) => {
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
vi.mock("@/ui/appearance", () => ({
	useTokenColor: (role: string) => `token:${role}`,
}));

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

let dom: ReturnType<typeof installDomShim>;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	// Cleared in place: the mocked host components hold these arrays.
	host.pressables.length = 0;
	host.inputs.length = 0;
	host.texts.length = 0;
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
				createElement(
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
			selection: { start: 0, end: 35 },
			selectionColor: "token:accent",
			className: "text-body-read text-ink",
		});
		expect(store.activeTextSelection()).not.toBeNull();
	});

	it("ends on a collapsed selection only after a real range was seen", async () => {
		const { SelectableMessage, store } = await load("ios");
		await act(async () =>
			root.render(
				createElement(
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

	it("ends on blur and on a scroll; another message's long-press takes over", async () => {
		const { SelectableMessage, store } = await load("ios");
		await act(async () =>
			root.render(
				createElement(
					"div",
					null,
					createElement(
						SelectableMessage,
						{
							text: "a",
							textClassName: "x",
						},
						"a",
					),
					createElement(
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

	it("gives a clamped preview no mode", async () => {
		const { SelectableMessage } = await load("ios");
		await act(async () =>
			root.render(
				createElement(
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
		it(`${os}: leaf Text is selectable with the theme wash, no wrapper Pressable`, async () => {
			const { SelectableMessage, SelectableLeafText } = await load(os);
			await act(async () =>
				root.render(
					createElement(
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
				selectionColor: "token:accent-wash",
			});
		});
	}
});

describe("the mode store", () => {
	beforeEach(() => selection.exitTextSelection());

	it("a touch outside the selecting row ends the mode; one inside does not", () => {
		selection.enterTextSelection("row-1");
		selection.noteTextSelectionTouch();
		selection.textSelectionContainerTouch();
		expect(selection.activeTextSelection()).toBe("row-1");
		selection.textSelectionContainerTouch();
		expect(selection.activeTextSelection()).toBeNull();
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
