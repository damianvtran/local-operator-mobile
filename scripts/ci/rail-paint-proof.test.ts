/**
 * The rail-paint measurement's own proof.
 *
 * Everything here runs on a laptop with no emulator, which is the point of the
 * split: the arithmetic (a band's boundaries, a PNG's scanlines, two states'
 * ink) is testable against synthetic frames, and only the capture itself needs
 * Android. Each test names the failure it would otherwise let through — a
 * decoder that mis-reads a filter would report a pixel count that means nothing,
 * and a band one pixel too wide would count message text as rail ink.
 */

import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
	analyseFrames,
	BAND_ROW_INSET,
	BUILDING_STATE,
	COUNT_THRESHOLDS,
	countBandInk,
	DEEP_STATE,
	decodePng,
	type FramePhase,
	type FrameRecord,
	GATE_THRESHOLD,
	MIN_INK_PX,
	RAIL_COLUMN_PT,
	RAIL_EDGE_PT,
	railBand,
	type ScreenRecord,
} from "./rail-paint-proof";

const BACKGROUND: [number, number, number] = [12, 14, 18];
const MARK: [number, number, number] = [140, 146, 158];

/* Hoisted because biome's `useTopLevelRegex` wants literals out of call scopes;
 * the names say which refusal each one asserts. */
const BIT_DEPTH_REFUSAL = /sixteen: bit depth 16/;
const COLOUR_TYPE_REFUSAL = /palette: colour type 3/;
const INTERLACE_REFUSAL = /adam7: interlaced/;
const SHORT_FILE_REFUSAL = /stub: too short/;
const TRUNCATION_REFUSAL = /cut:/;
const COVERAGE_REFUSAL = /must cover both/;
const GEOMETRY_REFUSAL = /does not match the reported 320x640/;

/** CRC-32 is written as zero: `decodePng` does not verify it (the file's own
 *  header says why), and a real CRC would only re-detect bytes `inflateSync` and
 *  the chunk-length bounds already reject. */
const crc = Uint8Array.from([0, 0, 0, 0]);

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	out.set(crc, 8 + data.length);
	return out;
}

/**
 * A PNG of `pixels` (RGB triples, row-major), built by hand so a test can choose
 * the scanline filter per row.
 *
 * `filters[row]` selects the PNG filter for that row; `encodeFilter` is the
 * inverse of the decoder's reconstruction, so a decoder that got a filter wrong
 * returns pixels that differ from the ones handed in.
 */
function encodePng(
	width: number,
	height: number,
	pixels: Uint8Array,
	options: {
		channels?: 3 | 4;
		filters?: readonly number[];
		colourType?: number;
		bitDepth?: number;
		interlace?: number;
	} = {},
): Uint8Array {
	const channels = options.channels ?? 3;
	const header = new Uint8Array(13);
	const headerView = new DataView(header.buffer);
	headerView.setUint32(0, width);
	headerView.setUint32(4, height);
	header[8] = options.bitDepth ?? 8;
	header[9] = options.colourType ?? (channels === 4 ? 6 : 2);
	header[10] = 0;
	header[11] = 0;
	header[12] = options.interlace ?? 0;

	const stride = width * channels;
	const raw = new Uint8Array(height * (stride + 1));
	for (let y = 0; y < height; y += 1) {
		const filter = options.filters?.[y] ?? 0;
		raw[y * (stride + 1)] = filter;
		const row = y * stride;
		const previous = row - stride;
		for (let i = 0; i < stride; i += 1) {
			const value = pixels[row + i] ?? 0;
			const left = i >= channels ? (pixels[row + i - channels] ?? 0) : 0;
			const up = y > 0 ? (pixels[previous + i] ?? 0) : 0;
			const upLeft =
				y > 0 && i >= channels ? (pixels[previous + i - channels] ?? 0) : 0;
			let filtered: number;
			switch (filter) {
				case 0:
					filtered = value;
					break;
				case 1:
					filtered = value - left;
					break;
				case 2:
					filtered = value - up;
					break;
				case 3:
					filtered = value - ((left + up) >> 1);
					break;
				case 4:
					filtered = value - paeth(left, up, upLeft);
					break;
				default:
					throw new Error(`test encoder: no filter ${filter}`);
			}
			raw[y * (stride + 1) + 1 + i] = filtered & 0xff;
		}
	}

	const signature = Uint8Array.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	const parts = [
		signature,
		chunk("IHDR", header),
		chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))),
		chunk("IEND", new Uint8Array(0)),
	];
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

