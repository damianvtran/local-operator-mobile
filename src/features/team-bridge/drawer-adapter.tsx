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
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { Text, View } from "react-native";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import type { WorkspaceDrawerBridgeAdapter } from "@/features/sessions/workspace-drawer.contract";
import { t } from "@/i18n";
import { useTeamBridgeState } from "@/team-bridge/provider";
import type { TeamBridgeState } from "@/team-bridge/store";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { IconButton } from "@/ui/components/icon-button";
import { gateTitle } from "./gate";
import { BridgeDirectory } from "./list-screen";

type BadgeInputs = Pick<
	TeamBridgeState,
	"gate" | "unreadKnown" | "totalUnread"
>;

/** The drawer's Bridge badge from live hub state. Pure, so every state is
 *  testable without a renderer. */
export function bridgeDrawerBadge({
	gate,
	unreadKnown,
	totalUnread,
}: BadgeInputs): WorkspaceDrawerBridgeAdapter["bridgeBadge"] {
	if (gate === "checking" || (gate === "open" && !unreadKnown))
		return {
			count: null,
			state: "loading",
			a11yLabel: t("mobile.team_bridge.navigation.entry_loading"),
		};
	if (gate !== "open")
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

/** The pane shown when the drawer is in Team Bridge mode. */
export function TeamBridgeDrawerPane({
	onNavigate,
	onClose,
}: {
	onNavigate: () => void;
	onClose: () => void;
}) {
	const router = useRouter();
	const gate = useTeamBridgeState((s) => s.gate);
	return (
		<View className="min-h-0 flex-1" testID={SURFACE.teamBridgeDrawerPane}>
			{/* The Agents pane carries its own visible close; this pane replaces it,
			 *  so it keeps one too — the scrim is not reachable by every reader. */}
			<View className="flex-row justify-end px-2">
				<IconButton
					accessibilityLabel={t("mobile.chrome.close_conversations")}
					onPress={onClose}
					icon={({ color, size }) => <X color={color} size={size} />}
					testID={CONTROL.sidebarClose}
				/>
			</View>
			{gate === "open" ? (
				<BridgeDirectory onBeforeOpen={onNavigate} />
			) : (
				/* Not admitted (yet): say which state, and hand off to the full
				 * screen, which owns sign-in, plan and retry. Never a dead end, and
				 * never a relay requirement. */
				<View className="gap-4 px-4 py-6">
					<Text className="text-body text-ink-muted">{gateTitle(gate)}</Text>
					<Button
						label={t("mobile.team_bridge.navigation.open_hub")}
						variant="outline"
						testID={CONTROL.teamBridgeDrawerOpen}
						onPress={() => {
							onNavigate();
							router.push("/team-bridge" as never);
						}}
					/>
				</View>
			)}
		</View>
	);
}

/** The live adapter. Must render inside `TeamBridgeProvider`. */
export function useTeamBridgeDrawerAdapter(): WorkspaceDrawerBridgeAdapter {
	const gate = useTeamBridgeState((s) => s.gate);
	const unreadKnown = useTeamBridgeState((s) => s.unreadKnown);
	const totalUnread = useTeamBridgeState((s) => s.totalUnread);
	// Subscribed for its re-render only: the badge label is catalogue copy, so
	// a language change must recompute it.
	useLocaleFrame();
	return {
		bridgePane,
		bridgeBadge: bridgeDrawerBadge({ gate, unreadKnown, totalUnread }),
	};
}

/** Module-level, so the pane's element type never changes as the badge does:
 *  its scroll position and open sheets survive every unread update. */
const bridgePane: WorkspaceDrawerBridgeAdapter["bridgePane"] = (props) => (
	<TeamBridgeDrawerPane {...props} />
);
