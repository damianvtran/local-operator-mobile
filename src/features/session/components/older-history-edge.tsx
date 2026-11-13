import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { t } from "@/i18n";
import { ROLE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

/**
 * The transcript's OLDER edge control: what sits above the first row while
 * there is more history to page in.
 *
 * WHY THIS REPLACED A BUTTON (operator, 2026-11-13: "improve the style of the
 * load messages interaction, it looks really rough/amateur" — a full-width
 * outlined "Load earlier messages" button pinned at the top of the transcript).
 * Older pages load AUTOMATICALLY as the reader scrolls up into the top band
 * (`historyTopReached`, `HISTORY_NEAR_TOP_PT`), as on the relay and the desktop,
 * so a sighted reader needs no control at all; what is left is the relay's
 * quiet edge (`transcript.tsx`, "History loads automatically as the user
 * scrolls up — no button"):
 *
 *   - idle: a short hairline, the "more above" mark;
 *   - loading: a small inline spinner, in dim ink;
 *   - failed: the one case a sighted reader must ACT, so a small quiet
 *     "Try again" text control on the touch floor — no border, no fill, the
 *     transcript's own quiet-row register (the failure sentence above it is the
 *     caller's, unchanged).
 *
 * ONE CONTROL ACROSS ALL THREE, never unmounted between them and never natively
 * `disabled` (PR #207 U1: a native `disabled` blurs the focused control, so
 * keyboard and screen-reader readers lost their place on every page). It is a
 * real button for assistive tech in every state — named "Load earlier
 * messages" / "Loading earlier messages…" / "Try again", `busy` while a page is
 * out — so a reader who does not scroll by offset still has the action. Presses
 * while loading are ignored by the same guard `Button` uses.
 *
 * IDLE AND LOADING ARE THE SAME HEIGHT (24 pt), and that is load-bearing: a row
 * that changed height as a page started would move every row below it, and on
 * the relay that very shift re-armed the top trigger (23 of 27 transitions in
 * one open were a 1 px oscillation; 13 pages pulled unseen).
 */
/** (TOUCH_FLOOR - the idle box's 24 pt) / 2, above and below. */
export const IDLE_EDGE_HIT_SLOP = {
	top: (TOUCH_FLOOR - 24) / 2,
	bottom: (TOUCH_FLOOR - 24) / 2,
} as const;

export const OlderHistoryEdge = ({
	loading,
	retry,
	onPress,
	testID,
}: {
	loading: boolean;
	/** The last older read failed: show the visible retry. */
	retry: boolean;
	onPress: () => void;
	testID: string;
}) => {
	const dim = useTokenColor("ink-dim");
	const label = t(
		loading
			? "mobile.session.history.loading"
			: retry
				? "mobile.common.try_again"
				: "mobile.session.history.load",
	);
	const visibleRetry = retry && !loading;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={label}
			accessibilityState={state({ busy: loading })}
			onPress={() => {
				if (loading) return;
				onPress();
			}}
			testID={testID}
			className={cx(
				"flex-row items-center justify-center self-center",
				visibleRetry ? "px-3" : "h-6 w-16",
			)}
			style={visibleRetry ? { minHeight: TOUCH_FLOOR } : undefined}
			/* The idle hairline's box is 24 pt tall; when the first window does
			 *  not fill the screen, auto-load cannot fire and this is the only way
			 *  in, so its TOUCH area reaches the floor without moving the layout
			 *  (agent review round 1, M2). */
			hitSlop={visibleRetry ? undefined : IDLE_EDGE_HIT_SLOP}
		>
			{loading ? (
				<ActivityIndicator size="small" color={dim} />
			) : visibleRetry ? (
				<Text className="text-meta text-ink-muted">{label}</Text>
			) : (
				<View className="h-px w-10 bg-hairline" aria-hidden />
			)}
		</Pressable>
	);
};
