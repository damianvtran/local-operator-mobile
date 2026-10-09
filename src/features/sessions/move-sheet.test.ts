import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The receipt's phase bar names the element that draws its colour.
 *
 * Why it is pinned. The bar paints a bare semantic-coloured fill; a node whose
 * only distinguishing feature is that colour is exactly what the rubric's U-03
 * reports ("no word/glyph/name"), and this receipt's fills were 48 U-03 FAIL
 * rows in CI (both devices, both themes, all three scales, run 37911837728).
 * The audit reads the carrier off the node ITSELF, so the rows disappear only
 * while the name rides the fill — a label moved up to the track around it, or
 * dropped in a refactor, re-opens every one of them.
 *
 * Asserted over the SOURCE, because there is no render seam to read: the module
 * reaches `uniwind` through `@/ui/appearance`, which the Node test environment
 * cannot import (the same constraint as `model-sheet.test.ts` and
 * `imagegen-card.test.ts`). Comments are stripped first, so a commented-out
 * carrier cannot keep this green — the masking `imagegen-card.test.ts` records
 * (review round 1, F2).
 */

/** The residual leading-`*` filter, top-level for the lint's reason. */
const LEADING_STAR = /^\s*\*/;

/**
 * Comments out of a source file before any carrier is matched against it.
 *
 * Adopted from `imagegen-card.test.ts` (itself from `src/ui/a11y.e2e.test.ts`):
 * quote-aware on purpose, because a naive `/\/\/.*$/` also truncates `https://…`
 * inside a string and HIDES the real code after it — the direction that
 * matters, since a carrier this test fails to see is the defect it exists for.
 */
const stripComments = (text: string): string => {
	let out = "";
	let quote: string | null = null;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i] ?? "";
		const next = text[i + 1] ?? "";
		if (quote !== null) {
			out += ch;
			if (ch === "\\") {
				out += next;
				i += 1;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			out += "\n";
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
				i += 1;
			}
			i += 1;
			continue;
		}
		out += ch;
	}
	return out
		.split("\n")
		.filter((line) => !LEADING_STAR.test(line))
		.join("\n");
};

/** The phase bar, as its own component block. */
const PHASE_BAR = /const PhaseBar = [\s\S]*?\n\};/;

/** The element that DRAWS the semantics: the fill whose own style sets the
 *  colour the audit matches. Anchored on that style because the rule reads the
 *  carrier off the node that paints — a name on any other node leaves this one
 *  a colour-only status. */
const FILL_ELEMENT = /<View[^>]*backgroundColor: fill[\s\S]*?\/>/;

/** The fill's templated label, when it has one. */
const FILL_LABEL = /accessibilityLabel=\{`([^`]*)`\}/;

/** The call site's name argument: the phase's own word (or its verbatim
 *  spelling for an unknown phase). */
const CALL_SITE_NAME =
	/<PhaseBar[\s\S]*?name=\{PHASE_WORDS\[phase\.phase\] \?\? phase\.phase\}/;

/** The two interpolations the name must carry, asserted as holes rather than as
 *  the whole sentence so the punctuation may change while the carrier cannot go
 *  constant. */
const NAME_HOLE = /\$\{name\}/;
const PCT_HOLE = /\$\{pct\}/;

const SOURCE = stripComments(
	readFileSync(
		fileURLToPath(new URL("./move-sheet.tsx", import.meta.url)),
		"utf8",
	),
);

const phaseBar = (): string => {
	const match = SOURCE.match(PHASE_BAR);
	expect(
		match,
		"the phase bar must render as its own component",
	).not.toBeNull();
	return match?.[0] ?? "";
};

const fill = (): string => {
	const match = phaseBar().match(FILL_ELEMENT);
	expect(
		match,
		"the bar must paint its fill as a View of its own",
	).not.toBeNull();
	return match?.[0] ?? "";
};

describe("the phase bar's colour carrier", () => {
	it("names the element that draws the colour", () => {
		expect(fill()).toContain("accessibilityLabel=");
	});

	it("builds the name from the phase's word and the measured progress", () => {
		/* Both interpolations are the assertion: a constant label ("Progress")
		 * would satisfy "has a name" while saying nothing true, which is the
		 * reason the rubric accepts a name only when it names the state. */
		const label = fill().match(FILL_LABEL)?.[1] ?? "";
		expect(label).toMatch(NAME_HOLE);
		expect(label).toMatch(PCT_HOLE);
	});

	it("announces progressbar semantics through the mappings the web build renders", () => {
		/* The role passes through react-native-web to `role="progressbar"`; the
		 * value rides the flat aliases because the `accessibilityValue` object is
		 * silently dropped there (`imagegen-card.tsx`, design round 2, D6). */
		expect(fill()).toContain("accessibilityRole={ROLE.progressbar}");
		expect(fill()).toContain("aria-valuemin=");
		expect(fill()).toContain("aria-valuemax=");
		expect(fill()).toContain("aria-valuenow=");
	});

	it("hands the bar the phase's own word at the call site", () => {
		expect(SOURCE).toMatch(CALL_SITE_NAME);
	});
});
