/**
 * The markdown rules a module without a renderer can read, and the table model
 * the renderer and its tests share.
 *
 * `markdown.tsx` is the renderer and imports `react-native`, so anything that has
 * to ask "does this text contain a fenced block" from OUTSIDE a component — the
 * session view's state marker (`state-marker.ts`), and the rig that boots the mock
 * relay per scenario and checks which markers a frame would carry — cannot import
 * it without dragging a renderer in. Splitting the rules out is what keeps one
 * definition rather than a second spelling in the derivation.
 *
 * The block and inline parsers live here for the same reason the fence rule always
 * did: they are pure string work, and the table grammar below has to be testable in
 * Node (`markdown.test.ts`) without a React Native host — the same split the
 * `components/` directory already keeps between logic and its rendering.
 */

/** The opening/closing fence, the renderer's own pattern moved verbatim:
 *  `parseMarkdown` uses it both to open a block and to find a paragraph's end, so
 *  a fence this does not match is a fence the transcript does not draw either. */
export const FENCE = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/;

/** Whether a document carries a fenced block, which is what "a rich row" means:
 *  the rows that own the copy control (`docs/e2e/README.md` § the audit). A tool
 *  row or an image is a different kind of row and a different claim. */
export const hasFencedBlock = (text: string): boolean =>
	text.split("\n").some((line) => FENCE.test(line));

/* ----------------------------------------------------------------- the parser */

export type Block =
	| { kind: "code"; language: string; lines: string[] }
	| { kind: "heading"; level: number; text: string }
	| {
			kind: "list";
			ordered: boolean;
			items: string[];
			indents?: number[];
			markers?: string[];
	  }
	| { kind: "quote"; text: string }
	| { kind: "table"; header: string[]; rows: string[][] }
	| { kind: "paragraph"; text: string };

const INDENT = /^\s*/;
const TABS = /\t/g;
const LIST_MARKER = /^\s*(\d+[.)])/;
const ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/;
const TICKS = /^`+/;
const EMPHASIS_RUN = /^(\*+|_+|~{2,})/;
const BARE_URL = /^https?:\/\/[^\s<>]+/i;
const WORD_OR_SLASH = /[\w/]/;
const TRAILING_PUNCTUATION = /[.,!?:;]+$/;
const AUTOLINK = /^<(https?:\/\/[^<>\s]+|mailto:[^<>\s]+)>/i;
const MAILTO = /^mailto:/i;
const WORD = /\w/;
const SPACE = /\s/;
const LINE_BREAK = /[\r\n\u2028\u2029]/;
const ANGLE_BOUNDARY = /[<>\n]/;

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/**
 * Split one line into table cells, or `null` when it is not a table row.
 *
 * The grammar is `docs/ux` § the table block, and its three rules are what make a
 * table a table rather than a paragraph of pipes:
 *
 *  - a line must contain at least one `|` that is not escaped (`\|`) and not inside
 *    a code span (`` `a|b` `` is one cell), because a line with no separator is
 *    prose;
 *  - a leading and/or trailing `|` is a fence and produces no empty cell, while an
 *    internal `||` DOES produce an empty cell — a blank cell is content;
 *  - escapes are resolved here, so the renderer never sees a `\|` (the U-38 check
 *    asserts that no rendered text node ever shows one).
 *
 * `null` is the honest answer for a line this cannot read; the caller decides
 * whether that makes the run prose or a body-row stop.
 */
export function splitTableRow(line: string): string[] | null {
	// One scan, because "escaped" and "inside a code span" are both decided by the
	// characters BEFORE the pipe and a regex with two lookbehinds over backticks
	// would need to count an odd/even number of them per line anyway.
	const cells: string[] = [];
	let current = "";
	let sawSeparator = false;
	let inCode = false;
	let index = 0;
	while (index < line.length) {
		const char = line[index] ?? "";
		if (char === "\\" && line[index + 1] === "|") {
			current += "|";
			index += 2;
			continue;
		}
		if (char === "`") {
			inCode = !inCode;
			current += char;
			index += 1;
			continue;
		}
		if (char === "|" && !inCode) {
			cells.push(current.trim());
			current = "";
			sawSeparator = true;
			index += 1;
			continue;
		}
		current += char;
		index += 1;
	}
	if (!sawSeparator) return null;
	cells.push(current.trim());
	// A leading/trailing fence is not content. Stripping exactly one leading and one
	// trailing empty cell is what makes `| a | b |` and `a | b` the same two cells
	// while keeping an internal `||` as the empty cell it is.
	if (cells.length > 1 && (cells[0] ?? "").length === 0) cells.shift();
	if (cells.length > 1 && (cells[cells.length - 1] ?? "").length === 0)
		cells.pop();
	return cells;
}

