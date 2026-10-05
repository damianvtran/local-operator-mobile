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
 * - **A limit the caller did not supply is OMITTED; one they did is clamped.**
 *   The requested page size is the relay's policy to default (`daemon.py:3834-3838`)
 *   and every captured client request leaves the parameter off when it has no
 *   opinion (`search-empty.json`, `subagent-history-unknown.json`). Sending our own
 *   copy of the default would freeze a server-side value into every request, so a
 *   later change to the relay's default would be overridden by this client rather
 *   than applied. A supplied value is still clamped to the contract's range, so a
 *   caller cannot put a value the relay would have to interpret on the wire.
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
import { isRelayError, type RelayError } from "./errors";
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

/**
 * One audio recording for `POST /api/transcribe`.
 *
 * Two shapes, because the runtime's `FormData` and the browser's are different
 * at the file part: React Native appends a `{ uri, name, type }` descriptor and
 * reads the file itself, while the web/Node targets append a `Blob` with a
 * filename. `audio` is unioned so ONE endpoint call serves both, decided at the
 * call site by the recorder (see `stt/recorder.ts`).
 *
 * `language`, `prompt` and `model` are forward-compat passthroughs (contract
 * §4.10 lists them as optional); nothing in this app sets them yet.
 */
export interface TranscribeUpload {
	audio: Blob | { uri: string; name: string; type: string };
	/** The multipart filename, for the Blob arm. Ignored for the `{ uri }` arm,
	 *  which carries its own `name`. */
	filename?: string;
	language?: string;
	prompt?: string;
	model?: string;
}

/** The raw answer from `POST /api/transcribe`, before it is read into a
 *  sentence. The endpoint returns the STATUS rather than throwing on a refusal,
 *  because every non-401 refusal has a body sentence the UI must show. */
export interface TranscribeResponse {
	status: number;
	text: string;
}

/** The statuses `POST /api/transcribe` can answer with that carry a sentence the
 *  app reads rather than a transport failure. `401` is deliberately absent: it is
 *  the shared reload rule, and the transport's own taxonomy must raise it. */
const TRANSCRIBE_READ_STATUSES = [402, 413, 422, 500, 502, 503] as const;

/** True for the RN file descriptor shape (`{ uri }`) rather than a `Blob`. A
 *  `Blob` answers `arrayBuffer`; the RN descriptor does not — that is the whole
 *  discrimination, and it is why this is not a `typeof` check on a class name
 *  that the two runtimes spell differently. */
function isNativeFilePart(
	audio: TranscribeUpload["audio"],
): audio is { uri: string; name: string; type: string } {
	return typeof (audio as Blob).arrayBuffer !== "function";
}

/** Builds the multipart body. The file part's FIELD NAME must be `audio` — the
 *  daemon's required field (contract §4.10), and the reason a wrong name is a
 *  `422 audio file is required` rather than a silent success. */
export function transcribeForm(upload: TranscribeUpload): FormData {
	const form = new FormData();
	if (isNativeFilePart(upload.audio)) {
		/* React Native's convention; `fetch` reads the URI and streams the file. */
		form.append("audio", upload.audio as unknown as Blob);
	} else {
		form.append("audio", upload.audio, upload.filename ?? "recording.bin");
	}
	if (upload.language !== undefined) form.append("language", upload.language);
	if (upload.prompt !== undefined) form.append("prompt", upload.prompt);
	if (upload.model !== undefined) form.append("model", upload.model);
	return form;
}

/** The `POST /api/push/register` body (ADR 0006 §3.1). `platform` and
 *  `environment` are the enums the core validates against (`push_devices`
 *  `PLATFORMS`/`ENVIRONMENTS`); `install_id` is the app's persisted UUID and is
 *  the device's identity — a re-register with the same id upserts the row. */
export interface RegisterDeviceRequest {
	platform: "ios" | "android";
	token: string;
	environment: "sandbox" | "production";
	app_version: string;
	install_id: string;
}

/**
 * What `POST /login` establishes, on both transports.
 *
 * On native and in Node the relay's own status answers this (`303` signed in,
 * `401` refused). A browser with `redirect: 'manual'` returns an opaque redirect
 * instead — `status` 0, no body — so the answer is derived from a follow-up read
 * of a gated route and `verified` says so. A caller that reports the mechanism to
 * a user (a diagnostics screen) reads `verified`; a caller that only branches on
 * `signedIn` does not have to care which transport it is on. */
