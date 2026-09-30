/* Regexes hoisted to module scope: `relayErrorFromResponse` runs for every failed
 * request, and a literal inside it is re-created each time. */
const DELTA_SECONDS = /^\d+$/;
const LOCAL_HARNESS_UNAVAILABLE = /local harness unavailable/i;
const UNKNOWN_TUNNEL = /unknown tunnel/i;

/**
 * The typed error taxonomy for everything the relay and the two gates in front
 * of it can answer.
 *
 * This is the single place a status code becomes a decision. Two independent
 * decisions ride on every failure, and conflating them is how a client either
 * loses a user's command or silently runs it twice:
 *
 * - `envelope` — whether a persisted command's delivery is still unknown, which
 *   is the retry-envelope contract (`docs/mobile.md` §Retry-envelope, ported in
 *   `retry-envelope.ts`). It is NOT "should we retry". `defaultEnvelopeFor` below
 *   is the ONLY table: keep for `502/504/408`, a transport failure and an
 *   unreadable `2xx`; keep also for the two upstream refusals — the edge's `503`
 *   and the gateway's `503 {detail, reason}` and `502 "local harness
 *   unavailable"` — because those machines sit ahead of the relay's admission
 *   ledger and cannot know whether an earlier attempt landed (§5.3); clear for the
 *   relay's own definitive `4xx`; clear-all on `401`.
 * - `retry` — what an automatic retry may do, and after how long.
 *
 * `surface` is the UI's decision, pre-made here so three screens cannot each
 * invent their own reading of "503": the ADR's table (`ADR 0002` §4) maps each
 * response to exactly one surface, and the gateway's `reason` vocabulary splits
 * the 503 arm further (`gateway.py:73-95`).
 */

/** What went wrong, at the granularity a screen or a policy switches on. */
export type RelayErrorKind =
	/** No response at all: connection refused, abort, a dropped stream, or a network
	 *  failure the runtime did not describe. */
	| "transport"
	/** The certificate was rejected: self-signed, expired, or issued for another
	 *  host. Split out of `transport` because the fix is the tunnel's certificate and
	 *  retrying the same certificate cannot change the answer. */
	| "certificate-rejected"
	/** The host did not resolve. Split out of `transport` because the fix is the
	 *  ADDRESS (a typo, or a DNS record that no longer exists), not a retry — this is
	 *  the ordinary failure of a self-hosted tunnel URL. */
	| "host-unresolved"
	/** Edge 401 carrying `X-Radient-Login`: the tunnel session expired. */
	| "radiant-login-required"
	/** Relay 401 `{"error":"authentication required"}` on the custom route. */
	| "relay-unauthorized"
	/** 403: a same-origin refusal, from the edge or the relay. */
	| "origin-refused"
	/** 413 at either gate. */
	| "too-large"
	/** 429. */
	| "rate-limited"
	/** 404 `unknown tunnel host` / `Unknown tunnel`: the URL is no longer a tunnel. */
	| "unknown-tunnel"
	/** Edge 503 `text/plain` "Tunnel temporarily unavailable": the computer is offline. */
	| "computer-offline"
	/** Gateway 503 JSON carrying `{detail, reason}`: the connector is up and refusing. */
	| "gateway-refused"
	/** Gateway 502: the relay daemon is not answering on loopback. */
	| "relay-down"
	/** 408/502/504 — accepted-then-unanswered, or a gateway cut. Delivery unknown. */
	| "ambiguous-delivery"
	/** Any other 4xx/5xx: a definitive rejection with a body. */
	| "rejected"
	/** A 2xx whose body did not match its schema. */
	| "malformed-frame";

/** Whether a persisted command's outcome is still unknown (keep the envelope) or
 *  has been settled (clear it). **This type's values are decided here and nowhere
 *  else** (`RelayError.envelope`, defaulted by `defaultEnvelopeFor`);
 *  `retry-envelope.ts` consumes the verdict rather than re-deriving it. */
export type EnvelopeDirective = "keep" | "clear" | "clear-all";

