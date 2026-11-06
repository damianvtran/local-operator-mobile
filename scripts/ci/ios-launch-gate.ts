#!/usr/bin/env node
/**
 * The judgements behind the iOS launch gate (`.github/workflows/ios.yml`, job
 * `ios`): is the launched app still RUNNING, did its launch write a CRASH
 * REPORT, did its own output carry a FATAL, and how much of the screen changed.
 *
 *     node scripts/ci/ios-launch-gate.ts alive --udid <udid> --bundle <id> --at t+5s [--running-since <epoch s>]
 *     node scripts/ci/ios-launch-gate.ts alive --launchctl-file <listing> --bundle <id> --at t+5s
 *     node scripts/ci/ios-launch-gate.ts crash-report --dir <dir> [--dir <dir>…] --executable <name> --since <epoch s> [--bundle <id>] [--wait <s>]
 *     node scripts/ci/ios-launch-gate.ts fatal-lines <file>...
 *     node scripts/ci/ios-launch-gate.ts frame-delta <a.bmp> <b.bmp>
 *
 * WHY THIS EXISTS. Builds 419 (a21aa8d2), 446 (8189f21a) and 449 (d7f66279)
 * crashed at launch, passed the simulator job, and shipped to TestFlight. The
 * job's own `ios-release.png` for each is the home screen with the app's icon
 * on it. It judged "the app rendered" from a frame being different from a
 * pre-install capture, and "no fatal" from a log grep for JavaScript fatals; a
 * NATIVE abort passes both. That crash was a C++ exception react-native-worklets
 * threw on the UI runtime (`[Worklets] Tried to synchronously call a Remote
 * Function`, fixed in #168), which terminates the process without React
 * Native's JavaScript fatal path ever running. So the primary judgement is now
 * whether the PROCESS is alive, and a crash report, when one exists, is printed
 * with its stack instead of being left on the runner.
 *
 * The workflow does the simulator I/O and this file does the parsing and the
 * judging, so every judgement is exercised by `ios-launch-gate.test.ts` on a
 * machine with no Xcode — `--launchctl-file` stands in for the simulator the
 * way `ios-project.ts --json-file` stands in for `xcodebuild`.
 *
 * Run directly by Node (type-stripping, no build step, no dependency).
 */

