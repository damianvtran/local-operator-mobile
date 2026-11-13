/**
 * Find user-facing literals in `src/` and `app/` that are not catalogue keys.
 *
 * WHAT THIS IS FOR. The i18n programme forbids keying `src/i18n/` only for the
 * four modules keyed so far; without a ratchet the next screen adds an English
 * sentence that no catalogue owns, and the next translation wave inherits a
 * surface it cannot translate. This scanner finds those literals so
 * `check-strings.ts` can fail on NEW ones while a baseline absorbs the ones that
 * already shipped.
 *
 * WHAT IT IS — AND IS NOT. This is a HEURISTIC over source text, not a parser of
 * TSX. It strips comments and strings first, then applies three narrow rules:
 *
 * 1. `jsx-text` — a line of plain prose directly after a tag's `>` (the shape
 *    every `<Text>` body in this repo takes), or text between `>` and `<` on one
 *    line. This is the rule that catches copy added the ordinary way.
 * 2. `jsx-attribute` — a string literal assigned to a user-facing attribute
 *    (accessibility labels, text input hints and component copy props). EmptyState
 *    uses `headline`/`next`, dialogs use `body`, and refusal surfaces use `detail`;
 *    overlooking component-specific names lets visible copy evade the gate.
 *    The fixed list excludes `testID` and route ids, which are identifiers.
 * 3. `copy-module-literal` — a multi-word string literal inside a `*-copy.ts`
 *    module that the English catalogue does NOT already own. Those files exist to
 *    hold copy, so a sentence there that neither comes from `t()` nor appears in a
 *    catalogue is a key that was never added. A literal the catalogue DOES own is
 *    a deliberate mirror (see `account-routing-copy.ts`, which cannot import the
 *    runtime), and `catalogues.test.ts` binds it to the catalogue key for key.
 *
 * 4. `expression-literal` — a string or template literal that is the value of a
 *    conditional (`cond ? "a" : "b"`), the right side of `??`, or a function
 *    return (`return "..."`). These are the literals rules 1-3 cannot see: no tag
 *    or attribute name precedes them, so `{x ?? "Not signed in"}` and a
 *    `statusFor()` that returns sentences rendered English next to keyed text.
 *    A literal qualifies only if it reads as prose: it has a space, or starts
 *    with a capital letter (a lowercase one-word token such as `"primary"` or
 *    `"session"` is indistinguishable from an enum/route id, so it is a stated
 *    blind spot, not a finding), and it carries no `$/`-style path or
 *    identifier shape.
 *
 *    ACTIVATION-SCOPED, ON PURPOSE. Rule 4 applies ONLY to the files in
 *    `EXPRESSION_LITERAL_SCOPE` (the session screen, the agent-job screen, the
 *    video screen, the add-a-computer wait panel, Settings and its own-tunnel
 *    section, the own-tunnel verdicts, the command block and the set-up-a-computer
 *    screen). EVERY OTHER FILE IS NOT SCANNED BY
 *    IT YET — including the rest of `app/`, `src/features/auth/` and
 *    `src/features/settings/`, where ~90 further expression literals are known
 *    (e.g. `computer-switcher-view.ts`).
 *    That is a deliberate staged rollout, not an oversight: the baseline is
 *    shrink-only and must never become a dumping ground for them. Each slice adds
 *    paths to the list in the SAME change that keys everything the rule then finds
 *    there, so activation can only ever be green. `app/` is read by rules 1-3 too
 *    (the tree walk has covered it since #227), so activation scopes only rule 4.
 *
 * TOKENISER. Strings are stripped by a small state machine. An apostrophe glued
 * to a word (`relay's`) is read as JSX prose, not a quote, for every rule:
 * before that, one in-word apostrophe in JSX text silently blinded the scanner
 * for the rest of the file. An apostrophe after a space, a tag or a closing
 * brace (`'quoted'` in prose, a lone `'` before a word, or `{name}'s` in JSX
 * text) is still read as a quote — a stated limit, since in code those
 * positions do open a string.
 *
 * It does not understand JSX expressions inside template literals, and it does
 * not flag bare string literals in ordinary modules (a route name, a CSS class
 * and a sentence all look the same there). The ternary-else case (`: "x"`) is
 * recognised only when an unmatched `?` operator appears within the preceding
 * few lines, so an object property (`{ title: "x" }`) is not mistaken for one.
 * Arrow-expression bodies (`=> "x"`), `||` fallbacks and object-property values
 * are NOT covered. Those are stated limits rather than silent ones: coverage
 * grows by adding a NAMED rule, never by guessing at a whole file.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type FindingRule =
	| "jsx-text"
	| "jsx-attribute"
	| "copy-module-literal"
	| "expression-literal";

/**
 * Where rule 4 (`expression-literal`) is active. A path matches when it equals
 * an entry or lies under an entry ending in `/` (a directory entry is supported
 * for later slices; today every entry is a single file). See the header: widening
 * this list is the ONLY way to extend the rule, and only together with keying
 * what it newly finds.
 */
