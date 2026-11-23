import type { Block } from "@/features/session/markdown";

/**
 * Which fenced blocks become diagrams, and how a drawn diagram is sized.
 *
 * Pure and free of `react-native` so Node tests can pin both rules.
 */

/** A block draws as a diagram only when it is a CLOSED ```mermaid fence.
 *
 *  Closed, because the transcript re-renders on every streamed frame: an open
 *  fence holds half a diagram, which Pele would either refuse (a flash of error
 *  text) or draw wrongly (a flowchart that grows an edge per token). Until the
 *  closing fence arrives the block stays the plain code listing it always was,
 *  and the diagram replaces it once, when it is whole — the desktop UI's rule. */
export const isDiagramBlock = (
	block: Extract<Block, { kind: "code" }>,
): boolean =>
	block.unterminated !== true && block.language.toLowerCase() === "mermaid";

/** Below this the labels stop being readable on a phone: Pele's smallest labels
 *  (edge labels, notes) are 12 pt at full size, so 0.85 keeps them near 10 pt and
 *  node text near 12 pt. A diagram wider than the column at this scale scrolls
 *  sideways, and the viewer (`diagram-viewer.tsx`) zooms it, instead of
 *  shrinking further. (0.7 was the first value; the design round measured
 *  8.4 pt labels at it, on diagrams as ordinary as a six-participant sequence.) */
export const MIN_DIAGRAM_SCALE = 0.85;

/** The most a diagram may cover once drawn, in square points, and the longest
 *  side. `react-native-svg` draws a view as ONE native surface: on Android that
 *  is a bitmap of the view's size (`SvgView.java` `Bitmap.createBitmap`, read in
 *  react-native-svg 15.15.4), and a surface of tens of thousands of points
 *  cannot be allocated or drawn. Pele accepts a 50,000-character source and
 *  turns a few hundred nodes into a 137 x 55,768 pt picture, so the limit is
 *  ours to set. 1.5 M pt² is 13.5 M px at 3x (54 MB), well under the ~100 MB
 *  draw limit; 5,000 pt is 15,000 px at 3x, under the 16,384 px texture side
 *  of current devices. A 60-node tree (1,268,616 pt² at 0.85) and a 50-node chain
 *  (about 4,600 pt tall) fit; a 60-node chain (5,548 pt) and a 100-node chain do not. Measured on Pele 1.13.0 at
 *  `maxWidth` 340; NOT yet confirmed on a device. */
export const MAX_DRAWN_AREA_PT = 1_500_000;
export const MAX_DRAWN_SIDE_PT = 5_000;

/** Whether a diagram of this natural size can be drawn at all, judged at the
 *  scale the inline view will ACTUALLY use in a column `inner` wide
 *  (`diagramLayout`): 1 for a diagram that fits, down to the floor for a wide
 *  one. Judging at the floor would pass a narrow, tall diagram that is then
 *  drawn at 1 (measured: a 62-node chain, 78 x 5,827 pt). */
export const withinDrawBudget = (
	size: { width: number; height: number },
	inner: number,
): boolean => {
	if (!(size.width > 0) || !(size.height > 0)) return false;
	const scale = Math.max(MIN_DIAGRAM_SCALE, Math.min(1, inner / size.width));
	const w = size.width * scale;
	const h = size.height * scale;
	return (
		Number.isFinite(w) &&
		Number.isFinite(h) &&
		w <= MAX_DRAWN_SIDE_PT &&
		h <= MAX_DRAWN_SIDE_PT &&
		w * h <= MAX_DRAWN_AREA_PT
	);
};

/** How the full-screen viewer sizes a drawing in a window: as large as fits the
 *  window's width (never above 3x, so a tiny chart is not a poster), never below
 *  full size (a wide diagram opens at its natural 12-14 pt labels and pans — the
 *  inline view already shows it at the floor, so anything smaller would add
 *  nothing, and Android and web have no pinch), and never past the draw budget. */
export const viewerScale = (
	size: { width: number; height: number },
	windowWidth: number,
): number => {
	const fit =
		Math.max(1, windowWidth - 2 * DIAGRAM_FRAME_PAD - 16) / size.width;
	let scale = Math.min(3, Math.max(1, fit));
	const budget = Math.sqrt(MAX_DRAWN_AREA_PT / (size.width * size.height));
	scale = Math.min(
		scale,
		budget,
		MAX_DRAWN_SIDE_PT / Math.max(size.width, size.height),
	);
	return Math.max(0.1, scale);
};

export type DiagramLayout = {
	scale: number;
	width: number;
	height: number;
	/** The drawing is wider than the column and scrolls horizontally. */
	scrolls: boolean;
};

/** Fit a `width` x `height` diagram to a column `available` points wide:
 *  full size when it fits, otherwise shrunk to the column down to the floor,
 *  otherwise at the floor and scrolling. Never enlarged — a three-node chart at
 *  3x is a poster, not a figure. */
export const diagramLayout = (
	size: { width: number; height: number },
	available: number,
): DiagramLayout => {
	const room = Math.max(1, available);
	const fit = Math.min(1, room / size.width);
	const scale = Math.max(MIN_DIAGRAM_SCALE, fit);
	const width = size.width * scale;
	return {
		scale,
		width,
		height: size.height * scale,
		scrolls: width > room + 0.5,
	};
};

/** Padding inside a diagram's frame, each side, in points. */
export const DIAGRAM_FRAME_PAD = 8;

/** The width the drawing may use inside a frame in a column `column` wide: the
 *  column less both paddings and the 1 pt border each side. */
export const diagramInnerWidth = (column: number): number =>
	Math.max(1, column - 2 * DIAGRAM_FRAME_PAD - 2);
