import { act, createElement, Profiler, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AskChipDrawnContext,
	AskChipHostContext,
} from "@/features/session/ask-chip-host";
import { TICK_MS } from "@/features/session/paced-reveal";
import {
	enterTextSelection,
	exitTextSelection,
} from "@/features/session/text-selection";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * Paced reveal INSIDE the real native `Markdown` (iOS host, real
 * `usePacedText`, real `PacedReveal`), on a fake clock. The state machine's own
 * invariants are `paced-reveal.test.ts`; this file proves the wiring: what the
 * reader sees, at what render rate, and each condition that must show all text
 * at once.
 *
 * NOT PROVEN HERE: native frame rate, or how UIKit/Android draw an `rgba` run.
 */

const host = vi.hoisted(() => ({
	appState: new Set<(state: string) => void>(),
	plain: null as null | (() => string),
}));

vi.mock("react-native-gesture-handler", async () => {
	const { gestureHandlerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return gestureHandlerModuleMock();
});
vi.mock("react-native", async () => {
	const { createElement } = await import("react");
	const props = (p: {
		className?: string;
		style?: unknown;
		testID?: string;
	}) => ({
		"data-class": p.className,
		"data-style": p.style ? JSON.stringify(p.style) : undefined,
		"data-testid": p.testID,
	});
	const text = ({ children, ...rest }: { children: ReactNode }) =>
		createElement("span", props(rest as never), children);
	const view = ({ children, ...rest }: { children: ReactNode }) =>
		createElement("div", props(rest as never), children);
	return {
		Text: text,
		View: view,
		ScrollView: view,
		Pressable: view,
		Platform: {
			OS: "ios",
			select: (o: Record<string, unknown>) => o.ios ?? o.default,
		},
		AppState: {
			addEventListener: (_type: string, listener: (state: string) => void) => {
				host.appState.add(listener);
				return { remove: () => host.appState.delete(listener) };
			},
		},
		Linking: { openURL: async () => undefined },
		useWindowDimensions: () => ({ width: 390, height: 844 }),
		Animated: {
			View: view,
			Value: class {
				setValue() {}
			},
			timing: () => ({ start() {}, stop() {} }),
		},
		Easing: { bezier: () => "curve" },
		AccessibilityInfo: { isReduceMotionEnabled: async () => false },
	};
});
vi.mock("react-native-svg", async () => {
	const { createElement } = await import("react");
	const node = ({ children }: { children: ReactNode }) =>
		createElement("svg", null, children);
	return {
		default: node,
		Defs: node,
		LinearGradient: node,
		Rect: node,
		Stop: node,
	};
});
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => undefined }));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#102030",
	useTheme: () => ({ active: { colors: {} }, chart: [], theme: "light" }),
}));
vi.mock("@/ui/direction", () => ({
	useIsRTL: () => false,
	LTR_TEXT: {},
	TEXT_END_CLASS: "",
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/features/session/table-scroll-hook", () => ({
	forcedTableScroll: () => null,
}));
/* The real selectable wrapper, but its `text` getter is captured so a test can
 * ask what Copy / select-all would write. */
vi.mock(
	"@/features/session/components/selectable-message",
	async (original) => {
		const actual =
			await original<
				typeof import("@/features/session/components/selectable-message")
			>();
		return {
			...actual,
			SelectableMessage: (props: {
				text: string | (() => string);
				children: ReactNode;
			}) => {
				host.plain =
					typeof props.text === "function"
						? props.text
						: () => props.text as string;
				return props.children;
			},
		};
	},
);

import { Markdown } from "@/features/session/components/markdown";

const FADED_INK = /^rgba\(16, 32, 48, 0\.[4-9]\)$/;
const MOTION = {};
const ARRIVAL = { previousText: "", sealed: false };

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
let renders = 0;
const container = () => dom.container as Element;
const textOf = (node: Node): string =>
	node.nodeValue ?? Array.from(node.childNodes, textOf).join("");
/** The colour of every faded run currently drawn. */
const fadedColours = (): string[] => {
	const found: string[] = [];
	const walk = (node: Node & { dataset?: unknown }) => {
		const raw = (
			node as unknown as { getAttribute?: (n: string) => string | null }
		).getAttribute?.("data-style");
		if (raw) {
			const color = (JSON.parse(raw) as { color?: string }).color;
			if (color?.startsWith("rgba")) found.push(color);
		}
		for (const child of Array.from(node.childNodes)) walk(child as Node);
	};
	walk(container());
	return found;
};

const draw = async (
	text: string,
	options: {
		streaming?: boolean;
		motion?: object | null;
		arrival?: object | null;
	} = {},
) =>
	act(async () =>
		root.render(
			createElement(
				Profiler,
				{
					id: "md",
					onRender: () => {
						renders += 1;
					},
				},
				createElement(Markdown, {
					text,
					streaming: options.streaming ?? true,
					motion: options.motion === undefined ? MOTION : options.motion,
					arrival: (options.arrival === undefined
						? ARRIVAL
						: options.arrival) as never,
				}),
			),
		),
	);
/* One `act` per tick period, never one for the whole span: React defers the
 * updates a timer schedules until `act` exits, so a single long `act` folds
 * every tick into ONE render and a render-rate assertion would measure nothing. */
const advance = async (ms: number) => {
	for (let left = ms; left > 0; left -= TICK_MS)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(Math.min(TICK_MS, left));
		});
};

