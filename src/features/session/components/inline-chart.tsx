// biome-ignore-all lint/suspicious/noArrayIndexKey: positions identify the marks of a single decoded dataset, including duplicate labels.
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";
import {
	chartTickLabel,
	type InlineChart,
	inlineChartModel,
} from "@/features/session/inline-chart-model";
import { activeLocale } from "@/i18n";
import { useTheme } from "@/ui/appearance";
import { useTextScale } from "@/ui/text-scale-provider";
import type { ColorRole } from "@/ui/tokens.gen";

type Palette = Record<ColorRole, string>;
type Model = ReturnType<typeof inlineChartModel>;
const PAINT = ["accent", "info", "warning", "ink-muted"] as const;
const TREND_DASHES = [undefined, [5, 3], [2, 2], [7, 2, 2, 2]];
const markColor = (colors: Palette, i: number) =>
	colors[PAINT[i % PAINT.length] ?? "accent"];

function Legend({
	labels,
	colors,
	trends,
}: {
	labels: string[];
	colors: Palette;
	trends?: boolean;
}) {
	const compact = labels.length <= PAINT.length;
	const items = (
		<View
			className={`flex-row items-center gap-x-3 gap-y-1 py-1 ${compact ? "flex-wrap" : ""}`}
		>
			{labels.map((label, i) => (
				<View key={i} className="max-w-40 flex-row items-center gap-1">
					{trends ? (
						<Svg width={16} height={8}>
							<Line
								x1={0}
								x2={16}
								y1={4}
								y2={4}
								stroke={markColor(colors, i)}
								strokeWidth={2}
								strokeDasharray={TREND_DASHES[i]}
							/>
						</Svg>
					) : (
						<View
							className="size-2 rounded-full"
							style={{ backgroundColor: markColor(colors, i) }}
						/>
					)}
					<Text className="shrink text-body-sm text-ink" numberOfLines={1}>
						{label}
					</Text>
				</View>
			))}
		</View>
	);
	return compact ? items : <ScrollView horizontal>{items}</ScrollView>;
}

const PIE_SIZE = 140;
const PIE_RADIUS = 66;
const piePoint = (fraction: number) => {
	const t = 2 * Math.PI * fraction - Math.PI / 2;
	return [
		PIE_SIZE / 2 + PIE_RADIUS * Math.cos(t),
		PIE_SIZE / 2 + PIE_RADIUS * Math.sin(t),
	].join(" ");
};

function PiePlot({
	model,
	colors,
}: {
	model: Extract<Model, { kind: "pie" }>;
	colors: Palette;
}) {
	return (
		<>
			<View className="items-center">
				<Svg width={PIE_SIZE} height={PIE_SIZE}>
					{model.slices.map(({ start, end }, i) => {
						const span = end - start;
						const fill = markColor(colors, i);
						if (span >= 1)
							return (
								<Circle
									key={i}
									cx={PIE_SIZE / 2}
									cy={PIE_SIZE / 2}
									r={PIE_RADIUS}
									fill={fill}
								/>
							);
						if (span <= 0) return null;
						return (
							<Path
								key={i}
								fill={fill}
								stroke={span > 0.01 ? colors.sunken : undefined}
								strokeWidth={1}
								d={`M ${PIE_SIZE / 2} ${PIE_SIZE / 2} L ${piePoint(start)} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${span > 0.5 ? 1 : 0} 1 ${piePoint(end)} Z`}
							/>
						);
					})}
				</Svg>
			</View>
			<Legend labels={model.slices.map(({ label }) => label)} colors={colors} />
		</>
	);
}

const FRAME_HEIGHT = 156;
const SIDE_PADDING = 6;

