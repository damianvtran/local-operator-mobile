import {
	type BadgeSource,
	clearBadgeSource,
	setBadgeSource,
} from "@/notifications/app-badge";
import type { TeamBridgeState } from "@/team-bridge/store";

/**
 * Team Bridge's contribution to the app icon badge (`src/notifications/app-badge.ts`
 * owns the badge; this only decides what Team Bridge reports).
 *
 * The number is the hub's account-wide unread total — the same read the drawer's
 * Bridge badge paints (`refreshUnread`), so the icon and the in-app count agree.
 * Muted conversations are already excluded by the hub; `mention` ones still count,
 * matching the hub's own unread rule.
 */
export const TEAM_BRIDGE_BADGE: BadgeSource = "teamBridge";

/**
 * Pure: what one store state says about the badge.
 *  - a number  → report it;
 *  - `"clear"` → this account can no longer see Bridge (signed out, or no plan):
 *    the badge must not keep claiming messages the reader cannot open;
 *  - `null`    → nothing known (first read in flight, a failed read, a transient
 *    `unavailable`/`update_required` gate): leave the last number standing.
 */
export function teamBridgeBadge(
	state: Pick<TeamBridgeState, "gate" | "unreadKnown" | "totalUnread">,
): number | "clear" | null {
	if (state.gate === "signed_out" || state.gate === "plan_required")
		return "clear";
	if (state.unreadKnown) return state.totalUnread;
	return null;
}

/** Apply one decision to the badge owner. */
export function applyTeamBridgeBadge(
	decision: number | "clear" | null,
): Promise<void> | undefined {
	if (decision === null) return undefined;
	return decision === "clear"
		? clearBadgeSource(TEAM_BRIDGE_BADGE)
		: setBadgeSource(TEAM_BRIDGE_BADGE, decision);
}

/**
 * Follow a store: apply the current decision now and on every change that moves
 * it. Returns the unsubscribe. The provider calls `clearBadgeSource` itself on
 * teardown (account switch), because a store that is merely retired never
 * publishes the reset state that would clear it.
 */
export function followTeamBridgeBadge(store: {
	getState(): TeamBridgeState;
	subscribe(listener: (state: TeamBridgeState) => void): () => void;
}): () => void {
	let last = teamBridgeBadge(store.getState());
	void applyTeamBridgeBadge(last);
	return store.subscribe((state) => {
		const next = teamBridgeBadge(state);
		if (next === last) return;
		last = next;
		void applyTeamBridgeBadge(next);
	});
}
