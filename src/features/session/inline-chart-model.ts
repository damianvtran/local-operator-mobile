/**
 * Pure geometry and formatting for inline `lop-ui` charts.
 *
 * Everything here follows the shared inline-chart design spec (desktop, relay
 * web and this app render the same payloads the same way). The renderer in
 * `components/inline-chart.tsx` owns pixels and gestures; this module owns the
 * decisions that must agree across surfaces — plot height, nice ticks, the zero
 * rule, label thinning, pie folding, keyboard steps and tooltip placement — so
 * they are unit-tested without React Native in the graph.
 *
 * Section references (§n) point at that spec.
 */
import { proportions, stackSegments } from "./inline-series";
import type { CategoryChart, InlineUi } from "./inline-ui-parts";

export type InlineChart = Exclude<
	InlineUi,
	{ type: "table" | "spreadsheet" | "heatmap" }
>;

// §1 — "narrow" is a content box under 520; phones are always narrow.
export const NARROW_WIDTH = 520;
// §1 — margins around the plot. Left is measured from the tick labels.
export const PLOT_MARGIN = { top: 12, right: 12, bottom: 24, minLeft: 28 };
// §2 — RN has no canvas text metrics before layout; the spec's estimate for a
// 12 px tabular label, multiplied by the reader's text scale at the call site.
export const CHAR_WIDTH = 6.6;
// §1 — horizontal bars: 16 bar + 12 gap per category.
export const HORIZONTAL_ROW = 28;

/** §1 — cartesian plot height: 180 at 360 wide, 240 at 760 wide. */
export const plotHeightFor = (width: number) =>
	Math.min(240, Math.max(180, Math.round(width * 0.34)));

/** §3 — donut outer diameter: 200 wide; narrow fits the box with 16 per side. */
export const pieDiameterFor = (width: number) =>
	width >= NARROW_WIDTH ? 200 : Math.max(0, Math.min(180, width - 32));

/** §2 — target tick count: 5 at a 240 plot, 3 at 180. */
export const tickTarget = (plotHeight: number) =>
	Math.min(6, Math.max(3, Math.floor(plotHeight / 48)));

/** §1 — horizontal orientation for long or many-category single-series bars. */
export function horizontalBars(labels: readonly string[], width: number) {
	const longest = Math.max(0, ...labels.map((label) => [...label].length));
	return (
		labels.length > 12 ||
		longest > 12 ||
		(width < NARROW_WIDTH && labels.length > 6)
	);
}

export type Ticks = {
	lo: number;
	hi: number;
	step: number;
	decimals: number;
	values: number[];
};

const NICE = [1, 2, 2.5, 5] as const;

// A step of m×10^k carries max(0,−k) decimals, plus one for 2.5. Computing
// 10^−k by division keeps 0.1-style steps exact enough to label.
const niceStep = (m: number, k: number) => (k < 0 ? m / 10 ** -k : m * 10 ** k);
const stepDecimals = (m: number, k: number) =>
	Math.max(0, -k) + (m === 2.5 && k <= 0 ? 1 : 0);
const roundTo = (n: number, decimals: number) =>
	decimals > 20 ? n : Number(n.toFixed(decimals));
// Floor/ceil in step units with a relative tolerance so 0.3/0.1 = 2.9999…
// does not grow the domain by an extra step.
const EPS = 1e-9;
const floorSteps = (n: number, step: number) => Math.floor(n / step + EPS);
const ceilSteps = (n: number, step: number) => Math.ceil(n / step - EPS);

// Near 2^53 a double cannot hold a 0.2 step (9007199254740990 + 0.2 is
// itself); skip steps finer than a few ulps so every tick is a distinct value.
const representableStep = (a: number, b: number) =>
	Math.max(Math.abs(a), Math.abs(b)) * Number.EPSILON * 8;

