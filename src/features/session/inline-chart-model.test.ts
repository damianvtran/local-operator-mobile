import { describe, expect, it } from "vitest";
import { sansTextWidthDp } from "@/ui/components/list-row-meta";
import {
	axisText,
	barBand,
	type Cartesian,
	categoryX,
	fixedCountTicks,
	formatExact,
	formatPieShare,
	HEAT_FLOOR,
	heatmapModel,
	histogramAxisLabels,
	horizontalBars,
	type InlineChart,
	inlineChartModel,
	LABEL_GAP,
	type LabelBox,
	labelWidth,
	layoutXLabels,
	niceTicks,
	pieDiameterFor,
	pieSlices,
	plotHeightFor,
	sideTooltipPlacement,
	stepActive,
	stepCell,
	tickLabels,
	tickTarget,
	tooltipPlacement,
	valueExtent,
	withUnit,
} from "./inline-chart-model";
import type { InlineSeries } from "./inline-series";

const plot = (chart: InlineChart, height = 240): Cartesian => {
	const model = inlineChartModel(chart, height);
	if (model.kind !== "cartesian") throw new Error("Expected Cartesian plot");
	return model;
};
const series = (
	mode: InlineSeries["mode"],
	values: number[][],
): InlineSeries => ({
	type: "series",
	title: "Weekly readings",
	labels: ["A", "B"],
	mode,
	series: values.map((values, index) => ({
		label: `Series ${index + 1}`,
		values,
	})),
});

const COMPACT_SUFFIX = /K|M/;
const EN_TICK = /^(-?[\d.,]+)([KMBT]?)$/;

// The operator's Datadog spend series from the bug report (USD per day).
const DATADOG: [string, number][] = [
	["Nov 16", 153.66],
	["Nov 17", 143.37],
	["Nov 18", 140.61],
	["Nov 19", 141.67],
	["Nov 20", 126.94],
	["Nov 21", 118.38],
	["Nov 22 · PDF ends", 109.2],
	["Nov 23", 124.37],
	["Nov 24 · rollout", 84.04],
];

describe("sizing (§1, §3)", () => {
	it("scales the plot height with width between 180 and 240", () => {
		expect(plotHeightFor(360)).toBe(180);
		expect(plotHeightFor(760)).toBe(240);
		expect(plotHeightFor(600)).toBe(204);
		expect(plotHeightFor(2000)).toBe(240);
	});

	it("sizes the donut 200 wide and fits it on narrow boxes", () => {
		expect(pieDiameterFor(760)).toBe(200);
		expect(pieDiameterFor(360)).toBe(180);
		expect(pieDiameterFor(190)).toBe(158);
	});

	it("picks horizontal bars for many or long categories", () => {
		const labels = (n: number, text = "Cat") =>
			Array.from({ length: n }, (_, i) => `${text}${i}`);
		expect(horizontalBars(labels(6), 360)).toBe(false);
		expect(horizontalBars(labels(7), 360)).toBe(true);
		expect(horizontalBars(labels(7), 760)).toBe(false);
		expect(horizontalBars(labels(13), 760)).toBe(true);
		expect(horizontalBars(["A very long category"], 760)).toBe(true);
	});
});

