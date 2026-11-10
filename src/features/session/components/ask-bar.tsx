import type { Ref } from "react";
import { Pressable, Text, View } from "react-native";

import type { PendingAsk } from "@/contracts";
import {
	askBarLabel,
	dockAsk,
	questionsCountLabel,
	questionTally,
} from "@/features/session/asks";
import { SURFACE } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * The ask bar — the MINIMIZED half of the two-state model (design §5.0, R7).
 *
 * ONE LINE, DIRECTLY ABOVE THE COMPOSER, and it is a QUIET ROW: no border, no
 * card — the accent glyph and chevron mark it, the activity line's `px-2`
 * edge aligns it, and only a press paints a wash. It used to be a full-width
 * bordered card, which the operator called ugly between the activity line and
 * the composer (TestFlight build 753); the relay's ask dock is borderless too.
 * It is not a banner, a toast or a modal, and its accent is a PERSISTENT colour
 * on the glyph, never animated: a pulse would be the focus steal this design
 * exists to avoid, in colour instead of keys.
 *
 * WHAT IT SAYS. The count is QUESTIONS across this session's outstanding asks —
 * how much is owed on the thing the bar names (the manager of this round fixed
 * the unit: the bar counts questions, the row chip counts asks, and both say
 * which). The preview is the HEAD ask's own question — the OLDEST open ask, or
 * the first still-answerable timeout when nothing is open (`dockAsk`) — never
 * the wire list's first row, because the published list leads with the NEWEST
 * and a bar that jumped to each new arrival would move under a thumb mid-tap.
 *
 * WHAT IT MUST NOT SAY. Never "needs you", never "waiting for you", never danger
 * ink: the agent keeps working while an ask is queued (§5's header rule), so an
 * outstanding ask is not a run held hostage the way an approval is.
 *
 * ABSENT AT ZERO — AND FOR A LAPSED-ONLY QUEUE. The bar renders nothing when
 * no ask is answerable: never rendered empty, never a zero badge, never a
 * "timed out" bar (operator, build 753: "make it so that timed out questions
 * don't show up as a bar"; the desktop shows nothing pending for a session
 * whose asks all timed out). Lapsed asks stay reachable through the composer
 * More sheet's Questions row, which opens the same sheet (Dismiss lives there). The
 * whole chip is the target (the chevron is decoration, not a second control):
 * two hit targets on one line is how a bar becomes a toolbar. The screen wraps
 * it in the pending card's own `px-3 pb-1` slot.
 */
export type AskBarProps = {
	/** The session's queued asks (`SessionProjection.asks`). `undefined` — the
	 *  field absent — renders nothing: absence is the capability proxy. */
	asks: PendingAsk[] | undefined | null;
	/** Expand the asks sheet — the answer surface. */
	onOpen: () => void;
	/** The bar's own handle, so the screen can return focus here when a sheet it
	 *  opened on the reader's behalf closes (an auto-open has no opener for the
	 *  platform to return focus to - UX round 1, U3). */
	barRef?: Ref<View>;
};

export const AskBar = ({ asks, onOpen, barRef }: AskBarProps) => {
	const { effectiveScale } = useTextScale();
	/* WAITING vs LAPSED (local-operator #2388): only an `open` ask is waiting,
	 *  and only a waiting question earns the bar. A `quiet` label is a
	 *  lapsed-only queue, which renders nothing here (see ABSENT above). */
	const bar = askBarLabel(asks);
	if (bar === null || bar.quiet) return null;
	const head = dockAsk(asks);
	/* The accessible name keeps the full sentence ("1 question waiting"); the
	 *  visible count is the short form so the question gets the width. */
	const label = bar.text;
	const count = questionsCountLabel(questionTally(asks).waiting);
	const preview = String(head?.questions?.[0]?.question ?? "").trim();
	/* At large text the preview would collapse to a fragment — measured at
	 *  200 %: `· C…` beside the count. A one-character stub is not a name, so
	 *  it is dropped WHOLE (the count and the chevron stay; design D5). */
	const showPreview = preview.length > 0 && effectiveScale <= LARGE_TEXT_SCALE;

	return (
		<Pressable
			ref={barRef}
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityHint="Show the questions"
			testID={SURFACE.askBar}
			onPress={onOpen}
			className="justify-center"
			/* The floor is REAL geometry, never `hitSlop`: `react-native-web`
			 *  drops `Pressable` hitSlop, and the audit measures the box. No fixed
			 *  height — at 200 % text the bar must grow (≈ 53 pt), not clip. */
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{/* Borderless at rest; the wash is the press feedback only. `px-2`
			    puts the glyph on the activity line's leading edge. */}
			{({ pressed }) => (
				<View
					className={`flex-row items-center gap-2 rounded-md px-2 py-1.5 ${pressed ? "bg-accent-wash" : ""}`}
				>
					<Text
						aria-hidden
						className="shrink-0 font-mono text-body-sm text-accent"
					>
						?
					</Text>
					<Text className="shrink-0 text-body-sm text-ink-muted">{count}</Text>
					{showPreview ? (
						<Text
							className="min-w-0 flex-1 text-body-sm text-ink"
							numberOfLines={1}
							ellipsizeMode="tail"
						>
							· {preview}
						</Text>
					) : (
						<View className="min-w-0 flex-1" />
					)}
					<Text aria-hidden className="shrink-0 text-body-sm text-accent">
						▸
					</Text>
				</View>
			)}
		</Pressable>
	);
};