function CartesianPlot({
	model,
	colors,
	chart,
}: {
	model: Extract<Model, { kind: "cartesian" }>;
	colors: Palette;
	chart: InlineChart;
}) {
	const [width, setWidth] = useState(0);
	const { effectiveScale: fontScale } = useTextScale();
	const labelHeight = Math.ceil(20 * fontScale);
	const frameHeight = Math.max(FRAME_HEIGHT, 116 + 2 * labelHeight);
	const rail = Math.min(Math.ceil(56 * fontScale), width / 4);
	const x0 = rail;
	const x1 = model.right
		? width - rail
		: width - (model.xAxis ? rail / 2 : SIDE_PADDING);
	const y0 = Math.ceil(labelHeight / 2);
	const y1 = frameHeight - y0;
	const pw = x1 - x0;
	const x = (n: number) => x0 + n * pw;
	const y = (n: number) => y1 - n * (y1 - y0);
	const locale = activeLocale();
	const zero = model.left.zero;
	const xZero = model.xAxis?.zero;
	const percent = chart.type === "series" && chart.mode === "percent";
	const unitLine = !percent && (model.left.unit || model.right?.unit);
	const percentLabel = percent
		? new Intl.NumberFormat(locale, { style: "percent" })
		: undefined;
	// Show only category ticks that fit; the exact grid keeps all labels. Use
	// their actual x coordinates, not an evenly-spaced flex row of sampled labels.
	const categories = model.categories ?? [];
	const slot = categories.length ? pw / categories.length : pw;
	const stride = Math.max(1, Math.ceil((44 * fontScale) / Math.max(1, slot)));
	const shown = categories.filter(
		(_, i) =>
			i === 0 ||
			i === categories.length - 1 ||
			(i % stride === 0 && categories.length - 1 - i >= stride),
	);
	const categoryLabels = shown.map(({ label, position }, i) => {
		const center = x(position);
		const previous = shown[i - 1];
		const next = shown[i + 1];
		const before = previous ? x(previous.position) : 0;
		const after = next ? x(next.position) : width;
		const left =
			(i ? (before + center) / 2 : Math.max(0, center - 56 * fontScale)) + 2;
		const right =
			(i + 1 < shown.length
				? (center + after) / 2
				: Math.min(width, center + 56 * fontScale)) - 2;
		// Clamp the label at the frame edge, not symmetrically around an edge
		// mark; otherwise the last label in a dense chart shrinks to an ellipsis.
		const w = Math.max(
			0,
			Math.min(right - left, Math.max(56 * fontScale, slot * stride - 4)),
		);
		return {
			label,
			left: Math.max(left, Math.min(right - w, center - w / 2)),
			width: w,
		};
	});
	const numericLabels = model.xAxis?.ticks
		.filter(
			({ position }) =>
				position === 0 ||
				position === 1 ||
				model.xAxis?.ticks.length === 1 ||
				(position * pw >= 68 * fontScale &&
					(1 - position) * pw >= 68 * fontScale),
		)
		.map(({ position, value }) => {
			const w = Math.min(64 * fontScale, width);
			return {
				label: chartTickLabel(value, model.xAxis?.scale ?? 1, locale),
				width: w,
				left: Math.max(0, Math.min(width - w, x(position) - w / 2)),
			};
		});
	const legends =
		chart.type === "series" && chart.mode === "dual"
			? chart.series.map(({ label, axis }) =>
					axis === "right" ? `${label} →` : `← ${label}`,
				)
			: model.legend;
	return (
		<>
			{unitLine ? (
				<View className="flex-row gap-2" style={{ direction: "ltr" }}>
					<Text className="flex-1 text-body-sm text-ink-muted">
						{model.left.unit}
					</Text>
					{model.right ? (
						<Text className="flex-1 text-right text-body-sm text-ink-muted">
							{model.right.unit}
						</Text>
					) : null}
				</View>
			) : null}
			<View
				style={{ direction: "ltr" }}
				onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
			>
				<View style={{ height: frameHeight }}>
					{pw > 0 ? (
						<Svg width={width} height={frameHeight}>
							{model.left.ticks.map(({ position }) => (
								<Line
									key={position}
									x1={x0}
									x2={x1}
									y1={y(position)}
									y2={y(position)}
									stroke={colors.hairline}
								/>
							))}
							<Line
								x1={x0}
								x2={x0}
								y1={y0}
								y2={y1}
								stroke={colors["hairline-strong"]}
							/>
							{model.right ? (
								<Line
									x1={x1}
									x2={x1}
									y1={y0}
									y2={y1}
									stroke={colors["hairline-strong"]}
								/>
							) : null}
							{xZero !== undefined && xZero >= 0 && xZero <= 1 ? (
								<Line
									x1={x(xZero)}
									x2={x(xZero)}
									y1={y0}
									y2={y1}
									stroke={colors["hairline-strong"]}
								/>
							) : null}
							{model.bars?.map(
								({ x: center, width: fraction, from, to, color }, i) => {
									if (from === to) return null;
									const w = fraction * pw * 0.94;
									return (
										<Rect
											key={i}
											x={x(center) - w / 2}
											width={w}
											y={y(Math.max(from, to))}
											height={Math.abs(y(from) - y(to))}
											fill={markColor(colors, color)}
										/>
									);
								},
							)}
							{zero >= 0 && zero <= 1 ? (
								<Line
									x1={x0}
									x2={x1}
									y1={y(zero)}
									y2={y(zero)}
									stroke={colors["ink-muted"]}
								/>
							) : null}
							{model.lines?.map((points, i) => (
								<Polyline
									key={i}
									points={points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
									fill="none"
									stroke={markColor(colors, i)}
									strokeWidth={2}
									strokeDasharray={TREND_DASHES[i]}
									strokeLinejoin="round"
								/>
							))}
							{(model.points ? [model.points] : model.lines)?.flatMap(
								(points, series) =>
									points.map((p, i) => (
										<Circle
											key={`${series}-${i}`}
											cx={x(p.x)}
											cy={y(p.y)}
											r={model.points ? 3.5 : 2.8}
											fill={markColor(colors, series)}
											stroke={colors.sunken}
											strokeWidth={1}
										/>
									)),
							)}
						</Svg>
					) : null}
					{pw > 0
						? [model.left, model.right].map((axis, side) =>
								axis?.ticks
									.filter(
										({ position }) =>
											position === 0 ||
											position === 1 ||
											axis.ticks.length === 1 ||
											(y(position) - y0 >= labelHeight &&
												y1 - y(position) >= labelHeight),
									)
									.map(({ position, value }) => (
										<Text
											key={`${side}-${position}`}
											className="absolute text-body-sm tabular-nums text-ink-muted"
											numberOfLines={1}
											style={{
												left: side ? x1 + 4 : 0,
												top: y(position) - labelHeight / 2,
												width: rail - 4,
												textAlign: side ? "left" : "right",
											}}
										>
											{percentLabel?.format(value) ??
												chartTickLabel(value, axis.scale, locale)}
										</Text>
									)),
							)
						: null}
				</View>
				<View style={{ height: labelHeight }}>
					{pw > 0
						? (numericLabels ?? categoryLabels).map(
								({ label, left, width: w }, i) => (
									<Text
										key={i}
										className="absolute text-center text-body-sm text-ink-muted"
										numberOfLines={1}
										style={{ left, width: w }}
									>
										{label}
									</Text>
								),
							)
						: null}
				</View>
			</View>
			{model.xAxis?.unit ? (
				<Text className="text-center text-body-sm text-ink-muted">
					{model.xAxis.unit}
				</Text>
			) : null}
			{legends ? (
				<Legend
					labels={legends}
					colors={colors}
					trends={Boolean(model.right)}
				/>
			) : null}
		</>
	);
}

export function InlineChartPlot({ chart }: { chart: InlineChart }) {
	const model = useMemo(() => inlineChartModel(chart), [chart]);
	const {
		active: { colors },
	} = useTheme();
	// The decorative plot and redundant visual legend are not a second screen
	// reader transcript. The adjacent disclosure exposes the exact labelled data.
	return (
		<View
			aria-hidden
			importantForAccessibility="no-hide-descendants"
			className="gap-1 px-3"
		>
			{model.kind === "pie" ? (
				<PiePlot model={model} colors={colors} />
			) : (
				<CartesianPlot model={model} colors={colors} chart={chart} />
			)}
		</View>
	);
}
