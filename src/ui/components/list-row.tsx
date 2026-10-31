import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Animated,
	Platform,
	Pressable,
	Text,
	View,
} from "react-native";

import { countLabel } from "@/lib/format";
import { ROLE, state } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import {
	metaLineFor,
	metaPathFloorDp,
	rowAccessibilityLabel,
} from "@/ui/components/list-row-meta";
import { listRowStatus } from "@/ui/components/list-row-status";
import { Shimmer } from "@/ui/components/shimmer";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import {
	cx,
	LIST_ROW_INDICATOR_CLASS,
	listRowClasses,
	listRowIndicator,
} from "@/ui/variants";

/**
 * The session row: the list screen's whole content (docs/design/components.md § 7).
 *
 * Two rules carry this component, and both are about what happens when the row is
 * under pressure rather than when it looks right in a screenshot:
 *
 *   1. **One reserved indicator slot for every state**, so every title starts at the
 *      same x forever. Indicators change colour, never geometry. A list that carries
 *      agent pictures widens that slot to the picture's width on EVERY row
 *      (`leadingSlotPt`), because a picture in some rows and not others would
 *      otherwise give the list two title columns.
 *   2. **The indicator ladder, first match wins**: a pending decision, then
 *      streaming, then unread. An approval gate runs INSIDE a turn, so the row that
 *      most needs the reader carries `pending` and `streaming` at once — testing
 *      streaming first would replace the danger pulse with a neutral spinner on
 *      exactly that row.
 *
 * The counts never yield: the TITLE truncates. The shipped client learned this
 * with a long tool name pinned `shrink-0`, where the deficit landed on the elapsed
 * clock and `59m 59s` rendered as `59m` — a shorter string that is itself a valid
 * duration, so nothing looked wrong.
 */
