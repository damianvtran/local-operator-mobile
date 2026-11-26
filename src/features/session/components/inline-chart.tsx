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
 * - Every chart root is pinned `direction: "ltr"` (X8). Plot geometry is
 *   physical — the value axis grows rightwards, x labels anchor at measured
 *   pixels — so under an RTL locale (ur) the root must not mirror flex rows or
 *   flip `textAlign`; the physical `left`/`text-right` uses below rely on it
 *   and are allowlisted in `src/i18n/__tests__/physical-edges.test.ts`.
 */
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type AccessibilityActionEvent,
	AccessibilityInfo,
	Animated,
	type LayoutChangeEvent,
	PanResponder,
	type PanResponderCallbacks,
	Platform,
	Pressable,
	Text,
	View,
} from "react-native";
import Svg, {
	Circle,
	Defs,
	Line,
	LinearGradient,
	Path,
	Pattern,
	Polyline,
	Rect,
	Stop,
} from "react-native-svg";
import {
	type ActiveMark,
	axisText,
	barBand,
	type Cartesian,
	type ChartStep,
	categoryX,
	describeMark,
	formatExact,
	formatPieShare,
	formatShare,
	HEAT_FLOOR,
	type HeatmapChart,
	HORIZONTAL_ROW,
	heatmapModel,
	heatRowHeight,
	histogramAxisLabels,
	horizontalBarModel,
	horizontalBars,
	type InlineChart,
	inlineChartModel,
	keyStep,
	type LabelBox,
	labelWidth,
	layoutXLabels,
	NARROW_WIDTH,
	type Pie,
	PLOT_MARGIN,
	type PlotChart,
	pieDiameterFor,
	plotHeightFor,
	sideTooltipPlacement,
	stepActive,
	stepCell,
	tickLabels,
	tooltipPlacement,
	truncateLabel,
	withUnit,
} from "@/features/session/inline-chart-model";
import {
	noteChartTouch,
	touchOwner,
} from "@/features/session/inline-chart-touch";
import type { CategoryChart } from "@/features/session/inline-ui-parts";
import { t } from "@/i18n";
import { useTheme } from "@/ui/appearance";
import { contrastRatio, mixOklab } from "@/ui/chart-palette";
import { useShadow } from "@/ui/elevation";
import { lineBoxPt } from "@/ui/text-scale";
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
// §5 — the touch-target floor for legend rows and "Also:" items (Q6).
const TOUCH_MIN = 44;

/** The text-meta line box at the reader's scale (the one derivation, R8). */
const metaLine = (fontScale: number) => lineBoxPt("meta", fontScale);
/** §1 horizontal-bar row: 28 (16 bar + 12 gap), grown with the text scale so
 * row labels never overlap at large type (R4). */
export const horizontalRow = (fontScale: number) =>
	Math.max(HORIZONTAL_ROW, Math.ceil(metaLine(fontScale)) + 8);
const seriesColor = (paint: Paint, i: number) =>
	paint.chart[i % paint.chart.length] ?? paint.colors.accent;
const snap = (n: number) => Math.round(n) + 0.5;
const sameMark = (a: ActiveMark | null, b: ActiveMark | null) =>
	a?.category === b?.category && a?.series === b?.series;

type TooltipRow = { color?: string; label?: string; value: string };
type TooltipContent = { title?: string; rows: TooltipRow[]; notes?: string[] };
type Size = { width: number; height: number };
/** Where a tooltip of a measured size goes, plus its width cap. */
type Placement = {
	place: (size: Size) => { left: number; top: number };
	maxWidth: number;
};
type MarkInfo = {
	tooltip: TooltipContent;
	placement: Placement;
	description: string;
};

