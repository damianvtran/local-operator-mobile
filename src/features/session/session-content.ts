import type { SessionRelaySource } from "./relay-source";

/** A store entry alone is not proof of identity: the process cache can outlive
 * a screen, route switch, or sign-out. Only a real frame observed for this exact
 * route revision/computer/session may authorize retaining its transcript. */
export interface ProjectionOwner {
	revision: number;
	tunnelId: string | null;
	sessionId: string;
}

export const sameProjectionOwner = (
	left: ProjectionOwner | null,
	right: ProjectionOwner,
): boolean =>
	left !== null &&
	left.revision === right.revision &&
	left.tunnelId === right.tunnelId &&
	left.sessionId === right.sessionId;

/** Admission controls requests, not the existence of already received rows.
 * Expiry keeps owned rows and the genuine refusal; a refusal before any frame
 * needs recovery, never the invitation to start an empty conversation. */
export const sessionContent = (
	reason: SessionRelaySource["reason"],
	ownsProjection: boolean,
	hasError = false,
): "disconnected" | "loading" | "recovery" | "transcript" => {
	if (reason === "no-route") return "disconnected";
	if (ownsProjection) return "transcript";
	if (reason === "pending") return "loading";
	if (reason === "refused" || hasError) return "recovery";
	return "loading";
};
