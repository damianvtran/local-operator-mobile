/**
 * PROVISIONAL local seam, replaced by the auth-lifecycle owner's module.
 *
 * It exists so this branch typechecks and its failure probes can run before that
 * commit lands. The published contract is exactly the four exports below; the
 * owner's implementation decides where the generation is minted and persisted.
 * Nothing here infers an account principal from a hostname, session list or
 * cookie: a scope is an opaque value minted by the auth owner and advanced
 * before any cleanup, so a late response can never write into a newer scope.
 */
export type StartupAuthorization = Readonly<{
	scope: string;
	revision: number;
}>;

let authorization: StartupAuthorization | null = null;
const listeners = new Set<() => void>();
const cleanups = new Set<() => Promise<void>>();

export function getStartupAuthorization(): StartupAuthorization | null {
	return authorization;
}

export function subscribeStartupAuthorization(
	listener: () => void,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Registered cleanup runs AFTER the getter reports `null`/a newer revision and
 * its storage is unreachable to new work. A failing cleanup is surfaced, never
 * reported as a completed privacy boundary.
 */
export function registerStartupAuthorizationCleanup(
	cleanup: () => Promise<void>,
): () => void {
	cleanups.add(cleanup);
	return () => {
		cleanups.delete(cleanup);
	};
}

/**
 * The auth owner calls this on an explicit sign-out, identity change or a `401`
 * policy boundary. The order is the guarantee: revoke synchronously, publish,
 * then let registered owners stop writing and purge.
 */
export async function retireStartupAuthorization(
	next: StartupAuthorization | null = null,
): Promise<void> {
	authorization = next;
	for (const listener of listeners) listener();
	const failures: unknown[] = [];
	for (const cleanup of cleanups) {
		try {
			await cleanup();
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length > 0)
		throw new AggregateError(
			failures,
			"authorization cleanup did not complete",
		);
}

/** The auth owner mints a scope for a newly admitted route. */
export function admitStartupAuthorization(next: StartupAuthorization): void {
	authorization = next;
	for (const listener of listeners) listener();
}
