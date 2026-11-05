import {
	accessTokenNeedsRefresh,
	type RadientTokens,
	refreshRadientTokens,
} from "./radient-oauth";

/** One account-refresh owner shared by restore, discovery and tunnel re-mint.
 * OAuth refresh may rotate a single-use handle. The short completed-result map
 * also joins a caller that read durable storage just before the first rotation
 * was persisted; deleting only an in-flight promise would spend the old handle
 * a second time. Tokens never leave memory here or define recovery authority.
 */
export function createRadientRefresher(refresh = refreshRadientTokens) {
	const flights = new Map<string, Promise<RadientTokens>>();
	const completed = new Map<string, RadientTokens>();
	return (tokens: RadientTokens): Promise<RadientTokens> => {
		const key = `${tokens.account_id ?? ""}\0${tokens.refresh ?? tokens.access}`;
		const newer = completed.get(key);
		if (
			newer &&
			newer.access !== tokens.access &&
			!accessTokenNeedsRefresh(newer)
		)
			return Promise.resolve(newer);
		const input = newer ?? tokens;
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
}
