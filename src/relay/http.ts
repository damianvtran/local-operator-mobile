/**
 * The relay HTTP transport: one request path, one header policy, one status
 * mapping.
 *
 * The rules this file exists to enforce, all of them from `ADR 0002` §4 and
 * `docs/relay/tunnel-edge.md` §1.1 — each one is a bug the client would
 * otherwise have to rediscover in the field:
 *
 * - **The `Cookie` header is ours; the platform jar is not.** On the Radient
 *   route the client sets `Cookie` by hand (`credentials: 'omit'`), because the
 *   edge strips `lop_mobile` and the gateway injects the relay's own cookie
 *   itself. On the custom route the jar owns `lop_mobile` (`credentials:
 *   'include'`), because reading `Set-Cookie` back is the uncertain part on iOS.
 *   Which policy applies is the `RequestAuth` the caller supplies, so this file
 *   never has to know which route it is on.
 * - **`Origin` goes on every request, not only mutations.** Both gates compare
 *   an exact string and the relay requires it for mutations; sending it always
 *   costs nothing and removes a class of 403s.
 * - **Never `Sec-Fetch-*`.** A `cross-site`/`same-site` value that is not a
 *   navigation is rejected at the edge, and a native client has no business
 *   claiming browser fetch metadata.
 * - **`redirect: 'manual'` always.** A `/login` success is a 303, and a 303 to
 *   `/_radient/login` on the tunnel route is a diagnostic rather than a page to
 *   follow. Following one would turn a 303 into an HTML body.
 * - **`no-store` is ours.** The relay sets no `Cache-Control` on JSON
 *   (`secure_cookie()` is dead code), so nothing upstream forbids caching it.
 * - **`Set-Cookie` is never read.** On the tunnel route the app owns its session
 *   and refreshes it through the control plane on its own schedule
 *   (`tunnel-edge.md` §2.1: "Accept no `Set-Cookie`"); on the custom route the
 *   platform jar keeps `lop_mobile`. Nothing in this module surfaces a cookie, so
 *   no caller can grow a dependency on one.
 * - **A timeout is a transport error, not an ambiguous success.** There is no
 *   path here that turns an unanswered request into a `2xx`.
 * - **A redirect the platform hid is an outcome, never a `0`.** A browser with
 *   `redirect: 'manual'` answers a form login with an opaque redirect (`status` 0,
 *   no headers, no body) instead of the relay's `303`; `isOpaqueRedirect` names
 *   that shape so no endpoint has to re-discover it (see `endpoints.login`, which
 *   verifies admission rather than trusting it).
 */

import {
	type Payload,
	parseJsonPayload,
	type SchemaName,
	safeParseJsonPayload,
} from "../contracts";
import {
	malformedFrameError,
	RelayError,
	type RelayResponseFacts,
	relayErrorFromResponse,
	transportError,
} from "./errors";
import { resolveFetch } from "./platform-fetch";

/** What the caller's route policy says about this request's credentials. */
export interface RequestAuth {
	/** Value for the `Cookie` header, or `null` to send none. */
	readonly cookie: string | null;
	/** Value for `Origin`, or `null` to send none (a loopback relay accepts an
	 *  absent `Origin`; the edge does not require it on reads). */
	readonly origin: string | null;
	/** `'omit'` when we own the header (tunnel), `'include'` when the platform jar
	 *  owns the relay cookie (custom route). */
	readonly credentials: "omit" | "include";
}

export interface RelayResponseFactsWithHeaders extends RelayResponseFacts {
	/** Lower-cased header names present on the response, for diagnostics. */
	headerNames: readonly string[];
}

export interface RelayHttpOptions {
	/** Relay base URL with no trailing slash — the tunnel origin or the custom
	 *  base. Every route is resolved against it. */
	baseUrl: string;
	/** Resolved per request so a grant refreshed a moment ago is the one used. */
	auth: () => RequestAuth | Promise<RequestAuth>;
	/** Injected for tests and for `expo/fetch` on a platform where the global
	 *  fetch cannot stream. Defaults to the global. */
	fetchImpl?: typeof globalThis.fetch;
	/** Called with every response's headers, including failures. The tunnel route
	 *  uses this to persist a transparently-refreshed `__Host-radient-*` pair. */
	onResponse?: (facts: RelayResponseFactsWithHeaders) => void | Promise<void>;
	/** Per-request deadline. `0` disables it (a stream needs its own budget). */
	timeoutMs?: number;
	/** Prefix for diagnostics a developer reads: never a URL a user sees, never a
	 *  token. */
	diagnostic?: string;
}

