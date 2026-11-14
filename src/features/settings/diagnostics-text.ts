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

/** A JWT/JWS in compact form, ANY length. Its header is base64 JSON, which
 *  starts `eyJ` (`{"`): anchored on all three so a host or a word that merely
 *  starts "ey" (`https://eyrie.example.com`) keeps its name (PR #261 R2-5).
 *  Segments accept `=` padding and standard base64's `+`/`/` as well as
 *  base64url (R2-3/Q8: a padded or standard-alphabet JWT survived whole). */
const JWT = /\beyJ[A-Za-z0-9_+/=-]*\.[A-Za-z0-9_+/=-]+\.[A-Za-z0-9_+/=-]*/g;
/** Three dot-joined base64url runs of 8+ characters: a token whose header is
 *  not JSON. 8 keeps hostnames (`…-lop.radienthq.com`) and versions out. */
const DOTTED_TOKEN =
	/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(bearer|basic|token|digest)\s+[A-Za-z0-9._~+/=-]+/gi;
/** A whole Cookie/Set-Cookie header: every pair, not only the first. */
const COOKIE_HEADER = /\b(set-cookie|cookie)("?\s*[:=]\s*)[^\r\n]*/gi;
/** Credential-bearing headers: `Authorization`, and any `X-…` header naming
 *  auth, a key, a token, a secret or a signature (`x-auth`, `x-api-key`). */
const AUTH_HEADER =
	/\b(proxy-authorization|authorization|x-[a-z0-9-]*(?:auth|key|token|secret|signature|session)[a-z0-9-]*)("?\s*[:=]\s*)("[^"]*"|[^\s&;,]+)/gi;
/** Key/value shapes that carry a credential, wherever they appear — bare
 *  (`password=…`) or JSON-quoted (`"password":"…"`, `"access_token": "…"`):
 *  the optional `"` is the key's closing quote, which sat between the key and
 *  its separator and let every JSON pair through (R2-3/Q8). A prefixed name
 *  (`client_secret`, `x_auth_token`, `db-password`) counts for the words that
 *  only ever name a secret. */
const SECRET_PAIR =
	/\b((?:[a-z0-9]+[_-])*(?:token|secret|password|passwd|apikey|api_key|credential)|access_token|refresh_token|id_token|password|passwd|pwd|secret|authorization|session|sessionid|session_id|sid|grant|jwt|code|state|key|api_key|apikey|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token)("?\s*[=:]\s*)("[^"]*"|[^\s&;,]+)/gi;
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

/** One pass of every rule. Order matters: whole headers and tokens first, so a
 *  later key/value rule cannot leave half a token behind. */
function redactOnce(value: string): string {
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
/**
 * The longest value redacted, in characters. Several rules (`EMAIL`,
 * `DOTTED_TOKEN`, `QUERY_VALUE`) are quadratic on long hostile input — not
 * catastrophic, but measured at 0.6–2.0 s per rule on 40k characters, on the UI
 * thread when Copy diagnostics is tapped (PR #261 R2-4). Every legitimate value
 * here is a summary line, a hostname or a computer name: the longest is a
 * relay `reason` plus its kind and status, well under 200 characters, so 2,000
 * truncates only input that is already not a diagnosis. Capped BEFORE
 * redacting, so the cost is bounded by this, not by what the relay sent.
 */
export const REDACT_MAX_CHARS = 2_000;

/** `%XX` runs decoded where they decode; a malformed run is kept as it is. */
function decodePercent(value: string): string {
	return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
		try {
			return decodeURIComponent(run);
		} catch {
			return run;
		}
	});
}

/** Redacts one value. Exported for its test.
 *
 *  Two passes: the value as it is, then its percent-decoded form, because a URL
 *  carries its secrets encoded (`token%3D…`, `%40` in an email, `%2FUsers%2F`)
 *  and every rule above reads the decoded characters (R2-3/Q8). The decoded
 *  form is what is returned when decoding changed anything: a helper reads it
 *  just as well, and it is the form the second pass could see. */
export function redact(value: string): string {
	const capped =
		value.length > REDACT_MAX_CHARS
			? `${value.slice(0, REDACT_MAX_CHARS)}…[truncated]`
			: value;
	const once = redactOnce(capped);
	const decoded = decodePercent(once);
	return decoded === once ? once : redactOnce(decoded);
}

/**
 * The Diagnostics "Reason" row's value: `reason: <code>` (PR #258), redacted
 * with the same rules as Copy diagnostics.
 *
 * Why redact a code: `reasonCodeOf` admits a wire value only when it is
 * identifier-shaped (`[a-z][a-z0-9_-]{0,63}`, no dot), which keeps URLs, hosts
 * and sentences out, but a 48-64 character lowercase opaque run (a hex secret a
 * responder echoed into `code` or `error`) is identifier-shaped too. The row is
 * selectable, so whatever it shows can leave the app by hand; routing it through
 * `redact` keeps one redaction for everything Diagnostics shows or copies, with
 * no second rule set to drift. Every code this build knows is well under 48
 * characters and has no `=`/`:`, so none is altered. The `reason:` prefix stays
 * outside the redaction because it is the row's grep anchor, not wire data.
 */
export function diagnosticsReasonValue(code: string): string {
	return `reason: ${redact(code)}`;
}

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
