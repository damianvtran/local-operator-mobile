import {
	act,
	Children,
	createElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Pressable } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { COMPOSER_DISC } from "@/features/session/composer-layout";
import {
	COMPOSER_BASE_HEIGHT,
	composerPaintedHeight,
	composerPresentation,
	composerRestRow,
	composerShellPadding,
	morphPillRadius,
} from "@/features/session/composer-presentation";
import { sessionHeaderTitle } from "@/features/session/header";
import { installDomShim } from "@/testing/dom-shim";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Heading } from "@/ui/components/heading";
import { TOUCH_FLOOR } from "@/ui/layout";
import { CONTROL_DISABLED_INK, cx, touchFloorFor } from "@/ui/variants";
import {
	BridgeComposerField,
	type BridgeComposerFieldProps,
	BridgeComposerFieldView,
	BridgeThreadTitleView,
} from "./thread-chrome";

/**
 * The Team Bridge thread's header title and composer field, rendered.
 *
 * Node host (`vitest.config.ts`: `react-native` → `react-native-web`, server
 * renderer), the convention `message-delivery.test.tsx` set: the markup is what
 * a browser user of the web target gets, and activation is asserted by invoking
 * the REAL `onPress` bindings found on the component's own element tree.
 *
 * The operator's ask (TestFlight 753): bridge titles "way too large", wanted
 * "closer in size to the chat conversation titles". The title is therefore
 * pinned to `sessionHeaderTitle` — the session header's own function — rather
 * than to a class literal, so this suite fails if the bridge ever draws a
 * different style than the session does.
 */

// The Node SSR host has no native SVG loader; the glyph is aria-hidden anyway.
vi.mock("lucide-react-native", () => ({ Paperclip: () => null }));
// No native appearance provider in Node. Every token reads #000000 EXCEPT
// `border-control`, so the edge ring's focused colour is distinguishable from
// the shell fill and from its clear rest (design D1).
const BORDER_CONTROL = "#123456";
vi.mock("@/ui/appearance", () => ({
	useTokenColor: (name: string) =>
		name === "border-control" ? BORDER_CONTROL : "#000000",
}));
/** The field's focus handlers as the composer passed them, so a mounted test
 *  can fire the same focus the platform input would. */
const field = vi.hoisted(() => ({
	/** Set by the mounted test: the Node DOM shim cannot hold a real
	 *  <textarea>'s attributes, and only the handlers matter there. */
	mounted: false,
	onFocus: undefined as undefined | (() => void),
	onBlur: undefined as undefined | (() => void),
}));
// The kit's text-scale provider and Textarea import uniwind/Flow sources the
// Node host cannot load. Stub ONLY those boundaries: the scale the title's
// hook wrapper would read, and the field as a labelled <textarea> carrying the
// props this component passes (name, testID, disabled) — the Textarea's own
// drawing is the kit's, covered by its own suites and by rendered QA.
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/ui/components/textarea", async () => {
	const { createElement: h } = await import("react");
	return {
		Textarea: (p: {
			label: string;
			testID: string;
			disabled?: boolean;
			value: string;
			placeholderMaxLines?: number;
			onFocus?: () => void;
			onBlur?: () => void;
		}) => {
			field.onFocus = p.onFocus;
			field.onBlur = p.onBlur;
			if (field.mounted) return null;
			return h("textarea", {
				"aria-label": p.label,
				"data-testid": p.testID,
				"data-placeholder-lines": p.placeholderMaxLines ?? "grow",
				disabled: p.disabled,
				defaultValue: p.value,
			});
		},
	};
});

type DiscProps = {
	className: string;
	children: ReactElement<{ className: string }>;
};

const OLD_TITLE_STEPS = /text-title|text-display/;
const TAG = /<[^>]+>/g;
/** A word painted as text between tags (the old label and button captions). */
const PAINTED_WORDS = /\|Message\||\|Add image\||\|Send\|/;

const LONG =
	"qa-coordination-and-release-readiness-for-the-entire-mobile-platform-team";

