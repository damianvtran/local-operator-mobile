/**
 * Team Bridge's side of the shared workspace drawer
 * (`WorkspaceDrawerBridgeAdapter`, `sessions/workspace-drawer.contract.ts`).
 *
 * WHY THIS EXISTS. The drawer footer used to carry Team Bridge as a marketing
 * block ("Team Bridge" over "Your organization, even with your computer
 * asleep"), then as an unlabelled icon. Neither read as a labelled place to go.
 * The shared drawer already owns a labelled Agents / Team Bridge mode switch;
 * it only appears when a Bridge adapter is supplied, and the root layout
 * supplied none. This module is that adapter (Bridge UI brief §2).
 *
 * CONSTRAINTS, each one deliberate:
 * - The drawer owns the ONE overlay, its focus return and its dismissal; this
 *   adapter only supplies content and a badge. It never opens a second modal
 *   and never nests the full route `Screen` (with its own header and back
 *   button) inside the drawer: the pane renders `BridgeDirectory`, the same
 *   list body the `/team-bridge` route renders.
 * - No mirrored store. Both the pane and the badge read the live Team Bridge
 *   store from `TeamBridgeProvider`; the adapter is recomputed from it.
 * - Switching modes is not navigation (contract). Only a row (or the profile
 *   card's "Message", or "Open Team Bridge") routes, and it calls the drawer's
 *   `onNavigate` FIRST so the panel dismisses before the destination opens.
 * - Unknown is not zero. Before the account-unread read lands, `totalUnread`
 *   is the initial 0, so the badge is `loading` with a `null` count; a gate
 *   that is not open is `unavailable`. The drawer paints a count only for a
 *   ready, known, positive number.
 * - Hub, not relay. Nothing here reads the relay connection: Team Bridge must
 *   stay reachable with every computer asleep, and while signed out the pane
 *   still offers the full screen (where sign-in lives).
 */
import { usePathname, useRouter } from "expo-router";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import { WorkspaceDrawerButton } from "@/features/sessions/workspace-drawer";
import type { WorkspaceDrawerBridgeAdapter } from "@/features/sessions/workspace-drawer.contract";
import { t } from "@/i18n";
import { useTeamBridgeState } from "@/team-bridge/provider";
import type { TeamBridgeState } from "@/team-bridge/store";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { gateHelp, gateTitle } from "./gate";
import { BridgeDirectory } from "./list-screen";
import { bridgeRouteDisposition } from "./profile-card";

type BadgeInputs = Pick<
	TeamBridgeState,
	"gate" | "unreadKnown" | "unreadFailed" | "totalUnread"
>;

/** The drawer's Bridge badge from live hub state. Pure, so every state is
 *  testable without a renderer. */
export function bridgeDrawerBadge({
	gate,
	unreadKnown,
	unreadFailed,
	totalUnread,
}: BadgeInputs): WorkspaceDrawerBridgeAdapter["bridgeBadge"] {
	if (gate === "checking" || (gate === "open" && !unreadKnown && !unreadFailed))
		return {
			count: null,
			state: "loading",
			a11yLabel: t("mobile.team_bridge.navigation.entry_loading"),
		};
	// A closed gate, or an open one whose first unread read failed: there is
	// no count to show and none is coming until a retry lands (R1-2).
	if (gate !== "open" || !unreadKnown)
		return {
			count: null,
			state: "unavailable",
			a11yLabel: t("mobile.team_bridge.navigation.entry_unavailable"),
		};
	return {
		count: totalUnread,
		state: "ready",
		a11yLabel: t("mobile.team_bridge.navigation.entry", {
			count: totalUnread,
		}),
	};
}

/** The pane shown when the drawer is in Team Bridge mode.
 *  `CONTROL.sidebarClose` lives on the shared `WorkspaceModeBar` at the top of
 *  the drawer, so this pane starts straight at the organization switcher
 *  without a redundant empty 52 pt close row. */