/** A frame whose whole surface is `background`, with `marks` painted as
 *  `markWidth × markHeight` blocks at the given pixel rows, right-aligned inside
 *  `band` — the geometry the rail draws in (`end: 0` inside its own column). */
function frame(
	width: number,
	height: number,
	band: { x0: number; x1: number },
	marks: ReadonlyArray<{ y: number; height?: number }> = [],
): Uint8Array {
	const pixels = new Uint8Array(width * height * 3);
	for (let i = 0; i < width * height; i += 1) {
		pixels[i * 3] = BACKGROUND[0];
		pixels[i * 3 + 1] = BACKGROUND[1];
		pixels[i * 3 + 2] = BACKGROUND[2];
	}
	for (const mark of marks) {
		const markHeight = mark.height ?? 1;
		for (let dy = 0; dy < markHeight; dy += 1) {
			const y = mark.y + dy;
			if (y < 0 || y >= height) continue;
			for (let x = band.x1 - RAIL_COLUMN_PT; x < band.x1; x += 1) {
				const index = (y * width + x) * 3;
				pixels[index] = MARK[0];
				pixels[index + 1] = MARK[1];
				pixels[index + 2] = MARK[2];
			}
		}
	}
	return encodePng(width, height, pixels);
}

const SCREEN: ScreenRecord = {
	type: "screen",
	widthPx: 320,
	heightPx: 640,
	densityDpi: 160,
};

const BAND = railBand(SCREEN.widthPx, SCREEN.heightPx, SCREEN.densityDpi / 160);

function capture(
	frames: ReadonlyArray<{
		state: string;
		phase: FramePhase;
		marks?: ReadonlyArray<{ y: number; height?: number }>;
		path: string;
	}>,
): (path: string) => Uint8Array {
	const byPath = new Map<string, Uint8Array>();
	for (const entry of frames) {
		byPath.set(
			entry.path,
			frame(SCREEN.widthPx, SCREEN.heightPx, BAND, entry.marks),
		);
	}
	return (path) => {
		const bytes = byPath.get(path);
		if (bytes === undefined) throw new Error(`no synthetic frame ${path}`);
		return bytes;
	};
}

function record(
	state: string,
	phase: FramePhase,
	index: number,
	captureMs = 500,
): FrameRecord {
	return {
		type: "frame",
		state,
		phase,
		path: `${state}-${phase}-${index}.png`,
		atMs: 1_000 + index * 1_000,
		captureMs,
	};
}

/** Three marks, well spaced, inside the band's rows. */
const THREE_MARKS = [200, 300, 400].map((y) => ({ y }));
const FOUR_MARKS = [...THREE_MARKS, { y: 100 }];

