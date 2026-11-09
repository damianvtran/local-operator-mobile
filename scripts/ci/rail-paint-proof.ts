/**
 * The checkpoint rail's PAINT, measured on a native screenshot.
 *
 * WHY THIS EXISTS. PR #196 closed the rail at the component level: the drawn
 * tree per state, 14 mutation-proved tests. What it could not prove is the only
 * thing the operator asked for — that the marks actually appear on the phone
 * while a reader flings, and that the `building` state is visibly different from
 * `deep`. Neither claim is reachable from the web harness, and the web harness is
 * this repository's only visual lane: `src/features/session/transcript-presence.ts`
 * records why (`react-native-web` 0.21 emits only `onScroll`, never a drag or
 * momentum event, so every offset reads as a scroll the app made and the rail is
 * never summoned). On web the rail is a component that cannot paint. On Android
 * it can, so Android is where the claim is settled.
 *
 * WHAT IT MEASURES. One region: the rail's own column. `checkpoint-rail.tsx`
 * places it at `end: RAIL_EDGE_PT` (7 pt) with `width: RAIL_COLUMN_PT` (8 pt),
 * so it occupies 7–15 pt of the right edge, inside the transcript's 16 pt side
 * padding — which is the property that makes this measurement honest: nothing
 * else in the app draws in that band, so a non-background pixel in it is a mark
 * (or the building state's liveness dash), not transcript content that moved.
 * The band is derived from the device's OWN `wm size` and `wm density`, passed
 * in by the capture script, never assumed from a device profile.
 *
 * WHAT IT DOES NOT MEASURE. Whether an 8 pt glyph is legible, and whether the
 * column clears iOS's scroll indicator. Those are a designer's reading of the
 * same frames; this file only counts ink.
 *
 * THE TWO CLAIMS, AND WHY ONLY ONE OF THEM IS A GATE YET. The capture's latency
 * (how long one `adb exec-out screencap` takes) and its per-state pixel counts
 * had no prior distribution in this repository before run 42546977251 — the
 * first run measured 240 frames over two scenario worlds, so the shape is now
 * known but still a single sample. Gating a number one run has seen is how a
 * nightly becomes a coin flip, so this file GATES the two structural claims (the
 * rail paints during a fast fling; `building` paints the head mark `deep` does
 * not) and only REPORTS latency and counts until two independent runs agree.
 *
 * THE DIFFERENCE CLAIM IS A CLAIM ABOUT ONE MARK, so it is checked as one. "The
 * two band contents differ" is satisfied by a single stray pixel anywhere in the
 * column, which is not a fact about the `building` state; the shape the component
 * actually adds is a 6 × 2.5 pt liveness dash at the head of the track
 * (`checkpoint-rail.tsx`), 18 px at 1×. So the claim requires three things: a
 * difference of at least one whole row of that dash (`HEAD_MARK_WIDTH_PT` scaled
 * by the device density, with `MIN_INK_PX` as the lower bound at small scales — it
 * was `MIN_INK_PX` alone until two runs measured 18 px in the same rows twice),
 * that difference being *only* extra ink in `building` localised to the head-mark
 * rows, and those rows being derived from the first tick's row measured in the
 * same capture rather than from a device profile (review round 1, M1 and QA Q3).
 *
 * THE CLOCK AND THE PIXELS ARE SEPARATE EVIDENCE. A frame whose recorded capture
 * duration is negative was timed by a clock that stepped, so its duration is not
 * a measurement — but its PIXELS are unaffected, and the pixel claims are the
 * gated ones. Negative-duration frames are therefore excluded from the latency
 * block alone, the exclusion is recorded in the report with the count and the
 * reason, and a run with no usable duration reports latency as unavailable rather
 * than failing or printing a number (review round 1, M4).
 *
 * Reading the report: `state.*.up` is the inkiest frame captured while the fling
 * flow was running, `state.*.down` the inkest captured with no gesture at all.
 * Counts are per threshold (max per-channel delta from the band's modal colour),
 * because a fixed threshold on a 0.55-opacity mark over an unknown background is
 * an assumption; the sweep shows the claim does not depend on which one is read.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** The rail's column geometry, mirrored from `checkpoint-rail.tsx`. Two
 *  constants, and the mirror is checked: the bands asserted in
 *  `rail-paint-proof.test.ts` are the same numbers a 320×640 mdpi AVD yields. */
export const RAIL_EDGE_PT = 7;
export const RAIL_COLUMN_PT = 8;

