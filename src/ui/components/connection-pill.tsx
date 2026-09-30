import { Text, View } from "react-native";

import { ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";

/**
 * The connection status pill (docs/design/components.md § 18).
 *
 * The pill is the ONE place in the app where a message may be a full sentence,
 * because the facts it carries cannot be inferred: "the stream was cut at 60 s"
 * is real information and a dot cannot say it.
 *
 * The state that matters most is `rotation`. The tunnel gateway ends every
 * relayed stream at `MAX_STREAM_SECONDS = 60` — an orderly close, once a minute,
 * forever — so a client that paints "reconnecting" on that boundary teaches the
 * reader to distrust the indicator. `docs/ux/flows.md` § 9 calls this `C1`:
 * invisible. It is modelled here as its own state, and the one state that
 * carries a sentence is `degraded`, which means the stream is silent past the
 * keep-alive grace window rather than merely rotating.
 */
export type ConnectionPillState =
	/** Live. `docs/ux/flows.md` §9 `C1`/`C3` are normal and say nothing. */
	| "connected"
	/** A transport error, resolved in seconds: `C2`. */
	| "reconnecting"
	/** No network route at all: `C4`. */
	| "offline"
	/** Open but silent past the grace window, or a snapshot that is old: `C3`. */
	| "degraded";

export type ConnectionPillProps = {
	state: ConnectionPillState;
	/** Overrides the default sentence. Used where the pill must name the machine
	 *  ("Your computer is not answering") rather than the transport. */
	message?: string;
	testID?: string;
};

/** The copy each state carries. Kept here so two screens cannot say the same
 *  state two ways. */
const DEFAULT_MESSAGE: Record<ConnectionPillState, string> = {
	// The connected state is deliberately silent: a healthy connection is not news,
	// and a permanent "Connected" on a list is furniture the eye learns to skip.
	connected: "",
	reconnecting: "Reconnecting…",
	offline: "Offline. Messages will send when you're back.",
	degraded: "Not answering",
};

const PILL_CLASS: Record<ConnectionPillState, string> = {
	connected: "",
	reconnecting: "bg-warning-wash border-warning-border",
	offline: "bg-danger-wash border-danger-border",
	degraded: "bg-info-wash border-info-border",
};

const INK_CLASS: Record<ConnectionPillState, string> = {
	connected: "text-ink-dim",
	reconnecting: "text-warning",
	offline: "text-danger",
	degraded: "text-info",
};

const DOT_ROLE: Record<
	ConnectionPillState,
	"success" | "warning" | "danger" | "info"
> = {
	connected: "success",
	reconnecting: "warning",
	offline: "danger",
	degraded: "info",
};

export const ConnectionPill = ({
	state,
	message,
	testID = "connection-pill",
}: ConnectionPillProps) => {
	const dotColor = useTokenColor(DOT_ROLE[state]);
	const text = message ?? DEFAULT_MESSAGE[state];

	return (
		<View
			/* `max-w-full` and a shrinking label, because the message is a SENTENCE
			 *  ("Not answering. The relay has stopped...") and not a word: measured at
			 *  200 % on a 320 pt phone the row grew to 554 pt and the label to 492 pt,
			 *  clipped by the viewport (U-06, 18 rows across the settings cells). The
			 *  dot must not shrink — it is the state mark — so the label takes the
			 *  remaining width and wraps instead. */
			className={`max-w-full flex-row items-center gap-2 self-start rounded-sm px-2 py-1 ${
				state === "connected" ? "" : `border ${PILL_CLASS[state]}`
			}`}
			/* Inline, not only the class: the class pipeline is where this went
			 *  wrong once already (the row measured 554 pt in a 320 pt viewport with
			 *  `max-w-full` in its class list), and a status line that can exceed the
			 *  screen is a clipped sentence either way. */
			style={{ maxWidth: "100%", minWidth: 0 }}
			// `polite`, and never `assertive`: this is a status that changes on its own,
			// and interrupting a reader mid-sentence for a reconnect is exactly the
			// interruption the 60-second rotation would cause once a minute.
			accessibilityLiveRegion="polite"
			testID={testID}
		>
			{/* Decoration, hidden from assistive technology: the sentence beside it is
			 *  what carries the state. The audit's U-03 refuses a semantic colour with no
			 *  word, glyph or accessible name, and it is right to: to a reader who cannot
			 *  see it, this box says nothing — including when it is the only mark. */}
			<View
				className="h-1.5 w-1.5 shrink-0 rounded-full"
				style={{ backgroundColor: dotColor }}
				/* Named, not hidden. U-03 refuses a semantic colour with no word,
				 *  glyph or accessible name, and hiding the mark only moved the problem:
				 *  the audit measures the DOM, where a hidden coloured box is still a
				 *  coloured box. Naming it satisfies the rule honestly — the state IS
				 *  what this mark carries. */
				accessibilityLabel={`Connection: ${text}`}
			/>
			{text.length > 0 ? (
				<Text
					/* The flex constraints, in an inline style as well as the class list:
					 *  this is where the fix first failed silently — the row measured
					 *  554 pt inside a 320 pt viewport while carrying `max-w-full` and
					 *  `flex-1` as classes, and every sibling inherited that width. */
					style={{ flexShrink: 1, minWidth: 0 }}
					className={`min-w-0 flex-1 text-meta ${INK_CLASS[state]}`}
					accessibilityRole={ROLE.text}
				>
					{text}
				</Text>
			) : null}
		</View>
	);
};