describe("decodePng", () => {
	it("round-trips every scanline filter", () => {
		const width = 6;
		const height = 6;
		const pixels = new Uint8Array(width * height * 3);
		for (let i = 0; i < pixels.length; i += 1) {
			// A deterministic, non-repeating pattern: any filter applied to a flat
			// row would reconstruct even if the predictor were wrong.
			pixels[i] = (i * 37 + (i % 5) * 11) & 0xff;
		}
		for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4, 3]]) {
			const png = decodePng(encodePng(width, height, pixels, { filters }));
			expect(png.width).toBe(width);
			expect(png.height).toBe(height);
			expect(png.channels).toBe(3);
			expect(Array.from(png.pixels)).toEqual(Array.from(pixels));
		}
	});

	it("reads RGBA, the form screencap emits", () => {
		const width = 3;
		const height = 2;
		const pixels = new Uint8Array(width * height * 4).map((_, index) =>
			index % 4 === 3 ? 255 : (index * 17) & 0xff,
		);
		const png = decodePng(
			encodePng(width, height, pixels, { channels: 4, filters: [0, 1] }),
		);
		expect(png.channels).toBe(4);
		expect(Array.from(png.pixels)).toEqual(Array.from(pixels));
	});

	it("refuses what it cannot read, naming the field", () => {
		const flat = new Uint8Array(3 * 2 * 3);
		expect(() =>
			decodePng(encodePng(3, 2, flat, { bitDepth: 16 }), "sixteen"),
		).toThrow(BIT_DEPTH_REFUSAL);
		expect(() =>
			decodePng(encodePng(3, 2, flat, { colourType: 3 }), "palette"),
		).toThrow(COLOUR_TYPE_REFUSAL);
		expect(() =>
			decodePng(encodePng(3, 2, flat, { interlace: 1 }), "adam7"),
		).toThrow(INTERLACE_REFUSAL);
		expect(() => decodePng(new Uint8Array(4), "stub")).toThrow(
			SHORT_FILE_REFUSAL,
		);
	});

	it("refuses a truncated file rather than returning a short frame", () => {
		const png = encodePng(3, 2, new Uint8Array(3 * 2 * 3));
		// Cut inside the IDAT: the chunk length then runs past the end of the file.
		expect(() => decodePng(png.subarray(0, png.length - 20), "cut")).toThrow(
			TRUNCATION_REFUSAL,
		);
	});
});

describe("railBand", () => {
	it("is exactly the rail's own column and never the transcript's text", () => {
		// The component's geometry: end 7 pt, width 8 pt → 7…15 pt from the right.
		expect(BAND.x0).toBe(320 - (RAIL_EDGE_PT + RAIL_COLUMN_PT));
		expect(BAND.x1).toBe(320 - RAIL_EDGE_PT);
		expect(BAND.x1 - BAND.x0).toBe(RAIL_COLUMN_PT);
		// The transcript's px-4 padding puts its rightmost pixel at width - 16.
		expect(BAND.x0).toBeGreaterThan(320 - 16);
	});

	it("scales with the device's own density", () => {
		const doubled = railBand(720, 1600, 2);
		expect(doubled.x1 - doubled.x0).toBe(RAIL_COLUMN_PT * 2);
		expect(doubled.x0).toBe(720 - (RAIL_EDGE_PT + RAIL_COLUMN_PT) * 2);
		expect(doubled.x0).toBeGreaterThan(720 - 16 * 2);
	});

	it("drops the top and bottom bands the edge fades paint across", () => {
		expect(BAND.y0).toBe(Math.round(640 * BAND_ROW_INSET));
		expect(BAND.y1).toBe(640 - BAND.y0);
	});
});

describe("countBandInk", () => {
	it("counts nothing on an untouched band, at every threshold", () => {
		const png = decodePng(frame(SCREEN.widthPx, SCREEN.heightPx, BAND));
		const ink = countBandInk(png, BAND);
		expect(ink.modal).toEqual(BACKGROUND);
		expect(ink.total).toBe((BAND.x1 - BAND.x0) * (BAND.y1 - BAND.y0));
		for (const threshold of COUNT_THRESHOLDS) {
			expect(ink.counts[String(threshold)]).toBe(0);
		}
	});

	it("counts a painted mark's pixels and stays below a threshold above it", () => {
		const png = decodePng(
			frame(SCREEN.widthPx, SCREEN.heightPx, BAND, [{ y: 300 }]),
		);
		const ink = countBandInk(png, BAND);
		expect(ink.counts["1"]).toBe(RAIL_COLUMN_PT);
		expect(ink.counts[String(GATE_THRESHOLD)]).toBe(RAIL_COLUMN_PT);
		// MARK is 128-ish away from BACKGROUND on red; nothing is 200 away.
		expect(ink.counts["32"]).toBe(RAIL_COLUMN_PT);
	});

	it("ignores ink outside the band", () => {
		const width = SCREEN.widthPx;
		const height = SCREEN.heightPx;
		const png = decodePng(frame(width, height, BAND, [{ y: 300 }]));
		const outside = countBandInk(png, { x0: 0, x1: 100, y0: 60, y1: 580 });
		expect(outside.counts[String(GATE_THRESHOLD)]).toBe(0);
	});
});