function ticksFrom(
	loIndex: number,
	count: number,
	m: number,
	k: number,
): Ticks {
	const step = niceStep(m, k);
	const decimals = stepDecimals(m, k);
	const values = Array.from({ length: count }, (_, i) =>
		roundTo((loIndex + i) * step, decimals),
	);
	return {
		lo: values[0] ?? 0,
		hi: values[values.length - 1] ?? 0,
		step,
		decimals,
		values,
	};
}

/** §2 — flat data pads ±10% of |value|, or ±1 at zero. */
function padFlat(min: number, max: number): [number, number] {
	if (min !== max) return [min, max];
	const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
	return [min - pad, max + pad];
}

/**
 * §2 — nice ticks. Step is the smallest {1, 2, 2.5, 5}×10^k that yields at most
 * `target + 1` ticks once the domain extends outward to whole steps.
 */
export function niceTicks(min: number, max: number, target: number): Ticks {
	const [a, b] = padFlat(min, max);
	const span = b - a;
	// Start two decades below the span so the first candidates are too small.
	let k = Math.floor(Math.log10(span)) - 2;
	const resolution = representableStep(a, b);
	for (let guard = 0; guard < 40; guard++, k++) {
		for (const m of NICE) {
			const step = niceStep(m, k);
			if (step < resolution) continue;
			const lo = floorSteps(a, step);
			const hi = ceilSteps(b, step);
			if (hi - lo + 1 <= target + 1) return ticksFrom(lo, hi - lo + 1, m, k);
		}
	}
	return { lo: a, hi: b, step: span, decimals: 0, values: [a, b] };
}

/**
 * §2 dual axis — the right axis uses the left's tick COUNT so gridlines drawn
 * from the left align with the right labels: the smallest nice step whose
 * `count - 1` steps from the floored minimum reach the maximum.
 */
export function fixedCountTicks(
	min: number,
	max: number,
	count: number,
): Ticks {
	const [a, b] = padFlat(min, max);
	const steps = Math.max(1, count - 1);
	let k = Math.floor(Math.log10(b - a)) - 2;
	const resolution = representableStep(a, b);
	for (let guard = 0; guard < 40; guard++, k++) {
		for (const m of NICE) {
			const step = niceStep(m, k);
			if (step < resolution) continue;
			const lo = floorSteps(a, step);
			if (lo + steps >= ceilSteps(b, step)) return ticksFrom(lo, count, m, k);
		}
	}
	return niceTicks(a, b, steps);
}

/**
 * §2 zero rule. Bars, histogram, grouped, stacked and horizontal always include
 * 0; line and scatter include it only when it is within a third of the range of
 * the data, so 84–154 USD fits to 80–160 instead of flattening against 0.
 */
export function valueExtent(
	values: readonly number[],
	includeZero: boolean,
): [number, number] {
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (includeZero) return [Math.min(0, min), Math.max(0, max)];
	const third = (max - min) / 3;
	return min - third <= 0 && max + third >= 0
		? [Math.min(0, min), Math.max(0, max)]
		: [min, max];
}

export type Axis = Ticks & {
	unit?: string;
	compact: boolean;
	/** Data value → 0 (bottom/left) … 1 (top/right) of the plot. */
	position: (value: number) => number;
};

function toAxis(ticks: Ticks, unit?: string): Axis {
	const range = ticks.hi - ticks.lo || 1;
	return {
		...ticks,
		unit,
		// §2 — compact ticks from a domain magnitude of 10 000.
		compact: Math.max(Math.abs(ticks.lo), Math.abs(ticks.hi)) >= 10_000,
		position: (value) => (value - ticks.lo) / range,
	};
}

// §2 — percent mode is fixed at 0/25/50/75/100 whatever the plot height.
const PERCENT_TICKS: Ticks = {
	lo: 0,
	hi: 1,
	step: 0.25,
	decimals: 0,
	values: [0, 0.25, 0.5, 0.75, 1],
};

