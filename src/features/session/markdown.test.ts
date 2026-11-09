import { describe, expect, it, vi } from "vitest";

import {
	hasTableBlock,
	parseInline,
	parseMarkdown,
	splitTableRow,
	TABLE_MONO_ADVANCE_PT,
	TABLE_SANS_ADVANCE_PT,
	TABLE_TOKEN_CAP,
	tableFadeGeometry,
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

const INDEX_PROPERTY = /^\d+$/;

const blocksOf = (text: string) => parseMarkdown(text);

describe("literal inline streaming allocation bound", () => {
	// Constructor counts, not elapsed time: ordinary prose must allocate no
	// delimiter maps at any frame length. The positive control makes this fail
	// if instrumentation stops observing the indexed parser.
	const measured = (text: string) => {
		let maps = 0;
		const NativeMap = globalThis.Map;
		vi.stubGlobal(
			"Map",
			new Proxy(NativeMap, {
				construct(target, args) {
					maps += 1;
					return Reflect.construct(target, args);
				},
			}),
		);
		try {
			return { spans: parseInline(text), maps };
		} finally {
			vi.stubGlobal("Map", NativeMap);
		}
	};

	it("keeps growing prose and structured Unicode output to one span and zero index maps", () => {
		const shapes = [
			"The answer streams one ordinary sentence at a time. ",
			'Status: ready — 東京, café, مرحبا.\n  {"phase": 2, "ok": true}\nLatency (ms): 18.4; Δ: +0.2%; total: €42.\n',
		];
		for (const shape of shapes) {
			for (const repeats of [1, 64, 256]) {
				const text = shape.repeat(repeats);
				expect(measured(text)).toEqual({
					maps: 0,
					spans: [{ text, code: false, bold: false, italic: false }],
				});
			}
		}
		expect(measured("")).toEqual({ maps: 0, spans: [] });
	});

	it("never bypasses possible markup, escapes, URLs or partial streamed openers", () => {
		for (const suffix of [
			"`",
			"*",
			"_",
			"~",
			"[",
			"<",
			"\\",
			"http://",
			"HTTPS://",
			"**bold**",
			"_italic_",
			"~~strike~~",
			"`code`",
			"\\*literal\\*",
			"[label](https://example.com)",
			"<mailto:a@example.com>",
			"https://example.com/path",
			"prefixhttps://example.com",
		]) {
			expect(measured(`A growing answer ${suffix}`).maps).toBeGreaterThan(0);
		}
		// Same prefix, later frame: no cached literal decision may hide new markup.
		expect(parseInline("A growing answer **bold**").at(-1)).toMatchObject({
			text: "bold",
			bold: true,
		});
		expect(
			parseInline("A growing answer \\*literal\\*")
				.map((span) => span.text)
				.join(""),
		).toBe("A growing answer *literal*");
	});
});

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

describe("tableFadeGeometry (the scroll-cue fade, both directions)", () => {
	/* The gradient is painted left to right in physical coordinates, so the opaque
	 * stop has to agree with the side the band is pinned to. */
	it("ltr is the identity: end is the right edge, solid at the right", () => {
		expect(tableFadeGeometry("end", false)).toEqual({
			side: "right",
			nearOpacity: 0,
			farOpacity: 1,
		});
		expect(tableFadeGeometry("start", false)).toEqual({
			side: "left",
			nearOpacity: 1,
			farOpacity: 0,
		});
	});

	it("rtl swaps the sides, and the opaque stop moves with the band", () => {
		expect(tableFadeGeometry("end", true)).toEqual({
			side: "left",
			nearOpacity: 1,
			farOpacity: 0,
		});
		expect(tableFadeGeometry("start", true)).toEqual({
			side: "right",
			nearOpacity: 0,
			farOpacity: 1,
		});
	});

	it("never leaves the solid end on the opposite side to the band", () => {
		for (const rtl of [false, true]) {
			for (const edge of ["start", "end"] as const) {
				const g = tableFadeGeometry(edge, rtl);
				expect(g.side === "right" ? g.farOpacity : g.nearOpacity).toBe(1);
			}
		}
	});
});

describe("assistant inline links", () => {
	it.each([
		"[Reuters](https://www.reuters.com/world/)",
		"- [Reuters](https://www.reuters.com/world/)",
	])("renders the reported source %s as a link span", (source) => {
		const block = parseMarkdown(source)[0];
		const text =
			block?.kind === "list"
				? block.items[0]
				: block && "text" in block
					? block.text
					: "";
		expect(parseInline(text ?? "")).toEqual([
			{
				text: "Reuters",
				href: "https://www.reuters.com/world/",
				code: false,
				bold: false,
				italic: false,
			},
		]);
	});
});

describe("finite inline grammar", () => {
	it.each([
		[
			"[article](https://example.com/a_(b))",
			"article",
			"https://example.com/a_(b)",
		],
		[
			String.raw`[a\]b](https://example.com/a\(b\))`,
			"a]b",
			"https://example.com/a(b)",
		],
		['[title](https://example.com "A title")', "title", "https://example.com"],
		["[angle](<https://example.com/a>)", "angle", "https://example.com/a"],
		[
			"<https://example.com/a_(b)>",
			"https://example.com/a_(b)",
			"https://example.com/a_(b)",
		],
		[
			"https://example.com/a_(b).",
			"https://example.com/a_(b)",
			"https://example.com/a_(b)",
		],
		[
			"<mailto:hello@example.com>",
			"hello@example.com",
			"mailto:hello@example.com",
		],
	])(
		"recognizes %s without truncating the destination",
		(source, label, href) => {
			expect(parseInline(source)[0]).toMatchObject({ text: label, href });
		},
	);
	it("combines nested emphasis and links in either direction", () => {
		expect(parseInline("**[Reuters](https://example.com)**")[0]).toMatchObject({
			text: "Reuters",
			bold: true,
			href: "https://example.com",
		});
		expect(parseInline("[**Reuters** and *BBC*](https://example.com)")).toEqual(
			[
				{
					text: "Reuters",
					bold: true,
					italic: false,
					code: false,
					href: "https://example.com",
				},
				{
					text: " and ",
					bold: false,
					italic: false,
					code: false,
					href: "https://example.com",
				},
				{
					text: "BBC",
					bold: false,
					italic: true,
					code: false,
					href: "https://example.com",
				},
			],
		);
		expect(
			parseInline("***both*** __bold__ _italic_ ~~removed~~").filter((span) =>
				span.text.trim(),
			),
		).toMatchObject([
			{ text: "both", bold: true, italic: true },
			{ text: "bold", bold: true },
			{ text: "italic", italic: true },
			{ text: "removed", strike: true },
		]);
	});
	it.each([
		['https://example.com "literal `"', "https://example.com"],
		["https://example.com/`", "https://example.com/`"],
		['https://example.com "escaped \\" quote `"', "https://example.com"],
		['<https://example.com/`> "title `"', "https://example.com/`"],
	])("keeps destination/title ticks opaque in %s", (destination, href) => {
		const spans = parseInline(
			`[one](${destination}) [two](https://example.org) \`code\``,
		);
		expect(spans.filter((span) => span.href)).toMatchObject([
			{ text: "one", href },
			{ text: "two", href: "https://example.org" },
		]);
		expect(spans.at(-1)).toMatchObject({ text: "code", code: true });
	});
	it.each([
		'[broken](https://example.com "unterminated ` [two](https://example.org)',
		"[broken](https://example.com bad `) [two](https://example.org)",
	])("does not hide later links after invalid destination %s", (source) => {
		expect(
			parseInline(source).filter((span) => span.text === "two"),
		).toMatchObject([{ text: "two", href: "https://example.org" }]);
	});
	it("retains code precedence and later label emphasis around opaque titles", () => {
		expect(
			parseInline('`[one](https://example.com "title")`')[0],
		).toMatchObject({
			text: '[one](https://example.com "title")',
			code: true,
		});
		expect(
			parseInline(
				'[one](https://example.com "literal `") [*two*](https://example.org) `code`',
			),
		).toMatchObject([
			{ text: "one", href: "https://example.com" },
			{ text: " " },
			{ text: "two", italic: true, href: "https://example.org" },
			{ text: " " },
			{ text: "code", code: true },
		]);
	});
	it.each([
		"[".repeat(2048),
		`${"[x](".repeat(512)} bad${")".repeat(512)}`,
		'[one](https://example.com "literal `") [two](https://example.org) `code` '.repeat(
			512,
		),
		`${'[x](https://example.com "` '.repeat(512)}${")".repeat(512)}`,
	])("bounds failed delimiter scans by input length ($#)", (source) => {
		let reads = 0;
		// A boxed string preserves the public string operations while counting
		// actual character visits. No machine-load-dependent wall-clock gate.
		const counted = new Proxy(new String(source), {
			get(target, property) {
				if (typeof property === "string" && INDEX_PROPERTY.test(property))
					reads += 1;
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}) as unknown as string;
		expect(parseInline(counted)).toEqual(parseInline(source));
		expect(reads).toBeLessThan(source.length * 50);
	});
	it("does not repeatedly scan unactivatable URL prefixes inside prose", () => {
		const source = `a${"https://".repeat(512)}`;
		let scanned = 0;
		const original = RegExp.prototype.exec;
		const spy = vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (
			this: RegExp,
			value: string,
		) {
			const result = original.call(this, value);
			if (result?.[0]?.startsWith("https://")) scanned += result[0].length;
			return result;
		});
		try {
			expect(parseInline(source)).toEqual([
				{ text: source, code: false, bold: false, italic: false },
			]);
			expect(scanned).toBeLessThan(source.length * 2);
		} finally {
			spy.mockRestore();
		}
	});
	it("never recounts a shrinking URL's parentheses", () => {
		const source = `https://example.com/${")".repeat(2048)}`;
		let rescanned = 0;
		const original = String.prototype.match;
		const spy = vi
			.spyOn(String.prototype, "match")
			.mockImplementation(function (
				this: string,
				pattern: Parameters<typeof original>[0],
			) {
				rescanned += this.length;
				return original.call(this, pattern);
			});
		try {
			const spans = parseInline(source);
			expect(spans[0]?.href).toBe("https://example.com/");
			expect(spans.map((span) => span.text).join("")).toBe(source);
			expect(rescanned).toBeLessThan(source.length * 2);
		} finally {
			spy.mockRestore();
		}
	});
	it("retains all content in deeply nested labels without recursive calls", () => {
		const source = `${"[".repeat(12000)}label${"](https://example.com)".repeat(12000)}`;
		expect(
			parseInline(source)
				.map((span) => span.text)
				.join(""),
		).toBe("label");
	});
	it.each(["]", "["])(
		"ignores code %s when balancing link labels",
		(bracket) => {
			const spans = parseInline(`[a \`${bracket}\` b](https://example.com)`);
			expect(spans).toMatchObject([
				{ text: "a ", href: "https://example.com" },
				{ text: bracket, code: true, href: "https://example.com" },
				{ text: " b", href: "https://example.com" },
			]);
		},
	);
	it.each(["*italic **bold** italic*", "_italic __bold__ italic_"])(
		"retains nested emphasis in %s",
		(source) => {
			expect(parseInline(source)).toMatchObject([
				{ text: "italic ", italic: true, bold: false },
				{ text: "bold", italic: true, bold: true },
				{ text: " italic", italic: true, bold: false },
			]);
		},
	);
	it("closes nested styled label runs from the inside out", () => {
		expect(
			parseInline("[*Reuters **World***](https://example.com)"),
		).toMatchObject([
			{
				text: "Reuters ",
				italic: true,
				bold: false,
				href: "https://example.com",
			},
			{ text: "World", italic: true, bold: true, href: "https://example.com" },
		]);
	});
	it.each(["https://label.example", "<https://label.example>"])(
		"retains the explicit destination when label %s is also URL-shaped",
		(label) => {
			expect(
				parseInline(`[${label}](https://target.example)`)[0],
			).toMatchObject({
				text: "https://label.example",
				href: "https://target.example",
			});
		},
	);
	it("preserves the existing longer-backtick closer grammar", () => {
		expect(parseInline("``a ```")).toMatchObject([
			{ text: "a ", code: true },
			{ text: "`", code: false },
		]);
	});
	it("leaves code literal, even when it contains links and markup", () => {
		expect(parseInline("`[Reuters](https://example.com) **bold**`")).toEqual([
			{
				text: "[Reuters](https://example.com) **bold**",
				code: true,
				bold: false,
				italic: false,
			},
		]);
		expect(parseInline("``a ` b``")[0]).toMatchObject({
			text: "a ` b",
			code: true,
		});
	});
	it.each([
		"[Reuters]",
		"[Reuters](https://example.",
		"[Reuters](https://example.com/a_(b)",
		"**partial",
		"*partial",
		"`partial",
		"<script>alert(1)</script>",
		"identifier_name_value",
	])("keeps incomplete or unsupported source %s", (source) => {
		expect(
			parseInline(source)
				.map((span) => span.text)
				.join(""),
		).toBe(source);
	});
	it("retains every streaming prefix until the complete link can replace it", () => {
		const source = "[Reuters](https://www.reuters.com/world/)";
		for (let length = 0; length < source.length; length += 1)
			expect(
				parseInline(source.slice(0, length))
					.map((span) => span.text)
					.join(""),
			).toBe(source.slice(0, length));
	});
	it("preserves nested list indentation and mixed markers", () => {
		expect(parseMarkdown("- top\n  3. nested\n    - deeper")[0]).toEqual({
			kind: "list",
			ordered: false,
			items: ["top", "nested", "deeper"],
			indents: [0, 2, 4],
			markers: ["•", "3.", "•"],
		});
	});
});

describe("streamed formatting delimiters", () => {
	it.each([
		"**word**",
		"***word***",
		"__word__",
		"~~word~~",
		"`word`",
		"``word``",
	])("does not reinterpret an incomplete opening run in %s", (source) => {
		for (let length = 0; length < source.length; length += 1) {
			const prefix = source.slice(0, length);
			expect(
				parseInline(prefix)
					.map((span) => span.text)
					.join(""),
			).toBe(prefix);
		}
	});
});