export interface LoginOutcome {
	/** What the TRANSPORT reported: `303` signed in, `401` refused, `0` when it
	 *  showed no status at all (a browser's opaque redirect). It is never
	 *  synthesised — a number the relay did not send would look authoritative to
	 *  anything that logs or displays it — so read the verdict from `signedIn` and
	 *  `verified`, never from this field. */
	status: number;
	signedIn: boolean;
	/** True when the outcome came from verifying admission rather than from a
	 *  status the platform showed this client. */
	verified: boolean;
	/** The taxonomy's sentence for a refusal, when it has one — the relay's own
	 *  words, not a status number. */
	detail?: string;
}

export interface ImageBytes {
	bytes: Uint8Array;
	/** The relay's stored mime type; `null` when the response carried none. */
	mimeType: string | null;
}

/** The relay's own defaults and clamps (`daemon.py:3746-3750`, `:4254-4258`). */
export const HISTORY_LIMIT = { default: 80, min: 1, max: 200 } as const;
export const SEARCH_LIMIT = { default: 40, min: 1, max: 200 } as const;

/**
 * A page size for the wire, or `undefined` to leave the parameter off.
 *
 * **A limit the caller did not supply is OMITTED, not filled in with the
 * default.** The default is the server's (`daemon.py:3834-3838`), it applies to an
 * absent parameter, and every capture in the corpus shows a client that omits it
 * when it has none to pass (`search-empty.json` is `?q=hello`,
 * `subagent-history-unknown.json` is `/history` with no query) — while the ones
 * that do pass one show it (`history-ok.json` is `?limit=5`). Sending the default
 * ourselves would put a value on the wire that the contract says the relay owns,
 * and would make this client's request differ from the captured client's for no
 * gain. A limit that IS supplied is still clamped to the documented bounds, so a
 * caller cannot send garbage the relay would have to interpret.
 */
