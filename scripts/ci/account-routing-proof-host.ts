import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertProofCI } from "./account-routing-proof-contract.ts";

export type Lease = { pid: number; child: ChildProcess; stop(): Promise<void> };
export type RunRecord = {
	name: string;
	command: string;
	/** `null` when the child was killed by its own deadline, which has no exit code. */
	rc: number | null;
	elapsedMs: number;
	deadlineExceeded?: boolean;
	capSeconds?: number;
	clampedByStageBudget?: boolean;
};

/** Last non-empty line of already-redacted child output, for the failure
 * message. `simctl` reports an already-shutdown device on stderr, so a teardown
 * tolerance needs the text without the caller reading a whole log. */
function lastLine(output: string) {
	const lines = output
		.trimEnd()
		.split("\n")
		.filter((line) => line.trim());
	return lines.at(-1)?.trim().slice(0, 300) ?? "no output";
}

/** A killed child has no exit code; naming the deadline (and what it had emitted)
 * is what keeps a slow cold start from reading as a tool failure. */
export function timedOutMessage(name: string, elapsedMs: number, cap: number) {
	return `deadline exceeded (${name}, ${elapsedMs}ms, cap=${cap}s)`;
}

/** Teardown that has nothing left to do is a SUCCESS, not a failure.
 *
 * `simctl shutdown` on an already-shutdown device and `simctl delete` on a
 * device already removed both exit non-zero with a specific message. Treating
 * those as cleanup failures would mark an otherwise clean run unreaped, so they
 * are matched on the DEVICE-MISSING shape specifically — not a blanket "any
 * error in teardown is fine", which would hide a genuinely stuck simulator.
 */
const TEARDOWN_NOTHING_TO_DO =
	/Unable to find device|Invalid device(?: state)?|in current state:\s*shutdown|already (?:shut ?down|deleted)|is not (?:booted|shut ?down)/i;

export function tolerableTeardown(error: unknown) {
	if (!(error instanceof Error)) return false;
	// Deployment-time wording lives in the child's flushed output, which the
	// timeout/exit paths both surface; a deadline is never tolerated.
	if (error.message.includes("deadline exceeded")) return false;
	return TEARDOWN_NOTHING_TO_DO.test(error.message);
}

/** All real execution is behind the dedicated-host fence. Unit tests inject
 * operations instead; importing this module never starts mDNS/native tooling. */