export type ListRowProps = {
	title: string;
	/** The working directory, already home-shortened by the caller. */
	cwd?: string;
	/** Model label, right-aligned on the second line. */
	model?: string;
	/** The trailing relative time ("now", "5 min", "3h", "2d"), from the panel's
	 *  time-based sections — the SECTION says when, the row says how long ago.
	 *  `ms-auto shrink-0` puts it on the row's right edge in every row, so the
	 *  title's own start x is the indicator slot's business regardless, and the
	 *  time's right edge does not depend on the title's length. Running rows pass
	 *  nothing (a running row's time is "now", which says nothing). */
	time?: string;
	subagentCount?: number;
	todoCount?: number;
	/** Outstanding queued asks on this session (`SessionSummary.asks_open`).
	 *  ABSENT — never `0` — while the runtime does not publish asks, and both
	 *  render nothing: a zero badge would count a list the relay cannot vouch
	 *  for, which is the one claim the capability proxy exists to withhold. */
	askCount?: number;
	/** The count chip's own id (`asksBadgeId(sessionId)`), declared by the caller
	 *  because the row does not know its session id — the same reason `testID`
	 *  arrives whole. Rendered only when the chip is. */
	askBadgeTestID?: string;
	/** A decision is waiting: the loudest state in the list. */
	pending?: boolean;
	/** The attention word the row shows with the dot: `approval` or `question`. */
	attentionWord?: "approval" | "question";
	streaming?: boolean;
	unread?: boolean;
	/** The daemon watched this session's runtime die: a receipt of a death THIS
	 *  daemon saw, not an error (`SessionSummary.ended`). */
	ended?: boolean;
	/** The record is fresh but the session's control socket is unreachable
	 *  (`SessionSummary.degraded`). Distinct from `ended`, and distinct from the
	 *  LIST being degraded — a degraded row is one session not answering, a
	 *  degraded listing is the relay unable to walk the catalogue. */
	degraded?: boolean;
	/** The session currently open. Selection is never colour alone: the title
	 * also takes the accent role. */
	selected?: boolean;
	/**
	 * Present when this row is ANOTHER device's conversation (`locality:
	 * "remote"`). The row then paints the device line — "On <device>" — in
	 * place of the folder/model metadata, notes a device the mesh cannot reach,
	 * and carries the remote family id (`remoteSessionRowId`) on that line, so a
	 * mesh cell can assert "the list drew a row from another device" without
	 * the local half satisfying it.
	 */
	remote?: {
		/** The device's display label (`session-projection.remoteDeviceLabel`). */
		device: string;
		/** False when the mesh cannot reach the owner: the row says so, muted —
		 *  a dead mesh is a condition, not an error a session caused. */
		reachable: boolean;
		/** `remoteSessionRowId(id)` — built by the caller, which owns the id. */
		indicatorTestID: string;
	};
	/**
	 * The row's third line: the conversation's tag line (LOH-11 S3).
	 *
	 * A NODE rather than a `TagRef[]`, so the kit stays free of the contract
	 * layer: `ui/components` may not import `@/contracts` (the same rule
	 * `RefusalSurface` states), and the feature that owns tags owns the paint.
	 * The row only gives it the line's position, inside the content column and
	 * after the meta line. Undefined paints nothing — no reserved blank line.
	 */
	tagLine?: ReactNode;
	onPress: () => void;
	/** Keeps the existing pin/open sheet reachable from the conversations pane,
	 *  where a swipe is not a gesture a list under a drawer should own. Optional:
	 *  every other caller presses straight through. */
	onLongPress?: () => void;
	/** Announced after the label when a long press can do something — a gesture
	 *  has no visible affordance, so the fact it exists must be spoken. */
	longPressAccessibilityHint?: string;
	/** The row's tag line in words (`tagAnnouncement(tags)`), folded into the
	 *  row's single label: the line itself is a child node, so without this a
	 *  reader hears the title and never the tags (review round 1, D4/Q2). */
	tagAnnouncement?: string;
	/**
	 * A leading picture (the bound agent's profile picture), or undefined for the
	 * plain reserved slot. A NODE, like `tagLine`, so the kit stays free of the
	 * feature that fetches it.
	 *
	 * With a picture the status indicator is NOT replaced: it is drawn per
	 * `LIST_ROW_STATUS_PLACEMENT` — by default as a badge on the picture's
	 * corner — so running / waiting / unread stay legible on every row. Without
	 * one the row is byte-for-byte today's, the 12×12 slot and all.
	 */
	leading?: ReactNode;
	/**
	 * The width the leading column takes on a PICTURED row of this list, when the
	 * caller knows that some row has one.
	 *
	 * Rule 1 above is "every title starts at the same x forever". A picture is 24 pt
	 * where the reserved slot is 12, so in a mixed list — half the agents pictured,
	 * half not — the pictured rows' titles sat 12 pt right of the plain rows' and the
	 * text column stepped in and out down the list (design review round 1, D4 /
	 * agent review round 1, R2; measured 68.7 pt against 56.0 pt). With this set, a
	 * row WITHOUT a picture pads its indicator slot out to the picture's width, so
	 * one left edge serves the whole list. Undefined — no row in the list has a
	 * picture — leaves the row exactly as it was, and no width is spent.
	 */
	leadingSlotPt?: number;
	/**
	 * The class painting the surface this row is drawn ON — the corner badge's ring.
	 *
	 * WHY THE CALLER NAMES IT. The ring exists to make the badge read as a cutout
	 * over its picture, so it has to be the colour BEHIND the row, and a row is
	 * `bg-transparent` at rest: the fill is the container's. That container is not
	 * the kit's to know, and it differs by placement — the sessions pane sits on the
	 * screen's `bg-canvas` in a split and on the drawer panel's `bg-elevated` inside
	 * the drawer. Hardcoding one of them left the other a 1.05-1.07:1 halo: the ring
	 * painted `bg-elevated` over `bg-canvas` in split view (design review round 2,
	 * agent review round 2 R2-2). Undefined keeps the screen's canvas, which is
	 * where a bare list sits.
	 */
	surfaceClassName?: string;
	testID: string;
};

/**
 * Where a pictured row draws its status: `"corner"` — a badge on the picture's
 * lower-right corner (the agent-profile-picture design's chosen variant) — or
 * `"beside"`, the unchanged 12×12 slot followed by the picture. One constant so
 * the design round can switch the variant without touching the layout.
 */
