import { Text, View } from "react-native";

import { ROLE, SURFACE } from "@/ui/a11y";
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
	| "degraded"
	/** No computer is connected, so there is no transport to report on at all.
	 *
	 *  Distinct from `offline`, which is a transport that FAILED. Before this state
	 *  existed a screen with no route fell through to `connected`, and a Status row that
	 *  also hardcoded its word painted a green dot and "Connected" under the heading "No
	 *  computer connected" (design round 2, D12). "Not connected" is not a kind of
	 *  connected. */
	| "inactive";

export type ConnectionPillProps = {
	state: ConnectionPillState;
	/** Overrides the default sentence. Used where the pill must name the machine
	 *  ("Your computer is not answering") rather than the transport. */
	message?: string;
	/** One line, tail-truncated, with the whole message kept as the accessible
	 *  name. For a pill that sits in a ROW beside other content (Settings ›
	 *  Status, the Agents drawer header), where a wrapped or unbounded sentence
	 *  pushed the pill past the right edge on an iPhone (Sherman's report via
	 *  Aida). See `statusPillFit` for the geometry rule. */
	singleLine?: boolean;
	testID?: string;
};

/* ------------------------------------------------------------------------ */
/* Row geometry                                                             */
/* ------------------------------------------------------------------------ */

/** The class of a label/value row whose value is this pill (Settings › Status).
 *  `min-w-0` is what lets the row's children shrink below their content width
 *  at all; without it Yoga sizes the row to its content and the pill leaves the
 *  screen. */
export const STATUS_ROW_CLASS =
	"min-w-0 flex-row items-center justify-between gap-3";
/** `gap-3` above, in pt, for the geometry rule. */
export const STATUS_ROW_GAP_PT = 12;
/** The most of the row the pill may take, so the row's label always keeps the
 *  rest. A share rather than a pt width because the row's width is the
 *  viewport's (320 pt SE up to tablet split view). */
export const STATUS_PILL_MAX_SHARE = 0.6;
/** The pill's slot inside such a row: shrinkable, never wider than its share. */
export const STATUS_PILL_SLOT_STYLE = {
	flexShrink: 1,
	minWidth: 0,
	maxWidth: `${STATUS_PILL_MAX_SHARE * 100}%`,
} as const;
/** The row label's style: it may shrink (and wrap) too, so a long label in a
 *  long locale cannot push the pill out either. */
export const STATUS_LABEL_STYLE = { flexShrink: 1, minWidth: 0 } as const;
/** The pill's own horizontal chrome in pt: `px-2` both sides (16), the 6 pt dot,
 *  `gap-2` (8) and a 1 pt border each side (2). */
export const STATUS_PILL_CHROME_PT = 32;

/**
 * The status row's flex outcome, as a pure function of measured widths, so the
 * rule is testable in node (which has no layout engine) and the component is
 * checked to use the same constants.
 *
 * Both children shrink. When they fit side by side, both keep their natural
 * width. When they do not, the pill is capped at its share of the row and the
 * label takes what is left (wrapping if it must) — so `label + gap + pill` never
 * exceeds the row, and the pill's text is truncated exactly when its natural
 * width exceeds the box it was given.
 */
export function statusPillFit(input: {
	rowPt: number;
	labelPt: number;
	textPt: number;
}): { pillPt: number; labelPt: number; truncated: boolean } {
	const natural = input.textPt + STATUS_PILL_CHROME_PT;
	const cap = input.rowPt * STATUS_PILL_MAX_SHARE;
	if (input.labelPt + STATUS_ROW_GAP_PT + natural <= input.rowPt) {
		const pillPt = Math.min(natural, cap);
		return { pillPt, labelPt: input.labelPt, truncated: natural > pillPt };
	}
	const pillPt = Math.min(natural, cap);
	return {
		pillPt,
		labelPt: Math.min(input.labelPt, input.rowPt - STATUS_ROW_GAP_PT - pillPt),
		truncated: natural > pillPt,
	};
}

/** The copy each state carries. Kept here so two screens cannot say the same
 *  state two ways. */
const DEFAULT_MESSAGE: Record<ConnectionPillState, string> = {
	// The connected state is deliberately silent: a healthy connection is not news,
	// and a permanent "Connected" on a list is furniture the eye learns to skip.
	connected: "",
	reconnecting: "Reconnecting…",
	offline: "Offline. Messages will send when you're back.",
	degraded: "Not answering",
	inactive: "No computer connected",
};

const PILL_CLASS: Record<ConnectionPillState, string> = {
	connected: "",
	reconnecting: "bg-warning-wash border-warning-border",
	offline: "bg-danger-wash border-danger-border",
	degraded: "bg-info-wash border-info-border",
	// Nothing failed, so there is no cause to colour: a neutral mark is the honest one.
	inactive: "",
};

const INK_CLASS: Record<ConnectionPillState, string> = {
	connected: "text-ink-dim",
	reconnecting: "text-warning",
	offline: "text-danger",
	degraded: "text-info",
	inactive: "text-ink-dim",
};

/**
 * The dot's token, per state.
 *
 * A token ROLE rather than one of the four semantics, because `inactive` has no
 * semantics to carry: it is the absence of a connection, not a failure, and painting it
 * with the same green as a live link is the defect that made this state exist.
 */
const DOT_ROLE: Record<
	ConnectionPillState,
	"success" | "warning" | "danger" | "info" | "ink-dim"
> = {
	connected: "success",
	reconnecting: "warning",
	offline: "danger",
	degraded: "info",
	inactive: "ink-dim",
};

export const ConnectionPill = ({
	state,
	message,
	singleLine = false,
	testID = SURFACE.connectionPill,
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
					/* Truncation hides words from sight only: the accessible name is the
					 *  whole message, so a screen reader never hears "Не отвеч…". */
					accessibilityLabel={text}
					numberOfLines={singleLine ? 1 : undefined}
					ellipsizeMode={singleLine ? "tail" : undefined}
				>
					{text}
				</Text>
			) : null}
		</View>
	);
};
