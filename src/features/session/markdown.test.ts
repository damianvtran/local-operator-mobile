import { describe, expect, it } from "vitest";

import {
	hasTableBlock,
	parseMarkdown,
	splitTableRow,
	TABLE_MONO_ADVANCE_PT,
	TABLE_SANS_ADVANCE_PT,
	TABLE_TOKEN_CAP,
	tablePricing,
} from "@/features/session/markdown";

/**
 * The markdown grammar, at the seams the transcript actually hits.
 *
 * Two kinds of case live here, and they exist for different reasons:
 *
 *  - the TABLE grammar's edges (a malformed run must stay verbatim source, an
 *    escape must resolve, an over-long row must not silently drop cells), because
 *    the renderer's stated principle is that an unrecognised construct is ugly and
 *    HONEST — a half-recognised table that quietly shortened an answer is worse
 *    than one that renders as pipes;
 *  - a STREAMED frame's partials (the divider half-typed, a row mid-cell), because
 *    the transcript re-parses on every frame and a grammar that only works on
 *    settled text would flicker the reader's answer while it arrives.
 */

const blocksOf = (text: string) => parseMarkdown(text);

describe("the table block grammar", () => {
	it("parses a header, a divider and body rows into a table", () => {
		const blocks = blocksOf(
			"| instance | outcome | ms |\n| --- | --- | --- |\n| 1 | ok | 41 |\n| 2 | ok | 38 |",
		);
		expect(blocks).toEqual([
			{
				kind: "table",
				header: ["instance", "outcome", "ms"],
				rows: [
					["1", "ok", "41"],
					["2", "ok", "38"],
				],
			},
		]);
	});

	it("is a table whether or not the edges carry a fence", () => {
		const fenced = blocksOf("| a | b |\n| --- | --- |\n| 1 | 2 |");
		const bare = blocksOf("a | b\n--- | ---\n1 | 2");
		expect(fenced[0]).toEqual({
			kind: "table",
			header: ["a", "b"],
			rows: [["1", "2"]],
		});
		expect(fenced[0]).toEqual(bare[0]);
	});

	it("renders a malformed divider as verbatim source, never as a table", () => {
		// The divider's cells fail the `:?-{1,}:?` test: `oops` is not a divider. The
		// run must stay a paragraph of its own source — a half-recognised table that
		// dropped a row would shorten the model's answer with no trace.
		const text = "| a | b |\n| -- | oops |\n| 1 | 2 |";
		const blocks = blocksOf(text);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.kind).toBe("paragraph");
		expect((blocks[0] as { text: string }).text).toBe(text);
	});

	it("requires the divider's cell count to equal the header's", () => {
		const blocks = blocksOf("| a | b |\n| --- |");
		expect(blocks[0]?.kind).toBe("paragraph");
	});

	it("has no table when no divider follows", () => {
		const blocks = blocksOf("| a | b |\n| 1 | 2 |");
		expect(blocks[0]?.kind).toBe("paragraph");
	});

	it("resolves escaped pipes at parse time", () => {
		// `\|` inside a cell is CONTENT, not a separator, and the renderer must
		// never see the escape: the U-38 check asserts no rendered text node
		// carries `\|`.
		const blocks = blocksOf("| a \\| b | c |\n| --- | --- |\n| x | y |");
		expect(blocks[0]).toEqual({
			kind: "table",
			header: ["a | b", "c"],
			rows: [["x", "y"]],
		});
	});

	it("keeps a pipe inside a code span inside its cell", () => {
		const cells = splitTableRow("| `a|b` | c |");
		expect(cells).toEqual(["`a|b`", "c"]);
	});

	it("makes `||` an empty cell, but never an empty edge cell", () => {
		expect(splitTableRow("| a || b |")).toEqual(["a", "", "b"]);
		expect(splitTableRow("| a | b |")).toEqual(["a", "b"]);
		expect(splitTableRow("a | b")).toEqual(["a", "b"]);
	});

	it("keeps an over-long row's extra cells on the last column", () => {
		// GFM drops cells beyond the header's count; this implementation must keep
		// them, because dropping is exactly the silent shortening the file forbids.
		const blocks = blocksOf("| a | b |\n| --- | --- |\n| 1 | 2 | 3 |");
		expect(blocks[0]).toEqual({
			kind: "table",
			header: ["a", "b"],
			rows: [["1", "2 3"]],
		});
	});

	it("pads a short row with empty cells", () => {
		const blocks = blocksOf("| a | b |\n| --- | --- |\n| 1 |");
		expect(blocks[0]).toEqual({
			kind: "table",
			header: ["a", "b"],
			rows: [["1", ""]],
		});
	});

	it("stops body rows at a blank line, a fence, or a line without a pipe", () => {
		const blocks = blocksOf(
			"| a | b |\n| --- | --- |\n| 1 | 2 |\n\npara\n\n```\ncode\n```",
		);
		expect(blocks.map((block) => block.kind)).toEqual([
			"table",
			"paragraph",
			"code",
		]);
		expect(blocks[0]).toEqual({
			kind: "table",
			header: ["a", "b"],
			rows: [["1", "2"]],
		});
	});

	it("takes a table that opens mid-paragraph out of the paragraph", () => {
		// Without the lookahead in the paragraph loop the pipe lines under a
		// sentence would be eaten into it and never reach the table branch — the
		// exact "renders as its own source" defect D1 names.
		const blocks = blocksOf(
			"And the summary:\n\n| instance | outcome | ms |\n| --- | --- | --- |\n| 1 | ok | 41 |",
		);
		expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "table"]);
	});

	it("leaves a document with no table entirely alone", () => {
		const text = "No pipes here.\n\nJust two paragraphs.\n\n- and a list item";
		const blocks = blocksOf(text);
		expect(blocks.some((block) => block.kind === "table")).toBe(false);
		expect(hasTableBlock(text)).toBe(false);
	});

	it("does not read a table out of a fenced code block", () => {
		const text = "```\n| a | b |\n| --- | --- |\n```";
		expect(hasTableBlock(text)).toBe(false);
	});

	it("affirms the marker for both the fixture's flavours", () => {
		expect(
			hasTableBlock(
				"| instance | outcome | ms |\n| --- | --- | --- |\n| 1 | ok | 41 |",
			),
		).toBe(true);
		expect(
			hasTableBlock("| key | value |\n| --- | --- |\n| plan | pro |"),
		).toBe(true);
	});
});

