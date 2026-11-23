/**
 * The community API client: every `/community/v1` read and write the phone
 * makes, and nothing else.
 *
 * WHY THE PHONE TALKS TO THE COMMUNITY DEPLOYMENT DIRECTLY (RFC v2.4 §7.2). The
 * mobile app is a DIRECT community client: it presents the phone's own Radient
 * OAuth access token to `api.radienthq.com/community/v1`, exactly as mobile Team
 * Bridge presents it to `/v1/messaging`. So the community works with the laptop
 * closed, costs nothing, and needs no tunnel. The community deployment holds no
 * signing key; it introspects the token against the private API (cached ≤ 30 s)
 * and fails closed with 503 while it cannot.
 *
 * SEPARATE FROM THE PRIVATE BRIDGE CLIENT ON PURPOSE. RFC §7.2: "Neither shares
 * state with the private Bridge client or receiver." This module imports nothing
 * from `@/team-bridge`; it shares only the connection layer's token accessor
 * (one credential, one refresh lifecycle — not a second token store).
 *
 * The route root is `/community/v1`, ROOT-RELATIVE: never append it to an API
 * base that already ends in `/v1` (the server's admission doc says so).
 *
 * Rules, mirrored from the hub client:
 *
 * - The token is fetched per request and never logged. One 401 asks for ONE
 *   forced refresh and retries once; a second 401 is `sign_in`.
 * - Every refusal is classified once (`CommunityError.kind`) so screens render a
 *   cause without parsing error bodies.
 * - Request bodies are never logged. A composer draft only ever lives in the
 *   multipart body of one request and in the screen's memory (RFC §6.5).
 */

import {
	type AgentApproval,
	agentApprovalPageSchema,
	agentApprovalSchema,
	type Bootstrap,
	bootstrapSchema,
	type ChannelPage,
	type CommunityList,
	type CommunityRequest,
	caseReceiptSchema,
	channelMembershipSchema,
	channelPageSchema,
	communityListSchema,
	type DirectConversation,
	directConversationPageSchema,
	type EventBatch,
	errorBodySchema,
	eventBatchSchema,
	type MessagePage,
	messagePageSchema,
	type Profile,
	type ProfilePage,
	profilePageSchema,
	profileSchema,
	type Refusal,
	type RefusalCategory,
	type ReportTargetKind,
	refusalSchema,
	requestPageSchema,
	requestSchema,
	type SubmissionOutcome,
	submissionOutcomeSchema,
	unreadCountsSchema,
} from "@/community/contract";
import { RADIENT_API_BASE } from "@/connection/discovery";
import { resolveFetch } from "@/relay/platform-fetch";

const TRAILING_SLASHES = /\/+$/;
const DELTA_SECONDS = /^\d+$/;
export const COMMUNITY_ROOT = "/community/v1";

/** A normal read or write. The server's own long-poll holds 25 s, see `EVENTS_TIMEOUT_MS`. */
const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * The events long-poll: the server holds the request "up to 25 s and answers
 * 200 with an empty batch on timeout" (contract, `pollEvents`). 35 s leaves the
 * server's own timeout room to answer first, so a quiet channel reads as an
 * empty batch rather than as a client-side "unreachable".
 */
export const EVENTS_TIMEOUT_MS = 35_000;
/**
 * A submission waits on moderation inside the request (the classifier runs
 * in-process with its own timeout, `COMMUNITY_MODERATION_*`). 60 s is above any
 * classifier timeout the deployment is configured with; the Cancel button is
 * the person's way out sooner.
 */
export const SUBMIT_TIMEOUT_MS = 60_000;

/**
 * What went wrong, in the vocabulary the community screens render.
 *
 * - `sign_in`: no token, or refused twice (401).
 * - `auth_unavailable`: 503 without `moderation_unavailable` — the deployment
 *   could not introspect the token. Retry later; never a sign-out.
 * - `moderation_unavailable`: 503 coded; nothing was published or stored.
 * - `refused`: 422 Refusal — the sender-only category and MOD reference.
 * - `rate_limited`: 429 with the server's `retry_after` (seconds) and `scope`.
 * - `images_unavailable`: 403 coded; images cannot be posted yet.
 * - `restricted`: 403 coded `restricted` — a sanction, with its reference.
 * - `forbidden`: any other 403 (no seat, staff-only channel, locked, …).
 * - `guidelines_changed`: 409 coded — re-accept `guidelinesVersion`, then retry.
 * - `conflict`: any other 409.
 * - `resync_required`: 410 from the events poll.
 * - `not_found`: 404. Unknown, draft, hidden or unjoined community answer alike.
 * - `too_large`: 413.
 * - `invalid`: 400.
 * - `unavailable`: 500 — storage; no detail by design.
 * - `unreachable`, `malformed`, `server`: transport, unreadable, anything else.
 */
