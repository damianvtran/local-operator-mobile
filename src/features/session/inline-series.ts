type SeriesAxis = "left" | "right";
type Series = { label: string; values: number[]; axis?: SeriesAxis };

export type InlineSeries = {
	type: "series";
	title: string;
	mode: "grouped" | "stacked" | "percent" | "dual";
	labels: string[];
	series: Series[];
	unit?: string;
	rightUnit?: string;
};

const MAX_CATEGORIES = 32;
const MAX_SERIES = 4;
const isText = (value: unknown): value is string =>
	typeof value === "string" && value.length <= 256;
const isLabel = (value: unknown): value is string =>
	isText(value) && value.trim().length > 0;
// JSON.parse has already rounded an unsafe integer by this point. Core
// sends out-of-domain grid numbers as strings and leaves unsupported plots
// as prose; reject old or malformed overlays rather than claim rounded data
// is exact. Fractional values within the shared domain are still numbers.
export const isInlineNumber = (value: unknown): value is number =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	Math.abs(value) <= Number.MAX_SAFE_INTEGER;

/** Work in relative units for ratios, and keep chart geometry safe even for
 * standalone callers with values outside the decoded wire domain. */
export function scaledSeries(values: readonly number[]): number {
	return values.reduce((max, n) => Math.max(max, Math.abs(n)), 0) || 1;
}

/** A percent stack normalizes each category independently; at least one
 * positive member is guaranteed by the decoder. Pie shares the same math. */
export function proportions(values: readonly number[]): number[] {
	const scale = scaledSeries(values);
	const scaled = values.map((n) => n / scale);
	const total = scaled.reduce((sum, n) => sum + n, 0);
	return scaled.map((n) => (total === 0 ? 0 : n / total));
}

/** Positive and negative segments build outwards from zero independently. */
export function stackSegments(values: readonly number[]): [number, number][] {
	let positive = 0;
	let negative = 0;
	return values.map((n) => {
		if (n < 0) {
			const start = negative;
			negative += n;
			return [start, negative];
		}
		const start = positive;
		positive += n;
		return [start, positive];
	});
}

export function decodeInlineSeries(
	value: Record<string, unknown>,
): InlineSeries | null {
	const { type, title, mode, labels, unit, rightUnit } = value;
	if (
		type !== "series" ||
		!isLabel(title) ||
		(mode !== "grouped" &&
			mode !== "stacked" &&
			mode !== "percent" &&
			mode !== "dual") ||
		(unit !== undefined && !isText(unit)) ||
		(rightUnit !== undefined && !isText(rightUnit)) ||
		!Array.isArray(labels) ||
		labels.length === 0 ||
		labels.length > MAX_CATEGORIES ||
		!Array.from(labels).every(isLabel) ||
		!Array.isArray(value.series) ||
		value.series.length === 0 ||
		value.series.length > MAX_SERIES
	) {
		return null;
	}

	const series: Series[] = [];
	for (const input of value.series) {
		if (!input || typeof input !== "object" || Array.isArray(input))
			return null;
		const { label, values, axis } = input as Record<string, unknown>;
		if (
			!isLabel(label) ||
			!Array.isArray(values) ||
			values.length !== labels.length ||
			!Array.from(values).every(isInlineNumber) ||
			(axis !== undefined && axis !== "left" && axis !== "right") ||
			(mode === "dual" && axis === undefined)
		) {
			return null;
		}
		series.push(
			axis === undefined ? { label, values } : { label, values, axis },
		);
	}

	if (
		mode === "dual" &&
		(!isLabel(unit) ||
			!isLabel(rightUnit) ||
			!series.some(({ axis }) => axis === "left") ||
			!series.some(({ axis }) => axis === "right"))
	)
		return null;

	// With no negatives, a positive member suffices to prove a positive total;
	// there's no need to sum a category again during decode.
	if (
		mode === "percent" &&
		(series.some(({ values }) => values.some((n) => n < 0)) ||
			labels.some(
				(_, index) => !series.some(({ values }) => (values[index] ?? 0) > 0),
			))
	)
		return null;

	return {
		type,
		title,
		mode,
		labels,
		series,
		...(unit === undefined ? {} : { unit }),
		...(rightUnit === undefined ? {} : { rightUnit }),
	};
}
