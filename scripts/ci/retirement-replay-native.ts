/** Supported-command boundary. Exact owned process identity is sampled twice,
 * bracketing installed-container/plist/content measurement; never trust runner
 * supplied PID/source claims or the old boolean processAlive observation. */
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { immutableBundleDigest } from "./auth-retirement-ios-proof.ts";
import {
	assertOwnedLease,
	assertProofBuild,
	type OwnedSimulatorLease,
	type ProofBuildIdentity,
} from "./auth-retirement-proof-contract.ts";
import type { CreationIntent, Run } from "./auth-retirement-simulator.ts";
import {
	type Deadline,
	type LiveIdentity,
	ReplayRefused,
} from "./retirement-replay-core.ts";
/** Register only the wrapper group WE just spawned. The watchdog reads this
 * private pipe and kills/joins these groups if synchronous host work overruns. */
import { boundedWait } from "./retirement-replay-lifecycle.ts";
export function registerOwnedGroup(pid: number) {
	const raw = process.env.LO_REPLAY_SUPERVISOR_FD;
	if (raw !== undefined) {
		const fd = Number(raw);
		if (!Number.isInteger(fd) || fd < 3)
			throw new ReplayRefused("command-journal");
		writeSync(fd, JSON.stringify({ group: pid }) + "\n");
	}
}
function retireOwnedGroup(pid: number) {
	const raw = process.env.LO_REPLAY_SUPERVISOR_FD;
	if (raw !== undefined)
		try {
			writeSync(Number(raw), JSON.stringify({ retired: pid }) + "\n");
		} catch {
			/* Already terminal; never start another command on a lost supervisor. */
		}
}
export interface OwnedCommand {
	completion: Promise<string>;
	stop: (deadline: Deadline) => Promise<void>;
}
export class NativeScope {
	readonly commands = new Set<OwnedCommand>();
	closed = false;
	readonly deadline: Deadline;
	constructor(deadline: Deadline) {
		this.deadline = deadline;
	}
	start(
		exe: string,
		args: string[],
		cap = 30000,
		beforeStart?: (pid: number) => void,
		capture = true,
	): OwnedCommand {
		if (this.closed) throw new ReplayRefused("closed");
		const budget = this.deadline.cap(cap);
		// Expo augments ProcessEnv with a required NODE_ENV. Keep that single
		// non-secret mode explicit, without inheriting the rest of the host env.
		const environment: NodeJS.ProcessEnv = {
			NODE_ENV: process.env.NODE_ENV,
			...Object.fromEntries(
				Object.entries(process.env).filter(([key]) =>
					[
						"PATH",
						"HOME",
						"USER",
						"LOGNAME",
						"TMPDIR",
						"DEVELOPER_DIR",
						"LANG",
						"LC_ALL",
						"NODE_OPTIONS",
						"GIT_CONFIG_SYSTEM",
						"GIT_CONFIG_GLOBAL",
						"GIT_TERMINAL_PROMPT",
					].includes(key),
				),
			),
		};
		const child = spawn(
			process.execPath,
			[join(import.meta.dirname, "retirement-replay-child.cjs"), exe, ...args],
			{
				stdio: ["pipe", capture ? "pipe" : "ignore", "ignore"],
				detached: true,
				env: environment,
			},
		);
		let retired = false,
			killFailed = false,
			groupGone = false,
			closedOutput = false,
			exitCode: number | null = null;
		let resolveOutput!: (value: string) => void,
			rejectOutput!: (reason: unknown) => void,
			resolveExit!: () => void,
			settled = false,
			exited = false,
			output = Buffer.alloc(0);
		const completion = new Promise<string>((yes, no) => {
			resolveOutput = yes;
			rejectOutput = no;
		});
		void completion.catch(() => undefined);
		const exit = new Promise<void>((yes) => {
			resolveExit = yes;
		});
		const kill = () => {
			if (retired) return;
			retired = true;
			if (child.pid)
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH")
						killFailed = true;
				}
		};
		const settle = (error?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.stdout?.destroy();
			child.stdin?.destroy();
			if (error) rejectOutput(error);
			else resolveOutput(output.toString("utf8").trim());
		};
		const timer = setTimeout(() => {
			try {
				kill();
			} finally {
				settle(new ReplayRefused("command-timeout"));
			}
		}, budget);
		child.stdout?.on("data", (data) => {
			output = Buffer.concat([output, data]);
			if (output.length > 4 * 1024 ** 2) {
				try {
					kill();
				} finally {
					settle(new ReplayRefused("command-output-cap"));
				}
			}
		});
		const awaitGroup = async (deadline: Deadline) => {
			while (child.pid && !groupGone) {
				try {
					process.kill(-child.pid, 0);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ESRCH") {
						groupGone = true;
						retireOwnedGroup(child.pid);
						return;
					}
					throw new ReplayRefused("cleanup");
				}
				await boundedWait(
					new Promise<void>((yes) => setTimeout(yes, 20)),
					deadline,
					20,
				);
			}
		};
		const completed = () => {
			if (groupGone && closedOutput) {
				this.commands.delete(owned);
				settle(
					exitCode === 0 && !killFailed
						? undefined
						: new ReplayRefused("command-exit"),
				);
			}
		};
		child.once("error", () => {
			exited = true;
			resolveExit();
			this.commands.delete(owned);
			settle(new ReplayRefused("command-start"));
		});
		child.once("exit", (code) => {
			exited = true;
			exitCode = code;
			kill();
			resolveExit();
			if (code !== 0) settle(new ReplayRefused("command-exit"));
			void awaitGroup(this.deadline).then(completed, () =>
				settle(new ReplayRefused("cleanup")),
			);
		});
		child.once("close", () => {
			closedOutput = true;
			completed();
		});
		const owned: OwnedCommand = {
			completion,
			stop: async (deadline) => {
				kill();
				settle(new ReplayRefused("command-exit"));
				await boundedWait(exit, deadline, deadline.cap(120000));
				if (!groupGone) await awaitGroup(deadline);
				this.commands.delete(owned);
				if (killFailed) throw new ReplayRefused("cleanup");
			},
		};
		this.commands.add(owned);
		try {
			if (!child.pid) throw new ReplayRefused("command-start");
			registerOwnedGroup(child.pid);
			beforeStart?.(child.pid);
			child.stdin!.end("G");
		} catch (error) {
			try {
				kill();
			} finally {
				settle(
					error instanceof ReplayRefused
						? error
						: new ReplayRefused("command-journal"),
				);
			}
		}
		return owned;
	}
	run: Run = (exe, args, cap = 30000, beforeStart) =>
		this.start(exe, args, cap, beforeStart).completion;
	async stop(deadline: Deadline) {
		this.closed = true;
		const outcomes = await Promise.allSettled(
			[...this.commands].map((command) => command.stop(deadline)),
		);
		if (outcomes.some((outcome) => outcome.status === "rejected"))
			throw new ReplayRefused("cleanup");
	}
}
export function boundedNative(deadline: Deadline): Run {
	return new NativeScope(deadline).run;
}
export const PROOF_BUNDLE = "com.localoperator.mobile.retirementproof";
export function exactProcess(
	output: string,
	expectedPID: number,
	pinnedLabel?: string,
) {
	let selected: { pid: number; label: string } | undefined;
	for (const line of output.split("\n")) {
		const fields = line.split("\t"),
			label = fields[2] ?? "";
		if (
			fields.length !== 3 &&
			/(?:^|[\t ])(?:UIKitApplication:)?com\.localoperator\.mobile\.retirementproof(?:\[|$)/.test(
				line,
			)
		)
			throw new ReplayRefused("proof-process");
		const relevant =
			label === PROOF_BUNDLE ||
			label === `UIKitApplication:${PROOF_BUNDLE}` ||
			label.startsWith(`UIKitApplication:${PROOF_BUNDLE}[`);
		if (!relevant) continue;
		if (
			selected ||
			fields.length !== 3 ||
			!/^\d+$/.test(fields[0] ?? "") ||
			!Number.isSafeInteger(Number(fields[0])) ||
			Number(fields[0]) <= 0 ||
			!/^-?\d+$/.test(fields[1] ?? "") ||
			Number(fields[0]) !== expectedPID ||
			(pinnedLabel !== undefined && label !== pinnedLabel)
		)
			throw new ReplayRefused("proof-process");
		selected = { pid: Number(fields[0]), label };
	}
	if (!selected) throw new ReplayRefused("proof-process");
	return selected;
}
export interface SampleContext {
	root: string;
	intent: CreationIntent;
	lease: OwnedSimulatorLease;
	proofPID: number;
	source: ProofBuildIdentity;
	runnerSource: string;
	executable: string;
	pinnedLabel?: string;
}
export async function sampleOwnedProof(
	context: SampleContext,
	boundary: Run,
	expiry: number,
	clock: () => number = () => performance.now(),
): Promise<LiveIdentity> {
	const started = clock();
	const run: Run = (exe, args, cap = 5000, beforeStart) => {
		const remaining = Math.floor(5000 - (clock() - started));
		if (remaining <= 0) throw new ReplayRefused("stale-sample");
		return boundary(exe, args, Math.min(cap, remaining), beforeStart);
	};
	if (Date.now() >= expiry) throw new ReplayRefused("artifact-expired");
	const intentOnDisk = JSON.parse(
		readFileSync(join(context.root, "creation-intent.json"), "utf8"),
	);
	for (const field of [
		"hostPid",
		"nonce",
		"runId",
		"name",
		"runtime",
		"deviceType",
		"templateUdid",
	] as const)
		if (intentOnDisk[field] !== context.intent[field])
			throw new ReplayRefused("intent");
	const persisted = JSON.parse(
		readFileSync(join(context.root, "simulator-lease.json"), "utf8"),
	);
	assertOwnedLease(persisted, context.lease);
	if (
		context.intent.hostPid !== process.pid ||
		context.lease.hostPid !== process.pid ||
		context.lease.udid === context.intent.templateUdid ||
		context.intent.nonce !== context.lease.nonce
	)
		throw new ReplayRefused("lease");
	const inventory = JSON.parse(
		await run("xcrun", ["simctl", "list", "devices", "--json"], 5000),
	) as {
		devices: Record<
			string,
			Array<{ udid: string; name: string; deviceTypeIdentifier: string }>
		>;
	};
	const matches = Object.entries(inventory.devices).flatMap(
		([runtime, devices]) =>
			devices
				.filter(
					(device) =>
						device.udid === context.lease.udid ||
						device.name === context.intent.name,
				)
				.map((device) => ({ ...device, runtime })),
	);
	if (
		matches.length !== 1 ||
		matches[0]?.udid !== context.lease.udid ||
		matches[0]?.name !== context.intent.name ||
		matches[0]?.runtime !== context.intent.runtime ||
		matches[0]?.deviceTypeIdentifier !== context.intent.deviceType
	)
		throw new ReplayRefused("inventory");
	const args = ["simctl", "spawn", context.lease.udid, "launchctl", "list"];
	const first = exactProcess(
		await run("xcrun", args, 5000),
		context.proofPID,
		context.pinnedLabel,
	);
	const installed = await run(
		"xcrun",
		["simctl", "get_app_container", context.lease.udid, PROOF_BUNDLE, "app"],
		5000,
	);
	const info = JSON.parse(
		await run(
			"plutil",
			["-convert", "json", "-o", "-", join(installed, "Info.plist")],
			5000,
		),
	);
	const measured: ProofBuildIdentity = {
		flavor: info.LORetirementProofFlavor,
		bundleId: info.CFBundleIdentifier,
		nonce: info.LORetirementProofNonce,
		sourceSha: info.LORetirementProofSource,
		receiverPort: Number(info.LORetirementProofReceiverPort),
		bundleSha256: immutableBundleDigest(installed),
	};
	assertProofBuild(measured, context.source);
	if (info.CFBundleExecutable !== context.executable)
		throw new ReplayRefused("installed-executable");
	const last = exactProcess(
		await run("xcrun", args, 5000),
		context.proofPID,
		first.label,
	);
	if (clock() - started > 5000 || Date.now() >= expiry)
		throw new ReplayRefused("stale-sample");
	assertOwnedLease(
		JSON.parse(
			readFileSync(join(context.root, "simulator-lease.json"), "utf8"),
		),
		context.lease,
	);
	context.pinnedLabel = last.label;
	return {
		udid: context.lease.udid,
		pid: last.pid,
		label: last.label,
		source: measured.sourceSha,
		bundle: measured.bundleSha256,
		hostSource: context.runnerSource,
	};
}
