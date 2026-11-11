import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
	TRACE_BAR_PAD_CLASS,
	TRACE_COLUMN_GAP_CLASS,
} from "@/features/session/components/trace-rail";
import { ROLE } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { cx } from "@/ui/variants";

/**
 * One message event folded to a single expandable line.
 *
 * WHY THIS EXISTS. The operator's report: "some things like peer messages are
 * not properly condensed into an expandable line … make sure that these are
 * properly collapsed". The relay folds receipts into `condense-rows`; the
 * desktop folds them through `turn-collapse`. This app had the machinery for a
 * run of receipts (`quiet-group-bar.tsx`) and for a completed turn
 * (`turn-bar.tsx`) but nothing for ONE row whose body is long, so a peer message
 * argued with the transcript for a whole screen.
 *
 * WHERE IT DIVERGES FROM THE REFERENCES, deliberately: the relay can fold a peer
 * *receipt* to a bare label because a receipt carries no words. An inbound peer
 * message does carry words the reader may have to act on, so this collapses to a
 * SUMMARY LINE — the body's first line, tail-ellipsised — and expands in place.
 * Nothing is ever hidden behind the fold that the first line does not announce.
 *
 * THE KINDS THAT MAY NEVER USE THIS (`transcript-row.tsx` enforces it, and
 * the relay and the desktop both agree — review round 1, R1-2 / U1 / D2):
 *  - the assistant's answer (it is the page, not an event);
 *  - the reader's own prompt and steers (the turn's strongest landmark; only an
 *    outbound send TO a recipient — a hub or peer receipt — folds);
 *  - an error notice (the fact the reader most needs, and the one a fold would
 *    most cost them);
 *  - a settled `ask` receipt, because `AskResponseRow` is already its own
 *    one-line disclosure — a fold around it would be a fold around a fold.
 *
 * GEOMETRY: A QUIET LINE, NOT A CARD (design round 3, D4). The first rendered
 * frames drew three folded peer rows as outlined `surface` cards, and they read
 * HEAVIER than the plain one-line notices directly above them — the opposite of
 * "condensed into an expandable line". So the bar draws exactly what a notice
 * row draws: glyph, words and a chevron on the canvas, no border, no fill, no
 * radius. Its only extra is the box a thumb needs: the touch floor
 * (`TOUCH_FLOOR`, 44 iOS / 48 elsewhere) as a minimum height with the line
 * centred in it, which is spacing rather than chrome. Press feedback is the
 * house row tint (`bg-row-hover`, as `past.tsx`'s rows) WHILE PRESSED only; a
 * resting tint would be the card again. With no drawn edge there is no
 * boundary rule to satisfy (`tokens.json`: a hairline may never bound
 * something pressable — nothing bounds this). A chevron states its own state. Expansion is
 * per row and OWNED BY THE CALLER when it passes `open`/`onToggle`: the
 * transcript keeps it in a set keyed by row id, so a row that windowing unmounts
 * comes back the way the reader left it and a find landing can open it (review
 * round 1, Q5 / U6 / U2). Without those props the row keeps its own state.
 */
export type CollapsedRowProps = {
	testID?: string;
	/** The leading glyph, drawn from the row's own vocabulary so a collapsed
	 *  peer message still reads as a peer message. */
	glyph: string;
	/** The glyph's ink class. */
	glyphClass?: string;
	/** Who or what this line is about: the peer label, the tool name, the
	 *  sender. One line, tail ellipsis. Omitted for a row that has no third
	 *  party to name (the reader's own message). */
	label?: string;
	/** The ink for `label`. */
	labelClass?: string;
	/** The body's first line — the summary the fold stands for. */
	summary: string;
	/** The ink for the summary and the expanded body. */
	bodyClass?: string;
	/** Right-hand meta: elapsed, counts. `mono-sm`, `ink-dim`, shrinking last. */
	meta?: string;
	/** The accessible name. Built by the caller from the entry's own words: no
	 *  copy is invented here, and the row is the only place the full text lives
	 *  while it is folded. */
	accessibilityLabel?: string;
	/** A control that belongs on the bar whether the row is open or not — a
	 *  subagent row's `open` route to the agent view (review round 1, R1-3).
	 *  Drawn after the chevron, OUTSIDE the fold's pressable, so it is its own
	 *  target and its own accessibility element. */
	action?: React.ReactNode;
	/** Controlled open state. Omit (with `onToggle`) for a row that keeps
	 *  its own. */
	open?: boolean;
	/** Asked for the next open state on a press, when `open` is controlled. */
	onToggle?: (open: boolean) => void;
	/** The full treatment, rendered in place and indented under the summary
	 *  when the row is open. */
	children: React.ReactNode;
};