export type ListRowStatusPlacement = "corner" | "beside";
export const LIST_ROW_STATUS_PLACEMENT = "corner" as ListRowStatusPlacement;

export const ListRow = ({
	title,
	cwd,
	model,
	time,
	subagentCount = 0,
	todoCount = 0,
	askCount = 0,
	askBadgeTestID,
	pending = false,
	attentionWord = "approval",
	streaming = false,
	unread = false,
	ended = false,
	degraded = false,
	selected = false,
	remote,
	onPress,
	onLongPress,
	longPressAccessibilityHint,
	tagAnnouncement,
	tagLine,
	leading,
	leadingSlotPt,
	surfaceClassName = "bg-canvas",
	testID,
}: ListRowProps) => {
	const attention = listRowIndicator({
		ready: true,
		pending,
		streaming,
		unread,
	});

	/* The RENDERED scale, not the preference: on the web the platform's factor
	 *  arrives through the root font size (see `text-scale-provider`), and the meta
	 *  line's character budgets are built from it. */
	const { effectiveScale } = useTextScale();

	/* §2.1's yield order (E2): at large text the count strip is over budget, and
	 *  the counts that yield are the PROGRESS ones — an ask count carries a
	 *  DEADLINE, agents/todos carry progress, so asks are the last to go. The
	 *  progress counts yield only when there is an asks chip to protect, and they
	 *  yield WHOLE: a count is never truncated, because a shorter string produced
	 *  by clipping (`12` from `12 agents`) is still a valid-looking count and so
	 *  reads as the truth. */
	const progressCountsYield = effectiveScale > LARGE_TEXT_SCALE && askCount > 0;

	/* The marks WRAP only at large text (`wrapMarks` at the title row). Wrapping
	 *  exists so no mark is pushed past the pane edge when the title cannot share
	 *  a line (`D13`, measured at 200 %), but at normal text it was pure cost:
	 *  measured at 320 pt / 100 %, the title took the full line and `4 asks`
	 *  dropped to a second, left-aligned line — the row grew 60 -> 85 and the
	 *  count lost its right-hand position (design round 1, `D6`). Below
	 *  `LARGE_TEXT_SCALE` the title yields FIRST instead — it truncates and every
	 *  count keeps the line and the right edge. */
	const wrapMarks = effectiveScale > LARGE_TEXT_SCALE;

	/* The meta line's measured width, which is what the fit below is decided
	 *  against — see `metaLineFor`. 0 until the first layout. */
	const [metaWidth, setMetaWidth] = useState(0);
	const meta = metaLineFor({
		cwd,
		model,
		widthDp: metaWidth,
		scale: effectiveScale,
	});

	/* One word per row, by the precedence `docs/ux/flows.md` § 5 fixes: a decision
	 * outranks everything, then the receipts. The word is never shown for a live
	 * idle session, because there is nothing to say about one. An unreachable
	 * REMOTE row states its own condition where a session cannot: the mesh has
	 * stopped reaching the device, so the row is stale as a whole. */
	const remoteUnreachable = remote !== undefined && !remote.reachable;
	const { word: statusWord, testID: statusTestID } = listRowStatus({
		pending,
		attentionWord,
		remoteUnreachable,
		ended,
		degraded,
	});

	return (
		<Pressable
			accessibilityRole={ROLE.button}
			// One label for the whole row: a row is a single control, and a reader
			// should hear one announcement rather than four fragments.
			accessibilityLabel={rowAccessibilityLabel({
				title,
				attention,
				attentionWord,
				selected,
				ended,
				degraded,
				remoteDevice: remote?.device,
				remoteUnreachable,
				tagAnnouncement,
			})}
			accessibilityState={state({ selected })}
			accessibilityHint={longPressAccessibilityHint}
			testID={testID}
			onPress={onPress}
			onLongPress={onLongPress}
		>
			{({ pressed }) => (
				<View className={listRowClasses({ selected, pressed })}>
					{leading === undefined ? (
						leadingSlotPt === undefined ? (
							<Indicator attention={attention} />
						) : (
							/* The reserved slot, padded out to the picture's own width so this
							 *  row's title starts where a pictured row's does. The dot keeps its
							 *  left edge; what grows is the empty space after it. */
							<View
								className="justify-center"
								style={{ width: leadingSlotPt, height: leadingSlotPt }}
							>
								<Indicator attention={attention} />
							</View>
						)
					) : LIST_ROW_STATUS_PLACEMENT === "beside" ? (
						<>
							<Indicator attention={attention} />
							{leading}
						</>
					) : (
						<LeadingWithBadge
							attention={attention}
							/* The ring is the surface this ROW sits on, so the badge reads as a
							 *  cutout over any photo: the caller's surface (`surfaceClassName` — the
							 *  screen's canvas in a split, the drawer panel's in the drawer), and the
							 *  row's own tint while it is selected or pressed. */
							ringClassName={
								selected
									? "bg-row-selected"
									: pressed
										? "bg-row-hover"
										: surfaceClassName
							}
						>
							{leading}
						</LeadingWithBadge>
					)}
					<View className="flex-1 gap-0.5">
						{/* `flex-wrap` — but only at large text (`wrapMarks`): at 200 % on a
						 *  320 pt phone the title plus its marks do not fit one line, and a
						 *  row that cannot wrap pushes a mark past the viewport edge — the
						 *  horizontal overflow the audit measures. Wrapping keeps every mark
						 *  readable and lets the title keep its own line. At normal text the
						 *  wrap was the wrong trade (D6): the title truncates instead and the
						 *  counts keep the line.
						 *
						 *  It only works because the title's box has a basis of `auto` (`TITLE_BOX`)
						 *  and NOT `flex-1`: a `flex: 1 1 0%` item has a hypothetical width of
						 *  zero, so it never forces the line to break and merely shrinks to what the
						 *  marks leave. Measured at 320 pt with the platform text size at 200 %: a
						 *  session title had a 27 pt client box against 344 pt of text (design round 2,
						 *  D13, frame `dark320-200-faithful`). The same zero-basis trap the segmented
						 *  track hit in the audit round. */}
						<View
							className={cx(
								"flex-row items-center gap-2",
								wrapMarks && "flex-wrap",
							)}
						>
							{/* The title yields first: `flex-1` + truncate, with every
							 * count beside it `shrink-0`. The shimmer wraps the Text rather
							 * than the slot, because "working" belongs on the name
							 * (docs/design/components.md § 7) — the spinner in the slot is
							 * the second channel, not the first. */}
							<Shimmer active={streaming} style={TITLE_BOX}>
								<Text
									className={`text-body-sm font-medium ${
										selected
											? // Selection's non-colour channel, plus the fill.
												"text-accent-active dark:text-accent-hover"
											: ended || degraded
												? "text-ink-muted"
												: "text-ink"
									}`}
									numberOfLines={1}
									ellipsizeMode="tail"
								>
									{title}
								</Text>
							</Shimmer>
							{/* One word slot. `approval`/`question` are danger; the two
							 * receipts are muted, because neither is an error. */}
							{statusWord ? (
								<Text
									testID={statusTestID}
									className={`shrink-0 text-meta ${
										pending ? "text-danger" : "text-ink-dim"
									}`}
								>
									{statusWord}
								</Text>
							) : null}
							{unread ? (
								<Text className="shrink-0 text-meta text-accent">new</Text>
							) : null}
							{/* The asks count comes FIRST in the count strip (design E2 §2.1): a
							 *  deadline outranks a progress count, so when the strip is under
							 *  pressure it is the agents/todos counts that yield, never this one —
							 *  and no count is ever truncated (a dropped count is ABSENT; a
							 *  truncated one is a valid-looking lie).
							 *
							 *  THE UNIT IS THE FIELD'S OWN: `asks_open` counts ASKS (open plus
							 *  timed-out-and-answerable), so the chip says "asks" while the bar
							 *  above a composer counts questions. The accessible name uses this
							 *  surface's word for the set — "not a blocker" — because a queued ask
							 *  is not a "waiting for you" state: the agent keeps working
							 *  (design §5's header rule), and a reader who heard "waiting" beside a
							 *  danger approval would rightly conclude the run was held. */}
							{askCount > 0 ? (
								<Text
									className="shrink-0 text-mono-sm text-ink-dim"
									testID={askBadgeTestID}
									accessibilityLabel={`${countLabel(askCount, "ask")}, not a blocker`}
								>
									{countLabel(askCount, "ask")}
								</Text>
							) : null}
							{subagentCount > 0 && !progressCountsYield ? (
								<Text className="shrink-0 text-mono-sm text-ink-dim">
									{countLabel(subagentCount, "agent")}
								</Text>
							) : null}
							{todoCount > 0 && !progressCountsYield ? (
								<Text className="shrink-0 text-mono-sm text-ink-dim">
									{countLabel(todoCount, "todo")}
								</Text>
							) : null}
							{time !== undefined && time !== "" ? (
								<Text
									className="ms-auto shrink-0 text-meta text-ink-dim"
									// The row's accessible name already carries the state; the time is
									// part of the title line's scan and needs no announcement of its own
									// (the visible string is what a reader needs).
								>
									{time}
								</Text>
							) : null}
						</View>
						{/* The metadata line never wraps, and it is the CONTAINER that had to change:
						 *  both children already declare a single line (`numberOfLines={1}`), so
						 *  `flex-wrap` was the only thing contradicting them. A wrapped item moves
						 *  onto its own line and the row grows a line exactly where the list has the
						 *  least room: at 320 pt with the platform text at 200 % a stacked meta row
						 *  measured 77.6 pt inside a 182.98 pt row, against 34.8 pt and 97.39 pt for a
						 *  single-line one, and the second row of the list ended 18 pt below the band
						 *  (QA round 4, Q4-1).
						 *
						 *  **One field yields, and it is never the working directory.** The model loses
						 *  its provider prefix first and then its name-end; the path keeps its HEAD
						 *  (R-3, 2026-10-03: on a rendered frame the title kept its head while the
						 *  path kept its tail — TWO directions in one row, and the head of a path
						 *  is the part a reader scans). Prose and paths elide the tail; only the
						 *  model, an identifier rather than prose, keeps its name-end (D26's
						 *  reasoning about `anthropic/` is unaffected). Giving each field a
						 *  proportional share of the line (what two shrunken `flex: auto` items do)
						 *  can produce two fragments and no names — measured at 320 pt / 200 % as
						 *  `~/…` beside `no…`, and in a split column at 100 % as a 26.02 pt model
						 *  box beside a 236.98 pt path (design round 5, D26). The cwd is the field
						 *  a reader scans for, so it holds a FLOOR and the model is the one that
						 *  yields — see `META_PATH_BOX` and `metaLineFor`.
						 *
						 *  Which characters are painted is decided as a STRING in `metaLineFor`, not by
						 *  `ellipsizeMode`: react-native-web ignores that prop, so the web build — the
						 *  build every capture and design round looks at — was eliding both fields from
						 *  the tail, which is the one direction D26 rules out for the model and R-3
						 *  rules out for the path. The prop stays as the mop-up, and on iOS/Android
						 *  each is the direction its string already has (path `tail`, model `head`).
						 *
						 *  The title's row above keeps its own wrap on purpose (design round 2, D13),
						 *  because there the marks are unshrinkable and a mark pushed past the pane edge
						 *  is worse than a second line. */}
						{remote !== undefined ? (
							/* A remote row's device line, in place of the folder/model meta:
							 * another device's conversation carries no cwd or model on this wire,
							 * and the device is what the reader needs to know. Plain prose, not
							 * the mono meta style — a device name is a name, not a path. The id
							 * is the remote family's, so a marker can tell a mesh row from the
							 * local rows that share this list. */
							<Text
								testID={remote.indicatorTestID}
								className="text-body-sm text-ink-dim"
								numberOfLines={1}
								ellipsizeMode="tail"
							>
								On {remote.device}
							</Text>
						) : meta.cwd || meta.model ? (
							<View
								className="flex-row items-center gap-2"
								onLayout={(event) => {
									/* The line's own width, so the fit is decided from the space the layout
									 *  actually gave the row rather than from a second derivation of the
									 *  screen's padding, pane width and readable measure. Reported in dp. */
									const { width } = event.nativeEvent.layout;
									if (width !== metaWidth) setMetaWidth(width);
								}}
							>
								{meta.cwd ? (
									<Text
										style={META_PATH_BOX(effectiveScale)}
										className="text-mono-sm text-ink-dim"
										numberOfLines={1}
										// The path keeps its head (R-3), so the mop-up ellipsis is `tail`: it is the
										// direction the painted string already has, and the end that can be spared if
										// the arithmetic ever under-counts.
										ellipsizeMode="tail"
									>
										{meta.cwd}
									</Text>
								) : (
									<View className="flex-1" />
								)}
								{meta.model ? (
									<Text
										style={META_VALUE_BOX}
										className="text-mono-sm text-ink-dim"
										numberOfLines={1}
										ellipsizeMode="head"
									>
										{meta.model}
									</Text>
								) : null}
							</View>
						) : null}
						{tagLine}
					</View>
				</View>
			)}
		</Pressable>
	);
};