/** The fraction of the frame's height dropped at each end. The transcript's edge
 *  fades are 24 pt gradients pinned to the top and bottom of the list
 *  (`transcript-presence.ts`'s `TRANSCRIPT_FADE_PT`), they span the full width,
 *  and they would put faded transcript content inside the band. 10 % of a 640 pt
 *  frame is 64 pt — more than twice the fade and its ramp — and leaves 80 % of
 *  the track, which is where the marks are. */
export const BAND_ROW_INSET = 0.1;

/** The thresholds the sweep reports, as max per-channel deltas from the band's
 *  modal colour. */
export const COUNT_THRESHOLDS = [1, 4, 8, 16, 32] as const;

/** The threshold the GATED claims read. A `screencap` frame is unfiltered
 *  framebuffer bytes, so the background is byte-identical across a static band
 *  and even 1 would separate ink from it; 8 leaves room for a dithered or
 *  gradient background nobody has looked at yet while sitting far below the
 *  contrast of a 0.55-opacity mark (`RAIL_PEAK_OPACITY`). */
export const GATE_THRESHOLD = 8;

/** The smallest thing the rail can paint: the compact dash is 3 pt × 1 pt
 *  (`DASH_SIZE`), which at the smallest density scale Android ships (1.0) is
 *  3 px. So a rail-up frame that does not beat its rail-down frame by 3 px has
 *  not painted one whole mark. */
export const MIN_INK_PX = 3;

/** The head mark's own geometry, mirrored from `checkpoint-rail.tsx` for the same
 *  reason the column above is: the analyser runs under bare Node and must not
 *  import a React Native module to learn four numbers. `HEAD_Y_PT` is the mark's
 *  centre offset from the track's top and the box is 2.5 pt tall, so it spans
 *  4.75–7.25 pt; `end: 0` right-aligns it in the column, which the band already
 *  is. The mirror is checked in `rail-paint-proof.test.ts` against the rows a
 *  320×640 mdpi AVD yields.
 *
 *  `RAIL_INSET_PT` is `checkpoint-rail.ts`'s own export, mirrored for the same
 *  reason: the first seq-placed mark starts there, so the head mark's rows are
 *  ANCHORED to the first tick the capture actually paints instead of to the
 *  transcript's absolute top — which the component does not know and this file
 *  cannot measure. */
export const HEAD_Y_PT = 6;
export const HEAD_MARK_HEIGHT_PT = 2.5;
/** The dash box's width. One full row of it is the smallest thing `building`
 *  alone can paint, which is what promotes the difference claim's floor from
 *  `MIN_INK_PX` (a compact mark's 3 pt length) to this state's own mark now that
 *  two independent runs have measured it (18 px twice, identical). */
export const HEAD_MARK_WIDTH_PT = 6;
export const RAIL_INSET_PT = 10;

/** One row of slack each side of the derived head-mark window. The anchor is a
 *  measured row and the offset is a fractional layout constant, so the true box
 *  can land a row either way at a non-integral scale — and a window that excludes
 *  the mark it expects would red a paint that happened. */
export const HEAD_ROW_SLACK_PX = 1;

const PNG_SIGNATURE = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type DecodedPng = {
	width: number;
	height: number;
	/** 1 (grey), 3 (RGB) or 4 (RGBA). `adb exec-out screencap -p` emits RGBA. */
	channels: 1 | 3 | 4;
	/** Unfiltered scanlines, top to bottom, `width * channels` bytes each. */
	pixels: Uint8Array;
};

const CHANNELS_BY_COLOUR_TYPE: Record<number, 1 | 3 | 4> = {
	0: 1,
	2: 3,
	4: 4,
	6: 4,
};

/**
 * A PNG decoder for exactly what this lane produces, and nothing else.
 *
 * WHY HAND-ROLLED. The repository declares no image library and this lane must
 * not add one: the decoder needs 8-bit non-interlaced truecolour, which is what
 * `screencap` and `screenrecord`-derived frames emit. Writing it here keeps the
 * measurement testable in vitest on a machine with no emulator, which is the
 * whole reason the arithmetic lives in this file rather than in the shell
 * script.
 *
 * WHAT IT REFUSES. 16-bit depth, palette (3) and grey+alpha (4) images, and
 * interlaced images — each with a message naming the field, because a decoder
 * that silently mis-reads a frame would report a pixel count that means nothing.
 *
 * CRC-32 is NOT verified: a corrupt chunk cannot survive `inflateSync` plus the
 * length/IEND bounds below, and a CRC check would only re-detect the same bytes.
 */