describe("nice ticks (§2)", () => {
	it("targets 5 ticks at 240 and never fewer than 4 (X1)", () => {
		expect(tickTarget(240)).toBe(5);
		expect(tickTarget(180)).toBe(4);
		expect(tickTarget(1000)).toBe(6);
	});

	// X1 regression: with a floor of 3 the 180 px phone plot fitted this
	// series to 50–200 and the data filled under half the plot.
	it.each([
		[180, 360],
		[240, 760],
	])(
		"fits the operator's 84–154 USD series to 80–160 without zero at a %i px plot (W %i)",
		(height, width) => {
			expect(plotHeightFor(width)).toBe(height);
			const { left } = plot(
				{ type: "line", title: "Spend", unit: "USD", data: DATADOG },
				height,
			);
			expect(left.values).toEqual([80, 100, 120, 140, 160]);
			expect(left.unit).toBe("USD");
			expect(tickLabels(left, "en")).toEqual([
				"80",
				"100",
				"120",
				"140",
				"160",
			]);
		},
	);

	it("uses the smallest {1, 2, 2.5, 5}×10^k step and the step's decimals", () => {
		expect(niceTicks(0, 1, 5).values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
		expect(niceTicks(0, 0.7, 3)).toMatchObject({
			values: [0, 0.25, 0.5, 0.75],
			decimals: 2,
		});
		expect(niceTicks(0, 5, 3).values).toEqual([0, 2, 4, 6]);
		// 1, 2 and 2.5 give 13, 8 and 7 ticks; 5 is the first to fit ≤ 6.
		expect(niceTicks(-3, 9, 5).values).toEqual([-5, 0, 5, 10]);
	});

	it("pads flat data by 10% (or ±1 at zero)", () => {
		expect(niceTicks(50, 50, 5)).toMatchObject({
			values: [45, 47.5, 50, 52.5, 55],
			decimals: 1,
		});
		expect(niceTicks(0, 0, 3).values).toEqual([-1, 0, 1]);
	});

	it("includes zero for bars, and for lines only within a third of the range", () => {
		expect(valueExtent([84, 154], false)).toEqual([84, 154]);
		expect(valueExtent([20, 80], false)).toEqual([0, 80]);
		expect(valueExtent([84, 154], true)).toEqual([0, 154]);
		const bars = plot({
			type: "bar",
			title: "Flow",
			data: [
				["In", 6],
				["Out", -2],
			],
		});
		expect(bars.left.values[0]).toBeLessThanOrEqual(-2);
		expect(bars.left.values).toContain(0);
		const histogram = plot({
			type: "histogram",
			title: "Lat",
			data: [
				["0–5", 30],
				["5–10", 41],
			],
		});
		expect(histogram.left.lo).toBe(0);
	});

	it("fixes percent mode at 0–100% in 25% steps", () => {
		const { left } = plot(
			series("percent", [
				[3, 1],
				[1, 3],
			]),
			180,
		);
		expect(left.values).toEqual([0, 0.25, 0.5, 0.75, 1]);
		expect(tickLabels(left, "en", true)).toEqual([
			"0%",
			"25%",
			"50%",
			"75%",
			"100%",
		]);
	});

	it("labels compact from 10 000 and keeps tooltips exact", () => {
		const { left } = plot({
			type: "bar",
			title: "Req",
			data: [
				["a", 12_345],
				["b", 48_000],
			],
		});
		expect(tickLabels(left, "en")).toEqual([
			"0",
			"10K",
			"20K",
			"30K",
			"40K",
			"50K",
		]);
		expect(formatExact(12_345.67, "en")).toBe("12,345.67");
		expect(formatExact(1.765, "fr")).toBe("1,765");
	});

	// X3: the fewest decimals (0–3) that keep every compact label distinct
	// and unrounded, else full grouped numbers.
	it.each([
		[10_050, 10_300, ["10.0K", "10.1K", "10.2K", "10.3K"]],
		[1_000_000, 1_004_000, ["1.000M", "1.001M", "1.002M", "1.003M", "1.004M"]],
	])("gives compact ticks over %i–%i distinct decimals", (lo, hi, expected) => {
		const { left } = plot(
			{
				type: "line",
				title: "Close",
				data: [
					["a", lo],
					["b", hi],
				],
			},
			180,
		);
		const labels = tickLabels(left, "en");
		expect(new Set(labels).size).toBe(labels.length);
		expect(labels.every((label) => COMPACT_SUFFIX.test(label))).toBe(true);
		expect(labels).toEqual(expected);
	});

	it("needs two decimals for 50-unit steps over 10,050", () => {
		const labels = tickLabels(
			{ ...niceTicks(10_050, 10_300, 6), compact: true, position: () => 0 },
			"en",
		);
		expect(labels).toEqual([
			"10.05K",
			"10.10K",
			"10.15K",
			"10.20K",
			"10.25K",
			"10.30K",
		]);
	});

	it("never rounds a compact tick to a value it is not", () => {
		const labels = tickLabels(
			{
				lo: 10_000,
				hi: 15_000,
				step: 2500,
				decimals: 0,
				values: [10_000, 12_500, 15_000],
				compact: true,
				position: () => 0,
			},
			"en",
		);
		expect(labels).toContain("12.5K");
		expect(labels).not.toContain("13K");
	});

	it("falls back to standard labels when compact ones would collide", () => {
		const { left } = plot({
			type: "line",
			title: "Close",
			data: [
				["a", 9007199254740990],
				["b", 9007199254740991],
			],
		});
		const labels = tickLabels(left, "en");
		expect(new Set(labels).size).toBe(labels.length);
	});

	// C1: a compact label is accepted only if it reads back as its true value.
	// `en` compact suffixes are K/M/B/T; standard labels parse after ungrouping.
	const SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
	const readBack = (label: string) => {
		const match = EN_TICK.exec(label);
		if (!match) throw new Error(`unparsable tick ${label}`);
		return Number(match[1]?.replaceAll(",", "")) * (SCALE[match[2] ?? ""] ?? 1);
	};
	const axisOf = (lo: number, hi: number, target: number) => {
		const ticks = niceTicks(lo, hi, target);
		return {
			...ticks,
			compact: Math.max(Math.abs(ticks.lo), Math.abs(ticks.hi)) >= 10_000,
			position: () => 0,
		};
	};
	it.each([
		[0, 10_300],
		[0, 1_250_000],
		[1_000_000, 1_250_000],
		[10_050, 10_300],
		[1_000_000, 1_004_000],
		[0, 1.25e-6],
		[1e12 + 1, 1e12 + 4],
	])("labels every tick of %d–%d exactly (C1)", (lo, hi) => {
		for (const target of [4, 5, 6]) {
			const axis = axisOf(lo, hi, target);
			const labels = tickLabels(axis, "en");
			expect(new Set(labels).size).toBe(labels.length);
			// Relative tolerance: the read-back multiplies by 1e3/1e6, which is
			// not exact in binary; a rounded label is off by far more.
			labels.forEach((label, i) => {
				const value = axis.values[i] ?? Number.NaN;
				expect(Math.abs(readBack(label) - value)).toBeLessThanOrEqual(
					Math.abs(value) * 1e-12,
				);
			});
		}
	});

	it("names the cases C1 lists by their exact labels", () => {
		expect(tickLabels(axisOf(0, 10_300, 5), "en")).toEqual([
			"0.0",
			"2.5K",
			"5.0K",
			"7.5K",
			"10.0K",
			"12.5K",
		]);
		expect(tickLabels(axisOf(1_000_000, 1_250_000, 5), "en").at(-1)).toBe(
			"1.25M",
		);
		expect(tickLabels(axisOf(0, 1.25e-6, 5), "en").at(-1)).toBe("0.00000125");
	});

	it("checks exactness against the true value, not a 6-digit rendering (C1)", () => {
		// 10,000,000.1 renders `10M` at six compact digits, so a 6-digit
		// reference would have accepted `10M` as exact.
		const labels = tickLabels(
			{
				lo: 10_000_000.1,
				hi: 30_000_000.1,
				step: 10_000_000,
				decimals: 1,
				values: [10_000_000.1, 20_000_000.1, 30_000_000.1],
				compact: true,
				position: () => 0,
			},
			"en",
		);
		expect(labels).toEqual(["10,000,000.1", "20,000,000.1", "30,000,000.1"]);
	});

	it("keeps 1e12+1…1e12+4 distinct at full precision (C3)", () => {
		const axis = axisOf(1e12 + 1, 1e12 + 4, 5);
		expect(axis.values).toEqual([1e12 + 1, 1e12 + 2, 1e12 + 3, 1e12 + 4]);
		expect(tickLabels(axis, "en")).toEqual([
			"1,000,000,000,001",
			"1,000,000,000,002",
			"1,000,000,000,003",
			"1,000,000,000,004",
		]);
	});

	it("gives the right axis the left's tick count", () => {
		const right = fixedCountTicks(-5, 10, 5);
		expect(right.values).toHaveLength(5);
		expect(right.lo).toBeLessThanOrEqual(-5);
		expect(right.hi).toBeGreaterThanOrEqual(10);
		const dual = plot({
			...series("dual", [
				[100, 1000],
				[-5, 10],
			]),
			series: [
				{ label: "Items", axis: "left", values: [100, 1000] },
				{ label: "Latency", axis: "right", values: [-5, 10] },
			],
			unit: "items",
			rightUnit: "ms",
		});
		expect(dual.right?.values.length).toBe(dual.left.values.length);
		expect(dual.right?.unit).toBe("ms");
		expect(dual.lines?.map(({ axis }) => axis)).toEqual(["left", "right"]);
	});

	it("attaches tight units without a space", () => {
		expect(withUnit("38", "%")).toBe("38%");
		expect(withUnit("21.5", "°C")).toBe("21.5°C");
		expect(withUnit("140.61", "USD")).toBe("140.61 USD");
		expect(withUnit("3")).toBe("3");
	});
});

describe("x labels (§2)", () => {
	it("shows the label before the annotation on the axis", () => {
		expect(axisText("Nov 24 · rollout")).toBe("Nov 24");
		expect(axisText("Plain")).toBe("Plain");
	});

	// X2: the boxes are measured with `labelWidth` — the function the
	// renderer sizes each label with — at their real anchors.
	const layout = (labels: string[], width: number, lineLike = true) => {
		const x0 = 36;
		const x1 = width - 12;
		const { at } = categoryX(labels.length, x0, x1, lineLike);
		return layoutXLabels({
			texts: labels,
			anchors: labels.map((_, i) => at(i)),
			edges: lineLike,
			lo: 0,
			hi: width,
		});
	};
	const expectDisjoint = (boxes: LabelBox[], width: number) => {
		for (const box of boxes) {
			expect(box.left).toBeGreaterThanOrEqual(0);
			expect(box.left + box.width).toBeLessThanOrEqual(width);
			// The box is exactly the measured width of what is drawn.
			expect(box.width).toBe(labelWidth(box.text));
		}
		for (let i = 1; i < boxes.length; i++) {
			const prev = boxes[i - 1];
			const cur = boxes[i];
			if (!prev || !cur) continue;
			expect(cur.left).toBeGreaterThanOrEqual(
				prev.left + prev.width + LABEL_GAP,
			);
		}
	};

	it("thins 32 categories at 360 so no two labels overlap and both ends show", () => {
		const labels = Array.from({ length: 32 }, (_, i) =>
			i < 31 ? `Oct ${i + 1}` : "Nov 1",
		);
		const boxes = layout(labels, 360);
		expect(boxes[0]).toMatchObject({ index: 0, text: "Oct 1", align: "left" });
		expect(boxes.at(-1)).toMatchObject({
			index: 31,
			text: "Nov 1",
			align: "right",
		});
		expect(boxes.length).toBeGreaterThan(2);
		expectDisjoint(boxes, 360);
	});

	it.each([
		["Week 3 of the quarterly reporting period", 360],
		["Week 3 of the quarterly reporting period", 760],
		["2025-11-16 14:00 UTC", 360],
		["2025-11-16 14:00 UTC", 760],
	])(
		"never overlaps long labels (%s at %i), any count up to 32",
		(label, width) => {
			for (const lineLike of [true, false])
				for (let n = 1; n <= 32; n++) {
					const labels = Array.from({ length: n }, (_, i) =>
						i % 2 ? `${label} ${i}` : label,
					);
					const boxes = layout(labels, width, lineLike);
					expect(boxes[0]?.index).toBe(0);
					expect(boxes.at(-1)?.index).toBe(n - 1);
					expect(boxes.every((box) => box.text.length > 0)).toBe(true);
					expectDisjoint(boxes, width);
				}
		},
	);

	// Natural widths of these labels in the app font (Figtree 12 px,
	// tabular-nums), measured as inline-block spans in the harness browser.
	// A box narrower than its text is ellipsized by the renderer ("W…").
	it.each([
		["Wed", 24.61],
		["Mon", 23.8],
		["50–100", 44.01],
		["100–150", 51.48],
		["Nov 24", 40.24],
		["12K", 22.28],
		["10.05K", 42.56],
		["0123456789", 74.8],
		["MMMMMMMMMM", 101.46],
		["2025-11-16 14:00 UTC", 132.38],
		["Week 3 of the quarterly reporting period", 216.45],
		["Platform infrastructure", 122.09],
	])("measures %s at least as wide as it draws (%f px)", (text, drawn) => {
		expect(labelWidth(text)).toBeGreaterThanOrEqual(drawn);
	});

	// R12: outside ASCII and CJK the estimate is never below the repo's sans
	// fallback rule (`sansTextWidthDp`, 0.7 em per uncovered glyph), and an
	// accented capital never below its base letter's measured Figtree advance.
	it.each([
		["Cyrillic", "Понедельник"],
		["Cyrillic capitals", "ЖШЩЮ"],
		["Greek", "Ψηφιακό"],
		["Devanagari", "सोमवार"],
		["Arabic", "الاثنين"],
		["Thai", "วันจันทร์"],
		["accented capitals", "ÉÖÅÜ"],
	])("charges %s at least the sans fallback rule", (_, text) => {
		expect(labelWidth(text)).toBeGreaterThanOrEqual(
			Math.ceil(sansTextWidthDp(text, 1)) + 4,
		);
	});

	it("charges an accented capital at least its base letter's advance", () => {
		for (const [accented, base] of [
			["ÖÖÖÖ", "OOOO"],
			["ÉÉÉÉ", "EEEE"],
		] as const) {
			expect(labelWidth(accented)).toBeGreaterThanOrEqual(
				Math.ceil(sansTextWidthDp(base, 1)) + 4,
			);
		}
		// W is already charged the WIDE weight; its accented form never less.
		expect(labelWidth("ŴŴŴŴ")).toBeGreaterThanOrEqual(labelWidth("WWWW"));
	});

	it("keeps the first label and truncates the last when only the ends fit", () => {
		const labels = Array.from(
			{ length: 4 },
			() => "Week 3 of the quarterly reporting period",
		);
		const boxes = layout(labels, 360);
		expect(boxes.map(({ index }) => index)).toEqual([0, 3]);
		expect(boxes[0]?.text).toBe("Week 3 of the quarterly reporting period");
		expect(boxes[1]?.text.endsWith("…")).toBe(true);
		expectDisjoint(boxes, 360);
	});

	it("drops the previous label when the forced last one collides", () => {
		const boxes = layout(
			Array.from({ length: 9 }, () => "Label"),
			150,
			false,
		);
		expect(boxes.at(-1)?.index).toBe(8);
		expectDisjoint(boxes, 150);
	});

	it("keeps every label when they fit", () => {
		expect(
			layout(["A", "B", "C"], 360, false).map(({ index }) => index),
		).toEqual([0, 1, 2]);
	});
});

describe("bars (§1)", () => {
	it("pads the band 30% and caps bars at 48", () => {
		expect(barBand(40, 1, "single")).toEqual({ width: 28, offsets: [-14] });
		expect(barBand(200, 1, "single").width).toBe(48);
		const grouped = barBand(100, 3, "grouped");
		expect(grouped.width).toBeCloseTo((70 - 4) / 3);
		expect((grouped.offsets[1] ?? 0) - (grouped.offsets[0] ?? 0)).toBeCloseTo(
			grouped.width + 2,
		);
	});

	it("puts signed bars on opposite sides of one zero", () => {
		const bar = plot({
			type: "bar",
			title: "Flow",
			data: [
				["In", 6],
				["Out", -2],
			],
		});
		const zero = bar.left.position(0);
		expect(bar.bars?.map(({ from }) => from)).toEqual([zero, zero]);
		expect(bar.bars?.[0]?.to).toBeGreaterThan(zero);
		expect(bar.bars?.[1]?.to).toBeLessThan(zero);
	});

	it("stacks segments and rounds only the outermost per direction", () => {
		const { bars, totals } = plot(
			series("stacked", [
				[2, 4],
				[3, -1],
			]),
		);
		expect(bars?.map(({ outer }) => outer)).toEqual([false, true, true, true]);
		expect(totals).toEqual([5, 3]);
	});

	it("omits shares for signed stacks, which have no whole", () => {
		// Category A holds 6 and −8; category B holds 2 and 1.
		const { bars } = plot(
			series("stacked", [
				[6, 2],
				[-8, 1],
			]),
		);
		expect(bars?.map(({ share }) => share)).toEqual([
			undefined,
			undefined,
			2 / 3,
			1 / 3,
		]);
	});

	// X6: an all-negative stack still has a whole; only mixed signs drop it.
	it("keeps shares for same-sign negative stacks", () => {
		const { bars } = plot(
			series("stacked", [
				[-3, 2],
				[-1, -2],
			]),
		);
		// Category A holds −3 and −1 (one sign); category B holds 2 and −2.
		expect(bars?.map(({ share }) => share)).toEqual([
			0.75,
			0.25,
			undefined,
			undefined,
		]);
	});

	// X6: percent mode keeps the share even on a mixed-sign category.
	it("keeps shares in percent mode even with mixed signs", () => {
		const { bars } = plot(
			series("percent", [
				[6, 2],
				[-2, 2],
			]),
		);
		expect(bars?.every(({ share }) => share !== undefined)).toBe(true);
	});

	it("keeps shares for percent stacks", () => {
		const { bars } = plot(
			series("percent", [
				[3, 1],
				[1, 3],
			]),
		);
		expect(bars?.map(({ share }) => share)).toEqual([0.75, 0.25, 0.25, 0.75]);
		expect(bars?.[1]?.to).toBe(1);
	});
});

describe("pie (§3)", () => {
	// X9: whole percent on every pie surface; "<1%" for a sliver.
	it("formats pie shares as whole percents with a <1% floor", () => {
		expect(formatPieShare(0.348, "en")).toBe("35%");
		expect(formatPieShare(0.052, "en")).toBe("5%");
		expect(formatPieShare(0.008, "en")).toBe("1%");
		expect(formatPieShare(0.004, "en")).toBe("<1%");
		expect(formatPieShare(0, "en")).toBe("0%");
		expect(formatPieShare(1, "en")).toBe("100%");
	});

	it("sorts slices descending from 12 o'clock and closes the circle", () => {
		const { slices } = pieSlices([
			["A", 1],
			["B", 3],
		]);
		expect(slices.map(({ label, start, end }) => [label, start, end])).toEqual([
			["B", 0, 0.75],
			["A", 0.75, 1],
		]);
	});

	it("folds more than seven items into Other (n), last, ink-dim", () => {
		const data: [string, number][] = Array.from({ length: 12 }, (_, i) => [
			`Item ${i + 1}`,
			12 - i,
		]);
		const { slices, total } = pieSlices(data);
		expect(slices).toHaveLength(7);
		const other = slices[6];
		expect(other?.color).toBeNull();
		expect(other?.folded?.map(({ label }) => label)).toEqual([
			"Item 7",
			"Item 8",
			"Item 9",
			"Item 10",
			"Item 11",
			"Item 12",
		]);
		expect(other?.value).toBe(6 + 5 + 4 + 3 + 2 + 1);
		expect(slices.slice(0, 6).map(({ color }) => color)).toEqual([
			0, 1, 2, 3, 4, 5,
		]);
		expect(total).toBe(78);
	});

	it("keeps exactly seven items unfolded", () => {
		const data: [string, number][] = Array.from({ length: 7 }, (_, i) => [
			`${i}`,
			1,
		]);
		expect(pieSlices(data).slices.every(({ color }) => color !== null)).toBe(
			true,
		);
	});

	it("normalizes huge weights without overflow", () => {
		const { slices } = pieSlices([
			["A", Number.MAX_VALUE],
			["B", Number.MAX_VALUE],
		]);
		expect(slices.map(({ share }) => share)).toEqual([0.5, 0.5]);
	});
});

describe("interaction (§5)", () => {
	it("moves the active mark by keyboard / adjustable steps", () => {
		expect(stepActive(null, "next", 9, 2)).toEqual({ category: 0, series: 0 });
		const at = { category: 3, series: 0 };
		expect(stepActive(at, "next", 9, 2)).toEqual({ category: 4, series: 0 });
		expect(stepActive(at, "previous", 9, 2)).toEqual({
			category: 2,
			series: 0,
		});
		expect(stepActive(at, "down", 9, 2)).toEqual({ category: 3, series: 1 });
		expect(stepActive({ category: 3, series: 1 }, "down", 9, 2)).toEqual({
			category: 3,
			series: 1,
		});
		expect(stepActive(at, "up", 9, 2)).toEqual({ category: 3, series: 0 });
		expect(stepActive(at, "first", 9, 2)).toEqual({ category: 0, series: 0 });
		expect(stepActive(at, "last", 9, 2)).toEqual({ category: 8, series: 0 });
		expect(stepActive({ category: 8, series: 0 }, "next", 9, 2)).toEqual({
			category: 8,
			series: 0,
		});
		expect(stepActive(at, "clear", 9, 2)).toBeNull();
	});

	it("places the tooltip above the mark, flips below and clamps inside", () => {
		expect(
			tooltipPlacement({ x: 100, top: 80, width: 60, height: 40, box: 300 }),
		).toEqual({
			left: 70,
			top: 32,
			flipped: false,
		});
		expect(
			tooltipPlacement({
				x: 100,
				top: 20,
				bottom: 30,
				width: 60,
				height: 40,
				box: 300,
			}),
		).toMatchObject({
			top: 38,
			flipped: true,
		});
		expect(
			tooltipPlacement({ x: 2, top: 80, width: 60, height: 40, box: 300 }).left,
		).toBe(4);
		expect(
			tooltipPlacement({ x: 299, top: 80, width: 60, height: 40, box: 300 })
				.left,
		).toBe(236);
	});

	// X4: a flipped tooltip near the plot floor stays above the x labels.
	it("never leaves the plot vertically, even when flipped", () => {
		const plotBottom = 192;
		for (const [top, bottom] of [
			[20, 190],
			[4, 60],
			[30, 192],
		] as const) {
			const place = tooltipPlacement({
				x: 100,
				top,
				bottom,
				width: 80,
				height: 60,
				box: 360,
				maxBottom: plotBottom,
			});
			expect(place.top).toBeGreaterThanOrEqual(0);
			expect(place.top + 60).toBeLessThanOrEqual(plotBottom);
		}
	});

	// X5: beside the ring, never inside the outer radius.
	it.each([1, -1] as const)(
		"puts the wide donut tooltip beside the ring (side %i)",
		(side) => {
			const cx = 380;
			const outer = 100;
			const place = sideTooltipPlacement({
				cx,
				outer,
				side,
				y: 40,
				width: 500,
				height: 70,
				box: 760,
				boxHeight: 224,
			});
			const width = Math.min(500, place.maxWidth);
			const [l, r] = [place.left, place.left + width];
			if (side > 0) expect(l).toBeGreaterThanOrEqual(cx + outer + 8);
			else expect(r).toBeLessThanOrEqual(cx - outer - 8);
			expect(l).toBeGreaterThanOrEqual(4);
			expect(r).toBeLessThanOrEqual(756);
			expect(place.top).toBeGreaterThanOrEqual(0);
			expect(place.top + 70).toBeLessThanOrEqual(224);
		},
	);

	it("walks heatmap cells in reading order", () => {
		expect(stepCell(null, 1, 3, 2)).toEqual({ category: 0, series: 0 });
		expect(stepCell({ category: 2, series: 0 }, 1, 3, 2)).toEqual({
			category: 0,
			series: 1,
		});
		expect(stepCell({ category: 0, series: 1 }, -1, 3, 2)).toEqual({
			category: 2,
			series: 0,
		});
		expect(stepCell({ category: 2, series: 1 }, 1, 3, 2)).toEqual({
			category: 2,
			series: 1,
		});
	});
});

describe("heatmap (§4, X10)", () => {
	it("mixes from the raised floor at the minimum to full accent at the maximum", () => {
		const model = heatmapModel({
			type: "heatmap",
			title: "Load",
			columns: ["Mon", "Tue"],
			rowLabels: ["AM", "PM"],
			rows: [
				[0, 5],
				[null, 10],
			],
		});
		expect(HEAT_FLOOR).toBe(0.28);
		expect([model.min, model.max]).toEqual([0, 10]);
		expect(model.mix(0)).toBe(HEAT_FLOOR);
		expect(model.mix(10)).toBe(1);
		expect(model.mix(5)).toBeCloseTo(0.64);
	});

	it("paints flat data at the top and reports no data for all-null", () => {
		const flat = heatmapModel({
			type: "heatmap",
			title: "Flat",
			columns: ["A"],
			rowLabels: ["R"],
			rows: [[3]],
		});
		expect(flat.mix(3)).toBe(1);
		const empty = heatmapModel({
			type: "heatmap",
			title: "Empty",
			columns: ["A"],
			rowLabels: ["R"],
			rows: [[null]],
		});
		expect(empty.hasData).toBe(false);
	});
});

describe("histogram labels", () => {
	it("only factors a unanimous interval unit without changing endpoint text", () => {
		const labels = ["0–50 ms", "50–100 ms", "100–150 ms", "150–200 ms"];
		expect(histogramAxisLabels(labels)).toEqual({
			labels: ["0–50", "50–100", "100–150", "150–200"],
			unit: "ms",
		});
		const mixed = ["0–50 ms", "Other"];
		expect(histogramAxisLabels(mixed)).toEqual({
			labels: mixed,
			unit: undefined,
		});
	});
});
