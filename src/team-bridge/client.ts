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
	type Status,
	statusSchema,
} from "@/team-bridge/contract";

const TRAILING_SLASHES = /\/+$/;
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
	if (status === 400 || status === 413 || status === 422) return "invalid";
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
	let message = `Radient refused the request (HTTP ${response.status}).`;
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
		}, timeoutMs);
		const forward = () => controller.abort();
		if (signal?.aborted) controller.abort();
		else signal?.addEventListener("abort", forward, { once: true });
		try {
			return await fetchImpl(
				`${base}/v1/messaging${path}${queryString(query)}`,
				{
					method,
					headers: {
						accept: "application/json",
						authorization: `Bearer ${token}`,
						...(body === undefined
							? {}
							: { "content-type": "application/json" }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

	async function request<T>(
		method: "GET" | "POST" | "PUT" | "DELETE",
		path: string,
		parse: ((value: unknown) => T) | null,
		options: { query?: Query; body?: unknown; signal?: AbortSignal } = {},
	): Promise<T> {
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
		let token = await access();
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
		);
		if (response.status === 401) {
			/* One forced refresh, one retry. A token revoked server-side before its
			 * local expiry is the case this exists for. */
			token = await access(true);
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
			);
		}
		if (!response.ok) throw await errorFrom(response);
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

	return {
		/** `GET /status`: the eligibility ladder's one input. */
		status(signal?: AbortSignal): Promise<Status> {
			return request("GET", "/status", (v) => statusSchema.parse(v), {
				signal,
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
			input: { clientRef: string; body: string },
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
					},
				},
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