import { execFileSync } from "node:child_process";
import {
	type Dirent,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { basename, join } from "node:path";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const WHITESPACE = /\s+/;
const DIGITS = /^\d+$/;
const SIGNED_INTEGER = /^-?\d+$/;

const escapeRegExp = (text: string): string =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Liveness: `launchctl list` inside the simulator.
// ---------------------------------------------------------------------------

/** A `launchctl list` row that is the app's own job. */
export type AppJob = {
	/** The job's running process, or `null` when it has none (the column reads `-`). */
	pid: number | null;
	/** The last-exit-status column, verbatim: `0`, `-6`, `-`. */
	status: string;
	label: string;
};

/**
 * WHERE THE APP'S PROCESS SHOWS UP. An app the simulator launches runs as a
 * launchd job labelled `UIKitApplication:<bundle id>[<hex>][rb-legacy]`, and
 * `launchctl list` prints three whitespace-separated columns — PID, last exit
 * status, label — where the PID column holds a number only "if it is running"
 * and a negative status "represents the negative of the signal which stopped
 * the job" (launchctl(1), `list`). Some references print the label with a
 * `com.apple.` prefix, so the prefix is tolerated, but the bundle id must be
 * followed by `[` or the end of the label: `com.example.app` must not match the
 * job of `com.example.app.widget`.
 */
export const isAppJobLabel = (label: string, bundle: string): boolean =>
	new RegExp(`(?:^|\\.)UIKitApplication:${escapeRegExp(bundle)}(?:\\[|$)`).test(
		label,
	);

export const appJobs = (listing: string, bundle: string): AppJob[] => {
	const jobs: AppJob[] = [];
	for (const line of listing.split("\n")) {
		const [pid, status, ...rest] = line.trim().split(WHITESPACE);
		const label = rest.join(" ");
		if (!pid || !status || !label || !isAppJobLabel(label, bundle)) continue;
		const running = DIGITS.test(pid) && Number(pid) > 0;
		jobs.push({ pid: running ? Number(pid) : null, status, label });
	}
	return jobs;
};

const SIGNALS: Record<number, string> = {
	1: "SIGHUP",
	2: "SIGINT",
	3: "SIGQUIT",
	4: "SIGILL",
	5: "SIGTRAP",
	6: "SIGABRT",
	8: "SIGFPE",
	9: "SIGKILL",
	10: "SIGBUS",
	11: "SIGSEGV",
	13: "SIGPIPE",
	15: "SIGTERM",
};

/** The last-exit-status column in words (launchctl(1): negative = signal). */
export const describeStatus = (status: string): string => {
	if (!SIGNED_INTEGER.test(status)) return "no exit status recorded";
	const code = Number(status);
	if (code >= 0) return `last exit status ${code}`;
	const name = SIGNALS[-code];
	return `stopped by signal ${-code}${name ? ` (${name})` : ""}`;
};

const APP_JOB = "UIKitApplication:";

export type Liveness = { alive: boolean; lines: string[] };

/**
 * Is the app running at this moment? A job WITH a PID is the only positive
 * answer: a job whose PID column is `-` has no process (it exited, and its
 * status says how), and no job at all means it is gone or never started.
 *
 * When the answer is no, every `UIKitApplication:` row the listing does carry
 * is printed too. A crash produces no such row for this app; a launchd label
 * format this parser does not know would produce a row it failed to match, and
 * that row in the log is what tells the two apart without a rerun.
 */
export const judgeLiveness = (
	listing: string,
	bundle: string,
	at: string,
	elapsed = "",
): Liveness => {
	const jobs = appJobs(listing, bundle);
	const running = jobs.find((job) => job.pid !== null);
	if (running) {
		return {
			alive: true,
			lines: [
				`alive at ${at}${elapsed}: ${bundle} is running as pid ${running.pid} (launchd job ${running.label})`,
			],
		};
	}
	const lines = [
		`::error::${bundle} is not running at ${at}${elapsed}: launchctl in the simulator lists no ${APP_JOB}${bundle} job with a pid, so the app exited (or never started) after launch. The crash-report and fatal-scan steps print why.`,
	];
	for (const job of jobs) {
		lines.push(
			`  launchd job ${job.label}: no process, ${describeStatus(job.status)}`,
		);
	}
	if (jobs.length === 0) {
		const others = listing
			.split("\n")
			.filter((line) => line.includes(APP_JOB))
			.slice(0, 20);
		lines.push(
			others.length > 0
				? `  the ${APP_JOB} jobs it does list (none is ${bundle}):`
				: `  it lists no ${APP_JOB} job at all`,
		);
		for (const line of others) lines.push(`    ${line.trim()}`);
	}
	return { alive: false, lines };
};

// ---------------------------------------------------------------------------
// Crash reports: `.ips` files on the HOST.
// ---------------------------------------------------------------------------

/**
 * WHERE AND WHAT. A simulated app is a host process, so its crash report is
 * written on the host, to `~/Library/Logs/DiagnosticReports/<executable>-<date>.ips`.
 * Since iOS 15 / macOS 12 an `.ips` file holds TWO JSON objects: the metadata
 * on the first line (`bug_type` 309 is a crash), then the report — `exception`,
 * `termination`, `asi`, `faultingThread`, `threads[].frames[]`, `usedImages[]`
 * (Apple, "Interpreting the JSON format of a crash report"). Every field is
 * read defensively: a report this parser cannot read is still a report, and
 * its raw head is printed rather than swallowed.
 */
export type IpsReport = {
	header: Record<string, unknown> | null;
	body: Record<string, unknown> | null;
};

const parseJsonRecord = (text: string): Record<string, unknown> | null => {
	try {
		const value: unknown = JSON.parse(text);
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
};

export const parseIps = (text: string): IpsReport => {
	const newline = text.indexOf("\n");
	const head = newline === -1 ? text : text.slice(0, newline);
	const rest = newline === -1 ? "" : text.slice(newline + 1);
	return { header: parseJsonRecord(head), body: parseJsonRecord(rest) };
};

const text = (value: unknown): string =>
	typeof value === "string" || typeof value === "number" ? String(value) : "";

const formatFrame = (frame: unknown, index: number, images: unknown[]) => {
	const f = isRecord(frame) ? frame : {};
	const image =
		typeof f.imageIndex === "number" && isRecord(images[f.imageIndex])
			? text((images[f.imageIndex] as Record<string, unknown>).name) || "???"
			: "???";
	const where =
		typeof f.symbol === "string"
			? `${f.symbol}${typeof f.symbolLocation === "number" ? ` + ${f.symbolLocation}` : ""}`
			: typeof f.imageOffset === "number"
				? `+ 0x${f.imageOffset.toString(16)}`
				: "(no symbol)";
	return `    ${String(index).padEnd(3)} ${image.padEnd(30)} ${where}`;
};

/** The lines a reader of the job log needs to start on a crash: what killed
 * the process, the application-specific message, and the crashed thread's top
 * frames (plus the last exception backtrace, when the runtime recorded one). */
export const summarizeCrashReport = (raw: string, frames = 12): string[] => {
	const { header, body } = parseIps(raw);
	const rawHead = raw.split("\n").slice(0, 40);
	if (!header) {
		return [
			"  the first line is not the JSON metadata an .ips report starts with; its first lines:",
			...rawHead.map((line) => `    ${line}`),
		];
	}
	const lines = [
		`  report type: bug_type ${text(header.bug_type) || "?"}${text(header.bug_type) === "309" ? " (crash)" : ""}`,
		`  process: ${text(body?.procName) || text(header.name) || text(header.app_name) || "?"}${body && text(body.pid) ? ` [${text(body.pid)}]` : ""}, ${text(header.bundleID) || "no bundle id"} ${text(header.app_version)} (${text(header.build_version)})`,
	];
	if (!body) {
		lines.push(
			"  the report body is not JSON; the file's first lines:",
			...rawHead.map((line) => `    ${line}`),
		);
		return lines;
	}
	const exception = isRecord(body.exception) ? body.exception : null;
	if (exception) {
		lines.push(
			`  exception: ${text(exception.type) || "?"}${text(exception.signal) ? ` (${text(exception.signal)})` : ""}${text(exception.subtype) ? ` — ${text(exception.subtype)}` : ""}${text(exception.message) ? ` — ${text(exception.message)}` : ""}`,
		);
	}
	const termination = isRecord(body.termination) ? body.termination : null;
	if (termination) {
		const reason = [
			termination.namespace,
			termination.code,
			termination.indicator,
		]
			.map(text)
			.filter(Boolean)
			.join(" ");
		const by = text(termination.byProc)
			? ` (by ${text(termination.byProc)}${text(termination.byPid) ? `[${text(termination.byPid)}]` : ""})`
			: "";
		lines.push(`  termination: ${reason || "?"}${by}`);
		if (Array.isArray(termination.reasons)) {
			for (const item of termination.reasons)
				lines.push(`    reason: ${text(item)}`);
		}
	}
	// "Application Specific Information": where an abort() leaves its message,
	// for a C++ terminate the exception's type and what().
	if (isRecord(body.asi)) {
		lines.push("  application specific information:");
		for (const [image, messages] of Object.entries(body.asi)) {
			for (const item of Array.isArray(messages) ? messages : [messages]) {
				lines.push(`    ${image}: ${text(item)}`);
			}
		}
	}
	const images = Array.isArray(body.usedImages) ? body.usedImages : [];
	if (Array.isArray(body.lastExceptionBacktrace)) {
		lines.push(
			`  last exception backtrace, top ${frames} frames:`,
			...body.lastExceptionBacktrace
				.slice(0, frames)
				.map((frame, i) => formatFrame(frame, i, images)),
		);
	}
	const threads = Array.isArray(body.threads) ? body.threads : [];
	const index =
		typeof body.faultingThread === "number"
			? body.faultingThread
			: threads.findIndex(
					(thread) => isRecord(thread) && thread.triggered === true,
				);
	const thread = isRecord(threads[index])
		? (threads[index] as Record<string, unknown>)
		: null;
	if (!thread) {
		lines.push("  the report names no crashed thread");
		return lines;
	}
	const named = [
		text(thread.name) && `name ${text(thread.name)}`,
		text(thread.queue) && `queue ${text(thread.queue)}`,
	]
		.filter(Boolean)
		.join(", ");
	lines.push(
		`  crashed thread ${index}${named ? ` (${named})` : ""}, top ${frames} frames:`,
	);
	const threadFrames = Array.isArray(thread.frames) ? thread.frames : [];
	lines.push(
		...threadFrames
			.slice(0, frames)
			.map((frame, i) => formatFrame(frame, i, images)),
	);
	return lines;
};

/** Does this report's metadata name the app? A report whose metadata cannot be
 * read is kept — the file name already matched, and dropping a crash report
 * because it looks unusual is the failure this gate exists to stop. */
const namesTheApp = (
	header: Record<string, unknown> | null,
	executable: string,
	bundle: string | undefined,
): boolean => {
	if (!header) return true;
	const names = [header.name, header.app_name].map(text).filter(Boolean);
	const bundleId = text(header.bundleID);
	if (names.length === 0 && !bundleId) return true;
	return (
		names.includes(executable) ||
		(bundle !== undefined && bundleId !== "" && bundleId === bundle)
	);
};

/** Files in `dir` and in its subdirectories down to `depth` levels (the report
 * writer files older reports under `Retired/`), sorted; an unreadable or
 * missing directory contributes nothing. */
const filesIn = (dir: string, depth: number): string[] => {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isFile()) files.push(path);
		else if (entry.isDirectory() && depth > 0)
			files.push(...filesIn(path, depth - 1));
	}
	return files.sort();
};