beforeEach(() => {
	vi.useFakeTimers();
	dom = installDomShim();
	/* The shim's elements are blank: give them attributes, and a `textContent`
	 * that reads their child nodes (React's single-string fast path writes it). */
	const doc = container().ownerDocument;
	const create = doc.createElement.bind(doc);
	Object.assign(doc, {
		createElement(tag: string) {
			const node = create(tag);
			const attrs = new Map<string, string>();
			Object.assign(node, {
				setAttribute: (key: string, value: string) => attrs.set(key, value),
				getAttribute: (key: string) => attrs.get(key) ?? null,
			});
			Object.defineProperty(node, "textContent", {
				get: () => Array.from(node.childNodes, textOf).join(""),
				set(value: string) {
					for (const child of Array.from(node.childNodes))
						node.removeChild(child);
					if (value) node.appendChild(doc.createTextNode(value));
				},
			});
			return node;
		},
	});
	root = createRoot(container());
	renders = 0;
	host.appState.clear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	exitTextSelection();
	vi.useRealTimers();
});

const SENTENCE = "one two three four five six seven eight nine ten ";

describe("native paced reveal in Markdown", () => {
	it("shows the first word at once, then releases the rest on the pacing ticks", async () => {
		await draw(`${SENTENCE}`);
		expect(textOf(container())).toBe("one ");
		const seen: string[] = [];
		for (let at = 0; at < 12; at += 1) {
			await advance(34);
			seen.push(textOf(container()));
		}
		// Monotonic, never a drop, and complete inside the lag bound.
		for (let at = 1; at < seen.length; at += 1)
			expect((seen[at] as string).startsWith(seen[at - 1] as string)).toBe(
				true,
			);
		expect(textOf(container()).trim()).toBe(SENTENCE.trim());
		expect(new Set(seen).size).toBeGreaterThan(3);
	});

	it("draws the newest words dimmer, then at full ink once they have faded", async () => {
		await draw(SENTENCE);
		await advance(34);
		const early = fadedColours();
		expect(early.length).toBeGreaterThan(0);
		expect(early[0]).toMatch(FADED_INK);
		await advance(900);
		expect(fadedColours()).toEqual([]);
		expect(textOf(container()).trim()).toBe(SENTENCE.trim());
	});

	it("renders the message at most 30 times a second, and not at all once idle", async () => {
		await draw(SENTENCE.repeat(6));
		renders = 0;
		await advance(1000);
		expect(renders).toBeLessThanOrEqual(30);
		expect(renders).toBeGreaterThan(0);
		renders = 0;
		await advance(2000);
		expect(renders).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not tick for a paragraph the stream has not extended", async () => {
		await draw("alone ");
		await advance(600);
		renders = 0;
		await advance(1000);
		expect(renders).toBe(0);
	});

	it("shows everything at once on settle, when motion is off, and for a late-mounted cell", async () => {
		await draw(SENTENCE);
		await draw(SENTENCE.repeat(2), { streaming: false });
		expect(textOf(container()).trim()).toBe(SENTENCE.repeat(2).trim());
		expect(fadedColours()).toEqual([]);

		await act(async () => root.unmount());
		root = createRoot(container());
		await draw(SENTENCE, { motion: null });
		expect(textOf(container()).trim()).toBe(SENTENCE.trim());

		await act(async () => root.unmount());
		root = createRoot(container());
		// A cell the virtualiser mounts mid-stream: sealed arrival, nothing to replay.
		await draw(SENTENCE, { arrival: { previousText: "one ", sealed: true } });
		expect(textOf(container()).trim()).toBe(SENTENCE.trim());
	});

	it("flushes when the app is backgrounded", async () => {
		await draw(SENTENCE);
		expect(textOf(container())).toBe("one ");
		await act(async () => {
			for (const listener of [...host.appState]) listener("background");
		});
		expect(textOf(container()).trim()).toBe(SENTENCE.trim());
	});

	it("flushes while a text selection is active, and copy reads everything delivered", async () => {
		await draw(SENTENCE);
		expect(textOf(container())).toBe("one ");
		// What Copy would write BEFORE the selection starts is already the whole
		// delivered text, not the paced prefix.
		expect(host.plain?.()).toContain("ten");
		await act(async () => enterTextSelection("row-1"));
		expect(textOf(container()).trim()).toBe(SENTENCE.trim());
	});

	it("keeps ask ids intact: plain while they fade, a chip once settled, and a chip in the settled head", async () => {
		const chips = (): string[] => {
			const found: string[] = [];
			const walk = (node: Node) => {
				const id = (
					node as unknown as { getAttribute?: (n: string) => string | null }
				).getAttribute?.("data-testid");
				if (id?.startsWith("ask-chip-")) found.push(id);
				for (const child of Array.from(node.childNodes)) walk(child);
			};
			walk(container());
			return found;
		};
		const withChips = (text: string, streaming: boolean) =>
			act(async () =>
				root.render(
					createElement(
						AskChipDrawnContext.Provider,
						{ value: true },
						createElement(
							AskChipHostContext.Provider,
							{
								value: {
									facts: new Map([
										["a-745e", { status: "open", question: "Ship it?" }],
									]),
									open: () => {},
								},
							},
							createElement(Markdown, {
								text,
								streaming,
								motion: streaming ? MOTION : null,
								arrival: ARRIVAL as never,
							}),
						),
					),
				),
			);
		const text =
			"Please answer a-745e before we continue with the rest of this plan today ";
		await withChips(text, true);
		// Mid-fade the id is still in the animated tail or already settled: either
		// way the text is whole, and the id is never lost.
		expect(textOf(container())).not.toContain("a-745e a-745e");
		await advance(2000);
		// Faded in: the settled head carries the chip again.
		expect(chips()).toEqual(["ask-chip-a-745e"]);
		await withChips(text, false);
		expect(chips()).toEqual(["ask-chip-a-745e"]);
		expect(textOf(container())).toContain("before we continue");
	});
});
