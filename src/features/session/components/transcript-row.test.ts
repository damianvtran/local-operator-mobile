import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The transcript row's borderless shapes (visual audit D3, D9, D10).
 *
 * SOURCE checks, for the reason `tool-row.test.ts` gives: these components
 * reach `uniwind`, which the Node test environment cannot render, and what
 * must not come back here is a class — the hairline box and green start rule
 * on the reader's bubble, the green rule on a peer or hub message, a notice
 * glyph sized to its own advance. The rendered proof is the design round's
 * frames; these stop the classes returning silently.
 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/.*$/gm;
const START_RULE = /border-s-\d/;
const ATTRIBUTION =
	/\{kind === "peer" \? "↔" : "↳"\}\s*<\/Text>\s*<Text\s+className="min-w-0 shrink text-meta text-ink-dim"/;
const CORE_IMAGE_IMPORT = /import \{[^}]*\bImage\b[^}]*\} from "react-native"/;
const INITIAL_STATE_FROM_CACHE =
	/useState<Shown>\(\(\) => \(\{\s*image: transcriptImages\.peek\(load, entryId, index\),/;
const LOAD_THROUGH_CACHE = /transcriptImages\s*\.load\(load, entryId, index\)/;
const GLYPH_BOX = /w-4 shrink-0 text-start font-mono text-mono-sm/g;

const read = (file: string): string =>
	readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
/** JSX and code only: the comments name the retired classes on purpose. */
const code = (source: string): string =>
	source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

const ROW = code(read("./transcript-row.tsx"));
const IMAGE = code(read("./transcript-image.tsx"));
const CARD = code(read("./imagegen-card.tsx"));

describe("the reader's own message (D3)", () => {
	it("is the relay's borderless fill", () => {
		expect(ROW).toContain('"rounded-md bg-surface px-3 py-1.5"');
		expect(ROW).toContain('"max-w-[85%]"');
	});

	it("carries no hairline box and no accent rule", () => {
		expect(ROW).not.toContain("border-s-accent");
		expect(ROW).not.toContain("border border-hairline");
	});
});

describe("peer, hub and parent messages (D9)", () => {
	it("draw no start rule anywhere in the row", () => {
		expect(ROW).not.toMatch(START_RULE);
		expect(ROW).not.toContain("border-accent");
	});

	it("put every row glyph in the same fixed mono box", () => {
		/* Two boxes in this file — the notice's and the participant row's —
		 *  and both are the tool row's and the folded row's recipe, so every
		 *  glyph in the transcript stands on one rail. */
		const boxes = ROW.match(GLYPH_BOX);
		expect(boxes ?? []).toHaveLength(2);
		// The notice glyph is no longer sized to its own advance.
		expect(ROW).not.toContain('cx("text-mono-sm", ink)');
	});

	it("keeps the participant's glyph and label as the attribution", () => {
		expect(ROW).toMatch(ATTRIBUTION);
	});
});

describe("attached and generated images (D10, P1)", () => {
	it("renders through expo-image, contained, from the shared cache", () => {
		expect(IMAGE).toContain('import { Image } from "expo-image";');
		expect(IMAGE).toContain('contentFit="contain"');
		expect(IMAGE).not.toContain('resizeMode: "cover"');
		expect(IMAGE).not.toMatch(CORE_IMAGE_IMPORT);
	});

	it("starts a mount from the cache, so a remount paints without a skeleton", () => {
		/* The initial state IS the cached image. The cache's own behaviour —
		 *  synchronous hit, no second request — is `image-cache.test.ts`. */
		expect(IMAGE).toMatch(INITIAL_STATE_FROM_CACHE);
		expect(IMAGE).toMatch(LOAD_THROUGH_CACHE);
	});

	it("sizes the frame from the shared 160 pt rule in every state", () => {
		expect(IMAGE).toContain("imageFrameSize(view.image?.aspectRatio ?? null)");
		expect(IMAGE).not.toContain("THUMB_PX");
		// The loading bar fills the frame: h-40 is 40 × the 4 px unit.
		expect(IMAGE).toContain('const LOADING_BAR_CLASS = "h-40";');
	});

	it("draws the generating frame at the size the finished image lands in", () => {
		expect(CARD).toContain("const FRAME_SIDE_PT = IMAGE_FRAME_HEIGHT_PT;");
		expect(CARD).toContain(
			"style={{ height: FRAME_SIDE_PT, width: FRAME_SIDE_PT }}",
		);
	});
});
