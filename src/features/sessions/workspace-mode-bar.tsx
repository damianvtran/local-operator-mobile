import { X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { countLabel } from "@/features/notifications/notifications-model";
import {
	type ModeBarSegmentMode,
	useModeBarFit,
} from "@/features/sessions/mode-bar-fit";
import type {
	WorkspaceDrawerBridgeAdapter,
	WorkspaceDrawerMode,
} from "@/features/sessions/workspace-drawer.contract";
import { t } from "@/i18n";
import { state as a11yState, CONTROL, ROLE } from "@/ui/a11y";
import { Badge } from "@/ui/components/badge";
import { IconButton } from "@/ui/components/icon-button";
import { TOUCH_FLOOR } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { cx } from "@/ui/variants";

/*
 * The mode bar, apart from `workspace-drawer.tsx` so `ConversationsPane` can
 * render it without importing the provider that renders the pane (see
 * `workspace-drawer-context.ts`).
 */

/**
 * The mode track's layout, by text scale and by whether both labels fit an
 * equal half (`segments`, from `useModeBarFit`). Exported so the arithmetic
 * below is pinned in a unit test (Node has no layout engine to measure it).
 *
 * BELOW `LARGE_TEXT_SCALE`: ONE row, always, and the unread count costs NO
 * layout. The panel at 320 pt is `sidebarWidthFor(320, 48)` = 272 pt; the
 * row's `px-2` (16) + `gap-1` (4) + the 48 pt close button leave 204 pt, the
 * track's `p-1` (8) a 196 pt inner track, and its `gap-1` (4) 192 pt for the
 * two segments. Every one of those steps is on `space.scale` (4 pt multiples):
 * the earlier 2 / 6 / 10 pt half steps failed the web audit's U-42 spacing
 * check on every frame showing the drawer (1,152 rows at 320 pt alone), and
 * `workspace-drawer.test.tsx` now refuses any half-step spacing utility here. Agents (47 + 16 + 2) and Team Bridge (79 + 16 + 2) need ~162 pt; an
 * INLINE count (4 gap + up to 30.5 for "99+") pushes that to ~196.5 pt, so
 * "Team Bridge" wrapped to two lines, the bar grew 48 → 54.6 pt and the
 * drawer and the segment divider moved whenever an unread arrived (PR #222 UX U2-1/U2-2, design D2-2). The
 * count is therefore an out-of-flow corner overlay (`badge: "overlay"`): adding
 * or clearing "7" / "99+" changes zero layout pixels.
 *
 * EQUAL HALVES WHEN BOTH LABELS FIT (issue #324, the operator's decision; it
 * supersedes D1-2/D2-1 for that case only). Content-sized segments read as
 * lopsided on a roomy phone — 125 vs 157 pt on a 402 pt iPhone — so when
 * `2 × (the wider segment + 1 pt margin) + gap ≤ the inner track` the segments
 * are `flex-1` halves (141 pt each there). The 1 pt (`MODE_FIT_MARGIN`)
 * absorbs measurement rounding: without it a measured exact fit wrapped the
 * selected "Team Bridge" at 322 px on web (PR #333 QA Q1-1). When it does not
 * hold — 320 pt Android, where 2 × (97 + 1) + 4 = 200 pt against a 196 pt
 * track, or a long translation — they keep sizing from their content (`grow`,
 * basis auto) and share only the slack (D1-2/U1-1/Q1-2), so at 100 % text
 * "Team Bridge" still stays on one line there. The widths are
 * MEASURED (`mode-bar-fit.ts`), never assumed: the proportional split is the
 * fallback and the layout until the measurement lands.
 *
 * AT AND ABOVE IT, unchanged by #324 and never measured: the track wraps (PR
 * #212 QA Q1-1) so "Team Bridge" breaks
 * onto its own row instead of truncating at 200 %+ / Urdu RTL. Segments are
 * content-proportioned (`grow shrink`, basis auto), NOT `flex-1` halves: equal
 * halves of the (then) 190 pt track gave each label a 73 pt inner box, narrower than
 * the single word "Bridge" (~80 pt at 28 px), and with `min-w-0 shrink` on the
 * label that forced the mid-word break "Bridg / e" (design D2-1). Now a segment
 * that does not fit wraps onto its own full-width row, and the label never
 * shrinks below its longest word (`label` carries no `min-w-0 shrink`). The
 * count stays INLINE here: a 200–300 % pill overlaid on the corner would sit
 * on top of a wrapped label, and the wrap already absorbs its width.
 *
 * Both: the track stretches its children (`items-stretch`) so the two
 * segments are always the same height, and wrapped rows centre in the track
 * (`content-center`) rather than top-aligning one label above the other
 * (UX U1-2).
 */
export const modeBarLayout = (
	largeText: boolean,
	segments: ModeBarSegmentMode = "proportional",
) =>
	largeText
		? ({
				track:
					"min-w-0 flex-1 flex-row flex-wrap content-center items-stretch gap-1 rounded-md bg-sunken p-1",
				segment: "min-w-0 grow shrink",
				content: "flex-wrap px-3",
				label: "text-center text-body-sm",
				badge: "inline",
			} as const)
		: ({
				track:
					"min-w-0 flex-1 flex-row flex-nowrap content-center items-stretch gap-1 rounded-md bg-sunken p-1",
				segment:
					segments === "equal" ? "min-w-0 flex-1" : "min-w-0 grow shrink",
				content: "flex-nowrap px-2",
				label: "text-center text-body-sm",
				badge: "overlay",
			} as const);

/** Where the overlaid Team Bridge count sits on its segment's top-trailing
 *  corner. It rises into the track's `p-1` (4) + the row's `pt-2` (8) above
 *  the segment and reaches past the track's `p-1` into the `gap-1` before the
 *  close button (8 pt in all, or the docked pane's `px-2`), so it never clips,
 *  leaves the panel or touches the close hit box. `top`/`end` are insets, not
 *  spacing, so U-42's scale does not bind them. `end`, not `right`, so Urdu RTL
 *  mirrors it to the leading corner. */
export const MODE_BADGE_INSET = { top: -5, end: -4 } as const;

/**
 * Minimal, calm segmented mode track shared by the temporary workspace drawer
 * and the docked split-view pane.
 *
 * WHY NOT `Button variant="primary"`. Two standalone 44 pt primary CTA slabs
 * turned a navigation mode toggle into competing green action banners, and an
 * emphasis `bg-accent` badge on top of a selected `bg-accent` button collapsed
 * into a zero-contrast green-on-green lump. Here a quiet sunken pill track
 * raises the active segment (`bg-elevated`, subtle hairline, `text-ink
 * font-semibold`) while keeping `TOUCH_FLOOR` hit height, full multi-line wrap
 * at 200 %+ / RTL (whole-word wraps, never `numberOfLines={1}`), and a crisp
 * count in both selected and unselected states (`bg-elevated` / `bg-sunken`
 * grounds, never `bg-accent`, ringed in the segment's own ground).
 *
 * When `onClose` is supplied (the temporary drawer), `CONTROL.sidebarClose`
 * sits on the same top chrome row so neither Agents nor Team Bridge needs a
 * second 52 pt close-button band underneath.
 */
export const WorkspaceModeBar = ({
	mode,
	onSelectMode,
	bridgeBadge,
	onClose,
}: {
	mode: WorkspaceDrawerMode;
	onSelectMode: (next: WorkspaceDrawerMode) => void;
	bridgeBadge: WorkspaceDrawerBridgeAdapter["bridgeBadge"];
	onClose?: () => void;
}) => {
	const { effectiveScale } = useTextScale();
	const largeText = effectiveScale > LARGE_TEXT_SCALE;
	const agentsLabel = t("mobile.chrome.drawer.agents");
	const bridgeLabel = t("mobile.team_bridge.title");
	const fit = useModeBarFit(
		!largeText,
		/* The drawer's bar (with Close) and the docked pane's are different
		 *  tracks, so their fits are remembered apart (PR #333 R1-2). */
		`${onClose ? "drawer" : "docked"}\u0000${effectiveScale}\u0000${agentsLabel}\u0000${bridgeLabel}`,
	);
	const layout = modeBarLayout(largeText, fit.mode);
	const agentsSelected = mode === "agents";
	const bridgeSelected = mode === "team-bridge";
	const showCount =
		bridgeBadge.state === "ready" &&
		bridgeBadge.count !== null &&
		bridgeBadge.count > 0;
	return (
		<View className="flex-row items-center gap-1 px-2 pt-2 pb-1">
			{/* WRAP, NEVER TRUNCATE (PR #212 QA Q1-1 / design D1 / UX U1).
			 *  At 200 % text a fixed row cut "Team Bridge" to "Team B" and
			 *  pushed the badge past the panel (320/390 pt phones, Urdu RTL
			 *  started the button at x −88; text scale reaches 3×). The track
			 *  wraps, and a segment that does not fit takes its own row so its
			 *  label breaks between words instead of ellipsizing. Below large
			 *  text it stays one row instead (`modeBarLayout`). */}
			<View className={layout.track} onLayout={fit.onTrackLayout}>
				{/* THE MEASURER (issue #324). Both labels at their natural width,
				 *  in the selected weight (the wider one, so selecting a segment
				 *  never changes the answer), laid out where nothing constrains
				 *  them: absolute, so out of the flex row and its gap, and a
				 *  column, so neither label shares a line with the other. A live
				 *  label cannot be measured instead — once the halves are equal
				 *  its box is the half, not the word. Invisible, untouchable and
				 *  hidden from assistive technology: it is a ruler, not copy. It comes
				 *  FIRST so it paints beneath the segments it measures, and the
				 *  transparency sits on each label itself, not on the wrapper:
				 *  the web audit's U-08 overlap check reads a node's OWN opacity,
				 *  and with it on the wrapper it counted the ruler as painted text
				 *  on top of the Agents segment. `selectable={false}` keeps the
				 *  duplicate labels out of a web text selection (PR #333 Q1-3). */}
				{largeText ? null : (
					<View
						aria-hidden
						pointerEvents="none"
						className="absolute start-0 top-0 items-start"
					>
						<Text
							className={cx(layout.label, "font-semibold text-ink opacity-0")}
							onLayout={fit.onAgentsLabelLayout}
							selectable={false}
						>
							{agentsLabel}
						</Text>
						<Text
							className={cx(layout.label, "font-semibold text-ink opacity-0")}
							onLayout={fit.onBridgeLabelLayout}
							selectable={false}
						>
							{bridgeLabel}
						</Text>
					</View>
				)}
				<Pressable
					testID={CONTROL.workspaceDrawerAgents}
					accessibilityRole={ROLE.button}
					accessibilityLabel={t("mobile.chrome.drawer.agents")}
					accessibilityState={a11yState({ selected: agentsSelected })}
					aria-selected={agentsSelected}
					onPress={() => onSelectMode("agents")}
					className={layout.segment}
					style={{ minHeight: TOUCH_FLOOR }}
				>
					{({ pressed }) => (
						<View
							className={cx(
								"flex-1 flex-row items-center justify-center rounded-sm border py-1",
								layout.content,
								agentsSelected
									? "border-hairline bg-elevated"
									: pressed
										? "border-transparent bg-row-hover"
										: "border-transparent bg-transparent",
							)}
						>
							<Text
								className={cx(
									layout.label,
									agentsSelected
										? "font-semibold text-ink"
										: pressed
											? "font-medium text-ink"
											: "font-medium text-ink-muted",
								)}
							>
								{t("mobile.chrome.drawer.agents")}
							</Text>
						</View>
					)}
				</Pressable>
				{/* LABEL AND COUNT ARE SEPARATE (Bridge UI brief §2). The
				 *  segment's visible text is the stable product name; the
				 *  adapter's `a11yLabel` — which may carry the count or
				 *  "unavailable" — is its accessible name only, so the
				 *  selector never grows an ever-longer label. The count is
				 *  its own badge and is drawn ONLY for a known, positive
				 *  number: `null` is unknown and a non-ready state has no
				 *  count to trust, and neither may paint as a zero. */}
				<View className={layout.segment}>
					<Pressable
						testID={CONTROL.workspaceDrawerTeamBridge}
						accessibilityRole={ROLE.button}
						accessibilityLabel={bridgeBadge.a11yLabel}
						accessibilityState={a11yState({ selected: bridgeSelected })}
						aria-selected={bridgeSelected}
						onPress={() => onSelectMode("team-bridge")}
						/* `flex-1` so the Pressable fills its stretched wrapper and
						 *  both segments paint the same height. */
						className="flex-1"
						style={{ minHeight: TOUCH_FLOOR }}
					>
						{({ pressed }) => (
							<View
								className={cx(
									"flex-1 flex-row items-center justify-center gap-1 rounded-sm border py-1",
									layout.content,
									bridgeSelected
										? "border-hairline bg-elevated"
										: pressed
											? "border-transparent bg-row-hover"
											: "border-transparent bg-transparent",
								)}
							>
								<Text
									className={cx(
										layout.label,
										bridgeSelected
											? "font-semibold text-ink"
											: pressed
												? "font-medium text-ink"
												: "font-medium text-ink-muted",
									)}
								>
									{t("mobile.team_bridge.title")}
								</Text>
								{showCount &&
								bridgeBadge.count !== null &&
								layout.badge === "inline" ? (
									<View aria-hidden pointerEvents="none">
										<Badge
											label={countLabel(bridgeBadge.count)}
											emphasis
											mono
											scale={effectiveScale}
										/>
									</View>
								) : null}
							</View>
						)}
					</Pressable>
					{/* Out of flow (U2-1/U2-2): a sibling of the Pressable, so it is
					 *  never part of the hit target's layout, and `pointerEvents
					 *  ="none"` so a tap on it still lands on the segment. The 2 pt
					 *  ring is the segment's own ground (`bg-elevated` selected,
					 *  the track's `bg-sunken` otherwise) so the pill reads as
					 *  lifted off its corner rather than fused to the edge. */}
					{showCount &&
					bridgeBadge.count !== null &&
					layout.badge === "overlay" ? (
						<View
							aria-hidden
							pointerEvents="none"
							className={cx(
								"absolute rounded-full border-2",
								bridgeSelected ? "border-elevated" : "border-sunken",
							)}
							style={MODE_BADGE_INSET}
						>
							<Badge
								label={countLabel(bridgeBadge.count)}
								emphasis
								mono
								scale={effectiveScale}
							/>
						</View>
					) : null}
				</View>
			</View>
			{onClose ? (
				<IconButton
					accessibilityLabel={t("mobile.chrome.close_conversations")}
					onPress={onClose}
					icon={({ color, size }) => <X color={color} size={size} />}
					testID={CONTROL.sidebarClose}
				/>
			) : null}
		</View>
	);
};