/** What an automatic retry may do with this request. */
export type RetryDirective = "never" | "same-id" | "after-backoff" | "re-mint";

/** The UI state this failure belongs to. Pre-decided so screens agree. */
export type ErrorSurface =
	/** Radient sign-in is needed again. */
	| "sign-in"
	/** The connection the user CONFIGURED cannot be used as given: its name does not
	 *  resolve, or its certificate cannot be trusted. Distinct from
	 *  `computer-offline` (a computer the app knows about that is not answering),
	 *  because the fix is in the route's own settings — the self-hosted route's
	 *  address or its certificate. */
	| "connection"
	/** The computer (or its connector) is not reachable; offer retry. */
	| "computer-offline"
	/** The relay daemon is not running on the computer. */
	| "relay-stopped"
	/** The tunnel no longer exists; re-run discovery. */
	| "tunnel-gone"
	/** The user must fix something on the computer or in the Radient console:
	 *  sign the computer back in, check the tunnel's billing, re-run
	 *  `lop tunnel connect`. Copy comes from the gateway's `detail`. */
	| "console"
	/** Ask the user for the relay password again. */
	| "password"
	/** Client bug: fix the request, never show copy, never loop. */
	| "diagnostic"
	/** Transient; show a retry affordance without taking over the screen. */
	| "retry"
	/** Nothing user-visible: the caller handles it silently. */
	| "none";

export interface RelayErrorInit {
	status?: number;
	/** The gateway's own sentence, written for a phone. Displayed verbatim. */
	detail?: string;
	/** The relay's or gateway's `error` string. */
	serverError?: string;
	/** A typed `code` the client must decide on (not display) — e.g.
	 *  `operator_authority_required`, `stt_unavailable`. */
	code?: string;
	/** A `reason` the client recognises (see `GATEWAY_REASONS`). */
	reason?: GatewayReason | undefined;
	/** A `reason` the client does NOT recognise; surfaced so a future gateway
	 *  reason falls back to `detail` instead of vanishing. */
	reasonRaw?: string;
	retryAfterMs?: number;
	envelope?: EnvelopeDirective;
	retry?: RetryDirective;
	surface?: ErrorSurface;
	/** Extra context for logs and the diagnostics screen. Never user-facing copy. */
	diagnostic?: string;
	cause?: unknown;
}

/**
 * The gateway's refusal vocabulary (`gateway.py:66-95` at `52c1df35`, the ref the
 * fixture corpus itself records; dumped from the module into
 * `fixtures/relay/gateway/gateway-refusal-constants.json`). Each one maps to a
 * different action, which is why they are not collapsed into one error.
 *
 * The ref is named on purpose. Line numbers drift between releases, and one review
 * round grepped a stale working copy of the reference checkout, found nothing and
 * reported this reason as deleted — while it is declared at `gateway.py:76` and
 * has been since the release that introduced it. A citation that names a ref can
 * be re-checked with `git show <ref>:local_operator/tunnels/gateway.py`.
 */
export const GATEWAY_REASONS = [
	"control_plane_unreachable",
	"authorization_refused",
	"authorization_deferred",
	"tunnel_not_authorized",
	"authorization_lease_pending",
	"login_required",
	"local_prerequisite",
	"reenrolment_required",
] as const;

export type GatewayReason = (typeof GATEWAY_REASONS)[number];

const GATEWAY_REASON_SET: ReadonlySet<string> = new Set<string>(
	GATEWAY_REASONS,
);

export function isGatewayReason(value: unknown): value is GatewayReason {
	return typeof value === "string" && GATEWAY_REASON_SET.has(value);
}

/** Per-reason handling: the surface, whether an automatic retry is wanted, and
 *  how long to wait. `authorization_deferred` is the only reason the gateway
 *  itself annotates with `Retry-After` (`gateway.py:503-518` at `52c1df35`, in
 *  `refusal_headers`, whose value is `DEFERRAL_WINDOW_S = 120` at `:66`), and the
 *  gateway's code deliberately keeps it distinct from "signed out" — so a client
 *  that says "sign in again" for it is misreading the machine. */
