import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
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
 * react-native-web's modal focus trap, reduced to the decision it makes when Tab
 * wraps past the last (or first) control: it calls `focus()` on each node in
 * DOM order and keeps the first that ACCEPTS focus — and a `tabIndex={-1}` node
 * does, so a scrim that is "out of the tab order" still receives the wrap
 * (review round 1: R1 / D1 / Q1). The source assertion below pins that reading
 * of the library, so an upgrade that changes it fails here first.
 */
type Stop = { id: string; acceptsFocus: boolean };
type Modality = "keyboard" | "pointer";
const trapWrap = (domOrder: Stop[]): Stop | undefined =>
	domOrder.find((stop) => stop.acceptsFocus);

/** Where a keyboard reader ends up after the wrap, and whether they can see it. */
const afterWrap = (
	domOrder: Stop[],
	redirect: (focusVisible: boolean) => string | null,
	ringQuiet: (id: string) => boolean,
	modality: Modality = "keyboard",
): { id: string; ring: boolean } => {
	const landed = trapWrap(domOrder)?.id ?? "body";
	/* The browser's own heuristic: focus that a key moved matches
	 *  `:focus-visible`; focus placed while the reader used a pointer does not. */
	const id =
		landed === "scrim" ? (redirect(modality === "keyboard") ?? landed) : landed;
	return { id, ring: !ringQuiet(id) };
};

describe("Tab wrap inside a web overlay lands on a control with a ring", () => {
	it("reads the trap as the model above does", () => {
		expect(TRAP).toContain("function focusFirstDescendant(element)");
		expect(TRAP).toContain(
			"if (attemptFocus(child) || focusFirstDescendant(child))",
		);
		expect(TRAP).toContain("return document.activeElement === element;");
	});

	it("sends KEYBOARD focus that lands on a sheet's scrim to its Close", () => {
		expect(scrimFocusRedirect(false, true)).toBe("close");
		/* Pointer-opened: the scrim keeps the quiet open-time focus, so no ring
		 *  appears around Close on a sheet the reader opened by touch. */
		expect(scrimFocusRedirect(false, false)).toBeNull();
	});

	it("always sends focus that lands on a title-focusing sheet's scrim to its title", () => {
		/* QA round 2, Q7: opening from the drawer re-entered at the scrim. */
		expect(scrimFocusRedirect(true, true)).toBe("title");
		expect(scrimFocusRedirect(true, false)).toBe("title");
	});

	it("keeps the title's ring hidden only for the focus placed while opening", () => {
		expect(titleRingQuiet(false)).toBe(true);
		expect(titleRingQuiet(true)).toBe(false);
	});

	it.each([
		[
			"row menu (a sheet that does not focus its title)",
			[
				{ id: "scrim", acceptsFocus: true },
				{ id: "title", acceptsFocus: false },
				{ id: "close", acceptsFocus: true },
				{ id: "pin", acceptsFocus: true },
			],
			(fv: boolean) => scrimFocusRedirect(false, fv),
		],
		[
			"Switch computer (a sheet that focuses its title)",
			[
				{ id: "scrim", acceptsFocus: true },
				{ id: "title", acceptsFocus: true },
				{ id: "close", acceptsFocus: true },
			],
			(fv: boolean) => scrimFocusRedirect(true, fv),
		],
		[
			"conversations drawer",
			[
				{ id: "scrim", acceptsFocus: true },
				{ id: "agents", acceptsFocus: true },
				{ id: "sidebar-close", acceptsFocus: true },
			],
			(fv: boolean) =>
				scrimFocusRedirect(false, fv) === "close" ? "sidebar-close" : null,
		],
	] as const)("%s", (_name, order, redirect) => {
		/* A wrap means the reader has tabbed AWAY from whatever opening focused,
		 *  so the title has been blurred since the overlay opened. */
		const ringQuiet = (id: string) =>
			id === "scrim" || (id === "title" && titleRingQuiet(true));
		const after = afterWrap([...order], redirect, ringQuiet);
		expect(after.id).not.toBe("scrim");
		expect(after.ring).toBe(true);
	});

	it("leaves a pointer-opened row menu's open-time focus quiet", () => {
		const opened = afterWrap(
			[
				{ id: "scrim", acceptsFocus: true },
				{ id: "close", acceptsFocus: true },
			],
			(fv) => scrimFocusRedirect(false, fv),
			(id) => id === "scrim",
			"pointer",
		);
		expect(opened).toEqual({ id: "scrim", ring: false });
	});

	it("wires the redirect into every web sheet, not only title-focusing ones", () => {
		expect(SHEET).toContain('const keyed = scrim.matches(":focus-visible");');
		expect(SHEET).toContain("scrimFocusRedirect(focusTitle, keyed)");
		expect(SHEET).not.toContain(
			'if (!shown || !focusTitle || Platform.OS !== "web") return;',
		);
		expect(SHEET).toContain("titleRingQuiet(titleBlurred)");
	});

	it("wires the drawer's scrim to the panel's Close", () => {
		expect(DRAWER).toContain('addEventListener("focusin"');
		expect(DRAWER).toContain(
			'scrimFocusRedirect(false, scrim.matches(":focus-visible"))',
		);
		expect(DRAWER).toContain("CONTROL.sidebarClose");
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
const SHEET_TITLE_CLASS =
	/className=\{cx\(\s*"flex-1 text-title text-ink",\s*focusTitle && titleRingQuiet\(titleBlurred\)\s*\?\s*PROGRAMMATIC_FOCUS_CLASS\s*:\s*undefined,?\s*\)\}/;