/** The divider-cell shape: optional alignment colons around one or more dashes.
 *  Top-level so the rule is compiled once — biome's `useTopLevelRegex`. */
const DIVIDER_CELL = /^:?-{1,}:?$/;

/** Runs of whitespace, for token splitting — top-level for the same reason. */
const WHITESPACE = /\s+/;

/** Whether every cell of a line matches the divider shape — the divider row,
 *  whose alignment colons are parsed and ignored (cells are left-aligned in every
 *  column; a right-aligned column is a follow-up, not a silent difference). */
const isDividerRow = (cells: string[]): boolean =>
	cells.length > 0 && cells.every((cell) => DIVIDER_CELL.test(cell.trim()));

/**
 * Whether line `index` opens a table: the header rule plus a divider row below it
 * with the SAME cell count.
 *
 * A malformed run (no divider, wrong count, a cell that fails the divider test) is
 * not a table at all: the whole run stays a paragraph of its own source. That is
 * the renderer's stated principle — a half-recognised table that silently drops a
 * row would shorten the model's answer — and the divider keeps it cheap.
 */
export function startsTable(lines: string[], index: number): boolean {
	const header = splitTableRow(lines[index] ?? "");
	if (header === null || header.length === 0) return false;
	const divider = splitTableRow(lines[index + 1] ?? "");
	if (divider === null) return false;
	return divider.length === header.length && isDividerRow(divider);
}

/**
 * Split a document into blocks.
 *
 * Block-level only, in one pass and with no backtracking beyond the one-line
 * divider lookahead: the transcript re-renders on every streamed frame, so the
 * parser's cost is paid per frame and a general grammar would be paid for text the
 * reader is already reading.
 */
