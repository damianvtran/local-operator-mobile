import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingAsk } from "@/contracts";
import { t } from "@/i18n";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { askDismissReasonId, CONTROL } from "@/ui/a11y";

/**
 * The asks sheet, MOUNTED (ask-panel parity review: the first layout tests
 * were greps over the source, which pin that a string exists and not where it
 * is drawn). This renders the real `AsksSheet` against a fake relay client with
 * only the leaf primitives stubbed (Node has no React Native host), and records
 * what is drawn IN ORDER, so the card's place in the sheet, the settled band and
 * the footer's verbs are asserted as a reader meets them.
 *
 * What it can NOT see: geometry, scroll, focus, the real `Sheet`. Those are the
 * simulator's.
 */
const host = vi.hoisted(() => ({
	/** Strings drawn by `Text` and `Button`, in render order (body, then footer). */
	texts: [] as string[],
	/** Every `className` a `View` carried, in render order. */
	classes: [] as string[],
	presses: new Map<string, () => void>(),
	roles: new Map<string, string | undefined>(),
	states: new Map<string, Record<string, boolean> | undefined>(),
	styles: new Map<string, unknown>(),
	scale: 1,
	keyboardVisible: false,
}));

vi.mock("lucide-react-native", () => ({
	ArrowUpRight: () => null,
	Check: () => null,
}));
vi.mock("react-native", () => ({
	AccessibilityInfo: { setAccessibilityFocus: vi.fn() },
	findNodeHandle: () => 1,
	Keyboard: { dismiss: vi.fn() },
	Platform: { OS: "ios" },
	View: ({
		children,
		className,
	}: {
		children?: ReactNode;
		className?: string;
	}) => {
		if (className) host.classes.push(className);
		return children ?? null;
	},
	Text: ({ children }: { children?: ReactNode }) => {
		/* A label followed by a suffix arrives as an array of children. */
		for (const child of Array.isArray(children) ? children : [children])
			if (typeof child === "string") host.texts.push(child);
		return children ?? null;
	},
	TextInput: Object.assign(() => null, {
		State: { currentlyFocusedInput: () => null },
	}),
	Pressable: ({
		children,
		testID,
		onPress,
		accessibilityRole,
		accessibilityState,
		style,
	}: {
		children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
		testID?: string;
		onPress?: () => void;
		accessibilityRole?: string;
		accessibilityState?: Record<string, boolean>;
		style?: unknown;
	}) => {
		if (testID && onPress) host.presses.set(testID, onPress);
		if (testID) {
			host.roles.set(testID, accessibilityRole);
			host.states.set(testID, accessibilityState);
			host.styles.set(testID, style);
		}
		return (
			(typeof children === "function"
				? children({ pressed: false })
				: children) ?? null
		);
	},
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "black" }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/ui/direction", () => ({ useIsRTL: () => false }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: host.scale }),
}));
vi.mock("@/features/session/keyboard-frame", () => ({
	useKeyboardFrame: () => ({ visible: host.keyboardVisible }),
}));
vi.mock("@/ui/components/button", () => ({
	Button: ({
		label,
		onPress,
		testID,
	}: {
		label: string;
		onPress: () => void;
		testID: string;
	}) => {
		host.texts.push(label);
		host.presses.set(testID, onPress);
		return null;
	},
}));
vi.mock("@/ui/components/icon-button", () => ({ IconButton: () => null }));
/* The body is drawn before the footer, as on screen. */
vi.mock("@/ui/components/sheet", () => ({
	Sheet: ({
		children,
		footer,
	}: {
		children?: ReactNode;
		footer?: ReactNode;
	}) => {
		/* Each pass starts a fresh record, so the assertions read the LAST pass
		 * (the sheet re-renders as the read lands and the clock ticks). Its
		 * children render after this function returns. */
		host.texts = [];
		host.classes = [];
		host.presses.clear();
		host.roles.clear();
		host.states.clear();
		host.styles.clear();
		return (
			<>
				{children}
				{footer}
			</>
		);
	},
}));

const { AsksSheet } = await import("./asks-sheet");

