/**
 * Run the shell commands the e2e docs tell a reader to run.
 *
 * A documented invocation that cannot work is worse than an undocumented one,
 * and this repository has already had that defect: the README named `.mjs`
 * files that are `.ts`, so every command it printed exited `MODULE_NOT_FOUND`
 * while the tools themselves were fine. Prose is not executable, so nothing
 * caught it until a reviewer typed the commands by hand.
 *
 * This is the check that makes the docs executable instead. It reads the fenced
 * shell blocks out of `docs/e2e/README.md` and, for each command in them:
 *
 *   1. **resolves what it references** — every `node <path>` must exist on disk
 *      and every `pnpm <script>` must be a script in `package.json`. This runs
 *      for EVERY command, including one this environment cannot execute, which
 *      is what makes a renamed tool a failure rather than a silent skip;
 *   2. **runs it**, unless the block declares a prerequisite this run cannot
 *      supply — and a skipped command prints SKIP *with the reason*, so a
 *      reader sees which documented commands were not proven today;
 *   3. for a command that **serves** (`docs:serves`), starts it for real and
 *      waits for the readiness the doc promises — a server printing its port —
 *      then reaps it by pid.
 *
 * Directives are comments inside the fenced block, so the doc still reads as
 * instructions to a person rather than as a test harness:
 *
 *     # docs:serves              this command starts a server and does not exit
 *     # docs:needs <token>...    this needs things the run may not have
 *     # docs:exits <code>        this command is supposed to exit <code> (1 for a
 *                              page that must fail the audit)
 *
 * Known tokens: `mock-relay` (a mock relay is started for the run), `web-build`
 * (an `expo export --platform web` output, or `--dist`), `maestro` (a booted
 * simulator or emulator) and `device` (a native build). An unknown token fails,
 * so a typo cannot turn into a skip.
 *
 * Usage:
 *   node tools/lib/doc-commands.ts [--file docs/e2e/README.md] [--dist <dir>]
 *                                  [--timeout 180] [--only <substring>]
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bool, num, parseArgs, str } from "./args.ts";
import { sweepOrphanChrome } from "./chrome.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

/**
 * The prerequisites a documented command may declare, with the sentence printed
 * when this run cannot supply one. The map is the vocabulary: a token outside it
 * is a failure, so `docs:needs web-buid` cannot silently skip a broken command.
 */
const PREREQUISITES: Record<string, string> = {
	"mock-relay": "needs a mock relay, which this run could not start",
	"web-build": "needs a web build: run `pnpm export:web`, or pass --dist <dir>",
	maestro: "needs a booted simulator or emulator, which this host has none of",
	device: "needs a native app build, which this host cannot produce",
};

interface Directives {
	/** The block "serves": it is started and killed, not awaited. */
	serves: boolean;
	/** Prerequisite tokens the block declares, space separated. */
	needs: string[];
	/** The exit code the doc itself expects; `1` documents a run that must fail. */
	exits: number;
}

interface Block {
	/** The fence's 1-based line number, so the report can point at the doc. */
	line: number;
	commands: string[];
	directives: Directives;
}

interface CommandResult {
	command: string;
	line: number;
	status: "PASS" | "FAIL" | "SKIP";
	detail: string;
}

/** Extract the fenced `sh`/`bash`/`shell` blocks, keeping their line numbers. */
export function shellBlocks(markdown: string): Block[] {
	const lines = markdown.split("\n");
	const blocks: Block[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		if (!/^```(?:sh|bash|shell)\s*$/.test(lines[i] ?? "")) continue;
		const fenceLine = i + 1;
		const body: string[] = [];
		for (i += 1; i < lines.length && !/^```\s*$/.test(lines[i] ?? ""); i += 1) {
			body.push(lines[i] ?? "");
		}
		blocks.push(parseBlock(body, fenceLine));
	}
	return blocks;
}

/**
 * Split a block into whole commands and read its directives.
 *
 * A trailing `\` continues a command onto the next line, because the docs wrap
 * long invocations that way and a reader copies the wrapped form; splitting on
 * newlines alone would run a half-command whose only sin is line length.
 */
