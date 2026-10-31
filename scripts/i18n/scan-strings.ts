/**
 * Find user-facing literals in `src/` that are not catalogue keys.
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
 * It does not understand JSX expressions inside template literals, and it does
 * not flag bare string literals in ordinary modules (a route name, a CSS class
 * and a sentence all look the same there). That is a stated limit rather than a
 * silent one: coverage grows by adding a NAMED rule, never by guessing at a
 * whole file.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type FindingRule = "jsx-text" | "jsx-attribute" | "copy-module-literal";

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
	const { codeByLine, literals } = splitCodeAndLiterals(source);
	return [
		...proseLineFindings(file, codeByLine),
		...inlineJsxFindings(file, codeByLine),
		...literalFindings(file, literals, owned),
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
	walk(join(root, "src"), root, files);
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