export type CommunityErrorKind =
	| "sign_in"
	| "auth_unavailable"
	| "moderation_unavailable"
	| "refused"
	| "rate_limited"
	| "images_unavailable"
	| "restricted"
	| "forbidden"
	| "guidelines_changed"
	| "conflict"
	| "resync_required"
	| "not_found"
	| "too_large"
	| "invalid"
	| "unavailable"
	| "unreachable"
	| "malformed"
	| "server";

export class CommunityError extends Error {
	override readonly name = "CommunityError";
	readonly kind: CommunityErrorKind;
	readonly status: number | null;
	readonly code: string | null;
	/** Milliseconds, from the body's `retry_after` or the `Retry-After` header. */
	readonly retryAfterMs: number | null;
	/** `RateLimited.scope`: which per-sender window applied. */
	readonly scope: string | null;
	/** `refused` only. */
	readonly refusal: Refusal | null;
	/** `guidelines_changed` only: the version to accept. */
	readonly guidelinesVersion: string | null;
	/** `restricted` only: the sanction's reference, for an appeal. */
	readonly reference: string | null;
	constructor(input: {
		kind: CommunityErrorKind;
		status?: number | null;
		code?: string | null;
		retryAfterMs?: number | null;
		scope?: string | null;
		refusal?: Refusal | null;
		guidelinesVersion?: string | null;
		reference?: string | null;
	}) {
		/* The message is diagnostic only and never rendered: screens translate
		 * `kind`. It carries no server prose (which is English and unscreened). */
		super(`community ${input.kind}${input.status ? ` (${input.status})` : ""}`);
		this.kind = input.kind;
		this.status = input.status ?? null;
		this.code = input.code ?? null;
		this.retryAfterMs = input.retryAfterMs ?? null;
		this.scope = input.scope ?? null;
		this.refusal = input.refusal ?? null;
		this.guidelinesVersion = input.guidelinesVersion ?? null;
		this.reference = input.reference ?? null;
	}
}

export const isCommunityError = (value: unknown): value is CommunityError =>
	value instanceof CommunityError;

