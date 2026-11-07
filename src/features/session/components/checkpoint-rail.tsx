import { CircleAlert, CircleDot, CircleSlash } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent, View } from "react-native";

import type { CheckpointManifest } from "@/contracts";
import {
	decimateRailMarks,
	layoutRailMarks,
	marksBeyondWindow,
	type PositionedRailMark,
	type RailVocabulary,
	railState,
} from "@/features/session/checkpoint-rail";
import {
	RAIL_FADE_MS,
	type ScrollPresence,
} from "@/features/session/transcript-presence";
import { STATE_MARKER, SURFACE } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { SKELETON_PULSE_MS } from "@/ui/variants";

/**
 * The transcript's checkpoint rail: the right-edge column of marks over the
 * conversation, positioned by `seq` from the whole-conversation manifest.
 *
 * THE FRAMES IT CANNOT USE. The phone's projection is a bounded tail window,
 * so a rail folded from the rows on screen would silently mark only the tail.
 * Every mark here comes from `GET /api/sessions/{id}/checkpoints` (the
 * journal-derived manifest) via `checkpoint-rail.ts`'s pure arithmetic — this
 * component only draws what that module decides.
 *
 * WHAT IT DRAWS (docs/relay/contract.md §3.13, design D1/D5 re-read on a
 * phone's terms):
 *
 *  - a user turn's mark — a short quiet dash (`ink-dim`);
 *  - a completed turn — a plain dash (it was the ✓ glyph in `success` ink
 *    until TestFlight 578; see "SUBTLE BY DEFAULT" below);
 *  - `error` / `interrupted` completions — the ! / ⊘ glyphs (danger/warning),
 *    the desktop card's own outcome icons, with the SHAPE carrying the state
 *    and the ink seconding it (U-03: a semantic colour is never alone);
 *  - a completion with no outcome word — a plain dash, never a ✓, because the
 *    tick would claim a verdict the wire did not send;
 *  - `outcome: "open"` — the in-progress DOT, never a tick;
 *  - density — seq-proportional placement compresses long conversations, so a
 *    mark whose neighbours sit closer than a glyph can hold draws as the thin
 *    compact dash (`RailForm`); a dense stretch is a legible ladder, not a
 *    pile of glyphs, and the compact form carries no semantic ink (a
 *    semantic-coloured bare dash is exactly the colour-only status U-03
 *    refuses — the outcome colour lives on the exempt glyphs).
 *
 * NOT TAPPABLE, DELIBERATELY (this is a decision, not an omission). The
 * desktop rail's press jumps to a turn; the phone cannot honour that jump
 * honestly today — history pages only OLDER (`before=`), so a newer id needs
 * an around-id read that does not exist yet, and per-tick controls at phone
 * density cannot pass the app's own touch gate (U-01: ≥ 24 pt with ≥ 8 pt
 * spacing in a dense list — proportional marks are neither; the alternative,
 * one 44 pt full-height surface, would swallow every right-edge tap in the
 * transcript). So the marks do not look pressable and nothing pretends they
 * are: no press states, no button roles, `pointerEvents: none`, and the
 * column is hidden from the accessibility tree. The click-to-jump lane ships
 * with the around-id read it owes (named in the PR).
 *
 * SUBTLE BY DEFAULT (TestFlight 578: "the right ticks … still feel too
 * invasive and crowded, make them more subtle or remove them"). Four levers,
 * each its own constant below so a later tune moves one number:
 *
 *  - DENSITY — the laid-out marks are thinned (`decimateRailMarks`) so no two
 *    drawn marks sit closer than `RAIL_MIN_GAP_PT`; a merged run draws its
 *    most salient member, so a failure is never hidden by its neighbours;
 *  - SIZE — hairline dashes (1 pt) a few points long, and the outcome glyphs
 *    shrink to 8 pt. An ordinary completion draws a dash, not the green ✓:
 *    the ✓ was most of the column and said nothing a reader scrolls to find.
 *    Only the exceptions keep a glyph — failure, interruption, the live tail;
 *  - INK — the whole column peaks at `RAIL_PEAK_OPACITY`, over the muted ink;
 *  - PLACE — the column sits in the outer `RAIL_EDGE_PT + RAIL_COLUMN_PT`
 *    points of the screen, inside the transcript's 16 pt (`px-4`) side
 *    padding, so a mark never paints over the text column.
 *
 * And it shows only while the reader travels FAST (`transcript-presence.ts`,
 * `RAIL_FAST_PT_PER_MS`), fading ~1 s after.
 *
 * THE STATE SET is `checkpoint-rail.ts`'s (`waiting`/`unavailable`/
 * `empty`/`marks`/`error`); this component adds only the drawing: the failure
 * state draws ONE danger glyph at the head and never an empty rail, and the
 * building state keeps the previous marks painting under a pulsing liveness
 * mark (reduce-motion leaves it static — U-13: nothing may loop for a reader
 * who asked for stillness).
 */