export function decodePng(bytes: Uint8Array, label = "png"): DecodedPng {
	if (bytes.length < 8) throw new Error(`${label}: too short to be a PNG`);
	for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
		if (bytes[i] !== PNG_SIGNATURE[i]) {
			throw new Error(`${label}: bad PNG signature`);
		}
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 8;
	let width = 0;
	let height = 0;
	let channels: 1 | 3 | 4 = 4;
	let sawHeader = false;
	let sawEnd = false;
	const idat: Uint8Array[] = [];

	while (offset + 8 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(
			bytes[offset + 4] ?? 0,
			bytes[offset + 5] ?? 0,
			bytes[offset + 6] ?? 0,
			bytes[offset + 7] ?? 0,
		);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (dataEnd + 4 > bytes.length) {
			throw new Error(`${label}: chunk ${type} runs past the end of the file`);
		}
		if (type === "IHDR") {
			if (length < 13) throw new Error(`${label}: short IHDR`);
			width = view.getUint32(dataStart);
			height = view.getUint32(dataStart + 4);
			const depth = bytes[dataStart + 8];
			const colourType = bytes[dataStart + 9] ?? -1;
			const interlace = bytes[dataStart + 12];
			if (depth !== 8) {
				throw new Error(`${label}: bit depth ${String(depth)} is not 8`);
			}
			if (interlace !== 0) {
				throw new Error(`${label}: interlaced PNGs are not supported`);
			}
			const mapped = CHANNELS_BY_COLOUR_TYPE[colourType];
			if (mapped === undefined) {
				throw new Error(
					`${label}: colour type ${String(colourType)} is not supported`,
				);
			}
			// Grey+alpha carries an alpha the ink count would have to composite
			// against, and no producer in this lane emits it.
			if (colourType === 4) {
				throw new Error(`${label}: grey+alpha pixels are not supported`);
			}
			channels = mapped;
			sawHeader = true;
		} else if (type === "IDAT") {
			idat.push(bytes.subarray(dataStart, dataEnd));
		} else if (type === "IEND") {
			sawEnd = true;
			break;
		}
		offset = dataEnd + 4;
	}

	if (!sawHeader) throw new Error(`${label}: no IHDR`);
	if (!sawEnd) throw new Error(`${label}: truncated (no IEND)`);
	if (width <= 0 || height <= 0) {
		throw new Error(`${label}: ${width}x${height} is not a usable frame`);
	}
	if (idat.length === 0) throw new Error(`${label}: no IDAT`);

	const stride = width * channels;
	const expected = height * (stride + 1);
	const filtered = inflateSync(Buffer.concat(idat));
	if (filtered.length !== expected) {
		throw new Error(
			`${label}: inflated ${filtered.length} bytes, expected ${expected}`,
		);
	}
	return {
		width,
		height,
		channels,
		pixels: unfilter(filtered, height, stride, channels),
	};
}

const PAETH = (a: number, b: number, c: number): number => {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
};

/** The five PNG scanline filters, into one contiguous pixel buffer.
 *
 *  `bpp` is the byte distance between the same channel in adjacent pixels — the
 *  image's channel count — and is what filter 1 (Sub) and filter 4 (Paeth)
 *  reach back by. Filters 3 and 4 average and predict from the already-
 *  RECONSTRUCTED left and up bytes, not the filtered ones, so `out` is read as it
 *  is written rather than buffered a row at a time. */
function unfilter(
	filtered: Uint8Array,
	height: number,
	stride: number,
	bpp: number,
): Uint8Array {
	const out = new Uint8Array(height * stride);
	let pos = 0;
	for (let y = 0; y < height; y += 1) {
		const filter = filtered[pos] ?? 0;
		pos += 1;
		const row = y * stride;
		const previousRow = row - stride;
		for (let i = 0; i < stride; i += 1) {
			const raw = filtered[pos] ?? 0;
			pos += 1;
			const left = i >= bpp ? (out[row + i - bpp] ?? 0) : 0;
			const up = y > 0 ? (out[previousRow + i] ?? 0) : 0;
			const upLeft = y > 0 && i >= bpp ? (out[previousRow + i - bpp] ?? 0) : 0;
			let value: number;
			switch (filter) {
				case 0:
					value = raw;
					break;
				case 1:
					value = raw + left;
					break;
				case 2:
					value = raw + up;
					break;
				case 3:
					value = raw + ((left + up) >> 1);
					break;
				case 4:
					value = raw + PAETH(left, up, upLeft);
					break;
				default:
					throw new Error(`scanline ${y}: unknown filter ${filter}`);
			}
			out[row + i] = value & 0xff;
		}
	}
	return out;
}

export type RailBand = { x0: number; x1: number; y0: number; y1: number };

