import { useEffect, useRef } from "react";
import {
	ActivityIndicator,
	Animated,
	Pressable,
	Text,
	View,
} from "react-native";

import { countLabel } from "@/lib/format";
import { CONTROL, ROLE, state } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { Shimmer } from "@/ui/components/shimmer";
import {
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
	/** Optional: the control's own identifier is the fallback, so a screen
	 *  that does not name a control is still addressable. */
	testID?: string;
};

export const ListRow = ({
	title,
	cwd,
	model,
	subagentCount = 0,
	todoCount = 0,
	pending = false,
	attentionWord = "approval",
	streaming = false,
	unread = false,
	ended = false,
	degraded = false,
	selected = false,
	onPress,
	testID = CONTROL.listRow,
}: ListRowProps) => {
	const attention = listRowIndicator({
		ready: true,
		pending,
		streaming,
		unread,
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
						{/* `flex-wrap`, not a wider row: at 200 % text on a 320 pt phone the
						 *  title plus its marks do not fit one line, and a row that cannot
						 *  wrap pushes a mark past the viewport edge — the horizontal
						 *  overflow the audit measures. Wrapping keeps every mark readable
						 *  and lets the title keep its own line. */}
						<View className="flex-row flex-wrap items-center gap-2">
							{/* The title yields first: `flex-1` + truncate, with every
							 * count beside it `shrink-0`. The shimmer wraps the Text rather
							 * than the slot, because "working" belongs on the name
							 * (docs/design/components.md § 7) — the spinner in the slot is
							 * the second channel, not the first. */}
							<Shimmer active={streaming} className="flex-1">
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
							{subagentCount > 0 ? (
								<Text className="shrink-0 text-mono-sm text-ink-dim">
									{countLabel(subagentCount, "agent")}
								</Text>
							) : null}
							{todoCount > 0 ? (
								<Text className="shrink-0 text-mono-sm text-ink-dim">
									{countLabel(todoCount, "todo")}
								</Text>
							) : null}
						</View>
						{cwd || model ? (
							<View className="flex-row flex-wrap items-center gap-2">
								{cwd ? (
									<Text
										className="flex-1 text-mono-sm text-ink-dim"
										numberOfLines={1}
										ellipsizeMode="head"
									>
										{cwd}
									</Text>
								) : (
									<View className="flex-1" />
								)}
								{model ? (
									<Text
										className="text-mono-sm text-ink-dim"
										numberOfLines={1}
										ellipsizeMode="tail"
									>
										{model}
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
