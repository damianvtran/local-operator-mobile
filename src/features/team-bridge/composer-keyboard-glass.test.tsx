import { readFileSync } from "node:fs";
import {
	act,
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { COMPOSER_GLASS_LAYER_RADIUS } from "@/features/session/composer-presentation";
import type { KeyboardFrame } from "@/features/session/keyboard-frame";
import { installDomShim } from "@/testing/dom-shim";
import { SURFACE } from "@/ui/a11y";
import { ChromeSurface } from "@/ui/components/chrome-surface";
import { composerOuterGap } from "@/ui/device-corner";
import { BridgeComposerDock } from "./composer-dock";
import {
	type BridgeComposerFieldProps,
	BridgeComposerFieldView,
} from "./thread-chrome";

/**
 * TestFlight 800, the operator's two Team Bridge composer reports:
 *  1. "the composer doesn't move up to go above the keyboard like the agent chat
 *     composer does";
 *  2. "the team bridge composer doesn't have the same liquid glass style on iOS".
 *
 * Both are pinned against the AGENT composer's own rules, rendered through the
 * real components: the dock's bottom offset is the agent dock's carrier inset
 * plus `marginBottom: keyboardOffset + 8` (`composer.tsx`, dockMotion /
 * dockInset), and the glass shell is the agent's absolutely positioned
 * `ChromeSurface` layer at `COMPOSER_GLASS_LAYER_RADIUS`. The keyboard and the
 * glass view are native; the boundaries stubbed here are exactly those two
 * (#216's keyboard store, `expo-glass-effect`) plus reanimated's driver.
 */

/** A controllable #216 keyboard store: same exports, same contract (listeners
 *  run synchronously in the "native" event; `keyboardFrameNow` is the present
 *  frame a reader seeds from). */
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
	const { useSyncExternalStore } = await import("react");
	const subscribeKeyboardFrame = (listener: (f: KeyboardFrame) => void) => {
		store.listeners.add(listener);
		return () => {
			store.listeners.delete(listener);
		};
	};
	const keyboardFrameNow = () => store.current;
	return {
		KEYBOARD_HIDDEN: store.hidden,
		subscribeKeyboardFrame,
		keyboardFrameNow,
		useKeyboardFrame: () =>
			useSyncExternalStore(
				subscribeKeyboardFrame,
				keyboardFrameNow,
				keyboardFrameNow,
			),
	};
});
/** Reanimated's driver, landing every tween at once. A shared value re-renders
 *  its owner on write, so the animated style a test reads is the latest. The
 *  timing's duration is recorded: the lift must follow the native frame's. */
const timings = vi.hoisted(() => [] as number[]);
vi.mock("react-native-reanimated", async () => {
	const React = await import("react");
	const View = ({
		style,
		children,
	}: {
		style?: { marginBottom?: number };
		children?: ReactNode;
	}) =>
		React.createElement(
			"section",
			{ style: { marginBottom: style?.marginBottom } },
			children ?? null,
		);
	return {
		__esModule: true,
		default: { View },
		useSharedValue: (initial: number) => {
			const [, bump] = React.useReducer((n: number) => n + 1, 0);
			const ref = React.useRef<{ value: number } | null>(null);
			if (!ref.current) {
				let value = initial;
				ref.current = {
					get value() {
						return value;
					},
					set value(next: number) {
						value = next;
						bump();
					},
				};
			}
			return ref.current;
		},
		useAnimatedStyle: (fn: () => object) => fn(),
		withTiming: (to: number, config: { duration: number }) => {
			timings.push(config.duration);
			return to;
		},
	};
});
/** The native glass view, as a tagged box carrying the corners it was given. */
vi.mock("expo-glass-effect", async () => {
	const { createElement: h } = await import("react");
	return {
		GlassView: (p: { style: object; children?: ReactNode }) =>
			h("aside", { "data-glass": "1" }, p.children ?? null),
		isGlassEffectAPIAvailable: () => true,
		isLiquidGlassAvailable: () => true,
	};
});
vi.mock("lucide-react-native", () => ({ Paperclip: () => null }));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000000",
	useTheme: () => ({ isDark: false }),
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/ui/components/textarea", async () => {
	const { createElement: h } = await import("react");
	return {
		Textarea: (p: { testID: string }) =>
			h("textarea", { "data-testid": p.testID }),
	};
});

const INSET = 34;
/** `KeyboardAvoidingView` named in any import list: single-line
 *  (`import { KeyboardAvoidingView } from …`) or one name per line —
 *  `[^}]` spans newlines, so both layouts Biome may print are caught. */
const KAV_IMPORT =
	/import\s+(?:type\s+)?\{[^}]*\bKeyboardAvoidingView\b[^}]*\}/;