/** The glyph size in points. Fixed rather than text-scaled: these are marks,
 *  not text, and a 200 % scale that doubled them would defeat the compact
 *  thresholds around them. */
const GLYPH_PT = 8;

/** The dash box: [width, height] in points, per vocabulary. A completed
 *  turn's tick and a user turn's mark differ in LENGTH first — the quiet
 *  ink keeps the distinction visible when the colours flatten. */
const DASH_SIZE: Record<"user" | "plain" | "compact", [number, number]> = {
	user: [3, 1],
	plain: [5, 1],
	compact: [3, 1],
};

/** The column's opacity while shown. Low enough that the marks read as a
 *  texture at the edge rather than as content (TestFlight 578). */
export const RAIL_PEAK_OPACITY = 0.55;

/** Vertical offset of the head marks (liveness, failure) so they sit clear of
 *  the first seq-placed mark, which starts at `RAIL_INSET_PT`. */
const HEAD_Y_PT = 6;

/** The overlay's own geometry: an 8 pt column inset 7 pt from the edge, so
 *  the marks occupy 7–15 pt in — clear of the iOS scroll indicator, which
 *  draws in roughly the last 3–6 pt and shows during exactly the fast scrolls
 *  that summon the rail (review round 1, m3: a 4 pt inset sat under it), and
 *  still clear of the transcript's text, which starts 16 pt in (`px-4`). The
 *  indicator's band is inferred, not measured — TestFlight confirms it. It
 *  was 14 pt inset 8 pt (8–22 pt), which
 *  put every mark over the message text (TestFlight 578). The column is
 *  ABSOLUTE, so it takes no layout width from the transcript (the defect the
 *  web client's two-pane rail once was — 833 pt of rail beside a 533 pt
 *  transcript). */
const RAIL_COLUMN_PT = 8;
const RAIL_EDGE_PT = 7;

export type CheckpointRailProps = {
	/** The last manifest answered, or `null` before any answer. */
	manifest: CheckpointManifest | null;
	/** The read failed while no manifest is held (an older relay's 404, a
	 *  dropped route). Distinct from the relay SAYING `error` — see the model. */
	readFailed: boolean;
	/** The ids of the entries the transcript holds — what makes the
	 *  beyond-the-window marker a fact rather than a claim. */
	loadedIds: ReadonlySet<string>;
	/** The transcript's scroll signal (see `transcript-presence.ts`). While it
	 *  says the list is moving — or a thumb is holding it — the rail draws;
	 *  otherwise it is at opacity 0, which is the operator's report answered:
	 *  "maybe remove the line ticks along the side, only have them present if
	 *  the thumb is held to scroll fast or something like that so that they
	 *  don't constantly take space".
	 *
	 *  Omitted (a host that owns no list) keeps the rail always visible — the
	 *  old behaviour — rather than hiding a cue nobody can bring back. */
	presence?: ScrollPresence;
};

type Colors = {
	inkDim: string;
	inkMuted: string;
	warning: string;
	danger: string;
};

/** The glyph for a vocabulary word, or `null` for the dash forms. */
function glyphFor(
	vocabulary: RailVocabulary,
	colors: Colors,
): React.ReactElement | null {
	switch (vocabulary) {
		case "error":
			return (
				<CircleAlert color={colors.danger} size={GLYPH_PT} strokeWidth={2.5} />
			);
		case "interrupted":
			return (
				<CircleSlash color={colors.warning} size={GLYPH_PT} strokeWidth={2.5} />
			);
		case "open":
			return (
				<CircleDot
					color={colors.inkDim}
					size={GLYPH_PT - 1}
					strokeWidth={2.5}
				/>
			);
		default:
			return null;
	}
}