/*
 * THE TEXT COLUMN, ONE DEFINITION FOR THE BAR AND THE BODY (design round 1, D3).
 * The bar is `COLUMN_PAD` (on its pressable) + a fixed glyph column +
 * `COLUMN_GAP`, and the expanded body repeats exactly that geometry — the same
 * padding, an EMPTY glyph column, the same gap — so the body starts on the line
 * the bar's text starts on at any text size, without a measured or hand-added
 * inset that would drift the moment one of them changed. The glyph column is
 * fixed-width for the same reason: a proportional glyph made the summary's
 * start depend on which glyph the row had.
 *
 * The values are the NOTICE row's (`transcript-row.tsx`: the row wrapper's
 * `px-4`, then glyph, `gap-2`, words), so a folded row's glyph and words stand
 * on the same columns as the notice lines around it (D4). No padding of its
 * own: the round-1 `border` + `px-2.5` inset existed to clear the card's edge,
 * and there is no card.
 */
const COLUMN_PAD = TRACE_BAR_PAD_CLASS;
const GLYPH_COLUMN = "w-4 shrink-0";
const COLUMN_GAP = TRACE_COLUMN_GAP_CLASS;

export const CollapsedRow = ({
	testID,
	glyph,
	glyphClass = "text-ink-dim",
	label,
	labelClass = "text-ink-dim",
	summary,
	bodyClass = "text-ink",
	meta,
	accessibilityLabel,
	action,
	open: controlledOpen,
	onToggle,
	children,
}: CollapsedRowProps) => {
	const [ownOpen, setOwnOpen] = useState(false);
	const open = controlledOpen ?? ownOpen;
	/* At large text the label and the summary STACK (D1): at 320 pt / 200 %
	 * `Hub · From reviewer` alone took 218 of the row's 288 pt, leaving the
	 * summary one clipped letter. Two lines on the same 40 pt text rail give
	 * each a full line — the shape the Bridge receipt already wrapped into. The
	 * stack holds open or closed, so a tap never reflows the header. */
	const { effectiveScale } = useTextScale();
	const hasLabel = label !== undefined && label.length > 0;
	/* Only a row WITH a label stacks (R2-1): stacking is how the label stops
	 * starving the summary, so a label-less row (a folded long notice,
	 * `transcript-row.tsx`) has nothing to stack. Letting it count as stacked
	 * stripped `flex-1` from its lone summary, and on native an unshrinkable
	 * long line then pushed the meta and the `▸` off the row. */
	const stacked = hasLabel && effectiveScale > LARGE_TEXT_SCALE;
	const labelText = hasLabel ? (
		<Text
			className={cx("min-w-0 shrink text-meta", labelClass)}
			/* A STYLE cap, not `max-w-1/2`: that class never constrained the label
			 * on RN web (measured 218 pt of 288, D1). Stacked, the label owns its
			 * line and needs no cap. */
			style={stacked ? undefined : { maxWidth: "50%" }}
			numberOfLines={1}
		>
			{label}
		</Text>
	) : null;
	const summaryText = (
		<Text
			className={cx(
				"min-w-0 text-body-sm",
				stacked ? undefined : "flex-1",
				bodyClass,
			)}
			numberOfLines={1}
		>
			{summary}
		</Text>
	);
	return (
		<View>
			<View className="flex-row items-stretch">
				<Pressable
					testID={testID}
					accessibilityRole={ROLE.button}
					accessibilityLabel={accessibilityLabel}
					accessibilityState={{ expanded: open }}
					onPress={() => {
						if (controlledOpen !== undefined && onToggle !== undefined) {
							onToggle(!controlledOpen);
							return;
						}
						setOwnOpen((current) => !current);
					}}
					/* The floor is a style, not `min-h-12`: 48 everywhere was the card's
					 *  height, and iOS's floor is 44 — the shorter box is the tighter
					 *  rhythm the notice lines around it keep (D4). */
					style={{ minHeight: TOUCH_FLOOR }}
					className="min-w-0 flex-1"
				>
					{({ pressed }) => (
						<View
							className={cx(
								/* Stacked, the line is two lines tall: centring would float the
								 * glyph and the chevron BETWEEN them (Q2-2), so they key to the
								 * first line — the TurnBar's caret rule. */
								"flex-1 flex-row",
								stacked ? "items-start" : "items-center",
								pressed && "bg-row-hover",
								COLUMN_PAD,
								COLUMN_GAP,
							)}
						>
							<Text
								className={cx(
									"text-start font-mono text-mono-sm",
									GLYPH_COLUMN,
									/* Mono glyph vs the proportional label: nudge it onto
									 * the label's line box when the two lines stack. */
									stacked && "pt-0.5",
									glyphClass,
								)}
								aria-hidden
							>
								{glyph}
							</Text>
							{/* The label may take at most half the row, so the summary — the
				    thing the reader decides on — keeps words (UX round 1, U5); at
				    large text it gets its own line instead (D1). The summary is
				    the fold's whole point: ONE line, tail ellipsis. */}
							{stacked && hasLabel ? (
								<View className="min-w-0 flex-1">
									{labelText}
									{summaryText}
								</View>
							) : (
								<>
									{labelText}
									{summaryText}
								</>
							)}
							{meta !== undefined && meta.length > 0 ? (
								<Text
									className="min-w-0 max-w-1/3 shrink font-mono text-mono-sm text-ink-dim tabular-nums"
									numberOfLines={1}
								>
									{meta}
								</Text>
							) : null}
							<Text
								className="shrink-0 font-mono text-mono-sm text-ink-dim"
								aria-hidden
							>
								{open ? "▾" : "▸"}
							</Text>
						</View>
					)}
				</Pressable>
				{action !== undefined && action !== null ? (
					<View className={cx("justify-center", "pe-2")}>{action}</View>
				) : null}
			</View>
			{open ? (
				<View className={cx("flex-row pb-1", COLUMN_PAD, COLUMN_GAP)}>
					<View className={GLYPH_COLUMN} aria-hidden />
					<View className="min-w-0 flex-1">{children}</View>
				</View>
			) : null}
		</View>
	);
};

/** The body's first line: what a folded row shows. Whitespace is collapsed so a
 *  body that opens with blank lines still summarises as its first real line,
 *  and the result is never empty for a body that has any content. */
export function firstLine(text: string): string {
	const line = text
		.split("\n")
		.map((row) => row.trim())
		.find((row) => row.length > 0);
	return line ?? "";
}

/**
 * The threshold for folding, stated once: a body folds when its first line does
 * NOT hold it — i.e. it has more than one non-empty line, or its single line is
 * longer than a phone row can show beside the glyph, the label and the meta.
 *
 * 80 characters is the budget the reference uses for a one-line receipt and is
 * roughly what survives at `body-sm` in the 402 pt column after the fold's own
 * chrome; a body under it renders as it always did, with no chevron to suggest
 * something is hidden.
 */
export const FOLD_AFTER_CHARS = 80;

export function shouldFold(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;
	const lines = trimmed.split("\n").filter((line) => line.trim().length > 0);
	return lines.length > 1 || trimmed.length > FOLD_AFTER_CHARS;
}
