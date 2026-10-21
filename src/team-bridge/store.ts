/**
 * Team Bridge state: one store per process, shared by the list, the thread and
 * the navigation entry's badge.
 *
 * WHY A STORE AND NOT SCREEN STATE. The list and the thread both show a
 * conversation's unread count, and the drawer entry shows the account total. If
 * each screen held its own copy, reading a thread would leave the list's badge
 * stale until a refetch, which is the "two screens disagree" defect this app
 * avoids everywhere else. A read the thread makes (`markRead`) updates the one
 * row everyone renders.
 *
 * WHAT IT DOES NOT HOLD. No token, and no message body outside the open thread's
 * page. Bodies live only in `threads`, keyed by conversation, and the whole store
 * resets on sign-out (`reset`), so a second account on the same phone never sees
 * the first one's messages.
 *
 * The store is plain (no React), so the transitions are Node-testable.
 */

import { createStore } from "zustand/vanilla";

import { type HubClient, HubError, isHubError } from "@/team-bridge/client";
import type {
	Conversation,
	DirectoryMember,
	Message,
	Notify,
} from "@/team-bridge/contract";
import {
	type Eligibility,
	eligibility,
	mergeMessages,
	type Organization,
	organizationsFrom,
	preferredOrganization,
	type StatusRead,
} from "@/team-bridge/model";

export type LoadState = "idle" | "loading" | "ready" | "error";

export interface OrgData {
	conversations: Conversation[];
	conversationsState: LoadState;
	conversationsError: HubError | null;
	people: DirectoryMember[];
	peopleIncomplete: boolean;
	peopleState: LoadState;
	peopleError: HubError | null;
	refreshedAt: number | null;
}

export interface ThreadData {
	messages: Message[];
	state: LoadState;
	error: HubError | null;
	/** More history exists before the oldest held message. */
	hasMore: boolean;
	loadingOlder: boolean;
	olderError: HubError | null;
}

export interface TeamBridgeState {
	/** `checking` until the first status answer; then a gate or `open`. */
	gate: "checking" | "open" | Eligibility;
	gateError: HubError | null;
	selfAccountId: string | null;
	organizations: Organization[];
	selectedTenantId: string | null;
	totalUnread: number;
	orgs: Record<string, OrgData>;
	threads: Record<string, ThreadData>;
}

const emptyOrg = (): OrgData => ({
	conversations: [],
	conversationsState: "idle",
	conversationsError: null,
	people: [],
	peopleIncomplete: false,
	peopleState: "idle",
	peopleError: null,
	refreshedAt: null,
});

const emptyThread = (): ThreadData => ({
	messages: [],
	state: "idle",
	error: null,
	hasMore: false,
	loadingOlder: false,
	olderError: null,
});

export const initialTeamBridgeState = (): TeamBridgeState => ({
	gate: "checking",
	gateError: null,
	selfAccountId: null,
	organizations: [],
	selectedTenantId: null,
	totalUnread: 0,
	orgs: {},
	threads: {},
});

/** A history page this size; the hub clamps it anyway. */
export const PAGE_SIZE = 50;

/**
 * The subject claim of a Radient access token: the caller's account id.
 *
 * WHY DECODE THE TOKEN. The hub's status payload carries no account id, and the
 * thread needs one to tell "mine" from "theirs" (alignment, a DM's title, the
 * People row marked "you"). The access token's `sub` IS the account id the hub
 * authorizes every request against (agent-server `auth_service.go`), so reading
 * it is reading the same identity, not inventing one. The signature is not
 * checked here because nothing is AUTHORIZED by this value: it only decides
 * which side of the thread a bubble sits on.
 */
export function accountIdFromToken(token: string | null): string | null {
	if (!token) return null;
	const part = token.split(".")[1];
	if (!part) return null;
	try {
		const padded = part.replace(/-/g, "+").replace(/_/g, "/");
		const json =
			typeof atob === "function"
				? atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
				: Buffer.from(padded, "base64").toString("utf8");
		const claims = JSON.parse(json) as { sub?: unknown };
		return typeof claims.sub === "string" && claims.sub.length > 0
			? claims.sub
			: null;
	} catch {
		return null;
	}
}