/** §2 — units that attach without a space. */
const TIGHT_UNITS = new Set(["%", "‰", "°", "°C", "°F"]);
export const withUnit = (text: string, unit?: string) =>
	!unit ? text : TIGHT_UNITS.has(unit) ? `${text}${unit}` : `${text} ${unit}`;

/** Exact value as authored, grouped, never compact (tooltips and the table). */
export const formatExact = (value: number, locale: string) =>
	new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(value);

/** One-decimal share, e.g. 38.2%. */
export const formatShare = (share: number, locale: string) =>
	new Intl.NumberFormat(locale, {
		style: "percent",
		maximumFractionDigits: 1,
	}).format(share);

/**
 * §2 tick labels: compact from 10 000, else standard with the step's decimals.
 * If compact rounding would print two equal labels (a tiny step on a huge
 * value), fall back to the standard form so every tick stays distinct.
 */
export function tickLabels(axis: Axis, locale: string, percent = false) {
	if (percent)
		return axis.values.map((v) =>
			new Intl.NumberFormat(locale, { style: "percent" }).format(v),
		);
	const standard = new Intl.NumberFormat(locale, {
		minimumFractionDigits: Math.min(20, axis.decimals),
		maximumFractionDigits: Math.min(20, axis.decimals),
	});
	if (axis.compact) {
		const compact = new Intl.NumberFormat(locale, {
			notation: "compact",
			maximumSignificantDigits: 3,
		});
		const labels = axis.values.map((v) => compact.format(v));
		if (new Set(labels).size === labels.length) return labels;
	}
	return axis.values.map((v) => standard.format(v));
}

/** §2 — the axis shows the label part before the first " · " annotation. */
export const axisText = (label: string) => label.split(" · ")[0] ?? label;

/**
 * §2 x-label thinning. Shows indices 0, k, 2k… and always the last; when the
 * last collides with the previous shown label, the previous one goes. Returns
 * each shown index with the width it may use before truncating (k·slot − 8).
 * `edges` = line/scatter, where the first label anchors start and the last end.
 */
export function thinLabels(
	widths: readonly number[],
	slot: number,
	edges: boolean,
): { index: number; maxWidth: number }[] {
	const n = widths.length;
	if (n === 0) return [];
	if (n === 1) return [{ index: 0, maxWidth: Math.max(0, slot - 8) }];
	const widest = Math.max(...widths);
	const k = Math.max(1, Math.ceil((widest + 12) / Math.max(1, slot)));
	const room = k * slot - 8;
	const shown: number[] = [];
	for (let i = 0; i < n; i += k) shown.push(i);
	const last = n - 1;
	if (shown[shown.length - 1] !== last) {
		const previous = shown[shown.length - 1] ?? 0;
		const extent = (i: number) => {
			const w = Math.min(widths[i] ?? 0, room);
			const x = edges ? i * slot : (i + 0.5) * slot;
			if (edges && i === 0) return [x, x + w];
			if (edges && i === last) return [x - w, x];
			return [x - w / 2, x + w / 2];
		};
		// Never drop the first label: first and last always stay visible.
		if (
			previous !== 0 &&
			(extent(previous)[1] ?? 0) + 4 > (extent(last)[0] ?? 0)
		)
			shown.pop();
		shown.push(last);
	}
	return shown.map((index) => ({ index, maxWidth: Math.max(0, room) }));
}

/** §1 bar band: 30% padding, bars ≤ 48, grouped bars 2 apart. Offsets are
 * each series bar's left edge relative to the slot centre. */
export function barBand(
	slot: number,
	seriesCount: number,
	mode: "single" | "grouped" | "stacked" | "histogram",
) {
	if (mode === "histogram") {
		// Spec deviation (recorded in the PR): adjacent bins keep a 2 px gap so
		// a continuous distribution does not read as separate categories.
		const width = Math.max(1, slot - 2);
		return { width, offsets: [-width / 2] };
	}
	const band = slot * 0.7;
	if (mode !== "grouped" || seriesCount <= 1) {
		const width = Math.min(48, band);
		return { width, offsets: [-width / 2] };
	}
	const gap = 2;
	const width = Math.max(
		1,
		Math.min(48, (band - gap * (seriesCount - 1)) / seriesCount),
	);
	const total = width * seriesCount + gap * (seriesCount - 1);
	return {
		width,
		offsets: Array.from(
			{ length: seriesCount },
			(_, i) => -total / 2 + i * (width + gap),
		),
	};
}

