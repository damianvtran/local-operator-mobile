import { Pressable, Text, View } from "react-native";

import {
	TRACE_BAR_PAD_CLASS,
	TRACE_COLUMN_GAP_CLASS,
	TRACE_GLYPH_BOX_CLASS,
	TRACE_ROW_OUTER_CLASS,
} from "@/features/session/components/trace-rail";
import {
	barAccessibleName,
	barPhrases,
	type TurnBarFacts,
} from "@/features/session/turn-condensing";
import { ROLE, turnBarId } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

/**
 * The condensed turn's bar: one row standing in for a completed turn's work,
 * and the disclosure that opens it. `turn-condensing.ts` owns every decision
 * this renders — which turns collapse, what the bar says, and why neither can
 * change while new frames arrive — so this file owns only the row, and the bar
 * cannot disagree with the model about the fact it states.
 *
 * **The target is 48 pt, not the kit's 44.** `components.md` § 3 sets the
 * minimum hit area at 44 pt iOS / 48 dp Android, and the two platforms
 * disagree; this control is the ONLY way back into a collapsed turn, so it
 * takes the stricter of the two rather than a platform branch. The row is
 * full-bleed inside the transcript's padding, so the reachable width is never
 * the constraint.
 *
 * **The glyph is a text glyph beside its word, never colour alone** (`U-03`):
 * the bar's whole job is that a condensed turn still shows it completed, and a
 * mark that only exists as green would fail the one reader this clause is for.
 * The word itself is the accessible name's (`barAccessibleName`); the painted
 * line carries the numbers beside the glyph.
 *
 * Like the quiet-group disclosure, this is a compact trace, not a card.
 * The completion mark, label and caret identify the control without adding
 * a bordered surface to the conversation. Its touch target stays unchanged.
 */
export type TurnBarProps = {
	/** The turn's opening row id — the stable key the latch and the reader's
	 *  expansion are held by, and the bar's identifier. */
	turnKey: string;
	facts: TurnBarFacts;
	/** The opening message's first line; names the turn to assistive tech. */
	headline: string;
	open: boolean;
	onToggle: (open: boolean) => void;
};

/* A detail like "1m 12s" or "38 steps" is ONE fact: breaking it at its space left "12s"
 *  orphaned on line two at 150 % (design D8). Non-breaking spaces keep each detail whole
 *  while the ` · ` separators stay breakable. Painted text only — the accessible name
 *  is built from `barPhrases` and is untouched. */
const unbreakable = (detail: string): string => detail.replace(/ /g, "\u00A0");

export const TurnBar = ({
	turnKey,
	facts,
	headline,
	open,
	onToggle,
}: TurnBarProps) => {
	// The one copy function, shared with the tests. A steered turn's label
	// leads in the muted ink; the counts follow in the dim detail ink. No
	// painted outcome word (U1-3): `completed` beside a red `✗` read as a
	// contradiction, so — as on Relay — only the accessible name says it.
	const phrases = barPhrases(facts);
	const [lead, ...details] = facts.steered ? phrases : ["", ...phrases];
	const failedCount = facts.failed ?? 0;
	const failed = failedCount > 0;
	return (
		<View className={TRACE_ROW_OUTER_CLASS}>
			<Pressable
				testID={turnBarId(turnKey)}
				accessibilityRole={ROLE.button}
				accessibilityLabel={barAccessibleName(facts, headline)}
				accessibilityState={{ expanded: open }}
				onPress={() => onToggle(!open)}
				style={{ minHeight: TOUCH_FLOOR }}
				className="justify-center"
			>
				{({ pressed }) => (
					<View
						className={cx(
							"flex-row items-start py-2",
							pressed && "bg-row-hover",
							TRACE_BAR_PAD_CLASS,
							TRACE_COLUMN_GAP_CLASS,
						)}
					>
						<Text
							className={cx(
								TRACE_GLYPH_BOX_CLASS,
								failed ? "text-danger" : "text-success",
							)}
							aria-hidden
						>
							{failed ? "✗" : "✓"}
						</Text>
						<Text className="min-w-0 flex-1 text-trace text-ink-muted">
							{lead}
							{details.length > 0 ? (
								/* Proportional `text-meta`, not `font-mono` (Q1-3): the details
								 * are translated words now, and the monospace stack draws Urdu's
								 * cursive script as disconnected letters; `tabular-nums` keeps
								 * the digits aligned, as Relay's `text-meta` units do. */
								<Text className="text-meta text-ink-dim tabular-nums">
									{`${lead ? " · " : ""}${details.map(unbreakable).join(" · ")}`}
								</Text>
							) : null}
						</Text>
						{failed ? (
							<Text
								className="shrink-0 font-mono text-mono-sm text-danger tabular-nums"
								aria-hidden
							>
								{failedCount}
							</Text>
						) : null}
						<Text className="text-trace" aria-hidden>
							<Text className="font-mono text-mono-sm text-ink-dim">
								{open ? "▾" : "▸"}
							</Text>
						</Text>
					</View>
				)}
			</Pressable>
		</View>
	);
};