function headerRetryMs(response: Response): number | null {
	const raw = response.headers.get("retry-after")?.trim();
	if (!raw) return null;
	if (DELTA_SECONDS.test(raw)) return Number(raw) * 1000;
	const at = Date.parse(raw);
	return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/** Classify one non-2xx answer. Exported for the tests that pin the ladder. */
export async function communityErrorFrom(
	response: Response,
): Promise<CommunityError> {
	let body: ReturnType<typeof errorBodySchema.parse> | null = null;
	try {
		const parsed = errorBodySchema.safeParse(await response.json());
		body = parsed.success ? parsed.data : null;
	} catch {
		/* An edge page or empty body: classify on the status alone. */
	}
	const status = response.status;
	const code = body?.code ?? null;
	const retryAfterMs =
		typeof body?.retry_after === "number"
			? body.retry_after * 1000
			: headerRetryMs(response);
	const base = { status, code, retryAfterMs };
	switch (status) {
		case 401:
			return new CommunityError({ kind: "sign_in", ...base });
		case 404:
			return new CommunityError({ kind: "not_found", ...base });
		case 410:
			return new CommunityError({ kind: "resync_required", ...base });
		case 413:
			return new CommunityError({ kind: "too_large", ...base });
		case 400:
			return new CommunityError({ kind: "invalid", ...base });
		case 429:
			return new CommunityError({
				kind: "rate_limited",
				...base,
				scope: body?.scope ?? null,
			});
		case 422: {
			const refusal = refusalSchema.safeParse(body);
			/* A 422 that is not a well-formed Refusal is still "not published";
			 * an unknown category must not be rendered as a guessed label. */
			return refusal.success
				? new CommunityError({
						kind: "refused",
						...base,
						refusal: refusal.data,
					})
				: new CommunityError({ kind: "malformed", ...base });
		}
		case 403:
			if (code === "images_unavailable")
				return new CommunityError({ kind: "images_unavailable", ...base });
			if (code === "restricted")
				return new CommunityError({
					kind: "restricted",
					...base,
					reference: body?.reference ?? null,
				});
			return new CommunityError({ kind: "forbidden", ...base });
		case 409:
			return code === "guidelines_changed"
				? new CommunityError({
						kind: "guidelines_changed",
						...base,
						guidelinesVersion: body?.guidelines_version ?? null,
					})
				: new CommunityError({ kind: "conflict", ...base });
		case 503:
			return new CommunityError({
				kind:
					code === "moderation_unavailable"
						? "moderation_unavailable"
						: "auth_unavailable",
				...base,
			});
		case 500:
			return new CommunityError({ kind: "unavailable", ...base });
		default:
			return new CommunityError({ kind: "server", ...base });
	}
}

export interface CommunityClientDeps {
	/** The connection layer's accessor; `force` is the one refresh after a 401. */
	accessToken: (options?: { force?: boolean }) => Promise<string | null>;
	/** Defaults to `RADIENT_API_BASE`. Fixtures point it at a loopback mock. */
	baseUrl?: string;
	fetchImpl?: typeof globalThis.fetch;
	timeoutMs?: number;
}

type Query = Record<string, string | undefined | null>;

function queryString(query?: Query): string {
	if (!query) return "";
	const pairs = Object.entries(query).filter(
		(pair): pair is [string, string] =>
			typeof pair[1] === "string" && pair[1] !== "",
	);
	if (!pairs.length) return "";
	return `?${pairs
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join("&")}`;
}

const enc = encodeURIComponent;

export type SubmitInput = {
	communityId: string;
	conversationId: string;
	/** One key per ATTEMPT: a retry of the same attempt reuses it (contract). */
	idempotencyKey: string;
	text: string;
	threadRootId?: string;
	/** The version the sender accepted; a stale one answers 409 guidelines_changed. */
	guidelinesVersion?: string;
	signal?: AbortSignal;
};

export type ReportInput = {
	targetKind: ReportTargetKind;
	targetId: string;
	category: RefusalCategory;
	note?: string;
	/** `dm` only: the reporter consents to share that exact revision with T&S. */
	dmConsent?: boolean;
	/** `dm` only: the `Message.revision` the reporter read. */
	revision?: number;
	idempotencyKey: string;
};

export function createCommunityClient(deps: CommunityClientDeps) {
	const base = `${(deps.baseUrl ?? RADIENT_API_BASE).replace(TRAILING_SLASHES, "")}${COMMUNITY_ROOT}`;
	const defaultTimeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	async function once(
		method: string,
		path: string,
		token: string,
		init: {
			query?: Query;
			json?: unknown;
			form?: FormData;
			headers?: Record<string, string>;
			signal?: AbortSignal;
			timeoutMs?: number;
		},
	): Promise<Response> {
		const fetchImpl = resolveFetch(deps.fetchImpl);
		/* A plain controller: Hermes does not promise `AbortSignal.timeout`/`any`. */
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, init.timeoutMs ?? defaultTimeout);
		const forward = () => controller.abort();
		if (init.signal?.aborted) controller.abort();
		else init.signal?.addEventListener("abort", forward, { once: true });
		try {
			return await fetchImpl(`${base}${path}${queryString(init.query)}`, {
				method,
				headers: {
					accept: "application/json",
					authorization: `Bearer ${token}`,
					/* multipart: the runtime writes the boundary itself. */
					...(init.json !== undefined
						? { "content-type": "application/json" }
						: {}),
					...init.headers,
				},
				...(init.json !== undefined
					? { body: JSON.stringify(init.json) }
					: init.form
						? { body: init.form }
						: {}),
				credentials: "omit",
				cache: "no-store",
				signal: controller.signal,
			});
		} catch (error) {
			/* The caller's own abort (Cancel, unmount) propagates as itself. */
			if (init.signal?.aborted && !timedOut) throw error;
			throw new CommunityError({ kind: "unreachable" });
		} finally {
			clearTimeout(timer);
			init.signal?.removeEventListener("abort", forward);
		}
	}

	async function authorized(
		method: "GET" | "POST" | "PUT" | "DELETE",
		path: string,
		init: Parameters<typeof once>[3] = {},
	): Promise<Response> {
		const access = async (force: boolean) => {
			try {
				return await deps.accessToken(force ? { force: true } : undefined);
			} catch {
				/* A refresh transport failure is not a sign-out. */
				throw new CommunityError({ kind: "unreachable" });
			}
		};
		let token = await access(false);
		if (!token) throw new CommunityError({ kind: "sign_in" });
		let response = await once(method, path, token, init);
		if (response.status === 401) {
			token = await access(true);
			if (!token) throw new CommunityError({ kind: "sign_in", status: 401 });
			response = await once(method, path, token, init);
		}
		if (!response.ok) throw await communityErrorFrom(response);
		return response;
	}

	async function json<T>(
		response: Response,
		parse: (value: unknown) => T,
	): Promise<T> {
		try {
			return parse(await response.json());
		} catch {
			throw new CommunityError({ kind: "malformed", status: response.status });
		}
	}

	async function read<T>(
		method: "GET" | "POST" | "PUT",
		path: string,
		schema: { parse: (value: unknown) => T },
		init?: Parameters<typeof once>[3],
	): Promise<T> {
		const response = await authorized(method, path, init);
		return json(response, (v) => schema.parse(v));
	}

	async function noContent(
		method: "POST" | "DELETE",
		path: string,
		init?: Parameters<typeof once>[3],
	): Promise<void> {
		await authorized(method, path, init);
	}

	const c = (communityId: string) => `/communities/${enc(communityId)}`;

	return {
		listCommunities(): Promise<CommunityList> {
			return read("GET", "/communities", communityListSchema);
		},
		bootstrap(communityId: string): Promise<Bootstrap> {
			return read("GET", `${c(communityId)}/bootstrap`, bootstrapSchema);
		},
		/** Explicit acceptance of THIS version (RFC §5.2); `true` is the only legal value. */
		join(communityId: string, guidelinesVersion: string): Promise<Bootstrap> {
			return read("POST", `${c(communityId)}/join`, bootstrapSchema, {
				json: {
					guidelines_version: guidelinesVersion,
					accept_guidelines: true,
				},
			});
		},
		channels(
			communityId: string,
			options: { q?: string; filter?: string; cursor?: string | null } = {},
		): Promise<ChannelPage> {
			return read(
				"GET",
				`${c(communityId)}/directory/channels`,
				channelPageSchema,
				{
					query: {
						q: options.q,
						filter: options.filter,
						cursor: options.cursor,
					},
				},
			);
		},
		people(
			communityId: string,
			options: { q?: string; filter?: string; cursor?: string | null } = {},
		): Promise<ProfilePage> {
			return read(
				"GET",
				`${c(communityId)}/directory/people`,
				profilePageSchema,
				{
					query: {
						q: options.q,
						filter: options.filter,
						cursor: options.cursor,
					},
				},
			);
		},
		profile(communityId: string, publicId: string): Promise<Profile> {
			return read(
				"GET",
				`${c(communityId)}/profiles/${enc(publicId)}`,
				profileSchema,
			);
		},
		async joinChannel(communityId: string, channelId: string): Promise<void> {
			await read(
				"POST",
				`${c(communityId)}/channels/${enc(channelId)}:join`,
				channelMembershipSchema,
			);
		},
		messages(
			communityId: string,
			conversationId: string,
			cursor?: string | null,
		): Promise<MessagePage> {
			return read(
				"GET",
				`${c(communityId)}/conversations/${enc(conversationId)}/messages`,
				messagePageSchema,
				{ query: { cursor } },
			);
		},
		/**
		 * One moderated submission. 200 = published (or a stored outcome replayed
		 * for this key); a refusal, a limit and an outage are `CommunityError`s.
		 * The body is multipart (contract: "Streamed multipart"), text only: this
		 * build offers no image attach because images answer `images_unavailable`
		 * until the server's CSAM gate ships.
		 */
		async submit(input: SubmitInput): Promise<SubmissionOutcome> {
			const form = new FormData();
			form.append("text", input.text);
			if (input.threadRootId) form.append("thread_root_id", input.threadRootId);
			if (input.guidelinesVersion)
				form.append("guidelines_version", input.guidelinesVersion);
			return read(
				"POST",
				`${c(input.communityId)}/conversations/${enc(input.conversationId)}/submissions`,
				submissionOutcomeSchema,
				{
					form,
					headers: { "idempotency-key": input.idempotencyKey },
					signal: input.signal,
					timeoutMs: SUBMIT_TIMEOUT_MS,
				},
			);
		},
		submission(communityId: string, key: string): Promise<SubmissionOutcome> {
			return read(
				"GET",
				`${c(communityId)}/submissions/${enc(key)}`,
				submissionOutcomeSchema,
			);
		},
		/** Best effort (canon: "if it already posted, you see it posted"). */
		cancelSubmission(
			communityId: string,
			key: string,
		): Promise<SubmissionOutcome> {
			return read(
				"POST",
				`${c(communityId)}/submissions/${enc(key)}:cancel`,
				submissionOutcomeSchema,
			);
		},
		async markRead(
			communityId: string,
			conversationId: string,
			seq: number,
		): Promise<number> {
			const counts = await read(
				"POST",
				`${c(communityId)}/conversations/${enc(conversationId)}:read`,
				unreadCountsSchema,
				{ json: { seq } },
			);
			return counts.unread;
		},
		async requests(
			communityId: string,
			options: {
				kind?: "dm" | "contact";
				direction?: "incoming" | "outgoing";
			} = {},
		): Promise<CommunityRequest[]> {
			const page = await read(
				"GET",
				`${c(communityId)}/requests`,
				requestPageSchema,
				{
					query: { kind: options.kind, direction: options.direction },
				},
			);
			return page.items;
		},
		createDmRequest(
			communityId: string,
			recipientPublicId: string,
			idempotencyKey: string,
		): Promise<CommunityRequest> {
			return read("POST", `${c(communityId)}/dm-requests`, requestSchema, {
				json: { recipient_public_id: recipientPublicId },
				headers: { "idempotency-key": idempotencyKey },
			});
		},
		acceptDmRequest(
			communityId: string,
			requestId: string,
		): Promise<CommunityRequest> {
			return read(
				"POST",
				`${c(communityId)}/dm-requests/${enc(requestId)}:accept`,
				requestSchema,
			);
		},
		declineDmRequest(communityId: string, requestId: string): Promise<void> {
			return noContent(
				"POST",
				`${c(communityId)}/dm-requests/${enc(requestId)}:decline`,
			);
		},
		async directConversations(
			communityId: string,
		): Promise<DirectConversation[]> {
			const page = await read(
				"GET",
				`${c(communityId)}/direct-conversations`,
				directConversationPageSchema,
			);
			return page.items;
		},
		async agentApprovals(communityId: string): Promise<AgentApproval[]> {
			const page = await read(
				"GET",
				`${c(communityId)}/agent-approvals`,
				agentApprovalPageSchema,
			);
			return page.items;
		},
		/** "Don't post" from the phone. Approving needs the computer that holds the draft. */
		answerAgentApproval(
			communityId: string,
			approvalId: string,
			decision: "approve" | "decline",
		): Promise<AgentApproval> {
			return read(
				"POST",
				`${c(communityId)}/agent-approvals/${enc(approvalId)}:answer`,
				agentApprovalSchema,
				{ json: { decision, surface: "mobile" } },
			);
		},
		events(
			communityId: string,
			after: string | null,
			signal?: AbortSignal,
		): Promise<EventBatch> {
			return read("GET", `${c(communityId)}/events`, eventBatchSchema, {
				query: { after },
				signal,
				timeoutMs: EVENTS_TIMEOUT_MS,
			});
		},
		async report(communityId: string, input: ReportInput): Promise<string> {
			const receipt = await read(
				"POST",
				`${c(communityId)}/reports`,
				caseReceiptSchema,
				{
					json: {
						target_kind: input.targetKind,
						target_id: input.targetId,
						category: input.category,
						...(input.note?.trim() ? { note: input.note.trim() } : {}),
						...(input.targetKind === "dm"
							? {
									dm_consent: input.dmConsent === true,
									revision: input.revision,
								}
							: {}),
					},
					headers: { "idempotency-key": input.idempotencyKey },
				},
			);
			return receipt.case_reference;
		},
		block(communityId: string, publicId: string): Promise<void> {
			return noContent("POST", `${c(communityId)}/blocks`, {
				json: { public_id: publicId },
			});
		},
	};
}

export type CommunityClient = ReturnType<typeof createCommunityClient>;
