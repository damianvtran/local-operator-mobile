/**
 * One typed function per relay route the app uses.
 *
 * This module is the protocol's vocabulary: nothing above it constructs a path,
 * a query string or a method, so a route cannot be called two ways from two
 * screens. It is deliberately UI-free and navigation-free (it imports
 * `src/contracts/` and `./http` and nothing else), which is what lets the whole
 * protocol be exercised in Node — including from `scripts/relay-smoke.mjs`
 * against a real relay.
 *
 * Three conventions, applied uniformly because they are the contract's own:
 *
 * - **`limit` is clamped, not rejected.** The relay falls back to its default on
 *   a non-numeric limit rather than erroring (`daemon.py:3746-3750`), and a
 *   client that sends a bad one has a bug it would rather see than hide; so the
 *   bounds are applied here and an out-of-range value is corrected to the
 *   contract's range.
 * - **Mutations send the ADR's exact bodies.** `pin` carries the desired state
 *   rather than a toggle (so a retry cannot flip it back), `seen` carries the
 *   `completion_token` the projection named, and `command` carries an op from
 *   `commandOpSchema`.
 * - **Every response is schema-validated before it is returned**, so an endpoint
 *   returns a typed payload or throws a `RelayError`. There is no path here that
 *   hands a caller `any`.
 */

import type { z } from "zod";

import {
	type commandOpSchema,
	type Payload,
	type PromptImage,
	parsePayload,
} from "../contracts";
import type { RelayHttpClient, RelayStreamResponse } from "./http";
import {
	type DecodedFrame,
	SseConnection,
	type SseConnectionOptions,
} from "./sse";

/** The command bodies the app sends. Derived from the schema, so a body this
 *  module accepts is one the relay's own shape validation will accept. */
export type CommandBody = z.input<typeof commandOpSchema>;

export interface HistoryPage {
	/** The id of the oldest entry the caller already holds, so the page is the
	 *  entries immediately older than it. Omitted means the tail. */
	before?: string;
	limit?: number;
}

export interface SearchRequest {
	query: string;
	limit?: number;
}

export interface StartSessionRequest {
	cwd?: string;
	provider?: string;
	model_id?: string;
}

export interface ImageBytes {
	bytes: Uint8Array;
	/** The relay's stored mime type; `null` when the response carried none. */
	mimeType: string | null;
}

/** The relay's own defaults and clamps (`daemon.py:3746-3750`, `:4254-4258`). */
export const HISTORY_LIMIT = { default: 80, min: 1, max: 200 } as const;
export const SEARCH_LIMIT = { default: 40, min: 1, max: 200 } as const;

function clamp(
	value: number | undefined,
	bounds: { default: number; min: number; max: number },
): number {
	if (value === undefined || !Number.isFinite(value)) return bounds.default;
	return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
}

function query(params: Record<string, string | number | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue;
		search.set(key, String(value));
	}
	const text = search.toString();
	return text.length > 0 ? `?${text}` : "";
}

/** A stream handle plus the connection driving it. Returning both means a caller
 *  never has to reach into the connection to stop it, and a diagnostic page can
 *  read the state without owning the lifecycle. */
export interface RelayStream {
	connection: SseConnection;
	/** Closes the stream and aborts the in-flight request. Idempotent. */
	stop: () => void;
}

/**
 * The relay client. One instance per active route: the base URL and the
 * credential policy are the route (see `src/connection/client-factory.ts`), so a
 * route switch builds a new client rather than reconfiguring this one.
 */
export class RelayEndpoints {
	private readonly http: RelayHttpClient;

	constructor(http: RelayHttpClient) {
		this.http = http;
	}

	/** The reachability probe. Public, no cookie, and `dist: false` is not a
	 *  health problem — the native client never needs the web bundle. */
	async healthz(): Promise<Payload<"healthz">> {
		return this.http.json("healthz", { method: "GET", path: "/healthz" });
	}

	/** The session list. The phone's home screen reads the SSE form of the same
	 *  payload; this exists for the cold-start render and for diagnostics. */
	async sessions(): Promise<Payload<"sessionListFrame">> {
		return this.http.json("sessionListFrame", {
			method: "GET",
			path: "/api/sessions",
		});
	}

	/** Past conversations. **Cannot be paged**: the route takes no `limit`, and a
	 *  client must not promise "load more" (`contract.md` §3.3). */
	async pastSessions(): Promise<Payload<"pastSessions">> {
		return this.http.json("pastSessions", {
			method: "GET",
			path: "/api/sessions/past",
		});
	}

	/** Full-text search over past conversations. `query` is echoed by the relay so
	 *  a late answer can be matched to its request. */
	async searchSessions(
		request: SearchRequest,
	): Promise<Payload<"searchSessions">> {
		return this.http.json("searchSessions", {
			method: "GET",
			path: `/api/sessions/search${query({ q: request.query, limit: clamp(request.limit, SEARCH_LIMIT) })}`,
		});
	}

