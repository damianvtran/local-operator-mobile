import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialsOf } from "@/ui/components/avatar";
import { memberMarkOf } from "./member-mark";

/**
 * Design review round 2, D11 (MAJOR): `MemberAvatar` drew "?" for ثنا ملک on
 * every message run and People row, because the shared `initialsOf` reads Latin
 * letters only. These pin the member mark for the scripts this PR ships
 * catalogues for, the Hermes path (no `Intl.Segmenter`), and that Latin names
 * and the shared helper are unchanged.
 */

/* `@/ui/appearance` reaches native token plumbing Node cannot parse; the colour
 * is irrelevant to the mark (same stub as ur-latin-initial-sites.test.ts). */
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
/* lucide is native SVG Node cannot parse; a named marker proves WHICH glyph. */
vi.mock("lucide-react-native", () => ({
	Bot: () => h("i", { "data-glyph": "bot" }),
	UserRound: () => h("i", { "data-glyph": "user-round" }),
}));

const { MemberAvatar } = await import("./member-avatar");

const realSegmenter = Intl.Segmenter;
afterEach(() => {
	(Intl as { Segmenter?: unknown }).Segmenter = realSegmenter;
});
/* Hermes ships no `Intl.Segmenter`; take the fallback path explicitly. */
const withoutSegmenter = () => {
	(Intl as { Segmenter?: unknown }).Segmenter = undefined;
};

describe("memberMarkOf (D11)", () => {
	it("gives a non-Latin name its first grapheme, never '?'", () => {
		expect(initialsOf("ثنا ملک")).toBe("?"); // the defect, still the shared floor
		expect(memberMarkOf("ثنا ملک")).toBe("ث");
		expect(memberMarkOf("Анна")).toBe("А");
		expect(memberMarkOf("анна петрова")).toBe("А"); // cased script: uppercased
		// Devanagari: the whole conjunct where the engine segments graphemes.
		expect(memberMarkOf("प्रिया")).toBe(
			[
				...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
					"प्रिया",
				),
			][0]?.segment,
		);
		expect(memberMarkOf("प्रिया")?.startsWith("प")).toBe(true);
	});

	it("falls back to the first code point without Intl.Segmenter (Hermes)", () => {
		withoutSegmenter();
		expect(memberMarkOf("प्रिया")).toBe("प");
		expect(memberMarkOf("ثنا ملک")).toBe("ث");
		expect(memberMarkOf("🦊 Fox")).toBe("🦊"); // a whole pair, not half of one
	});

	it("keeps an emoji-led name's whole emoji, never a lone surrogate", () => {
		expect(initialsOf("🦊 Fox")).not.toBe("🦊F"); // shared helper splits the pair
		expect(memberMarkOf("🦊 Fox")).toBe("🦊");
		expect(memberMarkOf("👩‍👩‍👧 Family")).toBe("👩‍👩‍👧");
		expect(memberMarkOf("🇺🇸 Sam")).toBe("🇺🇸");
	});

	it("leaves every Latin name exactly as initialsOf drew it", () => {
		for (const name of [
			"Ada Lovelace",
			"Bob Okafor",
			"Damian",
			"Émile Zola",
			"1Password",
		])
			expect(memberMarkOf(name)).toBe(initialsOf(name));
		expect(memberMarkOf("Ada Lovelace")).toBe("AL");
	});

	it("gives the default mark, not '?' or a count, to a name with no letter", () => {
		expect(memberMarkOf("")).toBeNull();
		expect(memberMarkOf("   ")).toBeNull();
		expect(memberMarkOf("1234")).toBeNull();
	});
});

describe("MemberAvatar (D11)", () => {
	const render = (name: string) =>
		renderToStaticMarkup(h(MemberAvatar, { name }));

	it("draws the first grapheme for ثنا ملک, not '?'", () => {
		const html = render("ثنا ملک");
		expect(html).toContain(">ث<");
		expect(html).not.toContain(">?<");
	});

	it("still draws Latin initials", () => {
		expect(render("Ada Lovelace")).toContain(">AL<");
	});

	it("keeps the default mark for a pending placeholder and a letterless name", () => {
		expect(render("New member · 7336")).toContain('data-glyph="user-round"');
		expect(render("1234")).toContain('data-glyph="user-round"');
		expect(render("1234")).not.toContain(">?<");
	});
});