function parseBlock(body: string[], line: number): Block {
	const directives: Directives = { serves: false, needs: [], exits: 0 };
	const commands: string[] = [];
	let current: string[] = [];
	/**
	 * Join the lines of one command, KEEPING the shell's own continuations.
	 *
	 * `current.join(" ")` was the first version, and it silently broke every
	 * backslash-continued command: `--dir x \` + `--out y` became `--dir x \ --out y`,
	 * where the escaped space glues `--out` into the *value* of `--dir`. The
	 * command then ran with no `--out` at all and exited 2, and the check reported
	 * a broken tool. A continuation that is passed through verbatim cannot do that.
	 */
	const flush = (): void => {
		const joined = current.join("").trim();
		if (joined !== "") commands.push(joined);
		current = [];
	};
	for (const raw of body) {
		const text = raw.trim();
		if (text === "" || text.startsWith("#!")) continue;
		if (text.startsWith("#")) {
			// A directive belongs to the block it sits in, so it is read here and the
			// comment itself is never executed.
			if (/^#\s*docs:serves\b/.test(text)) directives.serves = true;
			const needs = /^#\s*docs:needs\s+(.+)$/.exec(text);
			if (needs?.[1] !== undefined) {
				directives.needs = needs[1]
					.trim()
					.split(/\s+/)
					.filter((t) => t !== "");
			}
			const exits = /^#\s*docs:exits\s+(\d+)\s*$/.exec(text);
			if (exits?.[1] !== undefined) directives.exits = Number(exits[1]);
			continue;
		}
		// A continued line keeps its backslash AND its newline, so the shell reads it
		// exactly as the reader sees it in the fence.
		current.push(text.endsWith("\\") ? `${text}\n` : text);
		if (!text.endsWith("\\")) flush();
	}
	flush();
	return { line, commands, directives };
}

/** The `node <path>` files and `pnpm <script>` names a command references. */
export function references(command: string): {
	paths: string[];
	scripts: string[];
} {
	const paths: string[] = [];
	const scripts: string[] = [];
	for (const match of command.matchAll(/\bnode\s+(\S+)/g)) {
		const path = match[1] ?? "";
		// A variable or a substitution is resolved at run time; only a literal
		// path can be checked here, and asserting on a literal is the point.
		if (path !== "" && !path.startsWith("$") && !path.includes("$")) {
			paths.push(path);
		}
	}
	for (const match of command.matchAll(
		/\bpnpm\s+(?:run\s+)?([a-z][\w:.-]*)/g,
	)) {
		const name = match[1] ?? "";
		if (name !== "" && name !== "install" && name !== "exec")
			scripts.push(name);
	}
	return { paths, scripts };
}

/**
 * Every descendant of `pid`, deepest first.
 *
 * Read from `ps` rather than from `pgrep -P`, because the interesting case is the
 * one `pgrep -P` cannot see: a grandchild whose parent has already exited, so it
 * has been re-parented to launchd and no longer appears as anyone's child. Matching
 * on the command line instead would be a kill by pattern, which this host forbids
 * for good reason; the tree of pids this run actually created is exact.
 */
function descendants(pid: number): number[] {
	const listed = spawnSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
	const childrenOf = new Map<number, number[]>();
	for (const line of (listed.stdout ?? "").split("\n")) {
		const [child, parent] = line.trim().split(/\s+/).map(Number);
		if (!child || parent === undefined || Number.isNaN(parent)) continue;
		childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
	}
	const out: number[] = [];
	const walk = (root: number): void => {
		for (const child of childrenOf.get(root) ?? []) {
			walk(child);
			out.push(child);
		}
	};
	walk(pid);
	return out;
}

/** Start a mock relay on an ephemeral port and read the port it prints. */
async function startMockRelay(): Promise<{ url: string; pid: number } | null> {
	const relay = join(REPO, "tools", "mock-relay", "relay.ts");
	if (!existsSync(relay)) return null;
	const child = spawn(
		process.execPath,
		[relay, "--scenario", "idle", "--print-port", "--quiet"],
		{ cwd: REPO, stdio: ["ignore", "pipe", "pipe"] },
	);
	// `--print-port` puts the port alone on stdout and every diagnostic on stderr,
	// so the first stdout line is the port. Reading it by event rather than by
	// polling keeps this from spinning a process per iteration.
	const port = await new Promise<number | null>((done) => {
		let out = "";
		const timer = setTimeout(() => done(null), 15_000);
		const finish = (value: number | null): void => {
			clearTimeout(timer);
			done(value);
		};
		child.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
			const line = out.split("\n")[0]?.trim() ?? "";
			if (/^\d+$/.test(line)) finish(Number(line));
		});
		child.on("exit", () => finish(null));
	});
	if (port === null) {
		try {
			child.kill("SIGKILL");
		} catch {
			// Nothing to kill: it never started.
		}
		return null;
	}
	return { url: `http://127.0.0.1:${port}`, pid: child.pid ?? -1 };
}

/** Replace the placeholders a doc uses with this run's real values. */
function substitute(command: string, values: Record<string, string>): string {
	let out = command;
	for (const [token, value] of Object.entries(values)) {
		if (value === "") continue;
		out = out.split(token).join(value);
	}
	return out;
}

