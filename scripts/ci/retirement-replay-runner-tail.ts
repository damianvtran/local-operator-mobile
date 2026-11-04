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
 * from the test's own environment dump. Matched against the raw line (so
 * redaction cannot manufacture a match) and again by `safeRunnerTail` on export.
 */
export const ALLOWED_SHAPES: readonly RegExp[] = [
	/^xcodebuild: error: /,
	/^Testing failed:/,
	/^\*\* TEST (?:EXECUTE |BUILD )?FAILED \*\*$/,
	/^\s*error: /,
	/^\s*Error Domain=/,
	/^\s*Underlying Error: /,
	/^Test Case '-\[[\w.]+ \w+\]' failed /,
	// XCTest assertion lines: `<file>.swift:<line>: error: -[Class method] : …`.
	// Anchored to that exact form: an open `^.*` here let a ring-cut env-dump
	// line (starting mid-bearer) through (review S23-2 / Q23-2).
	/^\S+\.swift:\d+: error: -\[[\w.]+ \w+\] : /,
];

/**
 * Line breaks xcodebuild text may contain. `\r?\n` alone let text after a
 * U+2028 ride along inside an allowlisted line (review S23-1).
 */
const LINE_BREAK = /\r\n|[\n\r\u0085\u2028\u2029]/;

/**
 * Runs of 8+ hex characters are REDACTED to `<hex>`. They may be a piece of the
 * hex bearer/session: a value split across lines, cut by the ring or the line
 * cap leaves pieces of ANY length, and 16 still let an 11-char tail through
 * (measured while fixing review S23-1). Legitimate long hex (addresses, ids)
 * is not what this tail is for. After this no 8+ hex run can remain, which is
 * also the secret-free rule the export boundary re-checks (review S23-4).
 */
const LONG_HEX = /[0-9a-f]{8,}/i;
const LONG_HEX_ALL = /[0-9a-f]{8,}/gi;
/** Fragments of a secret this long are treated as the secret (S23-1). */
const FRAGMENT = 12;
/** Base64 window, in encoded characters (6 secret bytes), see leaksSecret. */
const BASE64_WINDOW = 8;