export const parseMarkdown = (text: string): Block[] => {
	const blocks: Block[] = [];
	const lines = text.split("\n");
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		const fence = FENCE.exec(line);
		if (fence) {
			const language = fence[1] ?? "";
			const body: string[] = [];
			index += 1;
			while (index < lines.length && !FENCE.test(lines[index] ?? "")) {
				body.push(lines[index] ?? "");
				index += 1;
			}
			// Consume the closing fence when there is one; an unterminated fence is a
			// stream still arriving, so the body so far is the honest render.
			if (index < lines.length) index += 1;
			blocks.push({ kind: "code", language, lines: body });
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({
				kind: "heading",
				level: (heading[1] ?? "#").length,
				text: heading[2] ?? "",
			});
			index += 1;
			continue;
		}
		const quote = QUOTE.exec(line);
		if (quote) {
			const body: string[] = [quote[1] ?? ""];
			index += 1;
			while (index < lines.length && QUOTE.test(lines[index] ?? "")) {
				body.push((QUOTE.exec(lines[index] ?? "") ?? [])[1] ?? "");
				index += 1;
			}
			blocks.push({ kind: "quote", text: body.join("\n") });
			continue;
		}
		const bullet = BULLET.exec(line);
		const ordered = bullet ? null : ORDERED.exec(line);
		if (bullet || ordered) {
			const isOrdered = ordered !== null;
			const items: string[] = [];
			const indents: number[] = [];
			const markers: string[] = [];
			while (index < lines.length) {
				const source = lines[index] ?? "";
				const item = BULLET.exec(source) ?? ORDERED.exec(source);
				if (!item) break;
				items.push(item[1] ?? "");
				// Keep source indentation and ordered numbers: flattening both made
				// nested evidence lists read as unrelated top-level claims.
				indents.push(
					(INDENT.exec(source)?.[0] ?? "").replace(TABS, "    ").length,
				);
				markers.push(LIST_MARKER.exec(source)?.[1] ?? "•");
				index += 1;
			}
			const plainMarkers = markers.every(
				(marker, i) => marker === (isOrdered ? `${i + 1}.` : "•"),
			);
			blocks.push({
				kind: "list",
				ordered: isOrdered,
				items,
				...(indents.some((indent) => indent > 0) ? { indents } : {}),
				...(!plainMarkers ? { markers } : {}),
			});
			continue;
		}
		if (startsTable(lines, index)) {
			const header = splitTableRow(line) ?? [];
			index += 2; // header + divider
			const rows: string[][] = [];
			// Body rows: consecutive lines that contain an unescaped `|`, stopping at
			// the first blank line, at a fence, at a heading, or at any line without a
			// separator. An over-long row keeps its extra cells — appended to the last
			// column, because dropping them is exactly the silent shortening this file
			// forbids — and a short row pads, so every row is the header's width.
			while (index < lines.length) {
				const next = lines[index] ?? "";
				if (next.trim().length === 0) break;
				if (FENCE.test(next) || HEADING.test(next)) break;
				const cells = splitTableRow(next);
				if (cells === null) break;
				const padded =
					cells.length >= header.length
						? cells.length === header.length
							? cells
							: [
									...cells.slice(0, header.length - 1),
									cells.slice(header.length - 1).join(" "),
								]
						: [...cells, ...Array(header.length - cells.length).fill("")];
				rows.push(padded);
				index += 1;
			}
			blocks.push({ kind: "table", header, rows });
			continue;
		}
		if (line.trim().length === 0) {
			index += 1;
			continue;
		}
		const paragraph: string[] = [line];
		index += 1;
		while (index < lines.length) {
			const next = lines[index] ?? "";
			if (
				next.trim().length === 0 ||
				FENCE.test(next) ||
				HEADING.test(next) ||
				BULLET.test(next) ||
				ORDERED.test(next) ||
				QUOTE.test(next) ||
				// A table opening mid-paragraph ends the paragraph. Without this the pipe
				// lines below a sentence would be eaten into it and the table would never
				// reach the branch above — the exact "renders as its own source" defect.
				startsTable(lines, index)
			)
				break;
			paragraph.push(next);
			index += 1;
		}
		blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
	}
	return blocks;
};

/** Whether a document carries a markdown table, which is what the `tables` state
 *  marker (`state-marker.ts`) names: a transcript whose answers render as rows and
 *  columns rather than as their own pipe source. Derived from the same parser the
 *  renderer uses, so a marker can never affirm a table the reader would not see. */
export const hasTableBlock = (text: string): boolean =>
	parseMarkdown(text).some((block) => block.kind === "table");

/* ------------------------------------------------------------------ inline */

export type InlineSpan = {
	text: string;
	code: boolean;
	bold: boolean;
	italic: boolean;
	href?: string;
	strike?: boolean;
};

const unescapeMarkdown = (text: string) =>
	text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");

type InlinePair = { end: number; width: number };

/** Index delimiters once per streamed frame. A failed opener must be an O(1)
 * lookup, not another walk over the remaining answer. Runs are pushed/popped
 * once, and code is opaque to label/emphasis matching (but not to URL syntax).
 * Rendering uses explicit frames below: deeply nested input cannot grow the JS
 * call stack or repeatedly copy/reparse the same label/body. */
