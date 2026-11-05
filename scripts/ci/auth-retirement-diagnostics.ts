/** Deliberately lossy diagnostics: no exception messages, command arguments,
 * stdout/stderr, URLs, paths, tokens or arbitrary labels enter this receipt.
 * A first failure is immutable across cleanup so recovery cannot mask its cause.
 * This is an evidence repair, NOT a native retirement root-cause fix. */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sanitizePhaseFailure } from "./auth-retirement-phase-diagnostics.ts";

import {
	COMMAND_CATEGORIES,
	type PhaseTiming,
	type SetupTiming,
	sanitizeProgress,
	TIMING_PHASES,
	writeEvidenceAtomic,
	writeProgressAtomic,
} from "./auth-retirement-progress.ts";

const CHECKPOINTS = [
	"step-ceiling",
	"scheme-unregistered",
	"preflight",
	"candidate-identity",
	"template-selection",
	"creation-intent",
	"create",
	"boot",
	"boot-ready",
	"install",
	"receiver-setup",
	"phase",
	"cleanup",
	"complete",
] as const;
const PHASES = TIMING_PHASES;
const CATEGORIES = COMMAND_CATEGORIES;
type Category = (typeof CATEGORIES)[number];
type Outcome =
	| "success"
	| "nonzero-exit"
	| "timeout"
	| "start-failure"
	| "output-cap"
	| "journal-failure";
/** All times are monotonic host CALLBACK observations, not kernel timestamps. */
export interface CommandLifecycle {
	budgetMs: number;
	exitAfterMs: number | null;
	closeAfterMs: number | null;
	timerAfterMs: number | null;
	stdoutEndAfterMs: number | null;
	stderrEndAfterMs: number | null;
	exitCode: number | null;
	exitSignal: "SIGTERM" | "SIGKILL" | "other" | null;
	killResult: "not-attempted" | "sent" | "already-gone" | "denied" | "other";
}
const observedTime = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
function safeLifecycle(l: CommandLifecycle): CommandLifecycle {
	return {
		budgetMs: observedTime(l.budgetMs) ?? 0,
		exitAfterMs: observedTime(l.exitAfterMs),
		closeAfterMs: observedTime(l.closeAfterMs),
		timerAfterMs: observedTime(l.timerAfterMs),
		stdoutEndAfterMs: observedTime(l.stdoutEndAfterMs),
		stderrEndAfterMs: observedTime(l.stderrEndAfterMs),
		exitCode:
			Number.isSafeInteger(l.exitCode) &&
			Number(l.exitCode) >= 0 &&
			Number(l.exitCode) <= 255
				? l.exitCode
				: null,
		exitSignal:
			l.exitSignal === "SIGTERM" || l.exitSignal === "SIGKILL"
				? l.exitSignal
				: l.exitSignal
					? "other"
					: null,
		killResult: ["not-attempted", "sent", "already-gone", "denied"].includes(
			l.killResult,
		)
			? l.killResult
			: "other",
	};
}
export interface CommandObservation {
	lifecycle?: CommandLifecycle;
	category: Category;
	outcome: Outcome;
	exitCode: number | null;
	signal: "SIGTERM" | "SIGKILL" | "other" | null;
	elapsedMs: number;
	sequence: number;
}
export function commandCategory(
	executable: string,
	args: readonly string[],
): Category {
	const name = executable.split(/[\\/]/).pop();
	if (name === "plutil") return "artifact-metadata";
	if (name === "git") return "source-identity";
	if (name === "xcrun" && args[0] === "simctl") {
		const op = args[1];
		if (op === "list") return "inventory";
		if (op === "get_app_container") return "installed-app";
		if (
			[
				"create",
				"boot",
				"bootstatus",
				"install",
				"launch",
				"openurl",
				"shutdown",
				"delete",
			].includes(op ?? "")
		)
			return op as Category;
	}
	if (name === "node" || name === "node.exe") return "local-process";
	return "unknown";
}
export class ProofDiagnostics {
	private readonly started = performance.now();
	private checkpointName: (typeof CHECKPOINTS)[number] = "preflight";
	private phaseName: (typeof PHASES)[number] | null = null;
	private sequence = 0;
	private lastCommand: CommandObservation | null = null;
	private failed = false;
	private readonly setupTimings: Partial<Record<SetupTiming, number>> = {};
	private readonly phaseTimings: PhaseTiming[] = [];
	private phaseCurrent: {
		phase: PhaseTiming["phase"];
		started: number;
	} | null = null;
	private readonly commandTimings: Partial<
		Record<Category, { count: number; totalMs: number; maxMs: number }>
	> = {};