/** Keeps only the most recent `capacity` bytes of everything pushed into it. */
export class TailRing {
	#chunks: Buffer[] = [];
	#size = 0;
	readonly capacity: number;
	constructor(capacity = RING_BYTES) {
		this.capacity = capacity;
	}
	/** True once any byte was evicted: the first line may then start mid-token. */
	truncated = false;
	push(chunk: Buffer) {
		this.#chunks.push(chunk);
		this.#size += chunk.length;
		while (this.#size > this.capacity && this.#chunks.length > 0) {
			const head = this.#chunks[0]!;
			const excess = this.#size - this.capacity;
			this.truncated = true;
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
function portPattern(port: string, flags = "") {
	// Digit lookarounds, not `\b`: `%3A54321` has no word boundary before the
	// port, so `\b` missed the percent-encoded control URL (review S23-3).
	return new RegExp(`(?<!\\d)${escapeRegExp(port)}(?!\\d)`, flags);
}
function percentDecoded(text: string) {
	try {
		return decodeURIComponent(text);
	} catch {
		return text.replace(/%([0-9a-f]{2})/gi, (_, h) =>
			String.fromCharCode(Number.parseInt(h, 16)),
		);
	}
}
function windows(value: string, size: number) {
	const out: string[] = [];
	if (value.length <= size) return value ? [value] : [];
	for (let i = 0; i + size <= value.length; i++)
		out.push(value.slice(i, i + size));
	return out;
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
		if (value) out = out.replace(new RegExp(escapeRegExp(value), "gi"), token);
	const port = portOf(secrets.control);
	if (port) out = out.replace(portPattern(port, "g"), "<port>");
	out = out.replace(LONG_HEX_ALL, "<hex>");
	// Absolute paths name the runner's temp root and home; keep only the leaf.
	out = out.replace(/(?:\/[^\s/:'"]+)+\/([^\s/:'"]+)/g, "…/$1");
	return out.length > LINE_CAP ? `${out.slice(0, LINE_CAP - 1)}…` : out;
}

/**
 * True when ANY trace of a private value survives in `text`: a 12-char
 * fragment of the bearer/session/control in any case, in raw or
 * percent-decoded text, a 16-char fragment of their base64, the control port,
 * or any 8+ hex run. Exact-match-only missed ring cuts, split halves and
 * uppercase/encoded forms (review S23-1, Q23-1).
 */
export function leaksSecret(text: string, secrets: TailSecrets) {
	const decoded = percentDecoded(text);
	// `plain`: the text as written (raw and percent-decoded). The hex, port and
	// base64 rules run ONLY here: on separator-stripped text they glued
	// ordinary words to digits (`failed (241.302 seconds)` -> `ed241302`) and
	// refused every long-running failure tail (review R24-1 / S24-2).
	const plain = [text, decoded].map((v) => v.toLowerCase());
	// `stripped`: whitespace and punctuation removed, used ONLY for the exact
	// 12-char secret fragments, so a value written with separators
	// (`a b c …`, `a-b-c`) is still recognised.
	const stripped = decoded.replace(/[^0-9a-z]/gi, "").toLowerCase();
	const forms = [...plain, stripped];
	// Fragments only of the two random values. The control URL's only private
	// part is its port (it is otherwise the fixed loopback `/rpc` shape), which
	// is checked on its own below; fragmenting it would refuse every line that
	// mentions `http://127.0.0.1`.
	const values = [secrets.bearer, secrets.session].filter((v) => v.length > 0);
	const fragments = values.flatMap((v) => windows(v.toLowerCase(), FRAGMENT));
	// Base64 at ALL three byte alignments (a prefix such as `x:` for Basic
	// auth, `Bearer ` or `{"bearer":"` shifts the groups), in standard and
	// url-safe alphabets. With a prefix the first group mixes prefix bytes and
	// is dropped. 8-char windows (6 bytes) mean any encoded run of about 12+
	// secret bytes contains a whole window at its own alignment (review S24-1).
	const encoded = values.flatMap((v) =>
		["", "x", "xx"].flatMap((prefix) => {
			const standard = Buffer.from(prefix + v)
				.toString("base64")
				.replace(/=+$/, "")
				.slice(prefix ? 4 : 0);
			const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
			return [
				...windows(standard, BASE64_WINDOW),
				...windows(urlSafe, BASE64_WINDOW),
			];
		}),
	);
	const port = portOf(secrets.control);
	return (
		(secrets.control.length > 0 &&
			forms.some((form) => form.includes(secrets.control.toLowerCase()))) ||
		forms.some((form) => fragments.some((f) => form.includes(f))) ||
		[text, decoded].some((form) => encoded.some((f) => form.includes(f))) ||
		plain.some((form) => LONG_HEX.test(form)) ||
		(port !== null && plain.some((form) => portPattern(port).test(form)))
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
	truncated = false,
): RunnerTail | null {
	if (exitCode === 0) return null;
	const all = raw.split(LINE_BREAK);
	// After eviction the first line may start mid-token (even mid-bearer, or
	// mid-UTF-8 character): never consider it (review Q23-2 / Q23-3).
	if (truncated) all.shift();
	const lines = all
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
		// Re-applied here without secrets: the allowlist and the long-hex rule
		// (review S23-4), so the export boundary is a real second gate.
		lines: v.lines
			.filter(
				(line): line is string =>
					typeof line === "string" &&
					line.length <= LINE_CAP &&
					!hasControlCharacter(line) &&
					!LINE_BREAK.test(line) &&
					!LONG_HEX.test(line) &&
					ALLOWED_SHAPES.some((shape) => shape.test(line)),
			)
			.slice(-MAX_LINES),
	};
}