const writtenSince = (path: string, sinceMs: number): boolean => {
	try {
		return statSync(path).mtimeMs >= sinceMs;
	} catch {
		// Vanished between the listing and the stat: not evidence either way.
		return false;
	}
};

/**
 * The app's crash reports written at or after `sinceMs`, in any of `dirs`.
 * Matched on the file name the report writer uses, `<executable>-…ips`, then on
 * the metadata, so an executable called `LocalOperator-Helper` cannot be blamed
 * on `LocalOperator`. A missing directory is no reports: a runner that has never
 * seen a crash has no `DiagnosticReports` directory at all.
 */
export const crashReportsSince = (
	dirs: string | readonly string[],
	executable: string,
	sinceMs: number,
	bundle?: string,
): string[] => {
	const found: string[] = [];
	for (const path of (typeof dirs === "string" ? [dirs] : dirs).flatMap((dir) =>
		filesIn(dir, 1),
	)) {
		const name = basename(path);
		if (!name.startsWith(`${executable}-`) || !name.endsWith(".ips")) continue;
		if (!writtenSince(path, sinceMs)) continue;
		try {
			const { header } = parseIps(readFileSync(path, "utf8"));
			if (!namesTheApp(header, executable, bundle)) continue;
		} catch {
			// Vanished between the listing and the read: it is not evidence either way.
			continue;
		}
		found.push(path);
	}
	return found;
};