describe("streamed frames", () => {
	it("keeps a half-typed divider as source until it completes", () => {
		// Frame 1 of a streamed table: the header is out and the divider has only
		// its first cell so far. Counting it as a table would render a header with
		// no columns beneath it; the honest frame is the source. (A single dash IS a
		// legal divider cell — `-{1,}` — so the incomplete frame here is a COUNT
		// mismatch, which is the shape a stream actually produces.)
		const frame = "Working…\n\n| a | b |\n| ---";
		const blocks = blocksOf(frame);
		expect(blocks.some((block) => block.kind === "table")).toBe(false);
	});

	it("switches to a table the frame the divider completes", () => {
		const before = "| a | b |\n| ---";
		const after = "| a | b |\n| --- | --- |\n| 1 | o";
		expect(blocksOf(before).some((block) => block.kind === "table")).toBe(
			false,
		);
		const block = blocksOf(after)[0];
		expect(block).toEqual({
			kind: "table",
			header: ["a", "b"],
			rows: [["1", "o"]],
		});
	});

	it("renders a mid-arrival cell as the text that has arrived", () => {
		// A partial cell is not padded or truncated: the honest render of a frame
		// in flight is the frame's own text.
		const block = blocksOf("| a | b |\n| --- | --- |\n| 1 | ok |\n| 2 | o")[0];
		expect(block).toEqual({
			kind: "table",
			header: ["a", "b"],
			rows: [
				["1", "ok"],
				["2", "o"],
			],
		});
	});

	it("grows rows one frame at a time without surfacing the divider", () => {
		const frames = [
			"| digest | status |\n",
			"| digest | status |\n| --- | --- |\n",
			"| digest | status |\n| --- | --- |\n| abc | ok |\n",
		].map(blocksOf);
		// The first frame is source (no divider yet); every later frame is a table
		// whose rows only ever gain entries — never lose them.
		expect(frames[0]?.some((block) => block.kind === "table")).toBe(false);
		expect(frames[1]?.[0]?.kind).toBe("table");
		expect(frames[2]?.[0]).toEqual({
			kind: "table",
			header: ["digest", "status"],
			rows: [["abc", "ok"]],
		});
	});
});

