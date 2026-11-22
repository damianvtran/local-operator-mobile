import { decodeInlineSeries, type InlineSeries } from "./inline-series";

export type CategoryChart = {
	type: "bar" | "line" | "pie" | "histogram";
	title: string;
	unit?: string;
	data: [string, number][];
};
type Table = {
	type: "table";
	title: string;
	columns: string[];
	rows: (string | number)[][];
};
export type Scatter = {
	type: "scatter";
	title: string;
	xLabel: string;
	yLabel: string;
	data: [number, number][];
};
export type Heatmap = {
	type: "heatmap";
	title: string;
	unit?: string;
	columns: string[];
	rowLabels: string[];
	rows: (number | null)[][];
};
type Spreadsheet = {
	type: "spreadsheet";
	title: string;
	columns: string[];
	rows: (string | number | null)[][];
};
export type InlineUi =
	| CategoryChart
	| Scatter
	| Table
	| Spreadsheet
	| Heatmap
	| InlineSeries;
export type AssistantPart =
	| { kind: "markdown"; text: string }
	| { kind: "ui"; value: InlineUi };

// This is a display budget, not a transcript limit: bound validation and the
// number of mounted cells without clipping a dataset into a misleading chart.
const MAX_ROWS = 32;
const MAX_COLUMNS = 8;
const isText = (value: unknown): value is string =>
	typeof value === "string" && value.length <= 256;
const isLabel = (value: unknown): value is string =>
	isText(value) && value.trim().length > 0;
const isNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

export function decodeInlineUi(value: unknown): InlineUi | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const { type, title, unit, data, columns, rows, rowLabels, xLabel, yLabel } =
		record;
	if (type === "series") return decodeInlineSeries(record);
	if (!isLabel(title)) return null;
	if (
		type === "bar" ||
		type === "line" ||
		type === "pie" ||
		type === "histogram"
	) {
		if (
			(unit !== undefined && !isText(unit)) ||
			!Array.isArray(data) ||
			data.length === 0 ||
			data.length > MAX_ROWS ||
			!data.every(
				(point): point is [string, number] =>
					Array.isArray(point) &&
					point.length === 2 &&
					isLabel(point[0]) &&
					isNumber(point[1]) &&
					(type !== "pie" || point[1] > 0) &&
					(type !== "histogram" || point[1] >= 0),
			)
		)
			return null;
		return { type, title, unit, data };
	}
	if (type === "scatter") {
		if (
			!isLabel(xLabel) ||
			!isLabel(yLabel) ||
			!Array.isArray(data) ||
			data.length === 0 ||
			data.length > MAX_ROWS ||
			!data.every(
				(point): point is [number, number] =>
					Array.isArray(point) && point.length === 2 && point.every(isNumber),
			)
		)
			return null;
		return { type, title, xLabel, yLabel, data };
	}
	if (type === "table" || type === "spreadsheet" || type === "heatmap") {
		if (
			!Array.isArray(columns) ||
			columns.length === 0 ||
			columns.length > MAX_COLUMNS ||
			!columns.every(isLabel) ||
			!Array.isArray(rows) ||
			rows.length > MAX_ROWS ||
			!rows.every((row) => Array.isArray(row) && row.length === columns.length)
		)
			return null;
		if (type === "heatmap") {
			if (
				(unit !== undefined && !isText(unit)) ||
				!Array.isArray(rowLabels) ||
				rowLabels.length !== rows.length ||
				!rowLabels.every(isLabel) ||
				!rows.every((row): row is (number | null)[] =>
					row.every((cell: unknown) => cell === null || isNumber(cell)),
				)
			)
				return null;
			return { type, title, unit, columns, rowLabels, rows };
		}
		const isValue = (cell: unknown): cell is string | number =>
			isText(cell) || isNumber(cell);
		if (type === "spreadsheet") {
			if (
				!rows.every((row): row is (string | number | null)[] =>
					row.every((cell: unknown) => cell === null || isValue(cell)),
				)
			)
				return null;
			return { type, title, columns, rows };
		}
		if (!rows.every((row): row is (string | number)[] => row.every(isValue)))
			return null;
		return { type, title, columns, rows };
	}
	return null;
}
