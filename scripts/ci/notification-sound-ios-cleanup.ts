#!/usr/bin/env node
/** XCTest may already stop its simulator. Cleanup's postcondition is the exact
 * selected UUID being Shutdown, not a successful redundant shutdown command.
 * Never swallow command failures or touch another job's simulator/device. */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type Run = (args: string[]) => string;
const nativeRun: Run = (args) =>
	execFileSync("xcrun", ["simctl", ...args], {
		encoding: "utf8",
		timeout: 30_000,
		stdio: ["ignore", "pipe", "pipe"],
	});

function stateOf(uuid: string, run: Run): string {
	const payload: unknown = JSON.parse(run(["list", "devices", "--json"]));
	if (
		typeof payload !== "object" ||
		payload === null ||
		!("devices" in payload) ||
		typeof payload.devices !== "object" ||
		payload.devices === null
	) {
		throw new Error("Invalid simctl device list");
	}
	const matches: { state: string }[] = [];
	for (const devices of Object.values(payload.devices)) {
		if (!Array.isArray(devices)) throw new Error("Invalid simctl runtime list");
		for (const device of devices) {
			if (typeof device !== "object" || device === null || device.udid !== uuid)
				continue;
			if (typeof device.state !== "string")
				throw new Error("Selected simulator has no state");
			matches.push(device);
		}
	}
	if (matches.length !== 1)
		throw new Error("Selected simulator UUID missing or ambiguous");
	return matches[0]?.state ?? "";
}

export function shutdownOwnedSimulator(
	uuid: string,
	run: Run = nativeRun,
): string {
	if (!UUID.test(uuid)) throw new Error("Expected one exact simulator UUID");
	const initial = stateOf(uuid, run);
	if (initial === "Shutdown") return `Simulator ${uuid} already Shutdown`;
	if (initial !== "Booted")
		throw new Error(`Unexpected selected simulator state: ${initial}`);
	run(["shutdown", uuid]); // A real failure propagates; no blanket || true.
	const final = stateOf(uuid, run);
	if (final !== "Shutdown")
		throw new Error(`Selected simulator did not shut down: ${final}`);
	return `Simulator ${uuid}: Booted -> Shutdown`;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	console.log(shutdownOwnedSimulator(process.env.SOUND_SIMULATOR ?? ""));
}
