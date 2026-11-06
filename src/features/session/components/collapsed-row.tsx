import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ROLE } from "@/ui/a11y";
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
 * THE KINDS THAT MAY NEVER USE THIS (`transcript-row.tsx` enforces it):
 *  - the assistant's answer (it is the page, not an event);
 *  - an `ask` (it is a gate — the reader must see what they are answering);
 *  - an error's own fact (a collapsed error that hides why is the bug being
 *    fixed, so its first line is always the summary line).
 *
 * GEOMETRY, from the house bar (`QuietGroupBar`, and the turn bar before it):
 * 48 pt minimum height — stricter than the relay's 44 and the same as every
 * other disclosure in this list; `border-control` as the boundary rather than
 * `hairline`, because a hairline may never bound something pressable
 * (`tokens.json`'s own rule); a chevron that states its own state. Expansion is
 * per row and remembered while the row is mounted — exactly the scope the
 * caller gives it — and reopening a row cannot move the transcript, because the
 * state hangs off this instance and the list is never told.
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
	/** The full treatment, rendered in place and indented under the summary
	 *  when the row is open. */
	children: React.ReactNode;
};

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
	children,
}: CollapsedRowProps) => {
	const [open, setOpen] = useState(false);
	return (
		<View>
			<Pressable
				testID={testID}
				accessibilityRole={ROLE.button}
				accessibilityLabel={accessibilityLabel}
				accessibilityState={{ expanded: open }}
				onPress={() => setOpen((current) => !current)}
				className={cx(
					"flex-row items-center gap-1.5 rounded-sm border border-border-control bg-surface px-2.5",
					"min-h-12",
				)}
			>
				<Text
					className={cx("shrink-0 font-mono text-mono-sm", glyphClass)}
					aria-hidden
				>
					{glyph}
				</Text>
				{label !== undefined && label.length > 0 ? (
					<Text
						className={cx("shrink-0 text-meta", labelClass)}
						numberOfLines={1}
					>
						{label}
					</Text>
				) : null}
				{/* The summary is the fold's whole point: ONE line, tail ellipsis,
				    and the widest thing on the row because the body is what the
				    reader is deciding whether to open. */}
				<Text
					className={cx("min-w-0 flex-1 text-body-sm", bodyClass)}
					numberOfLines={1}
				>
					{summary}
				</Text>
				{meta !== undefined && meta.length > 0 ? (
					<Text className="shrink-0 font-mono text-mono-sm text-ink-dim tabular-nums">
						{meta}
					</Text>
				) : null}
				<Text
					className="shrink-0 font-mono text-mono-sm text-ink-dim"
					aria-hidden
				>
					{open ? "▾" : "▸"}
				</Text>
			</Pressable>
			{open ? (
				/* The inset is the bar's glyph column (16 pt), so the expanded body
				 *  starts where the summary starts and the reading measure is
				 *  unchanged by opening the row. */
				<View className="pt-2 ps-4">{children}</View>
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
