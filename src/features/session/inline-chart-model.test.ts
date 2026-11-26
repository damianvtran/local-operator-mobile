import { describe, expect, it } from "vitest";
import {
	axisText,
	barBand,
	type Cartesian,
	fixedCountTicks,
	formatExact,
	histogramAxisLabels,
	horizontalBars,
	type InlineChart,
	inlineChartModel,
	niceTicks,
	pieDiameterFor,
	pieSlices,
	plotHeightFor,
	stepActive,
	thinLabels,
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
	it("targets 5 ticks at 240 and 3 at 180", () => {
		expect(tickTarget(240)).toBe(5);
		expect(tickTarget(180)).toBe(3);
		expect(tickTarget(1000)).toBe(6);
	});

	it("fits the operator's 84–154 USD series to 80–160 without zero", () => {
		const { left } = plot({
			type: "line",
			title: "Spend",
			unit: "USD",
			data: DATADOG,
		});
		expect(left.values).toEqual([80, 100, 120, 140, 160]);
		expect(left.unit).toBe("USD");
		expect(tickLabels(left, "en")).toEqual(["80", "100", "120", "140", "160"]);
	});

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

	it("thins 32 categories at 360 so no two labels overlap and both ends show", () => {
		const widths = Array.from({ length: 32 }, () => 6 * 6.6);
		const plotWidth = 360 - 36 - 12;
		const slot = plotWidth / 31;
		const shown = thinLabels(widths, slot, true);
		expect(shown[0]?.index).toBe(0);
		expect(shown[shown.length - 1]?.index).toBe(31);
		const extents = shown.map(({ index, maxWidth }, i) => {
			const w = Math.min(widths[index] ?? 0, maxWidth);
			const x = index * slot;
			if (i === 0) return [x, x + w];
			if (i === shown.length - 1) return [x - w, x];
			return [x - w / 2, x + w / 2];
		});
		for (let i = 1; i < extents.length; i++)
			expect(extents[i]?.[0]).toBeGreaterThan(extents[i - 1]?.[1] ?? 0);
	});

	it("drops the previous label when the forced last one collides", () => {
		// 10 labels, stride 3 → 0, 3, 6, 9: the last is on stride already.
		expect(
			thinLabels(Array(10).fill(40), 20, false).map(({ index }) => index),
		).toEqual([0, 3, 6, 9]);
		// 9 labels, stride 3 → 0, 3, 6 then 8 collides with 6, so 6 goes.
		expect(
			thinLabels(Array(9).fill(40), 20, false).map(({ index }) => index),
		).toEqual([0, 3, 8]);
	});

	it("keeps every label when they fit", () => {
		expect(
			thinLabels([20, 20, 20], 60, false).map(({ index }) => index),
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