/**
 * The band, in device pixels, from the device's own geometry.
 *
 * `densityScale` is `wm density / 160`, which is the `pt → px` factor Android
 * reports for the running emulator. The edges round OUTWARD (floor the outer
 * edge, ceil the inner one) so a mark whose rounded layout lands on a fractional
 * pixel boundary still counts; at an integral scale — the AVD this runs on — the
 * band is exactly the rail's own 8 pt and no wider.
 *
 * AND NO WIDER, deliberately. The transcript's 16 pt (`px-4`) side padding puts
 * its rightmost pixel column at `width - 16·scale`; a band padded by even one
 * pixel past that would count message text as rail ink and turn the whole
 * measurement into a claim about scrolling rather than painting.
 */
export function railBand(
	width: number,
	height: number,
	densityScale: number,
): RailBand {
	const outer = Math.floor((RAIL_EDGE_PT + RAIL_COLUMN_PT) * densityScale);
	const inner = Math.ceil(RAIL_EDGE_PT * densityScale);
	const y0 = Math.round(height * BAND_ROW_INSET);
	return {
		x0: Math.max(0, width - outer),
		x1: Math.min(width, width - inner),
		y0,
		y1: height - y0,
	};
}

export type BandInk = {
	/** The band's most common colour — the background a mark has to differ
	 *  from. Exact bytes, so `counts` is a statement about paint, not noise. */
	modal: [number, number, number];
	/** Pixels whose max per-channel delta from `modal` exceeds each threshold,
	 *  keyed by the threshold. */
	counts: Record<string, number>;
	/** Pixels examined; a band that is not the expected size is a bug upstream. */
	total: number;
};

/** Count ink in one band: `counts[t]` is how many pixels differ from the band's
 *  modal colour by more than `t` on some channel. */
export function countBandInk(
	png: DecodedPng,
	band: RailBand,
	thresholds: readonly number[] = COUNT_THRESHOLDS,
): BandInk {
	const { channels, pixels } = png;
	const histogram = new Map<number, number>();
	const region: Array<[number, number, number]> = [];
	for (let y = band.y0; y < band.y1; y += 1) {
		let index = (y * png.width + band.x0) * channels;
		for (let x = band.x0; x < band.x1; x += 1) {
			let r: number;
			let g: number;
			let b: number;
			if (channels === 1) {
				r = pixels[index] ?? 0;
				g = r;
				b = r;
			} else {
				r = pixels[index] ?? 0;
				g = pixels[index + 1] ?? 0;
				b = pixels[index + 2] ?? 0;
			}
			region.push([r, g, b]);
			const key = (r << 16) | (g << 8) | b;
			histogram.set(key, (histogram.get(key) ?? 0) + 1);
			index += channels;
		}
	}
	let modalKey = 0;
	let modalCount = -1;
	for (const [key, count] of histogram) {
		if (count > modalCount) {
			modalKey = key;
			modalCount = count;
		}
	}
	const modal: [number, number, number] = [
		(modalKey >> 16) & 0xff,
		(modalKey >> 8) & 0xff,
		modalKey & 0xff,
	];
	const counts: Record<string, number> = {};
	for (const threshold of thresholds) counts[String(threshold)] = 0;
	for (const [r, g, b] of region) {
		const delta = Math.max(
			Math.abs(r - modal[0]),
			Math.abs(g - modal[1]),
			Math.abs(b - modal[2]),
		);
		for (const threshold of thresholds) {
			// `noUncheckedIndexedAccess`: a Record lookup is possibly-undefined even
			// after the seeding loop above, so every write defends.
			if (delta > threshold) {
				const key = String(threshold);
				counts[key] = (counts[key] ?? 0) + 1;
			}
		}
	}
	return { modal, counts, total: region.length };
}

export type BandInkMask = {
	/** Band-relative width, `x1 - x0`. */
	width: number;
	/** Band-relative height, `y1 - y0`. */
	height: number;
	/** One byte per band pixel: 1 where the pixel is ink at `threshold`, 0 where
	 *  it is not. Indexed `row * width + col`, both band-relative. */
	cells: Uint8Array;
};

/** The same count as `countBandInk`, keeping WHERE the ink is.
 *
 * WHY A SECOND PASS RATHER THAN A BIGGER BANDINK. Only the two frames in the
 * difference claim need their ink located (the arithmetic needs every frame's
 * counts, and 240 masks of a 4 096-pixel band is memory nothing reads), and the
 * `modal` is passed in so a mask is measured against exactly the background its
 * own count was. Two frames measured against two different modals would make a set
 * difference a statement about backgrounds rather than about paint. */