export type BarMark = {
	category: number;
	series: number;
	/** Authored value; for percent mode the share is in `share`. */
	value: number;
	share?: number;
	/** Value-axis positions (0…1) of the segment's ends. */
	from: number;
	to: number;
	/** Whether this segment is the outermost one in its direction (rounded). */
	outer: boolean;
};

export type LineSeries = {
	series: number;
	axis: "left" | "right";
	points: { category: number; value: number; y: number }[];
};

export type Cartesian = {
	kind: "cartesian";
	variant:
		| "bar"
		| "histogram"
		| "line"
		| "scatter"
		| "grouped"
		| "stacked"
		| "percent"
		| "dual";
	horizontal: boolean;
	left: Axis;
	right?: Axis;
	/** Scatter only: the numeric x axis. */
	xAxis?: Axis;
	categories: string[];
	series: { label: string; axis: "left" | "right" }[];
	bars?: BarMark[];
	lines?: LineSeries[];
	points?: { x: number; y: number; value: [number, number] }[];
	/** Stacked/percent: each category's sum of authored values. */
	totals?: number[];
};

export type PieSlice = {
	label: string;
	value: number;
	share: number;
	start: number;
	end: number;
	/** Chart palette slot, or `null` for the folded "Other" slice (ink-dim). */
	color: number | null;
	/** Original rows folded into "Other", largest first. */
	folded?: { label: string; value: number }[];
};

export type Pie = { kind: "pie"; slices: PieSlice[]; total: number };

/**
 * §3 — slices sorted by value descending (stable on ties); more than seven fold
 * the smallest into "Other (k)", always last. The data table keeps every row.
 */
export function pieSlices(data: readonly [string, number][]): Pie {
	const sorted = data
		.map(([label, value], index) => ({ label, value, index }))
		.sort((a, b) => b.value - a.value || a.index - b.index);
	const kept = sorted.length > 7 ? sorted.slice(0, 6) : sorted;
	const folded = sorted.length > 7 ? sorted.slice(6) : [];
	const groups = [
		...kept.map(({ label, value }) => ({ label, value, folded: undefined })),
		...(folded.length
			? [
					{
						label: "",
						value: folded.reduce((sum, { value }) => sum + value, 0),
						folded: folded.map(({ label, value }) => ({ label, value })),
					},
				]
			: []),
	];
	const shares = proportions(groups.map(({ value }) => value));
	let end = 0;
	const slices = groups.map((group, i): PieSlice => {
		const start = end;
		end = i === groups.length - 1 ? 1 : Math.min(1, end + (shares[i] ?? 0));
		return {
			...group,
			share: shares[i] ?? 0,
			start,
			end,
			color: group.folded ? null : i,
			...(group.folded ? { folded: group.folded } : {}),
		};
	});
	return {
		kind: "pie",
		slices,
		total: data.reduce((sum, [, value]) => sum + value, 0),
	};
}

/** §5 — shared active-mark state for pointer, touch and keyboard. */
export type ActiveMark = { category: number; series: number };
export type ChartStep =
	| "next"
	| "previous"
	| "up"
	| "down"
	| "first"
	| "last"
	| "clear";

