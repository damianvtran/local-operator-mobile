/** A replay has ONE work window and ONE persisted cleanup window. Fallback
 * cleanup consumes the remaining allowance; it never renews two minutes. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Deadline, ReplayRefused } from "./retirement-replay-core.ts";
import { REPLAY_POLICY } from "./retirement-replay-policy.ts";

const CAUSES = new Set(REPLAY_POLICY.failureCauses);
export function coarseCause(error: unknown) {
	return error instanceof ReplayRefused && CAUSES.has(error.code)
		? error.code
		: "other";
}
export class FirstFailure {
	cause: string | null = null;
	persisted = true;
	readonly root: string;
	constructor(root: string) {
		this.root = root;
		const file = join(root, "seed-first-failure.json");
		if (existsSync(file)) {
			const v = JSON.parse(readFileSync(file, "utf8"));
			this.cause = CAUSES.has(v.cause) ? v.cause : "other";
		}
	}
	remember(error: unknown) {
		if (this.cause !== null) return;
		this.cause = coarseCause(error);
		try {
			writeFileSync(
				join(this.root, "seed-first-failure.json"),
				JSON.stringify({ cause: this.cause }),
				{ flag: "wx", mode: 0o600, flush: true },
			);
		} catch (e) {
			this.persisted = false;
			if ((e as NodeJS.ErrnoException).code === "EEXIST")
				try {
					const old = JSON.parse(
						readFileSync(join(this.root, "seed-first-failure.json"), "utf8"),
					);
					this.cause = CAUSES.has(old.cause) ? old.cause : "other";
					this.persisted = true;
				} catch {
					/* Keep the original in-memory cause; never replace an existing receipt. */
				}
		}
	}
}
export function cleanupBudget(root: string, now = Date.now()): Deadline {
	const file = join(root, "cleanup-start.json");
	if (!existsSync(file))
		try {
			writeFileSync(file, JSON.stringify({ at: now, end: now + 120000 }), {
				flag: "wx",
				mode: 0o600,
				flush: true,
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	const value = JSON.parse(readFileSync(file, "utf8"));
	if (
		!Number.isFinite(value.at) ||
		!Number.isFinite(value.end) ||
		value.end !== value.at + 120000 ||
		value.at > now
	)
		throw new ReplayRefused("cleanup");
	return new Deadline(Math.max(0, Math.min(120000, value.end - now)));
}
export async function boundedWait<T>(
	promise: Promise<T>,
	deadline: Deadline,
	cap: number,
) {
	void promise.catch(() => undefined);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, no) => {
				timer = setTimeout(
					() => no(new ReplayRefused("deadline")),
					deadline.cap(cap),
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
export interface RunnerHandle {
	completion: Promise<void>;
	stop: (deadline: Deadline) => Promise<void>;
}
/** stop sets the latch synchronously, BEFORE cancellation or joining prepare.
 * Even an uncooperative prepare resolving after a timeout cannot launch later. */
export function managedRunner(
	prepare: () => Promise<void>,
	launch: () => RunnerHandle,
	cancelPrepare: () => Promise<void>,
): RunnerHandle {
	let stopped = false,
		actual: RunnerHandle | undefined,
		stopPromise: Promise<void> | undefined;
	const preparation = Promise.resolve().then(() => {
		if (stopped) throw new ReplayRefused("runner-stopped");
		return prepare();
	});
	const completion = preparation.then(() => {
		if (stopped) throw new ReplayRefused("runner-stopped");
		actual = launch();
		return actual.completion;
	});
	void completion.catch(() => undefined);
	return {
		completion,
		stop: (deadline) => {
			stopped = true;
			if (!stopPromise)
				stopPromise = (async () => {
					let first: unknown;
					try {
						await boundedWait(cancelPrepare(), deadline, deadline.cap(120000));
					} catch (e) {
						first = e;
					}
					try {
						await boundedWait(
							preparation.catch(() => undefined),
							deadline,
							deadline.cap(120000),
						);
					} catch (e) {
						first ??= e;
					}
					try {
						if (actual) await actual.stop(deadline);
					} catch (e) {
						first ??= e;
					}
					if (first) throw first;
				})();
			return stopPromise;
		},
	};
}
