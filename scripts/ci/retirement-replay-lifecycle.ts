/** A replay has ONE work window and ONE persisted cleanup window. Fallback
 * cleanup consumes the remaining allowance; it never renews two minutes. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Deadline, ReplayRefused } from "./retirement-replay-core.ts";
import { REPLAY_POLICY } from "./retirement-replay-policy.ts";
import type { RunnerTail } from "./retirement-replay-runner-tail.ts";

const CAUSES = new Set(REPLAY_POLICY.failureCauses);

/**
 * Simulator boot + readiness get their OWN clock, outside the 300s experiment.
 *
 * WHY. Replay 41768325986 timed out on a native command before openurl, with
 * 255.6s of the single shared 300s gone and no record of which command. A cold
 * simulator's `bootstatus -b` alone has measured past 90s on hosted runners (run
 * 41523920765), so the proof harness gives boot readiness its own budget. This
 * value MIRRORS `BOOT_READY_BUDGET_MS` in auth-retirement-ios-proof.ts (a test
 * pins the two equal) rather than inventing a number. The experiment's 300s
 * work clock and 120s cleanup are unchanged: they resume after boot with exactly
 * the time that was left before boot began. Nothing asserted gets weaker.
 */
export const REPLAY_BOOT_BUDGET_MS = 300000;

/** Coarse, allowlisted phase names: the receipt names WHERE a run stopped
 * without exporting any command line, path, udid or token. */
export const REPLAY_PHASES = [
	"create",
	"boot",
	"bootstatus",
	"install",
	// Was one `runner-bootstrap` phase; split so a receipt names WHICH runner
	// command failed (python prepare vs xcodebuild launch).
	"runner-prepare",
	"runner-launch",
	"launch",
	"ready",
	"openurl",
] as const;
export type ReplayPhase = (typeof REPLAY_PHASES)[number];
export interface PhaseRecord {
	name: ReplayPhase;
	elapsedMs: number;
	status: "ok" | "failed";
}
/**
 * Per-phase timing receipt. Diagnostic only: it never decides pass/fail. The
 * first phase that throws is `failed`; later phases are never recorded.
 */
export class PhaseLog {
	readonly phases: PhaseRecord[] = [];
	failed: ReplayPhase | null = null;
	readonly clock: () => number;
	constructor(clock: () => number = () => performance.now()) {
		this.clock = clock;
	}
	async step<T>(name: ReplayPhase, work: () => Promise<T>): Promise<T> {
		const started = this.clock();
		try {
			const value = await work();
			this.phases.push({
				name,
				elapsedMs: Math.round(this.clock() - started),
				status: "ok",
			});
			return value;
		} catch (error) {
			this.phases.push({
				name,
				elapsedMs: Math.round(this.clock() - started),
				status: "failed",
			});
			this.failed ??= name;
			throw error;
		}
	}
}
/**
 * Run the boot phases under the boot clock. A timeout here is reported as
 * `boot-timeout` (with its phase in the PhaseLog), never as a work-clock
 * `command-timeout`, so the two budgets cannot be confused in a receipt.
 */
export async function bootPhase<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (
			error instanceof ReplayRefused &&
			(error.code === "command-timeout" || error.code === "deadline")
		)
			throw new ReplayRefused("boot-timeout");
		throw error;
	}
}
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
	/**
	 * Resolves when the private configuration is prepared and the XCTest
	 * command has been launched; rejects if preparation fails. Lets the phase
	 * receipt tell `runner-prepare` from `runner-launch` (replay 41801686399
	 * could not). Absent on handles that have no separate preparation.
	 */
	prepared?: Promise<void>;
	/** Sanitized failure tail of the XCTest command (nonzero exit only). */
	failureTail?: (replayFailed?: boolean) => RunnerTail | null;
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
	const launched = preparation.then(() => {
		if (stopped) throw new ReplayRefused("runner-stopped");
		actual = launch();
	});
	void launched.catch(() => undefined);
	const completion = launched.then(() => actual!.completion);
	void completion.catch(() => undefined);
	return {
		completion,
		prepared: launched,
		failureTail: (replayFailed) => actual?.failureTail?.(replayFailed) ?? null,
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