export interface RelayRequest {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	/** Path beginning with `/`, already escaped by the caller. Empty for a request
	 *  addressed by `absoluteUrl` (the owner API is not the relay and shares no
	 *  base with it). */
	path?: string;
	/** JSON body. Serialised once and reused, never re-encoded per attempt. */
	body?: unknown;
	/** Form body for `POST /login`, which the relay only accepts as
	 *  `application/x-www-form-urlencoded`. */
	form?: Record<string, string>;
	/** Absolute URL for the owner API (`api.radienthq.com`), which is not the
	 *  relay and does not share its base. */
	absoluteUrl?: string;
	/** Extra headers for the rare route that needs them (the owner API's bearer). */
	headers?: Record<string, string>;
	/** No timeout at all: used by an SSE open, whose deadline is the stream's. */
	streaming?: boolean;
	/**
	 * Statuses this route treats as a SUCCESS rather than classifying as a failure.
	 *
	 * It exists for exactly one shape on this wire: the relay answers a successful
	 * form login with `303 → /`, and a `303` is not `response.ok`. Without this, the
	 * custom route's only credential path would be classified as an error even
	 * though the relay accepted the password.
	 */
	accept?: readonly number[];
	signal?: AbortSignal;
}

/** A response whose body is a byte stream, handed to `sse.ts`. */
export interface RelayStreamResponse {
	status: number;
	headers: RelayResponseFactsWithHeaders;
	reader: ReadableStreamDefaultReader<Uint8Array>;
	/** Releases the body. Idempotent, and always safe to call twice: a stream
	 *  loop calls it in a `finally` and the caller may call it on teardown. */
	release: () => Promise<void>;
}

/* Hoisted: matched per request. */
const TRAILING_SLASHES = /\/+$/;

const CONTENT_TYPE_JSON = "application/json";
const CONTENT_TYPE_FORM = "application/x-www-form-urlencoded";

function isRedirectStatus(status: number): boolean {
	return status >= 300 && status < 400;
}

/**
 * True when the platform handed back a redirect it refuses to describe.
 *
 * `fetch(url, { redirect: 'manual' })` in a browser answers an opaque redirect:
 * `type: 'opaqueredirect'`, `status` 0, no headers and no body — the target is
 * cross-origin as far as the CORS model is concerned, so its URL and its status
 * are unreadable by design. Node's undici and `expo/fetch` return the real `303`,
 * which is why the fixture suite, the native app and `scripts/relay-smoke.ts` all
 * see the truth while a browser user sees `0`. Without this check the relay's
 * successful form login is classified as a failure with an empty message.
 *
 * `status === 0` is tested alongside the type because a polyfill may omit `type`.
 * Nothing else on this wire answers 0: a genuine transport failure REJECTS the
 * promise rather than returning a statusless response.
 */
export function isOpaqueRedirect(response: Response): boolean {
	return response.type === "opaqueredirect" || response.status === 0;
}

export class RelayHttpClient {
	private readonly baseUrl: string;
	private readonly auth: RelayHttpOptions["auth"];
	private readonly fetchImpl: typeof globalThis.fetch;
	private readonly onResponse: RelayHttpOptions["onResponse"];
	private readonly timeoutMs: number;
	private readonly diagnostic: string;

	constructor(options: RelayHttpOptions) {
		this.baseUrl = options.baseUrl.replace(TRAILING_SLASHES, "");
		this.auth = options.auth;
		/* Bound, not merely captured: see `platform-fetch.ts` for the browser
		 * brand-check this avoids. A missing fetch is a build problem and is loud
		 * here, rather than every request failing later as a transport error. */
		this.fetchImpl = resolveFetch(options.fetchImpl);
		this.onResponse = options.onResponse;
		this.timeoutMs = options.timeoutMs ?? 20_000;
		this.diagnostic = options.diagnostic ?? "relay";
	}

	url(request: RelayRequest): string {
		if (request.absoluteUrl) return request.absoluteUrl;
		return `${this.baseUrl}${request.path}`;
	}

	/**
	 * Performs one request and returns the raw response plus its body text.
	 *
	 * Failure classification happens here rather than in each endpoint, so a
	 * `503` from the edge and a `503` from the gateway cannot be read two
	 * different ways by two screens.
	 */
	async raw(request: RelayRequest): Promise<{
		status: number;
		headers: RelayResponseFactsWithHeaders;
		text: string;
		/** True when the platform hid a redirect, so `status` is 0 and neither the
		 *  headers nor the body say what the server actually answered. The endpoint
		 *  decides what that means; see `endpoints.login`. */
		redirectHidden: boolean;
	}> {
		const { response, release } = await this.open(request);
		try {
			const text = await response.text();
			return {
				status: response.status,
				headers: responseFacts(response),
				text,
				redirectHidden: isOpaqueRedirect(response),
			};
		} finally {
			await release();
		}
	}