/**
 * The title's flex box: basis `auto`, grow to fill the line, shrink under pressure.
 *
 * `flexBasis: "auto"` rather than `flex-1` is the entire point — see the note at the
 * title's call site. Passed as a STYLE rather than a class because the class pipeline
 * is where this went wrong once already (the connection pill measured 554 pt in a 320 pt
 * viewport while `max-w-full` sat in its class list), and a layout fix that silently does
 * nothing is worse than no fix.
 *
 * `minWidth: 0` so react-native-web will shrink the box below the text's intrinsic width
 * when it DOES share a line with a mark; without it the browser's `min-width: auto` would
 * push the mark off the row instead of wrapping it.
 */
const TITLE_BOX = {
	flexBasis: "auto",
	flexGrow: 1,
	flexShrink: 1,
	minWidth: 0,
} as const;

/**
 * The working directory's box: the cwd takes the remainder, and it never gives up
 * a dp of the floor it is guaranteed (design round 5, D26).
 *
 * The floor itself lives in `list-row-meta.ts` as `metaPathFloorDp`, because the
 * string painted into this box is fitted to exactly the same number: a floor
 * defined twice is how a painted string and its box drift apart.
 *
 * **What it costs, measured.** On a 320 pt phone at 100 % the line is 232 dp, so
 * the model's room is 232 - 8 (gap) - 72 = 152 dp: enough for 21 characters of
 * `text-mono-sm`, which is not enough for the 23-character
 * `anthropic/claude-opus-5`. It paints `…claude-opus-5` instead — the provider
 * prefix, the part every row of that provider shares, is what yields — and the
 * cwd keeps 123 dp of the line. Every wider case fits both whole: 390 pt at
 * 100 % leaves the model 238 dp and a split pane 207 dp.
 *
 * It is the BASIS this box is built from, not a `minWidth`, because of how
 * flexbox distributes a deficit: `flex-shrink` is weighted by the base size, so
 * a floor expressed as the basis with `flexShrink: 0` makes the cwd the one item
 * that does NOT pay for a shortfall. The model pays all of it, which is the
 * priority the design round asked for — and `flexGrow: 1` gives the cwd every
 * spare dp when there is no shortfall at all, so the model stays flush right.
 */
