// biome-ignore-all lint/suspicious/noArrayIndexKey: positions identify the marks of a single decoded dataset, including duplicate labels.
import { useId, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Svg, {
	Circle,
	Defs,
	Line,
	Path,
	Pattern,
	Polyline,
	Rect,
} from "react-native-svg";
import {
	chartAxisLabels,
	histogramAxisLabels,
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

// Colors can be nearly equal in grayscale. A solid, diagonal, dotted and
// horizontal mark maps the same way in every multi-series plot and legend.
// IDs are per SVG instance so a sibling chart in another theme cannot supply
// its pattern by accident on web.
function useMarkId() {
	return `chart-${useId().replace(/[^\w-]/g, "")}`;
}

const MARK_TILE = 7;
const hatchFill = (colors: Palette, i: number, id: string) => {
	const index = i % PAINT.length;
	return index === 0 ? markColor(colors, i) : `url(#${id}-${index})`;
};

function MarkPatterns({ colors, id }: { colors: Palette; id: string }) {
	return (
		<Defs>
			{PAINT.slice(1).map((_, index) => {
				const i = index + 1;
				return (
					<Pattern
						key={i}
						id={`${id}-${i}`}
						width={MARK_TILE}
						height={MARK_TILE}
						patternUnits="userSpaceOnUse"
					>
						<Rect
							width={MARK_TILE}
							height={MARK_TILE}
							fill={markColor(colors, i)}
						/>
						{i === 2 ? (
							<Circle cx={3.5} cy={3.5} r={1.35} fill={colors.sunken} />
						) : (
							<Path
								d={i === 1 ? "M-2 2L2 -2M0 7L7 0M5 9L9 5" : "M0 3.5H7"}
								stroke={colors.sunken}
								strokeWidth={1.4}
							/>
						)}
					</Pattern>
				);
			})}
		</Defs>
	);
}

function Legend({
	labels,
	colors,
	trends,
}: {
	labels: string[];
	colors: Palette;
	trends?: boolean;
}) {
	const id = useMarkId();
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
						<MarkSwatch index={i} colors={colors} id={`${id}-${i}`} />
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

function MarkSwatch({
	index,
	colors,
	id,
}: {
	index: number;
	colors: Palette;
	id: string;
}) {
	return (
		<Svg width={16} height={12}>
			<MarkPatterns colors={colors} id={id} />
			<Rect width={16} height={12} rx={2} fill={hatchFill(colors, index, id)} />
		</Svg>
	);
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
	const id = useMarkId();
	return (
		<>
			<View className="items-center">
				<Svg width={PIE_SIZE} height={PIE_SIZE}>
					<MarkPatterns colors={colors} id={id} />
					{model.slices.map(({ start, end }, i) => {
						const span = end - start;
						const fill = hatchFill(colors, i, id);
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
const INTERVAL_DIVIDER = /\s*–\s*/;

function CartesianPlot({
	model,
	colors,
	chart,
}: {
	model: Extract<Model, { kind: "cartesian" }>;
	colors: Palette;
	chart: InlineChart;
}) {
	const id = useMarkId();
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
	const leftAxis = chartAxisLabels(model.left, locale);
	const rightAxis = model.right && chartAxisLabels(model.right, locale);
	const bottomAxis = model.xAxis && chartAxisLabels(model.xAxis, locale);
	const axisCaption = (unit?: string, offset?: string) =>
		[unit, offset && `${offset} + Δ`].filter(Boolean).join(" · ");
	const leftCaption = axisCaption(model.left.unit, leftAxis.offset);
	const rightCaption = axisCaption(model.right?.unit, rightAxis?.offset);
	const bottomCaption = axisCaption(model.xAxis?.unit, bottomAxis?.offset);
	const unitLine = !percent && (leftCaption || rightCaption);
	const patternedBars = Boolean(model.bars && model.legend);
	const percentLabel = percent
		? new Intl.NumberFormat(locale, { style: "percent" })
		: undefined;
	// Show only category ticks that fit; the exact grid keeps all labels. Use
	// their actual x coordinates, not an evenly-spaced flex row of sampled labels.
	const categories = model.categories ?? [];
	const histogram = chart.type === "histogram";
	const intervals = histogram
		? histogramAxisLabels(categories.map(({ label }) => label))
		: undefined;
	const slot = categories.length ? pw / categories.length : pw;
	// At large text, give a histogram two staggered lanes so neighboring
	// ranges can use each other's horizontal space without dropping an
	// endpoint or shrinking the type. Dense plots can still sample ticks.
	const labelFloor = histogram ? 32 : 44;
	const spacing = Math.max(
		1,
		Math.ceil((labelFloor * fontScale) / Math.max(1, slot)),
	);
	const lanes = histogram ? Math.min(spacing, 2) : 1;
	const stride = Math.ceil(spacing / lanes);
	const labelled = categories.map((category, i) => ({
		...category,
		label: intervals ? (intervals.labels[i] ?? category.label) : category.label,
	}));
	const shown = labelled.filter(
		(_, i) =>
			i === 0 ||
			i === categories.length - 1 ||
			(i % stride === 0 && categories.length - 1 - i >= stride),
	);
	const positionLabels = (lane: typeof shown) =>
		lane.map(({ label, position }, i) => {
			const center = x(position);
			const previous = lane[i - 1];
			const next = lane[i + 1];
			const before = previous ? x(previous.position) : 0;
			const after = next ? x(next.position) : width;
			const left =
				(i ? (before + center) / 2 : Math.max(0, center - 56 * fontScale)) + 2;
			const right =
				(i + 1 < lane.length
					? (center + after) / 2
					: Math.min(width, center + 56 * fontScale)) - 2;
			// Clamp the label at the frame edge, not symmetrically around an edge
			// mark; otherwise the last label in a dense chart shrinks to an ellipsis.
			const w = Math.max(
				0,
				Math.min(right - left, Math.max(56 * fontScale, slot * stride - 4)),
			);
			return {
				label:
					histogram && w < label.length * 8 * fontScale
						? label.replace(INTERVAL_DIVIDER, "–\n")
						: label,
				left: Math.max(left, Math.min(right - w, center - w / 2)),
				width: w,
			};
		});
	const labelRows = Array.from({ length: lanes }, (_, lane) =>
		positionLabels(shown.filter((_, i) => i % lanes === lane)),
	).filter((row) => row.length > 0);
	const categoryLabels = labelRows[0] ?? [];
	const numericLabels = bottomAxis?.ticks
		.filter(
			({ position }) =>
				position === 0 ||
				position === 1 ||
				model.xAxis?.ticks.length === 1 ||
				(position * pw >= 68 * fontScale &&
					(1 - position) * pw >= 68 * fontScale),
		)
		.map(({ position, label }) => {
			const w = Math.min(64 * fontScale, width);
			return {
				label,
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
						{leftCaption}
					</Text>
					{model.right ? (
						<View className="flex-1 items-end">
							<Text className="text-body-sm text-ink-muted">
								{rightCaption}
							</Text>
						</View>
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
							{patternedBars ? <MarkPatterns colors={colors} id={id} /> : null}
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
								stroke={colors["ink-muted"]}
							/>
							{model.right ? (
								<Line
									x1={x1}
									x2={x1}
									y1={y0}
									y2={y1}
									stroke={colors["ink-muted"]}
								/>
							) : null}
							{xZero !== undefined && xZero >= 0 && xZero <= 1 ? (
								<Line
									x1={x(xZero)}
									x2={x(xZero)}
									y1={y0}
									y2={y1}
									stroke={colors["ink-muted"]}
								/>
							) : null}
							{histogram && lanes > 1
								? shown.map(({ position }) => (
										<Line
											key={position}
											x1={x(position)}
											x2={x(position)}
											y1={y1}
											y2={y1 + 5}
											stroke={colors["ink-muted"]}
										/>
									))
								: null}
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
											fill={
												patternedBars
													? hatchFill(colors, color, id)
													: markColor(colors, color)
											}
											stroke={patternedBars ? colors.sunken : undefined}
											strokeWidth={patternedBars ? 1 : undefined}
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
						? [leftAxis, rightAxis].map((axis, side) =>
								axis?.ticks
									.filter(
										({ position }) =>
											position === 0 ||
											position === 1 ||
											axis.ticks.length === 1 ||
											(y(position) - y0 >= labelHeight &&
												y1 - y(position) >= labelHeight),
									)
									.map(({ position, value, label }) => (
										<View
											key={`${side}-${position}`}
											className={`absolute ${side ? "items-start" : "items-end"}`}
											style={{
												left: side ? x1 + 4 : 0,
												top: y(position) - labelHeight / 2,
												width: rail - 4,
											}}
										>
											<Text
												className="max-w-full text-body-sm tabular-nums text-ink-muted"
												numberOfLines={1}
											>
												{percentLabel?.format(value) ?? label}
											</Text>
										</View>
									)),
							)
						: null}
				</View>
				{histogram && pw > 0 ? (
					labelRows.map((labels, lane) => (
						<View
							key={lane}
							className="flex-row"
							style={{ minHeight: labelHeight }}
						>
							{labels.map(({ label, left, width: w }, i) => {
								const previous = labels[i - 1];
								const marginStart =
									left - (previous ? previous.left + previous.width : 0);
								return (
									<Text
										key={i}
										className="text-center text-body-sm text-ink-muted"
										style={{ marginStart, width: w }}
									>
										{label}
									</Text>
								);
							})}
						</View>
					))
				) : (
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
				)}
			</View>
			{bottomCaption || intervals?.unit ? (
				<Text className="text-center text-body-sm text-ink-muted">
					{bottomCaption || intervals?.unit}
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