const ask = (patch: Partial<PendingAsk> & { ask_id: string }): PendingAsk =>
	({
		created_at: 1_000,
		expires_at: Date.now() + 8 * 60_000,
		timeout_s: 900,
		urgent: false,
		status: "open",
		delivered: false,
		session_id: "s1",
		cwd: "",
		questions: [
			{
				id: "q1",
				question: `Question of ${patch.ask_id}?`,
				options: [{ label: `Option of ${patch.ask_id}` }],
				multi: false,
				secret: false,
			},
		],
		answers: {},
		...patch,
	}) as unknown as PendingAsk;

const command = vi.fn(async () => ({ ok: true }));
let dom: DomShim;
let root: ReturnType<typeof createRoot>;

const OPEN = ask({ ask_id: "A", created_at: 1_000 });

const render = async (
	rows: PendingAsk[],
	props: {
		initialOpenAsk?: string | null;
		sessions?: { session_id: string; conversation_name: string }[];
	} = {},
) => {
	host.texts = [];
	host.classes = [];
	host.presses.clear();
	host.roles.clear();
	const client = {
		asks: async () => ({ asks: rows }),
		command,
	};
	await act(async () =>
		root.render(
			<AsksSheet
				visible
				onClose={() => undefined}
				client={client as never}
				currentSessionId="s1"
				sessions={props.sessions as never}
				initialOpenAsk={props.initialOpenAsk ?? null}
			/>,
		),
	);
	/* The read resolves after the first commit. */
	await act(async () => undefined);
};
const press = (id: string) => act(async () => host.presses.get(id)?.());
const at = (text: string): number => host.texts.indexOf(text);