const META_PATH_BOX = (scale: number) => ({
	flexBasis: metaPathFloorDp(scale),
	flexGrow: 1,
	flexShrink: 0,
	minWidth: 0,
});

/**
 * The second line's trailing value (the model label): the item that YIELDS.
 *
 *  A model id is one unbreakable word to the browser (`anthropic/claude-opus-5`
 *  has no break opportunity in it), so with the default `min-width: auto` its own
 *  min-content width became the flex line's minimum and pushed the row past the
 *  pane — the 12 pt of horizontal overflow measured inside the list scroller at
 *  320 pt with the platform text at 200 % (design round 3, D18; the same class as
 *  the TITLE_BOX note above). `minWidth: 0` lets it take the whole shortfall,
 *  which — with the cwd at `flexShrink: 0` — is what makes it the field that
 *  yields rather than the two of them splitting the loss proportionally. */
const META_VALUE_BOX = { flexGrow: 0, flexShrink: 1, minWidth: 0 } as const;

/**
 * The picture with the status indicator as a corner badge.
 *
 * The badge is the SAME `Indicator` the plain row draws (same ladder, same
 * pulse, same reduced-motion rule), seated on a `surface`-filled disc so the dot
 * keeps its contrast over any photo, and offset past the picture's edge so it
 * never covers the face. Nothing is drawn for `none`: an idle row has no state
 * to report, exactly as the plain slot paints nothing.
 *
 * THE GEOMETRY, and why each number is where it is (design review round 1 D2/D5,
 * agent review round 1 R3 — all three measured on rendered frames):
 *
 *  - The disc is 12 pt. At 14 pt it covered 34 % of a 24 pt picture, mostly the
 *    lower-right quadrant — the cheek and chin of a real portrait.
 *  - It carries a 2 pt ring in the surface the ROW sits on, not `surface`. The
 *    disc against the row measures 1.07:1 (light) / 1.08:1 (dark), so on its own
 *    it is never a shape — only the arc or dot inside it is — and against a photo
 *    of the disc's own tone the badge disappears and the spinner becomes a lone
 *    arc on the face. The ring is the row's own backdrop (`elevated`, the
 *    conversations surface; `row-selected` / `row-hover` when the row tints), so
 *    it reads as a cutout whatever the picture is.
 *  - The marks are sized to the disc instead of scaled into it: see `Indicator`.
 *  - The badge sits on the picture's END corner, not its physical right. The
 *    row's leading slot is row order (`flex-row`, see the caller), so the picture
 *    is at the START edge: in English that is the row's left, with the badge on
 *    the inner corner facing the text, and in Urdu the picture is at the row's
 *    right, where a physical `right` would have thrown the badge onto the
 *    screen-edge corner instead. `end` is read by Yoga from the root
 *    `DirectionView`'s `direction` and by react-native-web from its `dir` prop,
 *    and the physical-edge scan cannot see this value (it is a computed
 *    expression), so the comment is the guard here.
 */
