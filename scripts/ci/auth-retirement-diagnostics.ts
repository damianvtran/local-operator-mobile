/** Deliberately lossy diagnostics: no exception messages, command arguments,
 * stdout/stderr, URLs, paths, tokens or arbitrary labels enter this receipt.
 * A first failure is immutable across cleanup so recovery cannot mask its cause.
 * This is an evidence repair, NOT a native retirement root-cause fix. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHECKPOINTS = [
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
const PHASES = [
	"seed",
	"persist-control",
	"retire",
	"retired-restore",
	"fresh-replace",
	"fresh-restore",
] as const;
const CATEGORIES = [
	"artifact-metadata",
	"source-identity",
	"inventory",
	"create",
	"boot",
	"bootstatus",
	"install",
	"installed-app",
	"launch",
	"openurl",
	"shutdown",
	"delete",
	"local-process",
	"unknown",
] as const;
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
	private readonly root: string;
	constructor(root: string) {
		// This module is also loaded directly by Node's native type stripping;
		// parameter properties would break the verifier before it can report.
		this.root = root;
		mkdirSync(root, { recursive: true });
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
		if (outcome !== "success") this.fail();
	}
	fail(): void {
		if (this.failed) return;
		this.failed = true;
		writeFileSync(
			join(this.root, "failure.json"),
			JSON.stringify(
				{
					kind: "auth-retirement-proof-failure",
					classification: "BLOCKED",
					checkpoint: this.checkpointName,
					phase: this.phaseName,
					elapsedMs: Math.max(0, performance.now() - this.started),
					command: this.lastCommand,
				},
				null,
				2,
			),
		);
		// Setup used to fail before the phase-loop finally could create proof.json.
		// Preserve any real partial receipt; otherwise publish an explicit non-proof.
		if (!existsSync(join(this.root, "proof.json")))
			writeFileSync(
				join(this.root, "proof.json"),
				JSON.stringify({
					kind: "ios-native-durable-retirement-restore-primitives-only",
					complete: false,
					diagnosticOnly: true,
					phases: [],
				}),
			);
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
