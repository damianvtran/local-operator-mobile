/**
 * "Copy diagnostics": the Diagnostics section as one redacted plain-text block.
 *
 * Why it exists: a teammate helping someone (or that teammate's agent) needs the
 * route, the stream state, the last error and WHICH tunnel the phone is using,
 * to compare with the computer — without a terminal on either side, and without
 * reading values off a screenshot. The tunnel id and hostname are what tell
 * "the phone is on the old tunnel" apart from "the computer is down".
 *
 * Constraint: the text leaves the app (clipboard → chat), so it must never carry
 * a credential. The inputs are already token-free by construction — the route
 * is a hostname or an origin, `RelayError.summary` is "kind status reason" — and
 * this module redacts again anyway, so a future field that grows a query string
 * or a header value cannot leak through it. Field labels stay English on
 * purpose: this is a technical report, read by support and agents, like a log
 * line (AGENTS.md: technical text stays English).
 */

export type DiagnosticsInput = {
	route:
		| { mode: "radient"; hostname: string; tunnelId: string }
		| { mode: "custom"; baseUrl: string }
		| null;
	/** The computer's display name, when one is known. */
	computerName: string | null;
	/** The Status word the reader sees ("Not answering"), so a helper on a
	 *  call reads the same word the user does (PR #261 U7). */
	status?: string | null;
	/** The refusal's cause id (`RefusalCopy.cause`) or the transient notice's,
	 *  when one shows. */
	cause?: string | null;
	/** The stream state word (`live`, `degraded`, …). */
	stream: string;
	/** `RelayError.summary` (or a stalled stream's synthetic cause), or `null`. */
	lastError: string | null;
	/** When Last error was recorded (epoch ms), so a helper can tell a current
	 *  failure from history. */
	lastErrorAt?: number | null;
	version: string;
	platform: string;
};

/*
 * The redaction, one shape per rule, each named for what it catches. Measured
 * leaks from round 1 (PR #261 Q5/R3) are why each exists: a JWT whose segments
 * were each under 48 characters survived whole, an email survived twice, a
 * lowercase `bearer`, `x-auth:`, every cookie pair after the first, and
 * `?t=` / `sig=` / `X-Amz-Signature=` / `sessionid=` query values survived.
 */

/** A JWT/JWS in compact form, ANY length: its header is base64url JSON, which
 *  always starts `ey` (`{"` or `{ `). */
const JWT = /\bey[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
/** Three dot-joined base64url runs of 8+ characters: a token whose header is
 *  not JSON. 8 keeps hostnames (`…-lop.radienthq.com`) and versions out. */
const DOTTED_TOKEN =
	/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(bearer|basic|token|digest)\s+[A-Za-z0-9._~+/=-]+/gi;
/** A whole Cookie/Set-Cookie header: every pair, not only the first. */
const COOKIE_HEADER = /\b(set-cookie|cookie)(\s*[:=]\s*)[^\r\n]*/gi;
/** Credential-bearing headers: `Authorization`, and any `X-…` header naming
 *  auth, a key, a token, a secret or a signature (`x-auth`, `x-api-key`). */
const AUTH_HEADER =
	/\b(proxy-authorization|authorization|x-[a-z0-9-]*(?:auth|key|token|secret|signature|session)[a-z0-9-]*)(\s*[:=]\s*)("[^"]*"|[^\s&;,]+)/gi;
/** Key/value shapes that carry a credential, wherever they appear. */
const SECRET_PAIR =
	/\b(token|access_token|refresh_token|id_token|password|passwd|pwd|secret|authorization|session|sessionid|session_id|sid|grant|jwt|code|state|key|api_key|apikey|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token)(\s*[=:]\s*)("[^"]*"|[^\s&;,]+)/gi;
/** EVERY query value: whatever its name (`t`, `sig`, a vendor's), a query
 *  string is where links carry their tokens. The names stay for the helper. */
const QUERY_VALUE = /([?&][^=&#\s]+=)([^&#\s]+)/g;
/** `user:password@` in a URL. */
const USERINFO = /(\/\/)[^/\s@]+@/g;
const EMAIL =
	/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** A home directory names its user: `/Users/<name>`, `/home/<name>`,
 *  `C:\\Users\\<name>`. */
const HOME_PATH = /(\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^/\\\s]+/g;
/** A long opaque run (hex/base64 secret) that is not a tunnel id. */
const OPAQUE = /\b[A-Za-z0-9_-]{48,}\b/g;

/** Redacts one value. Exported for its test. Order matters: whole headers and
 *  tokens first, so a later key/value rule cannot leave half a token behind. */
export function redact(value: string): string {
	return value
		.replace(COOKIE_HEADER, "$1$2[redacted]")
		.replace(JWT, "[redacted]")
		.replace(DOTTED_TOKEN, "[redacted]")
		.replace(BEARER, "$1 [redacted]")
		.replace(AUTH_HEADER, "$1$2[redacted]")
		.replace(USERINFO, "$1[redacted]@")
		.replace(QUERY_VALUE, "$1[redacted]")
		.replace(SECRET_PAIR, "$1$2[redacted]")
		.replace(EMAIL, "[email]")
		.replace(HOME_PATH, "$1[redacted]")
		.replace(OPAQUE, "[redacted]");
}

/** An origin with no credentials, path, query or fragment. */
function safeOrigin(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return "[unparseable address]";
	}
}

export function diagnosticsText(input: DiagnosticsInput): string {
	const lines: Array<[string, string]> = [
		["App", `Local Operator mobile ${input.version} (${input.platform})`],
		[
			"Route",
			input.route === null
				? "none"
				: input.route.mode === "radient"
					? "Radient tunnel"
					: "Direct relay",
		],
	];
	/* Labels match the screen's ("Tunnel address", U12): a helper on a call
	 *  reads one while the user reads the other. */
	if (input.route?.mode === "radient") {
		lines.push(["Tunnel id", input.route.tunnelId]);
		lines.push(["Tunnel address", input.route.hostname]);
	} else if (input.route?.mode === "custom") {
		lines.push(["Address", safeOrigin(input.route.baseUrl)]);
	}
	if (input.computerName) lines.push(["Computer", input.computerName]);
	if (input.status) lines.push(["Status", input.status]);
	if (input.cause) lines.push(["Cause", input.cause]);
	lines.push(["Stream", input.stream]);
	lines.push(["Last error", input.lastError ?? "none"]);
	if (input.lastError && input.lastErrorAt)
		lines.push(["Last error at", new Date(input.lastErrorAt).toISOString()]);
	return lines.map(([label, value]) => `${label}: ${redact(value)}`).join("\n");
}
