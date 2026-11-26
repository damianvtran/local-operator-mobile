// biome-ignore-all lint/suspicious/noArrayIndexKey: positions identify the marks of a single decoded dataset, including duplicate labels.
/**
 * Inline `lop-ui` charts, drawn with react-native-svg at the measured width.
 *
 * Follows the shared inline-chart design spec (desktop, relay web and this app
 * render one payload the same way); §n below refers to its sections. Pure
 * decisions — plot height, ticks, zero rule, thinning, folding, keyboard steps,
 * tooltip placement — live in `inline-chart-model.ts` and are unit-tested
 * there. This file maps them to pixels and wires touch, pointer, keyboard and
 * screen-reader input to ONE active-mark state.
 *
 * Constraints worth knowing before editing:
 * - Nothing here paints a card or fill behind the plot (§1): the chart sits on
 *   the message ground. Gaps between stacked segments and donut slices are real
 *   geometry, never a ground-coloured stroke.
 * - Text is React Native `Text` over the SVG, not SVG text, so the reader's text
 *   scale and font apply; widths use the spec's 6.6 px/char estimate × scale.
 * - The tooltip is an absolutely positioned `View` sibling of the `Svg` (§8),
 *   `pointerEvents="none"`, so it never changes layout or steals a touch.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type AccessibilityActionEvent,
	AccessibilityInfo,
	Animated,
	type LayoutChangeEvent,
	PanResponder,
	Platform,
	Pressable,
	Text,
	View,
} from "react-native";
import Svg, { Circle, Line, Path, Polyline } from "react-native-svg";
import {
	type ActiveMark,
	axisText,
	barBand,
	type Cartesian,
	CHAR_WIDTH,
	type ChartStep,
	describeMark,
	formatExact,
	formatShare,
	HORIZONTAL_ROW,
	histogramAxisLabels,
	horizontalBarModel,
	horizontalBars,
	type InlineChart,
	inlineChartModel,
	keyStep,
	NARROW_WIDTH,
	type Pie,
	PLOT_MARGIN,
	pieDiameterFor,
	plotHeightFor,
	stepActive,
	thinLabels,
	tickLabels,
	tooltipPlacement,
	withUnit,
} from "@/features/session/inline-chart-model";
import type { CategoryChart } from "@/features/session/inline-ui-parts";
import { t } from "@/i18n";
import { useTheme } from "@/ui/appearance";
import { contrastRatio } from "@/ui/chart-palette";
import { useShadow } from "@/ui/elevation";
import { useTextScale } from "@/ui/text-scale-provider";
import type { ColorRole } from "@/ui/tokens.gen";

type Palette = Record<ColorRole, string>;
type Paint = {
	colors: Palette;
	chart: readonly string[];
	fontScale: number;
	locale: string;
};

// §5 — the dimmed opacity of every mark that is not active.
const DIM = 0.35;
// §5 — a horizontal drag must travel this far, and more than vertically,
// before the chart scrubs instead of letting the transcript scroll.
const SCRUB_SLOP = 8;
// §5 — scatter nearest-point radius on touch.
const SCATTER_HIT = 32;
// §7 — one entrance fade on mount.
const FADE_MS = 180;
// Text-meta line box (12 px × 1.4) used to place one-line labels.
const META_LINE = 17;

const seriesColor = (paint: Paint, i: number) =>
	paint.chart[i % paint.chart.length] ?? paint.colors.accent;
const textWidth = (text: string, fontScale: number) =>
	[...text].length * CHAR_WIDTH * fontScale;
const snap = (n: number) => Math.round(n) + 0.5;
const sameMark = (a: ActiveMark | null, b: ActiveMark | null) =>
	a?.category === b?.category && a?.series === b?.series;

type TooltipRow = { color?: string; label?: string; value: string };
type TooltipContent = { title?: string; rows: TooltipRow[]; notes?: string[] };
type Anchor = { x: number; top: number; bottom?: number };
type MarkInfo = {
	tooltip: TooltipContent;
	anchor: Anchor;
	description: string;
};

/**
 * The root owns the accessibility value and live region; each plot reports
 * what they should say. Runs after every render on purpose: the root's setter
 * keeps its state when description and counts are unchanged, so this settles
 * without a dependency list that would have to mirror every model input.
 */
function useReportMark(
	onMark: (info: MarkInfo | null, count: [number, number]) => void,
	info: MarkInfo | null,
	count: [number, number],
) {
	const latest = useRef({ onMark, info, count });
	latest.current = { onMark, info, count };
	useEffect(() => {
		latest.current.onMark(latest.current.info, latest.current.count);
	});
}

/** §5 tooltip: elevated, radius 6, platform shadow, no border. */
function ChartTooltip({
	content,
	anchor,
	box,
	paint,
}: {
	content: TooltipContent;
	anchor: Anchor;
	box: number;
	paint: Paint;
}) {
	const shadow = useShadow("overlay");
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	const place = tooltipPlacement({
		x: anchor.x,
		top: anchor.top,
		bottom: anchor.bottom,
		width: size?.width ?? 0,
		height: size?.height ?? 0,
		box,
	});
	return (
		<View
			pointerEvents="none"
			onLayout={({ nativeEvent: { layout } }: LayoutChangeEvent) =>
				// Keep the same object when nothing moved, so a host that reports
				// layout on every commit cannot loop a re-render.
				setSize((current) =>
					current?.width === layout.width && current.height === layout.height
						? current
						: { width: layout.width, height: layout.height },
				)
			}
			style={[
				{
					position: "absolute",
					left: place.left,
					top: place.top,
					maxWidth: Math.min(256, box - 8),
					backgroundColor: paint.colors.elevated,
					borderRadius: 6,
					paddingHorizontal: 8,
					paddingVertical: 4,
					// Hidden for the one frame before its size is known, so it never
					// flashes at an unclamped position.
					opacity: size ? 1 : 0,
				},
				shadow ?? undefined,
			]}
		>
			{content.title ? (
				<Text className="text-meta text-ink-muted" numberOfLines={2}>
					{content.title}
				</Text>
			) : null}
			{content.rows.map((row, i) => (
				<View key={i} className="flex-row items-center gap-2">
					{row.color ? (
						<View
							style={{
								width: 8,
								height: 8,
								borderRadius: 2,
								backgroundColor: row.color,
							}}
						/>
					) : null}
					{row.label ? (
						<Text className="shrink text-meta text-ink-muted" numberOfLines={1}>
							{row.label}
						</Text>
					) : null}
					<Text className="ms-auto text-meta font-semibold tabular-nums text-ink">
						{row.value}
					</Text>
				</View>
			))}
			{content.notes?.map((note, i) => (
				<Text key={i} className="text-meta text-ink-muted" numberOfLines={1}>
					{note}
				</Text>
			))}
		</View>
	);
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
	if (dashed === undefined)
		return (
			<View
				style={{
					width: 10,
					height: 10,
					borderRadius: 2,
					backgroundColor: color,
				}}
			/>
		);
	return (
		<Svg width={16} height={10}>
			<Line
				x1={0}
				x2={16}
				y1={5}
				y2={5}
				stroke={color}
				strokeWidth={2}
				strokeDasharray={dashed ? [6, 4] : undefined}
			/>
		</Svg>
	);
}