	private phaseFailureObservation: Record<string, unknown> | null = null;
	private readonly root: string;
	constructor(root: string) {
		// This module is also loaded directly by Node's native type stripping;
		// parameter properties would break the verifier before it can report.
		this.root = root;
		mkdirSync(root, { recursive: true });
	}
	progressSnapshot() {
		return sanitizeProgress({
			setupTimings: this.setupTimings,
			phases: this.phaseTimings,
			commandTimings: this.commandTimings,
			cumulativeElapsedMs: performance.now() - this.started,
		});
	}
	flushProgress(): void {
		writeProgressAtomic(this.root, this.progressSnapshot());
	}
	setSetupTiming(key: SetupTiming, value: number): void {
		if (Number.isFinite(value) && value >= 0)
			this.setupTimings[key] = Math.round(value);
		this.flushProgress();
	}
	beginPhase(name: unknown): void {
		const phase = PHASES.find((value) => value === name);
		if (!phase || this.phaseCurrent)
			throw new Error("Invalid phase timing boundary");
		this.checkpoint("phase", phase);
		this.phaseCurrent = { phase, started: performance.now() };
		this.flushProgress();
	}
	finishPhase(
		outcome: "passed" | "failed" | "interrupted",
	): PhaseTiming | undefined {
		if (!this.phaseCurrent) return;
		const row = {
			phase: this.phaseCurrent.phase,
			elapsedMs: Math.round(
				Math.max(0, performance.now() - this.phaseCurrent.started),
			),
			outcome,
		};
		this.phaseTimings.push(row);
		this.phaseCurrent = null;
		this.flushProgress();
		return row;
	}
	/** Signal receipt only. No cleanup, reaping, SDK command or async boundary.
	 * A manual cancel and step timeout share signals; GitHub conclusion decides. */
	recordStepCeiling(signal: "SIGINT" | "SIGTERM"): void {
		// Preserve the killed phase's observed monotonic duration, not just the
		// completed prefix. Clearing phaseCurrent also prevents duplicate rows.
		this.finishPhase("interrupted");
		const snapshot = this.progressSnapshot();
		if (!this.failed) {
			this.checkpointName = "step-ceiling";
			this.phaseFailureObservation = sanitizePhaseFailure({
				cause: "step-ceiling",
				phase: this.phaseName,
				signal,
				...snapshot,
			});
			this.fail();
		} else {
			// Refresh timing evidence ONLY: the first caught error/checkpoint/cause
			// remains authoritative even when a later stop interrupts its unwind.
			const first = JSON.parse(
				readFileSync(join(this.root, "failure.json"), "utf8"),
			);
			writeEvidenceAtomic(this.root, "failure.json", { ...first, ...snapshot });
		}
		// Invalidation is unconditional: a completed phase loop may have written
		// complete:true before cleanup failed and set the first-failure guard.
		const file = join(this.root, "proof.json");
		const previous = existsSync(file)
			? JSON.parse(readFileSync(file, "utf8"))
			: {};
		const priorRows = Array.isArray(previous.phases) ? previous.phases : [];
		const phases = snapshot.phases.map((row) => ({
			...priorRows.find(
				(value: unknown) =>
					value &&
					typeof value === "object" &&
					"phase" in value &&
					value.phase === row.phase,
			),
			...row,
		}));
		writeEvidenceAtomic(this.root, "proof.json", {
			...previous,
			kind: "ios-native-durable-retirement-restore-primitives-only",
			complete: false,
			diagnosticOnly: true,
			...snapshot,
			phases,
			phaseTimings: snapshot.phases,
		});
		this.flushProgress();
	}