function inlinePairs(text: string) {
	const code = new Map<number, InlinePair>();
	const brackets = new Map<number, number>();
	const parentheses = new Map<number, number>();
	const emphasis = new Map<number, InlinePair>();
	// Range queries validate a destination without rescanning it. Malformed
	// nested links can overlap destinations, so even a linear regex per opener
	// would reintroduce quadratic work on the streaming path.
	const nextSpace: number[] = [];
	const nextContent: number[] = [];
	const previousContent: number[] = [];
	const nextAngle: number[] = [];
	const lineBreaks: number[] = [0];
	nextSpace[text.length] =
		nextContent[text.length] =
		nextAngle[text.length] =
			text.length;
	let previous = -1;
	for (let i = 0; i < text.length; i += 1) {
		if (!SPACE.test(text[i] ?? "")) previous = i;
		previousContent[i] = previous;
		lineBreaks[i + 1] =
			(lineBreaks[i] ?? 0) + (LINE_BREAK.test(text[i] ?? "") ? 1 : 0);
	}
	for (let i = text.length - 1; i >= 0; i -= 1) {
		const space = SPACE.test(text[i] ?? "");
		nextSpace[i] = space ? i : (nextSpace[i + 1] ?? text.length);
		nextContent[i] = space ? (nextContent[i + 1] ?? text.length) : i;
		nextAngle[i] = ANGLE_BOUNDARY.test(text[i] ?? "")
			? i
			: (nextAngle[i + 1] ?? text.length);
	}
	const destination = (start: number, end: number): string | undefined => {
		start = nextContent[start] ?? end;
		end = (previousContent[end - 1] ?? -1) + 1;
		if (start >= end) return undefined;
		const title = (after: number) => {
			if (after === end) return true;
			const quote = nextContent[after] ?? end;
			return (
				SPACE.test(text[after] ?? "") &&
				quote + 1 < end &&
				(text[quote] === '"' || text[quote] === "'") &&
				(text[end - 1] === '"' || text[end - 1] === "'") &&
				lineBreaks[quote] === lineBreaks[end]
			);
		};
		if (text[start] === "<") {
			const close = nextAngle[start + 1] ?? end;
			if (close < end && text[close] === ">" && title(close + 1))
				return unescapeMarkdown(text.slice(start + 1, close));
		}
		const space = Math.min(nextSpace[start] ?? end, end);
		if (title(space)) return unescapeMarkdown(text.slice(start, space));
		return undefined;
	};
	const runs: { start: number; width: number }[] = [];
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] !== "`") continue;
		const start = i;
		while (text[i + 1] === "`") i += 1;
		runs.push({ start, width: i - start + 1 });
	}
	// Preserve the existing code grammar: a closer may be a prefix of a longer
	// tick run. Record suffixes too, since consuming that prefix leaves another
	// possible opener. The monotone candidate stack and cursor visit at most
	// one entry per tick character, rather than searching the suffix per run.
	const tickCandidates: { start: number; width: number }[] = [];
	for (let i = runs.length - 1; i >= 0; i -= 1) {
		const run = runs[i];
		if (!run) continue;
		let candidate = tickCandidates.length - 1;
		while (
			candidate >= 0 &&
			(tickCandidates[candidate]?.width ?? 0) < run.width
		)
			candidate -= 1;
		for (let offset = 0; offset < run.width; offset += 1) {
			const width = run.width - offset;
			while (
				candidate + 1 < tickCandidates.length &&
				(tickCandidates[candidate + 1]?.width ?? 0) >= width
			)
				candidate += 1;
			const closer = tickCandidates[candidate];
			if (closer) code.set(run.start + offset, { end: closer.start, width });
		}
		while (
			tickCandidates.length &&
			(tickCandidates[tickCandidates.length - 1]?.width ?? 0) <= run.width
		)
			tickCandidates.pop();
		tickCandidates.push(run);
	}
	const parenStack: number[] = [];
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === "\\") {
			i += 1;
			continue;
		}
		if (text[i] === "(") parenStack.push(i);
		if (text[i] === ")") {
			const start = parenStack.pop();
			if (start !== undefined) parentheses.set(start, i);
		}
	}
	const bracketStack: number[] = [];
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === "\\") {
			i += 1;
			continue;
		}
		const span = code.get(i);
		if (span) {
			i = span.end + span.width - 1;
			continue;
		}
		if (text[i] === "[") bracketStack.push(i);
		if (text[i] === "]") {
			const start = bracketStack.pop();
			if (start !== undefined) brackets.set(start, i);
		}
	}
	const stacks = new Map<string, { start: number; width: number }[]>();
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === "\\") {
			i += 1;
			continue;
		}
		const span = code.get(i);
		if (span) {
			i = span.end + span.width - 1;
			continue;
		}
		// Destinations and public URLs are opaque to typography. Otherwise a
		// URL underscore could steal a label's closing emphasis delimiter.
		if (text[i] === "]" && text[i + 1] === "(") {
			const end = parentheses.get(i + 1);
			if (end !== undefined) {
				i = end;
				continue;
			}
		}
		const bare = BARE_URL.exec(text.slice(i));
		if (bare) {
			i += bare[0].length - 1;
			continue;
		}
		const marker = text[i] ?? "";
		if (marker !== "*" && marker !== "_" && marker !== "~") continue;
		const start = i;
		while (text[i + 1] === marker) i += 1;
		const width = i - start + 1;
		if (width > 3 || (marker === "~" && width !== 2)) continue;
		const stack = stacks.get(marker) ?? [];
		stacks.set(marker, stack);
		let remaining = width;
		let closer = start;
		if (
			start > 0 &&
			!SPACE.test(text[start - 1] ?? "") &&
			!(marker === "_" && WORD.test(text[i + 1] ?? ""))
		) {
			while (remaining > 0 && stack.length > 0) {
				const opener = stack[stack.length - 1];
				if (!opener) break;
				const used = Math.min(opener.width, remaining);
				opener.width -= used;
				emphasis.set(opener.start + opener.width, { end: closer, width: used });
				if (opener.width === 0) stack.pop();
				remaining -= used;
				closer += used;
			}
		}
		if (
			remaining > 0 &&
			i + 1 < text.length &&
			!SPACE.test(text[i + 1] ?? "") &&
			!(marker === "_" && WORD.test(text[start - 1] ?? ""))
		)
			stack.push({ start: closer, width: remaining });
	}
	return { code, brackets, parentheses, emphasis, destination };
}

