/**
 * The own-tunnel connect PHASE RING: a bounded, in-memory record of how far one
 * `connectCustom` attempt got, readable by a native E2E driver without a debugger.
 *
 * **Why it exists.** The native chrome proof (run 42789156345, iPhone SE / iOS 26.5)
 * saw Test the connection answer "Connected", Save and connect land on home, and the
 * sidebar then read "Not connected" / "Not answering". The relay's request ledger
 * held no request attributable to Save at all, and `connectCustom` deliberately
 * swallows a `RelayError` (it records the refusal and returns) while its caller
 * navigates home unconditionally — so the home screen proves nothing about the
 * connection, and nothing on screen said which stage stopped. This ring is the
 * smallest instrument that names that stage on a device we cannot attach to.
 *
 * **How it is read.** Three carriers, all fed from `record` below:
 *  - `ConnectPhaseNode` renders the ring into a hidden `connect-phase-log` text
 *    node, so any Maestro hierarchy dump (the proof takes one on failure and one
 *    per frame) carries it;
 *  - each entry is also written once with `console.info("[connect-phase] …")`,
 *    which a Release build still forwards to the unified log, so the driver can
 *    pull it with `log show` even if the node were pruned from the tree;
 *  - `connectPhaseSnapshot()` for unit tests.
 *
 * **What it may never carry.** No password, cookie, token, header or URL query.
 * Phase names come from a closed set (`PHASES`), the only free text is an error's
 * message, and that goes through `sanitizeDiagnostic`: the attempt's own password
 * is removed literally, cookie/token/bearer/password key-value pairs are blanked,
 * URL userinfo and query strings are dropped, and the result is capped. The house
 * rule this follows is `sign-in-diagnostics.ts`'s: never trust an arbitrary error
 * string, because native and network errors can quote a redirect or a credential.
 *
 * **Bounds.** `CAPACITY` entries (oldest dropped) and `MESSAGE_CAP` characters per
 * message: one connect attempt records about a dozen phases, so 48 holds the last
 * few attempts (Test + Save + a retry) without growing for the life of the app.
 */

import { RelayError } from "@/relay";

/** The stages one connect attempt passes through, in order. A name outside this
 *  set is recorded as `unknown` so a typo cannot smuggle text into the ring. */
export const PHASES = [
	"start",
	"invalid-url",
	"persisted",
	"retirement-done",
	"credentials-read",
	"auth-request-sent",
	"auth-response",
	"auth-refused",
	"golive-start",
	"golive-skipped",
	"stream-open",
	"stream-state",
	"stream-error",
	"list-request-sent",
	"list-response",
	"list-error",
	"superseded",
	"error",
	"done",
] as const;
export type ConnectPhase = (typeof PHASES)[number] | "unknown";

export interface ConnectPhaseEntry {
	/** Milliseconds since the ring's first entry in this app run. */
	t: number;
	phase: ConnectPhase;
	/** Closed-vocabulary facts: an HTTP status, a stream state, a count. */
	facts?: Record<string, string | number | boolean>;
	/** Present on failures only. */
	error?: ConnectErrorFacts;
}

export interface ConnectErrorFacts {
	/** `RelayError.kind`, or the error's constructor name. */
	kind: string;
	surface?: string;
	status?: number;
	/** A platform code (`ERR_KEY_CHAIN`, `-34018`, `NSURLErrorDomain:-1004`). */
	code?: string;
	message: string;
}

export const CAPACITY = 48;
export const MESSAGE_CAP = 160;

const KNOWN = new Set<string>(PHASES);
let ring: ConnectPhaseEntry[] = [];
let origin: number | null = null;
const listeners = new Set<() => void>();

/**
 * Removes anything secret-shaped from a diagnostic string. `secrets` are literal
 * values the caller holds (the attempt's password) and are removed wherever they
 * appear, because a platform message can quote a request body verbatim.
 */
export function sanitizeDiagnostic(
	text: string,
	secrets: readonly string[] = [],
): string {
	let out = text;
	for (const secret of secrets) {
		// A one-character "secret" would shred the message; the shortest relay
		// password the tunnel screen accepts is far longer than this.
		if (secret.length >= 4) out = out.split(secret).join("[redacted]");
	}
	out = out
		// scheme://user:pass@host → scheme://host
		.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi, "$1")
		// any URL's query string or fragment
		.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#][^\s]*/gi, "$1")
		/* Bearer tokens BEFORE the key/value rule: `Authorization: Bearer <tok>`
		 *  would otherwise have only the scheme word blanked as the "value" and
		 *  the token itself left behind (caught by the redaction test). */
		.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		// key=value / key: value for credential-ish keys
		.replace(
			/\b(set-cookie|cookie|password|passwd|token|access_token|refresh_token|authorization|session|lo_session)\b\s*[:=]\s*("[^"]*"|[^\s;,&]+)/gi,
			"$1=[redacted]",
		)
		.replace(/\s+/g, " ")
		.trim();
	return out.length > MESSAGE_CAP ? `${out.slice(0, MESSAGE_CAP - 1)}…` : out;
}