	checkpoint(name: unknown, phase: unknown = null): void {
		this.checkpointName = CHECKPOINTS.includes(
			name as (typeof CHECKPOINTS)[number],
		)
			? (name as (typeof CHECKPOINTS)[number])
			: "preflight";
		this.phaseName = PHASES.includes(phase as (typeof PHASES)[number])
			? (phase as (typeof PHASES)[number])
			: null;
	}
	begin(category: Category): {
		category: Category;
		started: number;
		sequence: number;
	} {
		return { category, started: performance.now(), sequence: ++this.sequence };
	}
	finish(
		attempt: ReturnType<ProofDiagnostics["begin"]>,
		outcome: Outcome,
		exitCode: unknown = null,
		signal: unknown = null,
		lifecycle?: CommandLifecycle,
	): void {
		this.lastCommand = {
			...(lifecycle ? { lifecycle: safeLifecycle(lifecycle) } : {}),
			category: CATEGORIES.includes(attempt.category)
				? attempt.category
				: "unknown",
			outcome,
			exitCode:
				Number.isSafeInteger(exitCode) &&
				Number(exitCode) >= 0 &&
				Number(exitCode) <= 255
					? Number(exitCode)
					: null,
			signal:
				signal === "SIGKILL" || signal === "SIGTERM"
					? signal
					: signal
						? "other"
						: null,
			elapsedMs: Math.max(0, performance.now() - attempt.started),
			sequence: attempt.sequence,
		};
		const category = this.lastCommand.category;
		const duration = Math.round(this.lastCommand.elapsedMs);
		const aggregate = this.commandTimings[category] ?? {
			count: 0,
			totalMs: 0,
			maxMs: 0,
		};
		aggregate.count++;
		aggregate.totalMs += duration;
		aggregate.maxMs = Math.max(aggregate.maxMs, duration);
		this.commandTimings[category] = aggregate;
		if (outcome !== "success") this.fail();
	}
	observePhaseFailure(input: Record<string, unknown>): void {
		const value = sanitizePhaseFailure(input);
		this.phaseFailureObservation = value;
		// Enrich only the same frozen phase; cleanup cannot replace attribution.
		if (this.failed) {
			const file = join(this.root, "failure.json");
			const receipt = JSON.parse(readFileSync(file, "utf8"));
			if (receipt.phase === value.phase) {
				receipt.phaseFailure = value;
				writeEvidenceAtomic(this.root, "failure.json", receipt);
			}
		}
	}
	fail(): void {
		if (this.failed) return;
		this.failed = true;
		writeEvidenceAtomic(this.root, "failure.json", {
			kind: "auth-retirement-proof-failure",
			classification: "BLOCKED",
			checkpoint: this.checkpointName,
			phase: this.phaseName,
			elapsedMs: Math.round(Math.max(0, performance.now() - this.started)),
			command: this.lastCommand,
			...(this.phaseFailureObservation
				? { phaseFailure: this.phaseFailureObservation }
				: {}),
			...this.progressSnapshot(),
		});
		if (!existsSync(join(this.root, "proof.json")))
			writeEvidenceAtomic(this.root, "proof.json", {
				kind: "ios-native-durable-retirement-restore-primitives-only",
				complete: false,
				diagnosticOnly: true,
				phases: [],
			});
	}
}
export let activeProofDiagnostics: ProofDiagnostics | null = null;
export async function withProofDiagnostics<T>(
	root: string,
	body: () => Promise<T>,
): Promise<T> {
	if (activeProofDiagnostics)
		throw new Error("Proof diagnostics already active");
	activeProofDiagnostics = new ProofDiagnostics(root);
	try {
		return await body();
	} catch (error) {
		activeProofDiagnostics.fail();
		throw error;
	} finally {
		activeProofDiagnostics = null;
	}
}
