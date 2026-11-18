import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	PROGRAMMATIC_FOCUS_CLASS,
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
	/className=\{cx\(\s*"flex-1 text-title text-ink",\s*focusTitle \? PROGRAMMATIC_FOCUS_CLASS : undefined,?\s*\)\}/;
