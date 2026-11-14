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
 * IDLE AND LOADING ARE THE SAME HEIGHT, and that is load-bearing: a row that
 * changed height as a page started would move every row below it, and on the
 * relay that very shift re-armed the top trigger (23 of 27 transitions in one
 * open were a 1 px oscillation; 13 pages pulled unseen).
 *
 * THE BOX IS THE TOUCH FLOOR IN EVERY STATE, as real geometry. An earlier cut
 * kept a 24 pt box and reached the floor through `hitSlop`; react-native-web
 * implements no `hitSlop` on `Pressable`, so the DOM button stayed 64x24 and
 * the web audit's U-01 floor FAILed on S5 Session in every state, theme and
 * scale (run 43489920862, 218 rows). The hairline, the small spinner and the
 * "Try again" words keep their own sizes and sit centred in the taller box, so
 * the only visual change is padding above and below. One `minHeight` shared by
 * all three states also keeps idle and loading the same height (both contents
 * are well under the floor), which is the invariant above.
 */
/** The edge's box: always at least the touch floor tall, in every state. */
export const OLDER_EDGE_BOX_STYLE = { minHeight: TOUCH_FLOOR } as const;

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
				/* 64 pt wide at rest: wider than the floor, still a short centred
				 *  mark rather than a full-width bar. */
				visibleRetry ? "px-3" : "w-16",
			)}
			/* When the first window does not fill the screen, auto-load cannot
			 *  fire and the idle hairline is the only way in (agent review round 1,
			 *  M2), so its BOX — not a slop the web build drops — meets the floor. */
			style={OLDER_EDGE_BOX_STYLE}
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