export const EXPRESSION_LITERAL_SCOPE: readonly string[] = [
	"app/(app)/session/[id].tsx",
	"app/(app)/session/[id]/agent/[jobId].tsx",
	"app/(app)/session/[id]/video.tsx",
	"src/features/auth/computers.tsx",
	"src/features/auth/own-tunnel.tsx",
	"src/features/auth/setup-computer.tsx",
	"src/features/auth/sign-in-panel.tsx",
	"src/features/auth/sign-in.tsx",
	"src/features/auth/tunnel-paths.tsx",
	"src/features/auth/tunnel-verdict.ts",
	"src/features/auth/welcome.tsx",
	"src/features/settings/own-tunnel-settings.tsx",
	"src/features/settings/settings.tsx",
	"src/ui/components/command-block.tsx",
];

export function expressionRuleActive(file: string): boolean {
	return EXPRESSION_LITERAL_SCOPE.some((entry) =>
		entry.endsWith("/") ? file.startsWith(entry) : file === entry,
	);
}

export interface Finding {
	readonly rule: FindingRule;
	/** Repository-relative, POSIX separators so a baseline is portable. */
	readonly file: string;
	readonly line: number;
	readonly text: string;
}

type ScannerState =
	| "code"
	| "line-comment"
	| "block-comment"
	| "single"
	| "double"
	| "template";

interface Literal {
	readonly line: number;
	readonly text: string;
	/** The code text earlier on the literal's first line, with string contents
	 *  already blanked — enough to see `placeholder=` before the value. */
	readonly before: string;
}

const USER_FACING_ATTRIBUTE =
	/(?:^|\s)(?:accessibilityLabel|accessibilityHint|placeholder|label|title|alt|aria-label|aria-description|headline|next|subtitle|caption|body|message|hint|description|detail)\s*=\s*$/;

/** A real JSX tag has a boundary before its `<`. TypeScript generics
 *  (`Promise<T>`, `=> Promise<T>`) do not, and matching those produced a
 *  `"Promise"` finding for every async signature in the tree. */
const JSX_TAG_OPEN = /(?:^|[^A-Za-z0-9_$])(?:<\/?[A-Za-z][A-Za-z0-9._-]*)/;