	/** One page of a session's transcript, older than `before`. */
	async history(
		sessionId: string,
		page: HistoryPage = {},
	): Promise<Payload<"history">> {
		return this.http.json("history", {
			method: "GET",
			path: `/api/sessions/${encodeURIComponent(sessionId)}/history${query({
				before: page.before,
				limit: clamp(page.limit, HISTORY_LIMIT),
			})}`,
		});
	}

	/**
	 * An image block's bytes.
	 *
	 * Requires a LIVE generation (`daemon.py:3782-3784`): a previous conversation's
	 * attachment answers `404 no such image`, so the caller must degrade a previous
	 * transcript's images to a placeholder rather than showing a broken image.
	 */
	async image(
		sessionId: string,
		entryId: string,
		index: number,
	): Promise<ImageBytes> {
		const result = await this.http.bytes({
			method: "GET",
			path: `/api/sessions/${encodeURIComponent(sessionId)}/image${query({ entry: entryId, i: index })}`,
		});
		return { bytes: result.bytes, mimeType: result.mimeType };
	}

	/** A subagent's full cached detail, including the transcript and todos the
	 *  aggregate roster strips. */
	async agentDetail(
		sessionId: string,
		jobId: string,
	): Promise<Payload<"subagentDetail">> {
		return this.http.json("subagentDetail", {
			method: "GET",
			path: `/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(jobId)}`,
		});
	}

	/** One page of a child's own transcript. */
	async agentHistory(
		sessionId: string,
		jobId: string,
		page: HistoryPage = {},
	): Promise<Payload<"history">> {
		return this.http.json("history", {
			method: "GET",
			path: `/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(jobId)}/history${query(
				{
					before: page.before,
					limit: clamp(page.limit, HISTORY_LIMIT),
				},
			)}`,
		});
	}

	/** The off-terminal slash vocabulary, TUI chrome excluded. */
	async commands(): Promise<Payload<"commands">> {
		return this.http.json("commands", { method: "GET", path: "/api/commands" });
	}

	/** The model catalogue. **The array order is the ranking** — render it as
	 *  given; re-sorting it client-side throws away the server's answer. */
	async models(): Promise<Payload<"models">> {
		return this.http.json("models", { method: "GET", path: "/api/models" });
	}

	/** The new-session directory picker's data. `tmp` is the RESOLVED temp dir the
	 *  start gate also compares against. */
	async directories(): Promise<Payload<"directories">> {
		return this.http.json("directories", {
			method: "GET",
			path: "/api/directories",
		});
	}

	/** Starts a supervised session. `cwd` must be under the owner's home or the
	 *  resolved temp dir; anything else is a `400` the caller should surface as a
	 *  validation error rather than a transport failure. */
	async startSession(
		request: StartSessionRequest,
	): Promise<Payload<"startSession">> {
		return this.http.json("startSession", {
			method: "POST",
			path: "/api/sessions/start",
			body: request,
		});
	}

	/** Resumes a past conversation. **Does NOT restore its cwd** — the runtime
	 *  starts at the account home (`daemon.py:4230-4231`), so the caller must not
	 *  promise otherwise. */
	async resumeSession(sessionId: string): Promise<Payload<"resumeSession">> {
		return this.http.json("resumeSession", {
			method: "POST",
			path: "/api/sessions/resume",
			body: { session_id: sessionId },
		});
	}

	/** Acknowledges one completion's `completion_token`. A superseded token is a
	 *  `409` whose remedy is to re-read the projection and retry with the token it
	 *  now names. */
	async seen(
		sessionId: string,
		completionToken: string,
	): Promise<Payload<"seen">> {
		return this.http.json("seen", {
			method: "POST",
			path: `/api/sessions/${encodeURIComponent(sessionId)}/seen`,
			body: { completion_token: completionToken },
		});
	}

	/** Sets a session's pin to a DESIRED state. The answer is the state the store
	 *  read back, so the optimist must render that rather than what it asked for. */
	async pin(sessionId: string, pinned: boolean): Promise<Payload<"pin">> {
		return this.http.json("pin", {
			method: "POST",
			path: `/api/sessions/${encodeURIComponent(sessionId)}/pin`,
			body: { pinned },
		});
	}

	/**
	 * The single command route every mutation travels through.
	 *
	 * `body` is validated against the op union before it is sent, so an op with a
	 * missing field fails here rather than as a `422` the UI has to explain. For
	 * `prompt`/`steer` the caller is responsible for reusing the SAME
	 * `command_id` on a retry — that is `retry-envelope.ts`'s job, and this
	 * function deliberately does not mint one.
	 */
	async command(
		sessionId: string,
		body: CommandBody,
	): Promise<Payload<"commandAck">> {
		/* Validated before it is sent: the relay's own `validate_control_frame` would
		 * refuse a malformed op with a prose `422`, and a client that can produce one
		 * has a bug it should hear about at the call site rather than in a toast. */
		const validated = parsePayload("commandOp", body);
		return this.http.json("commandAck", {
			method: "POST",
			path: `/api/sessions/${encodeURIComponent(sessionId)}/command`,
			body: validated,
		});
	}

