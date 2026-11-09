/**
 * The Team Bridge hub client: every `/v1/messaging/*` read and write the phone
 * makes, and nothing else.
 *
 * WHY THE PHONE TALKS TO THE HUB DIRECTLY. Messaging lives on the Radient hub
 * (agent-server), not on the operator's machine. The phone already holds a
 * Radient OAuth access token (`src/connection/radient-oauth.ts`, client `lop`),
 * which is exactly the credential the desktop's `team_bridge/client.py`
 * presents, and the hub's JWT middleware accepts it unchanged. Going straight
 * to `api.radienthq.com` means Team Bridge works with the laptop CLOSED. The
 * relay is never involved, and nothing here needs a computer to be picked.
 *
 * Three rules, all the hub's own:
 *
 * - **Every response is parsed.** `{msg, result}` on success, and the result
 *   through the schema in `./contract`. A malformed answer is a `HubError`
 *   with `kind: "malformed"`, never a half-typed object.
 * - **Every refusal is classified once** (`HubError.kind`). The status ladder,
 *   the list, the thread and the composer each render a cause rather than a
 *   generic failure, and none of them parses an error body itself.
 * - **The token is fetched per request and never logged.** `accessToken` is
 *   the connection layer's, refreshed there. On a 401 this client asks for ONE
 *   refresh and retries once. A second 401 is `sign_in`, which is a state the
 *   reader acts on, not a loop.
 *
 * No message body, token or account id is ever written to a log from here.
 */

import { RADIENT_API_BASE } from "@/connection/discovery";
import { t } from "@/i18n/runtime";
import { resolveFetch } from "@/relay/platform-fetch";
import {
	type AccountUnread,
	accountUnreadSchema,
	type Conversation,
	type ConversationList,
	conversationListSchema,
	conversationSchema,
	type Directory,
	directorySchema,
	ENDPOINT_AVATAR_PATH,
	hubEnvelopeSchema,
	hubErrorSchema,
	type MemberInput,
	type Message,
	type MessagePage,
	messagePageSchema,
	messageSchema,
	type Notify,
	type PushDevice,
	pushDeviceSchema,
	type ReadState,
	readStateSchema,
	type Settings,
	type Status,
	settingsSchema,
	statusSchema,
	type UploadedAttachment,
	uploadedAttachmentSchema,
} from "@/team-bridge/contract";

const TRAILING_SLASHES = /\/+$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** PNG or JPEG by content, never by the served header alone. */
function sniffImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
	const starts = (magic: number[]) =>
		bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
	if (starts(PNG_MAGIC)) return "image/png";
	if (starts(JPEG_MAGIC)) return "image/jpeg";
	return null;
}
const DELTA_SECONDS = /^\d+$/;

/**
 * What went wrong, in the vocabulary the screens render.
 *
 * - `sign_in`: no token, or the hub refused it twice (401). Only a Radient
 *   sign-in fixes it.
 * - `plan`: 403 `bridge_not_available`. The organization's plan does not include
 *   Team Bridge (or the caller is not eligible there).
 * - `refused`: any other 403 (`not_a_member`, `bridge_disabled`, …).
 * - `not_found`: 404. A conversation that is gone, or one this caller may not
 *   see. The hub answers both the same way on purpose.
 * - `unavailable`: 503 `messaging_unavailable`. The service is dark, killed, or a
 *   store read failed. The hub does not say which, by design.
 * - `invalid`: 400/422. This client sent something the hub refused. `field` and
 *   `rule` name it when the hub said so.
 * - `rate_limited`: 429, with the server's `Retry-After` when sent.
 * - `conflict`: 409 (`client_ref_conflict`, `conversation_archived`, …).
 * - `unreachable`: no answer at all.
 * - `malformed`: an answer this build cannot read.
 * - `server`: any other status.
 */
export type HubErrorKind =
	| "sign_in"
	| "plan"
	| "refused"
	| "not_found"
	| "unavailable"
	| "invalid"
	| "rate_limited"
	| "conflict"
	| "unreachable"
	| "malformed"
	| "server";