const props = (
	over: Partial<BridgeComposerFieldProps> = {},
): BridgeComposerFieldProps => ({
	label: "Message",
	placeholder: `Message ${LONG}`,
	draft: "hello",
	onDraftChange: () => {},
	sending: false,
	attachLabel: "Add image",
	onAttach: () => {},
	sendLabel: "Send",
	sendDisabled: false,
	onSend: () => {},
	...over,
});

/** Every `Pressable` in the element tree the component returns, by testID. */
const pressables = (node: ReactNode, out = new Map<string, unknown>()) => {
	if (Array.isArray(node)) {
		for (const child of node) pressables(child, out);
		return out;
	}
	if (!isValidElement<{ testID?: string; children?: ReactNode }>(node))
		return out;
	if (node.type === Pressable && node.props.testID)
		out.set(node.props.testID, node.props);
	pressables(node.props.children, out);
	return out;
};
type PressProps = {
	onPress: () => void;
	disabled: boolean;
	accessibilityLabel: string;
};
/** The hook-free view's element tree (focus is a prop there); the stateful
 *  `BridgeComposerField` is mounted for real in the focus-ring suite below. */
const view = (over: Partial<BridgeComposerFieldProps> = {}, focused = false) =>
	BridgeComposerFieldView({ ...props(over), focused });
const tree = (over: Partial<BridgeComposerFieldProps> = {}) =>
	pressables(view(over)) as Map<string, PressProps>;

/** The shell's laid-out children: every child but the edge ring, which is
 *  absolutely positioned and takes no part in the row (design D1). */
const layoutColumns = (shell: ReactElement<{ children: ReactNode }>) =>
	(
		Children.toArray(shell.props.children) as ReactElement<{
			testID?: string;
			style: { minHeight: number; minWidth?: number };
		}>[]
	).filter((child) => child.props.testID !== SURFACE.teamBridgeComposerRing);

