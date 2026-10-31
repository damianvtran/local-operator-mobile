/** Creation is a recoverable transaction, not `create -> best-effort lease`.
 * The durable intent precedes any simulator request. A gated client records its
 * PID before the request can run; recovery waits for that exact client to exit.
 * Inventory reconciliation uses one exact name AND runtime/type identity, never
 * a prefix or the supplied template UDID. This is trusted CI ownership, not
 * authority to operate on an arbitrary local/user simulator. */
import {
	closeSync,
	existsSync,
	fsyncSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type Run = (
	exe: string,
	args: string[],
	timeout?: number,
	beforeStart?: (pid: number) => void,
) => Promise<string>;
export interface CreationIntent {
	nonce: string;
	runId: string;
	hostPid: number;
	name: string;
	runtime: string;
	deviceType: string;
	templateUdid: string;
	state: "prepared" | "in-flight" | "settled" | "uncertain" | "cleaned";
	clientPid: number | null;
}
const uuid = /^[a-fA-F0-9-]{36}$/;
export function writeDurable(
	file: string,
	value: unknown,
	exclusive = false,
): void {
	const temporary = exclusive ? file : `${file}.${process.pid}.next`;
	writeFileSync(temporary, JSON.stringify(value), {
		flag: exclusive ? "wx" : "w",
		flush: true,
	});
	if (!exclusive) renameSync(temporary, file);
	const dir = openSync(dirname(file), "r");
	try {
		fsyncSync(dir);
	} finally {
		closeSync(dir);
	}
}
export function prepareCreation(
	root: string,
	fields: Omit<CreationIntent, "name" | "state" | "clientPid">,
): CreationIntent {
	const intent: CreationIntent = {
		...fields,
		name: `lop-retirement-${fields.nonce}-${fields.hostPid}-${fields.runId}`,
		state: "prepared",
		clientPid: null,
	};
	validate(intent, fields.nonce, fields.runId);
	writeDurable(join(root, "creation-intent.json"), intent, true);
	return intent;
}
function validate(intent: CreationIntent, nonce: string, runId: string): void {
	if (
		intent.nonce !== nonce ||
		intent.runId !== runId ||
		!/^[a-f0-9]{32}$/.test(intent.nonce) ||
		!/^\d+$/.test(intent.runId) ||
		!Number.isSafeInteger(intent.hostPid) ||
		intent.hostPid <= 0 ||
		intent.name !== `lop-retirement-${nonce}-${intent.hostPid}-${runId}` ||
		!uuid.test(intent.templateUdid) ||
		!intent.runtime ||
		!intent.deviceType ||
		!["prepared", "in-flight", "settled", "uncertain", "cleaned"].includes(
			intent.state,
		) ||
		(intent.clientPid !== null &&
			(!Number.isSafeInteger(intent.clientPid) || intent.clientPid <= 0))
	)
		throw new Error("Creation intent ownership refused");
}
export async function createFromIntent(
	root: string,
	intent: CreationIntent,
	run: Run,
): Promise<{ udid: string; hostPid: number; nonce: string; runId: string }> {
	if (intent.hostPid !== process.pid) throw new Error("Creation host mismatch");
	try {
		const udid = await run(
			"xcrun",
			["simctl", "create", intent.name, intent.deviceType, intent.runtime],
			30000,
			(pid) => {
				intent.clientPid = pid;
				intent.state = "in-flight";
				writeDurable(join(root, "creation-intent.json"), intent);
			},
		);
		intent.state = "settled";
		writeDurable(join(root, "creation-intent.json"), intent);
		if (!uuid.test(udid) || udid === intent.templateUdid)
			throw new Error("Creation result identity refused");
		const inventory = JSON.parse(
			await run("xcrun", ["simctl", "list", "devices", "--json"]),
		) as {
			devices: Record<
				string,
				Array<{ udid: string; name: string; deviceTypeIdentifier?: string }>
			>;
		};
		const exact = Object.entries(inventory.devices).flatMap(
			([runtime, devices]) =>
				devices
					.filter((d) => d.name === intent.name)
					.map((d) => ({ ...d, runtime })),
		);
		if (
			exact.length !== 1 ||
			exact[0]?.udid !== udid ||
			exact[0]?.runtime !== intent.runtime ||
			exact[0]?.deviceTypeIdentifier !== intent.deviceType
		)
			throw new Error("Created device metadata did not match intent");
		const lease = {
			udid,
			hostPid: intent.hostPid,
			nonce: intent.nonce,
			runId: intent.runId,
		};
		writeDurable(join(root, "simulator-lease.json"), lease, true);
		return lease;
	} catch (error) {
		intent.state = "uncertain";
		writeDurable(join(root, "creation-intent.json"), intent);
		throw error;
	}
}
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw new Error("Cannot establish creator process state");
	}
}
export async function recoverCreation(
	root: string,
	nonce: string,
	runId: string,
	run: Run,
	isAlive = alive,
): Promise<void> {
	const file = join(root, "creation-intent.json");
	if (!existsSync(file)) {
		if (existsSync(join(root, "simulator-lease.json")))
			throw new Error("Lease has no durable creation authority");
		return; // no intent means the guarded create could never have started
	}
	const intent = JSON.parse(readFileSync(file, "utf8")) as CreationIntent;
	validate(intent, nonce, runId);
	// Do not kill a potentially reused PID. Wait for the exact gated client to
	// resolve; a still-live/unknown client is BLOCKED, never "nothing to clean".
	if (intent.hostPid !== process.pid && isAlive(intent.hostPid))
		throw new Error("Creator host remains active; recovery blocked");
	if (intent.clientPid !== null) {
		for (let tries = 0; isAlive(intent.clientPid); tries++) {
			if (tries >= 30)
				throw new Error("Creation client still active; recovery blocked");
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
	const list = JSON.parse(
		await run("xcrun", ["simctl", "list", "devices", "--json"]),
	) as {
		devices: Record<
			string,
			Array<{
				udid: string;
				name: string;
				state: string;
				deviceTypeIdentifier?: string;
			}>
		>;
	};
	const matches = Object.entries(list.devices).flatMap(([runtime, devices]) =>
		devices
			.filter((d) => d.name === intent.name)
			.map((d) => ({ ...d, runtime })),
	);
	if (matches.length > 1)
		throw new Error("Ambiguous exact creation identity; recovery blocked");
	const device = matches[0];
	const leasePath = join(root, "simulator-lease.json");
	if (device) {
		if (
			device.runtime !== intent.runtime ||
			device.deviceTypeIdentifier !== intent.deviceType ||
			!uuid.test(device.udid) ||
			device.udid === intent.templateUdid
		)
			throw new Error("Creation inventory ownership mismatch");
		if (existsSync(leasePath)) {
			const lease = JSON.parse(readFileSync(leasePath, "utf8"));
			if (
				lease.udid !== device.udid ||
				lease.nonce !== nonce ||
				lease.runId !== runId ||
				lease.hostPid !== intent.hostPid
			)
				throw new Error("Lease/intent/inventory mismatch");
		}
		if (device.state !== "Shutdown")
			await run("xcrun", ["simctl", "shutdown", device.udid]);
		await run("xcrun", ["simctl", "delete", device.udid]);
	} else if (intent.state === "in-flight" || intent.state === "uncertain") {
		// Service-side completion may outlive a killed client. An empty observation
		// after an uncertain request cannot establish rollback: leave intent intact
		// for the workflow fallback and make the job BLOCKED rather than claim clean.
		throw new Error("Uncertain creation not reconciled; recovery blocked");
	}
	intent.state = "cleaned";
	writeDurable(file, intent);
	writeDurable(join(root, "cleanup.json"), {
		udid: device?.udid ?? null,
		hostPid: intent.hostPid,
		cleanupFailed: false,
		recoveredFromIntent: true,
	});
}
