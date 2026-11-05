/** Diagnostic-only native scheme observations. No log record, URL, nonce,
 * process path or plist content may cross this module's boolean boundary. */
import { ProofCommandTimeout } from "./auth-retirement-launch.ts";
import type { ProbeObservation } from "./auth-retirement-phase-diagnostics.ts";
import type { Run } from "./auth-retirement-simulator.ts";
export const SCHEME_SYSTEM_PROCESS_CLASSES = [
	"launchservicesd",
	"SpringBoard",
	"CoreSimulatorBridge",
	"other",
] as const;
type SystemProcessClass = (typeof SCHEME_SYSTEM_PROCESS_CLASSES)[number];
export type SchemeSeen = {
	schemeOpenSeenBySystem: boolean | "UNOBSERVED";
	schemeOpenSeenByApp: boolean | "UNOBSERVED";
	schemeLogObservation?: ProbeObservation;
	schemeOpenSystemProcessClass: SystemProcessClass[];
	nativeIngressSeen: boolean | "UNOBSERVED";
	nativeLogReadySeen: boolean | "UNOBSERVED";
	jsCallbackEntrySeen: boolean | "UNOBSERVED";
	jsLogReadySeen: boolean | "UNOBSERVED";
};
const unobserved = (observation?: ProbeObservation): SchemeSeen => ({
	...(observation ? { schemeLogObservation: observation } : {}),
	schemeOpenSeenBySystem: "UNOBSERVED",
	schemeOpenSeenByApp: "UNOBSERVED",
	schemeOpenSystemProcessClass: [],
	nativeIngressSeen: "UNOBSERVED",
	nativeLogReadySeen: "UNOBSERVED",
	jsCallbackEntrySeen: "UNOBSERVED",
	jsLogReadySeen: "UNOBSERVED",
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
	const systemClasses = new Set<SystemProcessClass>();
	let app = false,
		nativeIngress = false,
		nativeReady = false,
		jsEntry = false,
		jsReady = false;
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
			// log show can emit its OWN predicate/query record. It is not native
			// URL ingress, even though its eventMessage contains our scheme.
			if (name === "log") continue;
			if (name === executable) {
				if (record.eventMessage === "loretirementproof-js-callback-entry")
					jsEntry = true;
				if (record.eventMessage === "loretirementproof-js-log-ready")
					jsReady = true;
				app = true;
				if (record.eventMessage === "loretirementproof-native-ingress")
					nativeIngress = true;
				if (record.eventMessage === "loretirementproof-native-log-ready")
					nativeReady = true;
			} else
				systemClasses.add(
					SCHEME_SYSTEM_PROCESS_CLASSES.find(
						(value) => value !== "other" && value === name,
					) ?? "other",
				);
		}
		// False means not seen in persisted logs, never proof that delivery did not
		// occur: OS log retention/privacy can omit a real event.
		return {
			schemeOpenSeenBySystem: systemClasses.size > 0,
			schemeOpenSystemProcessClass: SCHEME_SYSTEM_PROCESS_CLASSES.filter(
				(value) => systemClasses.has(value),
			),
			schemeOpenSeenByApp: app,
			schemeLogObservation: "observed",
			nativeIngressSeen: nativeIngress,
			nativeLogReadySeen: nativeReady,
			jsCallbackEntrySeen: jsEntry,
			jsLogReadySeen: jsReady,
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
			// RN release console.info maps to OS_LOG_TYPE_INFO; collect that level.
			// Retrieval/retention still requires independent JS calibration.
			"--info",
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
