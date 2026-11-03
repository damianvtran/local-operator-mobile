/** Synthetic owned-device observations only. A separate runner deliberately never
 * touches ProofDiagnostics.lastCommand: a screenshot cannot become the cause of
 * a receipt failure. No UI interaction, retries or private foreground API. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import {
	TIMING_PHASES,
	writeEvidenceAtomic,
} from "./auth-retirement-progress.ts";
export const CAPTURE_BUDGET_MS = 5000;
export const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
export class ObservationTimeout extends Error {}
export type ObservationRun = (
	exe: string,
	args: string[],
	budget: number,
) => Promise<void>;
/** Own one command group, discard output, and bound termination even if its child
 * keeps pipe descriptors open. Never route through the proof command journal. */
export const observationRun: ObservationRun = (exe, args, budget) =>
	new Promise((yes, no) => {
		const child = spawn(exe, args, { stdio: "ignore", detached: true });
		let settled = false;
		const kill = () => {
			if (child.pid)
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					/* Already reaped; no foreign PID is targeted. */
				}
		};
		const timer = setTimeout(() => {
			kill();
			finish(new ObservationTimeout());
		}, budget);
		function finish(error?: Error) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) no(error);
			else yes();
		}
		child.once("error", () =>
			finish(new Error("Observation command unavailable")),
		);
		child.once("exit", (code) => {
			kill();
			finish(code === 0 ? undefined : new Error("Observation command failed"));
		});
	});
export function validatePng(data: Buffer): void {
	if (
		data.length > MAX_CAPTURE_BYTES ||
		!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		throw new Error("Invalid capture");
	let at = 8,
		width = 0,
		height = 0,
		channels = 0,
		ended = false;
	const compressed: Buffer[] = [];
	while (at + 12 <= data.length) {
		const size = data.readUInt32BE(at),
			type = data.toString("ascii", at + 4, at + 8);
		if (at + 12 + size > data.length) throw new Error("Invalid capture");
		const payload = data.subarray(at + 8, at + 8 + size);
		let crc = 0xffffffff;
		for (const byte of data.subarray(at + 4, at + 8 + size)) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++)
				crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
		if ((crc ^ 0xffffffff) >>> 0 !== data.readUInt32BE(at + 8 + size))
			throw new Error("Invalid capture");
		if (at === 8 && type !== "IHDR") throw new Error("Invalid capture");
		if (type === "IHDR") {
			if (width || size !== 13) throw new Error("Invalid capture");
			width = payload.readUInt32BE(0);
			height = payload.readUInt32BE(4);
			channels = payload[9] === 6 ? 4 : payload[9] === 2 ? 3 : 0;
			if (
				payload[8] !== 8 ||
				!channels ||
				payload[10] !== 0 ||
				payload[11] !== 0 ||
				payload[12] !== 0
			)
				throw new Error("Unsupported capture PNG");
			if (!width || !height || width > 8192 || height > 8192)
				throw new Error("Invalid capture");
		}
		if (type === "IDAT") compressed.push(payload);
		at += 12 + size;
		if (type === "IEND") {
			ended = true;
			break;
		}
	}
	if (!ended || at !== data.length || !compressed.length)
		throw new Error("Invalid capture");
	const pixels = inflateSync(Buffer.concat(compressed), {
		maxOutputLength: 64 * 1024 * 1024,
	});
	if (pixels.length !== (1 + width * channels) * height)
		throw new Error("Invalid capture pixels");
}
export type CaptureResult = {
	phase: string;
	point: "after-openurl" | "receipt-timeout" | "after-tap";
	status: "observed" | "timeout" | "error";
	elapsedMs: number;
	sha256?: string;
	relativePath?: string;
	evidencePersisted?: boolean;
	stagingCleanup?: "completed" | "error";
	foregroundObservation?: "UNOBSERVED";
};
export async function captureOwned(
	root: string,
	udid: string,
	phase: string,
	point: CaptureResult["point"],
	run: ObservationRun = observationRun,
): Promise<CaptureResult> {
	const closedPhase = TIMING_PHASES.find((value) => value === phase);
	if (
		!closedPhase ||
		!["after-openurl", "receipt-timeout", "after-tap"].includes(point) ||
		!udid
	)
		throw new Error("Invalid capture identity");
	const start = performance.now(),
		relativePath = `captures/${phase}-${point}.png`;
	let result: CaptureResult;
	let privateStage: string | undefined;
	try {
		// Upload globs see ONLY validated, atomically published frames. A private
		// per-attempt directory also protects an earlier good frame on failure.
		const stagingRoot = join(root, ".capture-staging");
		mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
		privateStage = mkdtempSync(join(stagingRoot, "attempt-"));
		const path = join(privateStage, "capture.png");
		await run(
			"xcrun",
			["simctl", "io", udid, "screenshot", "--type=png", path],
			CAPTURE_BUDGET_MS,
		);
		const stat = lstatSync(path);
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			stat.size > MAX_CAPTURE_BYTES
		)
			throw new Error("Invalid capture");
		const bytes = readFileSync(path);
		validatePng(bytes);
		mkdirSync(join(root, "captures"), { recursive: true });
		renameSync(path, join(root, relativePath));
		result = {
			phase,
			point,
			status: "observed",
			elapsedMs: Math.round(performance.now() - start),
			relativePath,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	} catch (error) {
		result = {
			phase,
			point,
			status: error instanceof ObservationTimeout ? "timeout" : "error",
			elapsedMs: Math.round(performance.now() - start),
		};
	} finally {
		// Only the directory created by THIS attempt is retired; rmSync unlinks
		// a rejected staged symlink, never follows/deletes its foreign target.
		if (privateStage)
			try {
				rmSync(privateStage, { recursive: true, force: true });
			} catch {
				result = {
					phase,
					point,
					status: "error",
					elapsedMs: Math.round(performance.now() - start),
					stagingCleanup: "error",
				};
			}
	}
	if (result.stagingCleanup !== "error") result.stagingCleanup = "completed";
	try {
		writeEvidenceAtomic(root, `${closedPhase}-${point}-capture.json`, result);
		return {
			...result,
			evidencePersisted: true,
			foregroundObservation: "UNOBSERVED",
		};
	} catch {
		return {
			...result,
			status: "error",
			evidencePersisted: false,
			foregroundObservation: "UNOBSERVED",
		};
	}
}
/** Start the bounded capture without putting it in front of receipt settlement.
 * Both promises already have rejection handlers; the caller drains capture only
 * AFTER it has frozen a failure (or accepted a successful receipt). */
export function captureAlongsideReceipt<T>(
	answer: Promise<T>,
	capture: () => Promise<CaptureResult>,
) {
	void answer.catch(() => undefined);
	const pending = capture();
	void pending.catch(() => undefined);
	return { answer, capture: pending };
}
