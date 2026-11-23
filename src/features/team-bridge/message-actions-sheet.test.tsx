/**
 * The Team Bridge message-actions sheet (spec "Mobile Team Bridge: reactions
 * and start-a-thread", slice PR a). Operator: "there's no way to react or post
 * in a thread on mobile team bridge".
 *
 * Pinned at the screen seam: the REAL `ThreadMessageRow` and the REAL
 * `useMessageActions` hook (sheet state, handoff, clipboard, toast, selection
 * request), with only the native boundaries stubbed — the modal `Sheet`
 * (rendered inline while visible, its `onDismiss` captured), the clipboard,
 * the haptic engine, icons, and the row's unrelated children (avatar, images,
 * delivery). `Pressable` and `Text` are react-native-web's, wrapped so the test
 * can read the props the native views would receive.
 */
import { readFileSync } from "node:fs";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rec = vi.hoisted(() => ({
	os: "ios" as "ios" | "android" | "web",
	presses: new Map<string, Record<string, unknown>>(),
	texts: [] as Record<string, unknown>[],
	inputs: [] as Record<string, unknown>[],
	sheet: null as null | { onDismiss?: () => void; onClose: () => void },
	visible: false,
	details: null as null | { visible: boolean; onClose: () => void },
	focusReturns: 0,
	clipboard: [] as string[],
	haptics: [] as string[],
	rtl: false,
	/** Mount counts by testID: a memoised row that does not re-render keeps
	 *  its children mounted, so presence is tracked by effect, not by render. */
	mounted: new Map<string, number>(),
	viewStyles: [] as unknown[],
	/** Props the stubbed children last received, by component. */
	child: new Map<string, Record<string, unknown>>(),
	/** The REAL Team Bridge store behind the mocked provider (reactions). */
	bridge: null as unknown,
	announced: [] as string[],
	width: 390,
}));

vi.mock("react-native", async (importOriginal) => {
	const rnw = (await importOriginal()) as Record<string, unknown>;
	const { createElement, useEffect } = await import("react");
	return {
		...rnw,
		View: (props: { testID?: string; style?: unknown; className?: string }) => {
			useEffect(() => {
				const id = props.testID;
				if (!id) return;
				rec.mounted.set(id, (rec.mounted.get(id) ?? 0) + 1);
				return () => {
					rec.mounted.set(id, (rec.mounted.get(id) ?? 1) - 1);
				};
			}, [props.testID]);
			if (props.style) rec.viewStyles.push(props.style);
			if (props.testID)
				rec.child.set(props.testID, props as Record<string, unknown>);
			return createElement(rnw.View as never, props);
		},
		Platform: {
			...(rnw.Platform as object),
			get OS() {
				return rec.os;
			},
			select: (spec: Record<string, unknown>) => spec[rec.os] ?? spec.default,
		},
		Pressable: (props: {
			testID?: string;
			children?: ReactNode | ((s: { pressed: boolean }) => ReactNode);
		}) => {
			if (props.testID) rec.presses.set(props.testID, props);
			/* Mount-tracked like `View`: a pill that leaves the tree must stop
			 *  answering `pill()`, and a memoised one is not re-rendered. */
			useEffect(() => {
				const id = props.testID;
				if (!id) return;
				rec.mounted.set(id, (rec.mounted.get(id) ?? 0) + 1);
				return () => {
					rec.mounted.set(id, (rec.mounted.get(id) ?? 1) - 1);
				};
			}, [props.testID]);
			const content =
				typeof props.children === "function"
					? props.children({ pressed: false })
					: props.children;
			return createElement("div", { "data-testid": props.testID }, content);
		},
		// rnw's indicator draws SVG, which the DOM shim cannot create.
		ActivityIndicator: () => null,
		useWindowDimensions: () => ({
			width: rec.width,
			height: 844,
			scale: 3,
			fontScale: 1,
		}),
		AccessibilityInfo: {
			...(rnw.AccessibilityInfo as object),
			announceForAccessibility: (text: string) => rec.announced.push(text),
		},
		Text: (props: { children?: ReactNode }) => {
			rec.texts.push(props);
			return createElement("span", null, props.children);
		},
		TextInput: (props: { value?: string }) => {
			rec.inputs.push(props);
			return createElement("textarea", null, props.value);
		},
	};
});
// Textarea wraps its field with the native image-paste wrapper; Node cannot load it.
vi.mock("expo-paste-input", () => ({
	TextInputWrapper: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("expo-clipboard", () => ({
	setStringAsync: async (value: string) => {
		rec.clipboard.push(value);
		return true;
	},
}));
/* The provider's context, served by a REAL store (`createTeamBridgeStore`)
 *  the test builds per case: the reaction toggle, its in-flight guard and its
 *  rollback are the store's, so they run for real behind the row. */
vi.mock("@/team-bridge/provider", async (importOriginal) => {
	const { useStore } = await import("zustand");
	return {
		...((await importOriginal()) as object),
		useTeamBridge: () => rec.bridge,
		useTeamBridgeState: (select: (s: unknown) => unknown) =>
			useStore((rec.bridge as { store: never }).store, select),
	};
});
vi.mock("@/lib/haptics", () => ({
	haptic: (kind: string) => rec.haptics.push(kind),
}));
/* Every icon the app imports, as a null component: SVG drawing is not what is
 *  pinned here, and the package's own entry is not loadable in Node. */
vi.mock("lucide-react-native", () =>
	Object.fromEntries(
		[
			"AlertTriangle",
			"ArrowLeft",
			"ArrowRight",
			"ArrowUpRight",
			"AtSign",
			"Bell",
			"BellDot",
			"BellOff",
			"Bot",
			"CalendarClock",
			"Camera",
			"Check",
			"CheckCheck",
			"ChevronDown",
			"ChevronLeft",
			"ChevronRight",
			"ChevronUp",
			"ChevronsUpDown",
			"CircleAlert",
			"CircleDot",
			"CircleSlash",
			"ClipboardPaste",
			"Clock",
			"Code",
			"Copy",
			"File",
			"FileAudio",
			"FileText",
			"Folder",
			"FolderOpen",
			"FolderKanban",
			"Hash",
			"History",
			"Hourglass",
			"Image",
			"ImagePlus",
			"Images",
			"Inbox",
			"Info",
			"Keyboard",
			"Laptop",
			"Library",
			"ListChecks",
			"Lock",
			"LockOpen",
			"Menu",
			"MessageSquare",
			"MessageSquareOff",
			"MessageSquareReply",
			"MessagesSquare",
			"Mic",
			"MoreHorizontal",
			"MoreVertical",
			"Music",
			"Paperclip",
			"Pause",
			"Pencil",
			"Play",
			"Plus",
			"Presentation",
			"RefreshCw",
			"RotateCw",
			"Search",
			"Server",
			"Settings",
			"SlidersHorizontal",
			"SmilePlus",
			"Square",
			"SquarePen",
			"Star",
			"Table",
			"TextCursor",
			"TriangleAlert",
			"UserRound",
			"Users",
			"Video",
			"X",
		].map((name) => [name, () => null]),
	),
);
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#137742",
	useReducedMotion: () => false,
}));
vi.mock("@/ui/components/sheet", () => ({
	Sheet: (props: {
		visible: boolean;
		children: ReactNode;
		testID?: string;
		onDismiss?: () => void;
		onClose: () => void;
	}) => {
		if (props.testID === "team-bridge-reaction-details") rec.details = props;
		else {
			rec.sheet = props;
			rec.visible = props.visible;
		}
		return props.visible
			? createElement(
					"section",
					{ "data-testid": props.testID },
					props.children,
				)
			: null;
	},
}));
vi.mock("./reaction-focus", () => ({
	captureReactionFocus: () => () => {
		rec.focusReturns++;
	},
}));
vi.mock("./profile-card", () => ({
	ProfileAuthorName: (props: Record<string, unknown>) => {
		rec.child.set("ProfileAuthorName", props);
		return null;
	},
	ProfileAuthorPhoto: (props: Record<string, unknown>) => {
		rec.child.set("ProfileAuthorPhoto", props);
		return null;
	},
	ProfileSheet: () => null,
	UnknownSenderAvatar: () => null,
}));
vi.mock("./attachment-views", () => ({
	MessageAttachments: (props: Record<string, unknown>) => {
		rec.child.set("MessageAttachments", props);
		return null;
	},
	ComposerAttachments: () => null,
}));
vi.mock("./reply-thread-chip", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./reply-thread-chip")>();
	return {
		ReplyThreadChip: (props: Record<string, unknown>) => {
			rec.child.set("ReplyThreadChip", props);
			return createElement(actual.ReplyThreadChip, props as never);
		},
	};
});
vi.mock("@/ui/direction", async (importOriginal) => ({
	...((await importOriginal()) as object),
	useIsRTL: () => rec.rtl,
}));
vi.mock("./message-delivery", () => ({ MessageDelivery: () => null }));
/* The rest of thread-screen's import graph that ships native or Flow source
 *  Node cannot load; none of it is on the path under test. */
