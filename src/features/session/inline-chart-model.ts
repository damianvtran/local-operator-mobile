import { proportions, scaledSeries, stackSegments } from "./inline-series";
import type { InlineUi } from "./inline-ui-parts";

export type InlineChart = Exclude<
	InlineUi,
	{ type: "table" | "spreadsheet" | "heatmap" }
>;

type Point = { x: number; y: number };
type Bar = {
	x: number;
	width: number;
	from: number;
	to: number;
	color: number;
};
type Tick = { position: number; value: number };
type Axis = { ticks: Tick[]; unit?: string; zero: number; scale: number };

// Line and scatter domains can zoom into nearby nonzero values. In the
// wire domain, their absolute coordinates cannot overflow; keeping those
// values avoids rounding their axis origin through normalization.
const axisScale = (values: readonly number[]) => {
	const max = scaledSeries(values);
	return max <= Number.MAX_SAFE_INTEGER ? 1 : max;
};

type Cartesian = {
	kind: "cartesian";
	left: Axis;
	right?: Axis;
	xAxis?: Axis;
	categories?: { label: string; position: number }[];
	legend?: string[];
	bars?: Bar[];
	lines?: Point[][];
	points?: Point[];
};

type Pie = {
	kind: "pie";
	slices: { label: string; start: number; end: number }[];
};

function extent(values: readonly number[], zero: boolean): [number, number] {
	const min = Math.min(zero ? 0 : Infinity, ...values);
	const max = Math.max(zero ? 0 : -Infinity, ...values);
	// An all-zero bar plot keeps its baseline at the bottom. A constant line
	// or scatter axis gets a single measured tick, not an invented range.
	if (zero && min === max) return [0, 1];
	return [min, max];
}

function axis([min, max]: [number, number], scale: number, unit?: string) {
	const constant = min === max;
	const position = (n: number) =>
		constant ? (n === min ? 0.5 : -1) : (n - min) / (max - min);
	const middle = min < 0 && max > 0 ? 0 : (min + max) / 2;
	return {
		position,
		scale,
		unit,
		zero: position(0),
		ticks: [...new Set(constant ? [min] : [min, middle, max])].map((value) => ({
			position: position(value),
			value,
		})),
	};
}

export function inlineChartModel(chart: InlineChart): Cartesian | Pie {
	if (chart.type === "pie") {
		const shares = proportions(chart.data.map(([, n]) => n));
		let end = 0;
		return {
			kind: "pie",
			slices: chart.data.map(([label], i) => {
				const start = end;
				end = i === shares.length - 1 ? 1 : Math.min(1, end + (shares[i] ?? 0));
				return { label, start, end };
			}),
		};
	}
	if (chart.type === "scatter") {
		const xs = chart.data.map(([x]) => x);
		const ys = chart.data.map(([, y]) => y);
		const sx = axisScale(xs);
		const sy = axisScale(ys);
		const xAxis = axis(
			extent(
				xs.map((x) => x / sx),
				false,
			),
			sx,
			chart.xLabel,
		);
		const left = axis(
			extent(
				ys.map((y) => y / sy),
				false,
			),
			sy,
			chart.yLabel,
		);
		return {
			kind: "cartesian",
			left,
			xAxis,
			points: chart.data.map(([x, y]) => ({
				x: xAxis.position(x / sx),
				y: left.position(y / sy),
			})),
		};
	}
	if (chart.type !== "series") {
		const values = chart.data.map(([, n]) => n);
		const line = chart.type === "line";
		const scale = line ? axisScale(values) : scaledSeries(values);
		const scaled = values.map((n) => n / scale);
		const left = axis(extent(scaled, !line), scale, chart.unit);
		const width = 1 / values.length;
		const center = (i: number) => (i + 0.5) * width;
		const categories = chart.data.map(([label], i) => ({
			label,
			position: center(i),
		}));
		return line
			? {
					kind: "cartesian",
					left,
					categories,
					lines: [
						scaled.map((n, i) => ({
							x: center(i),
							y: left.position(n),
						})),
					],
				}
			: {
					kind: "cartesian",
					left,
					categories,
					bars: scaled.map((n, i) => ({
						x: center(i),
						width: width * (chart.type === "histogram" ? 1 : 0.68),
						from: left.zero,
						to: left.position(n),
						color: 0,
					})),
				};
	}

	const { labels, series, mode } = chart;
	const dual = mode === "dual";
	const scaleFor = (side: "left" | "right") =>
		scaledSeries(
			series.flatMap(({ values, axis }) =>
				!dual || axis === side ? values : [],
			),
		);
	const leftScale = mode === "percent" ? 100 : scaleFor("left");
	const rightScale = dual ? scaleFor("right") : leftScale;
	const scaledCategories = labels.map((_, i) => {
		// Decoding guarantees a value for every category of every series.
		const values = series.map((item) => item.values[i] ?? 0);
		return mode === "percent"
			? proportions(values)
			: values.map(
					(n, j) =>
						n / (dual && series[j]?.axis === "right" ? rightScale : leftScale),
				);
	});
	const stacked = mode === "stacked" || mode === "percent";
	const segments = scaledCategories.map((values) =>
		stacked
			? stackSegments(values)
			: values.map((n): [number, number] => [0, n]),
	);
	// Independent units/scales, shared zero. Taking the union in normalized
	// coordinates aligns the baselines without mixing the actual quantities.
	const domain: [number, number] =
		mode === "percent" ? [0, 1] : extent(segments.flat(2), true);
	const left = axis(domain, leftScale, mode === "percent" ? "%" : chart.unit);
	const right = dual ? axis(domain, rightScale, chart.rightUnit) : undefined;
	const slot = 1 / labels.length;
	const center = (i: number) => (i + 0.5) * slot;
	const groupWidth = slot * 0.76;
	const barWidth = stacked ? groupWidth : groupWidth / series.length;
	const categories = labels.map((label, i) => ({
		label,
		position: center(i),
	}));
	const legend = series.map(({ label }) => label);
	// Dual series are trends, as on desktop. Each line projects against its own
	// labelled rail, never against the other quantity or a combined total.
	if (right) {
		return {
			kind: "cartesian",
			left,
			right,
			categories,
			legend,
			lines: series.map(({ axis, values }) => {
				const y = axis === "right" ? right : left;
				return values.map((n, i) => ({
					x: center(i),
					y: y.position(n / y.scale),
				}));
			}),
		};
	}
	return {
		kind: "cartesian",
		left,
		categories,
		legend,
		bars: segments.flatMap((category, i) =>
			category.map(([from, to], j) => {
				return {
					x: center(i) + (stacked ? 0 : (j + 0.5) * barWidth - groupWidth / 2),
					width: barWidth,
					from: left.position(from),
					to: left.position(to),
					color: j,
				};
			}),
		),
	};
}