/** Complete constructs only: unknown/incomplete streamed source remains literal.
 * Indexed matching and an explicit frame stack keep work proportional to input
 * plus output, rather than nesting depth or the count of unmatched openers. */
export const parseInline = (text: string): InlineSpan[] => {
	const pairs = inlinePairs(text);
	const spans: InlineSpan[] = [];
	type Frame = {
		index: number;
		end: number;
		style: Omit<InlineSpan, "text">;
		plain: number;
	};
	const frames: Frame[] = [
		{
			index: 0,
			end: text.length,
			style: { code: false, bold: false, italic: false },
			plain: -1,
		},
	];
	while (frames.length) {
		const frame = frames[frames.length - 1];
		if (!frame) break;
		if (frame.index >= frame.end) {
			frames.pop();
			continue;
		}
		const index = frame.index;
		const rest = text.slice(index, frame.end);
		const plain = (value: string) => {
			const last = spans[frame.plain];
			if (last) last.text += value;
			else {
				frame.plain = spans.length;
				spans.push({ text: value, ...frame.style });
			}
		};
		const escaped = ESCAPE.exec(rest);
		if (escaped) {
			plain(escaped[1] ?? "");
			frame.index += escaped[0].length;
			continue;
		}
		const ticks = TICKS.exec(rest)?.[0];
		if (ticks) {
			const pair = pairs.code.get(index);
			if (pair && pair.end < frame.end) {
				spans.push({
					text: text.slice(index + pair.width, pair.end),
					...frame.style,
					code: true,
				});
				frame.plain = -1;
				frame.index = pair.end + pair.width;
			} else {
				plain(ticks);
				frame.index += ticks.length;
			}
			continue;
		}
		if (text[index] === "[") {
			const labelEnd = pairs.brackets.get(index);
			const end =
				labelEnd === undefined
					? undefined
					: pairs.parentheses.get(labelEnd + 1);
			if (
				labelEnd !== undefined &&
				text[labelEnd + 1] === "(" &&
				end !== undefined &&
				end < frame.end
			) {
				const href = pairs.destination(labelEnd + 2, end);
				if (href !== undefined) {
					frame.index = end + 1;
					frame.plain = -1;
					frames.push({
						index: index + 1,
						end: labelEnd,
						style: { ...frame.style, href: frame.style.href ?? href },
						plain: -1,
					});
					continue;
				}
			}
		}
		// Check the boundary before scanning a URL-sized suffix: repeated URL
		// prefixes inside one identifier are literal, not repeated lookaheads.
		const bare = !WORD_OR_SLASH.test(text[index - 1] ?? "")
			? BARE_URL.exec(rest)
			: null;
		if (bare) {
			let href = bare[0].replace(TRAILING_PUNCTUATION, "");
			let balance = 0;
			for (const character of href) {
				if (character === "(") balance += 1;
				if (character === ")") balance -= 1;
			}
			let end = href.length;
			while (balance < 0 && href[end - 1] === ")") {
				end -= 1;
				balance += 1;
			}
			href = href.slice(0, end);
			spans.push({
				text: href,
				...frame.style,
				href: frame.style.href ?? href,
			});
			frame.plain = -1;
			frame.index += href.length;
			continue;
		}
		const autolink = AUTOLINK.exec(rest);
		if (autolink) {
			const href = autolink[1] ?? "";
			spans.push({
				text: href.replace(MAILTO, ""),
				...frame.style,
				href: frame.style.href ?? href,
			});
			frame.plain = -1;
			frame.index += autolink[0].length;
			continue;
		}
		const pair = pairs.emphasis.get(index);
		if (pair && pair.end < frame.end && pair.end > index + pair.width) {
			frame.index = pair.end + pair.width;
			frame.plain = -1;
			frames.push({
				index: index + pair.width,
				end: pair.end,
				plain: -1,
				style: {
					...frame.style,
					...(text[index] === "~"
						? { strike: true }
						: pair.width === 3
							? { bold: true, italic: true }
							: pair.width === 2
								? { bold: true }
								: { italic: true }),
				},
			});
			continue;
		}
		const run = EMPHASIS_RUN.exec(rest)?.[0];
		if (run) {
			plain(run);
			frame.index += run.length;
			continue;
		}
		plain(text[index] ?? "");
		frame.index += 1;
	}
	return spans;
};

