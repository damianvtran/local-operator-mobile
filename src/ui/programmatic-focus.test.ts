import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	createInputModality,
	guardScrimFocus,
	PROGRAMMATIC_FOCUS_CLASS,
	scrimFocusRedirect,
	titleRingQuiet,
	webPointerOnly,
} from "@/ui/programmatic-focus";

/**
 * No browser focus ring on a node that only CODE focuses.
 *
 * Two web overlays drew the browser's default ring where no reader had pressed
 * a key: around the `Switch computer` sheet's title (the sheet focuses its title
 * on open so a screen reader starts there), and as a 1 px blue line along the
 * conversations drawer's edge (react-native-web's modal focus trap focuses the
 * first focusable node it finds, which was the full-viewport scrim). Neither node
 * is a Tab stop, so hiding the ring there costs a keyboard reader nothing; every
 * control they CAN tab to keeps its focus-visible ring
 * (docs/design/components.md § 1). Both changes are web-only: native has no
 * browser ring and its focus handling is untouched.
 */
const read = (path: string) =>
	readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const SHEET = read("./components/sheet.tsx");
const DRAWER = read("../features/sessions/conversations-drawer.tsx");
const TRAP = read(
	"../../node_modules/react-native-web/dist/exports/Modal/ModalFocusTrap.js",
);

/**
 * A BEHAVIOURAL check of the web focus guard, run through react-native-web's own
 * trap code. The trap's `attemptFocus` / `focusFirstDescendant` /
 * `focusLastDescendant` are lifted verbatim from the installed library (so an
 * upgrade that changes them changes this test) and run over a small fake DOM in
 * the overlay's real order: scrim first, then the panel. The guard under test is
 * the one `Sheet` and `ConversationsDrawer` install (`guardScrimFocus`).
 *
 * What the trap does with the guard (review round 2, R2-1 / Q5): a wrap calls
 * `focus()` on each node in DOM order and keeps the first where focus STAYS. The
 * guard moves keyboard focus off the scrim at once, so the trap's check on the
 * scrim fails and the walk continues to the panel's first control — the drawer's
 * Agents segment, the row menu's Close, the switcher's title. Without the guard
 * the walk stops on the scrim: an unmarked stop named "Close".
 */
const TRAP_FUNCTIONS = [
	"attemptFocus",
	"focusFirstDescendant",
	"focusLastDescendant",
];
const trapSource = TRAP_FUNCTIONS.map((name) => {
	const at = TRAP.indexOf(`function ${name}(`);
	const next = TRAP.indexOf("\n}\n", at);
	return TRAP.slice(at, next + 2);
}).join("\n");

type FakeNode = {
	id: string;
	childNodes: FakeNode[];
	focus: (options?: unknown) => void;
	addEventListener: (
		type: string,
		listener: (event: { target: unknown }) => void,
	) => void;
	removeEventListener: (
		type: string,
		listener: (event: { target: unknown }) => void,
	) => void;
};

const fakeDom = () => {
	const doc: { activeElement: FakeNode | null } = { activeElement: null };
	const node = (
		id: string,
		focusable: boolean,
		children: FakeNode[] = [],
	): FakeNode => {
		const listeners = new Set<(event: { target: unknown }) => void>();
		const self: FakeNode = {
			id,
			childNodes: children,
			focus: () => {
				if (!focusable) return;
				doc.activeElement = self;
				for (const listener of [...listeners]) listener({ target: self });
			},
			addEventListener: (type, listener) => {
				if (type === "focusin") listeners.add(listener);
			},
			removeEventListener: (_type, listener) => listeners.delete(listener),
		};
		return self;
	};
	const trap = new Function(
		"document",
		"canUseDOM",
		`${trapSource}\nreturn { focusFirstDescendant, focusLastDescendant };`,
	)(doc, true) as {
		focusFirstDescendant: (root: FakeNode) => boolean;
		focusLastDescendant: (root: FakeNode) => boolean;
	};
	return { doc, node, trap };
};