/** Compact labels never replace the exact original numbers in the grid. Keep
 * cumulative tick labels finite even when a valid input overflows in raw units. */
export function chartTickLabel(
	value: number,
	scale: number,
	locale: string,
): string {
	const number = value * scale;
	const magnitude = Math.abs(number);
	if (
		Number.isFinite(number) &&
		(number === 0 || (magnitude >= 0.01 && magnitude < 10_000))
	) {
		return new Intl.NumberFormat(locale, {
			maximumSignificantDigits: 3,
		}).format(number);
	}
	if (Number.isFinite(number)) return number.toExponential(1);
	const exponent = Math.floor(Math.log10(scale));
	return `${(value * (scale / 10 ** exponent)).toFixed(1)}e${exponent}`;
}

/** If compact absolute labels collide, put their shared origin in the axis
 * caption. The rails can show small deltas without clipping extra digits. */
export function chartAxisLabels(axis: Axis, locale: string) {
	const ticks = axis.ticks.map((tick) => ({
		...tick,
		label: chartTickLabel(tick.value, axis.scale, locale),
	}));
	const absolute = { ticks, offset: undefined };
	if (new Set(ticks.map(({ label }) => label)).size === ticks.length)
		return absolute;

	const first = ticks[0];
	if (!first) return absolute;
	const origin = first.value * axis.scale;
	if (!Number.isFinite(origin)) return absolute;
	const distinct = ticks.map(({ value, position }) => ({
		value,
		position,
		delta: (value - first.value) * axis.scale,
	}));
	const originMagnitude = Math.abs(origin);
	const exactOrigin = new Intl.NumberFormat(locale, {
		notation:
			originMagnitude !== 0 &&
			(originMagnitude < 0.001 || originMagnitude >= 1e9)
				? "scientific"
				: "standard",
		maximumSignificantDigits: 17,
	}).format(origin);
	return {
		offset: exactOrigin,
		ticks: distinct.map(({ value, position, delta }) => ({
			value,
			position,
			label: chartTickLabel(delta, 1, locale),
		})),
	};
}

/** A histogram's count unit is not the interval unit. Only lift a common
 * suffix when every label is a numeric range with that same suffix; custom
 * or mixed labels keep their original text. The exact grid never uses this. */
const INTERVAL_WITH_UNIT =
	/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*–\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+(\S.*)$/u;

export function histogramAxisLabels(labels: readonly string[]) {
	const parsed = labels.map((label) => INTERVAL_WITH_UNIT.exec(label));
	const unit = parsed[0]?.[2];
	if (!unit || !parsed.every((match) => match?.[2] === unit))
		return { labels, unit: undefined };
	return { labels: parsed.map((match) => match?.[1] ?? ""), unit };
}
