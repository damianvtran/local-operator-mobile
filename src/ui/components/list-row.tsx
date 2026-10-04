import { useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Animated,
	Pressable,
	Text,
	View,
} from "react-native";

import { countLabel } from "@/lib/format";
import { ROLE, state } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { metaLineFor, metaPathFloorDp } from "@/ui/components/list-row-meta";
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
 *   1. **One reserved 12×12 indicator slot for every state**, so every title starts
 *      at the same x forever. Indicators change colour, never geometry.
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
	onPress: () => void;
	testID: string;
};

export const ListRow = ({
	title,
	cwd,
	model,
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
	onPress,
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
	 * idle session, because there is nothing to say about one. */
	const statusWord = pending
		? attentionWord
		: ended
			? "ended"
			: degraded
				? "not answering"
				: null;

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
			})}
			accessibilityState={state({ selected })}
			testID={testID}
			onPress={onPress}
		>
			{({ pressed }) => (
				<View className={listRowClasses({ selected, pressed })}>
					<Indicator attention={attention} />
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
						 *  **One field yields, and it is never the working directory.** Both halves keep
						 *  their TAIL, so what survives is the part that names the thing: the tail of a
						 *  path, and the model's own name rather than the `anthropic/` every row of that
						 *  provider shares. Giving each field a proportional share of the line (what two
						 *  shrunken `flex: auto` items do) can produce two fragments and no names —
						 *  measured at 320 pt / 200 % as `~/…` beside `no…`, and in a split column at
						 *  100 % as a 26.02 pt model box beside a 236.98 pt path (design round 5, D26).
						 *  The cwd is the field a reader scans for, so it holds a FLOOR and the model is
						 *  the one that yields — see `META_PATH_BOX` and `metaLineFor`.
						 *
						 *  Which characters are painted is decided as a STRING in `metaLineFor`, not by
						 *  `ellipsizeMode`: react-native-web ignores that prop, so the web build — the
						 *  build every capture and design round looks at — was eliding both fields from
						 *  the tail, which is the one direction D26 rules out. The prop stays as the
						 *  mop-up, and on iOS/Android it is the direction the string already has.
						 *
						 *  The title's row above keeps its own wrap on purpose (design round 2, D13),
						 *  because there the marks are unshrinkable and a mark pushed past the pane edge
						 *  is worse than a second line. */}
						{meta.cwd || meta.model ? (
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
										ellipsizeMode="head"
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

/** The reserved slot. Same 12×12 box in every state. */
const Indicator = ({
	attention,
}: {
	attention: ReturnType<typeof listRowIndicator>;
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
					toValue: 0.35,
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
	}, [attention, pulse, reduceMotion]);

	return (
		<View className={LIST_ROW_INDICATOR_CLASS}>
			{attention === "pending" ? (
				<Animated.View
					className="h-1.5 w-1.5 rounded-full"
					style={{ backgroundColor: danger, opacity: pulse }}
				/>
			) : attention === "streaming" ? (
				<ActivityIndicator size="small" color={accent} />
			) : attention === "unread" ? (
				<View
					className="h-1.5 w-1.5 rounded-full"
					style={{ backgroundColor: accent }}
				/>
			) : null}
		</View>
	);
};

/** What a screen reader hears. Selection and attention are both stated, because
 * neither is carried by colour in this row's audio channel. */
const rowAccessibilityLabel = (options: {
	title: string;
	attention: ReturnType<typeof listRowIndicator>;
	attentionWord: "approval" | "question";
	selected: boolean;
	ended?: boolean;
	degraded?: boolean;
}): string => {
	const parts = [options.title];
	if (options.attention === "pending") {
		parts.push(`${options.attentionWord} waiting`);
	} else if (options.attention === "streaming") {
		parts.push("working");
	} else if (options.attention === "unread") {
		parts.push("new");
	}
	/* Read in the same voice as the visible word: a reader who cannot see the muted
	 * receipt still hears that this session ended or stopped answering. */
	if (options.ended) parts.push("ended");
	else if (options.degraded) parts.push("not answering");
	if (options.selected) parts.push("open");
	return parts.join(", ");
};