async function runCommand(
	command: string,
	block: Block,
	values: Record<string, string>,
	timeoutMs: number,
	verbose = false,
): Promise<CommandResult> {
	const text = substitute(command, values);
	if (block.directives.serves) {
		// A serving command is started, not awaited: what the doc promises is that
		// it comes up, and a server that never answers is what this catches. The
		// readiness signal is the one the doc itself describes — a printed port, or
		// the relay's own `listening` line.
		// `detached` puts the command in its OWN process group, which is what makes
		// the reap below complete: the documented forms are `pnpm <script>`, and pnpm
		// runs the real tool as a GRANDCHILD (sh → pnpm → node). Killing the child by
		// pid left the server running — two orphaned relays survived a whole gate run
		// — so the group is signalled, and the descendant sweep stays as a belt.
		const child = spawn("/bin/sh", ["-c", text], {
			cwd: REPO,
			env: { ...process.env, LOCAL_OPERATOR_SCRATCHPAD: values.$SCRATCH },
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		const pid = child.pid ?? 0;
		const outcome = await new Promise<{ ready: boolean; out: string }>(
			(done) => {
				let out = "";
				let settled = false;
				const finish = (ready: boolean): void => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					done({ ready, out });
				};
				const timer = setTimeout(() => finish(false), timeoutMs);
				const collect = (chunk: Buffer): void => {
					out += chunk.toString("utf8");
					if (/^\d+$/m.test(out) || /listening|http:\/\//i.test(out))
						finish(true);
				};
				child.stdout.on("data", collect);
				child.stderr.on("data", collect);
				// A server that exits before it serves is a failure, not a quick success.
				child.on("exit", () => finish(false));
			},
		);
		// The reap has to reach a GRANDCHILD that has been re-parented to launchd:
		// `pnpm mock:relay` is sh → pnpm → node, and a `--print-port` relay survived a
		// whole gate run because killing the child by pid (and even its process group)
		// left the node process with ppid 1. The tree is therefore read and killed
		// deepest-first, then the group is signalled as a belt.
		for (const descendant of descendants(pid)) {
			try {
				process.kill(descendant, "SIGKILL");
			} catch {
				// Already gone.
			}
		}
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// The group is gone, which is the expected case.
		}
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already exited.
		}
		return outcome.ready
			? {
					command: text,
					line: block.line,
					status: "PASS",
					detail: "started and reached its ready state",
				}
			: {
					command: text,
					line: block.line,
					status: "FAIL",
					detail: `did not reach a ready state within ${timeoutMs / 1000} s; output: ${outcome.out.slice(-200)}`,
				};
	}
	const run = spawnSync("/bin/sh", ["-c", text], {
		cwd: REPO,
		env: { ...process.env, LOCAL_OPERATOR_SCRATCHPAD: values.$SCRATCH },
		encoding: "utf8",
		timeout: timeoutMs,
	});
	if (run.error !== undefined) {
		return {
			command: text,
			line: block.line,
			status: "FAIL",
			detail: run.error.message,
		};
	}
	if (run.signal !== null) {
		return {
			command: text,
			line: block.line,
			status: "FAIL",
			detail: `killed by ${run.signal} after ${timeoutMs / 1000} s`,
		};
	}
	const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
	// The expected exit code is the doc's own claim: a command documented as "the
	// defect page must fail" exits 1 on purpose, and treating that as a failure
	// would force the doc to stop telling the truth about what it does.
	if (run.status === block.directives.exits) {
		return {
			command: text,
			line: block.line,
			status: "PASS",
			detail:
				block.directives.exits === 0
					? (output
							.split("\n")
							.filter((l) => l.trim() !== "")[0]
							?.slice(0, 96) ?? "")
					: `exit ${run.status}, as the doc documents`,
		};
	}
	return {
		command: text,
		line: block.line,
		status: "FAIL",
		detail: `exit ${run.status}, expected ${block.directives.exits}: ${
			verbose ? output.slice(-2000) : output.slice(-800)
		}`,
	};
}

