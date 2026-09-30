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
 *   `retry-envelope.ts`). It is NOT "should we retry": `502/504/408` and a
 *   transport failure leave the outcome ambiguous and the envelope is kept, a
 *   definitive `4xx` (except 408) or any `5xx` outside that set is a
 *   pre-admission rejection and the envelope is cleared.
 * - `retry` — what an automatic retry may do, and after how long.
 *
 * `surface` is the UI's decision, pre-made here so three screens cannot each
 * invent their own reading of "503": the ADR's table (`ADR 0002` §4) maps each
 * response to exactly one surface, and the gateway's `reason` vocabulary splits
 * the 503 arm further (`gateway.py:73-95`).
 */

/** What went wrong, at the granularity a screen or a policy switches on. */
export type RelayErrorKind =
	/** No response at all: DNS, connection refused, TLS, abort, a dropped stream. */
	| "transport"
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

/** Whether a persisted command's outcome is still unknown (keep the envelope)
 *  or has been settled (clear it). Mirrors `retry-envelope.ts`'s rules. */
export type EnvelopeDirective = "keep" | "clear" | "clear-all";

/** What an automatic retry may do with this request. */
export type RetryDirective = "never" | "same-id" | "after-backoff" | "re-mint";

/** The UI state this failure belongs to. Pre-decided so screens agree. */
export type ErrorSurface =
	/** Radient sign-in is needed again. */
	| "sign-in"
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
 * The gateway's refusal vocabulary (`gateway.py:73-95`, dumped from the module
 * into `fixtures/relay/gateway/gateway-refusal-constants.json`). Each one maps
 * to a different action, which is why they are not collapsed into one error.
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
 *  itself annotates with `Retry-After: 120` (`gateway.py:504-518`), and the
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

	/** The copy a screen may show, or `undefined` when this build must not show
	 *  copy at all (a client bug) — the caller then offers a retry instead. */
	get displayableMessage(): string | undefined {
		if (this.surface === "diagnostic") return undefined;
		return this.detail ?? this.serverError ?? this.message;
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

/** A failure with no response: DNS, refused, TLS, abort, a stream that dropped. */
export function transportError(
	cause: unknown,
	diagnostic?: string,
): RelayError {
	const message =
		cause instanceof Error
			? cause.message
			: "the request did not reach the relay";
	return new RelayError("transport", message, { cause, diagnostic });
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
	const serverError =
		typeof objectBody?.error === "string" ? objectBody.error : undefined;
	const code =
		typeof objectBody?.code === "string" ? objectBody.code : undefined;
	const detail =
		typeof objectBody?.detail === "string" ? objectBody.detail : undefined;
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
				serverError ?? text.slice(0, 200) ?? "not found",
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
				text.trim().slice(0, 200) || "tunnel temporarily unavailable",
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
				serverError ?? text.slice(0, 200) ?? "bad gateway",
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
				serverError ?? text.slice(0, 200) ?? `unexpected status ${status}`,
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
