import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertProofCI } from "./account-routing-proof-contract.ts";

export type Lease = { pid: number; child: ChildProcess; stop(): Promise<void> };
export type RunRecord = {
	name: string;
	command: string;
	rc: number;
	elapsedMs: number;
};

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
		try {
			process.kill(-lease.pid, "SIGKILL");
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ESRCH")
			)
				throw error;
		}
		this.leases.delete(lease);
	}
	async start(
		name: string,
		command: string,
		args: string[],
		extra: Partial<NodeJS.ProcessEnv> = {},
	): Promise<{ lease: Lease; output: () => string; done: Promise<number> }> {
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
				writeFileSync(log, this.redact(output));
				resolve(code ?? 128);
			});
		});
		// Redact the accumulated stream, not chunks: a synthetic credential
		// can straddle pipe chunks and must never reach an artifact log.
		return { lease, output: () => this.redact(output), done };
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
		try {
			const rc = await Promise.race([
				operation.done,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						void operation.lease
							.stop()
							.finally(() => reject(new Error(`${name} deadline exceeded`)));
					}, timeout * 1000);
				}),
			]);
			this.records.push({ name, command, rc, elapsedMs: Date.now() - started });
			if (rc !== 0)
				throw new Error(
					`${name} failed rc=${rc}; see credential-free owned command log`,
				);
			return operation.output();
		} finally {
			if (timer) clearTimeout(timer);
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