/** A top-rounded (or end-rounded) bar; radius 3 on the outer end only (§1). */
function barPath(
	x: number,
	y: number,
	w: number,
	h: number,
	end: "top" | "bottom" | "right" | "left" | "none",
) {
	const r = Math.max(0, Math.min(3, w / 2, h));
	if (end === "none" || r === 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;
	if (end === "top")
		return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
	if (end === "bottom")
		return `M${x} ${y}H${x + w}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}Z`;
	const rr = Math.max(0, Math.min(3, h / 2, w));
	if (end === "right")
		return `M${x} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h - rr}Q${x + w} ${y + h} ${x + w - rr} ${y + h}H${x}Z`;
	return `M${x + w} ${y}H${x + rr}Q${x} ${y} ${x} ${y + rr}V${y + h - rr}Q${x} ${y + h} ${x + rr} ${y + h}H${x + w}Z`;
}

/** Measured once per chart: the cartesian frame in pixels. */
function useCartesianFrame(
	model: Cartesian,
	width: number,
	plotHeight: number,
	paint: Paint,
	percent: boolean,
) {
	const { fontScale, locale } = paint;
	const leftLabels = tickLabels(model.left, locale, percent);
	const rightLabels = model.right ? tickLabels(model.right, locale) : [];
	const widest = (labels: string[]) =>
		Math.max(0, ...labels.map((l) => textWidth(l, fontScale)));
	const x0 = Math.max(PLOT_MARGIN.minLeft, Math.ceil(widest(leftLabels) + 8));
	const right = model.right
		? Math.ceil(widest(rightLabels) + 8)
		: PLOT_MARGIN.right;
	const x1 = Math.max(x0 + 1, width - right);
	const y0 = PLOT_MARGIN.top;
	const y1 = y0 + plotHeight;
	const bottom = Math.max(
		PLOT_MARGIN.bottom,
		Math.ceil(META_LINE * fontScale) + 6,
	);
	const pw = x1 - x0;
	const n = model.categories.length;
	const lineLike = model.variant === "line" || model.variant === "dual";
	const slot = lineLike ? (n > 1 ? pw / (n - 1) : pw) : pw / Math.max(1, n);
	const xAt = (i: number) =>
		lineLike ? (n > 1 ? x0 + i * slot : x0 + pw / 2) : x0 + (i + 0.5) * slot;
	const yAt = (position: number) => y1 - position * plotHeight;
	return {
		leftLabels,
		rightLabels,
		x0,
		x1,
		y0,
		y1,
		pw,
		slot,
		xAt,
		yAt,
		lineLike,
		height: y1 + bottom,
	};
}

type Frame = ReturnType<typeof useCartesianFrame>;

function cartesianMark(
	model: Cartesian,
	chart: InlineChart,
	frame: Frame,
	paint: Paint,
	active: ActiveMark,
	band: ReturnType<typeof barBand>,
): MarkInfo | null {
	const { locale } = paint;
	const unitFor = (series: number) =>
		chart.type === "series" &&
		chart.mode === "dual" &&
		model.series[series]?.axis === "right"
			? chart.rightUnit
			: "unit" in chart
				? chart.unit
				: undefined;
	const value = (n: number, series: number) =>
		withUnit(formatExact(n, locale), unitFor(series));
	const position = t("mobile.session.inline_chart.position", {
		index: active.category + 1,
		count: model.points?.length ?? model.categories.length,
	});

	if (model.points && chart.type === "scatter") {
		const point = model.points[active.category];
		if (!point) return null;
		const [px, py] = point.value;
		const xText = `${chart.xLabel}: ${formatExact(px, locale)}`;
		const yText = `${chart.yLabel}: ${formatExact(py, locale)}`;
		const cx = frame.x0 + point.x * frame.pw;
		const cy = frame.yAt(point.y);
		return {
			tooltip: { rows: [{ value: xText }, { value: yText }] },
			anchor: { x: cx, top: cy - 6, bottom: cy + 6 },
			description: describeMark([xText, yText], position),
		};
	}
	const label = model.categories[active.category];
	if (label === undefined) return null;
	const multi = model.series.length > 1;
	if (model.lines) {
		const rows = model.lines.map(({ series, points }) => ({
			color: seriesColor(paint, series),
			label: multi ? model.series[series]?.label : undefined,
			value: value(points[active.category]?.value ?? 0, series),
		}));
		const ys = model.lines.map(({ points }) =>
			frame.yAt(points[active.category]?.y ?? 0),
		);
		const x = frame.xAt(active.category);
		const focus = model.lines[active.series] ?? model.lines[0];
		return {
			tooltip: { title: label, rows },
			anchor: { x, top: Math.min(...ys), bottom: Math.max(...ys) },
			description: describeMark(
				[
					label,
					multi ? model.series[focus?.series ?? 0]?.label : undefined,
					rows[active.series]?.value,
				],
				position,
			),
		};
	}
	const bars = (model.bars ?? []).filter(
		({ category }) => category === active.category,
	);
	const bar = bars.find(({ series }) => series === active.series) ?? bars[0];
	if (!bar) return null;
	const stacked = model.variant === "stacked" || model.variant === "percent";
	const rows: TooltipRow[] = bars.map(({ series, value: n }) => ({
		color: seriesColor(paint, series),
		label: multi ? model.series[series]?.label : undefined,
		value: value(n, series),
	}));
	const notes: string[] = [];
	if (stacked && bar.share !== undefined)
		notes.push(
			t("mobile.session.inline_chart.share", {
				share: formatShare(bar.share, locale),
			}),
		);
	const total = model.totals?.[active.category];
	if (stacked && total !== undefined)
		rows.push({
			label: t("mobile.session.inline_chart.total"),
			value: value(total, 0),
		});
	const centre = frame.xAt(active.category);
	const offset =
		model.variant === "grouped"
			? (band.offsets[bar.series] ?? 0) + band.width / 2
			: 0;
	const top = frame.yAt(Math.max(bar.from, bar.to));
	return {
		tooltip: { title: label, rows, notes },
		anchor: {
			x: centre + offset,
			top,
			bottom: frame.yAt(Math.min(bar.from, bar.to)),
		},
		description: describeMark(
			[
				label,
				multi ? model.series[bar.series]?.label : undefined,
				value(bar.value, bar.series),
				notes[0],
			],
			position,
		),
	};
}

/** §5 hit targets: nearest-x column (lines), full slot (bars), segment
 * under the pointer (grouped/stacked), nearest point within 32 (scatter). */
function cartesianHit(
	model: Cartesian,
	frame: Frame,
	band: ReturnType<typeof barBand>,
	x: number,
	y: number,
): ActiveMark | null {
	if (model.points) {
		let best = -1;
		let distance = SCATTER_HIT;
		model.points.forEach((p, i) => {
			const d = Math.hypot(frame.x0 + p.x * frame.pw - x, frame.yAt(p.y) - y);
			if (d <= distance) {
				distance = d;
				best = i;
			}
		});
		return best < 0 ? null : { category: best, series: 0 };
	}
	const n = model.categories.length;
	if (n === 0) return null;
	const clamp = (i: number) => Math.min(n - 1, Math.max(0, i));
	if (model.lines) {
		const category = clamp(
			frame.lineLike && n > 1
				? Math.round((x - frame.x0) / frame.slot)
				: Math.floor((x - frame.x0) / frame.slot),
		);
		let series = 0;
		let distance = Infinity;
		for (const line of model.lines) {
			const d = Math.abs(frame.yAt(line.points[category]?.y ?? 0) - y);
			if (d < distance) {
				distance = d;
				series = line.series;
			}
		}
		return { category, series };
	}
	const category = clamp(Math.floor((x - frame.x0) / frame.slot));
	const count = model.series.length;
	if (model.variant === "grouped" && count > 1) {
		const left = frame.xAt(category) + (band.offsets[0] ?? 0);
		const series = Math.min(
			count - 1,
			Math.max(0, Math.floor((x - left) / (band.width + 2))),
		);
		return { category, series };
	}
	if (model.variant === "stacked" || model.variant === "percent") {
		let series = 0;
		let distance = Infinity;
		for (const bar of model.bars ?? []) {
			if (bar.category !== category) continue;
			const top = frame.yAt(Math.max(bar.from, bar.to));
			const bottom = frame.yAt(Math.min(bar.from, bar.to));
			const d = y < top ? top - y : y > bottom ? y - bottom : 0;
			if (d < distance) {
				distance = d;
				series = bar.series;
			}
		}
		return { category, series };
	}
	return { category, series: 0 };
}

/** One gesture model for every plot (§5 Touch). */
function usePlotGesture({
	hit,
	active,
	setActive,
	scrub,
}: {
	hit: (x: number, y: number) => ActiveMark | null;
	active: ActiveMark | null;
	setActive: (mark: ActiveMark | null) => void;
	scrub: boolean;
}) {
	// The responder is created once; the latest closures ride in a ref.
	const latest = useRef({ hit, active, setActive, scrub });
	latest.current = { hit, active, setActive, scrub };
	const state = useRef({ x: 0, y: 0, scrubbing: false });
	return useMemo(
		() =>
			PanResponder.create({
				// Taps need the touch from its start. Until a horizontal drag passes
				// the slop, any ancestor (the transcript's ScrollView) that asks for
				// the gesture gets it, so vertical scrolling is never captured.
				onStartShouldSetPanResponder: () => true,
				onMoveShouldSetPanResponder: (_, g) =>
					Math.abs(g.dx) > SCRUB_SLOP && Math.abs(g.dx) > Math.abs(g.dy),
				onPanResponderGrant: ({ nativeEvent }) => {
					state.current = {
						x: nativeEvent.locationX,
						y: nativeEvent.locationY,
						scrubbing: false,
					};
				},
				onPanResponderMove: (_, g) => {
					const s = state.current;
					if (
						!s.scrubbing &&
						latest.current.scrub &&
						Math.abs(g.dx) > SCRUB_SLOP &&
						Math.abs(g.dx) > Math.abs(g.dy)
					)
						s.scrubbing = true;
					if (s.scrubbing) {
						// Start point + delta: `locationX` of a move event is relative
						// to whatever view is under the finger, not this overlay.
						const mark = latest.current.hit(s.x + g.dx, s.y + g.dy);
						if (mark) latest.current.setActive(mark);
					}
				},
				onPanResponderTerminationRequest: () => !state.current.scrubbing,
				onPanResponderRelease: (_, g) => {
					const s = state.current;
					if (!s.scrubbing && Math.hypot(g.dx, g.dy) <= SCRUB_SLOP) {
						const mark = latest.current.hit(s.x, s.y);
						// Tap the same mark again (or empty space) to dismiss.
						latest.current.setActive(
							mark && !sameMark(mark, latest.current.active) ? mark : null,
						);
					}
					s.scrubbing = false;
				},
				onPanResponderTerminate: () => {
					state.current.scrubbing = false;
				},
			}),
		[],
	);
}

function XLabels({
	labels,
	frame,
	edges,
	fontScale,
	width,
}: {
	labels: string[];
	frame: Frame;
	edges: boolean;
	fontScale: number;
	width: number;
}) {
	const texts = labels.map(axisText);
	const widths = texts.map((text) => textWidth(text, fontScale));
	const shown = thinLabels(widths, frame.slot, edges);
	const last = labels.length - 1;
	return (
		<>
			{shown.map(({ index, maxWidth }) => {
				const text = texts[index] ?? "";
				// The box is the label's whole allowance (k·slot − 8, §2) rather
				// than its estimated width: alignment keeps the anchor, and only a
				// label that really exceeds its room truncates.
				const w = Math.max(8, maxWidth);
				const x = frame.xAt(index);
				const anchored =
					edges && labels.length > 1
						? index === 0
							? x
							: index === last
								? x - w
								: x - w / 2
						: x - w / 2;
				const left = Math.max(0, Math.min(width - w, anchored));
				return (
					<Text
						key={index}
						className="absolute text-meta tabular-nums text-ink-muted"
						numberOfLines={1}
						style={{
							left,
							width: w,
							top: frame.y1 + 6,
							textAlign:
								edges && labels.length > 1 && index === 0
									? "left"
									: edges && labels.length > 1 && index === last
										? "right"
										: "center",
						}}
					>
						{text}
					</Text>
				);
			})}
		</>
	);
}

function CartesianPlot({
	chart,
	paint,
	width,
	active,
	setActive,
	onMark,
}: {
	chart: InlineChart;
	paint: Paint;
	width: number;
	active: ActiveMark | null;
	setActive: (mark: ActiveMark | null) => void;
	onMark: (info: MarkInfo | null, count: [number, number]) => void;
}) {
	const { colors, fontScale, locale } = paint;
	const plotHeight = plotHeightFor(width);
	const model = useMemo(() => {
		const m = inlineChartModel(chart, plotHeight);
		if (m.kind !== "cartesian") throw new Error("pie routed to cartesian");
		return m;
	}, [chart, plotHeight]);
	const percent = model.variant === "percent";
	const frame = useCartesianFrame(model, width, plotHeight, paint, percent);
	const n = model.categories.length;
	const band = barBand(
		frame.slot,
		model.series.length,
		model.variant === "histogram"
			? "histogram"
			: model.variant === "grouped"
				? "grouped"
				: model.variant === "stacked" || model.variant === "percent"
					? "stacked"
					: "single",
	);
	const info = active
		? cartesianMark(model, chart, frame, paint, active, band)
		: null;
	const count: [number, number] = [
		model.points?.length ?? n,
		Math.max(1, model.series.length),
	];
	useReportMark(onMark, info, count);
	const hit = (x: number, y: number) => cartesianHit(model, frame, band, x, y);
	const gesture = usePlotGesture({
		hit,
		active,
		setActive,
		scrub: Boolean(model.lines),
	});
	const { x0, x1, y0, y1, xAt, yAt, pw } = frame;
	const multi = model.series.length > 1;
	const stacked = model.variant === "stacked" || model.variant === "percent";
	// §5 highlight: everything but the active mark (or series) drops to 0.35.
	const barOpacity = (category: number, series: number) =>
		!active
			? 1
			: category !== active.category || (multi && series !== active.series)
				? DIM
				: 1;
	const lineOpacity = (series: number) =>
		active && multi && series !== active.series ? DIM : 1;
	const zeroInside = model.left.lo < 0 && model.left.hi > 0;
	const labelBox = META_LINE * fontScale;
	const xAxisLabels = model.xAxis && tickLabels(model.xAxis, locale);
	const histogram = model.variant === "histogram";
	const intervals = histogram
		? histogramAxisLabels(model.categories)
		: undefined;
	const caption = chart.type === "scatter" ? chart.xLabel : intervals?.unit;
	return (
		<>
			<View style={{ height: frame.height, direction: "ltr" }}>
				<Svg aria-hidden width={width} height={frame.height}>
					{/* §2 gridlines: horizontal, 1 px, pixel-snapped; no spine. */}
					{model.left.values.map((v, i) => (
						<Line
							key={`g${i}`}
							x1={x0}
							x2={x1}
							y1={snap(yAt(model.left.position(v)))}
							y2={snap(yAt(model.left.position(v)))}
							stroke={
								zeroInside && v === 0
									? colors["hairline-strong"]
									: colors.hairline
							}
							strokeWidth={1}
						/>
					))}
					{model.xAxis?.values.map((v, i) => (
						<Line
							key={`v${i}`}
							x1={snap(x0 + (model.xAxis?.position(v) ?? 0) * pw)}
							x2={snap(x0 + (model.xAxis?.position(v) ?? 0) * pw)}
							y1={y0}
							y2={y1}
							stroke={colors.hairline}
							strokeWidth={1}
						/>
					))}
					{model.bars?.map((bar, i) => {
						const offset =
							model.variant === "grouped"
								? (band.offsets[bar.series] ?? 0)
								: (band.offsets[0] ?? 0);
						const left = xAt(bar.category) + offset;
						let top = yAt(Math.max(bar.from, bar.to));
						let bottom = yAt(Math.min(bar.from, bar.to));
						// §1 stacked: a real 1 px gap between segments, never a
						// ground-coloured stroke (that would be opaque on glass).
						if (stacked && bar.from !== model.left.position(0)) {
							if (bar.to >= bar.from) bottom -= 1;
							else top += 1;
						}
						const h = bottom - top;
						if (h <= 0) return null;
						return (
							<Path
								key={`b${i}`}
								d={barPath(
									left,
									top,
									band.width,
									h,
									!bar.outer ? "none" : bar.to >= bar.from ? "top" : "bottom",
								)}
								fill={seriesColor(paint, bar.series)}
								opacity={barOpacity(bar.category, bar.series)}
							/>
						);
					})}
					{model.lines?.map((line) => (
						<Polyline
							key={`l${line.series}`}
							points={line.points
								.map((p) => `${xAt(p.category)},${yAt(p.y)}`)
								.join(" ")}
							fill="none"
							stroke={seriesColor(paint, line.series)}
							strokeWidth={2}
							strokeLinejoin="round"
							strokeLinecap="round"
							// §2 dual: the right-axis series draws dashed.
							strokeDasharray={line.axis === "right" ? [6, 4] : undefined}
							opacity={lineOpacity(line.series)}
						/>
					))}
					{/* §1 resting dots only up to 12 points. */}
					{n <= 12
						? model.lines?.flatMap((line) =>
								line.points.map((p) => (
									<Circle
										key={`d${line.series}-${p.category}`}
										cx={xAt(p.category)}
										cy={yAt(p.y)}
										r={2.5}
										fill={seriesColor(paint, line.series)}
										opacity={lineOpacity(line.series)}
									/>
								)),
							)
						: null}
					{active && model.lines ? (
						<>
							<Line
								x1={snap(xAt(active.category))}
								x2={snap(xAt(active.category))}
								y1={y0}
								y2={y1}
								stroke={colors["hairline-strong"]}
								strokeWidth={1}
							/>
							{model.lines.map((line) => {
								const p = line.points[active.category];
								return p ? (
									<Circle
										key={`a${line.series}`}
										cx={xAt(p.category)}
										cy={yAt(p.y)}
										r={4}
										fill={seriesColor(paint, line.series)}
										stroke={colors.canvas}
										strokeWidth={2}
									/>
								) : null;
							})}
						</>
					) : null}
					{model.points?.map((p, i) => {
						const on = active?.category === i;
						return (
							<Circle
								key={`p${i}`}
								cx={x0 + p.x * pw}
								cy={yAt(p.y)}
								r={on ? 6 : 4}
								fill={seriesColor(paint, 0)}
								fillOpacity={0.85}
								opacity={active && !on ? DIM : 1}
							/>
						);
					})}
				</Svg>
				{/* Y ticks: right-aligned in the measured left gutter. */}
				{model.left.values.map((v, i) => (
					<Text
						key={`y${i}`}
						className="absolute text-right text-meta tabular-nums text-ink-muted"
						numberOfLines={1}
						style={{
							left: 0,
							// The gutter is the 6.6/char estimate + 8 (§1); the box takes
							// all but 4 of it so an estimate that runs short for a wide
							// glyph never clips a tick to "2…".
							width: Math.max(0, x0 - 4),
							top: yAt(model.left.position(v)) - labelBox / 2,
						}}
					>
						{frame.leftLabels[i] ?? ""}
					</Text>
				))}
				{model.right?.values.map((v, i) => (
					<Text
						key={`r${i}`}
						className="absolute text-left text-meta tabular-nums text-ink-muted"
						numberOfLines={1}
						style={{
							left: x1 + 4,
							width: Math.max(0, width - x1 - 4),
							top: yAt(model.right?.position(v) ?? 0) - labelBox / 2,
						}}
					>
						{frame.rightLabels[i] ?? ""}
					</Text>
				))}
				{model.xAxis && xAxisLabels ? (
					model.xAxis.values.map((v, i) => {
						const label = xAxisLabels[i] ?? "";
						const w = Math.ceil(textWidth(label, fontScale) + 4);
						const x = x0 + (model.xAxis?.position(v) ?? 0) * pw;
						const last = model.xAxis ? model.xAxis.values.length - 1 : 0;
						const anchored = i === 0 ? x : i === last ? x - w : x - w / 2;
						return (
							<Text
								key={`x${i}`}
								className="absolute text-center text-meta tabular-nums text-ink-muted"
								numberOfLines={1}
								style={{
									left: Math.max(0, Math.min(width - w, anchored)),
									width: w,
									top: y1 + 6,
								}}
							>
								{label}
							</Text>
						);
					})
				) : (
					<XLabels
						labels={intervals ? [...intervals.labels] : model.categories}
						frame={frame}
						edges={frame.lineLike}
						fontScale={fontScale}
						width={width}
					/>
				)}
				<View
					{...gesture.panHandlers}
					style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
					onPointerMove={(event) => {
						if (event.nativeEvent.pointerType !== "mouse") return;
						const mark = hit(
							event.nativeEvent.offsetX,
							event.nativeEvent.offsetY,
						);
						if (!sameMark(mark, active)) setActive(mark);
					}}
					onPointerLeave={(event) => {
						if (event.nativeEvent.pointerType === "mouse") setActive(null);
					}}
				/>
				{info ? (
					<ChartTooltip
						content={info.tooltip}
						anchor={info.anchor}
						box={width}
						paint={paint}
					/>
				) : null}
			</View>
			{caption ? (
				<Text className="text-right text-meta text-ink-muted" numberOfLines={1}>
					{caption}
				</Text>
			) : null}
		</>
	);
}

/** §1 horizontal bars: 16 px bars on 28 px rows, labels in the left gutter. */
function HorizontalBarPlot({
	chart,
	paint,
	width,
	active,
	setActive,
	onMark,
}: {
	chart: CategoryChart;
	paint: Paint;
	width: number;
	active: ActiveMark | null;
	setActive: (mark: ActiveMark | null) => void;
	onMark: (info: MarkInfo | null, count: [number, number]) => void;
}) {
	const { colors, fontScale, locale } = paint;
	const labels = chart.data.map(([label]) => axisText(label));
	const n = labels.length;
	// The gutter fits the widest label, but never more than 40% of the box so
	// the bars keep most of the width; longer labels truncate with an ellipsis.
	const gutter = Math.ceil(
		Math.min(
			width * 0.4,
			Math.max(
				PLOT_MARGIN.minLeft,
				...labels.map((l) => textWidth(l, fontScale)),
			) + 8,
		),
	);
	const right = PLOT_MARGIN.right;
	const plotWidth = Math.max(1, width - gutter - right);
	const model = useMemo(
		() => horizontalBarModel(chart, plotWidth),
		[chart, plotWidth],
	);
	const ticks = tickLabels(model.left, locale);
	const top = 4;
	const plotBottom = top + n * HORIZONTAL_ROW;
	const height =
		plotBottom +
		Math.max(PLOT_MARGIN.bottom, Math.ceil(META_LINE * fontScale) + 6);
	const xAt = (position: number) => gutter + position * plotWidth;
	const rowTop = (i: number) => top + i * HORIZONTAL_ROW + 6;
	const activeBar = active ? model.bars?.[active.category] : undefined;
	const info: MarkInfo | null =
		active && activeBar
			? {
					tooltip: {
						title: chart.data[active.category]?.[0] ?? "",
						rows: [
							{
								value: withUnit(
									formatExact(activeBar.value, locale),
									chart.unit,
								),
							},
						],
					},
					anchor: {
						x: xAt(Math.max(activeBar.from, activeBar.to)),
						top: rowTop(active.category),
						bottom: rowTop(active.category) + 16,
					},
					description: describeMark(
						[
							chart.data[active.category]?.[0],
							withUnit(formatExact(activeBar.value, locale), chart.unit),
						],
						t("mobile.session.inline_chart.position", {
							index: active.category + 1,
							count: n,
						}),
					),
				}
			: null;
	useReportMark(onMark, info, [n, 1]);
	const hit = (_x: number, y: number) => {
		const category = Math.floor((y - top) / HORIZONTAL_ROW);
		return category >= 0 && category < n ? { category, series: 0 } : null;
	};
	const gesture = usePlotGesture({ hit, active, setActive, scrub: false });
	return (
		<View style={{ height }}>
			<Svg aria-hidden width={width} height={height}>
				{model.left.values.map((v, i) => (
					<Line
						key={i}
						x1={snap(xAt(model.left.position(v)))}
						x2={snap(xAt(model.left.position(v)))}
						y1={top}
						y2={plotBottom}
						stroke={
							v === 0 && model.left.lo < 0
								? colors["hairline-strong"]
								: colors.hairline
						}
						strokeWidth={1}
					/>
				))}
				{model.bars?.map((b, i) => {
					const left = xAt(Math.min(b.from, b.to));
					const w = Math.abs(xAt(b.to) - xAt(b.from));
					if (w <= 0) return null;
					return (
						<Path
							key={i}
							d={barPath(
								left,
								rowTop(i),
								w,
								16,
								b.to >= b.from ? "right" : "left",
							)}
							fill={paint.chart[0] ?? colors.accent}
							opacity={active && active.category !== i ? DIM : 1}
						/>
					);
				})}
			</Svg>
			{labels.map((text, i) => (
				<Text
					key={`c${i}`}
					className="absolute text-right text-meta text-ink-muted"
					numberOfLines={1}
					style={{
						left: 0,
						width: gutter - 8,
						top: rowTop(i) + 8 - (META_LINE * fontScale) / 2,
					}}
				>
					{text}
				</Text>
			))}
			{model.left.values.map((v, i) => {
				const label = ticks[i] ?? "";
				const w = Math.ceil(textWidth(label, fontScale) + 4);
				return (
					<Text
						key={`t${i}`}
						className="absolute text-center text-meta tabular-nums text-ink-muted"
						numberOfLines={1}
						style={{
							left: Math.max(
								0,
								Math.min(width - w, xAt(model.left.position(v)) - w / 2),
							),
							width: w,
							top: plotBottom + 6,
						}}
					>
						{label}
					</Text>
				);
			})}
			<View
				{...gesture.panHandlers}
				style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
				onPointerMove={(event) => {
					if (event.nativeEvent.pointerType !== "mouse") return;
					const mark = hit(
						event.nativeEvent.offsetX,
						event.nativeEvent.offsetY,
					);
					if (!sameMark(mark, active)) setActive(mark);
				}}
				onPointerLeave={(event) => {
					if (event.nativeEvent.pointerType === "mouse") setActive(null);
				}}
			/>
			{info ? (
				<ChartTooltip
					content={info.tooltip}
					anchor={info.anchor}
					box={width}
					paint={paint}
				/>
			) : null}
		</View>
	);
}

/** In-ring % text only where #000 or #FFF reaches 4.5:1 on the slot (§3). */
function ringTextColor(fill: string) {
	const black = contrastRatio("#000000", fill);
	const white = contrastRatio("#ffffff", fill);
	const best = Math.max(black, white);
	if (best < 4.5) return undefined;
	return black >= white ? "#000000" : "#FFFFFF";
}

/** Clockwise from 12 o'clock, in radians. */
const polar = (cx: number, cy: number, radius: number, angle: number) => [
	cx + radius * Math.sin(angle),
	cy - radius * Math.cos(angle),
];

function ringPath(
	cx: number,
	cy: number,
	outer: number,
	inner: number,
	start: number,
	end: number,
	gap: boolean,
) {
	// §3: 1.5 px angular gap as geometry; half on each side, constant in px
	// at both radii so the gap does not taper.
	const go = gap ? 0.75 / outer : 0;
	const gi = gap ? 0.75 / inner : 0;
	const a0 = start + go;
	const a1 = end - go;
	const b0 = start + gi;
	const b1 = end - gi;
	if (a1 <= a0 || b1 <= b0) return "";
	const large = a1 - a0 > Math.PI ? 1 : 0;
	const [ox0, oy0] = polar(cx, cy, outer, a0);
	const [ox1, oy1] = polar(cx, cy, outer, a1);
	const [ix1, iy1] = polar(cx, cy, inner, b1);
	const [ix0, iy0] = polar(cx, cy, inner, b0);
	return `M${ox0} ${oy0}A${outer} ${outer} 0 ${large} 1 ${ox1} ${oy1}L${ix1} ${iy1}A${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0}Z`;
}

type OutsideLabel = {
	index: number;
	side: 1 | -1;
	ex: number;
	ey: number;
	sx: number;
	sy: number;
	y: number;
};

/** §3 wide: relax each side's labels to ≥ 18 px apart, inside the box. */
function relaxLabels(labels: OutsideLabel[], height: number) {
	for (const side of [1, -1] as const) {
		const group = labels
			.filter((l) => l.side === side)
			.sort((a, b) => a.y - b.y);
		for (let i = 1; i < group.length; i++) {
			const prev = group[i - 1];
			const cur = group[i];
			if (prev && cur && cur.y - prev.y < 18) cur.y = prev.y + 18;
		}
		const overflow = (group[group.length - 1]?.y ?? 0) - (height - 9);
		if (overflow > 0) for (const l of group) l.y -= overflow;
		for (let i = group.length - 2; i >= 0; i--) {
			const next = group[i + 1];
			const cur = group[i];
			if (next && cur && next.y - cur.y < 18) cur.y = next.y - 18;
		}
	}
	return labels;
}

function DonutPlot({
	chart,
	paint,
	width,
	active,
	setActive,
	onMark,
}: {
	chart: CategoryChart;
	paint: Paint;
	width: number;
	active: ActiveMark | null;
	setActive: (mark: ActiveMark | null) => void;
	onMark: (info: MarkInfo | null, count: [number, number]) => void;
}) {
	const { colors, fontScale, locale } = paint;
	const pie: Pie = useMemo(() => {
		const m = inlineChartModel(chart);
		if (m.kind !== "pie") throw new Error("cartesian routed to pie");
		return m;
	}, [chart]);
	const wide = width >= NARROW_WIDTH;
	const diameter = pieDiameterFor(width);
	const outer = diameter / 2;
	const inner = outer * 0.6;
	const height = wide ? diameter + 24 : diameter;
	const cx = width / 2;
	const cy = height / 2;
	const tau = 2 * Math.PI;
	const sliceLabel = (i: number) => {
		const slice = pie.slices[i];
		if (!slice) return "";
		return slice.folded
			? t("mobile.session.inline_chart.other", { count: slice.folded.length })
			: slice.label;
	};
	const fill = (i: number) => {
		const slice = pie.slices[i];
		return slice?.color === null || slice?.color === undefined
			? colors["ink-dim"]
			: seriesColor(paint, slice.color);
	};
	const valueText = (n: number) => withUnit(formatExact(n, locale), chart.unit);
	const activeSlice = active ? pie.slices[active.category] : undefined;
	const position = active
		? t("mobile.session.inline_chart.position", {
				index: active.category + 1,
				count: pie.slices.length,
			})
		: "";
	const shareText = (share: number) =>
		t("mobile.session.inline_chart.share", {
			share: formatShare(share, locale),
		});
	const folded = activeSlice?.folded;
	const notes = folded
		? [
				...folded
					.slice(0, 8)
					.map(({ label, value }) => `${label} · ${valueText(value)}`),
				...(folded.length > 8
					? [
							t("mobile.session.inline_chart.more", {
								count: folded.length - 8,
							}),
						]
					: []),
			]
		: undefined;
	const mid = activeSlice
		? ((activeSlice.start + activeSlice.end) / 2) * tau
		: 0;
	const [ax, ay] = polar(cx, cy, outer + 8, mid);
	const info: MarkInfo | null =
		active && activeSlice
			? {
					tooltip: {
						title: sliceLabel(active.category),
						rows: [{ value: valueText(activeSlice.value) }],
						notes: [shareText(activeSlice.share), ...(notes ?? [])],
					},
					anchor: { x: ax ?? cx, top: ay ?? cy, bottom: ay ?? cy },
					description: describeMark(
						[
							sliceLabel(active.category),
							valueText(activeSlice.value),
							shareText(activeSlice.share),
						],
						position,
					),
				}
			: null;
	useReportMark(onMark, info, [pie.slices.length, 1]);
	const hit = (x: number, y: number): ActiveMark | null => {
		const distance = Math.hypot(x - cx, y - cy);
		if (distance < inner - 8 || distance > outer + 8) return null;
		const angle = (Math.atan2(x - cx, cy - y) + tau) % tau;
		const fraction = angle / tau;
		const category = pie.slices.findIndex(
			({ start, end }) => fraction >= start && fraction < end,
		);
		return category < 0 ? null : { category, series: 0 };
	};
	const gesture = usePlotGesture({ hit, active, setActive, scrub: false });
	const pick = (i: number) =>
		setActive(active?.category === i ? null : { category: i, series: 0 });

	// §3 wide: outside labels for slices ≥ 3%, leader line, relaxed per side.
	const outside = wide
		? relaxLabels(
				pie.slices.flatMap((slice, index): OutsideLabel[] => {
					if (slice.share < 0.03) return [];
					const angle = ((slice.start + slice.end) / 2) * tau;
					const [sx = 0, sy = 0] = polar(cx, cy, outer + 4, angle);
					const [ex = 0, ey = 0] = polar(cx, cy, outer + 16, angle);
					return [
						{ index, side: angle < Math.PI ? 1 : -1, sx, sy, ex, ey, y: ey },
					];
				}),
				height,
			)
		: [];
	const small = wide ? pie.slices.filter((slice) => slice.share < 0.03) : [];
	const single = pie.slices.length === 1;

	return (
		<View>
			<View style={{ height }}>
				<Svg aria-hidden width={width} height={height}>
					{pie.slices.map((slice, i) => {
						const opacity = active && active.category !== i ? DIM : 1;
						if (single)
							return (
								<Circle
									key={i}
									cx={cx}
									cy={cy}
									r={(outer + inner) / 2}
									stroke={fill(i)}
									strokeWidth={outer - inner}
									fill="none"
									opacity={opacity}
								/>
							);
						const d = ringPath(
							cx,
							cy,
							outer,
							inner,
							slice.start * tau,
							slice.end * tau,
							true,
						);
						return d ? (
							<Path key={i} d={d} fill={fill(i)} opacity={opacity} />
						) : null;
					})}
					{outside.map(({ index, side, sx, sy, ex, y }) => (
						<Polyline
							key={`ll${index}`}
							points={`${sx},${sy} ${ex},${y} ${ex + side * 12},${y}`}
							fill="none"
							stroke={colors["ink-muted"]}
							strokeOpacity={0.6}
							strokeWidth={1}
						/>
					))}
				</Svg>
				{!wide
					? pie.slices.map((slice, i) => {
							const color = ringTextColor(fill(i));
							if (slice.share < 0.08 || !color) return null;
							const angle = ((slice.start + slice.end) / 2) * tau;
							const [x = 0, y = 0] = polar(cx, cy, (outer + inner) / 2, angle);
							return (
								<Text
									key={`in${i}`}
									className="absolute text-center text-meta font-semibold tabular-nums"
									numberOfLines={1}
									style={{
										left: x - 24,
										width: 48,
										top: y - (META_LINE * fontScale) / 2,
										color,
										opacity: active && active.category !== i ? DIM : 1,
									}}
								>
									{formatShare(slice.share, locale)}
								</Text>
							);
						})
					: null}
				{outside.map(({ index, side, ex, y }) => {
					const slice = pie.slices[index];
					if (!slice) return null;
					const x = ex + side * 16;
					const w = Math.max(0, side > 0 ? width - x : x);
					return (
						<Text
							key={`ol${index}`}
							className={`absolute text-meta text-ink ${side > 0 ? "text-left" : "text-right"}`}
							numberOfLines={1}
							style={{
								left: side > 0 ? x : 0,
								width: w,
								top: y - (META_LINE * fontScale) / 2,
								opacity: active && active.category !== index ? DIM : 1,
							}}
						>
							{sliceLabel(index)}
							<Text className="text-ink-muted">
								{`  ${formatShare(slice.share, locale)}`}
							</Text>
						</Text>
					);
				})}
				{/* §3 centre readout: total at rest, the active slice otherwise.
				 * On touch it is the tooltip, so it never sits under the finger. */}
				<View
					pointerEvents="none"
					className="absolute items-center justify-center"
					style={{
						left: cx - inner * 0.85,
						width: inner * 1.7,
						top: cy - inner * 0.85,
						height: inner * 1.7,
					}}
				>
					<Text
						className="text-center text-meta text-ink-muted"
						numberOfLines={1}
					>
						{activeSlice
							? sliceLabel(active?.category ?? 0)
							: t("mobile.session.inline_chart.total")}
					</Text>
					<Text
						className="text-center text-meta font-semibold tabular-nums text-ink"
						numberOfLines={1}
					>
						{valueText(activeSlice ? activeSlice.value : pie.total)}
					</Text>
					{activeSlice ? (
						<Text
							className="text-center text-meta tabular-nums text-ink-muted"
							numberOfLines={1}
						>
							{formatShare(activeSlice.share, locale)}
						</Text>
					) : null}
				</View>
				<View
					{...gesture.panHandlers}
					style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
					onPointerMove={(event) => {
						if (event.nativeEvent.pointerType !== "mouse") return;
						const mark = hit(
							event.nativeEvent.offsetX,
							event.nativeEvent.offsetY,
						);
						if (!sameMark(mark, active)) setActive(mark);
					}}
					onPointerLeave={(event) => {
						if (event.nativeEvent.pointerType === "mouse") setActive(null);
					}}
				/>
				{/* Floating tooltip only where labels sit outside (wide); narrow
				 * touch uses the centre readout (§5 Placement). */}
				{wide && info ? (
					<ChartTooltip
						content={info.tooltip}
						anchor={info.anchor}
						box={width}
						paint={paint}
					/>
				) : null}
			</View>
			{!wide ? (
				// §3 narrow legend: two columns, rows 'swatch · label · %', interactive.
				<View
					className="mt-2 flex-row flex-wrap"
					style={{ rowGap: 8, columnGap: 16 }}
				>
					{pie.slices.map((slice, i) => (
						<Pressable
							key={i}
							accessible={false}
							onPress={() => pick(i)}
							hitSlop={{ top: 12, bottom: 12 }}
							className="flex-row items-center gap-2"
							style={{
								width: (width - 16) / 2,
								opacity: active && active.category !== i ? DIM : 1,
							}}
						>
							<Swatch color={fill(i)} />
							<Text className="shrink text-meta text-ink" numberOfLines={1}>
								{sliceLabel(i)}
							</Text>
							<Text className="ms-auto text-meta tabular-nums text-ink-muted">
								{formatShare(slice.share, locale)}
							</Text>
						</Pressable>
					))}
				</View>
			) : small.length ? (
				<View className="mt-2 flex-row flex-wrap justify-center gap-x-1">
					<Text className="text-meta text-ink-muted">
						{t("mobile.session.inline_chart.also", { items: "" }).trim()}
					</Text>
					{small.map((slice) => {
						const i = pie.slices.indexOf(slice);
						return (
							<Pressable key={i} accessible={false} onPress={() => pick(i)}>
								<Text className="text-meta text-ink-muted">
									{`${sliceLabel(i)} ${formatShare(slice.share, locale)}`}
								</Text>
							</Pressable>
						);
					})}
				</View>
			) : null}
		</View>
	);
}

/** Legend + unit row above a cartesian plot (§1 rhythm, §2 Units). */
function CartesianHeader({
	chart,
	paint,
}: {
	chart: InlineChart;
	paint: Paint;
}) {
	const series = chart.type === "series" ? chart.series : [];
	const dual = chart.type === "series" && chart.mode === "dual";
	const percent = chart.type === "series" && chart.mode === "percent";
	const leftUnit =
		chart.type === "scatter"
			? chart.yLabel
			: chart.type === "histogram"
				? chart.unit
				: percent
					? undefined
					: chart.unit;
	const rightUnit = dual ? chart.rightUnit : undefined;
	return (
		<>
			{series.length > 1 ? (
				<View className="mb-2 flex-row flex-wrap items-center gap-x-4 gap-y-1">
					{series.map(({ label, axis }, i) => (
						<View key={i} className="max-w-48 flex-row items-center gap-1.5">
							<Swatch
								color={seriesColor(paint, i)}
								dashed={dual ? axis === "right" : undefined}
							/>
							<Text className="shrink text-meta text-ink" numberOfLines={1}>
								{dual && axis === "right"
									? t("mobile.session.inline_chart.right_axis", { label })
									: label}
							</Text>
						</View>
					))}
				</View>
			) : null}
			{leftUnit || rightUnit ? (
				<View className="mb-1 flex-row" style={{ direction: "ltr" }}>
					<Text className="flex-1 text-meta text-ink-muted" numberOfLines={1}>
						{leftUnit ?? ""}
					</Text>
					{rightUnit ? (
						<Text className="text-meta text-ink-muted" numberOfLines={1}>
							{rightUnit}
						</Text>
					) : null}
				</View>
			) : null}
		</>
	);
}

/** §7 — the height the chart will take, reserved before width is measured. */
const reservedHeight = (chart: InlineChart, width: number) =>
	chart.type === "pie"
		? pieDiameterFor(width) + (width >= NARROW_WIDTH ? 24 : 0)
		: plotHeightFor(width) + PLOT_MARGIN.top + PLOT_MARGIN.bottom;

type WebKeyNode = {
	addEventListener: (type: "keydown", fn: (e: WebKey) => void) => void;
	removeEventListener: (type: "keydown", fn: (e: WebKey) => void) => void;
};
type WebKey = { key: string; preventDefault: () => void };

export function InlineChartPlot({
	chart,
	locale,
}: {
	chart: InlineChart;
	locale: string;
}) {
	const {
		active: { colors },
		chart: palette,
	} = useTheme();
	const { effectiveScale: fontScale } = useTextScale();
	const [width, setWidth] = useState(0);
	const [active, setActive] = useState<ActiveMark | null>(null);
	const [mark, setMark] = useState<{
		info: MarkInfo | null;
		count: [number, number];
	}>({ info: null, count: [0, 1] });
	const paint = useMemo(
		() => ({ colors, chart: palette, fontScale, locale }),
		[colors, palette, fontScale, locale],
	);
	// §7 — fade the marks in once on mount; no fade with reduced motion and
	// never again on re-render, resize or theme change.
	const opacity = useRef(new Animated.Value(0)).current;
	useEffect(() => {
		let cancelled = false;
		AccessibilityInfo.isReduceMotionEnabled()
			.catch(() => false)
			.then((reduce) => {
				if (cancelled) return;
				if (reduce) opacity.setValue(1);
				else
					Animated.timing(opacity, {
						toValue: 1,
						duration: FADE_MS,
						useNativeDriver: Platform.OS !== "web",
					}).start();
			});
		return () => {
			cancelled = true;
		};
	}, [opacity]);

	const step = (s: ChartStep) =>
		setActive((current) =>
			stepActive(current, s, mark.count[0], mark.count[1]),
		);
	// Web build: one tab stop with arrow/Home/End/Escape (§5 Keyboard).
	const rootRef = useRef<View>(null);
	const stepRef = useRef(step);
	stepRef.current = step;
	useEffect(() => {
		if (Platform.OS !== "web") return;
		const node = rootRef.current as unknown as WebKeyNode | null;
		if (!node || typeof node.addEventListener !== "function") return;
		const onKey = (event: WebKey) => {
			const s = keyStep(event.key);
			if (!s) return;
			event.preventDefault();
			stepRef.current(s);
		};
		node.addEventListener("keydown", onKey);
		return () => node.removeEventListener("keydown", onKey);
	}, []);

	const onMark = (info: MarkInfo | null, count: [number, number]) =>
		setMark((current) =>
			current.info?.description === info?.description &&
			current.count[0] === count[0] &&
			current.count[1] === count[1]
				? current
				: { info, count },
		);
	const props = { paint, width, active, setActive, onMark };
	const horizontal =
		chart.type === "bar" &&
		width > 0 &&
		horizontalBars(
			chart.data.map(([label]) => axisText(label)),
			width,
		);
	const description = mark.info?.description;
	return (
		<View
			ref={rootRef}
			onLayout={({ nativeEvent }: LayoutChangeEvent) =>
				setWidth(Math.round(nativeEvent.layout.width))
			}
			accessible
			focusable
			accessibilityRole="adjustable"
			accessibilityLabel={chart.title}
			accessibilityValue={description ? { text: description } : undefined}
			accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
			onAccessibilityAction={({ nativeEvent }: AccessibilityActionEvent) => {
				if (nativeEvent.actionName === "increment") step("next");
				if (nativeEvent.actionName === "decrement") step("previous");
			}}
			onBlur={() => setActive(null)}
			className="rounded-sm web:focus-visible:outline web:focus-visible:outline-2 web:focus-visible:outline-accent"
		>
			{/* Horizontal bars keep the unit row too: their value axis is x, but
			 * the unit still reads once, above the plot. */}
			{chart.type !== "pie" ? (
				<CartesianHeader chart={chart} paint={paint} />
			) : null}
			<Animated.View style={{ opacity }}>
				{width === 0 ? (
					<View style={{ height: reservedHeight(chart, 0) }} />
				) : chart.type === "pie" ? (
					<DonutPlot chart={chart} {...props} />
				) : horizontal && chart.type === "bar" ? (
					<HorizontalBarPlot chart={chart} {...props} />
				) : (
					<CartesianPlot chart={chart} {...props} />
				)}
			</Animated.View>
			{/* Visually hidden polite live region mirroring the active mark. */}
			<Text
				accessibilityLiveRegion="polite"
				aria-live="polite"
				style={{
					position: "absolute",
					width: 1,
					height: 1,
					opacity: 0,
					overflow: "hidden",
				}}
			>
				{description ?? ""}
			</Text>
		</View>
	);
}
