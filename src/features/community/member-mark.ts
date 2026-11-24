import { initialsOf } from "@/ui/components/avatar";

/**
 * The text a community member's avatar draws, or `null` for the default
 * person mark (design review round 2, D11).
 *
 * WHY NOT JUST `initialsOf`. That shared helper reads Latin letters only: a
 * label with no `[A-Za-z]` returns "?", which is right for what it was built
 * for (a host label like "127.0.0.1:22501" is not a name, D11 of the Settings
 * review) and wrong here. Community names are strangers' approved display
 * names, in any script, and this PR ships ur/hi/ru catalogues and an RTL
 * People list: "ثنا ملک" got "?" beside her real name, which reads as
 * "unknown member" or an error. It also takes `charAt(0)` of each word, which
 * splits an emoji's surrogate pair ("🦊 Fox" → a lone surrogate + "F").
 * `initialsOf` stays untouched for its other callers (Settings, Team Bridge
 * profile and org tiles), whose labels are hosts, emails and org names.
 *
 * THE RULE.
 * - `initialsOf` wins when its result is a real mark (not "?"), well-formed,
 *   and holds no letter outside the Latin script: every name it already drew
 *   ("Ada Lovelace" → "AL", "Émile" → "ÉM", "1Password" → "1P") renders
 *   exactly as before.
 * - Otherwise the name's first GRAPHEME: a whole Devanagari conjunct ("प्रि"),
 *   a whole ZWJ family or flag emoji, never half a code-point sequence.
 *   `Intl.Segmenter` gives that where the engine has it (Node, browsers); Hermes
 *   does not ship it, so the fallback is the first code point
 *   (`Array.from`), which still never splits a surrogate pair ("प", "ث").
 * - Uppercased only where the script has case and the uppercase is still one
 *   grapheme ("а" → "А"; Arabic and Devanagari are unchanged; "ß" is not
 *   widened to "SS").
 * - A name that starts with neither a letter nor a pictograph (digits,
 *   punctuation, empty) gets the default mark, never "?" and never a number
 *   that reads as a count.
 *
 * Pure and Node-importable so it is unit-tested rather than trusted.
 */
export function memberMarkOf(name: string): string | null {
	const trimmed = name.trim();
	const initials = initialsOf(trimmed);
	if (
		initials !== "?" &&
		!LONE_SURROGATE.test(initials) &&
		!NON_LATIN_LETTER.test(initials)
	)
		return initials;
	const first = firstGrapheme(trimmed);
	if (!MARKABLE.test(first)) return null;
	const upper = first.toUpperCase();
	return Array.from(upper).length === Array.from(first).length ? upper : first;
}

/* `initialsOf` can pair scripts ("Анна Smith" → "АS"); one grapheme reads better. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;
/* With the `u` flag a lone half of a pair is its own code point, category Cs;
 * a well-formed pair is one astral code point and does not match. */
const LONE_SURROGATE = /\p{Cs}/u;
/* A letter in any script, an emoji, or the first half of a flag. */
const MARKABLE = /^[\p{L}\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

type GraphemeSegmenter = new (
	locale?: string,
	options?: { granularity: "grapheme" },
) => { segment: (input: string) => Iterable<{ segment: string }> };

function firstGrapheme(text: string): string {
	/* Read off `Intl` at call time, not import time, so tests can take the
	 * Hermes path by removing it. */
	const Segmenter = (Intl as { Segmenter?: GraphemeSegmenter }).Segmenter;
	if (typeof Segmenter === "function") {
		for (const { segment } of new Segmenter(undefined, {
			granularity: "grapheme",
		}).segment(text))
			return segment;
		return "";
	}
	return Array.from(text)[0] ?? "";
}