describe("column pricing", () => {
	it("pins both advances to their DOM measurements", () => {
		// The measured basis is the live DOM on the shipped web build: an
		// 11-character `mono-sm` run spans exactly 79.2pt of box at 100 % →
		// 7.2pt/char (also 0.6em × 12pt), and a 20-`m` `body-sm` run spans
		// 240pt → 12.0pt/char, the widest glyph of the regular face. The pin
		// exists so a font or size change cannot move a price silently — 64
		// characters must stay whole (sha256-hex), and a column priced below
		// its tokens' advance wraps a token that must not.
		expect(TABLE_MONO_ADVANCE_PT).toBeCloseTo(79.2 / 11, 5);
		expect(TABLE_SANS_ADVANCE_PT).toBeCloseTo(240 / 20, 5);
		expect(TABLE_SANS_ADVANCE_PT).toBeGreaterThan(TABLE_MONO_ADVANCE_PT);
		// The design pass's 28-character code line spans ≈198.33pt of INK, which
		// divides to 7.08 — and pricing at that under-sizes every mono column.
		// The assertion is the guard that the mono constant never regresses to
		// the ink division: a 64-character sha256 column priced at 7.08
		// shortfalls by 7.7pt, exactly one mono glyph.
		expect(TABLE_MONO_ADVANCE_PT).toBeGreaterThan(198.33 / 28);
		expect(TABLE_TOKEN_CAP).toBe(64);
	});

	it("prices a column from its longest whitespace-delimited run, at its face", () => {
		const pricing = tablePricing(
			["key", "value"],
			[
				["plan", "pro"],
				["digest", "abcdef0123456789"],
			],
			1,
		);
		// Both columns' longest runs render on the SANS face (no code spans),
		// so both are priced at the sans bound: 6 and 16 characters.
		expect(pricing.minWidths[0]).toBeCloseTo(6 * TABLE_SANS_ADVANCE_PT, 2);
		expect(pricing.minWidths[1]).toBeCloseTo(16 * TABLE_SANS_ADVANCE_PT, 2);
		// naturalW = Σ minW + (cols+1) borders + cols * 2 * 12 padding.
		expect(pricing.naturalWidth).toBeCloseTo(
			(6 + 16) * TABLE_SANS_ADVANCE_PT + 3 + 48,
			2,
		);
	});

	it("prices a code-span token on the mono face, the cell's own text on sans", () => {
		// The same token length in the two faces: 16 characters cost 16 × mono
		// in a code span and 16 × sans as plain text, and a column takes the
		// wider of its tokens. This is the split U-39 forced: the single-advance
		// rule broke the header `outcome` at 200 %, and pricing sans tokens at
		// the mono advance under-sized every proportional column the same way.
		const code = tablePricing(
			["k", "digest"],
			[["x", "`abcdef0123456789`"]],
			1,
		);
		expect(code.minWidths[1]).toBeCloseTo(16 * TABLE_MONO_ADVANCE_PT, 2);
		const plain = tablePricing(["k", "digest"], [["x", "abcdef0123456789"]], 1);
		expect(plain.minWidths[1]).toBeCloseTo(16 * TABLE_SANS_ADVANCE_PT, 2);
		const mixed = tablePricing(["k", "v"], [["x", "plain `code` word"]], 1);
		// Widest run of `plain `code` word`: `plain` (5 sans = 60) beats `code`
		// (4 mono = 28.8) and `word` (4 sans = 48).
		expect(mixed.minWidths[1]).toBeCloseTo(5 * TABLE_SANS_ADVANCE_PT, 2);
	});

	it("counts a token's glyphs, not its backticks or escaped pipes", () => {
		const escaped = tablePricing(["k", "v"], [["x", "a\\|b"]], 1);
		// `a\|b` renders as `a|b` — the backslash is not drawn, so the run is 3,
		// under the clamp floor of 4.
		expect(escaped.minWidths[1]).toBeCloseTo(4 * TABLE_SANS_ADVANCE_PT, 2);
		const code = tablePricing(["k", "v"], [["x", "`abcdefgh`"]], 1);
		// 8 mono glyphs (57.6) out-price the header's one sans glyph (the clamp
		// floor, 48), so the mono advance is what the column took.
		expect(code.minWidths[1]).toBeCloseTo(8 * TABLE_MONO_ADVANCE_PT, 2);
	});

	it("clamps a token at both ends", () => {
		const short = tablePricing(["a", "b"], [], 1);
		expect(short.minWidths[0]).toBeCloseTo(4 * TABLE_SANS_ADVANCE_PT, 2);
		const giant = "f".repeat(96);
		const long = tablePricing(["k", "digest"], [["x", giant]], 1);
		expect(long.minWidths[1]).toBeCloseTo(64 * TABLE_SANS_ADVANCE_PT, 2);
	});

	it("scales every column by the text-scale factor", () => {
		const at100 = tablePricing(["instance", "ms"], [], 1);
		const at200 = tablePricing(["instance", "ms"], [], 2);
		const [min100 = 0, ms100 = 0] = at100.minWidths;
		const [min200 = 0, ms200 = 0] = at200.minWidths;
		expect(min200).toBeCloseTo(min100 * 2, 4);
		expect(ms200).toBeCloseTo(ms100 * 2, 4);
		expect(at200.naturalWidth).not.toBeCloseTo(at100.naturalWidth, 0);
	});
});