const BADGE_DISC_PT = 12;
const BADGE_RING_PT = 2;
/** Past the picture's edge, so the badge clears the face. Measured from the DISC,
 *  so the ring is added on top of it and the disc's own offset is unchanged. */
const BADGE_INSET_PT = 3;
/** The streaming mark's painted diameter inside the disc: the disc less 2 pt of
 *  bezel on each side, so the ring never touches the rim. */
const BADGE_SPINNER_PT = 8;
/**
 * How dim the badge's danger dot is allowed to get at the bottom of its pulse.
 *
 * The kit's pulse fades to 0.35. On the badge's `surface` disc in the light theme
 * that measures 2.05:1 (the dim frame `216,160,153` on `247,245,238`), and 1.73:1
 * at the floor — under 3:1 for the half of the cycle the dot spends dimming, on
 * the one status where not seeing it has a consequence (design review round 1,
 * D3). Full opacity is 5.43:1 light / 5.24:1 dark, so a floor of 0.75 keeps the
 * motion and the same reserved channel while the worst frame stays above 3:1
 * (3.49:1 light, 3.83:1 dark, computed from the token values). The plain row's dot
 * keeps the kit's 0.35 — it is a 6 pt dot on a row, not a badge over a photo, and
 * that ladder is not this change's to move.
 */