/**
 * EVERY report written since launch, whatever process it names: what the job
 * prints when the app was seen dead and no report of its own turned up. A dead
 * app with no report is either a crash reporter that wrote somewhere else or
 * one that did not run, and this listing is what tells the two apart from the
 * log of the run that hit it — on GitHub's `macos-26` image the negative control
 * (#170, run 42263119518) found no `LocalOperator-*.ips` in
 * `~/Library/Logs/DiagnosticReports` three minutes after the abort.
 */
export const reportsWrittenSince = (dir: string, sinceMs: number): string[] =>
	filesIn(dir, 1).filter(
		(path) =>
			(path.endsWith(".ips") || path.endsWith(".crash")) &&
			writtenSince(path, sinceMs),
	);

// ---------------------------------------------------------------------------
// Fatal signatures in the app's OWN output.
// ---------------------------------------------------------------------------

/**
 * THE SHAPES A FATAL TAKES IN THE APP'S OWN OUTPUT. The workflow feeds this only
 * what the app's process wrote — its unified-log lines (a `process ==` predicate)
 * and its redirected stderr/stdout — so the springboard, or any other process
 * reporting its own trouble, cannot fail the job.
 *
 * The two JavaScript shapes were the whole check before; they still catch a
 * bundle that failed to load and painted a red error screen. The native shapes
 * are the ones a process prints on its way into `abort()`.
 *
 * `[Worklets]` ALONE IS DELIBERATELY NOT A SIGNATURE. react-native-worklets
 * prefixes EVERY message its logger writes with it (`src/debug/logger.ts`,
 * `PREFIX = '[Worklets]'`), informational ones included ("Bundle mode
 * initialization: Downloaded the bundle for Worklet Runtimes."), so a bare
 * prefix match turns a warning into a red gate. The fatal shape of #168 is a
 * C++ exception escaping to `std::terminate`, which libc++abi announces as
 * `libc++abi: terminating due to uncaught exception of type …: [Worklets] …` —
 * caught by its own signature below, with the worklets message on the line.
 */