export function bandInkMask(
	png: DecodedPng,
	band: RailBand,
	threshold: number,
	modal: readonly [number, number, number],
): BandInkMask {
	const width = band.x1 - band.x0;
	const height = band.y1 - band.y0;
	const cells = new Uint8Array(width * height);
	const { channels, pixels } = png;
	for (let row = 0; row < height; row += 1) {
		const y = band.y0 + row;
		for (let col = 0; col < width; col += 1) {
			const index = (y * png.width + band.x0 + col) * channels;
			const r = pixels[index] ?? 0;
			const g = channels === 1 ? r : (pixels[index + 1] ?? 0);
			const b = channels === 1 ? r : (pixels[index + 2] ?? 0);
			const delta = Math.max(
				Math.abs(r - (modal[0] ?? 0)),
				Math.abs(g - (modal[1] ?? 0)),
				Math.abs(b - (modal[2] ?? 0)),
			);
			if (delta > threshold) cells[row * width + col] = 1;
		}
	}
	return { width, height, cells };
}

/** The rows the head mark occupies, in absolute frame rows, from the first
 *  seq-placed tick's row in the same capture: the dash sits
 *  `RAIL_INSET_PT - (HEAD_Y_PT ± HEAD_MARK_HEIGHT_PT / 2)` above it. */
export function headMarkRows(
	firstTickRow: number,
	densityScale: number,
): { y0: number; y1: number } {
	const dashTopPt = HEAD_Y_PT - HEAD_MARK_HEIGHT_PT / 2;
	const dashBottomPt = HEAD_Y_PT + HEAD_MARK_HEIGHT_PT / 2;
	return {
		y0:
			Math.floor(firstTickRow - (RAIL_INSET_PT - dashTopPt) * densityScale) -
			HEAD_ROW_SLACK_PX,
		y1:
			Math.ceil(firstTickRow - (RAIL_INSET_PT - dashBottomPt) * densityScale) +
			HEAD_ROW_SLACK_PX,
	};
}

export type HeadMarkCheck = {
	/** Pixels inked in `building` and not in `deep` — the mark building adds. */
	pixels: number;
	/** Their row span, absolute frame rows, or null when there are none. */
	rows: [number, number] | null;
	/** The rows the head mark may occupy, from the first tick `deep` paints. */
	expectedRows: [number, number] | null;
	/** The first row `deep` inks — the anchor the head mark is placed by. */
	firstTickRow: number | null;
	/** Pixels inked in `deep` and not in `building`. Reported, never gated: the
	 *  two states are separate captures, so a tick row that landed on a different
	 *  pixel between them is a sampling fact, not a mark that went missing. */
	missingPixels: number;
	/** Every extra pixel is inside the head-mark rows. */
	localised: boolean;
};

/** Where `building`'s ink is that `deep`'s is not, and whether it is the head
 *  mark. The gated difference claim reads `localised`; the counts are printed so
 *  a reader can see how far off a failing run was. */
export function headMarkCheck(
	deep: BandInkMask,
	building: BandInkMask,
	band: RailBand,
	densityScale: number,
): HeadMarkCheck {
	let pixels = 0;
	let missingPixels = 0;
	let firstRow = Number.POSITIVE_INFINITY;
	let lastRow = -1;
	let firstTickRow: number | null = null;
	const rows = Math.min(deep.height, building.height);
	const cols = Math.min(deep.width, building.width);
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) {
			const index = row * deep.width + col;
			const inDeep = deep.cells[index] === 1;
			const inBuilding = building.cells[index] === 1;
			if (inDeep && firstTickRow === null) firstTickRow = band.y0 + row;
			if (inBuilding && !inDeep) {
				pixels += 1;
				const absolute = band.y0 + row;
				if (absolute < firstRow) firstRow = absolute;
				if (absolute > lastRow) lastRow = absolute;
			}
			if (inDeep && !inBuilding) missingPixels += 1;
		}
	}
	const extraRows: [number, number] | null =
		pixels === 0 ? null : [firstRow, lastRow];
	const expected =
		firstTickRow === null ? null : headMarkRows(firstTickRow, densityScale);
	const expectedRows: [number, number] | null =
		expected === null ? null : [expected.y0, expected.y1];
	const localised =
		extraRows !== null &&
		expectedRows !== null &&
		extraRows[0] >= expectedRows[0] &&
		extraRows[1] <= expectedRows[1];
	return {
		pixels,
		rows: extraRows,
		expectedRows,
		firstTickRow,
		missingPixels,
		localised,
	};
}

/** One line of the capture script's JSONL: the device geometry, once. */
export type ScreenRecord = {
	type: "screen";
	widthPx: number;
	heightPx: number;
	densityDpi: number;
};

/** A phase is the capture script's own claim about what the device was doing:
 *  `pre` is a settled list no gesture has touched, `fling` is while the fast
 *  swipe flow ran, `post` is after it finished. */