const REASON_POLICY: Record<
	GatewayReason,
	{ surface: ErrorSurface; retry: RetryDirective; retryAfterMs?: number }
> = {
	authorization_deferred: {
		surface: "retry",
		retry: "after-backoff",
		retryAfterMs: 120_000,
	},
	authorization_lease_pending: {
		surface: "retry",
		retry: "after-backoff",
		retryAfterMs: 5_000,
	},
	control_plane_unreachable: {
		surface: "computer-offline",
		retry: "after-backoff",
		retryAfterMs: 10_000,
	} /* The computer's own Radient login, or this tunnel's billing: both are fixed on
	 * the computer or in the console, never by signing in again on the phone — and
	 * `TERMINAL_REMEDY` names the exact local command for each. */,
	authorization_refused: { surface: "console", retry: "never" },
	tunnel_not_authorized: { surface: "console", retry: "never" },
	login_required: { surface: "console", retry: "never" },
	/* Park-only states: never reachable from a phone, kept so a frame carrying one
	 * still parses and is not mistaken for a reason this build understands. */
	local_prerequisite: { surface: "console", retry: "never" },
	reenrolment_required: { surface: "console", retry: "never" },
};

function defaultEnvelopeFor(kind: RelayErrorKind): EnvelopeDirective {
	switch (kind) {
		/* The outcomes that leave a command's delivery UNKNOWN. `computer-offline`,
		 * `relay-down` and `gateway-refused` are, strictly, refusals *before* the
		 * command could be admitted — but the two mistakes are not symmetric:
		 * replaying an instruction the relay de-duplicates costs nothing, while
		 * discarding one the user typed costs their work. So they keep the envelope
		 * too, and the retry is the same id either way. */
		case "transport":
		case "certificate-rejected":
		case "host-unresolved":
		case "ambiguous-delivery":
		case "computer-offline":
		case "relay-down":
		case "gateway-refused":
			return "keep";
		/* The identity that owned the scoped storage is gone. */
		case "relay-unauthorized":
		case "radiant-login-required":
			return "clear-all";
		default:
			return "clear";
	}
}

function defaultRetryFor(kind: RelayErrorKind): RetryDirective {
	switch (kind) {
		case "transport":
		case "ambiguous-delivery":
		case "malformed-frame":
			/* Replay the SAME id: the command may be admitted already, and the relay
			 * de-duplicates it rather than running it twice. */
			return "same-id";
		case "host-unresolved":
			/* A resolver timeout clears by itself; a name that does not exist does not.
			 * `after-backoff` keeps the cheap case automatic and still leaves the user
			 * with a sentence that names the address. */
			return "after-backoff";
		case "certificate-rejected":
			/* The same certificate presented again gets the same answer. Retrying here
			 * would be a loop that looks like progress. */
			return "never";
		case "rate-limited":
		case "gateway-refused":
		case "computer-offline":
		case "relay-down":
			/* Wait first. The connector renews its 30-second lease on a 10-second poll,
			 * so a refusal that clears by itself clears within ~10-30 s. */
			return "after-backoff";
		case "radiant-login-required":
			return "re-mint";
		default:
			return "never";
	}
}

function defaultSurfaceFor(kind: RelayErrorKind): ErrorSurface {
	switch (kind) {
		case "transport":
		case "ambiguous-delivery":
		case "rate-limited":
			return "retry";
		case "certificate-rejected":
		case "host-unresolved":
			return "connection";
		case "radiant-login-required":
			return "sign-in";
		case "relay-unauthorized":
			return "password";
		case "computer-offline":
			return "computer-offline";
		case "relay-down":
			return "relay-stopped";
		case "unknown-tunnel":
			return "tunnel-gone";
		case "gateway-refused":
			return "retry";
		case "origin-refused":
		case "too-large":
			return "diagnostic";
		case "malformed-frame":
		case "rejected":
			return "none";
	}
}