export function TeamBridgeDrawerPane({
	onNavigate,
}: {
	onNavigate: () => void;
	onClose: () => void;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const gate = useTeamBridgeState((s) => s.gate);
	return (
		<View className="min-h-0 flex-1" testID={SURFACE.teamBridgeDrawerPane}>
			{gate === "open" ? (
				/* `raised`: the drawer and the docked pane are `bg-elevated`, where
				 *  the canvas skeleton pair paints its bars in the ground's own
				 *  colour (review R1-2). */
				<BridgeDirectory onBeforeOpen={onNavigate} ground="raised" />
			) : (
				/* Not admitted (yet): say which state, and hand off to the full
				 * screen, which owns sign-in, plan and retry. Never a dead end, and
				 * never a relay requirement. */
				<View className="gap-3 px-4 py-4">
					<Text className="text-label font-semibold text-ink">
						{gateTitle(gate)}
					</Text>
					{/* The full screen's own explanation of this state, so the pane
					 *  says why before offering the way out — a signed-out heading
					 *  alone read as a mismatch with "Open" (UX U2/U3). Existing
					 *  copy, shared with `BridgeGate`. */}
					<Text className="text-body-sm text-ink-muted">{gateHelp(gate)}</Text>
					<View className="self-start">
						<Button
							label={t("mobile.team_bridge.navigation.open_hub")}
							variant="outline"
							size="sm"
							testID={CONTROL.teamBridgeDrawerOpen}
							onPress={() => {
								onNavigate();
								/* Replace, not push, when already on a Team Bridge route
								 *  (a thread showing its gate): the rows' own rule, so the
								 *  list never lands on top of a thread (R1-2 / U1-1). */
								if (bridgeRouteDisposition(pathname) === "replace")
									router.replace("/team-bridge" as never);
								else router.push("/team-bridge" as never);
							}}
						/>
					</View>
				</View>
			)}
		</View>
	);
}

/** The live adapter. Must render inside `TeamBridgeProvider`. */
export function useTeamBridgeDrawerAdapter(): WorkspaceDrawerBridgeAdapter {
	const gate = useTeamBridgeState((s) => s.gate);
	const unreadKnown = useTeamBridgeState((s) => s.unreadKnown);
	const unreadFailed = useTeamBridgeState((s) => s.unreadFailed);
	const totalUnread = useTeamBridgeState((s) => s.totalUnread);
	// The badge label is catalogue copy, so a language change must recompute
	// it: the locale is a memo dependency for that reason alone.
	const locale = useLocaleFrame();
	// Memoized so the provider's `bridgeAdapter` prop keeps its identity across
	// unrelated root re-renders; it changes only when the badge does (R1-4).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `locale` re-derives the translated label.
	return useMemo(
		() => ({
			bridgePane,
			bridgeBadge: bridgeDrawerBadge({
				gate,
				unreadKnown,
				unreadFailed,
				totalUnread,
			}),
		}),
		[gate, unreadKnown, unreadFailed, totalUnread, locale],
	);
}

/** Module-level, so the pane's element type never changes as the badge does:
 *  its scroll position and open sheets survive every unread update. */
const bridgePane: WorkspaceDrawerBridgeAdapter["bridgePane"] = (props) => (
	<TeamBridgeDrawerPane {...props} />
);

/**
 * The thread's leading control: the workspace drawer button in Team Bridge
 * mode. Also passed to `BridgeGate`, so a thread opened cold from a push or a
 * deep link leads with the same hamburger while admission is still checking,
 * rather than a back arrow into a list that is not under it.
 *
 * SWIPE-BACK. The session screen sets no `gestureEnabled` override and adds no
 * edge-swipe-to-drawer (`app/(app)/_layout.tsx` is one `Stack` with only
 * `headerShown: false`), so the bridge thread mirrors it exactly and keeps the
 * stack's default. The list is kept out from under the thread instead: every
 * open from a Team Bridge route REPLACES (`useOpenTarget`), so the thread's
 * back gesture returns to wherever Team Bridge was entered from (Home), never
 * to the channel list — the same place a session's back gesture goes.
 */
export function BridgeThreadDrawerButton() {
	return (
		<WorkspaceDrawerButton mode="team-bridge" testID={CONTROL.teamBridgeMenu} />
	);
}