vi.mock("expo-router", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
	useLocalSearchParams: () => ({}),
	useFocusEffect: () => {},
	usePathname: () => "/",
	router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
	Link: () => null,
}));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-crypto", () => ({
	randomUUID: () => "00000000-0000-4000-8000-000000000000",
	getRandomBytes: (n: number) => new Uint8Array(n),
}));
vi.mock("expo-web-browser", () => ({}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-glass-effect", () => ({
	GlassView: () => null,
	isGlassEffectAPIAvailable: () => false,
	isLiquidGlassAvailable: () => false,
}));
vi.mock("react-native-reanimated", () => ({
	__esModule: true,
	default: { View: () => null },
	useSharedValue: (value: number) => ({ value }),
	useAnimatedStyle: () => ({}),
	withTiming: (value: number) => value,
	Easing: { bezier: () => () => 0 },
}));
vi.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native-svg", () => {
	const none = () => null;
	return {
		__esModule: true,
		default: none,
		Svg: none,
		Path: none,
		Rect: none,
		Circle: none,
		Defs: none,
		LinearGradient: none,
		Stop: none,
		G: none,
		Line: none,
		Text: none,
	};
});
vi.mock("uniwind", () => ({
	ScopedVariables: ({ children }: { children?: ReactNode }) => children ?? null,
	Uniwind: { setTheme: () => {}, updateCSSVariables: () => {} },
	useCSSVariable: () => undefined,
}));

const { installDomShim } = await import("@/testing/dom-shim");
const { resetLocaleSource, setLocaleSource } = await import("@/i18n/locale");
const {
	message: fixture,
	person: personFixture,
	SELF,
} = await import("@/team-bridge/__tests__/fixtures");
const { replyThreadPath } = await import("@/team-bridge/reply-threads");
const { useUiStore } = await import("@/state/ui-store");
const a11y = await import("@/ui/a11y");
const selection = await import("@/features/session/text-selection");
const { createTeamBridgeStore } = await import("@/team-bridge/store");
const sheetModule = await import("./message-actions-sheet");
const { useTeamBridgeState } = await import("@/team-bridge/provider");
const { ThreadMessageRow } = await import("./thread-screen");
type Message = import("@/team-bridge/contract").Message;

const ROOT = fixture(1, SELF, "2026-11-18T09:00:00Z", {
	body: "Ship **it** today",
});
const REPLY = fixture(2, SELF, "2026-11-18T09:01:00Z", {
	body: "on it",
	thread_root_id: ROOT.id,
});
const IMAGE_ONLY = fixture(3, SELF, "2026-11-18T09:02:00Z", { body: "" });