/**
 * One failure, with every decision already resolved.
 *
 * `message` is safe to display when `detail` came from the gateway (that copy is
 * written for a phone); for a client-bug class it is a diagnostic and the
 * `surface` says not to show it.
 */
export class RelayError extends Error {
	override readonly name = "RelayError";

	readonly kind: RelayErrorKind;
	readonly status: number | undefined;
	readonly detail: string | undefined;
	readonly serverError: string | undefined;
	readonly code: string | undefined;
	readonly reason: GatewayReason | undefined;
	readonly reasonRaw: string | undefined;
	readonly retryAfterMs: number | undefined;
	readonly envelope: EnvelopeDirective;
	readonly retry: RetryDirective;
	readonly surface: ErrorSurface;
	readonly diagnostic: string | undefined;

	constructor(
		kind: RelayErrorKind,
		message: string,
		init: RelayErrorInit = {},
	) {
		super(message);
		this.kind = kind;
		this.status = init.status;
		this.detail = init.detail;
		this.serverError = init.serverError;
		this.code = init.code;
		this.reason = init.reason;
		this.reasonRaw = init.reasonRaw;
		this.retryAfterMs = init.retryAfterMs;
		this.envelope = init.envelope ?? defaultEnvelopeFor(kind);
		this.retry = init.retry ?? defaultRetryFor(kind);
		this.surface = init.surface ?? defaultSurfaceFor(kind);
		this.diagnostic = init.diagnostic;
		if (init.cause !== undefined) this.cause = init.cause;
	}

	/** The copy a screen may show — the ONE accessor for it, and it is always a
	 *  sentence. It refuses the three things that are not copy: a `transport`
	 *  failure's message (the RUNTIME's own words), an empty body, and a body that is
	 *  markup. Every other kind carries a sentence this build wrote, so a screen that
	 *  reads this never renders `""` or `<html><body>502 Bad Gateway</body></html>`
	 *  for a proxy's answer (review round 4, M1/Q2). A screen that must not show copy
	 *  at all is the `surface: "diagnostic"` case — a client bug — and that is read
	 *  from `surface`, not from this returning nothing. */
	get displayableMessage(): string {
		if (this.kind === "transport") return TRANSPORT_SENTENCE;
		return (
			[this.detail, this.serverError, this.message]
				.map((value) => value?.trim() ?? "")
				.find((value) => value !== "" && !value.startsWith("<")) ??
			/* Last resort, and unreachable for every arm this build writes — each one
			 * falls back to a sentence of its own when the body said nothing usable.
			 * It exists so this accessor cannot hand back an empty string. */
			TRANSPORT_SENTENCE
		);
	}

	/** One loggable line. Carries no token, no hostname, no transcript text. */
	get summary(): string {
		const parts: string[] = [this.kind];
		if (this.status !== undefined) parts.push(String(this.status));
		if (this.reasonRaw) parts.push(this.reasonRaw);
		else if (this.reason) parts.push(this.reason);
		return parts.join(" ");
	}
}

export function isRelayError(value: unknown): value is RelayError {
	return value instanceof RelayError;
}

/** System error codes that mean the CERTIFICATE, not the network. Kept tight: a
 *  protocol-level TLS complaint (speaking TLS to the wrong port, for instance) is
 *  not a certificate the user has to fix, so it stays `transport`. */
/** System error codes that mean the CERTIFICATE was rejected. A closed list on
 *  purpose: it is matched against whatever a runtime puts in `error.code`, and a
 *  pattern over that namespace would classify a code nobody has seen yet. Every
 *  entry is a Node/OpenSSL name for a verification failure (review round 5, m1
 *  added the last four). */