describe("analyseFrames", () => {
	const scenario = (spec: {
		deepUpMarks: ReadonlyArray<{ y: number; height?: number }>;
		buildingUpMarks: ReadonlyArray<{ y: number; height?: number }>;
	}) => {
		const phases: ReadonlyArray<{
			state: string;
			phase: FramePhase;
			marks?: ReadonlyArray<{ y: number; height?: number }>;
		}> = [
			{ state: DEEP_STATE, phase: "pre" },
			{ state: DEEP_STATE, phase: "fling", marks: spec.deepUpMarks },
			{ state: BUILDING_STATE, phase: "pre" },
			{ state: BUILDING_STATE, phase: "fling", marks: spec.buildingUpMarks },
		];
		// The records are the single source of the paths: a helper that minted
		// them twice would test a wiring nobody ships.
		const records = phases.map((entry, index) =>
			record(entry.state, entry.phase, index, 480 + index),
		);
		return analyseFrames(
			[SCREEN, ...records],
			capture(
				records.map((entry, index) => ({
					...entry,
					marks: phases[index]?.marks,
				})),
			),
		);
	};

	it("passes when both states paint and building differs from deep", () => {
		const report = scenario({
			deepUpMarks: THREE_MARKS,
			buildingUpMarks: FOUR_MARKS,
		});
		expect(report.verdict).toBe("pass");
		expect(report.claims.railPaints).toBe(true);
		expect(report.claims.buildingDiffersFromDeep).toBe(true);
		expect(report.claims.buildingMinusDeep).toBe(RAIL_COLUMN_PT);
		expect(report.states[DEEP_STATE]?.inkDelta).toBe(3 * RAIL_COLUMN_PT);
		expect(report.states[DEEP_STATE]?.down?.counts["8"]).toBe(0);
		// Reported, never gated: the latency distribution is the run's own.
		expect(report.latency).toEqual({
			n: 4,
			minMs: 480,
			medianMs: 482,
			maxMs: 483,
		});
	});

	it("fails when the rail never paints during the fling", () => {
		const report = scenario({ deepUpMarks: [], buildingUpMarks: THREE_MARKS });
		expect(report.claims.railPaints).toBe(false);
		expect(report.verdict).toBe("fail");
		expect(report.states[DEEP_STATE]?.railPaints).toBe(false);
		expect(report.states[BUILDING_STATE]?.railPaints).toBe(true);
	});

	it("fails when building paints the same band content as deep", () => {
		const report = scenario({
			deepUpMarks: THREE_MARKS,
			buildingUpMarks: THREE_MARKS,
		});
		expect(report.claims.railPaints).toBe(true);
		expect(report.claims.buildingDiffersFromDeep).toBe(false);
		expect(report.claims.buildingMinusDeep).toBe(0);
		expect(report.verdict).toBe("fail");
	});

	it("requires more than noise above the rail-down control", () => {
		// One pixel more is not a mark; MIN_INK_PX is the smallest mark the
		// component draws (a 3 pt compact dash, one row tall).
		const oneMark = [{ y: 300 }];
		const report = scenario({
			deepUpMarks: oneMark,
			buildingUpMarks: oneMark,
		});
		expect(report.states[DEEP_STATE]?.inkDelta).toBe(RAIL_COLUMN_PT);
		expect(RAIL_COLUMN_PT).toBeGreaterThanOrEqual(MIN_INK_PX);
	});

	it("refuses a capture that does not cover both states", () => {
		const records = [
			record(DEEP_STATE, "pre", 0),
			record(DEEP_STATE, "fling", 1),
		];
		expect(() => analyseFrames([SCREEN, ...records], capture(records))).toThrow(
			COVERAGE_REFUSAL,
		);
	});

	it("refuses a frame whose size disagrees with the reported geometry", () => {
		const small = encodePng(10, 10, new Uint8Array(10 * 10 * 3));
		expect(() =>
			analyseFrames(
				[
					SCREEN,
					record(DEEP_STATE, "pre", 0),
					record(BUILDING_STATE, "pre", 1),
				],
				() => small,
			),
		).toThrow(GEOMETRY_REFUSAL);
	});
});
