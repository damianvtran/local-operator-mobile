import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TRACE_GLYPH_BOX_CLASS } from "@/features/session/components/trace-rail";
import { pendingEchoBoxClass } from "@/features/session/pending-echo";
import {
	USER_BUBBLE_BOX_CLASS,
	USER_BUBBLE_FRAME_CLASS,
	userBubbleFill,
} from "@/features/session/user-bubble";
import { THEMES } from "@/ui/tokens.gen";

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
const EXPLICIT_FILL =
	/className=\{USER_BUBBLE_FRAME_CLASS\}\s*style=\{userBubbleFill\(active\)\}/;
/** A steer's image sits on the bubble too: the prop is unconditional. */
const ON_BUBBLE_ALWAYS = /\bonBubble\n/;
const GLYPH_BOX = /w-4 shrink-0 text-start font-mono text-mono-sm/g;
const TRACE_GLYPH_BOX_USE = /cx\(\s*TRACE_GLYPH_BOX_CLASS,/g;

const read = (file: string): string =>
	readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
/** JSX and code only: the comments name the retired classes on purpose. */
const code = (source: string): string =>
	source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

const ROW = code(read("./transcript-row.tsx"));
const BUBBLE = code(read("../user-bubble.ts"));
const PENDING = code(read("./pending-echo-row.tsx"));
const IMAGE = code(read("./transcript-image.tsx"));
const CARD = code(read("./imagegen-card.tsx"));

describe("the reader's own message (D3)", () => {
	it("is the relay's borderless box, filled with the solved bubble role", () => {
		expect(USER_BUBBLE_BOX_CLASS).toBe("rounded-md bg-user-bubble px-3 py-1.5");
		expect(ROW).toContain("className={USER_BUBBLE_FRAME_CLASS}");
	});

	/* The regression the operator reported on the iOS build (2026-11-09): the
	 *  bubble was filled with `surface`, a PANEL ground, which sits 1.06-1.14:1
	 *  off the canvas in every shipped theme (`message-surface`, another panel
	 *  ground, reaches 1.20:1), so with its edges gone the reader's turn had no
	 *  visible card. No panel ground may be the bubble's fill again; the fill's
	 *  contrast itself is asserted per theme in `ui/tokens.test.ts`. */
	it("is not filled with a panel ground", () => {
		for (const source of [ROW, BUBBLE])
			for (const ground of ["surface", "message-surface", "elevated", "sunken"])
				expect(source).not.toContain(`rounded-md bg-${ground} px-3`);
	});

	/* Design round 1, D1: on TestFlight 753 the box's padding applied and its
	 *  class fill did not paint. The fill must therefore not depend on the class
	 *  alone on native: the box carries an explicit `backgroundColor` read from
	 *  the active palette, equal to the role the class names. */
	it("sets an explicit native backgroundColor from the active palette", () => {
		expect(ROW).toMatch(EXPLICIT_FILL);
		expect(ROW).toContain("const { active } = useTheme();");
		for (const entry of THEMES)
			expect(userBubbleFill(entry)).toEqual({
				backgroundColor: entry.colors["user-bubble"],
			});
		/* Not a no-op: the fill is never the page itself. */
		for (const entry of THEMES)
			expect(userBubbleFill(entry).backgroundColor).not.toBe(
				entry.colors.canvas,
			);
	});

	/* Agent review round 1, M1: the in-flight copy of the same message takes the
	 *  settled box exactly, explicit fill included, so a send does not change
	 *  colour or lose an edge at handover. */
	it("is the same box while the message is in flight", () => {
		expect(pendingEchoBoxClass("prompt")).toBe(USER_BUBBLE_FRAME_CLASS);
		/* QA round 1, Q2: the frame is the settled box plus its cap and nothing
		 *  that moves the contents (an `items-end` here put a short text 181 pt
		 *  right of the settled row's, beside an image strip). */
		expect(USER_BUBBLE_FRAME_CLASS).toBe(
			`max-w-[85%] ${USER_BUBBLE_BOX_CLASS}`,
		);
		expect(USER_BUBBLE_FRAME_CLASS).not.toMatch(/\b(items|self|justify)-/);
		expect(pendingEchoBoxClass("prompt")).not.toContain("border");
		expect(PENDING).toContain("style={userBubbleFill(active)}");
	});

	/* Operator report, iOS 2026-11-11: a steer rendered as bare indented text.
	 *  It takes the prompt's box exactly, in flight and settled, so the parity
	 *  rule in `user-bubble.ts` holds for both ops (rendered proof:
	 *  `steer-bubble.test.tsx`). */
	it("gives a steer the same box as a prompt", () => {
		expect(pendingEchoBoxClass("steer")).toBe(pendingEchoBoxClass("prompt"));
		expect(ROW).not.toContain("isSteer={");
		expect(PENDING).not.toContain('echo.op === "steer"');
	});

	/* Design round 1, D2: `ink-dim` and `danger` are contracted on canvas, not
	 *  on `user-bubble`, so the pending caption sits after the box closes. */
	it("keeps the pending caption outside the bubble", () => {
		const box = PENDING.indexOf("className={pendingEchoBoxClass(echo.op)}");
		const close = PENDING.indexOf("</View>", box);
		const caption = PENDING.indexOf("{caption}");
		expect(box).toBeGreaterThan(-1);
		expect(caption).toBeGreaterThan(close);
		expect(PENDING.slice(box, close)).not.toContain("text-ink-dim");
	});

	/* Agent review round 1, m1: inside the bubble an image's `hairline` frame
	 *  measured ~1.01:1 in the light themes; it steps up to `hairline-strong`
	 *  there, and only there. */
	it("frames an attached image with the strong hairline on the bubble", () => {
		expect(ROW).toMatch(ON_BUBBLE_ALWAYS);
		// Source-level: `transcript-image.tsx` reaches `expo-image`, which Node
		// cannot load (see this file's header).
		expect(IMAGE).toContain(
			'onBubble ? "border-hairline-strong" : "border-hairline"',
		);
		expect(IMAGE).toContain("onBubble = false");
		expect(IMAGE).toContain("imageFrameBorderClass(onBubble)");
		const lum = (hex: string): number => {
			const [r, g, b] = [1, 3, 5].map((i) => {
				const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
				return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
		};
		const ratio = (a: string, b: string): number => {
			const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
			return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
		};
		const gain = THEMES.map(
			(e) =>
				ratio(e.colors["hairline-strong"], e.colors["user-bubble"]) -
				ratio(e.colors.hairline, e.colors["user-bubble"]),
		);
		// Never weaker than the hairline it replaces, in any palette.
		for (const g of gain) expect(g).toBeGreaterThanOrEqual(0);
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
		/* The recipe now lives once, in the shared rail (`trace-rail.ts`), and
		 *  every glyph box in this file — notice, Team Bridge receipt and the
		 *  participant row — names it rather than respelling it. */
		expect(TRACE_GLYPH_BOX_CLASS).toBe(
			"w-4 shrink-0 text-start font-mono text-mono-sm",
		);
		expect(ROW.match(GLYPH_BOX) ?? []).toHaveLength(0);
		expect(ROW.match(TRACE_GLYPH_BOX_USE) ?? []).toHaveLength(3);
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
