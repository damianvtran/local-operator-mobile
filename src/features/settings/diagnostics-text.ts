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
	/** The stream state word (`live`, `degraded`, …). */
	stream: string;
	/** `RelayError.summary`, or `null` for none. */
	lastError: string | null;
	version: string;
	platform: string;
};

/** Key/value shapes that carry a credential, wherever they appear. */
const SECRET_PAIR =
	/\b(token|access_token|refresh_token|id_token|password|passwd|pwd|secret|cookie|set-cookie|authorization|session|code|state|key|api_key)(\s*[=:]\s*)("[^"]*"|[^\s&;,]+)/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
/** A long opaque run (JWT, hex/base64 secret) that is not a tunnel id. */
const OPAQUE = /\b[A-Za-z0-9_-]{48,}\b/g;

/** Redacts one value. Exported for its test. */
export function redact(value: string): string {
	return value
		.replace(BEARER, "$1 [redacted]")
		.replace(SECRET_PAIR, "$1$2[redacted]")
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
	if (input.route?.mode === "radient") {
		lines.push(["Tunnel id", input.route.tunnelId]);
		lines.push(["Tunnel host", input.route.hostname]);
	} else if (input.route?.mode === "custom") {
		lines.push(["Address", safeOrigin(input.route.baseUrl)]);
	}
	if (input.computerName) lines.push(["Computer", input.computerName]);
	lines.push(["Stream", input.stream]);
	lines.push(["Last error", input.lastError ?? "none"]);
	return lines.map(([label, value]) => `${label}: ${redact(value)}`).join("\n");
}