export const FATAL_SIGNATURES: readonly { pattern: RegExp; what: string }[] = [
	{ pattern: /Unhandled JS Exception/, what: "a JavaScript fatal" },
	{ pattern: /RCTFatal/, what: "React Native's fatal handler" },
	{
		pattern: /Terminating app due to uncaught exception/,
		what: "an uncaught Objective-C exception",
	},
	{
		pattern: /libc\+\+abi: terminating/,
		what: "an uncaught C++ exception (std::terminate, then abort)",
	},
	{ pattern: /\bEXC_CRASH\b/, what: "a crash exception" },
	{ pattern: /\bSIGABRT\b/, what: "an abort signal" },
];

export const fatalLines = (output: string): string[] =>
	output
		.split("\n")
		.filter((line) =>
			FATAL_SIGNATURES.some(({ pattern }) => pattern.test(line)),
		);

// ---------------------------------------------------------------------------
// Frame delta.
// ---------------------------------------------------------------------------

/**
 * The share of bytes that differ between two decoded frames (`sips -s format
 * bmp`), header included — the same unit as `cmp -l a b | wc -l` over the
 * file size, which is how the calibration numbers in ios.yml were measured, but
 * without `cmp -l`'s one output line per differing byte (millions, for a
 * full-screen change). A length difference counts as differing bytes.
 */
export const frameDelta = (
	a: Uint8Array,
	b: Uint8Array,
): { differing: number; total: number; percent: number } => {
	const common = Math.min(a.length, b.length);
	let differing = Math.abs(a.length - b.length);
	for (let i = 0; i < common; i++) if (a[i] !== b[i]) differing++;
	const total = Math.max(a.length, b.length);
	return {
		differing,
		total,
		percent: total === 0 ? 0 : (differing / total) * 100,
	};
};

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const USAGE =
	"usage: ios-launch-gate.ts alive (--udid <udid> | --launchctl-file <file>) --bundle <id> --at <label> [--running-since <epoch s>]\n" +
	"       ios-launch-gate.ts crash-report --dir <dir> [--dir <dir>…] --executable <name> --since <epoch s> [--bundle <id>] [--wait <s>]\n" +
	"       ios-launch-gate.ts fatal-lines <file>...\n" +
	"       ios-launch-gate.ts frame-delta <a.bmp> <b.bmp>";

const arg = (name: string): string | undefined => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
};

/** Every value of a repeatable option, in order. */
const all = (name: string): string[] =>
	process.argv.flatMap((value, i) =>
		value === `--${name}` && process.argv[i + 1] !== undefined
			? [process.argv[i + 1] as string]
			: [],
	);

// A declaration, not an arrow: only a declared `never` function narrows the
// caller's variables after it (TypeScript's assertion-call rule).
function usage(why: string): never {
	console.error(`::error::${why}\n${USAGE}`);
	process.exit(2);
}

const required = (name: string): string =>
	arg(name) ?? usage(`--${name} is required`);

const epochSeconds = (name: string): number => {
	const value = required(name);
	if (!DIGITS.test(value))
		usage(`--${name} must be whole epoch seconds, got '${value}'`);
	return Number(value);
};

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

/** Same guard and reasoning as `version.ts`: imported by the unit suite, so the
 * CLI must not run on import, and a Node without `import.meta.main` must fail
 * by name rather than exit 0 having judged nothing. */
const isEntryPoint = (import.meta as ImportMeta & { main?: boolean }).main;
if (isEntryPoint === undefined) {
	console.error(
		'::error::this Node does not support `import.meta.main` (needs >= 24.2), so this gate would exit 0 without judging anything. The workflows pin `NODE_VERSION: "24"`.',
	);
	process.exit(1);
}

