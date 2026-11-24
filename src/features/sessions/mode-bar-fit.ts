import { useCallback, useEffect, useState } from "react";

/**
 * Whether the drawer's Agents | Team Bridge track can split into equal halves.
 *
 * Kept free of `react-native` so Node can pin the arithmetic: there is no
 * layout engine in the unit suite, so the component measures and this decides.
 */
export type ModeBarSegmentMode = "equal" | "proportional";

/** The track's `p-1`: the inset between its measured box and its segments. */
export const MODE_TRACK_INSET = 4;
/** The track's `gap-1` between the two segments. */
export const MODE_SEGMENT_GAP = 4;
/** What a segment adds around its label: the content's `px-2` on both sides
 *  (16) and its 1 pt `border` on both sides (2). */
export const MODE_SEGMENT_CHROME = 18;
/** Slack each segment keeps beyond its measured label (PR #333 QA Q1-1).
 *  react-native-web's `onLayout` reports `offsetWidth`, which rounds to the
 *  nearest pixel (measured: the selected "Team Bridge" is 79.11 px and
 *  reports 79), and native snaps layout to device pixels. Without slack a
 *  measured exact fit chose halves whose label box was 0.11 px too narrow,
 *  and "Team Bridge" wrapped at 322 px. 1 pt covers the ±0.5 px rounding. */
export const MODE_FIT_MARGIN = 1;

/**
 * `"equal"` when every segment's natural width, plus `MODE_FIT_MARGIN`, fits
 * in an equal share of the track (`n × (widest + margin) + gaps ≤ track`),
 * otherwise `"proportional"`.
 *
 * `track` is the track's INNER width (inside its padding); `segments` are each
 * segment's natural width (label plus `MODE_SEGMENT_CHROME`). Anything not yet
 * measured — `null`, or a 0 from a box that has not laid out — answers
 * `"proportional"`, because that layout is the one that is correct without a
 * measurement: it can only ever under-use the track, never squeeze a label.
 */
export const modeBarSegmentMode = (
	track: number | null,
	segments: ReadonlyArray<number | null>,
	gap: number,
): ModeBarSegmentMode => {
	if (track === null || !(track > 0) || segments.length === 0)
		return "proportional";
	let widest = 0;
	for (const width of segments) {
		if (width === null || !(width > 0)) return "proportional";
		widest = Math.max(widest, width);
	}
	const needed =
		segments.length * (widest + MODE_FIT_MARGIN) + (segments.length - 1) * gap;
	return needed <= track ? "equal" : "proportional";
};

/** The one field of a `LayoutChangeEvent` this reads; structural so the
 *  module stays importable in Node. */
type LayoutEvent = { nativeEvent: { layout: { width: number } } };

type Fit = {
	/** The track's inner width (its box minus `p-1` on both sides). */
	track: number | null;
	/** Each label's natural width, measured in the selected weight. */
	labels: readonly [number | null, number | null];
};

/**
 * The last fit any mode bar measured, and what it measured (`key`).
 *
 * WHY REMEMBER IT. The drawer is a `Modal` that mounts its header on every
 * open, and `onLayout` answers a frame after the first paint, so a bar that
 * only trusted its own measurement would paint the proportional split and then
 * jump to equal halves on every open. Seeding the next mount with the last
 * fit for the same bar (drawer or docked pane), labels and text size makes
 * that first frame already right; only the first open after launch (still
 * sliding in from off screen; Reduce Motion shortens the slide) pays the
 * correction. The bar is part of the key because the docked pane has no close
 * button and so a wider track (PR #333 review R1-2): a fit from one never
 * seeds the other. A seed from the same bar at a different window width is
 * corrected by the next `onLayout` like a rotation would be.
 */
let remembered: (Fit & { key: string }) | null = null;

/** Clears the remembered fit; for tests, which must each start unmeasured. */
export const forgetModeBarFit = (): void => {
	remembered = null;
};

/**
 * Measures the mode track and its two labels and answers the layout to use.
 *
 * `key` names what was measured (the bar, the text scale and both label
 * strings): a remembered fit seeds a new mount only when its key matches, and
 * any other mount starts unmeasured, i.e. proportional. `enabled` is
 * false at large text, where the track wraps instead and nothing is measured.
 */
export const useModeBarFit = (enabled: boolean, key: string) => {
	const [fit, setFit] = useState<Fit>(() =>
		remembered?.key === key
			? remembered
			: { track: null, labels: [null, null] },
	);
	/* Remembered after commit rather than inside the setters: a state updater
	 *  must stay pure (React may run it twice). Within one mount the labels are
	 *  never reset when `key` changes: a locale whose labels are the same
	 *  width sends no new `onLayout`, and a reset would strand the bar on the
	 *  fallback; a label that did change re-reports within a frame. */
	useEffect(() => {
		remembered = { ...fit, key };
	}, [fit, key]);
	const onTrackLayout = useCallback((event: LayoutEvent) => {
		const track = event.nativeEvent.layout.width - 2 * MODE_TRACK_INSET;
		setFit((current) =>
			current.track === track ? current : { ...current, track },
		);
	}, []);
	const onAgentsLabelLayout = useCallback((event: LayoutEvent) => {
		const width = event.nativeEvent.layout.width;
		setFit((current) =>
			current.labels[0] === width
				? current
				: { ...current, labels: [width, current.labels[1]] },
		);
	}, []);
	const onBridgeLabelLayout = useCallback((event: LayoutEvent) => {
		const width = event.nativeEvent.layout.width;
		setFit((current) =>
			current.labels[1] === width
				? current
				: { ...current, labels: [current.labels[0], width] },
		);
	}, []);
	const mode: ModeBarSegmentMode = enabled
		? modeBarSegmentMode(
				fit.track,
				fit.labels.map((width) =>
					width === null ? null : width + MODE_SEGMENT_CHROME,
				),
				MODE_SEGMENT_GAP,
			)
		: "proportional";
	return { mode, onTrackLayout, onAgentsLabelLayout, onBridgeLabelLayout };
};