const CODE_SHAPE = /^-?[A-Za-z0-9_.:-]{1,48}$/;

/** The facts of an error that are safe to keep: its type, the taxonomy's typed
 *  fields, a platform code when the cause carries one, and a sanitised message. */
export function errorFacts(
	error: unknown,
	secrets: readonly string[] = [],
): ConnectErrorFacts {
	if (error instanceof RelayError) {
		const cause = (error as { cause?: unknown }).cause;
		const code = platformCode(cause) ?? platformCode(error);
		return {
			kind: error.kind,
			surface: error.surface,
			...(error.status !== undefined ? { status: error.status } : {}),
			...(code ? { code } : {}),
			message: sanitizeDiagnostic(
				[error.message, causeMessage(cause)].filter(Boolean).join(" ← "),
				secrets,
			),
		};
	}
	const code = platformCode(error);
	const name =
		error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)
			? error.name
			: typeof error;
	return {
		kind: name,
		...(code ? { code } : {}),
		message: sanitizeDiagnostic(
			error instanceof Error ? error.message : String(error),
			secrets,
		),
	};
}

function causeMessage(cause: unknown): string {
	return cause instanceof Error ? `${cause.name}: ${cause.message}` : "";
}

/** `code` (Expo's CodedError, Node), `domain` + `code` (an NSError bridge) or an
 *  `errno`; only when it has the shape of a code rather than of a sentence. */
function platformCode(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const v = value as { code?: unknown; domain?: unknown; errno?: unknown };
	const code =
		typeof v.code === "string" || typeof v.code === "number"
			? String(v.code)
			: typeof v.errno === "number"
				? String(v.errno)
				: undefined;
	if (code === undefined) return undefined;
	const joined = typeof v.domain === "string" ? `${v.domain}:${code}` : code;
	return CODE_SHAPE.test(joined) ? joined : undefined;
}

/** Appends one phase. `facts` values must be scalars from a closed vocabulary
 *  (statuses, state names, counts) — never a header, URL or body. */
export function recordConnectPhase(
	phase: ConnectPhase,
	detail: {
		facts?: Record<string, string | number | boolean>;
		error?: unknown;
		secrets?: readonly string[];
	} = {},
): void {
	const now = Date.now();
	if (origin === null) origin = now;
	const entry: ConnectPhaseEntry = {
		t: now - origin,
		phase: KNOWN.has(phase) ? phase : "unknown",
		...(detail.facts ? { facts: scalarFacts(detail.facts) } : {}),
		...(detail.error !== undefined
			? { error: errorFacts(detail.error, detail.secrets) }
			: {}),
	};
	ring = [...ring.slice(-(CAPACITY - 1)), entry];
	// One line per entry, so a log reader needs no state to reassemble the ring.
	console.info(`[connect-phase] ${formatEntry(entry)}`);
	for (const listener of listeners) listener();
}

function scalarFacts(
	facts: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(facts)) {
		if (!/^[a-zA-Z]{1,24}$/.test(key)) continue;
		out[key] =
			typeof value === "string"
				? sanitizeDiagnostic(value).slice(0, 40)
				: value;
	}
	return out;
}

/** `t+123 auth-response status=303` / `t+9 error kind=transport code=… msg="…"`. */
export function formatEntry(entry: ConnectPhaseEntry): string {
	const parts = [`t+${entry.t}`, entry.phase];
	for (const [key, value] of Object.entries(entry.facts ?? {}))
		parts.push(`${key}=${value}`);
	if (entry.error) {
		parts.push(`kind=${entry.error.kind}`);
		if (entry.error.surface) parts.push(`surface=${entry.error.surface}`);
		if (entry.error.status !== undefined)
			parts.push(`status=${entry.error.status}`);
		if (entry.error.code) parts.push(`code=${entry.error.code}`);
		parts.push(`msg="${entry.error.message.replace(/"/g, "'")}"`);
	}
	return parts.join(" ");
}

/** The whole ring as one string, one entry per line — the hidden node's text. */
export function formatConnectPhases(): string {
	return ring.map(formatEntry).join("\n");
}

export function connectPhaseSnapshot(): readonly ConnectPhaseEntry[] {
	return ring;
}

export function subscribeConnectPhases(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Tests only: a fresh ring and clock origin. */
export function resetConnectPhases(): void {
	ring = [];
	origin = null;
	for (const listener of listeners) listener();
}
