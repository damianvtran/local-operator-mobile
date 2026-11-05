import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stageBDiagnosticText } from "../../src/testing/stage-b-draft-transport.ts";
import { capFor } from "./account-routing-proof-contract.ts";
import {
	STAGE_B_COLD_ASSERTION_MS,
	type StageBStep,
	stageBHasDrawnScreen,
} from "./stage-b-draft-flows.ts";

export type DiagnosticRun = (
	name: string,
	command: string,
	args: string[],
	seconds: number,
) => Promise<string>;

/** Reserve CLI/driver startup separately from EVERY nested inner wait. Killing
 * Maestro at the same deadline as its assertion prevents its debug finalization. */
export function stageBFlowCap(steps: StageBStep[], cold = false): number {
	const sum = (value: unknown): number => {
		if (Array.isArray(value))
			return value.reduce((n, item) => n + sum(item), 0);
		if (!value || typeof value !== "object") return 0;
		return Object.entries(value).reduce(
			(n, [key, item]) =>
				n +
				(key === "timeout" && typeof item === "number"
					? item
					: sum(item) +
						(key === "commands" && Array.isArray(item)
							? item.length * 30000
							: 0)),
			0,
		);
	};
	// 30s per explicit command also covers actions using Maestro's default wait.
	const computed =
		capFor("maestroCold") +
		Math.ceil((STAGE_B_COLD_ASSERTION_MS + sum(steps)) / 1000) +
		30 * (steps.length + 1);
	// A merged cold segment can contain many more waits than the original warm
	// foreground command. Its complete step budget must win over the cold floor.
	return cold ? Math.max(capFor("maestroCold"), computed) : computed;
}

const STAGE_LABEL = /stage=([a-z0-9-]+)/i;
const CAUSE_LABEL = /cause=([^"\r\n]+)/;
export function statusFromHierarchy(hierarchy: string): {
	stage: string;
	cause: string;
} {
	let status = hierarchy;
	try {
		const find = (value: unknown): string | undefined => {
			if (
				typeof value === "string" &&
				value.includes("stage=") &&
				value.includes("cause=")
			)
				return value;
			if (value && typeof value === "object")
				for (const item of Object.values(value)) {
					const hit = find(item);
					if (hit) return hit;
				}
			return undefined;
		};
		status = find(JSON.parse(hierarchy)) ?? hierarchy;
	} catch {
		/* Maestro versions also emit human-readable hierarchy text. */
	}
	return {
		stage: STAGE_LABEL.exec(status)?.[1] ?? "unobserved",
		cause: stageBDiagnosticText(
			CAUSE_LABEL.exec(status)?.[1] ?? "pending",
		).slice(0, 300),
	};
}

/** Reuse the already-captured failure hierarchy. A drawn loading gate is not
 * readiness; preserve its stage/cause without another slow Maestro invocation. */
export function stageBSeedFailureFromHierarchy(
	hierarchy: string,
): string | null {
	if (!hierarchy.includes("stage-b-proof-gate")) return null;
	const status = statusFromHierarchy(hierarchy);
	return `seed never completed at stage=${status.stage}: ${status.cause}`;
}

/** Boot readiness is not Photos-library readiness. Run 41938722439 timed out
 * addmedia with an empty log after bootstatus succeeded and a 32m build; the
 * existing app-only log could not distinguish a lazy service from an I/O stall.
 * Read-only, bounded snapshots collect evidence without retries or launching a
 * service just to make an unproved cold-start theory look like a fix. */
export async function captureStageBMediaReadiness(
	run: DiagnosticRun,
	udid: string,
	output: string,
	phase: "before" | "failed",
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	const probes: [string, string[], number][] = [
		["services", ["simctl", "spawn", udid, "launchctl", "list"], 15],
		[
			"photos-log",
			[
				"simctl",
				"spawn",
				udid,
				"log",
				"show",
				"--style",
				"compact",
				"--last",
				"6m",
				"--info",
				"--predicate",
				'process == "assetsd" OR process == "medialibraryd" OR process CONTAINS[c] "photo" OR subsystem CONTAINS[c] "photo"',
			],
			30,
		],
	];
	for (const [kind, args, seconds] of probes) {
		const name = `media-${phase}-${kind}`;
		try {
			const text = await run(name, "xcrun", args, seconds);
			writeFileSync(join(output, `${name}.txt`), stageBDiagnosticText(text));
			result[kind] = "captured";
		} catch (error) {
			result[kind] = stageBDiagnosticText(String(error));
		}
	}
	return result;
}

/** A gate counts as drawn, not as seeded. Preserve the last observed stage when
 * the seed hangs or hierarchy acquisition itself fails; never return false PASS. */
export async function awaitStageBSeed(
	initial: string,
	hierarchy: (seconds: number) => Promise<string>,
	options: {
		now?: () => number;
		sleep?: () => Promise<void>;
		timeoutMs?: number;
	} = {},
): Promise<string> {
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ??
		(() => new Promise<void>((resolve) => setTimeout(resolve, 500)));
	const deadline = now() + (options.timeoutMs ?? 180000);
	let current = initial;
	let last = statusFromHierarchy(current);
	const failure = (cause: string) =>
		new Error(
			`seed never completed at stage=${last.stage}: ${stageBDiagnosticText(cause)}`,
		);
	for (;;) {
		if (
			!current.includes("stage-b-proof-gate") &&
			stageBHasDrawnScreen(current)
		)
			return current;
		last = statusFromHierarchy(current);
		if (last.cause !== "pending") throw failure(last.cause);
		if (now() >= deadline)
			throw failure(`deadline exceeded; last cause=${last.cause}`);
		await sleep();
		try {
			current = await hierarchy(
				Math.max(1, Math.min(90, Math.ceil((deadline - now()) / 1000))),
			);
		} catch (error) {
			throw failure(error instanceof Error ? error.message : String(error));
		}
	}
}

/** Independent best-effort captures BEFORE shutdown. Attempt all three even if
 * one command fails; run() also retains bounded, redacted stdout on failures. */
export async function captureStageBFailure(
	run: DiagnosticRun,
	udid: string,
	output: string,
	maestro: string,
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	const captures: [string, string, string[], number, string?][] = [
		[
			"failure-screenshot",
			"xcrun",
			["simctl", "io", udid, "screenshot", join(output, "failure.png")],
			30,
		],
		[
			"failure-hierarchy",
			maestro,
			["--device", udid, "hierarchy"],
			capFor("maestroCold"),
			"failure.hierarchy.txt",
		],
		[
			"failure-os-log",
			"xcrun",
			[
				"simctl",
				"spawn",
				udid,
				"log",
				"show",
				"--style",
				"compact",
				"--last",
				"10m",
				"--info",
				"--debug",
				"--predicate",
				'process == "StageBDraftProof"',
			],
			60,
			"failure.os-log.txt",
		],
	];
	for (const [name, command, args, seconds, filename] of captures) {
		try {
			const text = await run(name, command, args, seconds);
			if (filename)
				writeFileSync(join(output, filename), stageBDiagnosticText(text));
			result[name] = "captured";
		} catch (error) {
			result[name] = stageBDiagnosticText(String(error));
		}
	}
	return result;
}