	/**
	 * Opens a request and returns the status and headers WITHOUT consuming the
	 * body, so an SSE caller can read it as a stream.
	 *
	 * A non-2xx is thrown here rather than handed to the stream loop: the two
	 * have different remedies (`sse.ts` reopens on a clean EOF, but a 401 or a
	 * `503 reason` must reach the connection state machine), and returning a
	 * "successful" 401 response to a stream reader is exactly how an
	 * `EventSource`-shaped client retries forever on a stale session.
	 */
	async open(
		request: RelayRequest,
	): Promise<{ response: Response; release: () => Promise<void> }> {
		const auth = await this.auth();
		const headers = buildHeaders(auth, request);
		const controller = new AbortController();
		const timeout =
			request.streaming || this.timeoutMs <= 0
				? undefined
				: setTimeout(() => controller.abort(), this.timeoutMs);
		/* The caller's signal wins: a route switch must be able to abort an in-flight
		 * request even while our own deadline is pending. */
		const onExternalAbort = () => controller.abort();
		request.signal?.addEventListener("abort", onExternalAbort, { once: true });

		let response: Response;
		try {
			response = await this.fetchImpl(this.url(request), {
				method: request.method,
				headers,
				body: serialiseBody(request),
				/* We own authentication on the tunnel route, so the jar must not attach
				 * or store anything; on the custom route the jar is the design. */
				credentials: auth.credentials,
				/* A 303 to /login is a diagnostic, never a page to render. */
				redirect: "manual",
				/* The relay sets no Cache-Control on JSON; the policy has to be ours. */
				cache: "no-store",
				signal: controller.signal,
			});
		} catch (cause) {
			throw transportError(
				cause,
				`${this.diagnostic} ${request.method} ${redactPath(request.path)}`,
			);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
			request.signal?.removeEventListener("abort", onExternalAbort);
		}

		const facts = responseFacts(response);
		await this.onResponse?.(facts);

		const release = async () => {
			try {
				await response.body?.cancel();
			} catch {
				/* Cancelling an already-finished body throws on some runtimes and means
				 * nothing here: the body is gone either way. */
			}
		};

		if (isOpaqueRedirect(response)) {
			/* A redirect the platform hid. A route that declared a redirect among the
			 * outcomes it READS (`accept` carries a 3xx, as `/login` and `/logout` do)
			 * gets the response back and decides for itself — `endpoints.login` verifies
			 * admission with a follow-up read instead of trusting this. Anywhere else a
			 * hidden redirect is a transport failure: there is no status, no body and no
			 * header to classify, and saying so is the only honest sentence available. */
			if (!(request.accept ?? []).some(isRedirectStatus)) {
				await release();
				throw new RelayError(
					"transport",
					"the platform hid a redirect this route does not expect",
					{
						status: 0,
						diagnostic: `${this.diagnostic} ${request.method} ${redactPath(request.path)}`,
					},
				);
			}
		} else if (!response.ok && !request.accept?.includes(response.status)) {
			/* Read the body for the taxonomy: the gateway's refusal carries the only
			 * sentence written for a phone, and losing it turns a fixable state into
			 * "something went wrong". A body that cannot be read still classifies. */
			let bodyText = "";
			try {
				bodyText = await response.text();
			} catch {
				bodyText = "";
			}
			await release();
			throw relayErrorFromResponse(
				{ ...facts, text: bodyText },
				`${this.diagnostic} ${request.method} ${redactPath(request.path)}`,
			);
		}

		return { response, release };
	}

	/** Parses a `2xx` JSON body against its schema. A body that does not match is
	 *  a `malformed-frame` `RelayError`, never a silent `any`. */
	async json<K extends SchemaName>(
		schema: K,
		request: RelayRequest,
	): Promise<Payload<K>> {
		const { text, status, headers } = await this.raw(request);
		const result = safeParseJsonPayload(schema, text);
		if (result.ok) return result.data;
		throw malformedFrameError(
			`${this.diagnostic} ${request.method} ${redactPath(request.path)}`,
			result.error,
			status,
			headers.headerNames,
		);
	}