/** The host reads the platform glass once, for the composer field. */
const CHROME_GLASS_HOOK = /const chromeGlass = useChromeGlass\(\);/;
const GLASS_PROP = /\sglass=\{chromeGlass\}/;

type StyledNode = {
	nodeName?: string;
	style?: Record<string, string>;
	childNodes?: StyledNode[];
};
const find = (
	node: StyledNode,
	match: (n: StyledNode) => boolean,
): StyledNode | undefined => {
	if (match(node)) return node;
	for (const child of node.childNodes ?? []) {
		const hit = find(child, match);
		if (hit) return hit;
	}
	return undefined;
};
const px = (value: string | undefined) =>
	value === undefined ? 0 : Number.parseFloat(value);

/** The agent dock's painted bottom offset for a keyboard frame, written from
 *  `composer.tsx`'s two halves: the carrier's `dockInset` (`keyboardVisible ? 0
 *  : max(0, bottomInset)`) plus the dock's `marginBottom: keyboardOffset + 8`. */
const agentBottom = (inset: number, frame: KeyboardFrame) =>
	(frame.visible ? 0 : Math.max(0, inset)) +
	(frame.visible ? frame.overlap : 0) +
	8;

const mountDock = async () => {
	const dom = installDomShim();
	const root = createRoot(dom.container as Element);
	await act(async () =>
		root.render(
			// JSX, not createElement: the dock's `children` is required, and
			// Biome's `noChildrenProp` rejects passing it as a prop while
			// createElement's third argument does not satisfy the props type.
			<BridgeComposerDock
				bottomInset={INSET}
				className="gap-3 pt-2"
				testID={SURFACE.teamBridgeComposer}
			>
				<p>composer</p>
			</BridgeComposerDock>,
		),
	);
	const container = dom.container as unknown as StyledNode;
	/** lift (the animated outer margin) + the inner box's static clearance. */
	const bottom = () => {
		// The shim names every element DIV, so the boxes are told apart by the
		// style each one owns: the lift's margin, the clearance's padding.
		const outer = find(container, (n) => n.style?.marginBottom !== undefined);
		const inner = find(container, (n) => n.style?.paddingBottom !== undefined);
		expect(outer).toBeDefined();
		expect(inner).toBeDefined();
		return {
			lift: px(outer?.style?.marginBottom),
			clearance: px(inner?.style?.paddingBottom),
			total: px(outer?.style?.marginBottom) + px(inner?.style?.paddingBottom),
		};
	};
	return {
		bottom,
		async done() {
			await act(async () => root.unmount());
			dom.dispose();
			store.current = store.hidden;
		},
	};
};

describe("the Bridge composer rides above the keyboard (TestFlight 800)", () => {
	it("pays the safe inset + 8 with the keyboard down, the agent's rule", async () => {
		const dock = await mountDock();
		try {
			expect(dock.bottom()).toEqual({
				lift: 0,
				clearance: composerOuterGap(INSET, false),
				total: agentBottom(INSET, store.hidden),
			});
			expect(dock.bottom().total).toBe(INSET + 8);
		} finally {
			await dock.done();
		}
	});

	it.each([260, 336, 291])(
		"lifts by an overlap of %i and drops the inset: overlap + 8, as the agent dock",
		async (overlap) => {
			const dock = await mountDock();
			try {
				timings.length = 0;
				const frame = { visible: true, overlap, duration: 250 };
				await act(async () => store.emit(frame));
				expect(dock.bottom()).toEqual({
					lift: overlap,
					clearance: 8,
					total: agentBottom(INSET, frame),
				});
				// The lift follows the native frame's own animation, like the agent's.
				expect(timings).toEqual([250]);
				// And comes back down to the inset rule when the keyboard leaves.
				await act(async () => store.emit(store.hidden));
				expect(dock.bottom().total).toBe(INSET + 8);
			} finally {
				await dock.done();
			}
		},
	);

	it("mounting over a keyboard that is already up starts above it (seed)", async () => {
		store.current = { visible: true, overlap: 300, duration: 0 };
		const dock = await mountDock();
		try {
			expect(dock.bottom().total).toBe(300 + 8);
		} finally {
			await dock.done();
		}
	});

	it("the thread no longer wraps its body in a KeyboardAvoidingView", () => {
		const source = readFileSync(
			new URL("./thread-screen.tsx", import.meta.url),
			"utf8",
		);
		// Neither the component nor the old show/hide-only hook: one keyboard
		// source (#216's store, through the dock), not two disagreeing ones.
		// Neither imported nor rendered (a comment may still name what it replaced).
		expect(source).not.toMatch(KAV_IMPORT);
		expect(source).not.toContain("<KeyboardAvoidingView");
		expect(source).not.toContain("</KeyboardAvoidingView>");
		expect(source).not.toContain("useKeyboardVisible");
		expect(source).toContain("<BridgeComposerDock");
		expect(source).toContain("bottomInset={insets.bottom}");
		expect(source).toContain("testID={SURFACE.teamBridgeComposer}");
		// The field draws the agent's glass shell only when the host hands it
		// the platform glass: without the prop it silently falls back to the
		// flat fill, so pin both the hook call and the prop on the field. The
		// element is sliced to its own `/>` so another component's `glass`
		// cannot satisfy the check.
		expect(source).toMatch(CHROME_GLASS_HOOK);
		const start = source.indexOf("<BridgeComposerField");
		expect(start).toBeGreaterThan(-1);
		const field = source.slice(start, source.indexOf("/>", start));
		expect(field).toMatch(GLASS_PROP);
	});
});