/** One mark's painted box: a glyph or a dash, never both. */
const RailMarkView = ({
	placed,
	colors,
}: {
	placed: PositionedRailMark;
	colors: Colors;
}) => {
	const { mark, yPt, form } = placed;
	const glyph = form === "glyph" ? glyphFor(mark.vocabulary, colors) : null;
	if (glyph !== null) {
		return (
			<View
				className="absolute items-center justify-center"
				style={{
					top: yPt - GLYPH_PT / 2,
					end: 0,
					width: RAIL_COLUMN_PT,
					height: GLYPH_PT,
				}}
			>
				{glyph}
			</View>
		);
	}
	/* The dash forms: a user mark, a completion with no outcome word, and any
	 *  mark at glyph-failing density (compact). Heights come from the table.
	 *  Compact is ONE muted dash for every family — a user mark's ink-dim
	 *  drops as it compacts — because where the ✓/dot vocabulary cannot hold
	 *  the glyph clearance, a dense stretch reads as uniform rungs. That is
	 *  the stated density decision (D68-2), not a separation: the family
	 *  distinction is dropped rather than faked. */
	const variant =
		form === "compact"
			? "compact"
			: mark.vocabulary === "user"
				? "user"
				: "plain";
	const [width, height] = DASH_SIZE[variant];
	const background = variant === "user" ? colors.inkDim : colors.inkMuted;
	return (
		<View
			className="absolute rounded-full"
			style={{
				top: yPt - height / 2,
				end: 0,
				width,
				height,
				backgroundColor: background,
			}}
		/>
	);
};