export type FramePhase = "pre" | "fling" | "post";

export type FrameRecord = {
	type: "frame";
	/** The mock relay scenario the app was talking to (`checkpoints-deep`…). */
	state: string;
	phase: FramePhase;
	path: string;
	/** Capture start, ms since the epoch — the only cross-phase clock. */
	atMs: number;
	/** Wall time of the `adb exec-out screencap` itself, ms. */
	captureMs: number;
};

export type CapturedFrame = FrameRecord & BandInk;

export type StateReport = {
	/** The inkest frame captured DURING the fling. */
	up: CapturedFrame;
	/** The inkest frame captured with no gesture — the rail-down control. */
	down: CapturedFrame;
	frames: number;
	/** Gated: the rail painted while flinging. */
	railPaints: boolean;
	/** Reported: the up frame's count minus the down frame's, at the gate
	 *  threshold. */
	inkDelta: number;
};

export type RailPaintReport = {
	schema: "rail-paint-proof/2";
	band: RailBand | null;
	geometry: ScreenRecord | null;
	/** Reported, never gated until two runs agree (see the header). `null` when
	 *  no frame in the run carried a usable duration — which is NOT a pass and is
	 *  said so in the formatted report. */
	latency: LatencyReport | null;
	/** The frames whose recorded duration was negative, or `null` when the clock
	 *  held. Excluded from `latency` only; they stay in every pixel figure. */
	clockSteps: ClockSteps | null;
	states: Record<string, StateReport>;
	claims: {
		/** Gated: every state paints the rail during a fast fling. */
		railPaints: boolean;
		/** Gated: `building` paints the head mark `deep` does not — a difference of
		 *  at least `MIN_INK_PX`, localised to the head-mark rows. */
		buildingDiffersFromDeep: boolean;
		/** Reported: `building`'s up count minus `deep`'s. Positive is what the
		 *  component's own shape predicts — building draws the same marks plus a
		 *  liveness dash — but the two states are separate captures, so a larger
		 *  magnitude means the fixture tick sets differ, not that the mark grew. */
		buildingMinusDeep: number;
		/** Reported: where the extra ink is, against where the head mark can be. */
		buildingExtra: HeadMarkCheck;
	};
	verdict: "pass" | "fail";
};

export type LatencyReport = {
	/** Usable durations only — see `excludedFrames`. */
	n: number;
	minMs: number;
	medianMs: number;
	maxMs: number;
	/** Frames dropped from THIS block because their duration was negative. */
	excludedFrames: number;
};

export type ClockSteps = {
	count: number;
	/** The first few offending durations, so a reader can see the shape of it. */
	sample: number[];
};

const inkAt = (frame: CapturedFrame): number =>
	frame.counts[String(GATE_THRESHOLD)] ?? 0;

/** `building` is the state this comparison is about; `deep` is its control. */
export const DEEP_STATE = "checkpoints-deep";
export const BUILDING_STATE = "checkpoints-building";

const median = (values: readonly number[]): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
	return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