async function main(): Promise<void> {
	const { flags } = parseArgs(process.argv.slice(2));
	const file = str(flags, "file", "docs/e2e/README.md") ?? "docs/e2e/README.md";
	const dist = str(flags, "dist", undefined);
	const only = str(flags, "only", undefined);
	// `pnpm e2e:relay` (which is `verify`) is the slowest documented command, and its
	// runtime is LOAD-DEPENDENT: 28 minutes measured on this host at load averages 32-46,
	// ~13 minutes on a quiet one. `docs/e2e/README.md` states that figure and this bound
	// is sized above it, because a bound below a documented command's real runtime reports
	// the command as broken, which is worse than no bound. If you change the figure, change
	// it in the README, here, and in `verify.ts`'s watchdog comment together.
	const timeoutMs = num(flags, "timeout", 2400) * 1000;
	const verbose = bool(flags, "verbose");
	const path = resolve(REPO, file);
	if (!existsSync(path)) {
		console.error(`doc-commands: no such file: ${file}`);
		process.exit(2);
	}
	if (dist !== undefined && !existsSync(resolve(REPO, dist))) {
		console.error(`doc-commands: --dist ${dist} does not exist`);
		process.exit(2);
	}
	if (
		dist !== undefined &&
		!existsSync(join(resolve(REPO, dist), "index.html"))
	) {
		console.error(
			`doc-commands: --dist ${dist} has no index.html, so it is not a web export`,
		);
		process.exit(2);
	}

	const blocks = shellBlocks(readFileSync(path, "utf8"));
	if (blocks.length === 0) {
		// A doc with no shell block is a doc this check cannot vouch for, and a
		// silently empty run is how a runner reports success while proving nothing.
		console.error(`doc-commands: ${file} has no fenced shell blocks to run`);
		process.exit(2);
	}

	// The package's own scripts, so `pnpm e2e:verify` in the docs is checked
	// against what the package actually defines.
	const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
		scripts?: Record<string, string>;
	};
	const scripts = Object.keys(pkg.scripts ?? {});

	const needsRelay = blocks.some((b) =>
		b.directives.needs.includes("mock-relay"),
	);
	const relay = needsRelay ? await startMockRelay() : null;
	const scratch = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "doc-commands-"),
	);
	const values: Record<string, string> = {
		$SCRATCH: scratch,
		$MOCK_URL: relay?.url ?? "",
		"<mock-url>": relay?.url ?? "",
		"<mock-port>": relay === null ? "" : String(new URL(relay.url).port),
		"<dist>": dist === undefined ? "" : resolve(REPO, dist),
	};

	const results: CommandResult[] = [];
	try {
		for (const block of blocks) {
			const needs = block.directives.needs;
			// Every token must be one of the known prerequisites, so a typo fails the
			// check instead of quietly turning the block into a skip.
			const unknown = needs.filter((token) => !(token in PREREQUISITES));
			// A `web-build` block becomes runnable when `--dist` supplies the build, and
			// a `mock-relay` block when this run managed to start one; the rest are
			// recorded skips rather than silent passes.
			const unavailable = needs.filter((token) =>
				token === "mock-relay"
					? relay === null
					: token === "web-build"
						? dist === undefined
						: true,
			);
			for (const command of block.commands) {
				if (only !== undefined && !command.includes(only)) continue;
				// Reference resolution runs for EVERY command, including a skipped one:
				// this is the assertion that catches a renamed tool in a line this
				// environment never executes.
				const refs = references(command);
				const badPaths = refs.paths
					.filter((p) => !existsSync(resolve(REPO, p)))
					.map((p) => `node ${p}: no such file`);
				const badScripts = refs.scripts
					.filter((s) => !scripts.includes(s))
					.map((s) => `pnpm ${s}: no such script in package.json`);
				if (badPaths.length > 0 || badScripts.length > 0) {
					results.push({
						command,
						line: block.line,
						status: "FAIL",
						detail: [...badPaths, ...badScripts].join("; "),
					});
					continue;
				}
				if (unknown.length > 0) {
					results.push({
						command,
						line: block.line,
						status: "FAIL",
						detail: `unknown prerequisite(s) ${unknown.join(", ")}; known: ${Object.keys(PREREQUISITES).join(", ")}`,
					});
					continue;
				}
				if (unavailable.length > 0) {
					results.push({
						command,
						line: block.line,
						status: "SKIP",
						detail: unavailable.map((token) => PREREQUISITES[token]).join("; "),
					});
					continue;
				}
				results.push(
					await runCommand(command, block, values, timeoutMs, verbose),
				);
			}
		}
	} finally {
		// The gate runs commands that launch Chrome, and a CANCELLED gate leaves those
		// browsers behind: they are spawned detached and cannot reap themselves when their
		// parent is killed. Sweeping the run directory covers the orderly case; the
		// self-healing case is every later run's `close()`, which sweeps the same root.
		if (values.$SCRATCH !== undefined) sweepOrphanChrome(values.$SCRATCH);
		if (relay !== null && relay.pid > 0) {
			try {
				process.kill(relay.pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		}
		rmSync(scratch, { recursive: true, force: true });
	}

	const failed = results.filter((r) => r.status === "FAIL");
	const skipped = results.filter((r) => r.status === "SKIP");
	const passed = results.filter((r) => r.status === "PASS");
	console.log(`\ndoc commands: ${file} (${blocks.length} shell blocks)`);
	for (const result of results) {
		console.log(
			`  ${result.status.padEnd(4)} L${result.line}  ${result.command.slice(0, 100)}`,
		);
		if (result.status !== "PASS" || verbose)
			console.log(`        ${result.detail}`);
	}
	console.log(
		`\n${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed`,
	);
	if (skipped.length > 0) {
		console.log(
			"a skipped command is not proven by this run; its tool paths were still resolved",
		);
	}
	process.exit(failed.length === 0 ? 0 : 1);
}

await main();