export const CheckpointRail = ({
	manifest,
	readFailed,
	loadedIds,
	presence,
}: CheckpointRailProps) => {
	const state = useMemo(
		() => railState(manifest, readFailed),
		[manifest, readFailed],
	);
	const [trackPt, setTrackPt] = useState(0);
	const reduceMotion = useReducedMotion();

	/* One `useTokenColor` per role (hooks cannot run per mark in a list),
	 * collected into the one object the mark renderers read. */
	const inkDim = useTokenColor("ink-dim");
	const inkMuted = useTokenColor("ink-muted");
	const warning = useTokenColor("warning");
	const danger = useTokenColor("danger");
	const colors = useMemo<Colors>(
		() => ({ inkDim, inkMuted, warning, danger }),
		[inkDim, inkMuted, warning, danger],
	);

	const drawing = state.kind === "marks" || state.kind === "error";
	const building = state.kind === "marks" && state.building;
	const marks =
		state.kind === "marks" || state.kind === "error" ? state.marks : [];

	const placed = useMemo(
		() =>
			trackPt > 0 ? decimateRailMarks(layoutRailMarks(marks, trackPt)) : [],
		[marks, trackPt],
	);

	const onLayout = (event: LayoutChangeEvent) => {
		setTrackPt(event.nativeEvent.layout.height);
	};

	/* THE TRANSIENT RAIL (design item 10). The marks are the checkpoint rail, not
	 * a scrollbar — but a permanent 14 pt column of ticks advertises one and takes
	 * the edge for the whole session, which is what the operator read. So it now
	 * behaves like every platform's transient scrollbar: visible while the list
	 * moves or a thumb holds it, gone a moment after it settles.
	 *
	 *  The opacity is an `Animated` value on the native driver, so the transition
	 *  costs the JS thread nothing per frame and no row re-renders. The presence
	 *  object is the screen's; this component only subscribes. */
	const presenceOpacity = useRef(
		new Animated.Value(
			presence === undefined || presence.readVisible() ? RAIL_PEAK_OPACITY : 0,
		),
	).current;
	useEffect(() => {
		if (presence === undefined) return;
		const aim = (visible: boolean) => {
			// U-13: a reader who asked for stillness gets the state, not the fade.
			if (reduceMotion) {
				presenceOpacity.setValue(visible ? RAIL_PEAK_OPACITY : 0);
				return;
			}
			Animated.timing(presenceOpacity, {
				toValue: visible ? RAIL_PEAK_OPACITY : 0,
				duration: RAIL_FADE_MS,
				useNativeDriver: true,
			}).start();
		};
		// A subscriber that mounted while the rail was already up adopts that state.
		aim(presence.readVisible());
		return presence.subscribe(aim);
	}, [presence, presenceOpacity, reduceMotion]);

	/* The building state's liveness mark: an opacity pulse, static under
	 * reduced motion (U-13). It is not a tick and sits clear of the first
	 * mark's own range, so it cannot be read as one. */
	const pulse = useRef(new Animated.Value(1)).current;
	useEffect(() => {
		if (!building) return;
		if (reduceMotion) {
			pulse.setValue(1);
			return;
		}
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: 0.3,
					duration: SKELETON_PULSE_MS / 2,
					useNativeDriver: true,
				}),
				Animated.timing(pulse, {
					toValue: 1,
					duration: SKELETON_PULSE_MS / 2,
					useNativeDriver: true,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [building, pulse, reduceMotion]);

	const beyondWindow =
		state.kind === "marks" || state.kind === "error"
			? marksBeyondWindow(marks, loadedIds)
			: false;

	return (
		<>
			{/* The capture cells' markers, one per state (zero-size, hidden from
			 *  the accessibility tree — the app's derived-marker convention).
			 *  `rail` is present only while the READY state draws ticks, so a
			 *  building or failing frame cannot satisfy the populated cell's
			 *  claim. `rail-deep` refines it: at least one mark is for a row
			 *  this device does not hold. */}
			<View aria-hidden>
				{state.kind === "marks" && marks.length > 0 && !state.building ? (
					<View testID={STATE_MARKER.session.rail} />
				) : null}
				{state.kind === "marks" && marks.length > 0 && beyondWindow ? (
					<View testID={STATE_MARKER.session["rail-deep"]} />
				) : null}
				{state.kind === "marks" && state.building ? (
					<View testID={STATE_MARKER.session["rail-building"]} />
				) : null}
				{state.kind === "error" ? (
					<View testID={STATE_MARKER.session["rail-error"]} />
				) : null}
				{state.kind === "empty" ? (
					<View testID={STATE_MARKER.session["rail-empty"]} />
				) : null}
			</View>
			{drawing ? (
				<Animated.View
					testID={SURFACE.checkpointRail}
					onLayout={onLayout}
					// Decorative: never a touch target, never an announcement in
					// the marks states (`pointerEvents` also hands every touch
					// straight through to the transcript beneath).
					pointerEvents="none"
					className="absolute inset-y-0"
					style={{
						end: RAIL_EDGE_PT,
						width: RAIL_COLUMN_PT,
						opacity: presenceOpacity,
					}}
					aria-hidden={state.kind !== "error" ? true : undefined}
				>
					{building ? (
						<Animated.View
							className="absolute rounded-full"
							style={{
								top: HEAD_Y_PT - 1.25,
								end: 0,
								width: 6,
								height: 2.5,
								backgroundColor: colors.inkMuted,
								opacity: pulse,
							}}
						/>
					) : null}
					{state.kind === "error" ? (
						/* The failure mark: the relay SAID the read failed. One
						 * alert glyph at the head — never an empty rail (see the
						 * header), and announced rather than hidden, because this
						 * state is a fact the reader should be able to hear. */
						<View
							className="absolute items-center justify-center"
							style={{
								top: HEAD_Y_PT - GLYPH_PT / 2,
								end: 0,
								width: RAIL_COLUMN_PT,
								height: GLYPH_PT,
							}}
							accessibilityLabel="Checkpoints couldn't be read"
						>
							<CircleAlert
								color={colors.danger}
								size={GLYPH_PT}
								strokeWidth={2.5}
							/>
						</View>
					) : null}
					{placed.map((entry) => (
						<RailMarkView key={entry.mark.id} placed={entry} colors={colors} />
					))}
				</Animated.View>
			) : null}
		</>
	);
};
