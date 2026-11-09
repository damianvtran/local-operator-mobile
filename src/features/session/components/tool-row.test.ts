import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const CENTRED = /\btext-center\b/;
/** The two wiring lines R7 and Q1 depend on. Their pure decisions are tested in
 *  `bridge-row.test.ts`; the one-line wiring had no guard but the audit frames. */
const GLYPH_CALL = /const glyphOverride = bridgeGlyphFor\(bridge\);/;
/** The tool name's className, read off its `{entry.tool_name}` text (D8). */
const TOOL_NAME_CLASSES =
	/className="([^"]+)"\s*numberOfLines=\{1\}\s*>\s*\{entry\.tool_name\}/;
/** A flat CSS rule and a `font-family` declaration in the compiled theme. */
const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g;
const FONT_FAMILY = /font-family:\s*([^;]+);/g;
const WHITESPACE = /\s+/;
/** D4: the row's container, and the fills it must never gate on a state. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/.*$/gm;
const ROW_CONTAINER =
	/<View className="([^"]+)" testID=\{testID\}>\s*<Pressable/;
const STATE_GATED_FILL = /tool_state === "[a-z]+"[\s\S]{0,80}"bg-/;
const CARD_STATE_FILL = /liveTone\) && "bg-/;
const PULSING_GLYPH =
	/<Shimmer active=\{tone\.pulsing\} className="w-4 shrink-0">\s*<Text[\s\S]*?\{tone\.glyph\}/;
const CHIP_GATE = /chipLayout === "words" ?/;
/** R17: the layout's scale argument must reach it from the provider, not default. */
const CHIP_SCALE =
	/bridgeChipLayout\(\s*rowWidthPt,\s*chipWord,\s*mark !== null,\s*effectiveScale,\s*\)/;

/**
 * SOURCE CHECK, not a render (the Node test environment has no render seam for a
 * `uniwind` component): the tool row's delivery glyph is left-aligned with its label
 * rail, so a label that wraps puts line 2 on the same rail as line 1. It was
 * `text-center`, which put line 2 at -2.6 pt on the real app at 150 % (CI audit U-41,
 * 18 rows on `S5/send-delivery`). The discriminating proof is the audit's U-41 rows on
 * that state, which are what the PR's evidence and CI carry; this test only stops the
 * class returning silently.
 */
describe("tool row rail", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./tool-row.tsx", import.meta.url)),
		"utf8",
	);

	it("does not centre the delivery glyph's text", () => {
		expect(source).not.toMatch(CENTRED);
	});
});

/**
 * R11 — the component's WIRING, which is where R7 and Q1 can silently come back.
 *
 * Both defects lived on one line: re-gating the glyph on the copy
 * (`bridgeOutcome === null ? null : bridgeGlyphFor(bridge)`) restores R7 exactly,
 * and dropping the `chipLayout === "words"` gate re-opens Q1's ellipsis. The pure
 * functions stayed green through both mutations (round-3 review, executed), so
 * these source assertions are the only cheap guard that does not need a render.
 */
describe("tool row bridge wiring", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./tool-row.tsx", import.meta.url)),
		"utf8",
	);

	it("asks the glyph decision with the row alone, never gated on copy", () => {
		expect(source).toMatch(GLYPH_CALL);
		expect(source).not.toMatch(/bridgeGlyphFor\(bridge, bridgeCopy\)/);
	});

	it("paints the chip only when the layout says the phrase fits", () => {
		expect(source).toMatch(CHIP_GATE);
	});

	it("passes the live text scale into the chip layout (R17)", () => {
		/* Dropping the fourth argument silently pins every frame to 100 % while the
		 *  function's scale arm stays green in the unit tests (round-3 review, R17). */
		expect(source).toMatch(CHIP_SCALE);
	});
});

/**
 * The tool NAME's face, checked against the COMPILED theme rather than the
 * class string (round 2, D8 / Q8) — and since visual audit D13 the face it must
 * resolve to is SANS: the relay's tool line is one 13 px sans step for the name
 * and the summary, and the phone's mono name read as a second typeface on every
 * trace line. The expected value below changed from `var(--font-mono)` to
 * `var(--font-sans)` with that decision; the check itself is not weaker — it
 * still compiles the real theme and still carries its negative control.
 *
 * Why compiled: every type step's utility sets its own `font-family`
 * (`src/ui/theme.css`, one rule per step from `tokens.json`'s `face`), so a
 * `font-mono` beside a sans step is decided by emit order, and a className can
 * read as one face while the browser paints the other. So this compiles the
 * real theme with the repo's own tailwindcss (4.3.3,
 * the compiler uniwind drives), builds exactly the name's classes, and takes the
 * LAST `font-family` among their rules — same layer, same specificity, so the
 * last emitted wins, as in the browser. `uniwind.css` is loaded for its custom
 * variants (`@variant light` needs them); the `@source` globs are inert because
 * `build` is handed the candidate list.
 */
