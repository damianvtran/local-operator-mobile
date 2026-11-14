import { act, createElement } from "react";
import type { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import {
	createSearchEscape,
	type EscapeKeyEvent,
	type SearchEscape,
} from "./search-escape";

/**
 * QA round 1, Q1 (PR #256): typing in the drawer's search pill and pressing
 * Escape closed the whole DRAWER, because react-native-web's `Modal` closes on
 * a document-level keyup Escape and the field only acted on keydown. The first
 * test of this behaviour read the pane's source and passed while the bug was
 * live, so this one mounts the REAL `ModalContent` — its own `closeOnEscape`
 * keyup listener on `document` — and dispatches real key events through a DOM
 * propagation path (window → document → target, then back), honouring
 * `stopPropagation` the way a browser does.
 *
 * The repository has no jsdom (`vitest.config.ts`); `installDomShim` lets
 * react-dom render, and the few lines below add the one thing it lacks for this
 * contract: listeners and a dispatch that walks capture then bubble.
 */

/* `ModalContent`'s Escape rule is the module under test; its `View` and
 *  `StyleSheet` need a real CSSOM the shim does not have, and draw nothing this
 *  contract reads, so they are reduced to a pass-through and an identity. */
vi.mock("react-native-web/dist/exports/View/index.js", () => ({
	default: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock("react-native-web/dist/exports/StyleSheet/index.js", () => ({
	default: { create: <T,>(styles: T) => styles },
}));

type Listener = (event: EscapeKeyEvent) => void;
type EventNode = {
	name: string;
	listeners: { type: string; listener: Listener; capture: boolean }[];
};

const node = (name: string): EventNode => ({ name, listeners: [] });

function listenable(target: object, at: EventNode) {
	Object.assign(target, {
		addEventListener(type: string, listener: Listener, capture?: unknown) {
			at.listeners.push({
				type,
				listener,
				capture:
					capture === true ||
					(typeof capture === "object" &&
						(capture as { capture?: boolean } | null)?.capture === true),
			});
		},
		removeEventListener(type: string, listener: Listener, capture?: unknown) {
			const wantCapture =
				capture === true ||
				(typeof capture === "object" &&
					(capture as { capture?: boolean } | null)?.capture === true);
			at.listeners = at.listeners.filter(
				(entry) =>
					!(
						entry.type === type &&
						entry.listener === listener &&
						entry.capture === wantCapture
					),
			);
		},
	});
}

/** DOM dispatch over a fixed path, outermost first: capture down, bubble up. */
function dispatch(path: EventNode[], type: string, key: string): void {
	let stopped = false;
	let immediate = false;
	const event: EscapeKeyEvent = {
		key,
		stopPropagation() {
			stopped = true;
		},
		stopImmediatePropagation() {
			stopped = true;
			immediate = true;
		},
	};
	const visit = (at: EventNode, capture: boolean) => {
		for (const entry of [...at.listeners]) {
			if (immediate) return;
			if (entry.type === type && entry.capture === capture)
				entry.listener(event);
		}
	};
	const ancestors = path.slice(0, -1);
	const target = path[path.length - 1];
	for (const at of ancestors) if (!stopped) visit(at, true);
	if (!stopped && target) {
		visit(target, true);
		if (!immediate) visit(target, false);
	}
	for (const at of [...ancestors].reverse()) if (!stopped) visit(at, false);
}

let shim: DomShim;
let root: ReturnType<typeof createRoot> | null = null;
let win: EventNode;
let doc: EventNode;
let field: EventNode;
let body: EventNode;

beforeEach(() => {
	shim = installDomShim();
	const globals = globalThis as unknown as { window: object; document: object };
	win = node("window");
	doc = node("document");
	field = node("input");
	body = node("body");
	listenable(globals.window, win);
	listenable(globals.document, doc);
});

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	shim.dispose();
	vi.resetModules();
});

/** Mount the real react-native-web `ModalContent`, as the drawer's Modal does. */
async function mountModal(onRequestClose: () => void): Promise<void> {
	// Imported after the shim, so react-native-web's `canUseDOM` reads true.
	const { createRoot } = await import("react-dom/client");
	const { default: ModalContent } = await import(
		// @ts-expect-error untyped deep import: the exact module QA traced.
		"react-native-web/dist/exports/Modal/ModalContent"
	);
	root = createRoot(shim.container as Element);
	act(() => {
		root?.render(
			createElement(ModalContent, { active: true, onRequestClose }, null),
		);
	});
}

/** The pill as `conversations-pane.tsx` wires it: state, focus, keydown. */
function pill(initial: string) {
	const state = { query: initial, focused: true };
	const handler: SearchEscape = createSearchEscape({
		query: () => state.query,
		clear: () => {
			state.query = "";
		},
		blur: () => {
			state.focused = false;
		},
	});
	// The field's `onKeyPress` is react-native-web's keydown at the input.
	field.listeners.push({
		type: "keydown",
		capture: false,
		listener: (event) => {
			handler.keyDown(event.key);
		},
	});
	const unguard = handler.guard(
		(globalThis as unknown as { window: Parameters<SearchEscape["guard"]>[0] })
			.window,
	);
	/** One physical Escape: keydown, then keyup at whatever holds focus NOW. */
	const press = () => {
		dispatch([win, doc, state.focused ? field : body], "keydown", "Escape");
		dispatch([win, doc, state.focused ? field : body], "keyup", "Escape");
	};
	return { state, press, unguard };
}

describe("Escape in the drawer's search pill (Q1)", () => {
	it("clears the text and keeps the drawer open, then blurs, then closes", async () => {
		const onRequestClose = vi.fn();
		await mountModal(onRequestClose);
		// Negative control: the Modal's own listener is live in this rig.
		dispatch([win, doc, body], "keyup", "Escape");
		expect(onRequestClose).toHaveBeenCalledTimes(1);
		onRequestClose.mockClear();

		const { state, press } = pill("staging");
		press();
		expect(state.query).toBe("");
		expect(state.focused).toBe(true);
		expect(onRequestClose).not.toHaveBeenCalled();

		press();
		expect(state.focused).toBe(false);
		expect(onRequestClose).not.toHaveBeenCalled();

		// Empty and unfocused: this Escape is the drawer's.
		press();
		expect(onRequestClose).toHaveBeenCalledTimes(1);
	});

	it("a lost keyup never swallows a later, unrelated Escape", async () => {
		const onRequestClose = vi.fn();
		await mountModal(onRequestClose);
		const { state } = pill("staging");
		// The field consumes a keydown, but its keyup never arrives (window blur).
		dispatch([win, doc, field], "keydown", "Escape");
		expect(state.query).toBe("");
		state.focused = false;
		dispatch([win, doc, body], "keydown", "Escape");
		dispatch([win, doc, body], "keyup", "Escape");
		expect(onRequestClose).toHaveBeenCalledTimes(1);
	});

	it("other keys pass untouched, and removing the guard restores the Modal's rule", async () => {
		const onRequestClose = vi.fn();
		await mountModal(onRequestClose);
		const { press, unguard } = pill("staging");
		dispatch([win, doc, field], "keydown", "a");
		dispatch([win, doc, field], "keyup", "a");
		expect(onRequestClose).not.toHaveBeenCalled();
		unguard();
		press();
		expect(onRequestClose).toHaveBeenCalledTimes(1);
	});
});
