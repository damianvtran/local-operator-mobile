import { Pressable, Text, View } from "react-native";

import {
	TRACE_BAR_PAD_CLASS,
	TRACE_COLUMN_GAP_CLASS,
	TRACE_GLYPH_BOX_CLASS,
	TRACE_ROW_OUTER_CLASS,
} from "@/features/session/components/trace-rail";
import {
	type FoldRun,
	foldActionCountLabel,
	foldBarAccessibleName,
	foldSettledUnits,
} from "@/features/session/fold-model";
import { foldBarId, ROLE } from "@/ui/a11y";
import { Shimmer } from "@/ui/components/shimmer";
import { useComposedDir } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

/**
 * Tier A — Tool & receipt run fold bar (`FoldBar`), ported from the mobile
 * relay (`condense-rows.tsx`) and desktop (`trace-fold-model.ts`).
 *
 * GEOMETRY & RAIL:
 *   - Outer wrapper: `TRACE_ROW_OUTER_CLASS` (`px-4`, `16 pt`).
 *   - Leading glyph column: `TRACE_GLYPH_BOX_CLASS` (`w-4`, `16 pt` at `x = 16 pt`).
 *   - Gap: `TRACE_COLUMN_GAP_CLASS` (`gap-2`, `8 pt`), putting the text column
 *     and any wrapped second lines on the shared `x = 40 pt` rail.
 *   - Touch target: `TOUCH_FLOOR` (`44 pt` iOS / `48 pt` Android+web) via `style`,
 *     borderless with `bg-row-hover` press feedback only.
 *
 * STATES:
 *   - Closed + live running: pulsing `⟳` glyph (`Shimmer`) even after an
 *     earlier call failed (the red count still shows), active tool's semantic
 *     display name + summary, total action count, and live elapsed time.
 *   - Open + running: a static dim `⟳` — never a `✓` over a running row.
 *   - Settled: `✓` (or `✗` + failure count in `text-danger` when any
 *     folded call errored) plus localized structured action-class units up to 5
 *     (`3 files · 2 searches · 1 shell · 1 task` via `relay.transcript.fold.*`).
 */
export interface FoldBarProps {
	foldKey: string;
	fold: FoldRun;
	open: boolean;
	onToggle: (open: boolean) => void;
}

const unbreakable = (unit: string): string => unit.replace(/ /g, "\u00A0");

export const FoldBar = ({ foldKey, fold, open, onToggle }: FoldBarProps) => {
	const failed = fold.failedCount > 0;
	const showLive = fold.running && !open && fold.liveAction !== null;
	const units = foldSettledUnits(fold.countSegments, fold.receiptEntries);
	const totalActions = foldActionCountLabel(fold.actions.length);
	/* The settled units and the count are composed copy whose first strong
	 * character can be Latin (`9s`), so they state the page's base rather than
	 * RN-web's `dir="auto"` (Q2-1; `@/ui/direction`). */
	const composedDir = useComposedDir();

	/* Running outranks failed for the GLYPH (Q1-1 / U1-4): the fold's state is
	 * "still working" until it settles, so neither an open bar (a static `✓`
	 * over a running row) nor an earlier failure (a still `✗` beside the call
	 * that is running now) may claim it is done. The failure is not hidden —
	 * the red `failedCount` on the trailing edge stays. Open + running paints a
	 * static, dim `⟳`: the rows below carry the live motion. */
	const glyph = fold.running ? "⟳" : failed ? "✗" : "✓";
	const glyphInk =
		fold.running && !open
			? "text-accent"
			: !fold.running && failed
				? "text-danger"
				: "text-ink-dim";

	return (
		<View className={TRACE_ROW_OUTER_CLASS}>
			<Pressable
				testID={foldBarId(foldKey)}
				accessibilityRole={ROLE.button}
				accessibilityLabel={foldBarAccessibleName(fold)}
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
						<Shimmer active={fold.running && !open} className="w-4 shrink-0">
							<Text className={cx(TRACE_GLYPH_BOX_CLASS, glyphInk)} aria-hidden>
								{glyph}
							</Text>
						</Shimmer>
						{showLive && fold.liveAction !== null ? (
							<View className="min-w-0 flex-1">
								<View className="flex-row items-center gap-2">
									<Text
										className="min-w-0 shrink truncate text-trace text-ink-muted"
										numberOfLines={1}
									>
										{fold.liveAction.displayName}
									</Text>
									{fold.liveAction.summary ? (
										<Text
											className="min-w-0 flex-1 text-trace text-ink-dim"
											numberOfLines={1}
										>
											{fold.liveAction.summary}
										</Text>
									) : (
										<View className="flex-1" />
									)}
									{fold.liveAction.elapsed ? (
										<Text className="shrink-0 font-mono text-mono-sm text-ink-dim tabular-nums">
											{fold.liveAction.elapsed}
										</Text>
									) : null}
								</View>
								<Text
									className="text-meta text-ink-dim tabular-nums"
									numberOfLines={1}
									{...composedDir}
								>
									{totalActions}
								</Text>
							</View>
						) : (
							<Text
								className="min-w-0 flex-1 text-trace text-ink-muted"
								{...composedDir}
							>
								{(units.length > 0 ? units : [totalActions])
									.map(unbreakable)
									.join(" · ")}
							</Text>
						)}
						{failed ? (
							<Text
								className="shrink-0 font-mono text-mono-sm text-danger tabular-nums"
								aria-hidden
							>
								{fold.failedCount}
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