const BADGE_PULSE_FLOOR = 0.75;

const LeadingWithBadge = ({
	attention,
	children,
	ringClassName,
}: {
	attention: ReturnType<typeof listRowIndicator>;
	children: ReactNode;
	/** The class painting the surface behind this row — the ring's colour. */
	ringClassName: string;
}) => (
	<View>
		{children}
		{attention === "none" ? null : (
			<View
				className={`absolute items-center justify-center rounded-full ${ringClassName}`}
				style={{
					end: -(BADGE_INSET_PT + BADGE_RING_PT),
					bottom: -(BADGE_INSET_PT + BADGE_RING_PT),
					width: BADGE_DISC_PT + BADGE_RING_PT * 2,
					height: BADGE_DISC_PT + BADGE_RING_PT * 2,
				}}
			>
				<View
					className="items-center justify-center rounded-full bg-surface"
					style={{ width: BADGE_DISC_PT, height: BADGE_DISC_PT }}
				>
					<Indicator
						attention={attention}
						spinnerPt={BADGE_SPINNER_PT}
						pulseFloor={BADGE_PULSE_FLOOR}
					/>
				</View>
			</View>
		)}
	</View>
);

/** `ActivityIndicator size="small"`'s own layout box on iOS and web (RNW's
 *  `styles.small`), which is what an iOS paint scale has to divide by. */