if (isEntryPoint) {
	const command = process.argv[2];
	if (command === "alive") {
		const bundle = required("bundle");
		const at = required("at");
		const file = arg("launchctl-file");
		const udid = arg("udid");
		let listing = "";
		if (file) {
			listing = readFileSync(file, "utf8");
		} else if (udid) {
			try {
				listing = execFileSync(
					"xcrun",
					["simctl", "spawn", udid, "launchctl", "list"],
					{
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
					},
				);
			} catch (error) {
				// A failed READ is not an answer: "not running" would blame the app
				// for the simulator, and "running" would be a guess.
				console.error(
					`::error::could not run launchctl list in the simulator, so whether ${bundle} is running at ${at} cannot be claimed either way: ${message(error)}`,
				);
				process.exit(1);
			}
		} else {
			usage("alive needs --udid or --launchctl-file");
		}
		// The label names the schedule; this is the clock. On a loaded runner a
		// single screenshot took 48 s (run 42263081758), so "t+5s" can be a
		// minute and more after the launch, and the log says how much.
		const runningSince = arg("running-since");
		const elapsed =
			runningSince && DIGITS.test(runningSince)
				? ` (${Math.max(0, Math.floor(Date.now() / 1000) - Number(runningSince))} s after simctl launch returned)`
				: "";
		const verdict = judgeLiveness(listing, bundle, at, elapsed);
		for (const line of verdict.lines) {
			if (verdict.alive) console.log(line);
			else console.error(line);
		}
		process.exit(verdict.alive ? 0 : 1);
	} else if (command === "crash-report") {
		const dirs = all("dir");
		if (dirs.length === 0) usage("--dir is required");
		const executable = required("executable");
		const since = epochSeconds("since");
		const bundle = arg("bundle");
		const wait = Number(arg("wait") ?? "0");
		// A report is written by the host's crash reporter seconds AFTER the
		// process dies. When the caller already saw the app dead it passes a
		// wait, so the report it is looking for has time to land.
		const deadline = Date.now() + (Number.isFinite(wait) ? wait : 0) * 1000;
		let reports = crashReportsSince(dirs, executable, since * 1000, bundle);
		while (reports.length === 0 && Date.now() < deadline) {
			await sleep(2000);
			reports = crashReportsSince(dirs, executable, since * 1000, bundle);
		}
		const sinceIso = new Date(since * 1000).toISOString();
		if (reports.length === 0) {
			console.log(
				`no crash report for ${executable} written since launch (${sinceIso}) in ${dirs.join(", ")}`,
			);
			// Waiting means the caller saw the app dead, so "no report" needs the
			// evidence of where reports DID land, not just the absence.
			if (wait > 0) {
				console.log(
					"the app was seen dead, so here is every report written since launch, by directory:",
				);
				for (const dir of dirs) {
					const recent = reportsWrittenSince(dir, since * 1000);
					console.log(
						`  ${dir}: ${existsSync(dir) ? (recent.length === 0 ? "none" : `${recent.length}`) : "the directory does not exist"}`,
					);
					for (const path of recent.slice(0, 20)) console.log(`    ${path}`);
				}
			}
			process.exit(0);
		}
		for (const report of reports) {
			const { body } = parseIps(readFileSync(report, "utf8"));
			const exception = body && isRecord(body.exception) ? body.exception : {};
			const kind =
				[
					text(exception.type),
					text(exception.signal) && `(${text(exception.signal)})`,
				]
					.filter(Boolean)
					.join(" ") || "a crash";
			console.error(
				`::error::${executable}${bundle ? ` (${bundle})` : ""} crashed after launch: ${kind} — crash report ${report}`,
			);
			console.error(`crash report: ${report}`);
			for (const line of summarizeCrashReport(readFileSync(report, "utf8"))) {
				console.error(line);
			}
		}
		process.exit(1);
	} else if (command === "fatal-lines") {
		const files = process.argv.slice(3);
		if (files.length === 0) usage("fatal-lines needs at least one file");
		let found = 0;
		for (const file of files) {
			if (!existsSync(file)) {
				// Each file is a source the caller asked to be read; a missing one
				// is a read that failed, and "no fatal in it" cannot be claimed.
				// ONE stream for every line of this command: stdout and stderr are
				// flushed independently, and the first negative-control run
				// (42263119518) printed a fatal's `::error::` header two lines away
				// from the fatal line it introduced.
				console.log(
					`::error::${file} does not exist, so it cannot be scanned for a fatal`,
				);
				found++;
				continue;
			}
			const lines = fatalLines(readFileSync(file, "utf8"));
			if (lines.length === 0) {
				console.log(`no fatal signature in ${file}`);
				continue;
			}
			found += lines.length;
			console.log(
				`::error::the app's own output carries a fatal (${file}), so it aborted or painted an error screen:`,
			);
			for (const line of lines.slice(0, 40)) console.log(`  ${line}`);
		}
		process.exit(found === 0 ? 0 : 1);
	} else if (command === "frame-delta") {
		const [a, b] = process.argv.slice(3);
		if (!a || !b) usage("frame-delta needs two decoded frames");
		const delta = frameDelta(readFileSync(a), readFileSync(b));
		// One machine-readable line: the workflow reads it into shell variables.
		console.log(
			`${delta.differing} ${delta.total} ${delta.percent.toFixed(2)}`,
		);
	} else {
		usage(`unknown command '${command ?? ""}'`);
	}
}
