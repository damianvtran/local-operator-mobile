import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE KIT'S MODALS AND SETTINGS' REVEAL, together (PR #122 QA round 6, Q9 / A1;
 * review round 6, R6-m1).
 *
 * Q9: a failed Sign out revealed its refusal, then the Dialog's web dismissal
 * returned focus to "Sign out" 40–130 ms later and scrolled it back off-screen —
 * round 5 waited for the switcher sheet's dismissal only. This mounts the REAL
 * `Dialog` and `Sheet` and the REAL `useRefusalReveal` (the hook Settings ships),
 * with React Native's `Modal` replaced by a stub that records its props, so the
 * test fires `onDismiss` exactly where react-native-web would: after `visible`
 * went false, once the modal stopped rendering. Removing either renderer's
 * dismissal wiring fails here — a missing `onDismiss` throws, and a renderer that
 * stops recording its close lets the reveal run early.
 *
 * Node, react-dom's client over a stub container, no DOM package — the
 * `computer-switcher-sheet.test.ts` pattern. The frames are QA's job.
 */
type Props = Record<string, unknown>;
const host = vi.hoisted(() => ({
	/* The props each stub `Modal` last received, keyed by its testID. */
	modals: new Map<string, Record<string, unknown>>(),
}));

vi.mock("react-native", async () => {
	const pass = (props: Props) => (props.children ?? null) as ReactNode;
	class Value {
		setValue() {}
		interpolate() {
			return 0;
		}
	}
	return {
		Platform: { OS: "web" },
		View: pass,
		/* No text nodes: the stub container has nowhere to put them. */
		Text: () => null,
		ScrollView: pass,
		Pressable: pass,
		Modal: (props: Props) => {
			host.modals.set(String(props.testID), props);
			return (props.visible ? props.children : null) as ReactNode;
		},
		Animated: {
			Value,
			View: pass,
			timing: () => ({ start() {} }),
			parallel: () => ({ start() {} }),
		},
		Easing: { bezier: () => () => 0 },
		useWindowDimensions: () => ({ width: 390, height: 844 }),
	};
});
vi.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native-svg", () => ({
	default: () => null,
	Defs: () => null,
	LinearGradient: () => null,
	Rect: () => null,
	Stop: () => null,
}));
vi.mock("uniwind", () => ({
	ScopedVariables: (props: Props) => (props.children ?? null) as ReactNode,
}));
vi.mock("lucide-react-native", () => ({ X: () => null }));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000",
	useReducedMotion: () => false,
}));
vi.mock("@/ui/elevation", () => ({ useShadow: () => ({}) }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ variables: {} }),
}));
vi.mock("@/ui/components/button", () => ({ Button: () => null }));
vi.mock("@/ui/components/icon-button", () => ({ IconButton: () => null }));
vi.mock("@/ui/components/heading", () => ({ Heading: () => null }));

const { Dialog } = await import("@/ui/components/dialog");
const { Sheet } = await import("@/ui/components/sheet");
const { useRefusalReveal } = await import(
	"@/features/settings/use-refusal-reveal"
);
const { dismissalsOwed } = await import("@/ui/modal-dismissal-ledger");

const DIALOG = "signout-dialog";
const SHEET = "switcher-sheet";

type Scene = {
	refused: boolean;
	/** The sign-out Dialog's `visible` (Settings' `confirmSignOut`). */
	dialog: boolean;
	/** The switcher Sheet's `visible`, which Settings also passes to the hook. */
	sheet: boolean;
};
let revealed = 0;
let root: ReturnType<typeof createRoot> | null = null;

/** Settings, reduced to what the reveal depends on. */
function Screen({ refused, dialog, sheet }: Scene) {
	useRefusalReveal(refused, sheet, () => {
		revealed += 1;
	});
	return createElement(
		Fragment,
		null,
		createElement(Dialog, {
			visible: dialog,
			title: "Sign out?",
			body: "",
			confirmLabel: "Sign out",
			onConfirm: () => {},
			onCancel: () => {},
			destructive: true,
			testID: DIALOG,
		}),
		createElement(
			Sheet,
			{
				visible: sheet,
				onClose: () => {},
				title: "Switch computer",
				testID: SHEET,
			},
			null,
		),
	);
}
const show = (scene: Scene) =>
	act(async () => root?.render(createElement(Screen, scene)));
/** Fires the modal's dismissal the way RNW does once it stops rendering. A
 *  renderer that stopped forwarding one throws, and that IS the failure. */
const dismiss = (testID: string) =>
	act(async () => {
		const handler = host.modals.get(testID)?.onDismiss;
		if (typeof handler !== "function")
			throw new Error(`${testID} passed its Modal no onDismiss`);
		handler();
	});