export class ProofHost {
	readonly records: RunRecord[] = [];
	readonly leases = new Set<Lease>();
	readonly env: NodeJS.ProcessEnv;
	private sequence = 0;
	private readonly deadline: number;
	private cleaning = false;
	beginCleanup() {
		this.cleaning = true;
	}
	readonly root: string;
	readonly cwd: string;
	readonly secrets: string[];
	constructor(
		root: string,
		cwd: string,
		seconds: number,
		secrets: string[],
		env: NodeJS.ProcessEnv = process.env,
	) {
		this.root = root;
		this.cwd = cwd;
		this.secrets = secrets;
		assertProofCI(env);
		this.deadline = Date.now() + seconds * 1000;
		mkdirSync(join(root, "commands"), { recursive: true });
		this.env = {
			NODE_ENV: "production",
			...Object.fromEntries(
				Object.entries(env).filter(([name]) =>
					[
						"PATH",
						"JAVA_HOME",
						"DEVELOPER_DIR",
						"SDKROOT",
						"GEM_HOME",
						"GEM_PATH",
						"LANG",
						"LC_ALL",
						"CI",
						"GITHUB_ACTIONS",
						"GITHUB_REPOSITORY",
						"GITHUB_EVENT_NAME",
						"GITHUB_SHA",
						"GITHUB_RUN_ID",
						"GITHUB_REF_TYPE",
						"GITHUB_REF_NAME",
						"GITHUB_REF",
						"GITHUB_RUN_NUMBER",
						"GITHUB_RUN_ATTEMPT",
						"RUNNER_ENVIRONMENT",
						"RUNNER_OS",
						"RUNNER_TEMP",
						"LOH12_NATIVE_PROOF_ADMITTED",
						"PROOF_MODE",
						"PROOF_STAGE",
					].includes(name),
				),
			),
		};
		Object.assign(this.env, {
			HOME: join(root, "home"),
			LOCAL_OPERATOR_CONFIG_DIR: join(root, "home/.local-operator"),
			LOCAL_OPERATOR_SCRATCHPAD: root,
			TMPDIR: join(root, "tmp"),
			COREPACK_HOME:
				env.COREPACK_HOME ?? join(env.HOME ?? "", ".cache/node/corepack"),
			COREPACK_ENABLE_NETWORK: "0",
			PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "error",
			GIT_CONFIG_SYSTEM: "/dev/null",
			GIT_TERMINAL_PROMPT: "0",
			GIT_ASKPASS: "/bin/false",
			PYTHONDONTWRITEBYTECODE: "1",
			LOP_LANG: "en",
		});
		mkdirSync(this.env.HOME ?? "", { recursive: true, mode: 0o700 });
		mkdirSync(this.env.TMPDIR ?? "", { recursive: true, mode: 0o700 });
	}
	redact(value: string) {
		let output = value;
		for (const secret of this.secrets)
			if (secret)
				output = output.replaceAll(secret, "<owned-fixture-value-redacted>");
		return output;
	}
	remaining(cap: number) {
		if (this.cleaning) return cap;
		const seconds = Math.min(cap, (this.deadline - Date.now()) / 1000);
		if (seconds <= 0)
			throw new Error("targeted proof overall deadline expired");
		return seconds;
	}
	/** True when the stage budget, not the requested cap, is the binding limit.
	 * A silent clamp is what turns "the cold service needed longer" into "the
	 * tool failed", so the caller records this instead of hiding it. */
	clamped(cap: number) {
		return !this.cleaning && this.remaining(cap) < cap;
	}
	async stop(lease: Lease) {
		if (!this.leases.has(lease)) return;
		try {
			process.kill(-lease.pid, "SIGTERM");
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ESRCH")
			)
				throw error;
		}
		await Promise.race([
			new Promise<void>((done) => lease.child.once("exit", () => done())),
			new Promise<void>((done) => setTimeout(done, 700)),
		]);
		// SIGKILL is asynchronous: `close` fires after it, and a handler that runs
		// after the caller has moved on (or removed the run root) throws an
		// uncaught exception that can mask a real proof result. Reap to `close`
		// here, bounded, so `stop()` returning means the child is fully gone.
		const closed = new Promise<void>((done) => {
			if (lease.child.exitCode !== null || lease.child.signalCode !== null)
				done();
			else lease.child.once("close", () => done());
		});
		try {
			process.kill(-lease.pid, "SIGKILL");
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ESRCH")
			)
				throw error;
		}
		await Promise.race([
			closed,
			new Promise<void>((done) => setTimeout(done, 2000)),
		]);
		this.leases.delete(lease);
	}
	async start(
		name: string,
		command: string,
		args: string[],
		extra: Partial<NodeJS.ProcessEnv> = {},
	): Promise<{
		lease: Lease;
		output: () => string;
		done: Promise<number>;
		log: string;
	}> {
		this.remaining(1);
		const child = spawn(command, args, {
			cwd: this.cwd,
			env: { ...this.env, ...extra },
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		await new Promise<void>((ready, fail) => {
			child.once("spawn", ready);
			child.once("error", fail);
		});
		if (!child.pid) throw new Error(`could not start owned ${name}`);
		const log = join(this.root, "commands", `${++this.sequence}-${name}.log`);
		let output = "";
		const collect = (chunk: Buffer) => {
			output += chunk.toString("utf8");
			if (output.length > 32 * 1024 * 1024) {
				output = output.slice(0, 32 * 1024 * 1024);
				void this.stop(lease);
			}
		};
		child.stdout?.on("data", collect);
		child.stderr?.on("data", collect);
		const lease: Lease = {
			pid: child.pid,
			child,
			stop: async () => this.stop(lease),
		};
		this.leases.add(lease);
		const done = new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code) => {
				// Best-effort diagnostic write: the run root may already be gone
				// (owner cleanup), which must not become an uncaught exception.
				try {
					writeFileSync(log, this.redact(output));
				} catch {
					/* the canonical flush in run() already recorded what it could */
				}
				resolve(code ?? 128);
			});
		});
		// Redact the accumulated stream, not chunks: a synthetic credential
		// can straddle pipe chunks and must never reach an artifact log.
		return { lease, output: () => this.redact(output), done, log };
	}
	async run(
		name: string,
		command: string,
		args: string[],
		cap = 60,
		extra: Partial<NodeJS.ProcessEnv> = {},
	) {
		const started = Date.now();
		const timeout = this.remaining(cap);
		const operation = await this.start(name, command, args, extra);
		let timer: ReturnType<typeof setTimeout> | undefined;
		// A kill is NOT an exit code. `stop()` closes the child, which resolves
		// `done` as `code ?? 128`, and that resolution can land before this
		// rejection — so the deadline must be recorded in its own flag rather
		// than inferred from the race winner (CI 38842647133 reported a 60s
		// deadline kill as a misleading `rc=128` with an empty log).
		let timedOut = false;
		let recorded = false;
		const recordDeadline = () => {
			if (recorded) return;
			recorded = true;
			this.records.push({
				name,
				command,
				rc: null,
				elapsedMs: Date.now() - started,
				deadlineExceeded: true,
				capSeconds: cap,
				clampedByStageBudget: Math.round(timeout) < cap,
			});
		};
		try {
			const rc = await Promise.race([
				operation.done,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						timedOut = true;
						// Record BEFORE rejecting: when this rejection wins the race
						// the code after `await` never runs, so a record pushed only
						// there left `records` empty on the very path it describes
						// (found by repetition: the failure was intermittent because
						// it depended on which side of the race resolved first).
						recordDeadline();
						void operation.lease
							.stop()
							.catch(() => undefined)
							.finally(() =>
								reject(
									new Error(
										timedOutMessage(
											name,
											Date.now() - started,
											Math.round(timeout),
										),
									),
								),
							);
					}, timeout * 1000);
				}),
			]);
			if (timedOut) {
				recordDeadline();
				throw new Error(
					timedOutMessage(name, Date.now() - started, Math.round(timeout)),
				);
			}
			recorded = true;
			this.records.push({ name, command, rc, elapsedMs: Date.now() - started });
			if (rc !== 0)
				throw new Error(
					`${name} failed rc=${rc}: ${lastLine(operation.output())}; see credential-free owned command log`,
				);
			return operation.output();
		} finally {
			if (timer) clearTimeout(timer);
			// Flush whatever the child produced before the kill so a timeout keeps
			// its partial evidence, with the same redaction as a normal exit.
			writeFileSync(operation.log, this.redact(operation.output()));
			await operation.lease.stop();
		}
	}
	async cleanup() {
		for (const lease of [...this.leases].reverse()) await lease.stop();
		writeFileSync(
			join(this.root, "commands.json"),
			JSON.stringify(this.records, null, 2),
		);
	}
}