export class HubError extends Error {
	override readonly name = "HubError";
	readonly kind: HubErrorKind;
	readonly status: number | null;
	readonly code: string | null;
	readonly field: string | null;
	readonly rule: string | null;
	readonly retryAfterMs: number | null;
	constructor(input: {
		kind: HubErrorKind;
		message: string;
		status?: number | null;
		code?: string | null;
		field?: string | null;
		rule?: string | null;
		retryAfterMs?: number | null;
	}) {
		super(input.message);
		this.kind = input.kind;
		this.status = input.status ?? null;
		this.code = input.code ?? null;
		this.field = input.field ?? null;
		this.rule = input.rule ?? null;
		this.retryAfterMs = input.retryAfterMs ?? null;
	}
}

export const isHubError = (value: unknown): value is HubError =>
	value instanceof HubError;

/** Classify a non-2xx answer from its status and the hub's stable `code`. */
export function hubErrorKind(
	status: number,
	code: string | null,
): HubErrorKind {
	if (status === 401) return "sign_in";
	if (status === 403 && code === "bridge_not_available") return "plan";
	if (status === 403) return "refused";
	if (status === 404) return "not_found";
	if (status === 409) return "conflict";
	// 415 joins 413/422: the attachment upload's "not PNG/JPEG" refusal is this
	// client having sent something the hub will not take, not a server fault.
	if (status === 400 || status === 413 || status === 415 || status === 422)
		return "invalid";
	if (status === 429) return "rate_limited";
	if (status === 503 || code === "messaging_unavailable") return "unavailable";
	return "server";
}

function retryAfterMs(response: Response): number | null {
	const raw = response.headers.get("retry-after")?.trim();
	if (!raw) return null;
	if (DELTA_SECONDS.test(raw)) return Number(raw) * 1000;
	const at = Date.parse(raw);
	return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export interface HubClientDeps {
	/**
	 * A current Radient access token, or `null` when signed out. `force: true`
	 * asks the connection layer to refresh even if its clock says the token is
	 * still good. That is the one retry after a 401, because a token can be
	 * revoked or rotated server-side before it expires locally.
	 */
	accessToken: (options?: { force?: boolean }) => Promise<string | null>;
	fetchImpl?: typeof globalThis.fetch;
	baseUrl?: string;
	/** Per-request ceiling. A hung read is itself a failure the screen shows. */
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/*
 * Image bytes in either direction. A bounded upload is up to 1 MiB: at 15 s
 * that needs ~560 kbit/s sustained upstream, which weak cellular does not
 * give, and every timed-out retry restarts from zero. 60 s keeps a bad link
 * workable while still ending a hung transfer.
 */
const BYTES_TIMEOUT_MS = 60_000;
/** Hub image contract: other clients may upload images up to 5 MiB even though
 * this phone emits at most 1 MiB. Bound reads to the protocol, not our upload size. */
export const ATTACHMENT_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024;

/*
 * The largest profile photo body this client will read. The hub stores at most
 * a 1 MiB upload and serves re-encoded 64/256 px variants of a few KB to a few
 * tens of KB (agent-server `docs/ACCOUNT-PROFILE.md` §2), so 1 MiB is already
 * generous; anything larger is not an avatar this hub produced and is refused
 * as `malformed` (a permanent failure for that hash) rather than decoded.
 */
export const AVATAR_MAX_BYTES = 1024 * 1024;

type Query = Record<string, string | number | undefined>;

function queryString(query: Query | undefined): string {
	if (!query) return "";
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === "") continue;
		params.set(key, String(value));
	}
	const text = params.toString();
	return text ? `?${text}` : "";
}

/** Read the hub's error body, tolerating a non-JSON one. */
async function errorFrom(response: Response): Promise<HubError> {
	let code: string | null = null;
	// Resolve at refusal time: a client can survive a language change, and a
	// non-JSON proxy response must not fall back to un-keyed English prose.
	let message = t("mobile.team_bridge.error.http_status", {
		status: response.status,
	});
	let field: string | null = null;
	let rule: string | null = null;
	try {
		const parsed = hubErrorSchema.safeParse(await response.json());
		if (parsed.success) {
			code = parsed.data.code ?? null;
			if (parsed.data.error) message = parsed.data.error;
			const details = parsed.data.details;
			if (details) {
				field = typeof details.field === "string" ? details.field : null;
				rule = typeof details.rule === "string" ? details.rule : null;
			}
		}
	} catch {
		/* A non-JSON refusal (an edge page, an empty body) keeps the HTTP sentence. */
	}
	return new HubError({
		kind: hubErrorKind(response.status, code),
		message,
		status: response.status,
		code,
		field,
		rule,
		retryAfterMs: retryAfterMs(response),
	});
}