beforeEach(() => {
	revealed = 0;
	host.modals.clear();
	const doc = {
		nodeType: 9,
		activeElement: null,
		addEventListener() {},
		removeEventListener() {},
	};
	vi.stubGlobal("window", {
		document: doc,
		HTMLIFrameElement: class {},
		HTMLElement: class {},
		addEventListener() {},
		removeEventListener() {},
	});
	vi.stubGlobal("document", doc);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	root = createRoot({
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		ownerDocument: doc,
		addEventListener() {},
		removeEventListener() {},
	} as unknown as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	vi.unstubAllGlobals();
	/* An unmount settles every debt, so no test leaks one into the next. */
	expect(dismissalsOwed()).toBe(0);
});

const calm: Scene = { refused: false, dialog: false, sheet: false };

describe("Settings reveals a refusal only once no modal owes its dismissal (Q9)", () => {
	it("a failed Sign out waits for the Dialog's dismissal, then reveals once", async () => {
		await show(calm);
		await show({ ...calm, dialog: true });
		/* `doSignOut` closes the Dialog, then `/logout` fails: the refusal lands while
		 *  the Dialog is still fading out and has not returned focus yet. */
		await show({ ...calm, dialog: false });
		expect(dismissalsOwed()).toBe(1);
		await show({ ...calm, refused: true });
		expect(revealed).toBe(0);
		/* RNW returns focus to "Sign out" and fires onDismiss: now it may reveal. */
		await dismiss(DIALOG);
		expect(dismissalsOwed()).toBe(0);
		expect(revealed).toBe(1);
		/* Nothing re-fires it. */
		await show({ ...calm, refused: true });
		expect(revealed).toBe(1);
	});

	it("waits when the close and the refusal land in the SAME commit", async () => {
		/* The ordering constraint at the ledger: the Dialog records its close in a
		 *  layout effect, and the hook reads the ledger live in its passive effect. */
		await show({ ...calm, dialog: true });
		await show({ ...calm, refused: true, dialog: false });
		expect(revealed).toBe(0);
		await dismiss(DIALOG);
		expect(revealed).toBe(1);
	});

	it("a failed pick waits for the switcher Sheet's dismissal, then reveals once", async () => {
		await show({ ...calm, sheet: true });
		await show({ ...calm, sheet: false, refused: true });
		expect(revealed).toBe(0);
		await dismiss(SHEET);
		expect(revealed).toBe(1);
	});

	it("a refusal no modal caused reveals at once", async () => {
		await show(calm);
		await show({ ...calm, refused: true });
		expect(dismissalsOwed()).toBe(0);
		expect(revealed).toBe(1);
	});

	it("never reveals while the switcher is up", async () => {
		await show({ ...calm, sheet: true });
		await show({ ...calm, sheet: true, refused: true });
		expect(revealed).toBe(0);
	});

	it("waits for EVERY owed dismissal, not the first", async () => {
		await show({ ...calm, dialog: true });
		await show(calm);
		await show({ ...calm, sheet: true });
		await show({ ...calm, refused: true });
		expect(dismissalsOwed()).toBe(2);
		await dismiss(SHEET);
		expect(revealed).toBe(0);
		await dismiss(DIALOG);
		expect(revealed).toBe(1);
	});

	it("a cleared refusal disarms: a later dismissal or close reveals nothing (R5-M1, R6-m1)", async () => {
		await show({ ...calm, dialog: true });
		await show({ ...calm, refused: true });
		/* Cleared before the dismissal (a pick from elsewhere succeeded). */
		await show(calm);
		await dismiss(DIALOG);
		expect(revealed).toBe(0);
		/* An unrelated open/close/dismiss with no refusal on screen. */
		await show({ ...calm, sheet: true });
		await show(calm);
		await dismiss(SHEET);
		expect(revealed).toBe(0);
	});

	it("a dismissal never runs ahead: a stray one leaves the next close owed", async () => {
		await show(calm);
		await dismiss(DIALOG);
		await show({ ...calm, dialog: true });
		await show(calm);
		expect(dismissalsOwed()).toBe(1);
		await dismiss(DIALOG);
		await dismiss(DIALOG);
		expect(dismissalsOwed()).toBe(0);
	});

	it("a reopen before the dismissal clears the debt (RNW never dismisses it)", async () => {
		await show({ ...calm, sheet: true });
		await show(calm);
		expect(dismissalsOwed()).toBe(1);
		await show({ ...calm, sheet: true });
		expect(dismissalsOwed()).toBe(0);
	});
});
