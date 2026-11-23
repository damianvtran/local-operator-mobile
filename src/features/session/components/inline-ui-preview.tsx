// biome-ignore-all lint/suspicious/noArrayIndexKey: a decoded payload replaces the whole matrix; positions identify cells even when labels repeat.
import { createContext, useContext, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import type { InlineChart } from "@/features/session/inline-chart-model";
import type { InlineUi } from "@/features/session/inline-ui-parts";
import { activeLocale, t } from "@/i18n";
import { useTokenColor } from "@/ui/appearance";
import { InlineChartPlot } from "./inline-chart";

export type InlineUiData = {
	title: string;
	header?: string[];
	rows: string[][];
	marks?: (number | null)[][];
	chart?: InlineChart;
};

const cell = (value: string | number | null) =>
	value === null ? "—" : String(value);
const measure = (value: number, unit?: string) =>
	unit ? `${value} ${unit}` : String(value);

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
			return {
				title,
				header: ["", ...value.columns],
				rows: value.rows.map((row, index) => [
					value.rowLabels[index] ?? "",
					...row.map((n) => (n === null ? cell(n) : measure(n, value.unit))),
				]),
				marks: value.rows.map((row) => [null, ...row]),
			};
		case "scatter":
			return {
				title,
				chart: value,
				header: [value.xLabel, value.yLabel],
				rows: value.data.map((point) => point.map(cell)),
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
			};
		default:
			return {
				title,
				chart: value,
				rows: value.data.map(([label, n]) => [label, measure(n, value.unit)]),
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
	chart: InlineChart;
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
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${label} · ${data.title}`}
				aria-expanded={expanded}
				className="min-h-12 flex-row items-center gap-2 border border-transparent px-3 active:bg-row-hover web:focus-visible:border-accent"
				onPress={() => {
					markReaderResize?.();
					setExpanded((open) => !open);
				}}
			>
				<Text className="shrink text-body-sm text-ink-muted">{label}</Text>
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
			{expanded ? <InlineUiGrid data={data} /> : null}
		</>
	);
}

export function InlineUiPreview({ data }: { data: InlineUiData }) {
	return (
		<View className="rounded-sm border border-hairline bg-sunken">
			<Text
				accessibilityRole="header"
				className="px-3 py-2 text-body-lg font-medium text-ink"
			>
				{data.title}
			</Text>
			{data.chart ? (
				<ChartDisclosure chart={data.chart} data={data} />
			) : (
				<InlineUiGrid data={data} />
			)}
		</View>
	);
}

function InlineUiGrid({ data }: { data: InlineUiData }) {
	const { header, rows, marks } = data;
	const max = Math.max(0, ...(marks ?? []).flat().map((n) => Math.abs(n ?? 0)));
	const columnClass = "w-28 px-2 py-1";
	return (
		<ScrollView horizontal>
			<View>
				{header ? (
					<View className="flex-row border-b border-hairline">
						{header.map((label, index) => (
							<Text
								key={index}
								className={`${columnClass} text-body-sm font-medium text-ink`}
							>
								{label}
							</Text>
						))}
					</View>
				) : null}
				{rows.map((row, i) => (
					<View key={i} className="flex-row border-b border-hairline">
						{row.map((text, j) => {
							const mark = marks?.[i]?.[j];
							const ratio = mark == null || max === 0 ? 0 : mark / max;
							const label = header?.[j];
							return (
								<View key={j} className={columnClass}>
									{/* Marks are supplementary: signs and missing values stay legible without colour. */}
									{mark != null ? (
										<View
											aria-hidden
											className="absolute inset-0 bg-accent"
											style={{ opacity: (ratio + 1) / 10 }}
										/>
									) : null}
									<Text
										accessibilityLabel={label ? `${label}: ${text}` : undefined}
										className="text-body-sm text-ink"
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
