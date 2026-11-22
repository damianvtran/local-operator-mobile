// biome-ignore-all lint/suspicious/noArrayIndexKey: a decoded payload replaces the whole matrix; positions identify cells even when labels repeat.
import { ScrollView, Text, View } from "react-native";
import type { InlineUi } from "@/features/session/inline-ui-parts";

export type InlineUiData = {
	title: string;
	header?: string[];
	rows: string[][];
	marks?: (number | null)[][];
	markStyle?: "bar" | "heat";
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
				markStyle: "heat",
			};
		case "scatter":
			return {
				title,
				header: [value.xLabel, value.yLabel],
				rows: value.data.map((point) => point.map(cell)),
			};
		case "series":
			return {
				title,
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
		default: {
			const showBars = value.type === "bar" || value.type === "histogram";
			return {
				title,
				rows: value.data.map(([label, n]) => [label, measure(n, value.unit)]),
				...(showBars
					? { marks: value.data.map(([, n]) => [null, n]), markStyle: "bar" }
					: {}),
			};
		}
	}
}

export const inlineUiPlainText = ({ title, header, rows }: InlineUiData) =>
	[
		title,
		...(header ? [header.join("\t")] : []),
		...rows.map((row) => row.join("\t")),
	].join("\n");

export function InlineUiPreview({ data }: { data: InlineUiData }) {
	const { title, header, rows, marks, markStyle } = data;
	const max = Math.max(0, ...(marks ?? []).flat().map((n) => Math.abs(n ?? 0)));
	const columnClass = "w-28 px-2 py-1";
	return (
		<View className="rounded-sm border border-hairline bg-sunken">
			<Text
				accessibilityRole="header"
				className="px-2 py-2 text-body-lg font-medium text-ink"
			>
				{title}
			</Text>
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
										{markStyle === "heat" && mark != null ? (
											<View
												aria-hidden
												className="absolute inset-0 bg-accent"
												style={{ opacity: (ratio + 1) / 10 }}
											/>
										) : null}
										<Text
											accessibilityLabel={
												label ? `${label}: ${text}` : undefined
											}
											className="text-body-sm text-ink"
										>
											{text}
										</Text>
										{markStyle === "bar" && ratio !== 0 ? (
											<View
												aria-hidden
												className="h-1 rounded-full bg-accent"
												style={{ width: `${Math.abs(ratio) * 100}%` }}
											/>
										) : null}
									</View>
								);
							})}
						</View>
					))}
				</View>
			</ScrollView>
		</View>
	);
}