/** §5 / X4: above the mark, flipped below, never outside [0, maxBottom]. */
const aboveMark = (
	anchor: { x: number; top: number; bottom?: number },
	box: number,
	maxBottom: number,
): Placement => ({
	place: ({ width, height }) =>
		tooltipPlacement({ ...anchor, width, height, box, maxBottom }),
	maxWidth: Math.min(256, box - 8),
});

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
	placement,
	paint,
}: {
	content: TooltipContent;
	placement: Placement;
	paint: Paint;
}) {
	const shadow = useShadow("overlay");
	const [size, setSize] = useState<Size | null>(null);
	const place = placement.place(size ?? { width: 0, height: 0 });
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
					maxWidth: placement.maxWidth,
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

/** The cartesian frame in pixels. Memoised by its inputs (R3): a scrub or
 * hover re-render must not rebuild tick labels and their number formats. */
function useCartesianFrame(
	model: Cartesian,
	width: number,
	plotHeight: number,
	paint: Paint,
	percent: boolean,
) {
	const { fontScale, locale } = paint;
	return useMemo(
		() => cartesianFrame(model, width, plotHeight, fontScale, locale, percent),
		[model, width, plotHeight, fontScale, locale, percent],
	);
}

/** Exported for the gutter tests: the frame the plot draws from. */
export function cartesianFrame(
	model: Cartesian,
	width: number,
	plotHeight: number,
	fontScale: number,
	locale: string,
	percent: boolean,
) {
	const leftLabels = tickLabels(model.left, locale, percent);
	const rightLabels = model.right ? tickLabels(model.right, locale) : [];
	// D5: both tick gutters use the per-glyph `labelWidth` the x labels use.
	// The flat 6.6 px/char estimate gave `100%` 26.4 px against ~32 px drawn
	// (Figtree digits are 7.48 px), so percent charts showed `100…`.
	const widest = (labels: string[]) =>
		Math.max(0, ...labels.map((l) => labelWidth(l, fontScale)));
	const x0 = Math.max(PLOT_MARGIN.minLeft, Math.ceil(widest(leftLabels) + 8));
	const right = model.right
		? Math.ceil(widest(rightLabels) + 8)
		: PLOT_MARGIN.right;
	const x1 = Math.max(x0 + 1, width - right);
	const y0 = PLOT_MARGIN.top;
	const y1 = y0 + plotHeight;
	const bottom = Math.max(
		PLOT_MARGIN.bottom,
		Math.ceil(metaLine(fontScale)) + 6,
	);
	const pw = x1 - x0;
	const n = model.categories.length;
	const lineLike = model.variant === "line" || model.variant === "dual";
	const { slot, at: xAt } = categoryX(n, x0, x1, lineLike);
	const yAt = (position: number) => y1 - position * plotHeight;
	return {
		width,
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

type Frame = ReturnType<typeof cartesianFrame>;

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
			placement: aboveMark(
				{ x: cx, top: cy - 6, bottom: cy + 6 },
				frame.width,
				frame.y1,
			),
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
			placement: aboveMark(
				{ x, top: Math.min(...ys), bottom: Math.max(...ys) },
				frame.width,
				frame.y1,
			),
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
	// X4: `bar` is the active SEGMENT, so a stacked/percent tooltip anchors at
	// the hovered segment rather than the top of the whole stack.
	const top = frame.yAt(Math.max(bar.from, bar.to));
	return {
		tooltip: { title: label, rows, notes },
		placement: aboveMark(
			{
				x: centre + offset,
				top,
				bottom: frame.yAt(Math.min(bar.from, bar.to)),
			},
			frame.width,
			frame.y1,
		),
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

type GestureInput = {
	hit: (x: number, y: number) => ActiveMark | null;
	active: ActiveMark | null;
	setActive: (mark: ActiveMark | null) => void;
	scrub: boolean;
};

/** One gesture model for every plot (§5 Touch, X7). */
function usePlotGesture(input: GestureInput) {
	// The responder is created once; the latest closures ride in a ref.
	const latest = useRef(input);
	latest.current = input;
	return useMemo(
		() => PanResponder.create(plotGestureConfig(() => latest.current)),
		[],
	);
}

/**
 * The responder callbacks, separate from the hook so their contract is
 * testable without a native responder system.
 *
 * - A tap is decided on LIFT, within an 8 px slop: tap a mark to pin it, the
 *   same mark (or empty plot) to dismiss.
 * - A horizontal drag past the slop scrubs line charts, and only re-renders
 *   when the mark under the finger changes (R3).
 * - Termination — a cancelled touch, or the transcript's scroll view taking
 *   the gesture — clears any pinned mark and its dimming (X7).
 */
export function plotGestureConfig(
	get: () => GestureInput,
): PanResponderCallbacks {
	const state = { x: 0, y: 0, scrubbing: false };
	return {
		// Taps need the touch from its start. Until a horizontal drag passes the
		// slop, an ancestor that asks for the gesture gets it
		// (`onPanResponderTerminationRequest`).
		onStartShouldSetPanResponder: () => true,
		// R2: PanResponder's default answer is `true`, which on Android calls
		// `requestDisallowInterceptTouchEvent(true)` up the parent chain
		// (JSResponderHandler) — the transcript's NATIVE ScrollView could then
		// never intercept a vertical drag that starts on a chart. Not blocking
		// keeps scrolling native; scrubbing still works because a vertical
		// scroller intercepts only vertical travel.
		onShouldBlockNativeResponder: () => false,
		onMoveShouldSetPanResponder: (_, g) =>
			Math.abs(g.dx) > SCRUB_SLOP && Math.abs(g.dx) > Math.abs(g.dy),
		onPanResponderGrant: ({ nativeEvent }) => {
			state.x = nativeEvent.locationX;
			state.y = nativeEvent.locationY;
			state.scrubbing = false;
		},
		onPanResponderMove: (_, g) => {
			const latest = get();
			if (
				!state.scrubbing &&
				latest.scrub &&
				Math.abs(g.dx) > SCRUB_SLOP &&
				Math.abs(g.dx) > Math.abs(g.dy)
			)
				state.scrubbing = true;
			if (!state.scrubbing) return;
			// Start point + delta: `locationX` of a move event is relative to
			// whatever view is under the finger, not this overlay.
			const mark = latest.hit(state.x + g.dx, state.y + g.dy);
			if (mark && !sameMark(mark, latest.active)) latest.setActive(mark);
		},
		onPanResponderTerminationRequest: () => !state.scrubbing,
		onPanResponderRelease: (_, g) => {
			const latest = get();
			if (!state.scrubbing && Math.hypot(g.dx, g.dy) <= SCRUB_SLOP) {
				const mark = latest.hit(state.x, state.y);
				// Tap the same mark again (or empty space) to dismiss.
				latest.setActive(mark && !sameMark(mark, latest.active) ? mark : null);
			}
			state.scrubbing = false;
		},
		onPanResponderTerminate: () => {
			state.scrubbing = false;
			get().setActive(null);
		},
	};
}

/** Axis labels at the boxes `layoutXLabels` measured (X2): the box drawn is
 * the box tested, so shown labels never overlap. */
function AxisLabels({ boxes, top }: { boxes: LabelBox[]; top: number }) {
	return (
		<>
			{boxes.map((box, i) => (
				<Text
					key={i}
					className="absolute text-meta tabular-nums text-ink-muted"
					numberOfLines={1}
					style={{
						left: box.left,
						width: box.width,
						top,
						textAlign: box.align,
					}}
				>
					{box.text}
				</Text>
			))}
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
	const labelBox = metaLine(fontScale);
	const histogram = model.variant === "histogram";
	const intervals = useMemo(
		() => (histogram ? histogramAxisLabels(model.categories) : undefined),
		[histogram, model],
	);
	// X2: scatter's numeric x ticks and category labels share one layout,
	// edge-anchored for line-like charts and scatter, centred for bars.
	const xBoxes = useMemo(() => {
		const xAxis = model.xAxis;
		if (xAxis)
			return layoutXLabels({
				texts: tickLabels(xAxis, locale),
				anchors: xAxis.values.map((v) => x0 + xAxis.position(v) * pw),
				edges: true,
				lo: 0,
				hi: width,
				fontScale,
			});
		const labels = intervals ? intervals.labels : model.categories;
		return layoutXLabels({
			texts: labels.map(axisText),
			anchors: labels.map((_, i) => xAt(i)),
			edges: frame.lineLike,
			lo: 0,
			hi: width,
			fontScale,
		});
	}, [model, intervals, locale, x0, pw, xAt, frame.lineLike, width, fontScale]);
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
							// The gutter is the widest `labelWidth` + 8 (§1, D5); the box
							// takes all but 4 of it, which still holds the label's
							// measured box, so no tick clips to "100…".
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
				<AxisLabels boxes={xBoxes} top={y1 + 6} />
				<View
					{...gesture.panHandlers}
					className="absolute inset-0"
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
						placement={info.placement}
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
				// Row labels share the axis-label measure, so a wide glyph
				// never ellipsizes a label the gutter was sized to hold.
				...labels.map((l) => labelWidth(l, fontScale)),
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
	const line = metaLine(fontScale);
	const row = horizontalRow(fontScale);
	const plotBottom = top + n * row;
	const height = plotBottom + Math.max(PLOT_MARGIN.bottom, Math.ceil(line) + 6);
	const xAt = (position: number) => gutter + position * plotWidth;
	// The 16 px bar sits centred in its row, whatever the row's height.
	const rowTop = (i: number) => top + i * row + (row - 16) / 2;
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
					placement: aboveMark(
						{
							x: xAt(Math.max(activeBar.from, activeBar.to)),
							top: rowTop(active.category),
							bottom: rowTop(active.category) + 16,
						},
						width,
						plotBottom,
					),
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
		const category = Math.floor((y - top) / row);
		return category >= 0 && category < n ? { category, series: 0 } : null;
	};
	const gesture = usePlotGesture({ hit, active, setActive, scrub: false });
	const tickBoxes = layoutXLabels({
		texts: ticks,
		anchors: model.left.values.map((v) => xAt(model.left.position(v))),
		edges: false,
		lo: 0,
		hi: width,
		fontScale,
	});
	return (
		// X8: physical geometry (labels in the left gutter, bars growing right).
		<View style={{ height, direction: "ltr" }}>
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
						top: rowTop(i) + 8 - line / 2,
					}}
				>
					{/* D6: truncate here rather than leave it to the platform's
					    ellipsis, which keeps the word space (`Customer support …`);
					    `truncateLabel` trims it. The tooltip and table keep the
					    full label. */}
					{truncateLabel(text, gutter - 8, fontScale)}
				</Text>
			))}
			<AxisLabels boxes={tickBoxes} top={plotBottom + 6} />
			<View
				{...gesture.panHandlers}
				className="absolute inset-0"
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
					placement={info.placement}
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

/** §3 narrow legend: two columns of rows at least 44 tall (Q6), no gap, so
 * neighbouring hit areas never overlap. */
const legendRowHeight = (fontScale: number) =>
	Math.max(TOUCH_MIN, Math.ceil(metaLine(fontScale)));

/**
 * The donut's laid-out height at `width`, legend and caption lines included:
 * one function for the plot and the pre-layout reservation (R5), so a pie
 * mounts at the height it ends at.
 */
export function donutHeight(pie: Pie, width: number, fontScale: number) {
	const diameter = pieDiameterFor(width);
	if (width >= NARROW_WIDTH) {
		const small = pie.slices.some((slice) => slice.share < 0.03);
		return diameter + 24 + (small ? 8 + legendRowHeight(fontScale) : 0);
	}
	const folded = pie.slices.some((slice) => slice.folded);
	return (
		diameter +
		(folded ? Math.ceil(metaLine(fontScale)) : 0) +
		8 +
		Math.ceil(pie.slices.length / 2) * legendRowHeight(fontScale)
	);
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
	const line = metaLine(fontScale);
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
	// X9: one whole-percent format for every share a pie shows.
	const pct = (share: number) => formatPieShare(share, locale);
	const activeSlice = active ? pie.slices[active.category] : undefined;
	const position = active
		? t("mobile.session.inline_chart.position", {
				index: active.category + 1,
				count: pie.slices.length,
			})
		: "";
	const shareText = (share: number) =>
		t("mobile.session.inline_chart.share", { share: pct(share) });
	const folded = activeSlice?.folded;
	const more = (count: number) =>
		t("mobile.session.inline_chart.more", { count });
	const notes = folded
		? [
				...folded
					.slice(0, 8)
					.map(({ label, value }) => `${label} · ${valueText(value)}`),
				...(folded.length > 8 ? [more(folded.length - 8)] : []),
			]
		: undefined;
	const mid = activeSlice
		? ((activeSlice.start + activeSlice.end) / 2) * tau
		: 0;
	const [, ay = cy] = polar(cx, cy, outer + 8, mid);
	const info: MarkInfo | null =
		active && activeSlice
			? {
					tooltip: {
						title: sliceLabel(active.category),
						rows: [{ value: valueText(activeSlice.value) }],
						notes: [shareText(activeSlice.share), ...(notes ?? [])],
					},
					placement: {
						// X5: beside the ring on the slice's side, never over it.
						place: (size) =>
							sideTooltipPlacement({
								cx,
								outer,
								side: mid < Math.PI ? 1 : -1,
								y: ay,
								width: size.width,
								height: size.height,
								box: width,
								boxHeight: height,
							}),
						maxWidth: Math.min(
							256,
							sideTooltipPlacement({
								cx,
								outer,
								side: mid < Math.PI ? 1 : -1,
								y: ay,
								width: 0,
								height: 0,
								box: width,
								boxHeight: height,
							}).maxWidth,
						),
					},
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
	const hasOther = pie.slices.some((slice) => slice.folded);
	// Q7: on a phone the centre readout is the tooltip and has no room for the
	// folded list, so the line under the donut names up to 3 of them. Its
	// height is reserved whenever the pie has an "Other" slice, so selecting it
	// never pushes the legend down.
	const foldedLine =
		!wide && folded
			? [
					folded
						.slice(0, 3)
						.map(({ label }) => label)
						.join(" · "),
					...(folded.length > 3 ? [more(folded.length - 3)] : []),
				].join(" · ")
			: "";
	// Q3: legend rows and "Also:" items mirror the chart's own adjustable
	// element, so they are pointer/touch targets only, never extra tab stops.
	const notFocusable = {
		accessible: false,
		focusable: false,
		tabIndex: -1 as const,
	};

	return (
		// X8: the ring, its labels and the legend columns are physical geometry.
		<View style={{ direction: "ltr" }}>
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
							const text = pct(slice.share);
							// R4: the label must fit the band at the reader's text
							// scale — along the slice's arc and across the ring.
							const w = labelWidth(text, fontScale);
							const arc =
								(slice.end - slice.start) * tau * ((outer + inner) / 2);
							if (w + 4 > arc || line + 2 > outer - inner) return null;
							const angle = ((slice.start + slice.end) / 2) * tau;
							const [x = 0, y = 0] = polar(cx, cy, (outer + inner) / 2, angle);
							return (
								<Text
									key={`in${i}`}
									className="absolute text-center text-meta font-semibold tabular-nums"
									numberOfLines={1}
									style={{
										left: x - w / 2,
										width: w,
										top: y - line / 2,
										color,
										opacity: active && active.category !== i ? DIM : 1,
									}}
								>
									{text}
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
								top: y - line / 2,
								opacity: active && active.category !== index ? DIM : 1,
							}}
						>
							{sliceLabel(index)}
							<Text className="text-ink-muted">{`  ${pct(slice.share)}`}</Text>
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
							{pct(activeSlice.share)}
						</Text>
					) : null}
				</View>
				<View
					{...gesture.panHandlers}
					className="absolute inset-0"
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
						placement={info.placement}
						paint={paint}
					/>
				) : null}
			</View>
			{!wide && hasOther ? (
				<Text
					className="text-center text-meta text-ink-muted"
					numberOfLines={1}
					style={{ minHeight: Math.ceil(line) }}
				>
					{foldedLine}
				</Text>
			) : null}
			{!wide ? (
				// §3 narrow legend: two columns, rows 'swatch · label · %', interactive.
				<View className="mt-2 flex-row flex-wrap" style={{ columnGap: 16 }}>
					{pie.slices.map((slice, i) => (
						<Pressable
							key={i}
							{...notFocusable}
							onPress={() => pick(i)}
							className="flex-row items-center gap-2"
							style={{
								width: (width - 16) / 2,
								minHeight: legendRowHeight(fontScale),
								opacity: active && active.category !== i ? DIM : 1,
							}}
						>
							<Swatch color={fill(i)} />
							<Text className="shrink text-meta text-ink" numberOfLines={1}>
								{sliceLabel(i)}
							</Text>
							<Text className="ms-auto text-meta tabular-nums text-ink-muted">
								{pct(slice.share)}
							</Text>
						</Pressable>
					))}
				</View>
			) : small.length ? (
				<View className="mt-2 flex-row flex-wrap items-center justify-center gap-x-1">
					<Text className="text-meta text-ink-muted">
						{t("mobile.session.inline_chart.also_label")}
					</Text>
					{small.map((slice) => {
						const i = pie.slices.indexOf(slice);
						return (
							<Pressable
								key={i}
								{...notFocusable}
								onPress={() => pick(i)}
								className="items-center justify-center px-1"
								style={{
									minHeight: legendRowHeight(fontScale),
									minWidth: TOUCH_MIN,
									opacity: active && active.category !== i ? DIM : 1,
								}}
							>
								<Text className="text-meta text-ink-muted">
									{`${sliceLabel(i)} ${pct(slice.share)}`}
								</Text>
							</Pressable>
						);
					})}
				</View>
			) : null}
		</View>
	);
}

