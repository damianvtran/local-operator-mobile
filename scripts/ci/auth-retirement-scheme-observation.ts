/** Diagnostic-only native scheme observations. No log record, URL, nonce,
 * process path or plist content may cross this module's boolean boundary. */
import type { Run } from "./auth-retirement-simulator.ts";
export type SchemeSeen = {
	schemeOpenSeenBySystem: boolean | "UNOBSERVED";
	schemeOpenSeenByApp: boolean | "UNOBSERVED";
};
const unobserved = (): SchemeSeen => ({
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
	if (!executable) return unobserved();
	let system = false,
		app = false;
	try {
		for (const line of output.split("\n")) {
			if (!line.trim()) continue;
			const record = JSON.parse(line) as Record<string, unknown>;
			if (
				!record ||
				typeof record !== "object" ||
				Array.isArray(record) ||
				typeof record.eventMessage !== "string"
			)
				return unobserved();
			if (!record.eventMessage.includes("loretirementproof")) continue;
			const process =
				typeof record.processImagePath === "string"
					? record.processImagePath
					: record.process;
			if (typeof process !== "string" || !process) return unobserved();
			const name = process.split("/").at(-1);
			if (!name) return unobserved();
			if (name === executable) app = true;
			else system = true;
		}
		// False means not seen in persisted logs, never proof that delivery did not
		// occur: OS log retention/privacy can omit a real event.
		return { schemeOpenSeenBySystem: system, schemeOpenSeenByApp: app };
	} catch {
		return unobserved();
	}
}
export async function observeSchemeAfterTimeout(
	cause: string,
	progress: string,
	udid: string,
	executable: string,
	run: Run,
): Promise<SchemeSeen> {
	if (cause !== "receipt-timeout" || progress !== "none" || !executable)
		return unobserved();
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
	} catch {
		return unobserved();
	}
}