/** `throw new RangeError(...)` and friends are developer diagnostics, not copy. */
const DIAGNOSTIC = /(?:throw\s+new|new\s+[A-Za-z]*Error)\s*\(/;

/** A line that is nothing but prose. `<`, `>`, `{`, `}`, `=` and `;` all mean
 *  "this is code", so a JSX body is the only thing that survives. */
const PROSE_LINE = /^(?=.*[A-Za-z])(?=.*\s)(?!.*[{}<>=;()[\]|&]).{2,}$/;

const INLINE_JSX_TEXT =
	/(?:^|[^A-Za-z0-9_$])<([A-Za-z][A-Za-z0-9._-]*)(?:\s[^<>]*)?>([^<>{}]+?)<\/\1>/g;

const HAS_WORD = /[A-Za-z]/;

/* Rule 4's small classifiers, hoisted so they compile once. */
const WORD_CHAR_END = /[A-Za-z0-9_$]$/;
const IDENTIFIER_SHAPE = /^[\w./:#@%-]+$/;
const CAPITALISED_WORD = /^[A-Z][a-z]/;
const WHITESPACE = /\s+/;
const UTILITY_TOKEN = /^[a-z][a-z0-9:/[\].-]*$/;
const QUALIFIED_TOKEN = /[-:]/;
const HAS_SPACE = /\s/;
const STARTS_UPPER = /^[A-Z]/;
const OPENING_BRACKET = /[([{]/;
const CLOSING_BRACKET = /[)\]}]/;
const WORD_OR_QUESTION = /[\w?]/;
const OPTIONAL_FOLLOWER = /[.?:]/;

/** What may directly precede an expression literal: the true branch of `?:`, a
 *  `??` fallback, or `return`. `?.` and `?:` (optional chaining / optional
 *  property) never end a `before` that is followed by a quote. */
const TERNARY_THEN = /(?<![?\w])\?\s*\(?\s*$/;
const NULLISH = /\?\?\s*\(?\s*$/;
const RETURN = /(?:^|[^A-Za-z0-9_$.])return\s*\(?\s*$/;
const TERNARY_ELSE = /:\s*\(?\s*$/;
/** How many earlier code lines may separate a `: "x"` from its `?`. A keyed
 *  branch such as `t("key", {` + 3 argument lines + `})` is ~6 lines, so 4 was
 *  too short (QA Q1); the bracket-aware walk below, not this cap, is what keeps
 *  a longer window from reaching an unrelated `?`. */
const TERNARY_LOOKBACK = 12;
const COPIES_COPY = /-copy\.ts$/;

/** Words after dropping `{placeholder}` and `${expression}` parts: `every ${x}`
 *  is one word, and a sentence that is mostly interpolation is not copy this
 *  rule can judge. */
const PLACEHOLDER_EXPRESSION = /\$\{[^}]*\}/g;
const MESSAGE_ARGUMENT = /\{[^{}]*\}/g;

/** Words after dropping `{placeholder}` and `${expression}` parts: `every ${x}`
 *  is one word, and a sentence that is mostly interpolation is not copy this
 *  rule can judge. */
function words(text: string): string[] {
	return text
		.replace(PLACEHOLDER_EXPRESSION, " ")
		.replace(MESSAGE_ARGUMENT, " ")
		.split(/\s+/)
		.filter((word) => HAS_WORD.test(word));
}

function isBlankOrComment(line: string): boolean {
	return line.trim() === "";
}

/**
 * Strip comments and string CONTENTS from `source`, preserving offsets and line
 * count, and collect every string literal with the code that preceded it.
 *
 * Preserving offsets matters: a finding quotes a line number a reader can open.
 */
function splitCodeAndLiterals(source: string): {
	codeByLine: string[];
	literals: Literal[];
} {
	const codeByLine: string[] = [];
	const literals: Literal[] = [];
	let buffer = "";
	let state: ScannerState = "code";
	let literalStartLine = 1;
	let literalBefore = "";
	let literal = "";
	let quote = "";
	let line = 1;

	const pushLine = (): void => {
		codeByLine.push(buffer);
		buffer = "";
	};

	const endLiteral = (): void => {
		literals.push({
			line: literalStartLine,
			text: literal,
			before: literalBefore,
		});
		literal = "";
		quote = "";
	};

	for (let index = 0; index < source.length; index += 1) {
		const character = source.charAt(index);
		const next = source.charAt(index + 1);

		if (character === "\n") {
			if (state === "line-comment") state = "code";
			/* A template literal may span lines; the literal keeps accumulating and
			 * the line counter still advances so positions stay true. */
			pushLine();
			line += 1;
			continue;
		}

		switch (state) {
			case "code":
				if (character === "/" && next === "/") {
					state = "line-comment";
					index += 1;
					continue;
				}
				if (character === "/" && next === "*") {
					state = "block-comment";
					index += 1;
					continue;
				}
				/* An apostrophe glued to a word (`phone's`, `relay's`, `don't`) is JSX
				 * prose — punctuation, not a quote delimiter. TypeScript CAN open a
				 * string directly after an identifier character (`return'x'` is valid),
				 * but Biome formats every such site to `return "x"` (checked with
				 * `biome format`) and `biome check` gates this repo, so in formatted
				 * source the test cannot swallow a real literal. Treating it as a
				 * quote opened a "literal" that ran to the next apostrophe or end of file, blinding
				 * every rule for the rest of it (own-tunnel-settings.tsx went dark
				 * after :196). Applies to ALL rules since the scanner-blindness fix;
				 * the debt it newly exposed was seeded via `check-strings --update
				 * --base`, never by hand. Backticks in JSX text never blinded (a
				 * stray one closes on the next) so they are left alone. */
				if (character === "'" && WORD_CHAR_END.test(buffer)) {
					buffer += character;
					continue;
				}
				if (character === "'" || character === '"') {
					state = character === "'" ? "single" : "double";
					quote = character;
					literal = "";
					literalBefore = buffer;
					literalStartLine = line;
					continue;
				}
				if (character === "`") {
					state = "template";
					quote = "`";
					literal = "";
					literalBefore = buffer;
					literalStartLine = line;
					continue;
				}
				buffer += character;
				continue;
			case "line-comment":
				continue;
			case "block-comment":
				if (character === "*" && next === "/") {
					state = "code";
					index += 1;
				}
				continue;
			case "single":
			case "double":
			case "template":
				if (character === "\\") {
					literal += next;
					index += 1;
					continue;
				}
				if (character === quote) {
					endLiteral();
					state = "code";
					continue;
				}
				literal += character;
				continue;
		}
	}

	if (state === "single" || state === "double" || state === "template") {
		endLiteral();
	}
	pushLine();
	return { codeByLine, literals };
}

function proseLineFindings(file: string, codeByLine: string[]): Finding[] {
	const findings: Finding[] = [];
	for (let index = 0; index < codeByLine.length; index += 1) {
		const text = codeByLine[index]?.trim() ?? "";
		if (text === "" || !PROSE_LINE.test(text)) continue;

		let previous = index - 1;
		while (previous >= 0 && isBlankOrComment(codeByLine[previous] ?? "")) {
			previous -= 1;
		}
		const above = (codeByLine[previous] ?? "").trim();
		/* A JSX body follows the tag that opened it: a line ending in `>` that
		 * contains a tag. Without that anchor a stray prose line elsewhere (a
		 * multi-line comment is already stripped, but a template literal is not
		 * parsed) would be a false positive. */
		if (!above.endsWith(">") || !JSX_TAG_OPEN.test(above)) continue;
		findings.push({ rule: "jsx-text", file, line: index + 1, text });
	}
	return findings;
}

function inlineJsxFindings(file: string, codeByLine: string[]): Finding[] {
	const findings: Finding[] = [];
	for (let index = 0; index < codeByLine.length; index += 1) {
		const lineText = codeByLine[index] ?? "";
		INLINE_JSX_TEXT.lastIndex = 0;
		for (;;) {
			const match = INLINE_JSX_TEXT.exec(lineText);
			if (match === null) break;
			const text = (match[2] ?? "").trim();
			if (text === "" || !HAS_WORD.test(text)) continue;
			findings.push({
				rule: "jsx-text",
				file,
				line: index + 1,
				text,
			});
		}
	}
	return findings;
}

function literalFindings(
	file: string,
	literals: readonly Literal[],
	owned: ReadonlySet<string>,
): Finding[] {
	const findings: Finding[] = [];
	const isCopyModule = COPIES_COPY.test(file);
	for (const entry of literals) {
		const text = entry.text.trim();
		if (text === "" || !HAS_WORD.test(text)) continue;

		if (USER_FACING_ATTRIBUTE.test(entry.before)) {
			findings.push({
				rule: "jsx-attribute",
				file,
				line: entry.line,
				text,
			});
			continue;
		}

		if (
			isCopyModule &&
			!owned.has(text) &&
			!DIAGNOSTIC.test(entry.before) &&
			words(text).length >= 2
		) {
			findings.push({
				rule: "copy-module-literal",
				file,
				line: entry.line,
				text,
			});
		}
	}
	return findings;
}

function isProse(raw: string): boolean {
	/* Judge only the literal text, not the code interpolated into a template. */
	const text = raw.replace(PLACEHOLDER_EXPRESSION, " ").trim();
	if (!HAS_WORD.test(text)) return false;
	/* A path, URL, CSS-ish token or identifier-shaped string is not copy. */
	if (IDENTIFIER_SHAPE.test(text) && !CAPITALISED_WORD.test(text)) return false;
	/* Utility-class lists (`"min-w-0 flex-1 gap-2"`) are whitespace-separated
	 * lowercase tokens, at least one hyphenated or colon-qualified; no sentence
	 * is written that way. */
	const tokens = text.split(WHITESPACE);
	if (
		tokens.every((token) => UTILITY_TOKEN.test(token)) &&
		tokens.some((token) => QUALIFIED_TOKEN.test(token))
	) {
		return false;
	}
	return HAS_SPACE.test(text) || STARTS_UPPER.test(text);
}

/**
 * Does the expression that ends at the `:` closing `text` contain an unmatched
 * ternary `?` — i.e. is the literal after that `:` an else-branch?
 *
 * Walks BACKWARDS over code (string contents are already blanked) keeping a
 * bracket depth, so a whole earlier branch — including a multi-line
 * `t("key", {\n  a,\n})` call — is skipped as one balanced group instead of
 * ending the search at its `{` (QA Q1: `: "No connection yet"` after such a
 * branch had 0 findings). The walk stops, with "not a ternary", at:
 *  - an UNMATCHED opening bracket: the literal sits directly in an object or
 *    argument list (`{ title: "x" }`), so a `?` before that bracket belongs to
 *    some outer expression, not to this colon;
 *  - a `;` or `,` at depth 0: the end of the previous statement, property or
 *    argument, so an earlier property's ternary cannot make a later
 *    `title: "x"` look like an else-branch.
 * `?.`, `??` and an optional `?:` marker are not ternary operators.
 *
 * RESIDUAL REACH: a `?` is found only inside the TERNARY_LOOKBACK lines above;
 * an else-literal whose condition begins further up is still missed, as is a
 * comma operator or a `?` inside a regex literal. Both are rarer than the
 * shapes this now catches, and activation-scoping keeps a miss a missed finding
 * rather than a false failure.
 */
function opensTernary(text: string): boolean {
	let depth = 0;
	for (let at = text.length - 1; at >= 0; at -= 1) {
		const character = text.charAt(at);
		if (CLOSING_BRACKET.test(character)) {
			depth += 1;
		} else if (OPENING_BRACKET.test(character)) {
			if (depth === 0) return false;
			depth -= 1;
		} else if (depth === 0) {
			if (character === ";" || character === ",") return false;
			if (
				character === "?" &&
				!WORD_OR_QUESTION.test(text.charAt(at - 1)) &&
				!OPTIONAL_FOLLOWER.test(text.charAt(at + 1))
			) {
				return true;
			}
		}
	}
	return false;
}

/** Rule 4. `index` of each literal is the position in `literals`; the code
 *  lines let a `: "x"` look back for the `?` that opened its ternary. */
function expressionFindings(
	file: string,
	literals: readonly Literal[],
	codeByLine: readonly string[],
): Finding[] {
	const findings: Finding[] = [];
	for (const entry of literals) {
		const text = entry.text.trim();
		if (!isProse(text) || DIAGNOSTIC.test(entry.before)) continue;
		let hit =
			TERNARY_THEN.test(entry.before) ||
			NULLISH.test(entry.before) ||
			RETURN.test(entry.before);
		if (!hit && TERNARY_ELSE.test(entry.before)) {
			/* Collect at most TERNARY_LOOKBACK earlier code lines; the bracket-aware
			 * walk decides where the enclosing expression really begins. */
			const earlier = codeByLine
				.slice(Math.max(0, entry.line - 1 - TERNARY_LOOKBACK), entry.line - 1)
				.concat(entry.before);
			hit = opensTernary(earlier.join("\n"));
		}
		if (hit) {
			findings.push({
				rule: "expression-literal",
				file,
				line: entry.line,
				text,
			});
		}
	}
	return findings;
}

/** Every un-keyed literal in one file. Exported so a test can drive the same
 *  rules on a string instead of on the tree.
 *
 *  `owned` is the set of strings the English catalogues already define; a copy
 *  module's literal that matches one is a MIRROR of that message, not an omission. */
export function scanSource(
	file: string,
	source: string,
	owned: ReadonlySet<string> = new Set(),
): Finding[] {
	/* One tokenisation serves every rule now that prose apostrophes are handled
	 * for rules 1-3 as well as rule 4 (previously rule 4 alone had them). */
	const { codeByLine, literals } = splitCodeAndLiterals(source);
	const expression = expressionRuleActive(file)
		? expressionFindings(file, literals, codeByLine)
		: [];
	/* `app/` is scanned by rules 1-3 too since #227 (fa2bc5e0); rule 4 stays
	 * activation-scoped there, so `app/` files get rules 1-3 plus rule 4 only
	 * where `EXPRESSION_LITERAL_SCOPE` names them. */
	const base = [
		...proseLineFindings(file, codeByLine),
		...inlineJsxFindings(file, codeByLine),
		...literalFindings(file, literals, owned),
	];
	/* Rule 1-3 findings win a line they already own (a `label="x"` is an
	 * attribute, not an expression). */
	const taken = new Set(base.map((f) => `${f.line}\0${f.text}`));
	return [
		...base,
		...expression.filter((f) => !taken.has(`${f.line}\0${f.text}`)),
	];
}

const SCAN_EXTENSIONS = [".ts", ".tsx"];

function isScanned(file: string): boolean {
	if (!SCAN_EXTENSIONS.some((extension) => file.endsWith(extension))) {
		return false;
	}
	const posix = file.split(sep).join("/");
	if (posix.startsWith("src/i18n/")) return false;
	if (posix.includes("/__tests__/")) return false;
	if (posix.includes("/__fixtures__/")) return false;
	if (posix.endsWith(".test.ts") || posix.endsWith(".test.tsx")) return false;
	if (posix.endsWith(".gen.ts")) return false;
	return true;
}

function walk(directory: string, root: string, into: string[]): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			walk(path, root, into);
		} else if (entry.isFile()) {
			const relativePath = relative(root, path).split(sep).join("/");
			if (isScanned(relativePath)) into.push(relativePath);
		}
	}
}

/** Every finding under `<root>/src`, sorted so the baseline is deterministic. */
export function scanTree(
	root: string,
	owned: ReadonlySet<string> = new Set(),
): Finding[] {
	const files: string[] = [];
	/* `app/` holds the Expo Router screens — the most user-visible copy in the
	 * tree (EmptyState headlines, Screen titles, a11y labels). It was left out
	 * of the first scan, so a route could add an English sentence no catalogue
	 * owned and the ratchet never saw it. A fixture without `app/` simply has
	 * nothing to add. */
	for (const top of ["src", "app"]) {
		if (existsSync(join(root, top))) walk(join(root, top), root, files);
	}
	files.sort();
	const findings: Finding[] = [];
	for (const file of files) {
		const source = readFileSync(join(root, file), "utf8");
		findings.push(...scanSource(file, source, owned));
	}
	return findings.sort((left, right) => {
		if (left.file !== right.file) return left.file < right.file ? -1 : 1;
		if (left.line !== right.line) return left.line - right.line;
		return left.text < right.text ? -1 : 1;
	});
}

/** The baseline's stable identity for a finding: file + the literal itself, not
 *  its line, so code moving down a file does not resurrect an old entry. */
export function findingKey(finding: Finding): string {
	return `${finding.file}\u0000${finding.text}`;
}
