import type { RadientTokens, TunnelSession } from "@/connection";
import { accessTokenNeedsRefresh, handleExpired } from "@/connection";

/**
 * What a cold start should do with the credentials it finds.
 *
 * The decisions live here, as data, rather than inline in the provider's effect, for
 * one reason: they are the part of R3-3 that a reader can get WRONG SILENTLY. A
 * restore that trusts a stale token looks identical to one that verified it until the
 * first refused request, and "the reader is signed out" versus "the reader must sign
 * in again" is a copy difference nobody sees in a diff. Here each case is a value a
 * test can name, and `connection-provider.tsx` only carries them out.
 *
 * `now` is a parameter rather than `Date.now()` inside, so a case is expressible —
 * and so the one expiry comparison per concern stays the connection layer's
 * (`accessTokenNeedsRefresh`, `handleExpired`), never a second one written here.
 */

export type RestorePlan =
	/** Nothing stored: a first run, and the welcome surface is the honest one. */
	| { kind: "none" }
	/** A grant that is still good: go straight to discovery. */
	| { kind: "adopt"; tokens: RadientTokens }
	/** Past `expires_at` but renewable: refresh with the rolling token, then discover. */
	| { kind: "refresh"; tokens: RadientTokens }
	/** Its grant lapsed with no refresh token to renew it: the record goes and the reader is told, because only a browser hand-off can fetch another. */
	| { kind: "discard" };

export function planRestore(
	tokens: RadientTokens | null,
	now: number = Date.now(),
): RestorePlan {
	if (tokens === null) return { kind: "none" };
	/* `expires_at` already carries the skew, so this is the whole expiry check. */
	if (!accessTokenNeedsRefresh(tokens, now)) return { kind: "adopt", tokens };
	/* Expired with no refresh token is the one shape nothing here can fix: a browser
	 *  hand-off is the only way back, so the record is discarded rather than retried
	 *  on every launch forever. */
	if (tokens.refresh === null) return { kind: "discard" };
	return { kind: "refresh", tokens };
}

/**
 * The stored tunnel session, if it may be adopted for this computer — else `null`.
 *
 * Both halves are load-bearing and both are failure modes the round names:
 *
 *  - a handle past its ABSOLUTE life (`handleExpired`) cannot be refreshed, so the
 *    session must not be adopted and the reader must be sent through discovery;
 *  - a session minted for ANOTHER tunnel would authenticate against the wrong
 *    machine, which is the one thing a stored session must never be able to do.
 *
 * `hostname` and `tunnelId` are checked together rather than either alone: they are
 * two names for the same computer, and a record holding one of each from different
 * mints is a record nothing here should trust.
 */
export function adoptableSession(
	session: TunnelSession | null,
	computer: { tunnelId: string; hostname: string },
	now: number = Date.now(),
): TunnelSession | null {
	if (session === null) return null;
	/* `handleExpired` takes a CLOCK, not an instant: the connection layer owns the one
	 *  expiry comparison for the handle, so this hands it the clock rather than
	 *  re-deriving the boundary here. */
	if (handleExpired(session, () => now)) return null;
	if (session.tunnelId !== computer.tunnelId) return null;
	if (session.hostname !== computer.hostname) return null;
	return session;
}