	/** Pings a session's runtime. Answered `{"ok":true,"detail":"pong"}`. */
	async ping(sessionId: string): Promise<Payload<"commandAck">> {
		return this.command(sessionId, { op: "ping" });
	}

	/**
	 * `GET /login`: the relay's server-rendered password form, or a `303` to `/`
	 * when the cookie is still valid.
	 *
	 * The status is returned rather than the body: the form is HTML the native
	 * client never renders, and the two facts it needs are "does this relay take a
	 * password form" and "am I already signed in".
	 */
	async loginPage(): Promise<{ status: number; isForm: boolean }> {
		const { status, text } = await this.http.raw({
			method: "GET",
			path: "/login",
			/* `303` means already signed in, which is a state this probe reports rather
			 * than an error. `401` cannot happen here (the page is public) but is
			 * tolerated so a proxy's refusal still reaches the caller as a status. */
			accept: [303, 401],
		});
		return { status, isForm: status === 200 && text.includes("<form") };
	}

	/**
	 * `POST /login`: the custom route's only credential path.
	 *
	 * `application/x-www-form-urlencoded` and `redirect: 'manual'`, because the
	 * relay answers `303 → /` on success and `401` with an HTML page on failure.
	 * Following the redirect would be pointless (there is no HTML to render) and
	 * on the tunnel route a 303 to `/_radient/login` is a diagnostic.
	 *
	 * `credentials: 'include'` is the ROUTE's policy, supplied by the caller's
	 * `RequestAuth`; this function only shapes the body.
	 */
	async login(
		password: string,
	): Promise<{ status: number; signedIn: boolean }> {
		const { status } = await this.http.raw({
			method: "POST",
			path: "/login",
			form: { password },
			/* The two statuses this route's login has: 303 success, 401 refusal. Both
			 * are outcomes to read, not exceptions to throw. */
			accept: [303, 401],
		});
		/* 303 is success. 200 would mean the daemon answered the form again (it
		 * renders the page with an inline error on a wrong password, as a 401), so
		 * anything other than 303 is not a signed-in session. */
		return { status, signedIn: status === 303 };
	}

	/** `GET /logout`: clears the relay's cookie. Not auth-gated, and it does not
	 *  check CSRF — a client calling it must expect to be signed out. The local
	 *  private state is this app's own job to clear; native has no
	 *  `Clear-Site-Data`. */
	async logout(): Promise<{ status: number }> {
		const { status } = await this.http.raw({
			method: "GET",
			path: "/logout",
			accept: [303, 401],
		});
		return { status };
	}

	/** `GET /api/sessions/events`: the list stream. Frames are the same payload as
	 *  `sessions()`, repainted wholesale. */
	sessionsStream(
		options: Omit<SseConnectionOptions, "open"> & { signal?: AbortSignal },
	): RelayStream {
		return this.stream("/api/sessions/events", options);
	}

	/** `GET /api/sessions/{id}/events`: one session's projection stream. The relay
	 *  sends the current projection as the seed frame, which is what makes
	 *  reconnect-and-resync work without a replay protocol. */
	sessionStream(
		sessionId: string,
		options: Omit<SseConnectionOptions, "open"> & { signal?: AbortSignal },
	): RelayStream {
		return this.stream(
			`/api/sessions/${encodeURIComponent(sessionId)}/events`,
			options,
		);
	}

	private stream(
		path: string,
		options: Omit<SseConnectionOptions, "open"> & { signal?: AbortSignal },
	): RelayStream {
		const { signal, ...connectionOptions } = options;
		const connection = new SseConnection({
			...connectionOptions,
			/* The stream's own budget is the gateway's lease, so the HTTP layer's
			 * per-request timeout is disabled here; the watchdog is what detects a dead
			 * socket (`sse.ts`). */
			open: async (abortSignal) => {
				const response: RelayStreamResponse = await this.http.stream({
					method: "GET",
					path,
					streaming: true,
					signal: signal ?? abortSignal,
				});
				return { reader: response.reader, release: response.release };
			},
		});
		return {
			connection,
			stop: () => connection.stop(),
		};
	}
}

/** Decodes a frame without caring which stream it came from. Exported for the
 *  state layer, which switches on `kind`. */
export type { DecodedFrame };

/** A convenience wrapper for a caller that has both streams live and needs to
 *  know which one a frame arrived on. */
export interface StreamHandlers {
	onSessions: (frame: Extract<DecodedFrame, { kind: "sessions" }>) => void;
	onProjection: (frame: Extract<DecodedFrame, { kind: "projection" }>) => void;
}

/** A single-file re-export of the pieces a caller imports most often, so
 *  `endpoints.ts` can stay the one name in `src/relay/index.ts`. */
export type { PromptImage };