/* ------------------------------------------------------------------- pricing */

/**
 * The table's column pricing, computed — never measured.
 *
 * React Native has neither CSS auto table layout nor min-content, so the width a
 * column needs has to be derived from the parsed strings, with no text measurement
 * and no layout pass: this renderer is on the streaming path and re-runs on every
 * frame. The rule and its rationale are the design pass's (`fix/hero-tables-strips`,
 * §1.3): **no column ever goes below its longest word, the 64-character cap bounds
 * an unbounded token, and the surplus goes sideways rather than squeezing.**
 */

/**
 * The advance of one MONO face character, in pt at 100 % scale — the exact box
 * advance of `mono-sm` (12pt) in the shipped build, pinned by
 * `markdown.test.ts` rather than assumed.
 *
 * The measured basis: a monospace run reads 7.2pt/char from the live DOM on the
 * shipped web build (an 11-character run spans exactly 79.2pt), which is also
 * 0.6em × 12pt. It is NOT the per-character value of a code line's INK: a
 * 28-character code line spans ≈198.33pt of ink on the iphone-15 frame (the
 * design pass's number), which divides to 7.08, but ink undercounts — the last
 * glyph's width is not a full advance, and the box a token occupies is what
 * decides whether it wraps. Pricing at the ink value under-sizes a sha256
 * column by a full character.
 */
export const TABLE_MONO_ADVANCE_PT = 7.2;