function Harness({
	message,
	scope = "timeline",
	canReplyInThread = true,
	canReact = false,
	onReplyInThread,
	continuation = false,
	onOpenReplyThread,
	people = [],
}: {
	message: Message;
	scope?: "timeline" | "reply";
	canReplyInThread?: boolean;
	/** Off by default so the PR a cases keep their exact action lists; the
	 *  reaction cases below turn it on. */
	canReact?: boolean;
	onReplyInThread?: (rootId: string) => void;
	continuation?: boolean;
	onOpenReplyThread?: (rootId: string) => void;
	people?: readonly unknown[];
}) {
	const actions = sheetModule.useMessageActions({
		scope,
		tenantId: "ten_x",
		canReplyInThread,
		canReact,
		onReplyInThread,
	});
	const [hub] = useState(() => ({}) as never);
	return createElement(
		"main",
		null,
		createElement(ThreadMessageRow, {
			message,
			continuation,
			onOpenReplyThread,
			people: people as never,
			hub,
			tenantId: "ten_x",
			onOpenProfile: () => {},
			onDeliveryHelp: () => {},
			locale: "en",
			actions: actions.controller,
			actionsOpen: actions.openMessageId === message.id,
		}),
		actions.sheet,
	);
}

let dom: ReturnType<typeof installDomShim>;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	rec.os = "ios";
	rec.presses.clear();
	rec.texts.length = 0;
	rec.inputs.length = 0;
	rec.sheet = null;
	rec.visible = false;
	rec.clipboard.length = 0;
	rec.haptics.length = 0;
	rec.announced.length = 0;
	rec.width = 390;
	rec.bridge = createTeamBridgeStore({
		hub: () => null,
		accessToken: async () => null,
	});
	rec.rtl = false;
	rec.mounted.clear();
	rec.viewStyles.length = 0;
	rec.child.clear();
	setLocaleSource(() => "en");
	useUiStore.setState({ toast: null });
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	resetLocaleSource();
	selection.exitTextSelection();
});

const render = (props: Parameters<typeof Harness>[0]) =>
	act(async () => root.render(createElement(Harness, props)));
const row = (m: Message) => rec.presses.get(a11y.teamBridgeMessageId(m.id));
/** A recorded handler, or a failed test naming the missing one. */
const handler = (props: Record<string, unknown> | undefined, name: string) => {
	const fn = props?.[name];
	if (typeof fn !== "function") throw new Error(`no ${name} recorded`);
	return fn as (...args: unknown[]) => void;
};
const longPress = (m: Message) => {
	const press = handler(row(m), "onLongPress");
	rec.presses.clear();
	return act(async () => press());
};
const sheetOpen = () => rec.visible;
/** The row's referent layer (sheet open, or in the Select text mode). */
const tinted = () =>
	(rec.mounted.get(a11y.SURFACE.teamBridgeMessageActionsTint) ?? 0) > 0;
const offered = () =>
	(["reply_in_thread", "copy_text", "select_text"] as const).filter((a) =>
		rec.presses.has(a11y.teamBridgeMessageActionId(a)),
	);
const choose = async (action: string) => {
	const press = rec.presses.get(a11y.teamBridgeMessageActionId(action));
	rec.presses.clear();
	await act(async () => handler(press, "onPress")());
};
/** iOS runs a choice only after the modal's native dismissal. */
const nativeDismiss = () => act(async () => rec.sheet?.onDismiss?.());
const leafActions = () =>
	rec.texts
		.map((t) => t.accessibilityActions as { name: string; label: string }[])
		.filter(Boolean)
		.at(-1);

describe("the action list (pure)", () => {
	it("root with text: Reply in thread, Copy text, Select text, in that order", () => {
		expect(
			sheetModule.messageActions(ROOT, { canReplyInThread: true }),
		).toEqual(["reply_in_thread", "copy_text", "select_text"]);
	});
	it("a reply never offers Reply in thread (threads are one level deep)", () => {
		expect(
			sheetModule.messageActions(REPLY, { canReplyInThread: true }),
		).toEqual(["copy_text", "select_text"]);
	});
	it("a body selectable at rest drops Select text and keeps Copy text", () => {
		expect(
			sheetModule.messageActions(ROOT, {
				canReplyInThread: true,
				selectableAtRest: true,
			}),
		).toEqual(["reply_in_thread", "copy_text"]);
	});
	it("no text: nothing to copy or select; a null body is not a crash", () => {
		expect(
			sheetModule.messageActions(IMAGE_ONLY, { canReplyInThread: true }),
		).toEqual(["reply_in_thread"]);
		expect(
			sheetModule.messageActions(
				{ body: null as never, thread_root_id: undefined },
				{ canReplyInThread: false },
			),
		).toEqual([]);
	});
	it("compose asks the thread screen to focus its composer", () => {
		const target = { tenantId: "t", conversationId: "c", rootId: "r" };
		expect(replyThreadPath(target)).toBe("/team-bridge/t/c/thread/r");
		expect(replyThreadPath(target, { compose: true })).toBe(
			"/team-bridge/t/c/thread/r?compose=1",
		);
	});
});

