/**
 * Amendment A §3's opening rule, wired to the phone's Team Bridge list
 * (review round 1, R1-3).
 *
 * WHAT IT DOES. When the Team Bridge list MOUNTS, once the hub's status and the
 * joined-communities read have both settled, it applies `openingRoute`
 * (`community/model.ts`, which defers to `openingSelection`, the desktop's
 * `resolveDefaultSelection` order rule for rule). A private answer leaves the
 * list alone (the Team Bridge store already selects that org); a community
 * answer REPLACES the list with that community's home, so Back from it goes
 * where the reader came from, not into a list that would redirect again.
 *
 * Two community answers exist: this app session's community (rule 2: a switch
 * "lasts until you switch back or restart the app"), and rule 7 — no private
 * org and no invitation, so a reader with only a community lands in it rather
 * than on the no-plan gate.
 *
 * SWITCHING BACK. Returning to the list from a community (Back pops to it) puts
 * the reader in front of a private org again, so on regaining focus the session
 * scope becomes that org: the switcher's single check then matches the screen.
 * A community's own Back with no history to pop mounts the list fresh; it sets
 * `holdOpening` first so this mount does not send the reader straight back.
 *
 * Flag off: nothing is read and nothing is decided (`communityEnabled`).
 */
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { communityEnabled } from "@/community/flag";
import { openingRoute } from "@/community/model";
import {
	useCommunity,
	useCommunityRows,
	useCommunityState,
} from "@/community/provider";
import { useTeamBridgeState } from "@/team-bridge/provider";
import { communityPath } from "./home-screen";

export function CommunityOpening(): null {
	const router = useRouter();
	const { actions, store } = useCommunity();
	const enabled = communityEnabled();
	const gate = useTeamBridgeState((s) => s.gate);
	const organizations = useTeamBridgeState((s) => s.organizations);
	const tenantId = useTeamBridgeState((s) => s.selectedTenantId);
	const communitiesState = useCommunityState((s) => s.communities.state);
	const rows = useCommunityRows();
	const session = useCommunityState((s) => s.session);
	/* null = not yet decided on this mount. A ref, so React's dev double-effect
	 * does not spend the one-shot hold twice. */
	const held = useRef<boolean | null>(null);
	const decided = useRef(false);
	useEffect(() => {
		if (!enabled || decided.current) return;
		if (held.current === null) held.current = actions.takeOpeningHold();
		if (held.current) {
			decided.current = true;
			return;
		}
		if (communitiesState === "idle") void actions.loadCommunities();
		const route = openingRoute({
			gate,
			organizations,
			communitiesState,
			communities: rows,
			session,
		});
		if (route.kind === "wait") return;
		decided.current = true;
		if (route.kind === "community")
			router.replace(communityPath(route.communityId) as never);
	}, [
		enabled,
		actions,
		gate,
		organizations,
		communitiesState,
		rows,
		session,
		router,
	]);
	useFocusEffect(
		useCallback(() => {
			/* Only once this mount decided to stay: before that, a session community
			 * is the INPUT the decision reads, not a stale scope to clear. */
			if (!enabled || !decided.current) return;
			/* Read, not subscribed: a pick made ON this list (the switcher's
			 * community row) must not be undone before its push lands. */
			if (store.getState().session?.kind !== "community") return;
			actions.select(tenantId ? { kind: "private", tenantId } : null);
		}, [enabled, actions, store, tenantId]),
	);
	return null;
}
