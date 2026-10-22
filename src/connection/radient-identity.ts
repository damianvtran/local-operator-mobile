/**
 * The subject claim of a Radient access token: the caller's account id.
 *
 * WHY DECODE THE TOKEN. The hub's status payload carries no account id, and the
 * thread needs one to tell "mine" from "theirs" (alignment, a DM's title, the
 * People row marked "you"). The access token's `sub` IS the account id the hub
 * authorizes every request against (agent-server `auth_service.go`), so reading
 * it is reading the same identity, not inventing one. The signature is not
 * checked here because nothing is AUTHORIZED by this value: it only decides
 * which side of the thread a bubble sits on.
 */

/**
 * Display-only account identity from the OAuth subject, never an authorization
 * decision. Both auth lifetime and hub state use one decoder so replacing an
 * account disowns its cached messages even when signed-in remains true.
 */
export function accountIdFromToken(token: string | null): string | null {
	if (!token) return null;
	const part = token.split(".")[1];
	if (!part) return null;
	try {
		const padded = part.replace(/-/g, "+").replace(/_/g, "/");
		const json =
			typeof atob === "function"
				? atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
				: Buffer.from(padded, "base64").toString("utf8");
		const claims = JSON.parse(json) as { sub?: unknown };
		return typeof claims.sub === "string" && claims.sub.length > 0
			? claims.sub
			: null;
	} catch {
		return null;
	}
}
