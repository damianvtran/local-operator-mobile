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
				className="min-h-12 flex-row items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5"
			>
				<Text className="font-mono text-mono-sm text-success" aria-hidden>
					✓
				</Text>
				<Text className="min-w-0 flex-1 text-body-sm text-ink">
					{outcome}
					{details.length > 0 ? (
						<Text className="font-mono text-mono-sm text-ink-dim tabular-nums">
							{` · ${details.join(" · ")}`}
						</Text>
					) : null}
				</Text>
				<Text className="font-mono text-mono-sm text-ink-dim" aria-hidden>
					{open ? "▾" : "▸"}
				</Text>
			</Pressable>
		</View>
	);
};
