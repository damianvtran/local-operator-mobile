import {
	accessTokenNeedsRefresh,
	type RadientTokens,
	refreshRadientTokens,
} from "./radient-oauth";

/** The refresher, plus the one lifecycle hook a sign-out needs. */
export type AccountRefresher = ((
	tokens: RadientTokens,
) => Promise<RadientTokens>) & {
	/** Drops cached rotations. Called on sign-out/revoke so a later session on the
	 * same process cannot join a rotation belonging to the previous one. */
	clear: () => void;
};

/** One account-refresh owner shared by restore, discovery and tunnel re-mint.
 * OAuth refresh may rotate a single-use handle. The short completed-result map
 * also joins a caller that read durable storage just before the first rotation
 * was persisted; deleting only an in-flight promise would spend the old handle
 * a second time. Tokens never leave memory here or define recovery authority.
 */
export function createRadientRefresher(
	refresh = refreshRadientTokens,
): AccountRefresher {
	const flights = new Map<string, Promise<RadientTokens>>();
	const completed = new Map<string, RadientTokens>();
	const refresher = (tokens: RadientTokens): Promise<RadientTokens> => {
		const key = `${tokens.account_id ?? ""}\0${tokens.refresh ?? tokens.access}`;
		const newer = completed.get(key);
		if (
			newer &&
			newer.access !== tokens.access &&
			!accessTokenNeedsRefresh(newer)
		)
			return Promise.resolve(newer);
		const input = newer ?? tokens;
		/* A cached rotation whose own access has expired is about to be SPENT by
		 * this attempt: its handle stops being one this process may hand to anyone
		 * else, so the entry goes before the request rather than after (review round
		 * 1, R1-M3). */
		if (newer) completed.delete(key);
		const running = flights.get(key);
		if (running) return running;
		const operation = refresh(input)
			.then((result) => {
				completed.set(key, result);
				if (completed.size > 4) {
					const oldest = completed.keys().next().value;
					if (oldest !== undefined) completed.delete(oldest);
				}
				return result;
			})
			.finally(() => flights.delete(key));
		flights.set(key, operation);
		return operation;
	};
	refresher.clear = () => {
		/* Flights in progress are deliberately NOT cancelled: the server may have
		 * rotated already, and dropping the response is how a handle is lost. Their
		 * results are still delivered to their own callers, which are fenced by the
		 * route they belong to. */
		completed.clear();
	};
	return refresher;
}