describe("long-press opens the sheet (timeline row)", () => {
	it("opens with a light haptic, tints the row, offers all three actions", async () => {
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		expect(sheetOpen()).toBe(false);
		expect(tinted()).toBe(false);
		await longPress(ROOT);
		expect(rec.haptics).toEqual(["light"]);
		expect(tinted()).toBe(true);
		/* Design round 1 D3: `row-selected` alone measured 1.03:1 under the
		 *  scrim; the accent start edge is what marks the referent there. */
		expect(
			String(
				rec.child.get(a11y.SURFACE.teamBridgeMessageActionsTint)?.className,
			).split(" "),
		).toEqual(expect.arrayContaining(["border-s-4", "border-accent"]));
		expect(offered()).toEqual(["reply_in_thread", "copy_text", "select_text"]);
		expect(
			rec.presses.get(a11y.teamBridgeMessageActionId("reply_in_thread"))
				?.accessibilityLabel,
		).toBe("Reply in thread");
	});

	it("Reply in thread on a zero-reply root pushes after the native dismissal (iOS)", async () => {
		const onReplyInThread = vi.fn();
		await render({ message: ROOT, onReplyInThread });
		await longPress(ROOT);
		await choose("reply_in_thread");
		// Under a still-presented modal a push is swallowed: not yet.
		expect(onReplyInThread).not.toHaveBeenCalled();
		await nativeDismiss();
		expect(onReplyInThread).toHaveBeenCalledWith(ROOT.id);
		expect(sheetOpen()).toBe(false);
	});

	it("Android runs the choice at once (it never fires onDismiss)", async () => {
		rec.os = "android";
		const onReplyInThread = vi.fn();
		await render({ message: ROOT, onReplyInThread });
		await longPress(ROOT);
		await choose("reply_in_thread");
		expect(onReplyInThread).toHaveBeenCalledWith(ROOT.id);
	});

	/* Round 1 U1/D1/Q2: on web the closing sheet's focus return took focus
	 *  back from the composer the push had just focused. */
	it("web waits for the sheet's onDismiss (after its focus return) before pushing", async () => {
		rec.os = "web";
		const onReplyInThread = vi.fn();
		await render({ message: ROOT, onReplyInThread });
		await longPress(ROOT);
		await choose("reply_in_thread");
		expect(onReplyInThread).not.toHaveBeenCalled();
		await nativeDismiss();
		expect(onReplyInThread).toHaveBeenCalledTimes(1);
		expect(onReplyInThread).toHaveBeenCalledWith(ROOT.id);
		expect(tinted()).toBe(false);
	});

	it("which platforms run a choice after the dismissal", () => {
		expect(
			(["ios", "web", "android"] as const).map((os) =>
				sheetModule.runsAfterDismissal(os),
			),
		).toEqual([true, true, false]);
	});

	it("Copy text puts the PLAIN text on the clipboard and confirms with a toast", async () => {
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		await longPress(ROOT);
		await choose("copy_text");
		await nativeDismiss();
		expect(rec.clipboard).toEqual(["Ship it today"]);
		expect(useUiStore.getState().toast?.message).toBe("Copied");
	});

	it("Select text enters the existing selection mode (iOS)", async () => {
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		expect(rec.inputs).toHaveLength(0);
		await longPress(ROOT);
		await choose("select_text");
		await nativeDismiss();
		expect(selection.activeTextSelection()).toBe(
			sheetModule.bridgeSelectionId("timeline", ROOT.id),
		);
		expect(rec.inputs.at(-1)).toMatchObject({
			value: "Ship it today",
			editable: false,
		});
	});

	it("Select text makes the message selectable (Android), not before", async () => {
		rec.os = "android";
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		const bodyLeaf = () =>
			rec.texts.filter((t) => "selectable" in t).at(-1)?.selectable;
		expect(bodyLeaf()).toBe(false);
		await longPress(ROOT);
		await choose("select_text");
		expect(bodyLeaf()).toBe(true);
	});

	/* Design round 1 D2: off iOS the mode changed nothing you could see. */
	it("Android holds the referent tint while the message is in the mode, and drops it on exit", async () => {
		rec.os = "android";
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		await longPress(ROOT);
		await choose("select_text");
		expect(sheetOpen()).toBe(false);
		expect(tinted()).toBe(true);
		await act(async () => selection.exitTextSelection());
		expect(tinted()).toBe(false);
	});

	it("iOS adds no row tint in the mode (its selection view is the visible state)", async () => {
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		await longPress(ROOT);
		await choose("select_text");
		await nativeDismiss();
		expect(selection.activeTextSelection()).not.toBeNull();
		expect(tinted()).toBe(false);
	});

	/* QA round 1 Q3: desktop-browser readers expect to drag-select. */
	it("web keeps the body selectable at rest", async () => {
		rec.os = "web";
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		expect(rec.texts.filter((t) => "selectable" in t).at(-1)?.selectable).toBe(
			true,
		);
	});

	/* Round 2 (UX U7, design D8, QA N1): on web the mode added nothing but a
	 *  tint no mouse could clear, since the body is already selectable. */
	it("web does not offer Select text (the body is selectable at rest)", async () => {
		rec.os = "web";
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		await longPress(ROOT);
		expect(offered()).toEqual(["reply_in_thread", "copy_text"]);
	});

	it("a read-only conversation does not offer Reply in thread", async () => {
		await render({
			message: ROOT,
			canReplyInThread: false,
			onReplyInThread: vi.fn(),
		});
		await longPress(ROOT);
		expect(offered()).toEqual(["copy_text", "select_text"]);
	});
});

describe("reply thread screen rows", () => {
	it("never offer Reply in thread, root or reply", async () => {
		for (const m of [ROOT, REPLY]) {
			rec.presses.clear();
			await render({ message: m, scope: "reply", canReplyInThread: false });
			await longPress(m);
			expect(offered()).toEqual(["copy_text", "select_text"]);
			await act(async () => rec.sheet?.onClose());
		}
	});
});

