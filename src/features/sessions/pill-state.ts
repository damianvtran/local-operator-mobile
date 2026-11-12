import type { StreamHealth } from "@/features/auth/connection-provider";

/**
 * The list's connection pill state, from the stream's own status. A stale list
 * reads as degraded even while the socket looks open: what the reader has is old.
 *
 * Its own module (it was private to `conversations-pane.tsx`) so the provider
 * tests can assert what the pill RENDERS through a resume, not just the raw
 * health (PR #246 Q1-2: a "not degraded" assertion passed while the pill was a
 * red Offline). No React Native import, so a Node test can load it.
 */
export function pillState(
	health: StreamHealth,
	stale: boolean,
): "connected" | "reconnecting" | "offline" | "degraded" {
	if (stale) return "degraded";
	if (health === "connecting") return "reconnecting";
	if (health === "offline") return "offline";
	if (health === "degraded") return "degraded";
	return "connected";
}
