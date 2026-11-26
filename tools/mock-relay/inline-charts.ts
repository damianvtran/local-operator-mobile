import type { SessionProjection } from "../../docs/relay/types.ts";
import type { InlineUi } from "../../src/features/session/inline-ui-parts.ts";
import type { Json } from "../lib/json.ts";
import type { ScenarioWorld } from "./scenarios.ts";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday"];
const parts = [
	{ label: "Local", values: [4, 6, 2, 10] },
	{ label: "Relay", values: [6, 2, 6, 5] },
	{ label: "Desktop", values: [2, 2, 4, 4] },
];
export const inlineChartExamples: (InlineUi & Json)[] = [
	{
		type: "bar",
		title: "Balance by day",
		unit: "USD",
		data: [
			["Mon", -12],
			["Tue", 7],
			["Wed", 0],
			["Thu", 16],
		],
	},
	{
		type: "histogram",
		title: "Request latency",
		unit: "requests",
		data: [
			["0–50 ms", 2],
			["50–100 ms", 12],
			["100–150 ms", 7],
			["150–200 ms", 1],
		],
	},
	{
		type: "line",
		title: "Morning temperature",
		unit: "°C",
		data: [
			["Mon", -2],
			["Tue", 3],
			["Wed", 1.765],
			["Thu", 7],
			["Fri", 5],
		],
	},
	// The operator's report (2026-11-26): an 84–154 USD series drew against a
	// zero baseline with three ticks. It must fit to 80–160 in 20 USD steps,
	// show "Nov 24" on the axis and keep "Nov 24 · rollout" for the tooltip.
	{
		type: "line",
		title: "Datadog daily allocated spend through Nov 24 (UTC)",
		unit: "USD",
		data: [
			["Nov 16", 153.66],
			["Nov 17", 143.37],
			["Nov 18", 140.61],
			["Nov 19", 141.67],
			["Nov 20", 126.94],
			["Nov 21", 118.38],
			["Nov 22 · PDF ends", 109.2],
			["Nov 23", 124.37],
			["Nov 24 · rollout", 84.04],
		],
	},
	// 32 categories at phone width: label thinning, compact ticks (≥ 10 000)
	// and no resting dots past 12 points.
	{
		type: "line",
		title: "Requests per day",
		unit: "requests",
		data: Array.from({ length: 32 }, (_, i): [string, number] => [
			`Oct ${i + 1}`,
			12_000 + ((i * 7919) % 9000) + i * 250,
		]),
	},
	// Long labels switch a single-series bar chart to horizontal rows.
	{
		type: "bar",
		title: "Spend by team",
		unit: "USD",
		data: [
			["Platform infrastructure", 4210.5],
			["Data engineering", 3120],
			["Mobile clients", 1875.25],
			["Customer support tooling", 940],
			["Security", 610.75],
		],
	},
	// Twelve items: the six largest plus "Other (6)"; slices under 3% get no
	// direct label on wide boxes. The data table still lists all twelve.
	{
		type: "pie",
		title: "Cloud spend by service",
		unit: "USD",
		data: [
			["Compute", 4120],
			["Storage", 2380],
			["Database", 1990],
			["Networking", 1210],
			["Observability", 930],
			["CDN", 610],
			["Queues", 240],
			["Search", 190],
			["DNS", 60],
			["Secrets", 45],
			["Email", 30],
			["Backups", 25],
		],
	},
	{
		type: "pie",
		title: "Time by area",
		unit: "hours",
		data: [
			["Build", 17],
			["Test", 11],
			["Review", 9],
			["Release", 3],
		],
	},
	{
		type: "scatter",
		title: "Price and demand",
		xLabel: "Price (USD)",
		yLabel: "Orders",
		data: [
			[20, 37],
			[40, 53],
			[83, 36],
			[100, 20],
			[112, 28],
		],
	},
	{
		type: "heatmap",
		title: "Weekly changes",
		columns: ["AM", "PM"],
		rowLabels: days,
		unit: "°C",
		rows: [
			[-4, 2],
			[null, 6],
			[4, -6],
			[0, null],
		],
	},
	{
		type: "series",
		title: "Tasks by client",
		mode: "grouped",
		labels: days,
		series: parts,
		unit: "tasks",
	},
	{
		type: "series",
		title: "Signed activity",
		mode: "stacked",
		labels: days,
		unit: "events",
		series: [
			...parts.slice(0, 2),
			{ label: "Removed", values: [-2, -8, -4, -3] },
			{ label: "Expired", values: [-4, -1, -3, -2] },
		],
	},
	{
		type: "series",
		title: "Client share",
		mode: "percent",
		labels: days,
		series: parts,
		unit: "tasks",
	},
	{
		type: "series",
		title: "Throughput and latency",
		mode: "dual",
		labels: days,
		unit: "requests",
		rightUnit: "ms",
		series: [
			{ label: "Throughput", axis: "left", values: [400, 800, 560, 720] },
			{ label: "Latency", axis: "right", values: [16, 6, 9, 18] },
		],
	},
];

export type InlineUiFixture = {
	sessionId: string;
	messages: Record<string, Json>;
};

export function inlineChartWorld(seed: SessionProjection): ScenarioWorld {
	const projection = structuredClone(seed);
	projection.conversation_name = "Inline chart examples";
	const assistant = projection.transcript.find(
		(row) => row.kind === "assistant",
	);
	if (!assistant) throw new Error("Chart fixture needs an assistant row");
	const prefix =
		"A literal lop-ui code example must remain code:\n\n```lop-ui\n";
	const code = '{"type":"pie","title":"Literal fence","data":[["A",1]]}\n```';
	const messages: Record<string, Json> = {};
	projection.transcript = [
		{ ...assistant, id: "chart-literal-fence", text: prefix + code },
		...inlineChartExamples.map((payload, i) => {
			const id = `chart-${i}`;
			messages[id] = {
				version: 1,
				text: "",
				widgets: [{ offset: 0, payload }],
			};
			return { ...assistant, id, text: `${payload.title} (legacy text)` };
		}),
	];
	return {
		projections: { [projection.session_id]: projection },
		inlineUi: { sessionId: projection.session_id, messages },
	};
}
