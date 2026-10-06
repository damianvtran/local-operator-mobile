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
	| { kind: "list"; ordered: boolean; items: string[] }
	| { kind: "quote"; text: string }
	| { kind: "table"; header: string[]; rows: string[][] }
	| { kind: "paragraph"; text: string };

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
			const pattern = isOrdered ? ORDERED : BULLET;
			const items: string[] = [];
			while (index < lines.length) {
				const item = pattern.exec(lines[index] ?? "");
				if (!item) break;
				items.push(item[1] ?? "");
				index += 1;
			}
			blocks.push({ kind: "list", ordered: isOrdered, items });
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
};

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

/**
 * Split one line into styled spans.
 *
 * A deliberately small grammar, and a fixed point: text that matches nothing is a
 * plain span, so an unmatched `**` renders as itself rather than swallowing the
 * rest of the line — which is what a partial-`**` streamed frame would otherwise
 * do on every frame of a long answer.
 */
export const parseInline = (text: string): InlineSpan[] => {
	const spans: InlineSpan[] = [];
	for (const piece of text.split(INLINE)) {
		if (piece === undefined || piece.length === 0) continue;
		if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 1) {
			spans.push({
				text: piece.slice(1, -1),
				code: true,
				bold: false,
				italic: false,
			});
		} else if (
			piece.startsWith("**") &&
			piece.endsWith("**") &&
			piece.length > 3
		) {
			spans.push({
				text: piece.slice(2, -2),
				code: false,
				bold: true,
				italic: false,
			});
		} else if (
			piece.startsWith("*") &&
			piece.endsWith("*") &&
			piece.length > 2
		) {
			spans.push({
				text: piece.slice(1, -1),
				code: false,
				bold: false,
				italic: true,
			});
		} else {
			spans.push({ text: piece, code: false, bold: false, italic: false });
		}
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
 * The advance of one character at the cell face, in pt, at 100 % scale.
 *
 * ONE constant, pinned by `markdown.test.ts` rather than assumed: it is the
 * measured box advance of `mono-sm` in the shipped build (a code line of 28
 * characters spans ≈198pt of ink on the iphone-15 frame, and a sha256 hex digest
 * is exactly 64 characters and must stay whole — see the 64 cap below), NOT a
 * `0.6em` recomputed from the font size. Everything a table sizes is derived from
 * this number, so a font change that moves the advance moves the pricing with it
 * the moment this is re-measured.
 */
export const TABLE_MONO_ADVANCE_PT = 7.08;

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

/** The frame's border width in pt (`border-control`, 1pt). */
export const TABLE_BORDER_PT = 1;

const clampToken = (value: number): number =>
	Math.min(TABLE_TOKEN_CAP, Math.max(TABLE_TOKEN_FLOOR, value));

/** The longest whitespace-delimited run across one column's header and body
 *  cells, in characters. Split on runs of whitespace after escape resolution. */
const longestToken = (cells: string[]): number => {
	let longest = 0;
	for (const cell of cells) {
		for (const token of cell.split(WHITESPACE)) {
			if (token.length > longest) longest = token.length;
		}
	}
	return longest;
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
 * The arithmetic is the design pass's, verbatim:
 *
 *   minW(c)  = clamp(longestToken(c), 4, 64) * advance * scale
 *   share(c) = clamp(longestCellChars(c), 4, 64)
 *   naturalW = Σ minW(c) + (cols + 1) * border + cols * 2 * cellPaddingX
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
		minWidths.push(
			clampToken(longestToken(cells)) * TABLE_MONO_ADVANCE_PT * effectiveScale,
		);
		shares.push(clampToken(longestCell(cells)));
	}
	const naturalWidth =
		minWidths.reduce((sum, width) => sum + width, 0) +
		(columns + 1) * TABLE_BORDER_PT +
		columns * 2 * TABLE_CELL_PADDING_X_PT;
	return { minWidths, shares, naturalWidth };
}
