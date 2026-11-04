/**
 * A capped, redacted, default-DENY failure tail for the XCTest runner command.
 *
 * WHY THIS EXISTS. Seed replay 41801686399 failed with `command-exit` 9.6s into
 * runner bootstrap, and nothing recorded why: the runner's stdout and stderr were
 * discarded by design (it holds a private environment with the loopback control
 * URL, a session id and a bearer), and the xcresult never leaves the runner. Each
 * replay costs a retained artifact's day, so an unexplained exit wastes a day.
 *
 * WHY IT IS SAFE TO EXPORT. This is a new path out of a runner that holds private
 * values, so it is built to export as little as possible:
 *
 * 1. Only on a NONZERO exit. A runner that exits 0 exports nothing.
 * 2. Only the last RING_BYTES of combined output are ever kept in memory.
 * 3. DEFAULT-DENY: a line leaves only if it matches one of ALLOWED_SHAPES (the
 *    xcodebuild/XCTest failure lines that name a cause). Everything else drops.
 * 4. Each kept line is REDACTED (bearer, session, control URL and port replaced
 *    by fixed tokens, absolute paths collapsed to their basename) and capped at
 *    LINE_CAP characters; at most MAX_LINES lines leave.
 * 5. A final ASSERT re-checks the whole result for every private value. If any
 *    survives, NOTHING is exported except the exit code and `redactionRefused`,
 *    never a partial tail.
 *
 * The tail is diagnostic only. It never decides pass/fail.
 */

/** Bytes of combined runner output kept in memory (the most recent bytes). */
export const RING_BYTES = 16 * 1024;
/** Characters per exported line, after redaction. */
export const LINE_CAP = 300;
/** Lines exported at most. */
export const MAX_LINES = 24;

/**
 * The only line shapes that may leave. Each names a failure; none is free text
 * from the test's own environment dump. Matched against the line BEFORE
 * redaction (so redaction cannot manufacture a match) and again on export.
 */
export const ALLOWED_SHAPES: readonly RegExp[] = [
	/^xcodebuild: error: /,
	/^Testing failed:/,
	/^\*\* TEST (?:EXECUTE |BUILD )?FAILED \*\*$/,
	/^\s*error: /,
	/^\s*Error Domain=/,
	/^\s*Underlying Error: /,
	/^Test Case '.*' failed /,
	/^.*: error: -\[.*\] : /,
];

/** Keeps only the most recent RING_BYTES of everything pushed into it. */
export class TailRing {
	#chunks: Buffer[] = [];
	#size = 0;
	push(chunk: Buffer) {
		this.#chunks.push(chunk);
		this.#size += chunk.length;
		while (this.#size > RING_BYTES && this.#chunks.length > 0) {
			const head = this.#chunks[0]!;
			const excess = this.#size - RING_BYTES;
			if (head.length <= excess) {
				this.#chunks.shift();
				this.#size -= head.length;
			} else {
				this.#chunks[0] = head.subarray(excess);
				this.#size -= excess;
			}
		}
	}
	get size() {
		return this.#size;
	}
	text() {
		return Buffer.concat(this.#chunks).toString("utf8");
	}
}

/** Private values that must never leave, and the control port derived from them. */
export interface TailSecrets {
	bearer: string;
	session: string;
	control: string;
}

export type RunnerTail =
	| { exitCode: number | null; lines: string[] }
	| { exitCode: number | null; redactionRefused: true };

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function portOf(control: string) {
	try {
		return new URL(control).port || null;
	} catch {
		return null;
	}
}

/** Replace every private value with a fixed token and collapse absolute paths. */
export function redactLine(line: string, secrets: TailSecrets) {
	let out = line;
	for (const [value, token] of [
		[secrets.control, "<control>"],
		[secrets.bearer, "<bearer>"],
		[secrets.session, "<session>"],
	] as const)
		if (value) out = out.split(value).join(token);
	const port = portOf(secrets.control);
	if (port) {
		out = out.replace(
			new RegExp(`127\\.0\\.0\\.1:${escapeRegExp(port)}\\b`, "g"),
			"127.0.0.1:<port>",
		);
		out = out.replace(new RegExp(`\\b${escapeRegExp(port)}\\b`, "g"), "<port>");
	}
	// Absolute paths name the runner's temp root and home; keep only the leaf.
	out = out.replace(/(?:\/[^\s/:'"]+)+\/([^\s/:'"]+)/g, "…/$1");
	return out.length > LINE_CAP ? `${out.slice(0, LINE_CAP - 1)}…` : out;
}

/** True when any private value (or the bare control port) appears in `text`. */
export function leaksSecret(text: string, secrets: TailSecrets) {
	const port = portOf(secrets.control);
	return (
		[secrets.control, secrets.bearer, secrets.session].some(
			(value) => value.length > 0 && text.includes(value),
		) ||
		(port !== null && new RegExp(`\\b${escapeRegExp(port)}\\b`).test(text))
	);
}

/**
 * Build the exportable tail. Returns null for a zero exit (nothing leaves).
 * `assertClean` is injectable ONLY so the refusal branch is testable; production
 * always uses `leaksSecret`.
 */
export function sanitizeRunnerTail(
	exitCode: number | null,
	raw: string,
	secrets: TailSecrets,
	assertClean: (text: string, secrets: TailSecrets) => boolean = (t, s) =>
		!leaksSecret(t, s),
): RunnerTail | null {
	if (exitCode === 0) return null;
	const lines = raw
		.split(/\r?\n/)
		.filter((line) => ALLOWED_SHAPES.some((shape) => shape.test(line)))
		.slice(-MAX_LINES)
		.map((line) => redactLine(line, secrets));
	const result: RunnerTail = { exitCode, lines };
	if (!assertClean(JSON.stringify(result), secrets))
		return { exitCode, redactionRefused: true };
	return result;
}

/** Tab is allowed (xcodebuild indents with it); any other C0 control or DEL is not. */
function hasControlCharacter(line: string) {
	for (const char of line) {
		const code = char.codePointAt(0)!;
		if ((code < 0x20 && code !== 0x09) || code === 0x7f) return true;
	}
	return false;
}

/**
 * Shape-only re-validation at the export boundary (`safeSummary` has no secrets
 * to re-check against, so it accepts only what `sanitizeRunnerTail` can emit).
 */
export function safeRunnerTail(value: unknown): RunnerTail | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	const exitCode =
		v.exitCode === null ||
		(typeof v.exitCode === "number" && Number.isSafeInteger(v.exitCode))
			? (v.exitCode as number | null)
			: undefined;
	if (exitCode === undefined || exitCode === 0) return null;
	if (v.redactionRefused === true) return { exitCode, redactionRefused: true };
	if (!Array.isArray(v.lines)) return null;
	return {
		exitCode,
		lines: v.lines
			.filter(
				(line): line is string =>
					typeof line === "string" &&
					line.length <= LINE_CAP &&
					!hasControlCharacter(line),
			)
			.slice(-MAX_LINES),
	};
}