/** Group the JSONL's records, decode every frame, and decide the two claims. */
export function analyseFrames(
	records: readonly (ScreenRecord | FrameRecord)[],
	readFrame: (path: string) => Uint8Array = (path) =>
		new Uint8Array(readFileSync(path)),
): RailPaintReport {
	const geometry =
		records.find(
			(record): record is ScreenRecord => record.type === "screen",
		) ?? null;
	const frames = records.filter(
		(record): record is FrameRecord => record.type === "frame",
	);
	if (geometry === null || frames.length === 0) {
		throw new Error("the capture wrote no geometry or no frames");
	}
	const densityScale = geometry.densityDpi / 160;
	const band = railBand(geometry.widthPx, geometry.heightPx, densityScale);

	const captured: CapturedFrame[] = frames.map((frame) => {
		const png = decodePng(readFrame(frame.path), frame.path);
		if (png.width !== geometry.widthPx || png.height !== geometry.heightPx) {
			throw new Error(
				`${frame.path}: ${png.width}x${png.height} does not match the reported ${geometry.widthPx}x${geometry.heightPx}`,
			);
		}
		return { ...frame, ...countBandInk(png, band) };
	});

	const states: Record<string, StateReport> = {};
	for (const state of [...new Set(captured.map((frame) => frame.state))]) {
		const own = captured.filter((frame) => frame.state === state);
		const inkest = (phase: FramePhase): CapturedFrame | null => {
			let best: CapturedFrame | null = null;
			for (const frame of own) {
				if (frame.phase !== phase) continue;
				if (best === null || inkAt(frame) > inkAt(best)) best = frame;
			}
			return best;
		};
		const up = inkest("fling");
		const down = inkest("pre");
		/* BOTH PHASES ARE REQUIRED, AND A MISSING ONE IS NOT A DEGRADED COMPARISON —
		 * it is no comparison. `inkAt(null)` used to read 0, so a state whose `pre`
		 * frames were lost gated at "≥ 3 px anywhere in the column" instead of
		 * "≥ 3 px above its own control", and nothing said so. The capture writes ~10
		 * `pre` frames per world today; this is the check that keeps that true
		 * rather than assumed (review round 1, M2). */
		if (up === null || down === null) {
			throw new Error(
				`${state}: no ${up === null ? "fling" : "pre"} frame in ${own.length} captured frame(s) — the rail-up frame and its rail-down control are both required`,
			);
		}
		states[state] = {
			up,
			down,
			frames: own.length,
			railPaints: inkAt(up) >= inkAt(down) + MIN_INK_PX,
			inkDelta: inkAt(up) - inkAt(down),
		};
	}

	const deep = states[DEEP_STATE];
	const building = states[BUILDING_STATE];
	if (deep === undefined || building === undefined) {
		throw new Error(
			`the capture must cover both ${DEEP_STATE} and ${BUILDING_STATE}; saw ${Object.keys(states).join(", ") || "none"}`,
		);
	}
	const railPaints = Object.values(states).every((state) => state.railPaints);
	const buildingMinusDeep = inkAt(building.up) - inkAt(deep.up);
	/* THE DIFFERENCE HAS TO BE THE MARK, NOT ANY DIFFERENCE AT ALL. A net count
	 * that is not zero proves the two band contents are not byte-identical; the
	 * +18 the component's shape predicts is a fact about WHERE those pixels are.
	 * So the claim reads both the magnitude floor and the localisation, and the
	 * pair is reported either way — a failing run should say which half failed
	 * (review round 1, M1; QA Q3). */
	const maskOf = (frame: CapturedFrame): BandInkMask =>
		bandInkMask(
			decodePng(readFrame(frame.path), frame.path),
			band,
			GATE_THRESHOLD,
			frame.modal,
		);
	const buildingExtra = headMarkCheck(
		maskOf(deep.up),
		maskOf(building.up),
		band,
		densityScale,
	);
	/* THE FLOOR IS THE HEAD MARK'S OWN SIZE, NOT A MARK'S. `MIN_INK_PX` answers
	 * "is this more than noise" for the paint claim; for the difference claim the
	 * smallest honest amount is one whole row of the dash building adds, whose
	 * width the component states. Two independent runs (42546977251 at 2afef62a,
	 * 42557966264 at 8ed82692) measured building-only ink at 18 px in rows
	 * 135–137 both times, so this floor sits at half the observed value and a third
	 * of the dash — the report's numbers are gated where they agreed, and the
	 * `MIN_INK_PX` term keeps the smaller-density case from going below noise. */
	const headMarkRowPx = HEAD_MARK_WIDTH_PT * densityScale;
	const buildingDiffersFromDeep =
		Math.abs(buildingMinusDeep) >= Math.max(MIN_INK_PX, headMarkRowPx) &&
		buildingExtra.localised;

	/* A NEGATIVE DURATION IS A BROKEN CLOCK, NOT A FAST CAPTURE, and averaging it
	 * into the distribution is how a 175 ms median silently becomes nonsense. The
	 * capture script times with `/proc/uptime` precisely because the runner's wall
	 * clock steps (26 backward steps in 240 frames of run 42546977251); this is the
	 * check that proves the shortcut held.
	 *
	 * IT IS A FAULT IN THE TIMING, NOT IN THE FRAMES. The pixels of a frame whose
	 * duration went negative are exactly as good as any other frame's, and they are
	 * what the gated claims read — so the exclusion is scoped to the latency block,
	 * counted in the report with its reason, and it never fails the run. Throwing
	 * here made the analyser refuse its own prior artifact; reporting "no latency
	 * this run, the clock stepped" is the honest claim, and printing nothing would
	 * read as a pass (review round 1, M4; QA Q1). */
	const durations = frames.map((frame) => frame.captureMs);
	const stepped = durations.filter((ms) => ms < 0);
	const usable = durations.filter((ms) => ms >= 0);
	return {
		schema: "rail-paint-proof/2",
		band,
		geometry,
		latency:
			usable.length === 0
				? null
				: {
						n: usable.length,
						minMs: Math.min(...usable),
						medianMs: median(usable),
						maxMs: Math.max(...usable),
						excludedFrames: stepped.length,
					},
		clockSteps:
			stepped.length === 0
				? null
				: { count: stepped.length, sample: stepped.slice(0, 5) },
		states,
		claims: {
			railPaints,
			buildingDiffersFromDeep,
			buildingMinusDeep,
			buildingExtra,
		},
		verdict: railPaints && buildingDiffersFromDeep ? "pass" : "fail",
	};
}