export function stepActive(
	active: ActiveMark | null,
	step: ChartStep,
	categories: number,
	series: number,
): ActiveMark | null {
	if (step === "clear" || categories === 0) return null;
	const current = active ?? { category: 0, series: 0 };
	// The first move from rest lands on mark 0, like focusing the chart.
	if (!active && step !== "last") return current;
	const clamp = (n: number, size: number) => Math.min(size - 1, Math.max(0, n));
	switch (step) {
		case "next":
			return { ...current, category: clamp(current.category + 1, categories) };
		case "previous":
			return { ...current, category: clamp(current.category - 1, categories) };
		case "down":
			return { ...current, series: clamp(current.series + 1, series) };
		case "up":
			return { ...current, series: clamp(current.series - 1, series) };
		case "first":
			return { ...current, category: 0 };
		case "last":
			return { ...current, category: categories - 1 };
	}
}

/** §5 keyboard map (web build and hardware keyboards); others are ignored. */
const KEY_STEPS: Record<string, ChartStep> = {
	ArrowRight: "next",
	ArrowLeft: "previous",
	ArrowDown: "down",
	ArrowUp: "up",
	Home: "first",
	End: "last",
	Escape: "clear",
};
export const keyStep = (key: string): ChartStep | undefined => KEY_STEPS[key];

/**
 * §5 placement: 8 above the anchor, flipped below when it would cross the top,
 * clamped 4 inside the chart box horizontally.
 */
export function tooltipPlacement({
	x,
	top,
	bottom = top,
	width,
	height,
	box,
}: {
	x: number;
	top: number;
	bottom?: number;
	width: number;
	height: number;
	box: number;
}) {
	const above = top - 8 - height;
	const flipped = above < 0;
	return {
		left: Math.max(4, Math.min(box - 4 - width, x - width / 2)),
		top: flipped ? bottom + 8 : above,
		flipped,
	};
}

/** Live-region / `accessibilityValue` text: "Nov 18, Spend, 140.61 USD, 3 of 9". */
export function describeMark(parts: (string | undefined)[], position: string) {
	return [
		...parts.filter((part): part is string => Boolean(part)),
		position,
	].join(", ");
}

/**
 * Normalised model of a cartesian chart for a given plot height (tick count
 * depends on it, §2). Positions are fractions of the plot; the renderer maps
 * them to pixels with the measured width and the spec's margins.
 */