/**
 * The advance of one SANS face character, in pt at 100 % — the widest glyph
 * advance of `body-sm` at its body weight, measured the same way from the same
 * build and pinned by the same test: a 20-`m` run spans 240pt of box at 100 %
 * → 12.00/char (capitals 11.88, digits 7.93, mixed prose 5.85). `m` is the
 * widest glyph in the regular Latin face.
 *
 * WHY TWO ADVANCES, against the spec's single `CH`: the single constant was
 * built and measured before it was believed (2026-10-06, this branch). One
 * advance below the proportional face's real cost re-opened the exact defect
 * `U-39` exists for: the 7-character header `outcome` broke its own column at
 * 200 % on the S5 rich-rows frames (cell content box 105.4pt against a real run
 * of ≈106pt) — `U-39` failed on the fixture the spec itself mandates. One
 * advance ABOVE the mono cost is just as wrong in the other direction: pricing
 * every code token at the sans bound pushed even the fits-exactly fixture over
 * the rail and manufactured the cue this redesign exists to reserve for real
 * overflow. So each token is priced at its own face's advance, mono exact and
 * sans at its worst regular glyph. The header face is `body-sm` at weight 600,
 * whose advances run ≈2-3 % wider (measured: `m` 13.82, `W` 15.60) — a header
 * token built entirely of those glyphs would out-run this bound, and the right
 * fix then is to re-measure this constant, which `U-39` will say the moment it
 * breaks a real token. Disclosed on the PR rather than silently diverging: the
 * spec's §1.3 pinned one `CH`, and this is the second measurement that says
 * why one is not enough.
 */
export const TABLE_SANS_ADVANCE_PT = 12;

/**
 * The token cap, in characters.
 *
 * A single token longer than this — a digest, a base64 blob — wraps inside its
 * column instead of stretching the table: 64 is sha256-hex, the longest token the
 * kit must keep whole; a larger cap was measured to balloon the *short* columns
 * instead.
 */
export const TABLE_TOKEN_CAP = 64;

/** The smallest width a column may be priced at, in characters: every column
 *  carries at least one glyph's worth of its own identity, or the rules beneath
 *  the header stop reading as columns at all. */
export const TABLE_TOKEN_FLOOR = 4;

/** The cell's padding, in pt, taken once so the pricing and the class names
 *  cannot disagree: `py-2 px-3`. */
export const TABLE_CELL_PADDING_X_PT = 12;
export const TABLE_CELL_PADDING_Y_PT = 8;

/** The frame's border width in pt (`border-border-control`, 1pt). */
export const TABLE_BORDER_PT = 1;

const clampToken = (value: number): number =>
	Math.min(TABLE_TOKEN_CAP, Math.max(TABLE_TOKEN_FLOOR, value));

/** One whitespace-delimited run of a cell, and the face it renders in. */
interface PricedToken {
	length: number;
	/** True inside a `code span`, whose face has ONE advance and is therefore
	 *  priced exactly (`TABLE_MONO_ADVANCE_PT`); false for the proportional sans
	 *  face, priced at its worst glyph (`TABLE_SANS_ADVANCE_PT`). */
	mono: boolean;
}

/**
 * Split one cell into its whitespace-delimited runs, marking the runs that sit
 * inside `code spans`.
 *
 * A backtick TOGGLES the face, and an unterminated span leaves the rest of the
 * cell on the code face — the same reading the inline renderer gives an
 * unclosed span (it renders the backtick and its text verbatim), so the pricing
 * and the renderer cannot disagree about where the code face starts. The
 * backticks themselves are not part of any token's width: they are not glyphs
 * the cell draws.
 */
const pricedTokens = (cell: string): PricedToken[] => {
	const tokens: PricedToken[] = [];
	let mono = false;
	let run = "";
	const flush = (): void => {
		if (run !== "") {
			tokens.push({ length: run.length, mono });
			run = "";
		}
	};
	for (const character of cell) {
		if (character === "`") {
			flush();
			mono = !mono;
			continue;
		}
		if (WHITESPACE.test(character)) {
			flush();
			continue;
		}
		run += character;
	}
	flush();
	return tokens;
};

