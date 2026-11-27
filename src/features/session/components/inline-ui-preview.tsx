// biome-ignore-all lint/suspicious/noArrayIndexKey: a decoded payload replaces the whole matrix; positions identify cells even when labels repeat.
import { createContext, useContext, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import {
	formatExact,
	type PlotChart,
	withUnit,
} from "@/features/session/inline-chart-model";
import type { InlineUi } from "@/features/session/inline-ui-parts";
import { activeLocale, t } from "@/i18n";
import { useTokenColor } from "@/ui/appearance";
import { TEXT_END_CLASS } from "@/ui/direction";
import { InlineChartPlot } from "./inline-chart";

/** A numeric cell of a chart's data table, kept as a number so the table can
 * format it like the tooltip does (Q5); `rows` keeps the authored text for
 * plain-text copy. */
type Measure = { value: number; unit?: string };

export type InlineUiData = {
	title: string;
	header?: string[];
	rows: string[][];
	measures?: (Measure | null)[][];
	chart?: PlotChart;
};

const cell = (value: string | number | null) =>
	value === null ? "—" : String(value);
// Exact as authored. `withUnit` applies the shared spacing rule (§2 Units):
// "42%" and "21.5°C" stay tight, every other unit takes one space.
const measure = (value: number, unit?: string) => withUnit(String(value), unit);

export function inlineUiData(value: InlineUi): InlineUiData {
	const { title } = value;
	switch (value.type) {
		case "table":
		case "spreadsheet":
			return {
				title,
				header: value.columns,
				rows: value.rows.map((row) => row.map(cell)),
			};
		case "heatmap":
			// §4: heatmaps are charts now — cells are marks, exact values sit in
			// the Chart data table like every other chart.
			return {
				title,
				chart: value,
				header: ["", ...value.columns],
				rows: value.rows.map((row, index) => [
					value.rowLabels[index] ?? "",
					...row.map((n) => (n === null ? cell(n) : measure(n, value.unit))),
				]),
				measures: value.rows.map((row) => [
					null,
					...row.map((n) =>
						n === null ? null : { value: n, unit: value.unit },
					),
				]),
			};
		case "scatter":
			return {
				title,
				chart: value,
				header: [value.xLabel, value.yLabel],
				rows: value.data.map((point) => point.map(cell)),
				measures: value.data.map((point) => point.map((n) => ({ value: n }))),
			};
		case "series":
			return {
				title,
				chart: value,
				header: ["", ...value.series.map(({ label }) => label)],
				// Preview original values, not percent/stack transformations. Dual-axis
				// values keep their own units rather than sharing a misleading scale.
				rows: value.labels.map((label, i) => [
					label,
					...value.series.map(({ values, axis }) => {
						const n = values[i];
						const unit =
							axis === "right" && value.mode === "dual"
								? value.rightUnit
								: value.unit;
						return n === undefined ? "" : measure(n, unit);
					}),
				]),
				measures: value.labels.map((_, i) => [
					null,
					...value.series.map(({ values, axis }) => {
						const n = values[i];
						const unit =
							axis === "right" && value.mode === "dual"
								? value.rightUnit
								: value.unit;
						return n === undefined ? null : { value: n, unit };
					}),
				]),
			};
		default:
			return {
				title,
				chart: value,
				rows: value.data.map(([label, n]) => [label, measure(n, value.unit)]),
				measures: value.data.map(([, n]) => [
					null,
					{ value: n, unit: value.unit },
				]),
			};
	}
}

export const inlineUiPlainText = ({ title, header, rows }: InlineUiData) =>
	[
		title,
		...(header ? [header.join("\t")] : []),
		...rows.map((row) => row.join("\t")),
	].join("\n");

// A chart can also render outside a scrolling transcript (e.g. the visual
// fixture); only the host that owns the scroll offset handles the resize.
export const ChartDataResizeContext = createContext<(() => void) | null>(null);

function ChartDisclosure({
	chart,
	data,
}: {
	chart: PlotChart;
	data: InlineUiData;
}) {
	const [expanded, setExpanded] = useState(false);
	const markReaderResize = useContext(ChartDataResizeContext);
	const ink = useTokenColor("ink-muted");
	// Transcript rows are memoized: subscribe here so the label and plot update
	// together without re-keying the row, closing the data, or moving focus.
	useLocaleFrame();
	const label = t("mobile.session.inline_chart_data");
	return (
		<>
			<InlineChartPlot chart={chart} locale={activeLocale()} />
			{/* Secondary detail stays local to the plot, not a modal. Selection
			 * still copies exact data even before this disclosure is opened. */}
			{/* §6: collapsed by default; hover/tap on the plot now gives any single
			 * value, so the exact table stays one tap away instead of doubling
			 * the chart's height. The 44 pt row keeps the touch floor. */}
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${label} · ${data.title}`}
				aria-expanded={expanded}
				className="mt-1 min-h-11 flex-row items-center gap-1 self-start rounded-sm border border-transparent active:bg-row-hover web:focus-visible:border-accent"
				onPress={() => {
					markReaderResize?.();
					setExpanded((open) => !open);
				}}
			>
				<Text className="shrink text-meta text-ink-muted">{label}</Text>
				<Svg aria-hidden width={16} height={16} viewBox="0 0 16 16">
					<Path
						d={expanded ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"}
						fill="none"
						stroke={ink}
						strokeWidth={1.5}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</Svg>
			</Pressable>
			{expanded ? <InlineUiGrid data={data} chart /> : null}
		</>
	);
}

export function InlineUiPreview({ data }: { data: InlineUiData }) {
	// Charts (heatmaps included, §4) sit directly on the message ground (§1):
	// no card, border or fill, so nothing reads as an opaque slab and the plot
	// uses the full width. Tables keep their sunken card as before.
	if (data.chart)
		return (
			<View className="py-2">
				<Text
					accessibilityRole="header"
					className="mb-1 text-body-lg font-medium text-ink"
				>
					{data.title}
				</Text>
				<ChartDisclosure chart={data.chart} data={data} />
			</View>
		);
	return (
		<View className="rounded-sm border border-hairline bg-sunken">
			<Text
				accessibilityRole="header"
				className="px-3 py-2 text-body-lg font-medium text-ink"
			>
				{data.title}
			</Text>
			<InlineUiGrid data={data} />
		</View>
	);
}

function InlineUiGrid({
	data,
	chart = false,
}: {
	data: InlineUiData;
	/** Chart data table (§6): 28 px rows, values right-aligned. */
	chart?: boolean;
}) {
	const { header, rows, measures } = data;
	const locale = activeLocale();
	const columnClass = chart
		? "min-h-7 w-28 justify-center px-2"
		: "w-28 px-2 py-1";
	// Category first, then values: only value columns align to the end. The
	// table follows the reading direction (it is not pinned LTR like the plot).
	const align = (j: number) => (chart && j > 0 ? TEXT_END_CLASS : "");
	return (
		<ScrollView horizontal>
			<View>
				{header ? (
					<View className="flex-row border-b border-hairline">
						{header.map((label, index) => (
							<Text
								key={index}
								className={`${columnClass} ${align(index)} text-body-sm font-medium text-ink`}
							>
								{label}
							</Text>
						))}
					</View>
				) : null}
				{rows.map((row, i) => (
					<View key={i} className="flex-row border-b border-hairline">
						{row.map((authored, j) => {
							// Q5: the same grouped exact format as the tooltip.
							const m = chart ? measures?.[i]?.[j] : undefined;
							const text = m
								? withUnit(formatExact(m.value, locale), m.unit)
								: authored;
							const label = header?.[j];
							return (
								<View key={j} className={columnClass}>
									<Text
										accessibilityLabel={label ? `${label}: ${text}` : undefined}
										className={`${align(j)} text-body-sm tabular-nums text-ink`}
									>
										{text}
									</Text>
								</View>
							);
						})}
					</View>
				))}
			</View>
		</ScrollView>
	);
}