export function inlineChartModel(
	chart: InlineChart,
	plotHeight = 180,
): Cartesian | Pie {
	if (chart.type === "pie") return pieSlices(chart.data);
	const target = tickTarget(plotHeight);
	if (chart.type === "scatter") {
		const xs = chart.data.map(([x]) => x);
		const ys = chart.data.map(([, y]) => y);
		const xAxis = toAxis(
			niceTicks(...valueExtent(xs, false), target),
			chart.xLabel,
		);
		const left = toAxis(
			niceTicks(...valueExtent(ys, false), target),
			chart.yLabel,
		);
		return {
			kind: "cartesian",
			variant: "scatter",
			horizontal: false,
			left,
			xAxis,
			categories: [],
			series: [],
			points: chart.data.map(([x, y]) => ({
				x: xAxis.position(x),
				y: left.position(y),
				value: [x, y],
			})),
		};
	}
	if (chart.type !== "series") {
		const values = chart.data.map(([, n]) => n);
		const categories = chart.data.map(([label]) => label);
		const line = chart.type === "line";
		const left = toAxis(
			niceTicks(...valueExtent(values, !line), target),
			chart.unit,
		);
		const base = {
			kind: "cartesian" as const,
			left,
			categories,
			series: [{ label: "", axis: "left" as const }],
		};
		if (line)
			return {
				...base,
				variant: "line",
				horizontal: false,
				lines: [
					{
						series: 0,
						axis: "left",
						points: values.map((value, category) => ({
							category,
							value,
							y: left.position(value),
						})),
					},
				],
			};
		return {
			...base,
			variant: chart.type,
			horizontal: false,
			bars: values.map((value, category) => ({
				category,
				series: 0,
				value,
				from: left.position(0),
				to: left.position(value),
				outer: true,
			})),
		};
	}

	const { labels, series, mode } = chart;
	const meta = series.map(({ label, axis }) => ({
		label,
		axis:
			mode === "dual" && axis === "right"
				? ("right" as const)
				: ("left" as const),
	}));
	if (mode === "dual") {
		const side = (which: "left" | "right") =>
			series.flatMap(({ values }, i) =>
				meta[i]?.axis === which ? values : [],
			);
		const leftValues = side("left");
		const rightValues = side("right");
		const left = toAxis(
			niceTicks(
				...valueExtent(leftValues.length ? leftValues : [0], false),
				target,
			),
			chart.unit,
		);
		const right = rightValues.length
			? toAxis(
					fixedCountTicks(
						...valueExtent(rightValues, false),
						left.values.length,
					),
					chart.rightUnit,
				)
			: undefined;
		return {
			kind: "cartesian",
			variant: "dual",
			horizontal: false,
			left,
			right,
			categories: labels,
			series: meta,
			lines: series.map(({ values }, i) => {
				const axis = meta[i]?.axis === "right" && right ? right : left;
				return {
					series: i,
					axis: axis === left ? "left" : "right",
					points: values.map((value, category) => ({
						category,
						value,
						y: axis.position(value),
					})),
				};
			}),
		};
	}

	// Decoding guarantees a value for every category of every series.
	const byCategory = labels.map((_, i) => series.map((s) => s.values[i] ?? 0));
	const stacked = mode === "stacked" || mode === "percent";
	const shares = byCategory.map((values) => proportions(values));
	const segments = byCategory.map((values, i) =>
		stackSegments(mode === "percent" ? (shares[i] ?? []) : values),
	);
	const left =
		mode === "percent"
			? toAxis(PERCENT_TICKS, "%")
			: toAxis(
					niceTicks(
						...valueExtent(
							stacked ? segments.flat(2) : byCategory.flat(),
							true,
						),
						target,
					),
					chart.unit,
				);
	const bars: BarMark[] = segments.flatMap((category, i) => {
		// The outermost segment per direction gets the rounded corners.
		const lastPositive = category.findLastIndex(([from, to]) => to > from);
		const lastNegative = category.findLastIndex(([from, to]) => to < from);
		return category.map(([from, to], j) => ({
			category: i,
			series: j,
			value: byCategory[i]?.[j] ?? 0,
			// "x% of total" only means something when every part is positive:
			// a signed stack (gains and losses) has no whole to be a share of.
			...(stacked && byCategory[i]?.every((n) => n >= 0)
				? { share: shares[i]?.[j] ?? 0 }
				: {}),
			from: left.position(stacked ? from : 0),
			to: left.position(stacked ? to : (byCategory[i]?.[j] ?? 0)),
			outer: !stacked || j === lastPositive || j === lastNegative,
		}));
	});
	return {
		kind: "cartesian",
		variant: mode,
		horizontal: false,
		left,
		categories: labels,
		series: meta,
		bars,
		...(stacked
			? {
					totals: byCategory.map((values) => values.reduce((a, b) => a + b, 0)),
				}
			: {}),
	};
}

/**
 * §1 horizontal bars reuse the bar model with the value axis along x; its tick
 * count follows the plot WIDTH (one tick per ~96 px, clamped 3–6).
 */
export function horizontalBarModel(
	chart: CategoryChart,
	plotWidth: number,
): Cartesian {
	const values = chart.data.map(([, n]) => n);
	const target = Math.min(6, Math.max(3, Math.floor(plotWidth / 96)));
	const left = toAxis(
		niceTicks(...valueExtent(values, true), target),
		chart.unit,
	);
	return {
		kind: "cartesian",
		variant: "bar",
		horizontal: true,
		left,
		categories: chart.data.map(([label]) => label),
		series: [{ label: "", axis: "left" }],
		bars: values.map((value, category) => ({
			category,
			series: 0,
			value,
			from: left.position(0),
			to: left.position(value),
			outer: true,
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
