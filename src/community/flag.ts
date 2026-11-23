/**
 * Whether this build shows the public community surfaces at all.
 *
 * WHY A BUILD FLAG, DEFAULT OFF. The Local Operator Community ships DARK until
 * the staff pilot (RFC v2.4 §11, "Rollout, release gates and rollback"): the
 * server deployment is gated by `COMMUNITY_API_ENABLED`, and a client that
 * offered "Join the Local Operator Community" before that would only ever reach
 * a 404. The app has no remote flag service, so the switch is the same kind the
 * Team Bridge web fixtures use: an `EXPO_PUBLIC_*` value inlined at bundle
 * time. Nothing reads it at runtime from storage or a server, so a production
 * build cut without it can never show the surface.
 *
 * Off means: no Communities group in the org switcher, no community join on
 * the no-plan screen, and no `/community/*` route accepts a visit (each route
 * renders the not-found state). Private Team Bridge is unchanged either way.
 */
export function communityEnabled(): boolean {
	return process.env.EXPO_PUBLIC_COMMUNITY === "1";
}