const CERTIFICATE_CODES = new Set([
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"CERT_REVOKED",
	"CERT_SIGNATURE_FAILURE",
	"CERT_UNTRUSTED",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"HOSTNAME_MISMATCH",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_GET_ISSUER_CERT",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** System error codes that mean the NAME did not resolve. `EAI_AGAIN` is a
 *  resolver timeout, which a later attempt can clear; `ENOTFOUND` usually is not
 *  — both are the address's problem rather than the network's. */
const DNS_CODES = new Set(["EAI_AGAIN", "ENOTFOUND", "ERR_NAME_NOT_RESOLVED"]);

/* Where a runtime sends no code, its MESSAGE is the only signal, and it is a
 * weaker one — so these match words that cannot mean anything else. `getaddrinfo`
 * appears in the code's own message, which is why it is here as well as `ENOTFOUND`.
 *
 * The certificate arm is a CLOSED LIST of failure PHRASES, anchored to a
 * verification failure rather than to the noun: `/certificate/` classified "the
 * certificate story is long; the request timed out" as a rejected certificate, which
 * tells a caller NEVER to retry a failure a retry would clear (review round 4, m1).
 * It is a list rather than one pattern because the phrasings are what runtimes
 * actually print — `unable to get local issuer certificate`, `certificate is not yet
 * valid`, `Hostname/IP does not match certificate's altnames`, `SSL error:
 * certificate verify failed` (review round 5, m1). A timeout that happens to mention
 * certificates matches none of them and stays `transport`.
 *
 * React Native and browsers send no code AND say only "Network request failed" /
 * "Failed to fetch", so neither arm can classify on those targets; the failure is a
 * `transport` there, which is the safe direction (retryable) and is documented. */
const CERTIFICATE_TEXT =
	/self[- ]signed|certificate (is |has )?(expired|invalid|untrusted|rejected|revoked)|certificate (is )?not yet valid|unable to (verify|get (local )?issuer)|(does not|doesn't) match certificate|altnames|certificate verify failed/i;
const DNS_TEXT =
	/getaddrinfo|ENOTFOUND|name not resolved|could not be resolved/i;

/** Every `code` in a rejection's cause chain, nearest first. Node's fetch wraps the
 *  system error (`TypeError: fetch failed` → `.cause` = the `Error` with the code),
 *  so one level is the norm and the walk costs nothing. */
function causeCodes(cause: unknown): string[] {
	const codes: string[] = [];
	let current: unknown = cause;
	for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
		const code = (current as { code?: unknown }).code;
		if (typeof code === "string") codes.push(code);
		current = current.cause;
	}
	return codes;
}

/**
 * A failure with no response: DNS, refused, TLS, abort, a stream that dropped.
 *
 * The certificate and DNS arms are split out of `transport` on purpose. All three
 * reach the same catch, and they need three different answers: a rejected
 * certificate is the tunnel's own settings and cannot be fixed by retrying, an
 * unresolvable name means the address is wrong or its DNS record is gone, and only
 * the rest is a general transport failure. A runtime that reports neither a code
 * nor a recognisable message stays `transport` — the honest answer when the cause
 * is unknown, and the one that keeps the retry affordance.
 */
export function transportError(
	cause: unknown,
	diagnostic?: string,
): RelayError {
	const codes = causeCodes(cause);
	const message =
		cause instanceof Error
			? cause.message
			: "the request did not reach the relay";
	if (
		codes.some((code) => CERTIFICATE_CODES.has(code)) ||
		CERTIFICATE_TEXT.test(message)
	) {
		return new RelayError(
			"certificate-rejected",
			"the relay's certificate was rejected",
			{
				cause,
				diagnostic,
			},
		);
	}
	if (codes.some((code) => DNS_CODES.has(code)) || DNS_TEXT.test(message)) {
		return new RelayError(
			"host-unresolved",
			"that address could not be found",
			{
				cause,
				diagnostic,
			},
		);
	}
	return new RelayError("transport", message, { cause, diagnostic });
}

/** The sentence for a failure whose message is the RUNTIME's own words rather than
 *  copy — "fetch failed", "This operation was aborted", "connect ECONNREFUSED …".
 *  Published by `displayableMessage`, which is the one accessor a screen may read. */
export const TRANSPORT_SENTENCE = "The relay could not be reached.";

/** Body text a screen could be shown, when there is any.
 *
 * An EMPTY body and a markup body are both ordinary — a proxy's 502 answers with
 * nothing, or with an HTML error page — and neither is a sentence: the first renders
 * as nothing at all, the second puts `<html><body>502 Bad Gateway</body></html>` on a
 * phone. `undefined` sends the caller to its own written copy, which is why every
 * text arm below asks this rather than slicing the raw body: a `slice` of an empty
 * string is a string, so the written sentence used to be unreachable and the message
 * was empty (review round 4, M1). */
function readableBodyText(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed === "" || trimmed.startsWith("<")) return undefined;
	return trimmed.slice(0, 200);
}

/**
 * A 2xx whose body did not match its schema.
 *
 * Deliberately `envelope: "keep"`: a command that answered 200 with an
 * unreadable body was very likely admitted, and clearing the envelope on a
 * client-side parse failure is how the same instruction gets sent twice under a
 * new UUID. The user sees the failure; the envelope survives the ambiguity.
 */
export function malformedFrameError(
	what: string,
	cause: unknown,
	status?: number,
	/** Present names, so a diagnostic can show whether a proxy rewrote the response. */
	headerNames?: readonly string[],
): RelayError {
	return new RelayError(
		"malformed-frame",
		`${what} did not match the relay contract`,
		{
			status,
			diagnostic:
				headerNames && headerNames.length > 0
					? `${what} [${headerNames.join(",")}]`
					: what,
			cause,
			envelope: "keep",
			retry: "never",
		},
	);
}

/** Narrows an unknown to a plain object, or `undefined`. */
function asObject(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

/** `JSON.parse` that answers `undefined` instead of throwing: a body that is not
 *  JSON is a normal case here (the edge's `text/plain` and the relay's login
 *  page), not an error to report from a classifier. */
function safeParse(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/** A 429 from the control plane or the relay. Back off; the session endpoints
 *  are per-IP limited to 5/s burst 20, so a stampede hurts every device on that
 *  address. */
export function rateLimitedError(retryAfterMs?: number): RelayError {
	return new RelayError("rate-limited", "rate limited", {
		status: 429,
		retryAfterMs,
	});
}

export interface RelayResponseFacts {
	status: number;
	/** Response headers, read case-insensitively by the caller. */
	header: (name: string) => string | null;
	/** The parsed JSON body, when the responder sent JSON. */
	body?: unknown;
	/** The raw body text, for the `text/plain` arms and diagnostics. */
	text?: string;
}

/**
 * Map a non-2xx response onto the taxonomy.
 *
 * The order of these checks is the contract: the edge and the gateway answer
 * some of the same statuses with different bodies, and only the body (or the
 * presence of `X-Radient-Login`) says which gate spoke.
 */
/** A string from the body, or `undefined` when there is nothing to show.
 *
 * `{"error":""}` is a real relay body shape, and `??` keeps it: the arms below would
 * then write an EMPTY message while their written copy stayed unreachable — a 401
 * whose sentence came out as "The relay could not be reached." (review round 5, m3).
 * Empty means absent, so each arm falls through to its own sentence. */
function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function relayErrorFromResponse(
	facts: RelayResponseFacts,
	diagnostic?: string,
): RelayError {
	const { status } = facts;
	const text = facts.text ?? "";
	/* A caller may hand over the parsed body or the raw text; both are accepted so
	 * the taxonomy has one implementation rather than a parsing rule per caller.
	 * Parsing is attempted only when no body was supplied, and only for something
	 * that looks like an object, so an HTML login page is never "parsed". */
	const objectBody =
		asObject(facts.body) ??
		(facts.body === undefined && text.trimStart().startsWith("{")
			? asObject(safeParse(text))
			: undefined);
	const serverError = nonEmpty(
		typeof objectBody?.error === "string" ? objectBody.error : undefined,
	);
	const code =
		typeof objectBody?.code === "string" ? objectBody.code : undefined;
	const detail = nonEmpty(
		typeof objectBody?.detail === "string" ? objectBody.detail : undefined,
	);
	const reasonRaw =
		typeof objectBody?.reason === "string" ? objectBody.reason : undefined;
	const retryAfterMs = parseRetryAfter(facts.header("retry-after"));

	const common: RelayErrorInit = {
		status,
		code,
		detail,
		serverError,
		reasonRaw,
		retryAfterMs,
		diagnostic,
	};

	switch (status) {
		case 401: {
			/* The edge's own 401 is the one that carries `X-Radient-Login`; the relay's
			 * custom-route 401 is plain JSON. They need opposite user actions, and the
			 * header is the only discriminator. */
			if (facts.header("x-radient-login")) {
				return new RelayError(
					"radiant-login-required",
					"tunnel session expired",
					common,
				);
			}
			return new RelayError(
				"relay-unauthorized",
				serverError ?? "authentication required",
				common,
			);
		}
		case 403:
			return new RelayError(
				"origin-refused",
				serverError ?? "same-origin request required",
				common,
			);
		case 413:
			return new RelayError(
				"too-large",
				serverError ?? "request is too large",
				common,
			);
		case 429:
			return new RelayError(
				"rate-limited",
				serverError ?? "rate limited",
				common,
			);
		case 404:
			/* Both gates answer 404 for "this hostname is not (or no longer) a tunnel",
			 * the edge as text/plain and the gateway as JSON. Either way the answer is
			 * re-discovery, not a retry. */
			if (UNKNOWN_TUNNEL.test(serverError ?? text)) {
				return new RelayError(
					"unknown-tunnel",
					serverError ?? "unknown tunnel",
					common,
				);
			}
			return new RelayError(
				"rejected",
				serverError ?? readableBodyText(text) ?? "not found",
				common,
			);
		case 503: {
			/* Two very different machines answer 503 through the same status:
			 * the edge's plain-text "Tunnel temporarily unavailable" (the connector is
			 * not there) and the gateway's JSON `{detail, reason}` (the connector is
			 * there and refusing). A JSON body with a `reason` is the gateway. */
			if (reasonRaw !== undefined || detail !== undefined) {
				const reason = isGatewayReason(reasonRaw) ? reasonRaw : undefined;
				const policy = reason ? REASON_POLICY[reason] : undefined;
				return new RelayError(
					"gateway-refused",
					detail ?? serverError ?? "tunnel authorization unavailable",
					{
						...common,
						reason,
						reasonRaw,
						surface: policy?.surface,
						retry: policy?.retry,
						retryAfterMs: retryAfterMs ?? policy?.retryAfterMs,
					},
				);
			}
			return new RelayError(
				"computer-offline",
				readableBodyText(text) ?? "tunnel temporarily unavailable",
				common,
			);
		}
		case 502: {
			/* `local harness unavailable` is the gateway telling us the relay daemon is
			 * not running; any other 502 is a proxy/host error. Both leave delivery
			 * ambiguous, which `defaultEnvelopeFor` already decides. */
			if (LOCAL_HARNESS_UNAVAILABLE.test(serverError ?? text)) {
				return new RelayError(
					"relay-down",
					serverError ?? "local harness unavailable",
					common,
				);
			}
			return new RelayError(
				"ambiguous-delivery",
				serverError ?? readableBodyText(text) ?? "bad gateway",
				common,
			);
		}
		case 408:
		case 504:
			return new RelayError(
				"ambiguous-delivery",
				serverError ?? "the relay did not answer in time",
				common,
			);
		default:
			return new RelayError(
				"rejected",
				serverError ?? readableBodyText(text) ?? `unexpected status ${status}`,
				common,
			);
	}
}

/** `Retry-After` may be delta-seconds or an HTTP date; both are legal and the
 *  gateway sends the former. A malformed value is ignored rather than guessed. */
export function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (DELTA_SECONDS.test(trimmed)) return Number(trimmed) * 1000;
	const asDate = Date.parse(trimmed);
	if (!Number.isNaN(asDate)) {
		const delta = asDate - Date.now();
		return delta > 0 ? delta : 0;
	}
	return undefined;
}