/** The priced width of one column, in pt at 100 %: the widest token across its
 *  header and body cells, each token at its own face's advance. */
const columnWidth = (cells: string[]): number => {
	let widest = 0;
	for (const cell of cells) {
		for (const token of pricedTokens(cell.replace(/\\\|/g, "|"))) {
			const advance = token.mono
				? TABLE_MONO_ADVANCE_PT
				: TABLE_SANS_ADVANCE_PT;
			const width = clampToken(token.length) * advance;
			if (width > widest) widest = width;
		}
	}
	return widest;
};

/** The longest whole cell string across one column, in characters. */
const longestCell = (cells: string[]): number => {
	let longest = 0;
	for (const cell of cells) if (cell.length > longest) longest = cell.length;
	return longest;
};

export interface TablePricing {
	/** `minWidth` per column, in pt: the clamp applied, then priced. */
	minWidths: number[];
	/** `flexGrow` per column: the share of slack a fitting table distributes. */
	shares: number[];
	/** The priced row's minimum width, in pt: columns + borders + cell padding. */
	naturalWidth: number;
}

/**
 * Price `header` + `rows` at `effectiveScale`.
 *
 * The arithmetic is the design pass's, with one measured correction:
 *
 *   minW(c)  = max over tokens (clamp(len, 4, 64) * advance(face)) * scale
 *   share(c) = clamp(longestCellChars(c), 4, 64)
 *   naturalW = Σ minW(c) + (cols + 1) * border + cols * 2 * cellPaddingX
 *
 * The design's single `advance` was measured on a mono code line and applied
 * to every token; the correction and its measurements are in
 * `TABLE_SANS_ADVANCE_PT`'s note. `U-39` is the arbiter: it failed the
 * single-advance build on the spec's own fixture ('outcome' at 200 %) and
 * passes this one on the same frames.
 *
 * The `effectiveScale` factor is not optional: without it a 200 % reader gets
 * columns priced for 100 % and every cell wraps — the large-text failure the
 * after-round exists to catch.
 */
export function tablePricing(
	header: string[],
	rows: string[][],
	effectiveScale: number,
): TablePricing {
	const columns = Math.max(1, header.length);
	const minWidths: number[] = [];
	const shares: number[] = [];
	for (let column = 0; column < columns; column += 1) {
		const cells = [header[column] ?? ""];
		for (const row of rows) cells.push(row[column] ?? "");
		minWidths.push(columnWidth(cells) * effectiveScale);
		shares.push(clampToken(longestCell(cells)));
	}
	const naturalWidth =
		minWidths.reduce((sum, width) => sum + width, 0) +
		(columns + 1) * TABLE_BORDER_PT +
		columns * 2 * TABLE_CELL_PADDING_X_PT;
	return { minWidths, shares, naturalWidth };
}

/**
 * Where a table's scroll-cue fade sits and which end of it is opaque.
 *
 * The cue is stated in READING order (`end` = where the next column would be) but
 * a fade is PAINTED in physical coordinates: its gradient runs left to right
 * whatever the layout direction is. So the logical edge is resolved to a physical
 * one here, and the position and the opaque stop follow the same answer — a fade
 * that moved only its `left`/`right` would leave its solid end on the wrong side
 * and read as a second edge instead of a continuation. Kept pure (no React Native
 * import) so both directions are pinned by a test. In `ltr` this is the identity:
 * `end` is the right edge, exactly what the fade drew before direction existed.
 */
export const tableFadeGeometry = (
	edge: "start" | "end",
	rtl: boolean,
): {
	/** The physical side the band is pinned to. */
	side: "left" | "right";
	/** Opacity of the gradient's left (`near`) and right (`far`) stops. */
	nearOpacity: 0 | 1;
	farOpacity: 0 | 1;
} => {
	const atEndEdge = rtl ? edge === "start" : edge === "end";
	return {
		side: atEndEdge ? "right" : "left",
		nearOpacity: atEndEdge ? 0 : 1,
		farOpacity: atEndEdge ? 1 : 0,
	};
};