	/** As `json`, for the body callers that already hold the text. */
	parse<K extends SchemaName>(
		schema: K,
		text: string,
		status = 200,
	): Payload<K> {
		try {
			return parseJsonPayload(schema, text);
		} catch (cause) {
			throw malformedFrameError(`${this.diagnostic} body`, cause, status, []);
		}
	}

	/** A `2xx` text body. Used for the routes that answer HTML or plain text and
	 *  for diagnostics; it never parses JSON. */
	async text(request: RelayRequest): Promise<string> {
		const { text } = await this.raw(request);
		return text;
	}

	/**
	 * A `2xx` binary body: `GET /api/sessions/{id}/image` answers raw image bytes
	 * with the stored mime type.
	 *
	 * The bytes go through `arrayBuffer()` rather than `text()` on purpose — a
	 * transcript screenshot decoded as UTF-8 is corrupted in a way that renders as
	 * a broken image with no error anywhere.
	 */
	async bytes(
		request: RelayRequest,
	): Promise<{ status: number; mimeType: string | null; bytes: Uint8Array }> {
		const { response, release } = await this.open(request);
		try {
			const buffer = await response.arrayBuffer();
			return {
				status: response.status,
				mimeType: response.headers.get("content-type"),
				bytes: new Uint8Array(buffer),
			};
		} finally {
			await release();
		}
	}

	/**
	 * Opens an SSE route.
	 *
	 * `Accept: text/event-stream` and `Cache-Control: no-cache` are sent, and the
	 * response's `x-accel-buffering` is preserved by the gateway's allow-list —
	 * which is what turns buffering off at an nginx-family proxy.
	 */
	async stream(request: RelayRequest): Promise<RelayStreamResponse> {
		const { response, release } = await this.open({
			...request,
			streaming: true,
		});
		const body = response.body;
		if (!body || typeof body.getReader !== "function") {
			await release();
			/* Expo's fetch supports a streaming body; the global on a platform that
			 * does not is the failure this names, rather than a stream that silently
			 * yields nothing and looks like a quiet relay. */
			throw new RelayError(
				"transport",
				"this runtime cannot stream a response body (no ReadableStream on the response)",
				{
					diagnostic: `${this.diagnostic} ${request.method} ${redactPath(request.path)}`,
				},
			);
		}
		return {
			status: response.status,
			headers: responseFacts(response),
			reader: body.getReader(),
			release,
		};
	}
}

/**
 * The header contract, in one place.
 *
 * `accept` is set per request shape; `content-type` only when there is a body,
 * because a `GET` with a content type is a smell a proxy can act on.
 */
function buildHeaders(
	auth: RequestAuth,
	request: RelayRequest,
): Record<string, string> {
	const headers: Record<string, string> = {
		accept: request.form ? "text/html, application/json" : CONTENT_TYPE_JSON,
	};
	if (request.form) headers["content-type"] = CONTENT_TYPE_FORM;
	else if (request.body !== undefined)
		headers["content-type"] = CONTENT_TYPE_JSON;
	if (auth.cookie) headers.cookie = auth.cookie;
	if (auth.origin) headers.origin = auth.origin;
	if (request.headers) Object.assign(headers, request.headers);
	/* Deliberately absent, and named here so a future edit does not add them:
	 * `sec-fetch-site` / `sec-fetch-mode` (rejected at the edge unless it is a
	 * navigation), `authorization` on the tunnel route (the edge deletes it), and
	 * `x-forwarded-*` (stripped, and a lie off a browser). */
	return headers;
}

function serialiseBody(request: RelayRequest): string | undefined {
	if (request.form) {
		/* The relay's login route only reads a form body; `URLSearchParams` escapes
		 * it the way a browser would, which is what the daemon's parser expects. */
		return new URLSearchParams(request.form).toString();
	}
	if (request.body === undefined) return undefined;
	return JSON.stringify(request.body);
}

function responseFacts(response: Response): RelayResponseFactsWithHeaders {
	const header = (name: string) => response.headers.get(name);
	const headerNames: string[] = [];
	response.headers.forEach((_value, key) => {
		headerNames.push(key.toLowerCase());
	});
	return {
		status: response.status,
		header,
		headerNames: headerNames.sort(),
	};
}

/** Path without query values: a query can carry a search term or a hostname and
 *  neither belongs in a diagnostic string. */
function redactPath(path: string | undefined): string {
	if (!path) return "";
	const index = path.indexOf("?");
	return index === -1 ? path : `${path.slice(0, index)}?…`;
}
