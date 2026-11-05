/** Coarse timing evidence only; no native output, labels, arguments or paths. */
import {
	closeSync,
	existsSync,
	fsyncSync,
	openSync,
	renameSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import type { ProofDiagnostics } from "./auth-retirement-diagnostics.ts";
export const TIMING_PHASES = [
	"seed",
	"persist-control",
	"retire",
	"retired-restore",
	"fresh-replace",
	"fresh-restore",
] as const;
export const COMMAND_CATEGORIES = [
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
export type PhaseTiming = {
	phase: (typeof TIMING_PHASES)[number];
	elapsedMs: number;
	outcome: "passed" | "failed" | "interrupted";
};
export type SetupTiming =
	| "bootReadyMs"
	| "firstInstallMs"
	| "freezeToFirstPhaseMs";
const ms = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.round(value)
		: undefined;
export function sanitizeProgress(input: Record<string, unknown>) {
	const setup =
		input.setupTimings && typeof input.setupTimings === "object"
			? (input.setupTimings as Record<string, unknown>)
			: {};
	const commands =
		input.commandTimings && typeof input.commandTimings === "object"
			? (input.commandTimings as Record<string, unknown>)
			: {};
	return {
		setupTimings: Object.fromEntries(
			(
				["bootReadyMs", "firstInstallMs", "freezeToFirstPhaseMs"] as const
			).flatMap((key) =>
				ms(setup[key]) === undefined ? [] : [[key, ms(setup[key])]],
			),
		),
		phases: (Array.isArray(input.phases) ? input.phases : [])
			.slice(0, 6)
			.flatMap((value: unknown) => {
				if (!value || typeof value !== "object") return [];
				const row = value as Record<string, unknown>;
				const phase = TIMING_PHASES.find((name) => name === row.phase),
					elapsedMs = ms(row.elapsedMs);
				return phase &&
					elapsedMs !== undefined &&
					(row.outcome === "passed" ||
						row.outcome === "failed" ||
						row.outcome === "interrupted")
					? [{ phase, elapsedMs, outcome: row.outcome }]
					: [];
			}),
		commandTimings: Object.fromEntries(
			COMMAND_CATEGORIES.flatMap((category) => {
				const value = commands[category];
				if (!value || typeof value !== "object") return [];
				const row = value as Record<string, unknown>;
				if (!Number.isSafeInteger(row.count) || Number(row.count) < 0)
					return [];
				const totalMs = ms(row.totalMs),
					maxMs = ms(row.maxMs);
				return totalMs !== undefined && maxMs !== undefined
					? [[category, { count: row.count, totalMs, maxMs }]]
					: [];
			}),
		),
		cumulativeElapsedMs: ms(input.cumulativeElapsedMs) ?? 0,
	};
}
let sequence = 0;
/** Tiny synchronous, fsynced atomic evidence. Only these owned metadata names
 * can be published; there is no simulator/process cleanup boundary here. */
export function writeEvidenceAtomic(
	root: string,
	// Closed observation filenames reuse the same atomic writer; signal handler
	// execution is unchanged and never performs screenshot/archive work.
	name:
		| "progress.json"
		| "failure.json"
		| "proof.json"
		| "archive-provenance.json"
		| `${(typeof TIMING_PHASES)[number]}-${"after-openurl" | "receipt-timeout" | "after-tap"}-capture.json`,
	value: Record<string, unknown>,
): void {
	const temporary = join(root, `.${name}-${process.pid}-${++sequence}.tmp`);
	let fd: number | undefined,
		created = false;
	try {
		fd = openSync(temporary, "wx", 0o600);
		created = true;
		const bytes = Buffer.from(JSON.stringify(value));
		let offset = 0;
		while (offset < bytes.length) {
			const written = writeSync(fd, bytes, offset, bytes.length - offset);
			if (written === 0) throw new Error("Evidence write made no progress");
			offset += written;
		}
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(temporary, join(root, name));
		const directory = openSync(root, "r");
		try {
			fsyncSync(directory);
		} finally {
			closeSync(directory);
		}
	} finally {
		if (fd !== undefined) closeSync(fd);
		if (created && existsSync(temporary)) unlinkSync(temporary);
	}
}
export function writeProgressAtomic(
	root: string,
	input: Record<string, unknown>,
): void {
	writeEvidenceAtomic(root, "progress.json", sanitizeProgress(input));
}
/** Install ONLY around --run, never module load, prepare, freeze or verifier.
 * GitHub manual cancellation has the SAME signal receipt; distinguish it from
 * a timeout using the run's GitHub conclusion. No await/network/simctl here. */
export function installRunSignalHandlers(
	diagnostics: ProofDiagnostics,
): () => void {
	const stop = (signal: "SIGINT" | "SIGTERM") => {
		try {
			diagnostics.recordStepCeiling(signal);
		} finally {
			process.exit(signal === "SIGINT" ? 130 : 143);
		}
	};
	const interrupt = () => stop("SIGINT"),
		terminate = () => stop("SIGTERM");
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", terminate);
	return () => {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", terminate);
	};
}