const fieldProps = (glass?: boolean): BridgeComposerFieldProps => ({
	label: "Message",
	placeholder: "Message",
	draft: "",
	onDraftChange: () => {},
	sending: false,
	attachLabel: "Add image",
	onAttach: () => {},
	sendLabel: "Send",
	sendDisabled: true,
	onSend: () => {},
	...(glass === undefined ? null : { glass }),
});
type Styled = ReactElement<{
	className?: string;
	pointerEvents?: string;
	testID?: string;
	style?: Record<string, unknown>;
	radii?: { top: number; bottom: number };
	glass?: boolean;
	children?: ReactNode;
}>;
const shellOf = (glass?: boolean) =>
	BridgeComposerFieldView({ ...fieldProps(glass), focused: false }) as Styled;
const childrenOf = (node: Styled) =>
	Children.toArray(node.props.children).filter(isValidElement) as Styled[];
const glassLayers = (node: ReactNode): Styled[] => {
	if (!isValidElement(node)) return [];
	const el = node as Styled;
	const here = el.type === ChromeSurface ? [el] : [];
	return [...here, ...childrenOf(el).flatMap(glassLayers)];
};

describe("the Bridge composer shell is the agent's glass (TestFlight 800)", () => {
	it("glass: a first, untappable, layout-free ChromeSurface layer at the agent radius", () => {
		const shell = shellOf(true);
		const [first] = childrenOf(shell);
		expect(first).toBeDefined();
		expect(first?.props.pointerEvents).toBe("none");
		expect(first?.props.style).toMatchObject({
			position: "absolute",
			top: 0,
			bottom: 0,
			start: 0,
			end: 0,
		});
		const layers = glassLayers(shell);
		expect(layers).toHaveLength(1);
		expect(layers[0]?.props.glass).toBe(true);
		expect(layers[0]?.props.radii).toEqual({
			top: COMPOSER_GLASS_LAYER_RADIUS,
			bottom: COMPOSER_GLASS_LAYER_RADIUS,
		});
		// The shell paints no colour over the material and clips it to the pill.
		expect(shell.props.style).toMatchObject({
			backgroundColor: "transparent",
			overflow: "hidden",
		});
		// The ring stays, still the last child.
		expect(childrenOf(shell).at(-1)?.props.testID).toBe(
			SURFACE.teamBridgeComposerRing,
		);
		// Rendered: the native glass view is drawn.
		expect(renderToStaticMarkup(shell)).toContain('data-glass="1"');
	});

	it.each([
		["glass={false}", false],
		["no glass prop", undefined],
	] as const)(
		"solid (%s): today's elevated shell, no layer, no GlassView",
		(_name, glass) => {
			const shell = shellOf(glass);
			expect(glassLayers(shell)).toHaveLength(0);
			expect(shell.props.style?.backgroundColor).toBe("#000000");
			expect(shell.props.style?.overflow).toBeUndefined();
			expect(renderToStaticMarkup(shell)).not.toContain("data-glass");
			expect(childrenOf(shell).at(-1)?.props.testID).toBe(
				SURFACE.teamBridgeComposerRing,
			);
		},
	);

	it.each([true, false])(
		"glass=%s: the field column is a direct flex-1 min-w-0 child of the flex-row shell",
		(glass) => {
			const shell = shellOf(glass);
			expect(shell.props.className?.split(" ")).toContain("flex-row");
			const columns = childrenOf(shell).filter(
				(child) =>
					child.props.className?.split(" ").includes("flex-1") &&
					child.props.className?.split(" ").includes("min-w-0"),
			);
			// Exactly one such column, and it holds the TextInput itself — no glass
			// view between the field and the row that gives it its width.
			expect(columns).toHaveLength(1);
			expect(glassLayers(columns[0])).toHaveLength(0);
			expect(renderToStaticMarkup(columns[0])).toContain(
				'data-testid="team-bridge-message-input"',
			);
		},
	);
});
