/**
 * Pin push cleanup to an ACCOUNT, not to an access-token string that expires.
 * The retirement accessor can refresh without joining the durable-clear queue
 * (which is currently waiting for cleanup). A replacement sign-in must never
 * lend its bearer to the previous account's DELETE.
 */
import { accountIdFromToken } from "@/connection/radient-identity";

function unexpired(token: string): boolean {
	try {
		const part = token.split(".")[1];
		if (!part) return false;
		const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
		const claims = JSON.parse(
			atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4)),
		) as { exp?: unknown };
		return typeof claims.exp === "number" && claims.exp * 1000 > Date.now();
	} catch {
		return false;
	}
}

/** A same-account fresh grant, or still-valid original grant during replacement. */
export function retirementAccessForAccount(
	original: string,
	refresh: (options?: {
		force?: boolean;
		accountId?: string;
	}) => Promise<string | null>,
) {
	const owner = accountIdFromToken(original);
	let held = original;
	return async (options?: { force?: boolean }): Promise<string | null> => {
		if (!owner) return null;
		// The raw accessor checks this owner before any forced refresh transport,
		// not merely before returning a bearer to the HTTP client.
		const current = await refresh({ ...options, accountId: owner });
		if (current && accountIdFromToken(current) === owner) {
			held = current;
			return current;
		}
		// A newer login owns the normal credential store. Its bearer is not ours;
		// an unexpired old grant may still remove the old row, never a stale one.
		return unexpired(held) ? held : null;
	};
}