/** §4 heatmap geometry at a width: one function for the plot and the
 * pre-layout reservation (exported for the layout tests). */
export function heatmapFrame(
	chart: HeatmapChart,
	width: number,
	fontScale: number,
) {
	const line = metaLine(fontScale);
	const rows = chart.rowLabels.length;
	const columns = chart.columns.length;
	const gap = 2;
	// Row height follows §1; at a large text scale it grows so a row label
	// never overlaps the next row.
	const rowHeight = Math.max(heatRowHeight(width), Math.ceil(line) + 4);
	const gutter = Math.ceil(
		Math.min(
			width * 0.4,
			Math.max(
				PLOT_MARGIN.minLeft,
				...chart.rowLabels.map((label) => labelWidth(label, fontScale)),
			) + 8,
		),
	);
	const cellWidth = Math.max(
		1,
		(width - gutter - gap * (columns - 1)) / Math.max(1, columns),
	);
	const legend = Math.max(16, Math.ceil(line));
	// The grid starts under the legend row (16) and the §1 8 px rhythm gap.
	const gridTop = legend + 8;
	const gridBottom = gridTop + rows * rowHeight + Math.max(0, rows - 1) * gap;
	return {
		line,
		rows,
		columns,
		gap,
		rowHeight,
		gutter,
		cellWidth,
		legend,
		gridTop,
		gridBottom,
		cellX: (c: number) => gutter + c * (cellWidth + gap),
		cellY: (r: number) => gridTop + r * (rowHeight + gap),
		height: gridBottom + 6 + Math.ceil(line),
	};
}