export interface CreateConversationInput {
	tenantId: string;
	kind: "dm" | "group" | "channel";
	name?: string;
	visibility?: "private" | "tenant";
	agentCapable?: boolean;
	members: MemberInput[];
}

export interface RegisterDeviceInput {
	installId: string;
	/** Persisted per-install incarnation, shared with DELETE to fence late PUTs. */
	generation: number;
	platform: "ios" | "android";
	token: string;
	/** iOS only: which APNs gateway the token belongs to. */
	environment?: "production" | "sandbox";
	appVersion?: string;
}

/**
 * Build the client. Pure over its dependencies, so the whole protocol, including
 * the 401 retry and every refusal class, is a Node unit test's subject.
 */
export function createHubClient(deps: HubClientDeps) {
	const base = (deps.baseUrl ?? RADIENT_API_BASE).replace(TRAILING_SLASHES, "");
	const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	async function once(
		method: string,
		path: string,
		token: string,
		query?: Query,
		body?: unknown,
		signal?: AbortSignal,
		/*
		 * Both attachment raw uploads and profile reads use this one bearer,
		 * timeout/abort and refresh-once path. Only profile reads override the
		 * messaging root; adding raw bytes must not bypass its retirement fence.
		 */
		raw?: { bytes?: Uint8Array; accept?: string; root?: string; photo?: true },
		limitMs: number = timeoutMs,
	): Promise<Response> {
		const fetchImpl = resolveFetch(deps.fetchImpl);
		/*
		 * A plain controller, not `AbortSignal.timeout`/`AbortSignal.any`: Hermes
		 * does not promise either (the asks sheet guards for the same gap), and a
		 * missing static would throw before the request is even made.
		 */
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, limitMs);
		const forward = () => controller.abort();
		if (signal?.aborted) controller.abort();
		else signal?.addEventListener("abort", forward, { once: true });
		try {
			return await fetchImpl(
				`${base}${raw?.root ?? "/v1/messaging"}${path}${queryString(query)}`,
				{
					method,
					headers: {
						accept: raw?.accept ?? "application/json",
						authorization: `Bearer ${token}`,
						...(raw && "bytes" in raw
							? /* The hub sniffs the bytes and ignores this header. */
								{ "content-type": "application/octet-stream" }
							: body === undefined
								? {}
								: { "content-type": "application/json" }),
					},
					...(raw && "bytes" in raw
						? { body: raw.bytes as unknown as BodyInit }
						: body === undefined
							? {}
							: { body: JSON.stringify(body) }),
					/* The hub is not a tunnel and owns no cookie the phone should send. */
					credentials: "omit",
					signal: controller.signal,
				},
			);
		} catch (error) {
			/* The CALLER's abort (a screen that unmounted) propagates as itself so
			 * the caller can ignore it; a timeout or a dead network is a state. */
			if (signal?.aborted && !timedOut) throw error;
			throw new HubError({
				kind: "unreachable",
				message: timedOut
					? "Radient took too long to answer. Try again."
					: "Radient could not be reached. Check this device's connection.",
			});
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", forward);
		}
	}

	// Cancellation is cleanup, not permission to consume a refusal body. Some
	// native fetches expose no cancellable stream; keep the classified refusal
	// and never call json()/arrayBuffer() there regardless of this capability.
	function cancelPhotoBody(response?: Response): void {
		const body = response?.body;
		if (typeof body?.cancel === "function")
			void body.cancel().catch(() => undefined);
	}

	type RequestOptions = {
		query?: Query;
		body?: unknown;
		signal?: AbortSignal;
		raw?: { bytes?: Uint8Array; accept?: string; root?: string; photo?: true };
		timeoutMs?: number;
	};

	/** Token, one request, one forced refresh on 401, and the refusal class. */
	async function authorized(
		method: "GET" | "POST" | "PUT" | "DELETE",
		path: string,
		options: RequestOptions,
	): Promise<Response> {
		const access = async (force = false) => {
			try {
				return await deps.accessToken(force ? { force: true } : undefined);
			} catch {
				// A refresh transport failure is NOT evidence the person signed out.
				// Keep the grant in its owner's store and present a retryable failure.
				throw new HubError({
					kind: "unreachable",
					message: "Radient could not refresh your session. Try again.",
				});
			}
		};
		// Photo authorization is part of its single deadline. Token work may not
		// support cancellation, so also guard AFTER it resolves: a retired read
		// must not issue a late GET or forced-refresh retry.
		const assertPhotoActive = (response?: Response) => {
			if (!options.raw?.photo || !options.signal?.aborted) return;
			cancelPhotoBody(response);
			throw options.signal.reason ?? photoDownloadError(null);
		};
		assertPhotoActive();
		let token = await access();
		assertPhotoActive();
		if (!token) {
			throw new HubError({
				kind: "sign_in",
				message: "Sign in to Radient to use Team Bridge.",
			});
		}
		let response = await once(
			method,
			path,
			token,
			options.query,
			options.body,
			options.signal,
			options.raw,
			options.timeoutMs,
		);
		assertPhotoActive(response);
		if (response.status === 401) {
			// Photo refusals carry no image identity. Never parse/cache the first
			// 401 body while acquiring the one permitted refresh.
			if (options.raw?.photo) cancelPhotoBody(response);
			/* One forced refresh, one retry. A token revoked server-side before its
			 * local expiry is the case this exists for. */
			token = await access(true);
			assertPhotoActive();
			if (!token) {
				throw new HubError({
					kind: "sign_in",
					message: "Your Radient session expired. Sign in again.",
					status: 401,
				});
			}
			response = await once(
				method,
				path,
				token,
				options.query,
				options.body,
				options.signal,
				options.raw,
				options.timeoutMs,
			);
		}
		assertPhotoActive(response);
		if (!response.ok) {
			if (options.raw?.photo) {
				// No JSON/error-page reads on the closed photo path: otherwise an
				// endless or oversized refusal bypasses the successful-image cap.
				// Status and Retry-After suffice for photo retry policy; eligibility
				// still uses the normal JSON status endpoint and its coded errors.
				cancelPhotoBody(response);
				throw new HubError({
					kind: hubErrorKind(response.status, null),
					message: photoDownloadError(response.status).message,
					status: response.status,
					retryAfterMs: retryAfterMs(response),
				});
			}
			throw await errorFrom(response);
		}
		return response;
	}

	async function request<T>(
		method: "GET" | "POST" | "PUT" | "DELETE",
		path: string,
		parse: ((value: unknown) => T) | null,
		options: RequestOptions = {},
	): Promise<T> {
		const response = await authorized(method, path, options);
		if (parse === null) return undefined as T;
		let raw: unknown;
		try {
			raw = await response.json();
		} catch {
			throw new HubError({
				kind: "malformed",
				message: "Radient returned a response this app could not read.",
				status: response.status,
			});
		}
		const envelope = hubEnvelopeSchema.safeParse(raw);
		if (!envelope.success) {
			throw new HubError({
				kind: "malformed",
				message: "Radient returned a response this app could not read.",
				status: response.status,
			});
		}
		try {
			return parse(envelope.data.result);
		} catch {
			throw new HubError({
				kind: "malformed",
				message: "Radient returned a response this app could not read.",
				status: response.status,
			});
		}
	}

	// A closed account/endpoint target, never a directory-supplied URL. Sharing
	// this reader keeps auth refresh, stream cap, MIME sniffing and the complete
	// headers+body deadline identical for both routes (including the documented
	// non-streaming native limitation). The endpoint wrapper validates identity
	// before even obtaining a bearer.
	const photoDownloadError = (status: number | null, timedOut = false) =>
		new HubError({
			kind: "unreachable",
			message: timedOut
				? "The profile photo took too long to download."
				: "The profile photo could not be downloaded.",
			status,
		});
	const unreadableAvatar = (status: number | null) =>
		new HubError({
			kind: "malformed",
			message: "Radient returned a profile photo this app could not read.",
			status,
		});
	async function readAvatarBytes(
		target: { kind: "account" | "endpoint"; id: string },
		hash: string,
		size: 64 | 256,
		signal?: AbortSignal,
	): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }> {
		return readImageBytes(
			{
				path:
					target.kind === "account"
						? `/accounts/${encodeURIComponent(target.id)}/avatar`
						: `/endpoints/${encodeURIComponent(target.id)}/avatar`,
				root: target.kind === "account" ? "/v1" : "/v1/messaging",
				query: { v: hash, size },
				maxBytes: AVATAR_MAX_BYTES,
				limitMs: timeoutMs,
			},
			signal,
		);
	}

	/** One closed authenticated byte path for avatars and message images. Adding
	 * attachments must not regress main's cap, full-body deadline or account
	 * retirement fence. The native non-streaming limitation below applies to
	 * both: this bounds retained bytes, not the platform's underlying allocation. */
	async function readImageBytes(
		target: {
			path: string;
			root: string;
			query: Query;
			maxBytes: number;
			limitMs: number;
			requireDeclaredMime?: boolean;
		},
		signal?: AbortSignal,
	): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }> {
		/*
		 * ONE deadline over the headers AND the body. `once()` disarms its
		 * timer when the headers arrive, which is right for a small JSON
		 * body but would let a body that stalls mid-stream hold the photo's
		 * cache slot forever. The caller's own abort is forwarded in.
		 *
		 * WHAT IS ACTUALLY CANCELLED, by runtime (review round 2, R2-3):
		 * - Where `response.body` is a stream (browsers, the web target, Node
		 *   tests), it is read chunk by chunk with a running byte count, and
		 *   the reader is cancelled the moment the count passes
		 *   `AVATAR_MAX_BYTES` or the deadline fires. Nothing past the cap is
		 *   buffered, and a stalled body stops being read.
		 * - React Native's XHR-backed `fetch` exposes no body stream. There,
		 *   `Content-Length` is the only early refusal, `arrayBuffer()` is
		 *   checked after the read, and the deadline settles THIS call (the
		 *   slot is freed) but cannot stop the platform finishing a download
		 *   it already started. The hub's variants are a few KB, so that
		 *   residual is a bound on waste, not on memory held by this app.
		 */
		const deadline = new AbortController();
		let timedOut = false;
		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
		const timer = setTimeout(() => {
			timedOut = true;
			deadline.abort();
			void reader?.cancel().catch(() => undefined);
		}, target.limitMs);
		const forward = () => {
			deadline.abort();
			void reader?.cancel().catch(() => undefined);
		};
		if (signal?.aborted) deadline.abort();
		else signal?.addEventListener("abort", forward, { once: true });
		const unreachable = (status: number | null) =>
			photoDownloadError(status, timedOut);
		const tooLarge = (status: number) =>
			new HubError({
				kind: "malformed",
				message: "Radient returned a profile photo larger than this app reads.",
				status,
			});
		/* Settles when the deadline fires, for the reads below that the abort
		 * alone may not reject on every runtime. */
		const aborted = new Promise<never>((_, reject) => {
			const fire = () => reject(unreachable(null));
			if (deadline.signal.aborted) fire();
			else deadline.signal.addEventListener("abort", fire, { once: true });
		});
		aborted.catch(() => undefined);
		let bytes: Uint8Array;
		let status: number;
		let servedMime: string | undefined;
		try {
			const response = await Promise.race([
				authorized("GET", target.path, {
					query: target.query,
					raw: {
						root: target.root,
						accept: "image/png, image/jpeg",
						photo: true,
					},
					signal: deadline.signal,
					timeoutMs: target.limitMs,
				}),
				aborted,
			]);
			status = response.status;
			servedMime = response.headers
				.get("content-type")
				?.split(";")[0]
				?.trim()
				.toLowerCase();
			const declared = Number(response.headers.get("content-length"));
			if (Number.isFinite(declared) && declared > target.maxBytes) {
				cancelPhotoBody(response);
				throw tooLarge(status);
			}
			if (response.body && typeof response.body.getReader === "function") {
				reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let total = 0;
				for (;;) {
					const next = await Promise.race([reader.read(), aborted]);
					if (next.done) break;
					total += next.value.byteLength;
					if (total > target.maxBytes) {
						void reader.cancel().catch(() => undefined);
						throw tooLarge(status);
					}
					chunks.push(next.value);
				}
				bytes = new Uint8Array(total);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
			} else {
				const body = await Promise.race([response.arrayBuffer(), aborted]);
				if (body.byteLength > target.maxBytes) throw tooLarge(status);
				bytes = new Uint8Array(body);
			}
			// Reader cancellation may resolve a pending read as EOF before the
			// abort promise wins its race. Retired content must not escape as a
			// successfully truncated image just because its prefix sniffs as PNG.
			if (deadline.signal.aborted)
				throw deadline.signal.reason ?? unreachable(status);
		} catch (error) {
			/* The caller's own abort propagates as itself (an unmounted view).
			 * The deadline turns a hung read into a retryable state; a refusal
			 * the hub classified keeps its class. */
			if (signal?.aborted && !timedOut) throw error;
			if (timedOut) throw unreachable(null);
			if (isHubError(error)) throw error;
			throw unreachable(null);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", forward);
		}
		const mime = sniffImageMime(bytes);
		if (!mime || (target.requireDeclaredMime && servedMime !== mime)) {
			throw unreadableAvatar(status);
		}
		return { mime, bytes };
	}

	return {
		/** `GET /status`: the eligibility ladder's one input. */
		status(signal?: AbortSignal): Promise<Status> {
			return request("GET", "/status", (v) => statusSchema.parse(v), {
				signal,
			});
		},

		/** `GET /settings`: the caller's endpoint and consent provenance in one organization. */
		settings(tenantId: string, signal?: AbortSignal): Promise<Settings> {
			return request("GET", "/settings", (v) => settingsSchema.parse(v), {
				query: { tenant_id: tenantId },
				signal,
			});
		},

		/**
		 * Opt out (`PUT /settings {state: "disabled", tenant_id}`), sent ALONE.
		 * Pausing and opting out are the hub's always-allowed changes, but only when
		 * the body carries no rename or other field (an ineligible organization
		 * refuses a combined request). The only caller is the default-on notice's
		 * "Turn off"; Enable is deliberately not expressible here, because turning on
		 * needs a consent echo and enrolment belongs to the desktop runtime. The call
		 * goes out with the signed-in person's own Radient bearer, like every read.
		 */
		turnOff(tenantId: string): Promise<void> {
			// A 2xx confirms the mutation even if its optional response body is unreadable.
			// Claiming failure after the hub applied it would misrepresent the setting.
			return request("PUT", "/settings", null, {
				body: { state: "disabled", tenant_id: tenantId },
			});
		},

		/** One organization's conversations, newest activity first (the hub's order). */
		listConversations(
			tenantId: string,
			options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
		): Promise<ConversationList> {
			return request(
				"GET",
				"/conversations",
				(v) => conversationListSchema.parse(v),
				{
					query: {
						tenant_id: tenantId,
						cursor: options.cursor,
						limit: options.limit,
					},
					signal: options.signal,
				},
			);
		},

		getConversation(
			tenantId: string,
			conversationId: string,
			signal?: AbortSignal,
		): Promise<Conversation> {
			return request(
				"GET",
				`/conversations/${encodeURIComponent(conversationId)}`,
				(v) => conversationSchema.parse(v),
				{ query: { tenant_id: tenantId }, signal },
			);
		},

		/** Join a discoverable channel before requesting its private history. */
		joinConversation(
			tenantId: string,
			conversationId: string,
		): Promise<Conversation> {
			return request(
				"POST",
				`/conversations/${encodeURIComponent(conversationId)}/join`,
				(v) => conversationSchema.parse(v),
				{ body: { tenant_id: tenantId } },
			);
		},

		/**
		 * Create a conversation. A DM is created on FIRST SEND, never on open (the
		 * desktop's rule): the hub's DM create is idempotent on its two members, so
		 * a retried first send cannot mint a second DM.
		 */
		createConversation(input: CreateConversationInput): Promise<Conversation> {
			return request(
				"POST",
				"/conversations",
				(v) => conversationSchema.parse(v),
				{
					body: {
						tenant_id: input.tenantId,
						kind: input.kind,
						...(input.name ? { name: input.name } : {}),
						...(input.visibility ? { visibility: input.visibility } : {}),
						...(input.agentCapable === undefined
							? {}
							: { agent_capable: input.agentCapable }),
						members: input.members,
					},
				},
			);
		},

		/** One newest-first page. `beforeSeq` is exclusive, so paging never repeats a row. */
		listMessages(
			tenantId: string,
			conversationId: string,
			options: {
				beforeSeq?: number;
				limit?: number;
				signal?: AbortSignal;
			} = {},
		): Promise<MessagePage> {
			return request(
				"GET",
				`/conversations/${encodeURIComponent(conversationId)}/messages`,
				(v) => messagePageSchema.parse(v),
				{
					query: {
						tenant_id: tenantId,
						before_seq: options.beforeSeq,
						limit: options.limit,
					},
					signal: options.signal,
				},
			);
		},

		/**
		 * Send as the signed-in human. `clientRef` is REQUIRED and is the
		 * idempotency key: the same ref with the same body returns the original
		 * message, so a retry after a dropped response never posts twice.
		 */
		send(
			tenantId: string,
			conversationId: string,
			input: { clientRef: string; body: string; attachmentIds?: string[] },
		): Promise<Message> {
			return request(
				"POST",
				`/conversations/${encodeURIComponent(conversationId)}/messages`,
				(v) => messageSchema.parse(v),
				{
					body: {
						tenant_id: tenantId,
						client_ref: input.clientRef,
						body: input.body,
						/*
						 * Sent ONLY when non-empty: an older hub decodes this DTO with
						 * `DisallowUnknownFields`, so a text-only send must stay
						 * byte-identical to before this field existed.
						 */
						...(input.attachmentIds?.length
							? { attachment_ids: input.attachmentIds }
							: {}),
					},
				},
			);
		},

		/**
		 * Stage one image (`POST /conversations/:cid/attachments`). The body is
		 * the already-bounded PNG/JPEG bytes, raw: no multipart, no filename (the
		 * hub never stores one). Staging is idempotent on the hub by content, so
		 * a retry after a dropped response returns the same id.
		 */
		uploadAttachment(
			tenantId: string,
			conversationId: string,
			bytes: Uint8Array,
			signal?: AbortSignal,
		): Promise<UploadedAttachment> {
			return request(
				"POST",
				`/conversations/${encodeURIComponent(conversationId)}/attachments`,
				(v) => uploadedAttachmentSchema.parse(v),
				{
					query: { tenant_id: tenantId },
					raw: { bytes },
					signal,
					timeoutMs: BYTES_TIMEOUT_MS,
				},
			);
		},

		/** Drop a staged image the reader removed. Idempotent: gone is success. */
		async deleteAttachment(
			tenantId: string,
			conversationId: string,
			attachmentId: string,
		): Promise<void> {
			try {
				await request(
					"DELETE",
					`/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`,
					null,
					{ query: { tenant_id: tenantId } },
				);
			} catch (error) {
				if (isHubError(error) && error.kind === "not_found") return;
				throw error;
			}
		},

		/**
		 * One bound image's bytes, read as the signed-in member with the bearer.
		 * There is no URL to hand to an image view: the route needs the token, so
		 * the caller turns these bytes into an in-memory `data:` URI.
		 *
		 * FAIL CLOSED on content: the bytes must sniff as PNG or JPEG AND match
		 * the served `Content-Type`. Anything else (an edge's HTML error page, a
		 * type this build does not render) is `malformed`, never displayed.
		 */
		async attachmentBytes(
			tenantId: string,
			conversationId: string,
			messageId: string,
			attachmentId: string,
			signal?: AbortSignal,
		): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }> {
			return readImageBytes(
				{
					path: `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
					root: "/v1/messaging",
					query: { tenant_id: tenantId },
					maxBytes: ATTACHMENT_DOWNLOAD_MAX_BYTES,
					limitMs: deps.timeoutMs ?? BYTES_TIMEOUT_MS,
					requireDeclaredMime: true,
				},
				signal,
			);
		},

		/** Advance the read cursor (`$max` server-side, so a stale value never moves it back). */
		markRead(
			tenantId: string,
			conversationId: string,
			input: { seq?: number; notify?: Notify },
		): Promise<ReadState> {
			return request(
				"POST",
				`/conversations/${encodeURIComponent(conversationId)}/read`,
				(v) => readStateSchema.parse(v),
				{
					body: {
						tenant_id: tenantId,
						...(input.seq === undefined ? {} : { seq: input.seq }),
						...(input.notify === undefined ? {} : { notify: input.notify }),
					},
				},
			);
		},

		/** The account-wide unread aggregate (one authorized read, never a client sum). */
		accountUnread(signal?: AbortSignal): Promise<AccountUnread> {
			return request("GET", "/unread", (v) => accountUnreadSchema.parse(v), {
				query: { scope: "account" },
				signal,
			});
		},

		/**
		 * One person's profile photo bytes (`GET /v1/accounts/{id}/avatar`,
		 * agent-server `docs/ACCOUNT-PROFILE.md` §7), read with the same bearer as
		 * every messaging call. The route answers 404 for "no photo" and for "not
		 * yours to read" alike; both surface as `not_found`.
		 *
		 * The path is REBUILT from the parsed account id and hash rather than
		 * taken from the directory's `avatar_url` verbatim, so a row can never
		 * steer this request anywhere but the avatar route. `v` pins the content:
		 * a new photo is a new hash and so a new cache key.
		 *
		 * FAIL CLOSED on content: the server re-encodes to PNG or JPEG, so bytes
		 * that sniff as anything else (an edge's HTML error page) are `malformed`
		 * and never handed to an image view.
		 */
		avatarBytes(
			accountId: string,
			hash: string,
			size: 64 | 256,
			signal?: AbortSignal,
		): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }> {
			return readAvatarBytes(
				{ kind: "account", id: accountId },
				hash,
				size,
				signal,
			);
		},

		/** Endpoint-owned picture, fixed to the hub; no owner-image fallback. */
		async endpointAvatarBytes(
			endpointId: string,
			hash: string,
			size: 64 | 256,
			signal?: AbortSignal,
		): Promise<{ mime: "image/png" | "image/jpeg"; bytes: Uint8Array }> {
			const canonical = `/v1/messaging/endpoints/${endpointId}/avatar?v=${hash}`;
			if (
				!ENDPOINT_AVATAR_PATH.test(canonical) ||
				(size !== 64 && size !== 256)
			)
				throw unreadableAvatar(null);
			return readAvatarBytes(
				{ kind: "endpoint", id: endpointId },
				hash,
				size,
				signal,
			);
		},

		/** One organization's people. The tenant is REQUIRED: there is no implicit org. */
		directory(tenantId: string, signal?: AbortSignal): Promise<Directory> {
			return request("GET", "/directory", (v) => directorySchema.parse(v), {
				query: { tenant_id: tenantId },
				signal,
			});
		},

		/**
		 * Register this phone for Team Bridge pushes (`PUT /push/devices`). Keyed
		 * on the install id, so a rotated APNs/FCM token REPLACES the row.
		 */
		registerDevice(input: RegisterDeviceInput): Promise<PushDevice> {
			return request("PUT", "/push/devices", (v) => pushDeviceSchema.parse(v), {
				body: {
					install_id: input.installId,
					generation: input.generation,
					platform: input.platform,
					token: input.token,
					...(input.environment ? { environment: input.environment } : {}),
					...(input.appVersion ? { app_version: input.appVersion } : {}),
				},
			});
		},

		/** Sign-out deregistration. Idempotent: a device already gone is a success. */
		async unregisterDevice(
			installId: string,
			generation: number,
		): Promise<void> {
			try {
				await request(
					"DELETE",
					`/push/devices/${encodeURIComponent(installId)}`,
					null,
					{ query: { generation } },
				);
			} catch (error) {
				if (isHubError(error) && error.kind === "not_found") return;
				throw error;
			}
		},
	};
}

export type HubClient = ReturnType<typeof createHubClient>;