describe("screen readers reach every action without a long-press", () => {
	it("the body leaf carries the row's actions, and running one acts directly", async () => {
		const onReplyInThread = vi.fn();
		await render({ message: ROOT, onReplyInThread });
		expect(leafActions()).toEqual([
			{ name: "reply_in_thread", label: "Reply in thread" },
			{ name: "copy_text", label: "Copy text" },
			{ name: "select_text", label: "Select text" },
		]);
		const leaf = rec.texts.filter((t) => t.onAccessibilityAction).at(-1);
		await act(async () =>
			handler(
				leaf,
				"onAccessibilityAction",
			)({
				nativeEvent: { actionName: "reply_in_thread" },
			}),
		);
		expect(onReplyInThread).toHaveBeenCalledWith(ROOT.id);
		expect(sheetOpen()).toBe(false);
	});

	it("an image-only root carries Reply in thread on its timestamp", async () => {
		await render({ message: IMAGE_ONLY, onReplyInThread: vi.fn() });
		expect(leafActions()).toEqual([
			{ name: "reply_in_thread", label: "Reply in thread" },
		]);
	});

	/* Round 1 M2: a same-sender continuation renders no timestamp, so an
	 *  image-only one had no element carrying the actions. */
	it("an image-only CONTINUATION carries the actions on its attachment tiles", async () => {
		const onReplyInThread = vi.fn();
		await render({ message: IMAGE_ONLY, onReplyInThread, continuation: true });
		const tiles = rec.child.get("MessageAttachments");
		expect(tiles?.accessibility).toMatchObject({
			accessibilityActions: [
				{ name: "reply_in_thread", label: "Reply in thread" },
			],
		});
		await act(async () =>
			handler(
				tiles?.accessibility as Record<string, unknown>,
				"onAccessibilityAction",
			)({ nativeEvent: { actionName: "reply_in_thread" } }),
		);
		expect(onReplyInThread).toHaveBeenCalledWith(IMAGE_ONLY.id);
	});

	it("a message WITH text leaves the tiles to their own labels", async () => {
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		expect(rec.child.get("MessageAttachments")?.accessibility).toBeUndefined();
	});

	it("the row container is not one accessibility element (links stay reachable)", async () => {
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		expect(row(ROOT)?.accessible).toBe(false);
	});
});

const COMPOSE_PARAM_WIRED =
	/compose=\{single\(params\[REPLY_THREAD_COMPOSE_PARAM\]\) === "1"\}/;
const AUTOFOCUS_COMPOSE = /autoFocus=\{compose\}/;
const SHEET_COMPOSES =
	/replyThreadPath\(\s*\{ tenantId, conversationId, rootId \},\s*\{ compose: true \},?\s*\)/;
const FIELD_AUTOFOCUS = /onFocus=\{onFocus\}\s*autoFocus=\{autoFocus\}/;
/* "Reply in thread" lands with the composer focused. The reply screen's
 *  provider/store graph is not renderable here, so its wiring is pinned in
 *  source, the convention of `selectable-wiring.test.ts`. */
describe("the reply thread focuses its composer when opened to compose", () => {
	const source = (file: string) =>
		readFileSync(new URL(file, import.meta.url), "utf8");
	it("reads the compose param and hands it to the composer as autoFocus", () => {
		const screen = source("./reply-thread-screen.tsx");
		expect(screen).toMatch(COMPOSE_PARAM_WIRED);
		expect(screen).toMatch(AUTOFOCUS_COMPOSE);
		// Only the sheet's entry composes; the chip opens the thread to read.
		expect(source("./thread-screen.tsx")).toMatch(SHEET_COMPOSES);
	});
	it("the composer field passes autoFocus through to its input", () => {
		expect(source("./thread-chrome.tsx")).toMatch(FIELD_AUTOFOCUS);
	});
});

/* Round 1 m1/U2/U6: a Pressable with onPress and no onLongPress releases a
 *  hold as a press, so the image, name, photo and reply chip swallowed it. */
describe("a hold on a control inside the row opens the row's sheet", () => {
	const REPLIED = { ...ROOT, reply_count: 2 } as Message;
	for (const child of [
		"MessageAttachments",
		"ProfileAuthorName",
		"ProfileAuthorPhoto",
		"ReplyThreadChip",
	]) {
		it(child, async () => {
			rec.child.clear();
			await render({
				message: REPLIED,
				onReplyInThread: vi.fn(),
				onOpenReplyThread: vi.fn(),
				// A sender the directory knows, so the name and photo render.
				people: [personFixture(SELF, "Sam")],
			});
			const hold = handler(rec.child.get(child), "onLongPress");
			await act(async () => hold());
			expect(sheetOpen()).toBe(true);
			expect(rec.haptics).toEqual(["light"]);
		});
	}
});

/* Design round 1 D6. */
describe("the Reply in thread icon mirrors in RTL", () => {
	const mirrored = () =>
		rec.viewStyles.filter(
			(style) =>
				JSON.stringify(style) ===
				JSON.stringify({ transform: [{ scaleX: -1 }] }),
		).length;
	it("ltr: drawn as is", async () => {
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		await longPress(ROOT);
		expect(mirrored()).toBe(0);
	});
	it("rtl: only the reply glyph flips", async () => {
		rec.rtl = true;
		await render({ message: ROOT, onReplyInThread: vi.fn() });
		rec.viewStyles.length = 0;
		await longPress(ROOT);
		expect(offered()).toEqual(["reply_in_thread", "copy_text", "select_text"]);
		expect(mirrored()).toBeGreaterThan(0);
	});
	it("rtl: Copy and Select text stay as drawn", async () => {
		rec.rtl = true;
		await render({ message: REPLY, scope: "reply", canReplyInThread: false });
		rec.viewStyles.length = 0;
		await longPress(REPLY);
		expect(offered()).toEqual(["copy_text", "select_text"]);
		expect(mirrored()).toBe(0);
	});
});

const SELECTION_CONTAINER_WIRING = [
	/onTouchStart=\{textSelectionContainerTouch\}/,
	/onTouchEnd=\{textSelectionContainerTouchEnd\}/,
	/onTouchCancel=\{textSelectionContainerTouchCancel\}/,
	/onScrollBeginDrag=\{textSelectionContainerScroll\}/,
];
const NO_DIVIDER_AT_ZERO =
	/count === 0 && thread\.replies\.length === 0\s*\?\s*\[\]/;
/* The reply screen is pinned in source (see above). */
describe("served last-reply chip", () => {
	it.each([undefined, "not-a-time", "2026-11-17T10:05:00Z"])(
		"renders time only for a valid authoritative rollup (%s)",
		async (last_reply_at) => {
			await act(async () =>
				root.render(
					createElement(Harness, {
						message: { ...ROOT, reply_count: 2, last_reply_at },
						onOpenReplyThread: () => {},
					}),
				),
			);
			const chip = rec.presses.get(a11y.teamBridgeReplyThreadOpenId(ROOT.id));
			if (last_reply_at?.startsWith("2026")) {
				const expected = `Last reply ${new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(new Date(last_reply_at))}`;
				expect(chip?.accessibilityHint).toBe(expected);
				expect(rec.texts.some((text) => text.children === expected)).toBe(true);
			} else expect(chip?.accessibilityHint).toBeUndefined();
		},
	);
});