const SPINNER_INTRINSIC_PT = 20;

/** The streaming mark: the platform's own `size="small"`, or a diameter the caller
 *  names — see `Indicator`'s `spinnerPt` for why the platforms differ. */
const Spinner = ({ pt, color }: { pt?: number; color: string }) => {
	if (pt === undefined) return <ActivityIndicator size="small" color={color} />;
	/* iOS's view manager takes the small/large enum and lays the wheel out at its
	 *  intrinsic 20 pt, so a numeric `size` never reaches it: the paint is what has
	 *  to scale there. */
	if (Platform.OS === "ios")
		return (
			<View style={{ transform: [{ scale: pt / SPINNER_INTRINSIC_PT }] }}>
				<ActivityIndicator size="small" color={color} />
			</View>
		);
	return <ActivityIndicator size={pt} color={color} />;
};

/** The reserved slot. Same 12×12 box in every state. */
const Indicator = ({
	attention,
	spinnerPt,
	pulseFloor = 0.35,
}: {
	attention: ReturnType<typeof listRowIndicator>;
	/**
	 * The spinner's painted diameter, when the caller needs it smaller than the
	 * platform's own. ActivityIndicator paints at its `size` — 20 pt at "small" —
	 * and a transform only scales the paint, leaving a 20 pt layout box inside a
	 * 12 pt one; that is how the badge's ring came to sit on the disc's rim with
	 * 0.8 pt of bezel and read as a cut arc (agent review round 1, R3: measured
	 * 12.0 pt of ring inside a 13.7 pt disc). Web and Android take a numeric size,
	 * so they get the mark at its real size; iOS's view manager only has the
	 * small/large enum and lays the wheel out at its intrinsic 20 pt, so there the
	 * paint is scaled to the same diameter — no layout overflow on either. */
	spinnerPt?: number;
	/** The dim end of the danger pulse. 0.35 is the kit's; the badge raises it so
	 *  its dot never drops under 3:1 on the badge's own surface (see
	 *  `BADGE_PULSE_FLOOR`). */
	pulseFloor?: number;
}) => {
	const danger = useTokenColor("danger");
	const accent = useTokenColor("accent");
	const reduceMotion = useReducedMotion();
	const pulse = useRef(new Animated.Value(1)).current;

	useEffect(() => {
		// The danger pulse is the only motion in the system reserved for danger.
		// Under reduced motion it stops and the static dot plus the word remain,
		// which is the channel that carried the meaning anyway.
		if (attention !== "pending" || reduceMotion) {
			pulse.setValue(1);
			return;
		}
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: pulseFloor,
					duration: 600,
					useNativeDriver: true,
				}),
				Animated.timing(pulse, {
					toValue: 1,
					duration: 600,
					useNativeDriver: true,
				}),
			]),
		);
		loop.start();
		return () => loop.stop();
	}, [attention, pulse, pulseFloor, reduceMotion]);

	return (
		<View className={LIST_ROW_INDICATOR_CLASS}>
			{attention === "pending" ? (
				<Animated.View
					className="h-1.5 w-1.5 rounded-full"
					style={{ backgroundColor: danger, opacity: pulse }}
				/>
			) : attention === "streaming" ? (
				<Spinner pt={spinnerPt} color={accent} />
			) : attention === "unread" ? (
				<View
					className="h-1.5 w-1.5 rounded-full"
					style={{ backgroundColor: accent }}
				/>
			) : null}
		</View>
	);
};