export function wireLimit(
	value: number | undefined,
	bounds: { default: number; min: number; max: number },
): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
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

	/** Every outstanding/recent queued ask, across conversations (design §4).
	 *  Index-backed: an ask outlives the runtime that queued it, so this answers
	 *  with no session open — which is why the asks sheet reads this route rather
	 *  than stitching per-session frames together, whose rows would be missing the
	 *  `session_id`/`cwd` a foreign ask's row needs. `signal` bounds the read: the
	 *  sheet treats a hung read as itself the failure (`READ_TIMEOUT_MS`). */
	async asks(signal?: AbortSignal): Promise<Payload<"asks">> {
		return this.http.json("asks", {
			method: "GET",
			path: "/api/asks",
			signal,
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

	/** The projects listing (`GET /api/projects`), in the relay's own board order —
	 *  the sections are the relay's `STATUS_RANK`, not a client sort.
	 *
	 *  Read-only in this build: the mutation routes (create, patch, delete, links,
	 *  milestones) exist on the relay and are deliberately not called from here.
	 *
	 *  A refusal carries the relay's own sentence (`RelayError.displayableMessage`)
	 *  — the 5xx arm of this route is `503 project_store_busy`, retryable rather
	 *  than malformed — so a screen shows that sentence instead of re-wording it. */
	async projects(signal?: AbortSignal): Promise<Payload<"projects">> {
		return this.http.json("projects", {
			method: "GET",
			path: "/api/projects",
			signal,
		});
	}

	/** One project's composed detail (`GET /api/projects/{key}`), with the linked
	 *  sessions the relay resolved for it.
	 *
	 *  `key` is the relay's own addressing rule — an exact id first, then a
	 *  case-insensitive name — so a caller may pass either and must encode it: a
	 *  name is grammar-limited but not URL-safe. An unknown key is the relay's
	 *  `404 project_not_found`, whose body sentence names up to two prefix-matched
	 *  near-misses; that sentence is what a screen shows. */
	async project(
		key: string,
		signal?: AbortSignal,
	): Promise<Payload<"projectDetail">> {
		return this.http.json("projectDetail", {
			method: "GET",
			path: `/api/projects/${encodeURIComponent(key)}`,
			signal,
		});
	}

	/** Full-text search over past conversations. `query` is echoed by the relay so
	 *  a late answer can be matched to its request. */
	async searchSessions(
		request: SearchRequest,
	): Promise<Payload<"searchSessions">> {
		return this.http.json("searchSessions", {
			method: "GET",
			path: `/api/sessions/search${query({ q: request.query, limit: wireLimit(request.limit, SEARCH_LIMIT) })}`,
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
				limit: wireLimit(page.limit, HISTORY_LIMIT),
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
					limit: wireLimit(page.limit, HISTORY_LIMIT),
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

	/**
	 * `POST /api/transcribe` — voice input (contract §4.10, design §2.3).
	 *
	 * Returns the raw status and body rather than a parsed payload: every refusal
	 * this route can produce (413/422/402/503) carries a sentence the composer must
	 * show, and `502` must be routed to the app's OWN retry sentence rather than the
	 * upstream text. The reading of those into an outcome is `stt/transcribe.ts`'s
	 * job, deliberately kept out of this transport layer.
	 *
	 * `401` is NOT in the accepted set, so the transport's own taxonomy raises it as
	 * `relay-unauthorized` (envelope `clear-all`) — the shared reload rule, applied
	 * once, by the same handler every other 401 goes through.
	 */
	async transcribe(
		upload: TranscribeUpload,
		options?: { signal?: AbortSignal },
	): Promise<TranscribeResponse> {
		const { status, text } = await this.http.raw({
			method: "POST",
			path: "/api/transcribe",
			multipart: transcribeForm(upload),
			accept: TRANSCRIBE_READ_STATUSES,
			signal: options?.signal,
		});
		return { status, text };
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

	/**
	 * Resolves a push tap's opaque conversation handle to its session id (ADR 0006
	 * §3.1/§6.7). A push carries only the handle — no raw session id — so a cold
	 * tap lands through here; a handle this machine cannot mint for a conversation
	 * it still offers is a clean `404` the caller renders as one honest sentence.
	 */
	async resolveConversation(
		handle: string,
	): Promise<Payload<"pushConversation">> {
		return this.http.json("pushConversation", {
			method: "GET",
			path: `/api/push/conversation/${encodeURIComponent(handle)}`,
		});
	}

	/**
	 * Records this device with the computer (ADR 0006 §3.1), idempotent on
	 * `install_id`. The response's `device_key` is minted once and must be stored
	 * before it is used again; refusals (a revoked or unpaired row) arrive as the
	 * relay's own typed error bodies.
	 *
	 * BUILT AND TESTED, DELIBERATELY NOT CALLED from the app yet: the cloud
	 * forward (S7) is unbuilt, so a registration today writes a row no push can
	 * use — the manager decision of 2026-10-03 records "DON'T register
	 * pre-cloud". The call site lands when S7 does; the mock relay serves the
	 * route, so the client half is exercised by the e2e suite now.
	 */
	async registerDevice(
		request: RegisterDeviceRequest,
	): Promise<Payload<"pushRegister">> {
		return this.http.json("pushRegister", {
			method: "POST",
			path: "/api/push/register",
			body: request,
		});
	}

	/** This computer's registered devices (`GET /api/push/devices`), the
	 *  Settings list. Read-only: opening Settings bumps nothing. */
	async pushDevices(): Promise<Payload<"pushDevices">> {
		return this.http.json("pushDevices", {
			method: "GET",
			path: "/api/push/devices",
		});
	}

	/** REVOKES one device (`DELETE /api/push/devices/{device_id}`, ADR §4 rule 1,
	 *  local-operator `push_devices.revoke`). A tombstone, not a row removal, and
	 *  idempotent in both directions: an id the registry does not hold still
	 *  answers `{"ok": true}` — the app retries this on sign-out and a retry must
	 *  not read as a failure. */
	async revokePushDevice(
		deviceId: string,
	): Promise<Payload<"pushDeviceDelete">> {
		return this.http.json("pushDeviceDelete", {
			method: "DELETE",
			path: `/api/push/devices/${encodeURIComponent(deviceId)}`,
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
	async loginPage(): Promise<{
		/** The transport's own report; `0` when it hid the redirect. Never synthesised. */
		status: number;
		isForm: boolean;
		/** Whether this client is already signed in. On a browser the `303` is
		 *  hidden, so it comes from the same verification read `login()` uses. */
		signedIn: boolean;
	}> {
		const { status, text, redirectHidden } = await this.http.raw({
			method: "GET",
			path: "/login",
			/* `303` means already signed in, which is a state this probe reports rather
			 * than an error. `401` cannot happen here (the page is public) but is
			 * tolerated so a proxy's refusal still reaches the caller as a status. */
			accept: [303, 401],
		});
		if (redirectHidden) {
			/* The browser hid the `303 → /`. This probe's whole job is to report that
			 * state, so it is verified rather than assumed. */
			const admission = await this.admission();
			return { status: 0, isForm: false, signedIn: admission.admitted };
		}
		return {
			status,
			isForm: status === 200 && text.includes("<form"),
			signedIn: status === 303,
		};
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
	 *
	 * On a browser this route's status is unreadable: `redirect: 'manual'` there
	 * returns an opaque redirect, so a successful sign-in would otherwise be reported
	 * as a failure with an empty message (measured in Chrome; Node, native and the
	 * smoke script all see the real `303`, which is why no Node-side test caught it).
	 * `admission()` is how the outcome is established instead.
	 */
	async login(password: string): Promise<LoginOutcome> {
		const { status, redirectHidden } = await this.http.raw({
			method: "POST",
			path: "/login",
			form: { password },
			/* The two statuses this route's login has: 303 success, 401 refusal. Both
			 * are outcomes to read, not exceptions to throw. */
			accept: [303, 401],
		});
		if (!redirectHidden) {
			/* 303 is success. 200 would mean the daemon answered the form again (it
			 * renders the page with an inline error on a wrong password, as a 401), so
			 * anything other than 303 is not a signed-in session. */
			return { status, signedIn: status === 303, verified: false };
		}
		/* A browser hid the redirect. The route has exactly two answers — `303 → /`
		 * and `401` with the form — so a redirect that happened is the success SHAPE,
		 * but "a redirect happened" is not proof the cookie was accepted, and this is
		 * the one route where that difference decides whether the user is let in or
		 * told their password is wrong. Verify, then report. */
		const admission = await this.admission();
		if (admission.admitted) {
			/* `status: 0` is the transport's own report, left as it arrived: the
			 * verdict is `signedIn` + `verified`, which is what a caller acts on. */
			return { status: 0, signedIn: true, verified: true };
		}
		/* The refusal's sentence comes from the taxonomy's ONE copy accessor, which is the
		 * place a status becomes copy — and the only one that refuses a runtime
		 * diagnostic, an empty body and markup. */
		const detail = admission.refusal?.displayableMessage;
		return {
			status: 0,
			signedIn: false,
			verified: true,
			...(detail ? { detail } : {}),
		};
	}

	/**
	 * Asks a route only an admitted session can answer whether this client is
	 * admitted, for the one case the transport will not say: a browser with
	 * `redirect: 'manual'` returns an opaque redirect instead of a status, so "did
	 * that password work?" has to be asked again in a way the platform cannot hide.
	 *
	 * `GET /api/models` is that route, and it is chosen for what it costs: the
	 * relay gates it like every other `/api` route, and it answers `{"models":[...]}`
	 * — 13 bytes against the sessions list's 902 on an isolated 0.64.9 daemon
	 * (measured, both `401` without the cookie). Admission is a yes/no question
	 * asked on a control plane the relay rate-limits per IP, so the cheapest gated
	 * route is the right one.
	 *
	 * A failure to ASK — offline, a `503`, a body the schema rejects — is
	 * deliberately not a refusal: telling a user their password was wrong when the
	 * network was down is a worse lie than the status-0 reading this replaces, so it
	 * propagates.
	 */
	private async admission(): Promise<{
		admitted: boolean;
		refusal?: RelayError;
	}> {
		try {
			await this.http.json("models", {
				method: "GET",
				path: "/api/models",
			});
			return { admitted: true };
		} catch (cause) {
			const error = isRelayError(cause) ? cause : undefined;
			if (
				error &&
				(error.kind === "relay-unauthorized" ||
					error.kind === "radiant-login-required")
			) {
				return { admitted: false, refusal: error };
			}
			throw cause;
		}
	}

	/** `GET /logout`: clears the relay's cookie. Not auth-gated, and it does not
	 *  check CSRF — a client calling it must expect to be signed out. The local
	 *  private state is this app's own job to clear; native has no
	 *  `Clear-Site-Data`. */
	async logout(): Promise<{
		/** The transport's own report; `0` when it showed none. Never synthesised. */
		status: number;
		signedOut: boolean;
		verified: boolean;
	}> {
		const { status, redirectHidden } = await this.http.raw({
			method: "GET",
			path: "/logout",
			accept: [303, 401],
		});
		if (!redirectHidden) {
			return { status, signedOut: status === 303, verified: false };
		}
		/* The same blind spot as `login`, inverted: verify that the session is GONE.
		 * A read that still succeeds means the sign-out did not take. The caller's own
		 * clearing happens either way (`signOutOfCustomRoute`), but it must not also
		 * claim a success the relay never confirmed — and a caller that reports to the
		 * user needs to know which happened, which is what `signedOut` is for. */
		const admission = await this.admission();
		return {
			status: 0,
			signedOut: !admission.admitted,
			verified: true,
		};
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
			/* The stream's body is the gateway's lease, so the HTTP layer's deadline bounds
			 * only the RESPONSE here — `http.ts` clears it when the headers arrive and the
			 * watchdog is what then detects a dead socket (`sse.ts`). It is not disabled
			 * outright: a connector that never answers at all has to fail rather than leave
			 * the connect phase pending for ever, and the watchdog cannot see that phase. */
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
