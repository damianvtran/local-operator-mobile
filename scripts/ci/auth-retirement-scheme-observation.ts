/** Diagnostic-only native scheme observations. No log record, URL, nonce,
 * process path or plist content may cross this module's boolean boundary. */
import { ProofCommandTimeout } from "./auth-retirement-launch.ts";
import type { ProbeObservation } from "./auth-retirement-phase-diagnostics.ts";
import type { Run } from "./auth-retirement-simulator.ts";
export type SchemeSeen = {
	schemeOpenSeenBySystem: boolean | "UNOBSERVED";
	schemeOpenSeenByApp: boolean | "UNOBSERVED";
	schemeLogObservation?: ProbeObservation;
};
const unobserved = (observation?: ProbeObservation): SchemeSeen => ({
	...(observation ? { schemeLogObservation: observation } : {}),
	schemeOpenSeenBySystem: "UNOBSERVED",
	schemeOpenSeenByApp: "UNOBSERVED",
});
export function schemeRegistered(info: Record<string, unknown>): boolean {
	return (
		Array.isArray(info.CFBundleURLTypes) &&
		info.CFBundleURLTypes.some(
			(value) =>
				value &&
				typeof value === "object" &&
				Array.isArray(value.CFBundleURLSchemes) &&
				value.CFBundleURLSchemes.includes("loretirementproof"),
		)
	);
}
export function parseSchemeLogs(
	output: string,
	executable: string,
): SchemeSeen {
	if (!executable) return unobserved("malformed");
	let system = false,
		app = false;
	try {
		for (const line of output.split("\n")) {
			if (!line.trim()) continue;
			const record = JSON.parse(line) as Record<string, unknown>;
			if (!record || typeof record !== "object" || Array.isArray(record))
				return unobserved("malformed");
			// log(1) ndjson ends with {count:int,finished:int}, even for no
			// matches. That metadata is not an event or evidence of corruption.
			if (
				Object.hasOwn(record, "finished") &&
				!Object.hasOwn(record, "eventMessage")
			)
				continue;
			if (typeof record.eventMessage !== "string")
				return unobserved("malformed");
			if (!record.eventMessage.includes("loretirementproof")) continue;
			const process =
				typeof record.processImagePath === "string"
					? record.processImagePath
					: record.process;
			if (typeof process !== "string" || !process)
				return unobserved("malformed");
			const name = process.split("/").at(-1);
			if (!name) return unobserved("malformed");
			if (name === executable) app = true;
			else system = true;
		}
		// False means not seen in persisted logs, never proof that delivery did not
		// occur: OS log retention/privacy can omit a real event.
		return {
			schemeOpenSeenBySystem: system,
			schemeOpenSeenByApp: app,
			schemeLogObservation: "observed",
		};
	} catch {
		return unobserved("malformed");
	}
}
export async function observeSchemeAfterTimeout(
	cause: string,
	progress: string,
	udid: string,
	executable: string,
	run: Run,
): Promise<SchemeSeen> {
	if (cause !== "receipt-timeout" || progress !== "none") return unobserved();
	if (!executable) return unobserved("malformed");
	// Both probes are bounded at 30s each; see auth-retirement-launch.ts for
	// budget accounting and why the 20-minute step ceiling is the hard stop.
	// Keep both probes off the success path; no retry/sleep.
	try {
		const output = await run("xcrun", [
			"simctl",
			"spawn",
			udid,
			"log",
			"show",
			"--last",
			"3m",
			"--style",
			"ndjson",
			"--predicate",
			'eventMessage CONTAINS "loretirementproof"',
		]);
		return parseSchemeLogs(output, executable);
	} catch (error) {
		return unobserved(
			error instanceof ProofCommandTimeout ? "timeout" : "error",
		);
	}
}