/** The opening tag of the element carrying `data-testid`. */
const tagOf = (html: string, testID: string) => {
	const at = html.indexOf(`data-testid="${testID}"`);
	expect(at).toBeGreaterThan(-1);
	return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

describe("bridge thread title", () => {
	const render = (compact: boolean, stacked: boolean) => {
		const html = renderToStaticMarkup(
			createElement(BridgeThreadTitleView, { title: LONG, compact, stacked }),
		);
		const at = html.indexOf("<h1");
		return { html, open: html.slice(at, html.indexOf(">", at) + 1) };
	};
	/** The class and clamp the view hands its `Heading` (uniwind classes are
	 *  not serialised by the Node host, so the element's own props are read). */
	const headingProps = (compact: boolean, stacked: boolean) => {
		const slot = BridgeThreadTitleView({ title: LONG, compact, stacked });
		const heading = slot.props.children;
		expect(heading.type).toBe(Heading);
		return heading.props as { className: string; numberOfLines: number };
	};

	it("draws the session header's title style, one line, tail-truncated", () => {
		const { html, open } = render(false, false);
		const session = sessionHeaderTitle({ compact: false, stacked: false });
		expect(session).toEqual({
			className: "text-heading text-ink",
			numberOfLines: 1,
			step: "heading",
		});
		expect(headingProps(false, false)).toMatchObject({
			className: session.className,
			numberOfLines: 1,
		});
		expect(open).toContain('aria-level="1"');
		// react-native-web draws a one-line clamp as nowrap + text-overflow
		// (ellipsis, the tail), and no multi-line clamp.
		expect(open).toContain("r-whiteSpace-");
		expect(open).toContain("r-textOverflow-");
		expect(open).not.toContain("line-clamp");
		// The whole name is in the DOM; truncation is the layout's, not a slice.
		expect(html).toContain(LONG);
	});

	it("is no longer #208's 20 pt two-line title step", () => {
		expect(headingProps(false, false).className).not.toMatch(OLD_TITLE_STEPS);
	});

	it("allows two lines only when the header stacks (large text / narrow)", () => {
		const session = sessionHeaderTitle({ compact: false, stacked: true });
		expect(session.numberOfLines).toBe(2);
		expect(headingProps(false, true)).toMatchObject({
			className: session.className,
			numberOfLines: 2,
		});
		expect(render(false, true).open).toContain("-webkit-line-clamp:2");
	});

	it("follows the session's compact (short landscape) step and one line", () => {
		const session = sessionHeaderTitle({ compact: true, stacked: false });
		expect(session).toEqual({
			className: "text-title text-ink",
			numberOfLines: 1,
			step: "title",
		});
		expect(headingProps(true, false)).toMatchObject({
			className: session.className,
			numberOfLines: 1,
		});
	});
});

describe("bridge composer field", () => {
	it("paints one field with inline icon controls and no visible labels", () => {
		const html = renderToStaticMarkup(
			createElement(BridgeComposerField, props()),
		);
		const attach = tagOf(html, CONTROL.teamBridgeAttach);
		const send = tagOf(html, CONTROL.teamBridgeSend);
		expect(attach).toContain('aria-label="Add image"');
		expect(attach).toContain('role="button"');
		expect(send).toContain('aria-label="Send"');
		expect(send).toContain('role="button"');
		// The field keeps "Message" as its accessible name, not as painted text.
		expect(tagOf(html, CONTROL.teamBridgeMessageInput)).toContain(
			'aria-label="Message"',
		);
		const text = html.replace(TAG, "|");
		expect(text).not.toMatch(PAINTED_WORDS);
		// Attach precedes the field, the field precedes send (reading order).
		expect(html.indexOf(CONTROL.teamBridgeAttach)).toBeLessThan(
			html.indexOf(CONTROL.teamBridgeMessageInput),
		);
		expect(html.indexOf(CONTROL.teamBridgeMessageInput)).toBeLessThan(
			html.indexOf(CONTROL.teamBridgeSend),
		);
	});

	/* TestFlight 773, operator: "The team bridge composer needs to be fixed,
	 * looks janky and the placeholder is off alignment". Each pin below is
	 * measured against the AGENT composer's own exported values, not literals,
	 * so the two stay one geometry. */
	it("caps the placeholder to one line, so it can never inflate the rest height", () => {
		const html = renderToStaticMarkup(
			createElement(BridgeComposerField, props({ draft: "" })),
		);
		expect(tagOf(html, CONTROL.teamBridgeMessageInput)).toContain(
			'data-placeholder-lines="1"',
		);
	});

	it("rests as the agent composer's one-row pill: attach | field | send", () => {
		const shell = view({ draft: "" }) as ReactElement<{
			style: Record<string, number | string | undefined>;
			children: ReactNode;
		}>;
		const style = shell.props.style;
		const pad = composerShellPadding(false);
		expect(style.paddingTop).toBe(pad.top);
		expect(style.paddingBottom).toBe(pad.bottom);
		expect(style.minHeight).toBe(composerPaintedHeight(false, TOUCH_FLOOR));
		// Exactly three columns, each the resting row's own height, so the
		// discs centre on the field's line instead of sitting in the corners.
		const columns = layoutColumns(shell);
		expect(columns).toHaveLength(3);
		for (const column of columns)
			expect(column.props.style.minHeight).toBe(composerRestRow(TOUCH_FLOOR));
		expect(pad.top + composerRestRow(TOUCH_FLOOR) + pad.bottom).toBe(
			composerPaintedHeight(false, TOUCH_FLOOR),
		);
	});

	/* Review R1-1: the host's `TOUCH_FLOOR` is 48 (web/Android), where the
	 * resting row is ALSO 48, so the test above passed on the old
	 * `minHeight: TOUCH_FLOOR` boxes too. The operator's device is iOS, where
	 * the floor is 44: boxes of 44 in a 48 row are what parked the discs in
	 * the corners. Load the component against the iOS floor so the pin fails
	 * on that geometry. */
	it("on iOS's 44 pt floor, each column is still the 48 pt resting row", async () => {
		const ios = touchFloorFor("ios");
		expect(ios).toBeLessThan(composerRestRow(ios));
		vi.resetModules();
		vi.doMock("@/ui/layout", async (original) => ({
			...(await original<typeof import("@/ui/layout")>()),
			TOUCH_FLOOR: ios,
		}));
		try {
			const chrome = await import("./thread-chrome");
			const shell = chrome.BridgeComposerFieldView({
				...props({ draft: "" }),
				focused: false,
			}) as ReactElement<{ children: ReactNode }>;
			const columns = layoutColumns(shell);
			expect(columns).toHaveLength(3);
			for (const column of columns)
				expect(column.props.style.minHeight).toBe(composerRestRow(ios));
			// The controls keep the iOS floor's WIDTH: only the row height moved.
			expect(columns[0]?.props.style.minWidth).toBe(ios);
		} finally {
			vi.doUnmock("@/ui/layout");
			vi.resetModules();
		}
	});

	it("insets the placeholder exactly as far as the agent composer's text", () => {
		const shell = view({ draft: "" }) as ReactElement<{
			style: Record<string, number | undefined>;
			children: ReactNode;
		}>;
		const [attach] = Children.toArray(shell.props.children) as ReactElement<{
			style: { minWidth: number };
		}>[];
		expect(attach).toBeDefined();
		const bridgeInset =
			(shell.props.style.paddingHorizontal ?? 0) +
			(attach?.props.style.minWidth ?? 0) +
			(shell.props.style.gap ?? 0);
		// The agent dock: its `side` padding, then its attach column (a
		// TOUCH_FLOOR-wide Pressable), then the field with no gap between.
		const agent = composerPresentation({
			focused: false,
			draft: "",
			attachments: 0,
			dictation: false,
			stop: false,
			error: false,
			keyboard: false,
			inset: 0,
			scale: 1,
		});
		expect(bridgeInset).toBe(agent.side + TOUCH_FLOOR);
	});

	it("paints the disabled send with the agent composer's exact treatment", () => {
		// The agent composer's disabled primary (`composer.tsx`): a `sunken`
		// disc with the kit's `CONTROL_DISABLED_INK` label. classNames do not
		// survive RNW's SSR, so read the disc off the element tree.
		const send = tree({ draft: "", sendDisabled: true }).get(
			CONTROL.teamBridgeSend,
		) as unknown as { children: ReactElement<DiscProps> };
		const disc = send.children;
		expect(disc.props.className).toBe(cx(COMPOSER_DISC, "bg-sunken"));
		expect(disc.props.children.props.className).toBe(
			cx("text-body-sm font-medium", CONTROL_DISABLED_INK),
		);
	});

	it("wires attach and send to the screen's handlers", () => {
		const onAttach = vi.fn();
		const onSend = vi.fn();
		const controls = tree({ onAttach, onSend });
		controls.get(CONTROL.teamBridgeAttach)?.onPress();
		controls.get(CONTROL.teamBridgeSend)?.onPress();
		expect(onAttach).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledTimes(1);
	});

	it("keeps the retry wording as the send control's name", () => {
		const html = renderToStaticMarkup(
			createElement(BridgeComposerField, props({ sendLabel: "Retry send" })),
		);
		expect(tagOf(html, CONTROL.teamBridgeSend)).toContain(
			'aria-label="Retry send"',
		);
	});

	it("disables send when not sendable, and both controls while sending", () => {
		const idle = tree({ sendDisabled: true });
		expect(idle.get(CONTROL.teamBridgeSend)?.disabled).toBe(true);
		expect(idle.get(CONTROL.teamBridgeAttach)?.disabled).toBe(false);
		const busy = tree({ sending: true });
		expect(busy.get(CONTROL.teamBridgeSend)?.disabled).toBe(true);
		expect(busy.get(CONTROL.teamBridgeAttach)?.disabled).toBe(true);
		const html = renderToStaticMarkup(
			createElement(BridgeComposerField, props({ sending: true })),
		);
		expect(tagOf(html, CONTROL.teamBridgeSend)).toContain(
			'aria-disabled="true"',
		);
		// Busy rides the accessibility state (RNW's SSR does not serialise it).
		expect(
			(
				busy.get(CONTROL.teamBridgeSend) as unknown as {
					accessibilityState: { busy?: boolean };
				}
			).accessibilityState.busy,
		).toBe(true);
	});

	it("disables attach at the image limit, and omits it without a controller", () => {
		expect(
			tree({ attachDisabled: true }).get(CONTROL.teamBridgeAttach)?.disabled,
		).toBe(true);
		const none = tree({ attachLabel: undefined, onAttach: undefined });
		expect(none.has(CONTROL.teamBridgeAttach)).toBe(false);
		expect(none.has(CONTROL.teamBridgeSend)).toBe(true);
	});
});

/* Design D1 (round 1, MAJOR) + QA Q1-1: the shell drew a 1 pt
 * `border-control` outline at all times, the one thing that read as a
 * different component beside the agent pill, whose edge is a separate ring
 * that is transparent at rest and `border-control` only while focused
 * (`composer.tsx`, THE SHELL'S FOCUS EDGE). The border also sat inside the
 * box (rest 58 / text +61 against the agent's 56 / +60). */
describe("bridge composer edge ring (design D1)", () => {
	type Styled = ReactElement<{
		testID?: string;
		pointerEvents?: string;
		style: Record<string, number | string | undefined>;
		children: ReactNode;
	}>;
	const ringOf = (shell: Styled) =>
		(Children.toArray(shell.props.children) as Styled[]).find(
			(child) => child.props.testID === SURFACE.teamBridgeComposerRing,
		);

	it("the shell itself carries no border, so its box is the agent's 56", () => {
		const shell = view({ draft: "" }) as Styled;
		expect(shell.props.style.borderWidth).toBeUndefined();
		expect(shell.props.style.borderColor).toBeUndefined();
		expect(shell.props.style.minHeight).toBe(COMPOSER_BASE_HEIGHT);
	});

	it("draws the edge as a last, layout-free, untappable child ring", () => {
		const shell = view({ draft: "" }) as Styled;
		const children = Children.toArray(shell.props.children) as Styled[];
		const ring = ringOf(shell);
		expect(ring).toBeDefined();
		expect(children.at(-1)?.props.testID).toBe(SURFACE.teamBridgeComposerRing);
		expect(ring?.props.pointerEvents).toBe("none");
		expect(ring?.props.style).toMatchObject({
			position: "absolute",
			top: 0,
			bottom: 0,
			start: 0,
			end: 0,
			borderWidth: 1,
			borderRadius: morphPillRadius(COMPOSER_BASE_HEIGHT),
		});
	});

	it("is transparent at rest and border-control while focused", () => {
		const rest = ringOf(view({ draft: "" }, false) as Styled);
		const focused = ringOf(view({ draft: "" }, true) as Styled);
		expect(rest?.props.style.borderColor).toBe("transparent");
		expect(focused?.props.style.borderColor).toBe(BORDER_CONTROL);
	});

	it("mounted, the field's own focus and blur drive the ring", async () => {
		field.mounted = true;
		const dom = installDomShim();
		const root = createRoot(dom.container as Element);
		type Node = { style?: Record<string, string>; childNodes?: Node[] };
		const styles = (node: Node, out: Record<string, string>[] = []) => {
			if (node.style && Object.keys(node.style).length > 0)
				out.push(node.style);
			for (const child of node.childNodes ?? []) styles(child, out);
			return out;
		};
		// react-native-web writes the ring's style inline; the ring is the
		// one absolutely positioned box carrying a border width.
		const ringColour = () =>
			styles(dom.container as unknown as Node).find(
				(s) => s.position === "absolute" && s.borderTopWidth === "1px",
			)?.borderTopColor;
		try {
			await act(async () =>
				root.render(createElement(BridgeComposerField, props({ draft: "" }))),
			);
			// No painted box other than the ring has a border.
			expect(
				styles(dom.container as unknown as Node).filter(
					(s) => s.borderTopWidth !== undefined,
				),
			).toHaveLength(1);
			expect(ringColour()).toBe("rgba(0,0,0,0.00)");
			await act(async () => field.onFocus?.());
			expect(ringColour()).toBe("rgba(18,52,86,1.00)");
			await act(async () => field.onBlur?.());
			expect(ringColour()).toBe("rgba(0,0,0,0.00)");
		} finally {
			await act(async () => root.unmount());
			dom.dispose();
			field.mounted = false;
		}
	});
});