beforeEach(() => {
	vi.clearAllMocks();
	host.scale = 1;
	host.keyboardVisible = false;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("the card layout", () => {
	it("draws the open card, the waiting rows, the settled band and the honesty line in that order", async () => {
		const waiting = ask({ ask_id: "B", created_at: 2_000 });
		const answered = ask({
			ask_id: "C",
			status: "answered",
			answers: { q1: ["Option of C"] },
		});
		await render([answered, waiting, OPEN], { initialOpenAsk: "A" });
		const question = at("Question of A?");
		const option = at("Option of A");
		const waitingRow = at("Question of B?");
		const heading = at(t("mobile.asks.settled"));
		const settled = at("Question of C?");
		const honesty = at(t("mobile.asks.honesty"));
		const send = at(t("mobile.asks.send_answer"));
		for (const index of [
			question,
			option,
			waitingRow,
			heading,
			settled,
			honesty,
			send,
		])
			expect(index).toBeGreaterThan(-1);
		expect(question).toBeLessThan(option);
		expect(option).toBeLessThan(waitingRow);
		expect(waitingRow).toBeLessThan(heading);
		expect(heading).toBeLessThan(settled);
		/* The honesty line is the last thing in the body, and nothing settled
		 * sits between the card's options and the pinned buttons. */
		expect(settled).toBeLessThan(honesty);
		expect(honesty).toBeLessThan(send);
	});

	it("hoists the open ask into the card whichever position the queue holds it in", async () => {
		/* B is the older ask and so leads the queue; A is open all the same. */
		await render([OPEN, ask({ ask_id: "B", created_at: 10 })], {
			initialOpenAsk: "A",
		});
		expect(at("Option of A")).toBeGreaterThan(-1);
		expect(at("Option of B")).toBe(-1);
		expect(at("Question of A?")).toBeLessThan(at("Question of B?"));
	});

	it("names a foreign conversation on its own collapsed row, above the question", async () => {
		const foreign = ask({ ask_id: "F", session_id: "s2" });
		await render([OPEN, foreign], {
			initialOpenAsk: "A",
			sessions: [{ session_id: "s2", conversation_name: "Other chat" }],
		});
		expect(at("Other chat")).toBeGreaterThan(-1);
		expect(at("Other chat")).toBeLessThan(at("Question of F?"));
	});

	it("draws no settled heading when nothing is settled", async () => {
		await render([OPEN], { initialOpenAsk: "A" });
		expect(host.texts).not.toContain(t("mobile.asks.settled"));
	});
});

describe("the footer", () => {
	it("stacks Send and Decline at large text, side by side otherwise", async () => {
		await render([OPEN], { initialOpenAsk: "A" });
		expect(host.classes).toContain("flex-row gap-2");
		host.scale = 2;
		await render([OPEN], { initialOpenAsk: "A" });
		expect(host.classes).not.toContain("flex-row gap-2");
		expect(host.texts).toContain(t("mobile.asks.send_answer"));
		expect(host.texts).toContain(t("mobile.asks.decline"));
	});

	it("says why Send is grey, and offers Dismiss… on a waiting ask", async () => {
		await render([OPEN], { initialOpenAsk: "A" });
		expect(host.texts).toContain(t("mobile.asks.progress.pick_or_type"));
		expect(host.texts).toContain(t("mobile.asks.dismiss_open"));
		expect(host.presses.has(CONTROL.askDismiss)).toBe(true);
	});

	it("keeps Dismiss… on the progress row at normal text, on its own row at large text", async () => {
		await render([OPEN], { initialOpenAsk: "A" });
		expect(host.classes).toContain("flex-row items-center gap-x-3");
		/* Never narrower than the touch floor, whatever the language. */
		expect(host.styles.get(CONTROL.askDismiss)).toEqual({
			minHeight: 44,
			minWidth: 44,
		});
		host.scale = 2;
		await render([OPEN], { initialOpenAsk: "A" });
		expect(host.classes).not.toContain("flex-row items-center gap-x-3");
		expect(host.classes).toContain("gap-1");
		expect(host.texts).toContain(t("mobile.asks.dismiss_open"));
		expect(host.texts).toContain(t("mobile.asks.progress.pick_or_type"));
	});

	it("steps Dismiss… aside while the keyboard is up", async () => {
		host.keyboardVisible = true;
		await render([OPEN], { initialOpenAsk: "A" });
		expect(host.texts).not.toContain(t("mobile.asks.dismiss_open"));
		expect(host.presses.has(CONTROL.askDismiss)).toBe(false);
	});

	it("asks why before a waiting ask is dismissed, and sends the reason", async () => {
		await render([OPEN], { initialOpenAsk: "A" });
		await press(CONTROL.askDismiss);
		expect(host.texts).toContain(t("mobile.asks.dismiss_title", { count: 1 }));
		/* Nothing has left yet. */
		expect(command).not.toHaveBeenCalled();
		await press(askDismissReasonId("moot"));
		expect(command).toHaveBeenCalledWith("s1", {
			op: "ask_dismiss",
			ask_id: "A",
			reason: "moot",
		});
	});

	it("dismisses a lapsed ask at once, with no reason", async () => {
		const lapsed = ask({ ask_id: "T", status: "timed_out" });
		await render([lapsed], { initialOpenAsk: "T" });
		expect(host.texts).toContain(t("mobile.asks.dismiss"));
		await press(CONTROL.askDismiss);
		expect(command).toHaveBeenCalledWith("s1", {
			op: "ask_dismiss",
			ask_id: "T",
		});
	});
});

describe("the option rows' roles", () => {
	const questionWith = (multi: boolean) =>
		ask({
			ask_id: "M",
			questions: [
				{
					id: "q1",
					question: "Pick some?",
					options: [{ label: "One" }, { label: "Two" }],
					multi,
					secret: false,
				},
			] as never,
		});
	it("gives a multi-select question checkbox rows", async () => {
		await render([questionWith(true)], { initialOpenAsk: "M" });
		expect(host.roles.get("ask-other-q1")).toBe("checkbox");
	});
	it("reports a multi-select row as checked, a single-select row as selected", async () => {
		await render([questionWith(true)], { initialOpenAsk: "M" });
		expect(host.states.get("ask-other-q1")).toEqual({
			checked: false,
			disabled: false,
		});
		await render([questionWith(false)], { initialOpenAsk: "M" });
		expect(host.states.get("ask-other-q1")).toEqual({
			selected: false,
			disabled: false,
		});
	});
	it("gives a single-select question radio rows", async () => {
		await render([questionWith(false)], { initialOpenAsk: "M" });
		expect(host.roles.get("ask-other-q1")).toBe("radio");
	});
});