export const threadKey = (tenantId: string, conversationId: string): string =>
	`${tenantId}/${conversationId}`;

export function createTeamBridgeStore(deps: {
	hub: () => HubClient | null;
	accessToken: () => Promise<string | null>;
	/** Persisted org choice. Injected so tests and the web build stay in memory. */
	rememberOrg?: (tenantId: string) => void;
	recallOrg?: () => string | null;
	now?: () => number;
}) {
	const store = createStore<TeamBridgeState>(() => initialTeamBridgeState());

	/** Apply a change to one conversation row wherever it is held. */
	function patchConversation(
		tenantId: string,
		conversationId: string,
		change: (conversation: Conversation) => Conversation,
	): void {
		store.setState((s) => {
			const org = s.orgs[tenantId];
			if (!org) return s;
			return {
				orgs: {
					...s.orgs,
					[tenantId]: {
						...org,
						conversations: org.conversations.map((c) =>
							c.id === conversationId ? change(c) : c,
						),
					},
				},
			};
		});
	}

	/** One delta drives all badges; muted rows do not contribute to account totals. */
	function reconcileConversation(
		tenantId: string,
		conversationId: string,
		change: (row: Conversation) => Conversation,
	): void {
		const previous = store
			.getState()
			.orgs[tenantId]?.conversations.find((c) => c.id === conversationId);
		if (!previous) return;
		const next = change(previous);
		const delta = next.unread_count - previous.unread_count;
		const accountDelta =
			(next.muted ? 0 : next.unread_count) -
			(previous.muted ? 0 : previous.unread_count);
		patchConversation(tenantId, conversationId, () => next);
		store.setState((state) => ({
			totalUnread: Math.max(0, state.totalUnread + accountDelta),
			organizations: state.organizations.map((org) =>
				org.tenantId === tenantId
					? { ...org, unread: Math.max(0, org.unread + delta) }
					: org,
			),
		}));
	}

	function patchOrg(tenantId: string, change: Partial<OrgData>): void {
		store.setState((s) => ({
			orgs: {
				...s.orgs,
				[tenantId]: { ...(s.orgs[tenantId] ?? emptyOrg()), ...change },
			},
		}));
	}

	function patchThread(key: string, change: Partial<ThreadData>): void {
		store.setState((s) => ({
			threads: {
				...s.threads,
				[key]: { ...(s.threads[key] ?? emptyThread()), ...change },
			},
		}));
	}

	/*
	 * Single-flight per read. Pull-to-refresh, focus and a push tap can all ask
	 * for the same page within a second; one request answers all of them, and a
	 * stale answer can never overwrite a newer one.
	 */
	let generation = 0;
	const inFlight = new Map<string, Promise<void>>();
	function once(
		key: string,
		run: (owned: () => boolean) => Promise<void>,
	): Promise<void> {
		const existing = inFlight.get(key);
		if (existing) return existing;
		const epoch = generation;
		const next = run(() => epoch === generation).finally(() => {
			// A retired request must not remove its successor after account change.
			if (inFlight.get(key) === next) inFlight.delete(key);
		});
		inFlight.set(key, next);
		return next;
	}

	const actions = {
		/**
		 * Read the hub's status and decide the gate. The status read is the ONE
		 * input of the eligibility ladder (desktop `teamBridgeEligibility`); a
		 * transport failure keeps the previous gate when there was one (the reader
		 * keeps what they had), and is otherwise the `unavailable` gate with a retry.
		 */
		checkStatus(): Promise<void> {
			return once("status", async (owned) => {
				const client = deps.hub();
				let token: string | null;
				try {
					token = await deps.accessToken();
				} catch (error) {
					if (owned())
						store.setState({
							gate:
								store.getState().gate === "checking"
									? "unavailable"
									: store.getState().gate,
							gateError: isHubError(error)
								? error
								: new HubError({
										kind: "unreachable",
										message:
											"Radient could not refresh the session. Please retry.",
									}),
						});
					return;
				}
				if (!owned()) return;
				if (!client || !token) {
					actions.reset();
					store.setState({ gate: "signed_out" });
					return;
				}
				let read: StatusRead;
				try {
					read = { kind: "ok", status: await client.status() };
					if (!owned()) return;
				} catch (error) {
					if (!owned()) return;
					const hubError = isHubError(error) ? error : null;
					if (hubError?.kind === "sign_in") read = { kind: "signed_out" };
					else if (
						hubError?.kind === "unavailable" ||
						store.getState().gate === "checking"
					) {
						store.setState({ gate: "unavailable", gateError: hubError });
						return;
					} else {
						/* A refresh that failed after the surface was open keeps it open. */
						store.setState({ gateError: hubError });
						return;
					}
				}
				const gate = eligibility(read);
				if (read.kind !== "ok" || gate !== null) {
					if (gate === "signed_out") actions.reset();
					store.setState({
						gateError: null,
						...(gate === "signed_out" ? initialTeamBridgeState() : {}),
						gate: gate ?? "unavailable",
					});
					return;
				}
				const previous = store.getState().organizations;
				const unread = new Map(previous.map((o) => [o.tenantId, o.unread]));
				const organizations = organizationsFrom(read.status.tenants, unread);
				const current = store.getState().selectedTenantId;
				const selected = preferredOrganization(
					organizations,
					current ?? deps.recallOrg?.() ?? null,
				);
				store.setState({
					gate: "open",
					gateError: null,
					selfAccountId: accountIdFromToken(token),
					organizations,
					selectedTenantId: selected?.tenantId ?? null,
				});
			});
		},

		selectOrganization(tenantId: string) {
			if (!store.getState().organizations.some((o) => o.tenantId === tenantId))
				return;
			store.setState({ selectedTenantId: tenantId });
			deps.rememberOrg?.(tenantId);
		},

		/** The account-wide badge and the switcher's per-org counts. Best effort. */
		refreshUnread(): Promise<void> {
			return once("unread", async (owned) => {
				const client = deps.hub();
				if (!client) return;
				try {
					const answer = await client.accountUnread();
					if (!owned()) return;
					const byTenant = new Map(
						(answer.organizations ?? []).map((o) => [o.tenant_id, o.unread]),
					);
					store.setState((s) => ({
						totalUnread: answer.total,
						organizations: s.organizations.map((o) => ({
							...o,
							unread: byTenant.get(o.tenantId) ?? o.unread,
						})),
					}));
				} catch {
					/* The badge keeps its last value; the list's own read reports failures. */
				}
			});
		},

		/**
		 * One organization's conversations (every page) and its people, in
		 * parallel. A failure in one half is that section's own error state; the
		 * other half still renders.
		 */
		loadOrganization(
			tenantId: string,
			options: { silent?: boolean } = {},
		): Promise<void> {
			return once(`org:${tenantId}`, async (owned) => {
				const client = deps.hub();
				if (!client) return;
				const held = store.getState().orgs[tenantId];
				const silent =
					options.silent === true && held?.conversationsState === "ready";
				if (!silent) {
					patchOrg(tenantId, {
						conversationsState: "loading",
						conversationsError: null,
						...(held?.peopleState === "ready"
							? {}
							: { peopleState: "loading", peopleError: null }),
					});
				}
				const conversations = (async () => {
					try {
						const rows: Conversation[] = [];
						let cursor: string | undefined;
						/* Never publish a partial walk as a complete list: the UI has no pagination action. */
						for (let page = 0; page < 10; page += 1) {
							const answer = await client.listConversations(tenantId, {
								cursor,
							});
							if (!owned()) return;
							rows.push(...answer.conversations);
							if (!answer.has_more) break;
							if (!answer.next_cursor)
								throw new HubError({
									kind: "malformed",
									message: "Conversation page is missing its next cursor.",
								});
							if (page === 9)
								throw new HubError({
									kind: "unavailable",
									message: "Too many conversation pages. Please retry later.",
								});
							cursor = answer.next_cursor;
						}
						patchOrg(tenantId, {
							conversations: rows.map((row) => {
								const current = store
									.getState()
									.orgs[tenantId]?.conversations.find(
										(held) => held.id === row.id,
									);
								// A list snapshot may predate a receipt accepted while it was loading.
								return current && current.last_read_seq > row.last_read_seq
									? {
											...row,
											last_read_seq: current.last_read_seq,
											unread_count: current.unread_count,
										}
									: row;
							}),
							conversationsState: "ready",
							conversationsError: null,
							refreshedAt: (deps.now ?? Date.now)(),
						});
					} catch (error) {
						if (!owned()) return;
						const hubError = isHubError(error) ? error : null;
						if (hubError?.kind === "sign_in") {
							actions.reset();
							store.setState({ gate: "signed_out" });
							return;
						}
						if (hubError?.kind === "plan")
							store.setState({ gate: "plan_required" });
						/* A silent refresh that fails keeps the rows on screen. */
						patchOrg(tenantId, {
							conversationsState: "error",
							conversationsError: hubError,
						});
					}
				})();
				const people = (async () => {
					try {
						const answer = await client.directory(tenantId);
						if (!owned()) return;
						patchOrg(tenantId, {
							people: answer.members,
							peopleIncomplete: answer.unavailable_count > 0,
							peopleState: "ready",
							peopleError: null,
						});
					} catch (error) {
						if (!owned()) return;
						patchOrg(tenantId, {
							peopleState: "error",
							peopleError: isHubError(error) ? error : null,
						});
					}
				})();
				await Promise.all([conversations, people]);
			});
		},

		/**
		 * The newest page of one thread (open, pull-to-refresh, a push tap). It
		 * MERGES into what is held, so a refresh never drops older pages the
		 * reader already scrolled to.
		 */
		loadThread(tenantId: string, conversationId: string): Promise<void> {
			const key = threadKey(tenantId, conversationId);
			return once(`thread:${key}`, async (owned) => {
				const client = deps.hub();
				if (!client) return;
				const held = store.getState().threads[key];
				if (held?.state !== "ready")
					patchThread(key, { state: "loading", error: null });
				try {
					const page = await client.listMessages(tenantId, conversationId, {
						limit: PAGE_SIZE,
					});
					if (!owned()) return;
					const current = store.getState().threads[key];
					const first = !current || current.messages.length === 0;
					patchThread(key, {
						messages: mergeMessages(current?.messages ?? [], page.messages),
						state: "ready",
						error: null,
						/* Only the FIRST page decides whether older history exists; a
						 *  refresh of the tail says nothing about the head. */
						...(first ? { hasMore: page.has_more === true } : {}),
					});
				} catch (error) {
					if (!owned()) return;
					if (held?.state !== "ready")
						patchThread(key, {
							state: "error",
							error: isHubError(error) ? error : null,
						});
				}
			});
		},

		/** The page before the oldest held message (`before_seq` is exclusive). */
		loadOlder(tenantId: string, conversationId: string): Promise<void> {
			const key = threadKey(tenantId, conversationId);
			return once(`older:${key}`, async (owned) => {
				const client = deps.hub();
				const held = store.getState().threads[key];
				if (!client || !held?.hasMore || held.messages.length === 0) return;
				const oldest = held.messages[0];
				if (!oldest) return;
				patchThread(key, { loadingOlder: true, olderError: null });
				try {
					const page = await client.listMessages(tenantId, conversationId, {
						beforeSeq: oldest.seq,
						limit: PAGE_SIZE,
					});
					if (!owned()) return;
					const current = store.getState().threads[key] ?? emptyThread();
					patchThread(key, {
						messages: mergeMessages(current.messages, page.messages),
						hasMore: page.has_more === true && page.messages.length > 0,
						loadingOlder: false,
					});
				} catch (error) {
					if (!owned()) return;
					store.setState((s) => ({
						threads: {
							...s.threads,
							[key]: {
								...(s.threads[key] ?? emptyThread()),
								loadingOlder: false,
								olderError: isHubError(error) ? error : null,
							},
						},
					}));
				}
			});
		},

		/**
		 * Only the newest loaded page can prove all unseen messages were read.
		 * Keep the durable cursor server-owned so a failed receipt stays retryable.
		 */
		async markRead(tenantId: string, conversationId: string, seq: number) {
			const client = deps.hub();
			if (!client) return;
			const epoch = generation;
			const row = store
				.getState()
				.orgs[tenantId]?.conversations.find((c) => c.id === conversationId);
			if (row && row.last_read_seq >= seq && row.unread_count === 0) return;
			let optimistic: Conversation | undefined;
			if (row && seq >= row.latest_seq) {
				optimistic = { ...row, unread_count: 0 };
				reconcileConversation(
					tenantId,
					conversationId,
					() => optimistic ?? row,
				);
			}
			try {
				const answer = await client.markRead(tenantId, conversationId, { seq });
				if (epoch !== generation) return;
				reconcileConversation(tenantId, conversationId, (current) => {
					// Receipts can arrive in reverse order; the server cursor never goes back.
					if (answer.last_read_seq < current.last_read_seq) return current;
					return {
						...current,
						last_read_seq: answer.last_read_seq,
						unread_count: answer.unread_count,
						muted: answer.muted,
						...(answer.notify ? { notify: answer.notify } : {}),
					};
				});
			} catch {
				if (epoch !== generation) return;
				// Restore only our untouched optimistic row, never a newer receipt/refresh.
				if (row && optimistic) {
					const current = store
						.getState()
						.orgs[tenantId]?.conversations.find((c) => c.id === conversationId);
					if (current === optimistic)
						reconcileConversation(tenantId, conversationId, () => row);
					else if (current && current.last_read_seq < seq) {
						// Another writer owns this row now: undoing our old snapshot would
						// lose its changes. Reconcile from the server instead of guessing.
						await Promise.all([
							actions.loadOrganization(tenantId, { silent: true }),
							actions.refreshUnread(),
						]);
					}
				}
			}
		},

		/** Change this conversation's notification policy. Throws so the menu can say so. */
		async setNotify(tenantId: string, conversationId: string, notify: Notify) {
			const client = deps.hub();
			if (!client)
				throw new HubError({ kind: "sign_in", message: "Sign in to Radient." });
			const epoch = generation;
			const answer = await client.markRead(tenantId, conversationId, {
				notify,
			});
			if (epoch !== generation) return;
			reconcileConversation(tenantId, conversationId, (c) => ({
				...c,
				unread_count:
					answer.last_read_seq >= c.last_read_seq
						? answer.unread_count
						: c.unread_count,
				last_read_seq: Math.max(c.last_read_seq, answer.last_read_seq),
				muted: answer.muted,
				notify: answer.notify ?? notify,
			}));
		},

		/**
		 * Send as the reader. The conversation is created FIRST when the target
		 * is a draft (create-on-first-send). Returns the stored message so the
		 * thread can replace its pending row. Throws a `HubError` so the composer
		 * keeps the draft and says what failed.
		 */
		async send(
			tenantId: string,
			conversationId: string,
			body: string,
			clientRef: string,
		): Promise<Message> {
			const client = deps.hub();
			if (!client)
				throw new HubError({ kind: "sign_in", message: "Sign in to Radient." });
			const epoch = generation;
			const message = await client.send(tenantId, conversationId, {
				clientRef,
				body,
			});
			if (epoch !== generation)
				throw new HubError({
					kind: "sign_in",
					message: "Account changed while sending.",
				});
			const key = threadKey(tenantId, conversationId);
			store.setState((s) => ({
				threads: {
					...s.threads,
					[key]: {
						...(s.threads[key] ?? emptyThread()),
						messages: mergeMessages(s.threads[key]?.messages ?? [], [message]),
					},
				},
			}));
			patchConversation(tenantId, conversationId, (c) => ({
				...c,
				latest_seq: Math.max(c.latest_seq, message.seq),
				last_read_seq: Math.max(c.last_read_seq, message.seq),
				last_message_at: message.created_at,
			}));
			return message;
		},

		/** Insert a conversation the reader just created (a first send's DM). */
		adopt(conversation: Conversation) {
			store.setState((s) => {
				const org = s.orgs[conversation.tenant_id] ?? emptyOrg();
				const rest = org.conversations.filter((c) => c.id !== conversation.id);
				return {
					orgs: {
						...s.orgs,
						[conversation.tenant_id]: {
							...org,
							conversations: [conversation, ...rest],
						},
					},
				};
			});
		},

		/** Sign-out: nothing of the previous account survives. */
		reset() {
			generation += 1;
			inFlight.clear();
			store.setState(initialTeamBridgeState());
		},
	};

	return { store, actions };
}

export type TeamBridgeStore = ReturnType<typeof createTeamBridgeStore>;