describe("the reply thread screen", () => {
	const screen = () =>
		readFileSync(new URL("./reply-thread-screen.tsx", import.meta.url), "utf8");
	it("wires the selection container handlers, so an outside tap ends Select text (round 1, m2)", () => {
		for (const wiring of SELECTION_CONTAINER_WIRING)
			expect(screen()).toMatch(wiring);
	});
	it("omits the divider at zero replies (design round 1, D5)", () => {
		expect(screen()).toMatch(NO_DIVIDER_AT_ZERO);
	});
});

/* ---- reactions (spec slice PR b) ----------------------------------------
 *  The REAL row, sheet hook, pills and store; only the hub is a fake whose
 *  `react` the case scripts. The row reads its message FROM the store, as the
 *  screens do, so a server answer or a rollback is what the reader sees. */
describe("reactions: pills, quick row, rollback", () => {
	const THUMBS = "👍";
	const PARTY = "🎉";
	const CONV = ROOT.conversation_id;
	const KEY = `ten_x/${CONV}`;
	type Row = import("@/team-bridge/contract").Reaction;
	const rx = (emoji: string, count: number, mine = false): Row => ({
		emoji,
		count,
		reacted_by_me: mine,
		sample_labels: [],
	});
	type Bridge = ReturnType<typeof createTeamBridgeStore>;
	const bridge = () => rec.bridge as Bridge;
	const seed = (
		reactions: Row[] | undefined,
		react: (...args: unknown[]) => Promise<unknown>,
	) => {
		const hub = { react: vi.fn(react) };
		rec.bridge = createTeamBridgeStore({
			hub: () => hub as never,
			accessToken: async () => "t",
		});
		bridge().store.setState({
			selfAccountId: SELF,
			threads: {
				[KEY]: {
					messages: [{ ...ROOT, reactions }],
					state: "ready",
					error: null,
					hasMore: false,
					loadingOlder: false,
					olderError: null,
				},
			},
		});
		return hub;
	};
	function StoreRow({ canReact }: { canReact: boolean }) {
		const held = useTeamBridgeState(
			(s) => s.threads[KEY]?.messages[0],
		) as Message;
		return createElement(Harness, { message: held, canReact });
	}
	const mount = (canReact = true) =>
		act(async () => root.render(createElement(StoreRow, { canReact })));
	const pill = (emoji: string) => {
		const id = a11y.teamBridgeReactionPillId(emoji);
		return mounted(id) ? rec.presses.get(id) : undefined;
	};
	const tap = async (emoji: string) => {
		const press = handler(pill(emoji), "onPress");
		await act(async () => press());
	};
	const deferred = () => {
		let resolve!: (v: unknown) => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};
	const mounted = (id: string) => (rec.mounted.get(id) ?? 0) > 0;

	it("no reactions: no pill row at all (zero added height)", async () => {
		seed(undefined, async () => ({}));
		await mount();
		expect(mounted(a11y.SURFACE.teamBridgeReactionPills)).toBe(false);
		expect(rec.presses.has(a11y.SURFACE.teamBridgeReactionAdd)).toBe(false);
	});

	it("VoiceOver reads emoji, count and 'you reacted'; the summary leads", async () => {
		seed([rx(THUMBS, 3, true), rx(PARTY, 1)], async () => ({}));
		await mount();
		expect(pill(THUMBS)?.accessibilityLabel).toBe(
			"👍, 3 reactions, you reacted",
		);
		expect(pill(THUMBS)?.accessibilityState).toMatchObject({ selected: true });
		expect(pill(THUMBS)?.accessibilityHint).toBe(
			"Double tap to remove your reaction",
		);
		expect(pill(PARTY)?.accessibilityLabel).toBe("🎉, 1 reaction");
		expect(pill(PARTY)?.accessibilityHint).toBe("Double tap to react too");
		expect(rec.texts.some((t) => t.children === "4 reactions")).toBe(true);
		// Mine carries the accent ring (contrast row "team bridge own reaction pill").
		expect(
			String(
				rec.child.get(`${a11y.teamBridgeReactionPillId(THUMBS)}-visual`)
					?.className,
			),
		).toContain("border-accent-border");
		expect(
			String(
				rec.child.get(`${a11y.teamBridgeReactionPillId(PARTY)}-visual`)
					?.className,
			),
		).toContain("border-border-control");
	});

	it("tap another's pill: +1 and mine at once; the answer replaces it; tap again reverts", async () => {
		const write = deferred();
		const hub = seed([rx(THUMBS, 2)], () => write.promise);
		await mount();
		await tap(THUMBS);
		expect(rec.haptics).toEqual(["selection"]);
		expect(pill(THUMBS)?.accessibilityLabel).toBe(
			"👍, 3 reactions, you reacted",
		);
		expect(pill(THUMBS)?.accessibilityState).toMatchObject({
			selected: true,
			busy: true,
		});
		expect(hub.react).toHaveBeenCalledWith(
			"ten_x",
			CONV,
			ROOT.id,
			THUMBS,
			true,
		);
		await act(async () =>
			write.resolve({ message_id: ROOT.id, reactions: [rx(THUMBS, 3, true)] }),
		);
		expect(pill(THUMBS)?.accessibilityState).toMatchObject({ busy: false });
		expect(rec.announced).toEqual(["Reaction added"]);
		hub.react.mockImplementation(async () => ({
			message_id: ROOT.id,
			reactions: [rx(THUMBS, 2)],
		}));
		await tap(THUMBS);
		expect(hub.react).toHaveBeenLastCalledWith(
			"ten_x",
			CONV,
			ROOT.id,
			THUMBS,
			false,
		);
		expect(pill(THUMBS)?.accessibilityLabel).toBe("👍, 2 reactions");
		expect(rec.announced.at(-1)).toBe("Reaction removed");
	});

	it("my sole reaction: tapping it removes the pill (and the row)", async () => {
		seed([rx(PARTY, 1, true)], async () => ({
			message_id: ROOT.id,
			reactions: [],
		}));
		await mount();
		await tap(PARTY);
		expect(pill(PARTY)).toBeUndefined();
		expect(mounted(a11y.SURFACE.teamBridgeReactionPills)).toBe(false);
	});

	it("a forced 500 restores the exact prior state, shows the error line, warning haptic", async () => {
		const write = deferred();
		seed([rx(THUMBS, 2), rx(PARTY, 1, true)], () => write.promise);
		await mount();
		await tap(PARTY);
		expect(pill(PARTY)).toBeUndefined(); // optimistic: my sole one removed
		const { HubError } = await import("@/team-bridge/client");
		await act(async () =>
			write.reject(new HubError({ kind: "server", message: "x", status: 500 })),
		);
		expect(pill(PARTY)?.accessibilityLabel).toBe("🎉, 1 reaction, you reacted");
		expect(pill(THUMBS)?.accessibilityLabel).toBe("👍, 2 reactions");
		expect(rec.haptics).toEqual(["selection", "warning"]);
		expect(
			rec.texts.some(
				(t) =>
					t.testID === a11y.SURFACE.teamBridgeReactionError &&
					t.children === "Reaction couldn't be saved. Try again.",
			),
		).toBe(true);
		expect(rec.announced).toEqual(["Reaction couldn't be saved. Try again."]);
	});

	it("a quick double tap sends ONE request", async () => {
		const write = deferred();
		const hub = seed([rx(THUMBS, 2)], () => write.promise);
		await mount();
		const press = handler(pill(THUMBS), "onPress");
		await act(async () => {
			press();
			press();
		});
		expect(hub.react).toHaveBeenCalledTimes(1);
		expect(rec.haptics).toEqual(["selection"]);
		await act(async () =>
			write.resolve({ message_id: ROOT.id, reactions: [rx(THUMBS, 3, true)] }),
		);
	});

	it("a hub without the route (uncoded 404): every reaction control goes, no error", async () => {
		const { HubError } = await import("@/team-bridge/client");
		seed([rx(THUMBS, 2)], async () => {
			throw new HubError({ kind: "not_found", message: "x", status: 404 });
		});
		await mount();
		await tap(THUMBS);
		expect(mounted(a11y.SURFACE.teamBridgeReactionPills)).toBe(false);
		expect(mounted(a11y.SURFACE.teamBridgeReactionError)).toBe(false);
		expect(rec.haptics).toEqual(["selection"]);
		expect(rec.announced).toEqual([]);
		// The sheet loses its quick row and the row loses "React".
		await longPress(ROOT);
		expect(rec.presses.has(a11y.teamBridgeQuickReactionId(THUMBS))).toBe(false);
		expect(
			(leafActions() ?? []).some((a) => a.name === sheetModule.REACT_ACTION),
		).toBe(false);
	});

	it("the sheet's quick row: desktop quick set, mine tinted, a tap toggles and closes", async () => {
		const hub = seed([rx(PARTY, 1, true)], async () => ({
			message_id: ROOT.id,
			reactions: [rx(PARTY, 1, true), rx(THUMBS, 1, true)],
		}));
		await mount();
		await longPress(ROOT);
		expect(rec.mounted.get(a11y.SURFACE.teamBridgeQuickReactions)).toBe(1);
		// 390 pt: ⌊(390 − 28) / 48⌋ = 7 cells → 6 emoji + `+`.
		const cells = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];
		for (const emoji of cells)
			expect(rec.presses.has(a11y.teamBridgeQuickReactionId(emoji))).toBe(true);
		expect(rec.presses.has(a11y.teamBridgeQuickReactionId("✅"))).toBe(false);
		expect(rec.presses.has(a11y.teamBridgeQuickReactionId("+"))).toBe(true);
		const party = rec.presses.get(a11y.teamBridgeQuickReactionId(PARTY));
		expect(String(party?.className)).toContain("bg-accent-wash");
		expect(party?.accessibilityState).toMatchObject({ selected: true });
		const thumbs = handler(
			rec.presses.get(a11y.teamBridgeQuickReactionId(THUMBS)),
			"onPress",
		);
		await act(async () => thumbs());
		expect(sheetOpen()).toBe(false);
		expect(hub.react).toHaveBeenCalledWith(
			"ten_x",
			CONV,
			ROOT.id,
			THUMBS,
			true,
		);
		expect(pill(THUMBS)?.accessibilityLabel).toBe(
			"👍, 1 reaction, you reacted",
		);
	});

	it("quick-row cell count follows the window: 320 → 5 + `+`, 430 → 7 + `+`", () => {
		expect(sheetModule.quickReactionCells(320)).toBe(6);
		expect(sheetModule.quickReactionCells(430)).toBe(8);
		expect(sheetModule.quickReactionCells(1024)).toBe(8);
	});

	it("`+` waits for the sheet to go, then the system keyboard picks; letters are ignored", async () => {
		const hub = seed([rx(THUMBS, 1)], async () => ({
			message_id: ROOT.id,
			reactions: [rx(THUMBS, 1), rx("🦄", 1, true)],
		}));
		await mount();
		await longPress(ROOT);
		const more = handler(
			rec.presses.get(a11y.teamBridgeQuickReactionId("+")),
			"onPress",
		);
		await act(async () => more());
		const captures = () =>
			rec.inputs.filter(
				(i) => i.testID === a11y.SURFACE.teamBridgeEmojiCapture,
			);
		expect(captures()).toHaveLength(0); // iOS: not under the closing modal
		await nativeDismiss();
		const field = captures().at(-1);
		expect(field?.accessibilityHint).toBe("Pick an emoji from your keyboard");
		await act(async () => handler(field, "onChangeText")("a"));
		expect(hub.react).not.toHaveBeenCalled();
		await act(async () => handler(captures().at(-1), "onChangeText")("🦄"));
		expect(hub.react).toHaveBeenCalledWith("ten_x", CONV, ROOT.id, "🦄", true);
	});

	it("the trailing `+` and the 'React' action both open the sheet", async () => {
		seed([rx(THUMBS, 1)], async () => ({}));
		await mount();
		await act(async () =>
			handler(rec.presses.get(a11y.SURFACE.teamBridgeReactionAdd), "onPress")(),
		);
		expect(sheetOpen()).toBe(true);
		await act(async () => rec.sheet?.onClose());
		await nativeDismiss();
		const actionsNow = leafActions() ?? [];
		expect(actionsNow[0]).toEqual({ name: "react", label: "React" });
		const leaf = rec.texts.filter((t) => t.onAccessibilityAction).at(-1);
		await act(async () =>
			handler(
				leaf,
				"onAccessibilityAction",
			)({
				nativeEvent: { actionName: "react" },
			}),
		);
		expect(sheetOpen()).toBe(true);
	});

	it("pill hold inspects sampled labels independently of mine; it does not toggle or open message actions", async () => {
		const hub = seed(
			[{ ...rx(THUMBS, 8, true), sample_labels: ["Ada", "Ben", "Cy"] }],
			async () => ({}),
		);
		await mount();
		await act(async () => handler(pill(THUMBS), "onLongPress")());
		expect(rec.details?.visible).toBe(true);
		expect(rec.visible).toBe(false);
		expect(
			rec.texts.some(
				(text) => text.children === "Ada, Ben, and Cy and 5 others",
			),
		).toBe(true);
		expect(rec.texts.some((text) => text.children === "You reacted")).toBe(
			true,
		);
		expect(hub.react).not.toHaveBeenCalled();
		await act(async () => rec.details?.onClose());
		expect(rec.details?.visible).toBe(false);
	});

	it.each([false, true])(
		"14 pills collapse at three measured lines and expand without losing counts (RTL=%s)",
		async (rtl) => {
			rec.rtl = rtl;
			const emoji = [
				"👍",
				"🎉",
				"😀",
				"😁",
				"😂",
				"😃",
				"😄",
				"😅",
				"😆",
				"😉",
				"😊",
				"😋",
				"😎",
				"😍",
			];
			seed(
				emoji.map((item) => rx(item, 2)),
				async () => ({}),
			);
			await mount();
			await act(async () => {
				for (const item of emoji)
					handler(
						rec.child.get(a11y.teamBridgeReactionMeasureId(item)),
						"onLayout",
					)({ nativeEvent: { layout: { width: 44 } } });
				handler(
					rec.child.get("team-bridge-reaction-wrap"),
					"onLayout",
				)({ nativeEvent: { layout: { width: 150 } } });
			});
			expect(emoji.filter((item) => pill(item))).toHaveLength(8);
			expect(rec.texts.some((text) => text.children === "28 reactions")).toBe(
				true,
			);
			const expand = () => rec.presses.get("team-bridge-reactions-expand");
			expect(expand()?.accessibilityState).toMatchObject({ expanded: false });
			await act(async () => handler(expand(), "onPress")());
			expect(emoji.filter((item) => pill(item))).toHaveLength(14);
			expect(expand()?.accessibilityState).toMatchObject({ expanded: true });
			await act(async () => handler(expand(), "onPress")());
			expect(emoji.filter((item) => pill(item))).toHaveLength(8);
			// These are native layout contracts, NOT a rendered geometry claim.
			expect(pill(THUMBS)?.style).toMatchObject({ minWidth: 44, height: 44 });
			expect(
				rec.presses.get(a11y.SURFACE.teamBridgeReactionAdd)?.style,
			).toMatchObject({ minWidth: 44, height: 44 });
			expect(
				rec.presses.get(a11y.SURFACE.teamBridgeReactionAdd)?.hitSlop,
			).toBeUndefined();
		},
	);

	it.each(["cancel", "pick"])(
		"custom emoji %s returns origin focus once, only after capture unmount",
		async (ending) => {
			seed([rx(THUMBS, 1)], async () => ({
				message_id: ROOT.id,
				reactions: [rx(THUMBS, 1), rx("🦄", 1, true)],
			}));
			await mount();
			await longPress(ROOT);
			await act(async () =>
				handler(
					rec.presses.get(a11y.teamBridgeQuickReactionId("+")),
					"onPress",
				)(),
			);
			await nativeDismiss();
			const field = rec.inputs
				.filter((item) => item.testID === a11y.SURFACE.teamBridgeEmojiCapture)
				.at(-1);
			const before = rec.focusReturns;
			await act(async () => {
				if (ending === "pick") handler(field, "onChangeText")("🦄");
				handler(field, "onBlur")();
			});
			expect(rec.focusReturns).toBe(before + 1);
			await act(async () => handler(field, "onBlur")());
			expect(rec.focusReturns).toBe(before + 1);
		},
	);

	it("a read-only conversation shows pills but offers no toggle, `+` or quick row", async () => {
		const hub = seed([rx(THUMBS, 2)], async () => ({}));
		await mount(false);
		expect(pill(THUMBS)?.disabled).not.toBe(true);
		await tap(THUMBS);
		expect(rec.details?.visible).toBe(true);
		expect(
			rec.texts.some(
				(text) => text.children === "No names were included in this summary.",
			),
		).toBe(true);
		expect(rec.texts.some((text) => text.children === "You reacted")).toBe(
			false,
		);
		expect(pill(THUMBS)?.accessibilityHint).toBe(
			"Double tap to inspect reaction details",
		);
		expect(hub.react).not.toHaveBeenCalled();
		expect(rec.presses.has(a11y.SURFACE.teamBridgeReactionAdd)).toBe(false);
		await longPress(ROOT);
		expect(rec.presses.has(a11y.teamBridgeQuickReactionId(THUMBS))).toBe(false);
		expect(hub.react).not.toHaveBeenCalled();
	});
});