/**
 * Column labels under the grid (C2). Centred on each cell, and
 * `layoutXLabels` clamps every box inside [gutter, width], so the first and
 * last labels slide inward to fit whole instead of collapsing to a bare "…"
 * at the chart edges. Exported so the tests measure the boxes that are drawn.
 */
export function heatmapColumnBoxes(
	chart: HeatmapChart,
	frame: ReturnType<typeof heatmapFrame>,
	fontScale: number,
) {
	return layoutXLabels({
		texts: chart.columns.map(axisText),
		anchors: chart.columns.map((_, c) => frame.cellX(c) + frame.cellWidth / 2),
		edges: false,
		lo: frame.gutter,
		hi:
			frame.gutter + frame.columns * (frame.cellWidth + frame.gap) - frame.gap,
		fontScale,
	});
}

/**
 * §4/§5 heatmap: sequential accent→surface fill in OKLab (X10 floor), gap 2,
 * radius 3, no text in the cells; `null` cells are a 45° hairline-strong hatch
 * and read "No data"; a 120×8 gradient legend with the min and max top-right.
 * Cells are marks like any other: hover, tap and keyboard (←/→ column, ↑/↓
 * row) drive the shared active mark, tooltip and announcement.
 */
function HeatmapPlot({
	chart,
	paint,
	width,
	active,
	setActive,
	onMark,
}: {
	chart: HeatmapChart;
	paint: Paint;
	width: number;
	active: ActiveMark | null;
	setActive: (mark: ActiveMark | null) => void;
	onMark: (info: MarkInfo | null, count: [number, number]) => void;
}) {
	const { colors, fontScale, locale } = paint;
	const model = useMemo(() => heatmapModel(chart), [chart]);
	const frame = heatmapFrame(chart, width, fontScale);
	const { rows, columns, cellX, cellY, cellWidth, rowHeight } = frame;
	// SVG ids are document-global on web: one per chart instance.
	const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const hatchId = `heat-hatch-${id}`;
	const gradientId = `heat-legend-${id}`;
	const fillFor = (value: number) =>
		mixOklab(colors.accent, colors.surface, model.mix(value));
	const valueText = (value: number | null) =>
		value === null
			? t("mobile.session.inline_chart.no_data")
			: withUnit(formatExact(value, locale), chart.unit);
	const cell =
		active && active.category < columns && active.series < rows ? active : null;
	const value = cell
		? (chart.rows[cell.series]?.[cell.category] ?? null)
		: null;
	const rowLabel = cell ? (chart.rowLabels[cell.series] ?? "") : "";
	const column = cell ? (chart.columns[cell.category] ?? "") : "";
	const info: MarkInfo | null = cell
		? {
				tooltip: {
					title: rowLabel,
					rows: [{ label: column, value: valueText(value) }],
				},
				placement: aboveMark(
					{
						x: cellX(cell.category) + cellWidth / 2,
						top: cellY(cell.series),
						bottom: cellY(cell.series) + rowHeight,
					},
					width,
					frame.gridBottom,
				),
				description: describeMark(
					[rowLabel, column, valueText(value)],
					t("mobile.session.inline_chart.position", {
						index: cell.series * columns + cell.category + 1,
						count: rows * columns,
					}),
				),
			}
		: null;
	useReportMark(onMark, info, [columns, rows]);
	const hit = (x: number, y: number): ActiveMark | null => {
		const category = Math.floor((x - frame.gutter) / (cellWidth + frame.gap));
		const series = Math.floor((y - frame.gridTop) / (rowHeight + frame.gap));
		return category >= 0 && category < columns && series >= 0 && series < rows
			? { category, series }
			: null;
	};
	const gesture = usePlotGesture({ hit, active, setActive, scrub: false });
	const columnBoxes = heatmapColumnBoxes(chart, frame, fontScale);
	// The legend gradient is sampled in OKLab, since SVG interpolates stops in
	// sRGB; five stops keep the bar within a hair of the cells' own mix.
	const stops = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
		offset: f,
		color: mixOklab(
			colors.accent,
			colors.surface,
			HEAT_FLOOR + (1 - HEAT_FLOOR) * f,
		),
	}));
	const legendText = (n: number) =>
		withUnit(formatExact(n, locale), chart.unit);
	return (
		// X8: physical geometry (row labels in the left gutter).
		<View style={{ height: frame.height, direction: "ltr" }}>
			{model.hasData ? (
				<View
					aria-hidden
					className="flex-row items-center justify-end gap-2"
					style={{ height: frame.legend }}
				>
					<Text className="text-meta tabular-nums text-ink-muted">
						{legendText(model.min)}
					</Text>
					<Svg width={120} height={8}>
						<Defs>
							<LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
								{stops.map((stop, i) => (
									<Stop key={i} offset={stop.offset} stopColor={stop.color} />
								))}
							</LinearGradient>
						</Defs>
						<Rect width={120} height={8} rx={4} fill={`url(#${gradientId})`} />
					</Svg>
					<Text className="text-meta tabular-nums text-ink-muted">
						{legendText(model.max)}
					</Text>
				</View>
			) : null}
			<Svg
				aria-hidden
				width={width}
				height={frame.height}
				style={{ position: "absolute", top: 0 }}
			>
				<Defs>
					<Pattern
						id={hatchId}
						patternUnits="userSpaceOnUse"
						width={4}
						height={4}
						patternTransform="rotate(45)"
					>
						<Line
							x1={0}
							y1={0}
							x2={0}
							y2={4}
							stroke={colors["hairline-strong"]}
							strokeWidth={1}
						/>
					</Pattern>
				</Defs>
				{chart.rows.flatMap((row, r) =>
					row.map((n, c) => (
						<Rect
							key={`${r}-${c}`}
							x={cellX(c)}
							y={cellY(r)}
							width={cellWidth}
							height={rowHeight}
							rx={3}
							fill={n === null ? `url(#${hatchId})` : fillFor(n)}
							opacity={
								cell && (cell.series !== r || cell.category !== c) ? DIM : 1
							}
						/>
					)),
				)}
			</Svg>
			{chart.rowLabels.map((label, r) => (
				<Text
					key={`r${r}`}
					className="absolute text-right text-meta text-ink-muted"
					numberOfLines={1}
					style={{
						left: 0,
						width: frame.gutter - 8,
						top: cellY(r) + (rowHeight - frame.line) / 2,
					}}
				>
					{/* D6: trimmed ellipsis, as for the horizontal-bar rows. */}
					{truncateLabel(label, frame.gutter - 8, fontScale)}
				</Text>
			))}
			<AxisLabels boxes={columnBoxes} top={frame.gridBottom + 6} />
			<View
				{...gesture.panHandlers}
				className="absolute inset-0"
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
					placement={info.placement}
					paint={paint}
				/>
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

/** Before the first layout the width is unknown; reserve at a phone's 360
 * (every phone is narrow) rather than 0, which gave a pie no height (R5). */
const NOMINAL_WIDTH = 360;

/** §7 — the height the plot will take, reserved before width is measured. */
export const reservedHeight = (
	chart: PlotChart,
	width: number,
	fontScale = 1,
) => {
	const w = width > 0 ? width : NOMINAL_WIDTH;
	if (chart.type === "heatmap") return heatmapFrame(chart, w, fontScale).height;
	if (chart.type === "pie") {
		const pie = inlineChartModel(chart);
		return pie.kind === "pie" ? donutHeight(pie, w, fontScale) : 0;
	}
	return (
		plotHeightFor(w) +
		PLOT_MARGIN.top +
		Math.max(PLOT_MARGIN.bottom, Math.ceil(metaLine(fontScale)) + 6)
	);
};

type WebNode = {
	addEventListener: (type: string, fn: (e: never) => void) => void;
	removeEventListener: (type: string, fn: (e: never) => void) => void;
	contains?: (node: unknown) => boolean;
	ownerDocument?: WebNode;
};
type WebKey = { key: string; preventDefault: () => void };

export function InlineChartPlot({
	chart,
	locale,
}: {
	chart: PlotChart;
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
			// R10: a fade already running must not outlive the chart.
			opacity.stopAnimation();
		};
	}, [opacity]);

	const heatmap = chart.type === "heatmap";
	const step = (s: ChartStep) =>
		setActive((current) =>
			stepActive(current, s, mark.count[0], mark.count[1]),
		);
	const clear = useCallback(() => setActive(null), []);
	// X7: the pinned chart is the one an outside touch dismisses.
	useEffect(() => {
		if (active) touchOwner.clear = clear;
		else if (touchOwner.clear === clear) touchOwner.clear = null;
	}, [active, clear]);
	useEffect(
		() => () => {
			if (touchOwner.clear === clear) touchOwner.clear = null;
		},
		[clear],
	);
	// Web build: one tab stop with arrow/Home/End/Escape (§5 Keyboard), and a
	// click or tap anywhere outside the chart dismisses its mark (X7).
	const rootRef = useRef<View>(null);
	const stepRef = useRef(step);
	stepRef.current = step;
	useEffect(() => {
		if (Platform.OS !== "web") return;
		const node = rootRef.current as unknown as WebNode | null;
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
	useEffect(() => {
		if (Platform.OS !== "web" || !active) return;
		const node = rootRef.current as unknown as WebNode | null;
		const doc = node?.ownerDocument;
		if (!node?.contains || !doc) return;
		const onDown = (event: { target: unknown }) => {
			if (!node.contains?.(event.target)) setActive(null);
		};
		doc.addEventListener("pointerdown", onDown);
		return () => doc.removeEventListener("pointerdown", onDown);
	}, [active]);

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
	// U3/Q4: the adjustable element always carries spoken text — the active
	// mark, else how many values the chart has — so no host falls back to a
	// numeric default (RN-web's slider read "50" at rest).
	const valueText =
		mark.info?.description ??
		t("mobile.session.inline_chart.value_count", {
			count:
				chart.type === "heatmap"
					? chart.rows.length * chart.columns.length
					: chart.type === "series"
						? chart.labels.length
						: chart.data.length,
		});
	const description = mark.info?.description;
	// The numeric half of the value (RN-web reads only the aria-* spellings):
	// the active mark's 1-based position, 0 at rest. Without it the browser
	// computes the slider midpoint, "50", for anything reading the number.
	const total = Math.max(1, mark.count[0] * mark.count[1]);
	const now = active
		? Math.min(total, active.series * mark.count[0] + active.category + 1)
		: 0;
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
			accessibilityValue={{ min: 0, max: total, now, text: valueText }}
			aria-valuetext={valueText}
			aria-valuemin={0}
			aria-valuemax={total}
			aria-valuenow={now}
			accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
			onAccessibilityAction={({ nativeEvent }: AccessibilityActionEvent) => {
				const direction =
					nativeEvent.actionName === "increment"
						? 1
						: nativeEvent.actionName === "decrement"
							? -1
							: 0;
				if (!direction) return;
				// A heatmap walks every cell in reading order; others walk categories.
				if (heatmap)
					setActive((current) =>
						stepCell(current, direction, mark.count[0], mark.count[1]),
					);
				else step(direction > 0 ? "next" : "previous");
			}}
			onFocus={(event) => {
				// §5 Keyboard: focus activates mark 0, so the first arrow moves.
				// Web: only keyboard focus (`:focus-visible`) — a click or tap
				// also focuses the root, and must not pin mark 0 under the finger.
				const target = event.target as unknown as {
					matches?: (selector: string) => boolean;
				};
				const keyboard =
					Platform.OS !== "web" || target?.matches?.(":focus-visible") === true;
				if (keyboard)
					setActive((current) => current ?? { category: 0, series: 0 });
			}}
			onBlur={() => setActive(null)}
			onTouchStart={() => noteChartTouch(clear)}
			// X8: plot geometry is physical; an RTL root must not mirror it.
			style={{ direction: "ltr" }}
			className="rounded-sm web:focus-visible:outline web:focus-visible:outline-2 web:focus-visible:outline-accent"
		>
			{/* Horizontal bars keep the unit row too: their value axis is x, but
			 * the unit still reads once, above the plot. */}
			{chart.type !== "pie" && chart.type !== "heatmap" ? (
				<CartesianHeader chart={chart} paint={paint} />
			) : null}
			<Animated.View style={{ opacity }}>
				{width === 0 ? (
					<View style={{ height: reservedHeight(chart, 0, fontScale) }} />
				) : chart.type === "heatmap" ? (
					<HeatmapPlot chart={chart} {...props} />
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
