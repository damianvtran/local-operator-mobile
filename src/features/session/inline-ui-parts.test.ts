import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import { decodeInlineUi } from "./inline-ui-parts";
import { LIVE_INLINE_UI, withInlineUi } from "./live-inline-ui";
import { reuseRows } from "./row-identity";

const bar = { type: "bar", title: "Readings", data: [["A", -2]] };
const row = {
	id: "answer",
	kind: "assistant",
	text: "Legacy!",
} as TranscriptEntry;
const message = (widgets: unknown, text = "A😀\r\nB") => ({
	version: 1,
	text,
	widgets,
});
const wire = (answer: unknown) => ({ version: 1, messages: { answer } });
const placement = (offset: number, payload: unknown = bar) => ({
	offset,
	payload,
});

it("uses exact UTF-16 offsets and retains provider order at identical offsets", () => {
	const [rich] = withInlineUi(
		wire(message([placement(3), placement(3), placement(5)])),
		[row],
	);
	expect(rich?.text).toBe("Legacy!");
	expect(rich?.[LIVE_INLINE_UI]).toEqual([
		{ kind: "markdown", text: "A😀" },
		{ kind: "ui", value: bar },
		{ kind: "ui", value: bar },
		{ kind: "markdown", text: "\r\n" },
		{ kind: "ui", value: bar },
		{ kind: "markdown", text: "B" },
	]);
});

it.each([
	undefined,
	{ version: 2, text: "", widgets: [placement(0)] },
	{ version: 1, widgets: [placement(0)] },
	message([]),
	message([placement(-1)]),
	message([placement(2)]), // inside the emoji's surrogate pair
	message([placement(8)]),
	message([placement(1.2)]),
	message([placement(5), placement(3)]),
	message([placement(0), placement(1, { type: "unknown" })]),
])(
	"leaves legacy prose untouched when one message envelope is invalid (%#)",
	(envelope) => {
		expect(withInlineUi(wire(envelope), [row])[0]).toBe(row);
	},
);

it("does not associate a widget with unknown, non-assistant or ambiguous row ids", () => {
	const overlay = wire(message([placement(0)]));
	const different = { ...row, id: "other-answer" };
	const user = { ...row, kind: "user" as const };
	const duplicate = { ...row, text: "Other answer with the same id" };
	const rows = [different, user, row, duplicate];
	expect(withInlineUi(overlay, rows)).toEqual(rows);
});

it("updates an aligned or moved memoized row when only the typed presentation changes", () => {
	const rich = withInlineUi(wire(message([placement(0)])), [row])[0];
	if (!rich) throw new Error("Expected rich row");
	const user = { ...row, id: "prompt", kind: "user" as const };
	expect(reuseRows([rich, user], [row, user])[0]).toBe(row);
	expect(reuseRows([rich, user], [user, row])[1]).toBe(row);
});

describe("native inline UI catalog", () => {
	const title = "Readings";
	const labels = ["A"];
	const series = [{ label: "Count", values: [1] }];
	const base = { type: "series", title, labels, series };
	it.each([
		bar,
		...(["line", "histogram", "pie"] as const).map((type) => ({
			type,
			title,
			data: [["A", 1]],
		})),
		{ type: "scatter", title, xLabel: "X", yLabel: "Y", data: [[1, -2]] },
		{ type: "table", title, columns: labels, rows: [["α"]] },
		{ type: "spreadsheet", title, columns: labels, rows: [[null], [1]] },
		{
			type: "heatmap",
			title,
			columns: labels,
			rowLabels: labels,
			rows: [[null]],
		},
		...(["grouped", "stacked", "percent"] as const).map((mode) => ({
			...base,
			mode,
		})),
		{
			...base,
			mode: "dual",
			unit: "items",
			rightUnit: "Hz",
			series: [
				{ ...series[0], axis: "left" },
				{ label: "Rate", axis: "right", values: [2] },
			],
		},
	])("decodes valid $type $mode data", (payload) => {
		expect(decodeInlineUi(payload)).toMatchObject(payload);
	});

	it.each([
		{ ...bar, data: [["A", Infinity]] },
		{ ...bar, type: "pie" },
		{ ...base, mode: "percent", series: [{ label: "Zero", values: [0] }] },
	])("does not admit invalid numeric data (%#)", (payload) => {
		expect(decodeInlineUi(payload)).toBeNull();
	});
});
