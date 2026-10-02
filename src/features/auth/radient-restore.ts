import type { RadientTokens, TunnelSession } from "@/connection";
import {
	accessTokenNeedsRefresh,
	handleExpired,
	RadientAuthError,
} from "@/connection";

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

/**
 * A restore that did NOT end signed in, as the reader's copy and the surface it
 * belongs on.
 *
 * It is returned rather than written to the store so this module stays free of
 * React and the store: `connection-provider.tsx` carries it out, and the two
 * failure arms below are the whole point of the type — they are different facts
 * that a bare `catch` made identical.
 */
export type RestoreRefusal = {
	/** `sign-in`: the grant itself is gone and only a browser hand-off replaces it.
	 *  `retry`: nothing was learned about the grant, so it must NOT be thrown away. */
	surface: "sign-in" | "retry";
	message: string;
};

/** The reader is TOLD their session lapsed, rather than quietly treated as a
 *  first run: an expired session and a first run are different facts. */
export const RESTORE_EXPIRED_MESSAGE = "Your Radient session expired.";

/** The same sentence `discoverComputers`' `unreachable` arm publishes, because it
 *  is the same fault reported one step earlier. */
export const RESTORE_UNREACHABLE_MESSAGE =
	"Radient could not be reached. Check this device's connection.";

/** Everything the carrying-out touches outside itself. Injected so the whole
 *  restore — the writes, the deletes, the landing flag — is a unit test's subject
 *  rather than only a frame's (review round 4, m1: both majors lived in this
 *  untested band). */
export interface RestoreDeps {
	readOauth: () => Promise<RadientTokens | null>;
	writeOauth: (tokens: RadientTokens) => Promise<void>;
	clearOauth: () => Promise<void>;
	refresh: (tokens: RadientTokens) => Promise<RadientTokens>;
	/** Runs discovery with the accepted grant. Called ONLY when a credential was
	 *  accepted, which is where a caller sets its "signed in" landing flag. */
	discover: (tokens: RadientTokens) => Promise<void>;
	/** True once the caller is no longer interested (it unmounted). Checked after
	 *  the storage read and before discovery, never in the middle of a write. */
	isCancelled?: () => boolean;
}

export type RestoreOutcome = {
	/** The grant now usable, or `null` when the restore ended signed out. */
	tokens: RadientTokens | null;
	/** True when the credential was accepted and discovery was started. */
	restored: boolean;
	refusal: RestoreRefusal | null;
};

/**
 * Carries out what `planRestore` decided.
 *
 * **The one rule this function exists to get right.** A refresh can fail two
 * different ways and only one of them justifies deleting the credential:
 *
 *  - the server REFUSED the grant (`invalid_grant`, or an answer this build
 *    cannot read) — only a browser hand-off replaces it, so the record goes and
 *    the reader is told;
 *  - NO ANSWER ARRIVED (a `network` failure) — nothing is known about the grant,
 *    so the stored refresh token is left exactly as it is and the reader is
 *    offered a retry.
 *
 * The bare `catch` this replaces treated the two alike and called `clearOauth()`
 * for both, so an ordinary offline cold start with a lapsed access token DESTROYED
 * a still-valid rolling refresh token — the one thing this path exists to keep —
 * and told the reader their session had expired when nothing had. The sibling
 * `refreshComputers` already models the distinction (its `unreachable` arm keeps
 * the credential; only `unauthorized` deletes).
 */
export async function carryOutRestore(
	deps: RestoreDeps,
): Promise<RestoreOutcome> {
	const plan = planRestore(await deps.readOauth());
	if (plan.kind === "none" || deps.isCancelled?.() === true) {
		return { tokens: null, restored: false, refusal: null };
	}

	const expired = async (): Promise<RestoreOutcome> => {
		await deps.clearOauth();
		return {
			tokens: null,
			restored: false,
			refusal: { surface: "sign-in", message: RESTORE_EXPIRED_MESSAGE },
		};
	};

	/* Stored, lapsed, and with nothing to renew it: only a browser hand-off can get
	 *  another grant, so the record goes rather than being retried forever. */
	if (plan.kind === "discard") return expired();

	let tokens = plan.tokens;
	if (plan.kind === "refresh") {
		try {
			tokens = await deps.refresh(tokens);
			await deps.writeOauth(tokens);
		} catch (error) {
			if (isUnreachable(error)) {
				/* The credential is NOT deleted and nothing is written: there is nothing
				 *  here the reader has to fix, and the next launch — or the retry this
				 *  offers — is the thing that clears it. */
				return {
					tokens: null,
					restored: false,
					refusal: {
						surface: "retry",
						message: RESTORE_UNREACHABLE_MESSAGE,
					},
				};
			}
			return expired();
		}
	}

	if (deps.isCancelled?.() === true) {
		return { tokens: null, restored: false, refusal: null };
	}
	await deps.discover(tokens);
	return { tokens, restored: true, refusal: null };
}

/** Whether a refresh failure says anything at all about the GRANT. `network` is
 *  the one that does not: the request never produced an answer, so the refresh
 *  token is exactly as valid as it was before the attempt. */
function isUnreachable(error: unknown): boolean {
	return error instanceof RadientAuthError && error.failure === "network";
}