/** One overlay in DOM order, with the guard installed exactly as the app does. */
const overlay = (
	kind: "row-menu" | "switcher" | "drawer",
	{ keyboard, guarded = true }: { keyboard: boolean; guarded?: boolean },
) => {
	const { doc, node, trap } = fakeDom();
	const scrim = node("scrim", true);
	const panel =
		kind === "drawer"
			? [
					node("workspace-drawer-agents", true),
					node("workspace-drawer-team-bridge", true),
					node("sidebar-close", true),
					node("sidebar-library", true),
				]
			: kind === "switcher"
				? [
						node("title", true),
						node("sheet-close", true),
						node("switcher-add-computer", true),
					]
				: [
						node("title", false),
						node("sheet-close", true),
						node("session-open-current", true),
						node("session-open-previous", true),
					];
	const root = node("root", false, [scrim, node("panel", false, panel)]);
	const byId = (id: string) => panel.find((n) => n.id === id) ?? null;
	if (guarded) {
		const modality = createInputModality();
		modality.record(keyboard ? "keyboard" : "pointer");
		guardScrimFocus(scrim as unknown as HTMLElement, () => {
			const to = scrimFocusRedirect(kind === "switcher", modality.keyboard());
			const id =
				to === "title"
					? "title"
					: to === "close"
						? kind === "drawer"
							? "sidebar-close"
							: "sheet-close"
						: null;
			return id ? (byId(id) as unknown as HTMLElement) : null;
		});
	}
	return { doc, root, trap };
};

/** The title shows its ring once blurred, and every wrap follows a blur. */
const ringed = (id: string | undefined) =>
	id !== undefined &&
	id !== "scrim" &&
	!(id === "title" && titleRingQuiet(true));

describe("Tab wrap inside a web overlay lands on a control with a ring", () => {
	it("reads the library's trap source", () => {
		expect(trapSource).toContain("function focusFirstDescendant(element)");
		expect(trapSource).toContain("return document.activeElement === element;");
	});

	it.each([
		["row menu", "row-menu", "sheet-close"],
		["Switch computer", "switcher", "title"],
		/* NOT `sidebar-close`: the trap walks on past the guard's own target. */
		["conversations drawer", "drawer", "workspace-drawer-agents"],
	] as const)(
		"%s: a forward wrap lands on the panel's first control",
		(_name, kind, landing) => {
			const { doc, root, trap } = overlay(kind, { keyboard: true });
			trap.focusFirstDescendant(root);
			expect(doc.activeElement?.id).toBe(landing);
			expect(ringed(doc.activeElement?.id)).toBe(true);
		},
	);

	it.each([
		["row menu", "row-menu", "session-open-previous"],
		["Switch computer", "switcher", "switcher-add-computer"],
		["conversations drawer", "drawer", "sidebar-library"],
	] as const)(
		"%s: a backward wrap lands on the last control",
		(_name, kind, landing) => {
			const { doc, root, trap } = overlay(kind, { keyboard: true });
			trap.focusLastDescendant(root);
			expect(doc.activeElement?.id).toBe(landing);
		},
	);

	it.each([
		["row menu", "row-menu"],
		["conversations drawer", "drawer"],
	] as const)(
		"%s: without the guard, the wrap stops on the scrim (the round 1 defect)",
		(_name, kind) => {
			const { doc, root, trap } = overlay(kind, {
				keyboard: true,
				guarded: false,
			});
			trap.focusFirstDescendant(root);
			expect(doc.activeElement?.id).toBe("scrim");
		},
	);

	it.each([
		["row menu opened by a long-press", "row-menu"],
		/* Review round 2, Q6: a deep link or reload of /conversations opens the
		 *  drawer with no input at all — code-only focus, so no ring. */
		["drawer opened by a tap or with no input", "drawer"],
	] as const)(
		"%s: the open-time focus stays quiet on the scrim",
		(_name, kind) => {
			const { doc, root, trap } = overlay(kind, { keyboard: false });
			trap.focusFirstDescendant(root);
			expect(doc.activeElement?.id).toBe("scrim");
			expect(ringed(doc.activeElement?.id)).toBe(false);
		},
	);

	it("a title-focusing sheet always lands on its title", () => {
		const { doc, root, trap } = overlay("switcher", { keyboard: false });
		trap.focusFirstDescendant(root);
		expect(doc.activeElement?.id).toBe("title");
	});

	it("counts input as keyboard only after a key, and as pointer after a press", () => {
		const modality = createInputModality();
		expect(modality.keyboard()).toBe(false);
		modality.record("keyboard");
		expect(modality.keyboard()).toBe(true);
		modality.record("pointer");
		expect(modality.keyboard()).toBe(false);
	});

	it("installs the guard on every web sheet's scrim and on the drawer's", () => {
		/* The behaviour above is the helper's; these pin that both overlays call
		 *  it (review round 2, Q4: deleting the sheet's listener left CI green). */
		expect(SHEET).toMatch(GUARD_CALL);
		expect(DRAWER).toMatch(GUARD_CALL);
		expect(SHEET).toContain("scrimFocusRedirect(focusTitle, keyboardInput())");
		expect(DRAWER).toContain("scrimFocusRedirect(false, keyboardInput())");
		expect(SHEET).toContain("titleRingQuiet(titleBlurred)");
	});
});

