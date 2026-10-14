import { Pressable, Text, View } from "react-native";

import {
	barAccessibleName,
	barPhrases,
	type TurnBarFacts,
} from "@/features/session/turn-condensing";
import { ROLE, turnBarId } from "@/ui/a11y";

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
 *
 * **The boundary is `border-control`, not the hairline.** Same reason as the
 * quiet group's bar (design round 1, D1): a pressable whose card fill and
 * border are its only boundary takes the structural token — `hairline` is
 * "NEVER the sole boundary of anything you can press" (1.25:1 light / 1.46:1
 * dark), while `border-control` measures 3.42:1 light / 3.93:1 dark. The two
 * bars move together so the family resolves in one change.
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
	// The one copy function, shared with the tests: the first phrase is the
	// completion, the rest are the counts. Splitting here keeps the string
	// single-sourced rather than re-spelling "completed" at the render site.
	const [outcome, ...details] = barPhrases(facts);
	return (
		<View className="px-3 py-1">
			<Pressable
				testID={turnBarId(turnKey)}
				accessibilityRole={ROLE.button}
				accessibilityLabel={barAccessibleName(facts, headline)}
				accessibilityState={{ expanded: open }}
				onPress={() => onToggle(!open)}
				// 48 = `min-h-12`, the strict platform of the two. Deliberately NOT
				// `numberOfLines`-capped below: a clipped "42s" is a shorter string
				// that is still a valid duration, which is how a truncated clock
				// survives review (`components.md` § 7) — the bar wraps instead.
				className="min-h-12 justify-center rounded-sm border border-border-control bg-surface px-3 py-2"
			>
				{/* ONE RAIL, AND THE CARET RIDES THE FIRST LINE. The ✓ used to be its own
				 *  flex column and the caret was centred on the whole row, so once the label
				 *  wrapped (150 % on a phone) the first line sat 27.8 pt inside the row, the
				 *  wrapped lines started under the glyph rather than beside it, and the caret
				 *  floated 15.9 pt off line one — U-41's rail and caret rules. The glyph is
				 *  now the first RUN of the label's own text, so every line shares the rail,
				 *  and the row is `items-start` so the caret keys to line one at any scale.
				 *  The outer Pressable centres this row vertically, which keeps a single-line
				 *  bar optically centred inside its 48 pt target. */}
				<View className="flex-row items-start gap-2">
					<Text className="min-w-0 flex-1 text-body-sm text-ink">
						<Text className="font-mono text-mono-sm text-success" aria-hidden>
							{"✓ "}
						</Text>
						{outcome}
						{details.length > 0 ? (
							<Text className="font-mono text-mono-sm text-ink-dim tabular-nums">
								{` · ${details.map(unbreakable).join(" · ")}`}
							</Text>
						) : null}
					</Text>
					{/* The caret is wrapped in the label's OWN type role, the way the label wraps
					 *  its ✓: both lines then have the body-sm line box, and the caret's centre
					 *  is the first line's centre by construction rather than 4 pt off at 200 %
					 *  (a bare mono-sm caret has a shorter line box than the body-sm label). */}
					<Text className="text-body-sm" aria-hidden>
						<Text className="font-mono text-mono-sm text-ink-dim">
							{open ? "▾" : "▸"}
						</Text>
					</Text>
				</View>
			</Pressable>
		</View>
	);
};
