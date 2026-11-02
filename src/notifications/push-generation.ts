/**
 * Durable monotonic incarnations for hub device writes. A local clock can move
 * backwards and native callbacks can race, so reserve against persisted state
 * in a serial queue before emitting any request. Failed persistence never yields
 * an incarnation that an outgoing mutation could use.
 */
export function createPushGeneration(deps: {
	read: () => Promise<number | undefined>;
	write: (generation: number) => Promise<void>;
	now?: () => number;
}) {
	let tail = Promise.resolve();
	return () => {
		const work = tail.then(async () => {
			const previous = await deps.read();
			const held =
				typeof previous === "number" &&
				Number.isSafeInteger(previous) &&
				previous >= 0
					? previous
					: 0;
			const next = Math.max(held + 1, (deps.now ?? Date.now)());
			if (!Number.isSafeInteger(next))
				throw new Error("Device incarnation exhausted");
			await deps.write(next);
			return next;
		});
		tail = work.then(
			() => undefined,
			() => undefined,
		);
		return work;
	};
}