/** The human-facing lines. Numbers first, verdict last: the numbers are the
 *  evidence and the verdict is only a summary of it. */
export function formatReport(report: RailPaintReport): string {
	const lines: string[] = [];
	const geometry = report.geometry;
	const band = report.band;
	if (geometry !== null && band !== null) {
		lines.push(
			`geometry: ${geometry.widthPx}x${geometry.heightPx} @ ${geometry.densityDpi} dpi (scale ${geometry.densityDpi / 160})`,
		);
		lines.push(
			`band: x ${band.x0}..${band.x1 - 1}, y ${band.y0}..${band.y1 - 1} (${band.x1 - band.x0} px wide)`,
		);
	}
	const latency = report.latency;
	const clock = report.clockSteps;
	if (clock !== null) {
		lines.push(
			`capture clock stepped: ${clock.count} frame(s) excluded from the latency block only (they stay in the pixel analysis) — first ${clock.sample.join(", ")} ms`,
		);
	}
	if (latency !== null) {
		lines.push(
			`screencap latency: n=${latency.n} (excluded ${latency.excludedFrames} stepped) min=${latency.minMs}ms median=${latency.medianMs}ms max=${latency.maxMs}ms`,
		);
	} else {
		// A MISSING NUMBER IS NOT A GOOD NUMBER. Say it unavailable and say why, so
		// a reader cannot mistake the absence for a pass on the timing claim.
		lines.push(
			`screencap latency: UNAVAILABLE this run — no frame carried a usable duration${clock === null ? "" : " (the capture clock stepped)"}; this is no measurement, not a pass`,
		);
	}
	for (const [state, report_] of Object.entries(report.states)) {
		lines.push(`${state}: ${report_.frames} frames`);
		for (const phase of ["down", "up"] as const) {
			const frame = report_[phase];
			const counts = COUNT_THRESHOLDS.map(
				(threshold) => `${threshold}:${frame.counts[String(threshold)] ?? 0}`,
			).join(" ");
			lines.push(
				`  ${phase} [t8 ${frame.counts[String(GATE_THRESHOLD)] ?? 0}] ${counts} ${frame.path}`,
			);
		}
		lines.push(`  ink delta (up - down): ${report_.inkDelta}`);
	}
	lines.push(`claim rail-paints-during-fling: ${report.claims.railPaints}`);
	const extra = report.claims.buildingExtra;
	const span = (rows: [number, number] | null): string =>
		rows === null ? "none" : `${rows[0]}..${rows[1]}`;
	lines.push(
		`claim building-differs-from-deep: ${report.claims.buildingDiffersFromDeep} (building - deep = ${report.claims.buildingMinusDeep})`,
	);
	lines.push(
		`  building-only ink: ${extra.pixels} px in rows ${span(extra.rows)}; head-mark window rows ${span(extra.expectedRows)} (anchored on the first tick at row ${extra.firstTickRow ?? "none"}); localised: ${extra.localised}`,
	);
	lines.push(
		`  deep-only ink (reported, not gated): ${extra.missingPixels} px`,
	);
	lines.push(`verdict: ${report.verdict}`);
	return lines.join("\n");
}

/** `node scripts/ci/rail-paint-proof.ts --frames <jsonl> --out <json>` */
function main(argv: readonly string[]): void {
	const readFlag = (name: string): string => {
		const index = argv.indexOf(name);
		const value = index === -1 ? undefined : argv[index + 1];
		if (value === undefined || value.startsWith("--")) {
			throw new Error(`missing ${name} <path>`);
		}
		return value;
	};
	const framesPath = readFlag("--frames");
	const records = readFileSync(framesPath, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as ScreenRecord | FrameRecord);
	const report = analyseFrames(records);
	console.log(formatReport(report));
	const outIndex = argv.indexOf("--out");
	const out = outIndex === -1 ? undefined : argv[outIndex + 1];
	if (out !== undefined) {
		writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
		console.log(`report: ${out}`);
	}
	if (report.verdict !== "pass") {
		console.error(
			"::error title=Checkpoint rail did not paint::a gated claim failed — see the numbers above",
		);
		process.exitCode = 1;
	}
}

if (process.argv[1]?.endsWith("rail-paint-proof.ts") === true) {
	main(process.argv.slice(2));
}