describe("tool row name face (D8 / Q8)", () => {
	const here = fileURLToPath(new URL(".", import.meta.url));
	const root = join(here, "../../../..");
	const require = createRequire(join(root, "package.json"));

	const compiledFamily = async (classes: string[]): Promise<string | null> => {
		const theme = readFileSync(join(root, "src/ui/theme.css"), "utf8");
		const compiler = await compile(theme, {
			base: join(root, "src/ui"),
			loadStylesheet: async (id: string, base: string) => {
				const path =
					id === "tailwindcss"
						? require.resolve("tailwindcss/index.css")
						: id === "uniwind"
							? join(
									dirname(require.resolve("uniwind/package.json")),
									"uniwind.css",
								)
							: join(base, id);
				return {
					path,
					base: dirname(path),
					content: readFileSync(path, "utf8"),
				};
			},
		});
		const css = compiler.build(classes);
		const wanted = new Set(classes.map((name) => `.${name}`));
		let family: string | null = null;
		/* Flat rules only: every utility here is `.<class> { ... }`, and nested
		 *  at-rule wrappers (`@layer`) open their own brace before the selector. */
		for (const match of css.matchAll(CSS_RULE)) {
			if (!wanted.has((match[1] ?? "").trim())) continue;
			for (const declaration of (match[2] ?? "").matchAll(FONT_FAMILY))
				family = (declaration[1] ?? "").trim();
		}
		return family;
	};

	const nameClasses = (): string[] => {
		const source = readFileSync(join(here, "tool-row.tsx"), "utf8");
		const name = source.match(TOOL_NAME_CLASSES);
		expect(name).not.toBeNull();
		return (name?.[1] ?? "").split(WHITESPACE);
	};

	it("compiles the pre-fix pair to sans (the harness can see the defect)", async () => {
		/* The negative control: if this ever reads mono, the check below proves
		 *  nothing about emit order. */
		expect(await compiledFamily(["font-mono", "text-trace"])).toBe(
			"var(--font-sans)",
		);
	});

	it("can tell the two faces apart (the old name's step compiles to mono)", async () => {
		/* The second control, for the direction D13 moved in: the step the name
		 *  USED to take must still read mono here, or a sans answer below would
		 *  be all this harness can say. */
		expect(await compiledFamily(["text-mono", "text-ink-muted"])).toBe(
			"var(--font-mono)",
		);
	});

	it("resolves the tool name's own classes to the sans family at the trace step", async () => {
		const classes = nameClasses();
		expect(await compiledFamily(classes)).toBe("var(--font-sans)");
		// 13 / 1.5, the relay's `--text-body-sm`. NOT this kit's `text-body-sm`,
		// which is 14 and would put the name a point above its own summary.
		expect(classes).toContain("text-trace");
		expect(classes).not.toContain("text-body-sm");
		expect(classes).not.toContain("font-mono");
	});
});

/**
 * Visual audit D4 — a tool row is a borderless single line in EVERY state.
 *
 * Running, queued and composing rows wore `bg-elevated` and failed rows
 * `bg-danger-wash`, measured as full-width 358 × 44 cards that stacked. State
 * is the glyph's ink plus a pulse on the running glyph. SOURCE checks, like the
 * rail's above: the Node environment has no render seam for a `uniwind`
 * component, and what must not return is a class.
 */
describe("tool row has no state fill (D4)", () => {
	const read = (file: string): string =>
		readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
	/** JSX only: the header comments name the old classes on purpose. */
	const jsx = (source: string): string =>
		source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

	it("paints no background on the row, whatever its state", () => {
		const row = jsx(read("./tool-row.tsx"));
		const container = row.match(ROW_CONTAINER);
		expect(container, "the row's own container").not.toBeNull();
		expect(container?.[1]).toBe("rounded-sm px-2");
		expect(row).not.toMatch(STATE_GATED_FILL);
		expect(row).not.toContain("bg-danger-wash");
	});

	it("gives the image-generation card the same borderless container", () => {
		const card = jsx(read("./imagegen-card.tsx"));
		expect(card).toContain(
			'<View className="rounded-sm px-2" testID={testID}>',
		);
		expect(card).not.toContain("bg-danger-wash");
		expect(card).not.toMatch(CARD_STATE_FILL);
	});

	it("pulses the glyph of a running row, and only that", () => {
		const row = jsx(read("./tool-row.tsx"));
		/* `pulsing` is true for `running` alone (`toolGlyph`, held by
		 *  `projection.test.ts`), and `Shimmer` starts no loop when inactive. */
		expect(row).toMatch(PULSING_GLYPH);
	});
});
