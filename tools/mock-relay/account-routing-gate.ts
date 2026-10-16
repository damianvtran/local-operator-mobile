/** Owned fixture response lease, never a runtime routing/account lease.
 * A real UI form switch is not timed by a guessed sleep. Release the queued
 * response AFTER B is observed; expiry returns a fixture503, not an unhandled
 * HTTP rejection that would skip exact-process cleanup.
 */
export function createResponseGate() {
	const held = new Set<(completed: boolean) => void>();
	return {
		get pending() {
			return held.size;
		},
		wait() {
			return new Promise<boolean>((done) => {
				const finish = (completed: boolean) => {
					clearTimeout(timer);
					held.delete(finish);
					done(completed);
				};
				const timer = setTimeout(() => finish(false), 90000);
				held.add(finish);
			});
		},
		release() {
			for (const finish of [...held]) finish(true);
		},
	};
}