describe("programmatic focus", () => {
	it("is a web-only class, so native styling cannot change", () => {
		expect(
			PROGRAMMATIC_FOCUS_CLASS.split(WHITESPACE).every((c) =>
				c.startsWith("web:"),
			),
		).toBe(true);
		expect(PROGRAMMATIC_FOCUS_CLASS).toContain("outline-none");
	});

	it("takes a node out of the web tab order only", () => {
		expect(webPointerOnly("web")).toEqual({ tabIndex: -1 });
		expect(webPointerOnly("ios")).toEqual({});
		expect(webPointerOnly("android")).toEqual({});
	});

	it("is applied to the sheet's title only when the sheet focuses it", () => {
		expect(SHEET).toMatch(SHEET_TITLE_CLASS);
	});

	it("is applied to every sheet's scrim, which leaves the web tab order", () => {
		/* The row long-press menu's scrim (a sheet that does not focus its title)
		 *  drew the same full-viewport ring as the drawer's. The sheet's Close
		 *  button and Escape are the keyboard routes; native keeps its tab stop. */
		const start = SHEET.indexOf("testID={CONTROL.sheetScrim}");
		const scrim = SHEET.slice(SHEET.lastIndexOf("<Pressable", start), start);
		expect(scrim).toContain("PROGRAMMATIC_FOCUS_CLASS");
		expect(scrim).toContain(
			'tabIndex={focusTitle || Platform.OS === "web" ? -1 : 0}',
		);
	});

	it("is applied to the drawer's scrim, which leaves the web tab order", () => {
		const start = DRAWER.indexOf(
			'accessibilityLabel={t("mobile.chrome.close_conversations")}',
		);
		const scrim = DRAWER.slice(
			DRAWER.lastIndexOf("<Pressable", start),
			DRAWER.indexOf("/>", start),
		);
		expect(scrim).toContain("{...webPointerOnly(Platform.OS)}");
		expect(scrim).toContain("PROGRAMMATIC_FOCUS_CLASS");
	});
});

/* Top-level for biome's useTopLevelRegex. */
const WHITESPACE = /\s+/;
const GUARD_CALL = /guardScrimFocus\(scrim, \(\) =>/;
const SHEET_TITLE_CLASS =
	/className=\{cx\(\s*"flex-1 text-title text-ink",\s*focusTitle && titleRingQuiet\(titleBlurred\)\s*\?\s*PROGRAMMATIC_FOCUS_CLASS\s*:\s*undefined,?\s*\)\}/;
