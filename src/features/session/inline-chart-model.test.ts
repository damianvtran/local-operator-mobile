import { describe, expect, it } from "vitest";
import {
	chartAxisLabels,
	chartTickLabel,
	histogramAxisLabels,
	type InlineChart,
	inlineChartModel,
} from "./inline-chart-model";
import type { InlineSeries } from "./inline-series";

const plot = (chart: InlineChart) => {
	const model = inlineChartModel(chart);
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

describe("inline chart geometry", () => {
	it("puts signed bars on opposite sides of one zero; histogram bins cover each slot", () => {
		const bar = plot({
			type: "bar",
			title: "Flow",
			data: [
				["In", 6],
				["Out", -2],
			],
		});
		expect(bar.left.zero).toBe(0.25);
		expect(bar.bars?.map(({ from, to }) => [from, to])).toEqual([
			[0.25, 1],
			[0.25, 0],
		]);
		const histogram = plot({
			type: "histogram",
			title: "Duration",
			data: [
				["0–5", 3],
				["5–10", 1],
			],
		});
		expect(histogram.bars?.map(({ x, width }) => [x, width])).toEqual([
			[0.25, 0.5],
			[0.75, 0.5],
		]);
	});

	it("preserves line order and uses numeric spacing for scatter", () => {
		const line = plot({
			type: "line",
			title: "Temp",
			data: [
				["Day 9", 4],
				["Day 2", -4],
				["Day 3", 0],
			],
		});
		expect(line.categories?.map(({ label }) => label)).toEqual([
			"Day 9",
			"Day 2",
			"Day 3",
		]);
		expect(line.lines?.[0]?.map(({ y }) => y)).toEqual([1, 0, 0.5]);
		const scatter = plot({
			type: "scatter",
			title: "Price",
			xLabel: "USD",
			yLabel: "Count",
			data: [
				[0, 10],
				[1, 10],
				[10, 10],
			],
		});
		expect(scatter.points).toEqual([
			{ x: 0, y: 0.5 },
			{ x: 0.1, y: 0.5 },
			{ x: 1, y: 0.5 },
		]);
		expect(chartAxisLabels(scatter.left, "en").ticks).toMatchObject([
			{ position: 0.5, label: "10" },
		]);
	});

	it("normalizes large pie weights without overflow and closes the circle", () => {
		const model = inlineChartModel({
			type: "pie",
			title: "Share",
			data: [
				["A", Number.MAX_VALUE],
				["B", Number.MAX_VALUE],
			],
		});
		expect(model).toEqual({
			kind: "pie",
			slices: [
				{ label: "A", start: 0, end: 0.5 },
				{ label: "B", start: 0.5, end: 1 },
			],
		});
	});

	it("places grouped bars side-by-side without changing their common baseline", () => {
		const { bars, left } = plot(
			series("grouped", [
				[2, 0],
				[1, 9],
			]),
		);
		expect(bars?.map(({ from }) => from)).toEqual([
			left.zero,
			left.zero,
			left.zero,
			left.zero,
		]);
		expect(bars?.[0]?.x).toBeLessThan(bars?.[1]?.x ?? 0);
		expect(bars?.[1]?.x).toBeLessThan(bars?.[2]?.x ?? 0);
	});

	it("stacks totals separately above and below zero, including huge magnitudes", () => {
		const max = Number.MAX_VALUE;
		const { bars, left } = plot(
			series("stacked", [
				[max, 4],
				[-max, 0],
				[max, 0],
				[-max, 0],
			]),
		);
		expect(bars?.slice(0, 4).map(({ from, to }) => [from, to])).toEqual([
			[0.5, 0.75],
			[0.5, 0.25],
			[0.75, 1],
			[0.25, 0],
		]);
		expect(
			left.ticks.map(({ value }) => chartTickLabel(value, left.scale, "en")),
		).toEqual(["-3.6e308", "0", "3.6e308"]);
	});

	it("normalizes each category independently to a full 100% stack", () => {
		const { bars, left } = plot(
			series("percent", [
				[3, 1],
				[1, 3],
			]),
		);
		expect(left.unit).toBe("%");
		expect(bars?.map(({ from, to }) => [from, to])).toEqual([
			[0, 0.75],
			[0.75, 1],
			[0, 0.25],
			[0.25, 1],
		]);
	});

	it("keeps dual-axis lines on their own unit scales with a shared zero", () => {
		const chart = series("dual", [
			[100, 1000],
			[-5, 10],
		]);
		chart.series[0] = { label: "Items", axis: "left", values: [100, 1000] };
		chart.series[1] = { label: "Latency", axis: "right", values: [-5, 10] };
		const { left, right, lines, bars } = plot({
			...chart,
			unit: "items",
			rightUnit: "ms",
		});
		expect(left.unit).toBe("items");
		expect(right?.unit).toBe("ms");
		if (!right) throw new Error("Expected the right axis");
		expect(left.scale).toBe(1000);
		expect(right.scale).toBe(10);
		expect(chartAxisLabels(left, "en").ticks.map(({ label }) => label)).toEqual(
			["-500", "0", "1,000"],
		);
		expect(
			chartAxisLabels(right, "en").ticks.map(({ label }) => label),
		).toEqual(["-5", "0", "10"]);
		expect(right?.zero).toBe(left.zero);
		expect(bars).toBeUndefined();
		expect(lines?.[0]?.[0]?.y).toBeCloseTo(0.4);
		expect(lines?.[0]?.[1]?.y).toBe(1);
		expect(lines?.[1]?.map(({ y }) => y)).toEqual([0, 1]);
	});
});

describe("compact chart labels", () => {
	it.each([
		[[10000, 10001, 10002], "10,000", ["0", "1", "2"]],
		[[0.0001, 0.00010001, 0.00010002], "1E-4", ["0", "1.0e-8", "2.0e-8"]],
		[[10, 11, 12], undefined, ["10", "11", "12"]],
		[[9007199254740990, 9007199254740991], "9.00719925474099E15", ["0", "1"]],
	] as const)(
		"distinguishes visible ticks for %j",
		(values, offset, labels) => {
			const { left } = plot({
				type: "line",
				title: "Close readings",
				data: values.map((n, i) => [String(i), n]),
			});
			const actual = chartAxisLabels(left, "en");
			expect(actual.offset).toBe(offset);
			expect(actual.ticks.map(({ label }) => label)).toEqual(labels);
		},
	);

	it("only factors a unanimous interval unit without changing endpoint text", () => {
		const labels = ["0–50 ms", "50–100 ms", "100–150 ms", "150–200 ms"];
		expect(histogramAxisLabels(labels)).toEqual({
			labels: ["0–50", "50–100", "100–150", "150–200"],
			unit: "ms",
		});
		expect(labels[2]).toBe("100–150 ms");
		const mixed = ["0–50 ms", "Other"];
		expect(histogramAxisLabels(mixed)).toEqual({
			labels: mixed,
			unit: undefined,
		});
	});
});
