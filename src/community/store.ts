/**
 * The phone's community state: what the community screens render, and the only
 * place that calls the community client.
 *
 * WHAT LIVES HERE, AND WHAT NEVER DOES.
 *
 * - Everything is IN MEMORY. Nothing in this store is written to device storage:
 *   composer drafts stay in memory only (RFC v2.4 §7.2, "keep composer drafts
 *   in memory only"), and the selected scope is "this app session" only
 *   (Amendment A §3), so a restart reapplies the opening rule.
 * - No state is shared with the private Team Bridge store (RFC §7.2). The two
 *   stores sit side by side; the switcher reads both and merges neither.
 *
 * SENDING (RFC §5.5, §8; frames M2/M7b). One `Attempt` per conversation:
 *
 * - A send mints ONE idempotency key. Every Retry of that text reuses it, so a
 *   retried request the server already screened replays its stored outcome
 *   ("without re-running moderation or counting against limits twice"), and a
 *   request that never reached moderation (throttled, unavailable, dropped)
 *   leaves no outcome and is safely re-run under the same key.
 * - Outcomes are SENDER-ONLY: a refusal (category + MOD reference) exists only
 *   in this store, never in the conversation's history.
 * - Cancel is best effort (canon: "if it already posted, you see it posted").
 *
 * EVENTS. One long-poll loop per community while a community screen is
 * mounted (`watch`). Events are content-free invalidations; the store refetches
 * through the authorized read paths. A 410 `resync_required` refetches every
 * view and restarts from the tail.
 */

import { createStore } from "zustand/vanilla";
import {
	type CommunityClient,
	type CommunityError,
	isCommunityError,
} from "@/community/client";
import type {
	AgentApproval,
	Bootstrap,
	Channel,
	Community,
	CommunityRequest,
	DirectConversation,
	CommunityMessage as Message,
	Profile,
	RefusalCategory,
	ReportTargetKind,
} from "@/community/contract";
import {
	type Attempt,
	attemptStateFromError,
	type BridgeSelection,
	type CommunityRow,
	communityUnread,
	mergeMessages,
	replaceNewestWindow,
	retryKeepsKey,
} from "@/community/model";
import { randomState } from "@/connection/pkce";

export type LoadState = "idle" | "loading" | "ready" | "error";

export type Loaded<T> = {
	state: LoadState;
	data: T;
	error: CommunityError | null;
};

export type ThreadData = {
	/** Oldest first, deduplicated by id (`mergeMessages`). */
	messages: Message[];
	state: LoadState;
	error: CommunityError | null;
	/** The viewer-bound cursor for the next OLDER page, or null at the beginning. */
	olderCursor: string | null;
	loadingOlder: boolean;
	olderError: CommunityError | null;
};

export interface CommunityState {
	communities: Loaded<{ joined: Community[]; featured: Community[] }>;
	bootstraps: Record<string, Loaded<Bootstrap | null>>;
	channels: Record<string, Loaded<Channel[]>>;
	directs: Record<string, Loaded<DirectConversation[]>>;
	threads: Record<string, ThreadData>;
	attempts: Record<string, Attempt | undefined>;
	/** In memory only, keyed like `threads`. Never persisted (RFC §7.2). */
	drafts: Record<string, string>;
	requests: Record<string, Loaded<CommunityRequest[]>>;
	approvals: Record<string, Loaded<AgentApproval[]>>;
	/** Amendment A §3: the scope picked this app session; memory only. */
	session: BridgeSelection | null;
	/**
	 * Channels opened from Browse WITHOUT joining, keyed like `threads`.
	 * A member may read every public channel without a seat, so looking is not
	 * joining (review round 1, R1-6); the conversation screen reads its name and
	 * state from here and offers an explicit Join instead of the composer.
	 */
	previews: Record<string, Channel>;
}

export const conversationKey = (communityId: string, conversationId: string) =>
	`${communityId}/${conversationId}`;

const idle = <T>(data: T): Loaded<T> => ({ state: "idle", data, error: null });

export const initialCommunityState = (): CommunityState => ({
	communities: idle({ joined: [], featured: [] }),
	bootstraps: {},
	channels: {},
	directs: {},
	threads: {},
	attempts: {},
	drafts: {},
	requests: {},
	approvals: {},
	session: null,
	previews: {},
});

const emptyThread = (): ThreadData => ({
	messages: [],
	state: "idle",
	error: null,
	olderCursor: null,
	loadingOlder: false,
	olderError: null,
});

/** 24 random bytes → 32 base64url characters, inside the contract's `{16,64}`. */
export const newIdempotencyKey = () => randomState({}, 24);

/**
 * Backoff for a failed events poll: 2 s doubling to 60 s. A long-poll that
 * fails fast (offline, 503 while introspection is down) must not spin; 60 s
 * caps how stale a quiet screen can get once the server is back. Not a
 * measured distribution: the server publishes no client retry policy, and these
 * are the bounds the hub client's transient backoff already uses.
 */
export const EVENTS_BACKOFF_MS = { initial: 2_000, max: 60_000 } as const;

/** How long a "checking" replay waits between status reads, and how many. */
const CHECKING_POLL_MS = 1_500;
const CHECKING_POLLS = 40;

const asError = (error: unknown): CommunityError | null =>
	isCommunityError(error) ? error : null;

export function createCommunityStore(deps: {
	client: () => CommunityClient | null;
	now?: () => number;
	newKey?: () => Promise<string>;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}) {
	const store = createStore<CommunityState>(() => initialCommunityState());
	const now = deps.now ?? Date.now;
	const newKey = deps.newKey ?? newIdempotencyKey;
	const sleep =
		deps.sleep ??
		((ms: number, signal?: AbortSignal) =>
			new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, ms);
				signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						resolve();
					},
					{ once: true },
				);
			}));
	/** In-flight submissions, so Cancel can stop waiting on one. */
	const inflight = new Map<string, AbortController>();
	/** One events loop per community; the count is how many screens watch it. */
	const watchers = new Map<string, { count: number; stop: AbortController }>();
	let closed = false;
	/* `holdOpening`'s one-shot; not state, nothing renders from it. */
	let openingHeld = false;

	const client = () => {
		const value = closed ? null : deps.client();
		if (!value) throw new Error("community client unavailable");
		return value;
	};

	function patch<K extends keyof CommunityState>(
		key: K,
		id: string,
		value: CommunityState[K] extends Record<string, infer V> ? V : never,
	) {
		store.setState(
			(s) =>
				({
					[key]: { ...(s[key] as Record<string, unknown>), [id]: value },
				}) as Partial<CommunityState>,
		);
	}

	async function load<T>(
		key: "bootstraps" | "channels" | "directs" | "requests" | "approvals",
		id: string,
		fallback: T,
		read: () => Promise<T>,
	): Promise<T | null> {
		const previous = store.getState()[key][id] as Loaded<T> | undefined;
		patch(key, id, {
			state: "loading",
			data: previous?.data ?? fallback,
			error: null,
		} as never);
		try {
			const data = await read();
			if (closed) return null;
			patch(key, id, { state: "ready", data, error: null } as never);
			return data;
		} catch (error) {
			if (closed) return null;
			patch(key, id, {
				state: "error",
				data: previous?.data ?? fallback,
				error: asError(error),
			} as never);
			return null;
		}
	}

	function setThread(key: string, change: Partial<ThreadData>) {
		store.setState((s) => ({
			threads: {
				...s.threads,
				[key]: { ...(s.threads[key] ?? emptyThread()), ...change },
			},
		}));
	}

	function setAttempt(key: string, attempt: Attempt | undefined) {
		store.setState((s) => ({ attempts: { ...s.attempts, [key]: attempt } }));
	}

	/** Run one submission under `attempt.key` and record its outcome. */
	async function submit(
		communityId: string,
		conversationId: string,
		attempt: Attempt,
	): Promise<void> {
		const key = conversationKey(communityId, conversationId);
		const controller = new AbortController();
		inflight.set(attempt.key, controller);
		setAttempt(key, { ...attempt, state: { kind: "checking" } });
		/* The version this member ACCEPTED: the server answers 409
		 * guidelines_changed when it is no longer current, which is the
		 * composer's cue to re-show the guidelines rather than post under
		 * rules the sender never saw. */
		const guidelinesVersion =
			store.getState().bootstraps[communityId]?.data?.membership
				?.guidelines_version ?? undefined;
		try {
			let outcome = await client().submit({
				communityId,
				conversationId,
				text: attempt.text,
				threadRootId: attempt.threadRootId ?? undefined,
				idempotencyKey: attempt.key,
				guidelinesVersion,
				signal: controller.signal,
			});
			/* Another request holds this key's lease (a retry overlapping a slow
			 * first try): read its status until it settles, never resubmit. */
			for (let i = 0; outcome.state === "checking" && i < CHECKING_POLLS; i++) {
				await sleep(CHECKING_POLL_MS, controller.signal);
				if (controller.signal.aborted) return;
				outcome = await client().submission(communityId, attempt.key);
			}
			if (store.getState().attempts[key]?.key !== attempt.key) return;
			settle(
				communityId,
				conversationId,
				attempt,
				outcome.state,
				outcome.refusal,
			);
		} catch (error) {
			/* Cancel aborted the wait; `cancel` owns the outcome then. */
			if (controller.signal.aborted) return;
			if (store.getState().attempts[key]?.key !== attempt.key) return;
			setAttempt(key, {
				...attempt,
				state: attemptStateFromError(error, now()),
			});
		} finally {
			inflight.delete(attempt.key);
		}
	}

	function settle(
		communityId: string,
		conversationId: string,
		attempt: Attempt,
		state: "checking" | "published" | "refused" | "cancelled" | "expired",
		refusal?: { category: RefusalCategory; reference: string } | null,
	) {
		const key = conversationKey(communityId, conversationId);
		if (state === "published") {
			/* Published: the draft is spent and the attempt disappears; the message
			 * itself arrives through the history read, like everyone else's. */
			setAttempt(key, undefined);
			store.setState((s) => ({ drafts: { ...s.drafts, [key]: "" } }));
			void actions.refreshThread(communityId, conversationId);
			return;
		}
		if (state === "refused" && refusal) {
			setAttempt(key, {
				...attempt,
				state: {
					kind: "refused",
					category: refusal.category,
					reference: refusal.reference,
				},
			});
			return;
		}
		if (state === "cancelled") {
			setAttempt(key, { ...attempt, state: { kind: "cancelled" } });
			return;
		}
		/* `expired` is FINAL for its key (a replay answers `expired` again), so
		 * Retry must mint a new key; a status that never settled keeps it. */
		setAttempt(key, {
			...attempt,
			rekey: state === "expired",
			state: { kind: "failed" },
		});
	}

	async function eventsLoop(communityId: string, stop: AbortSignal) {
		let after: string | null = null;
		let backoff: number = EVENTS_BACKOFF_MS.initial;
		while (!stop.aborted && !closed) {
			try {
				const batch = await client().events(communityId, after, stop);
				if (stop.aborted) return;
				backoff = EVENTS_BACKOFF_MS.initial;
				/* Applied on the tail read too: the server may hold that first
				 * request open, and an event committed meanwhile is real. A
				 * refetch it causes is idempotent. */
				applyEvents(communityId, batch.events);
				after = batch.next;
			} catch (error) {
				if (stop.aborted) return;
				const failure = asError(error);
				if (failure?.kind === "resync_required") {
					after = null;
					void refetchViews(communityId);
					continue;
				}
				if (failure?.kind === "sign_in" || failure?.kind === "not_found") {
					/* The loop is over for good, so its entry must go too: a later
					 * `watch()` that found it would only bump `count` and never
					 * start a loop again (review round 1, R1-4). Only this loop's
					 * own entry — a newer one under the same id is left alone. */
					if (watchers.get(communityId)?.stop.signal === stop)
						watchers.delete(communityId);
					return;
				}
				const wait =
					failure?.kind === "rate_limited" && failure.retryAfterMs !== null
						? failure.retryAfterMs
						: backoff;
				backoff = Math.min(backoff * 2, EVENTS_BACKOFF_MS.max);
				await sleep(wait, stop);
			}
		}
	}

	function applyEvents(
		communityId: string,
		events: readonly { type: string; conversation_id?: string }[],
	) {
		const kinds = new Set(events.map((event) => event.type));
		const conversations = new Set(
			events
				.filter((event) => event.type === "conversation_changed")
				.map((event) => event.conversation_id)
				.filter((id): id is string => Boolean(id)),
		);
		for (const conversationId of conversations) {
			if (
				store.getState().threads[conversationKey(communityId, conversationId)]
			)
				void actions.refreshThread(communityId, conversationId);
		}
		if (kinds.has("unread_changed") || kinds.has("membership_changed")) {
			void actions.loadChannels(communityId);
			void actions.loadDirects(communityId);
		}
		if (kinds.has("request_changed")) void actions.loadRequests(communityId);
		if (kinds.has("approval_changed")) void actions.loadApprovals(communityId);
		if (kinds.has("community_changed") || kinds.has("membership_changed")) {
			void actions.loadCommunities();
			void actions.loadBootstrap(communityId);
		}
	}

	async function refetchViews(communityId: string) {
		const tasks: Promise<unknown>[] = [
			actions.loadBootstrap(communityId),
			actions.loadChannels(communityId),
			actions.loadDirects(communityId),
		];
		const state = store.getState();
		if (state.requests[communityId])
			tasks.push(actions.loadRequests(communityId));
		if (state.approvals[communityId])
			tasks.push(actions.loadApprovals(communityId));
		for (const key of Object.keys(state.threads)) {
			const [cid, conversationId] = key.split("/");
			if (cid === communityId && conversationId)
				tasks.push(actions.refreshThread(communityId, conversationId));
		}
		await Promise.allSettled(tasks);
	}

	const actions = {
		async loadCommunities(): Promise<void> {
			const previous = store.getState().communities;
			store.setState({
				communities: { ...previous, state: "loading", error: null },
			});
			try {
				const list = await client().listCommunities();
				if (closed) return;
				store.setState({
					communities: {
						state: "ready",
						data: { joined: list.joined, featured: list.featured },
						error: null,
					},
				});
				/* Each joined community's channel list carries the unread counts
				 * its switcher row shows. One read per joined community; the RFC
				 * keeps joined lists small (search past 6). */
				await Promise.allSettled(
					list.joined.flatMap((community) => [
						actions.loadChannels(community.id),
						actions.loadDirects(community.id),
					]),
				);
			} catch (error) {
				if (closed) return;
				store.setState({
					communities: { ...previous, state: "error", error: asError(error) },
				});
			}
		},

		loadBootstrap(communityId: string) {
			return load("bootstraps", communityId, null, () =>
				client().bootstrap(communityId),
			);
		},

		/**
		 * Join by explicitly accepting `version`. A 409 `guidelines_changed`
		 * means the text the person read is no longer current: reload the
		 * bootstrap so the dialog shows the new text, and report `changed` so it
		 * asks for acceptance again rather than joining on a version they did
		 * not see.
		 */
		async join(
			communityId: string,
			version: string,
		): Promise<"joined" | "changed" | CommunityError | null> {
			try {
				const bootstrap = await client().join(communityId, version);
				if (closed) return null;
				patch("bootstraps", communityId, {
					state: "ready",
					data: bootstrap,
					error: null,
				});
				void actions.loadCommunities();
				return "joined";
			} catch (error) {
				const failure = asError(error);
				if (failure?.kind === "guidelines_changed") {
					await actions.loadBootstrap(communityId);
					return "changed";
				}
				return failure;
			}
		},

		loadChannels(communityId: string) {
			return load("channels", communityId, [] as Channel[], () =>
				client()
					.channels(communityId, { filter: "joined" })
					.then((page) => page.items),
			);
		},

		loadDirects(communityId: string) {
			return load("directs", communityId, [] as DirectConversation[], () =>
				client().directConversations(communityId),
			);
		},

		async loadThread(communityId: string, conversationId: string) {
			const key = conversationKey(communityId, conversationId);
			setThread(key, { state: "loading", error: null });
			try {
				const page = await client().messages(communityId, conversationId);
				if (closed) return;
				/* Read what is held AFTER the await: a `loadOlder` may have landed
				 * meanwhile, and its page must survive this refresh. */
				const held = store.getState().threads[key] ?? emptyThread();
				const next = replaceNewestWindow(
					held.messages,
					page.items,
					!page.next_cursor,
				);
				setThread(key, {
					state: "ready",
					messages: next.messages,
					/* Keep the deeper cursor while older pages are still held. */
					olderCursor: next.keptOlder ? held.olderCursor : page.next_cursor,
				});
			} catch (error) {
				if (closed) return;
				setThread(key, { state: "error", error: asError(error) });
			}
		},

		/**
		 * A refresh after an event or a publish. The newest page REPLACES the
		 * window it covers, so a message deleted, removed or cut off by a block
		 * since the last read leaves the screen (`replaceNewestWindow`).
		 */
		refreshThread(communityId: string, conversationId: string) {
			return actions.loadThread(communityId, conversationId);
		},

		async loadOlder(communityId: string, conversationId: string) {
			const key = conversationKey(communityId, conversationId);
			const thread = store.getState().threads[key];
			if (!thread?.olderCursor || thread.loadingOlder) return;
			setThread(key, { loadingOlder: true, olderError: null });
			try {
				const page = await client().messages(
					communityId,
					conversationId,
					thread.olderCursor,
				);
				if (closed) return;
				const current = store.getState().threads[key] ?? emptyThread();
				setThread(key, {
					loadingOlder: false,
					messages: mergeMessages(current.messages, page.items),
					olderCursor: page.next_cursor,
				});
			} catch (error) {
				if (closed) return;
				setThread(key, { loadingOlder: false, olderError: asError(error) });
			}
		},

		/** Advance read state to the newest seq held; best effort (its own interaction window). */
		async markRead(communityId: string, conversationId: string) {
			const thread =
				store.getState().threads[conversationKey(communityId, conversationId)];
			const newest = thread?.messages.at(-1);
			if (!newest) return;
			try {
				const unread = await client().markRead(
					communityId,
					conversationId,
					newest.seq,
				);
				if (closed) return;
				const channels = store.getState().channels[communityId];
				if (channels?.data.some((c) => c.id === conversationId)) {
					patch("channels", communityId, {
						...channels,
						data: channels.data.map((c) =>
							c.id === conversationId ? { ...c, unread } : c,
						),
					});
				}
			} catch {
				/* Read state is advisory; the next event or open retries it. */
			}
		},

		setDraft(communityId: string, conversationId: string, text: string) {
			const key = conversationKey(communityId, conversationId);
			store.setState((s) => ({ drafts: { ...s.drafts, [key]: text } }));
			/* Editing the text after an outcome starts a new attempt on Send. */
			const attempt = store.getState().attempts[key];
			if (attempt && attempt.state.kind !== "checking" && attempt.text !== text)
				setAttempt(key, undefined);
		},

		/** Send the current draft as a NEW attempt (a fresh idempotency key). */
		async send(
			communityId: string,
			conversationId: string,
			threadRootId: string | null = null,
		): Promise<void> {
			const key = conversationKey(communityId, conversationId);
			const text = (store.getState().drafts[key] ?? "").trim();
			const current = store.getState().attempts[key];
			if (!text || current?.state.kind === "checking") return;
			/* Same text, retryable outcome: Send is a Retry and keeps the key. */
			if (current && current.text === text && retryKeepsKey(current.state))
				return actions.retry(communityId, conversationId);
			const attempt: Attempt = {
				key: await newKey(),
				text,
				threadRootId,
				state: { kind: "checking" },
			};
			await submit(communityId, conversationId, attempt);
		},

		/** Retry under the SAME key (no double moderation, no double charge). */
		async retry(communityId: string, conversationId: string): Promise<void> {
			const key = conversationKey(communityId, conversationId);
			const attempt = store.getState().attempts[key];
			if (!attempt || !retryKeepsKey(attempt.state)) return;
			if (attempt.state.kind === "limited" && attempt.state.retryAt > now())
				return;
			await submit(
				communityId,
				conversationId,
				attempt.rekey
					? { ...attempt, key: await newKey(), rekey: false }
					: attempt,
			);
		},

		/**
		 * Best-effort Cancel. The server decides: `cancelled` before commit, or
		 * the stored outcome when it already settled ("if it already posted, you
		 * see it posted"). A 404 means the attempt never claimed its key, so
		 * stopping the upload here leaves nothing behind.
		 */
		async cancel(communityId: string, conversationId: string): Promise<void> {
			const key = conversationKey(communityId, conversationId);
			const attempt = store.getState().attempts[key];
			if (attempt?.state.kind !== "checking") return;
			try {
				const outcome = await client().cancelSubmission(
					communityId,
					attempt.key,
				);
				inflight.get(attempt.key)?.abort();
				settle(
					communityId,
					conversationId,
					attempt,
					outcome.state,
					outcome.refusal,
				);
			} catch (error) {
				const failure = asError(error);
				if (failure?.kind === "not_found") {
					inflight.get(attempt.key)?.abort();
					setAttempt(key, { ...attempt, state: { kind: "cancelled" } });
				}
				/* Anything else: the send is still running and will settle itself. */
			}
		},

		dismissAttempt(communityId: string, conversationId: string) {
			const key = conversationKey(communityId, conversationId);
			if (store.getState().attempts[key]?.state.kind === "checking") return;
			setAttempt(key, undefined);
		},

		loadRequests(communityId: string) {
			return load("requests", communityId, [] as CommunityRequest[], () =>
				client().requests(communityId, { kind: "dm" }),
			);
		},

		async answerRequest(
			communityId: string,
			request: CommunityRequest,
			answer: "accept" | "decline" | "block",
		): Promise<CommunityError | null> {
			try {
				if (answer === "accept")
					await client().acceptDmRequest(communityId, request.id);
				else if (answer === "decline")
					await client().declineDmRequest(communityId, request.id);
				else {
					/* Block names the person, not the request; the request is then
					 * declined so it leaves the inbox even if the server keeps it. */
					if (request.counterpart)
						await client().block(communityId, request.counterpart.public_id);
					await client()
						.declineDmRequest(communityId, request.id)
						.catch((error) => {
							if (asError(error)?.kind !== "not_found") throw error;
						});
				}
				await Promise.allSettled([
					actions.loadRequests(communityId),
					actions.loadDirects(communityId),
				]);
				return null;
			} catch (error) {
				return asError(error);
			}
		},

		loadApprovals(communityId: string) {
			return load("approvals", communityId, [] as AgentApproval[], () =>
				client().agentApprovals(communityId),
			);
		},

		/** "Don't post": the only answer the phone gives without the draft (frame M6). */
		async declineApproval(
			communityId: string,
			approvalId: string,
		): Promise<CommunityError | null> {
			try {
				await client().answerAgentApproval(communityId, approvalId, "decline");
				await actions.loadApprovals(communityId);
				return null;
			} catch (error) {
				return asError(error);
			}
		},

		async requestDm(
			communityId: string,
			publicId: string,
		): Promise<CommunityError | null> {
			try {
				await client().createDmRequest(communityId, publicId, await newKey());
				void actions.loadRequests(communityId);
				return null;
			} catch (error) {
				return asError(error);
			}
		},

		/**
		 * One directory page for Browse. Not cached in the store: results are
		 * transient to the screen that asked, and a stale search must not leak
		 * into the next visit. Throws the classified error for the screen.
		 */
		directory(
			communityId: string,
			kind: "channels" | "people",
			query: string,
			cursor: string | null,
		): Promise<
			| { kind: "channels"; items: Channel[]; next_cursor: string | null }
			| { kind: "people"; items: Profile[]; next_cursor: string | null }
		> {
			const options = { q: query.trim() || undefined, cursor };
			return kind === "channels"
				? client()
						.channels(communityId, options)
						.then((page) => ({
							kind,
							items: page.items,
							next_cursor: page.next_cursor,
						}))
				: client()
						.people(communityId, options)
						.then((page) => ({
							kind,
							items: page.items,
							next_cursor: page.next_cursor,
						}));
		},

		/** A member card for the profile sheet; approved fields only (server-side). */
		async profile(
			communityId: string,
			publicId: string,
		): Promise<Profile | CommunityError | null> {
			try {
				return await client().profile(communityId, publicId);
			} catch (error) {
				return asError(error);
			}
		},

		/** Join a public channel from Browse, then refresh the joined list. */
		/** Remember a channel opened from Browse without joining (`previews`). */
		previewChannel(communityId: string, channel: Channel) {
			store.setState((state) => ({
				previews: {
					...state.previews,
					[conversationKey(communityId, channel.id)]: channel,
				},
			}));
		},

		async joinChannel(
			communityId: string,
			channelId: string,
		): Promise<CommunityError | null> {
			try {
				await client().joinChannel(communityId, channelId);
				await actions.loadChannels(communityId);
				return null;
			} catch (error) {
				return asError(error);
			}
		},

		async block(
			communityId: string,
			publicId: string,
		): Promise<CommunityError | null> {
			try {
				await client().block(communityId, publicId);
				return null;
			} catch (error) {
				return asError(error);
			}
		},

		/** A fresh report idempotency key; the sheet holds ONE per report (`report`). */
		reportKey(): Promise<string> {
			return newKey();
		},

		/**
		 * Send one report. The CALLER owns the key (`reportKey`) and passes the
		 * same one for every submit of the same sheet: a submit whose answer was
		 * lost (`unreachable`) may already have opened a case, and a second key
		 * would open a second one (review round 1, R1-1).
		 *
		 * A DM message goes as `target_kind: "dm"` with the reporter's explicit
		 * consent and the revision they read (RFC §6.4): the case copies exactly
		 * that revision to Trust & Safety, and a `message` report of a DM is a
		 * 400 by contract.
		 */
		async report(
			communityId: string,
			input: {
				targetKind: ReportTargetKind;
				targetId: string;
				category: RefusalCategory;
				note?: string;
				dmConsent?: boolean;
				revision?: number;
				idempotencyKey: string;
			},
		): Promise<{ reference: string } | CommunityError | null> {
			try {
				const reference = await client().report(communityId, input);
				return { reference };
			} catch (error) {
				return asError(error);
			}
		},

		/**
		 * Record this app session's scope (Amendment A §3: a switch "lasts until
		 * you switch back or restart the app"). Memory only, so a restart
		 * reapplies the opening rule. Read by the Team Bridge list's opening
		 * redirect and by the switcher's check mark.
		 */
		select(selection: BridgeSelection | null) {
			store.setState({ session: selection });
		},

		/**
		 * A reader who leaves a community for the private list by its own Back
		 * (with no history to pop, so the list mounts fresh) has switched back:
		 * the next list mount must NOT apply the opening rule, or a session
		 * community (or rule 7's only community) would send them straight back
		 * into the community they just left — a Back that never goes back.
		 * One-shot: `takeOpeningHold` spends it.
		 */
		holdOpening() {
			openingHeld = true;
		},

		takeOpeningHold(): boolean {
			const held = openingHeld;
			openingHeld = false;
			return held;
		},

		/**
		 * Start (or join) the events loop for a community while a screen shows
		 * it. Returns the unwatch function; the loop stops when the last watcher
		 * leaves, so a backgrounded app holds no long-poll open.
		 */
		watch(communityId: string): () => void {
			const existing = watchers.get(communityId);
			if (existing) existing.count += 1;
			else {
				const stop = new AbortController();
				watchers.set(communityId, { count: 1, stop });
				void eventsLoop(communityId, stop.signal);
			}
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const entry = watchers.get(communityId);
				if (!entry) return;
				entry.count -= 1;
				if (entry.count <= 0) {
					entry.stop.abort();
					watchers.delete(communityId);
				}
			};
		},

		/** The account boundary: drop everything, stop every loop. */
		close() {
			closed = true;
			for (const entry of watchers.values()) entry.stop.abort();
			watchers.clear();
			for (const controller of inflight.values()) controller.abort();
			inflight.clear();
			store.setState(initialCommunityState());
		},
	};

	return { store, actions };
}

export type CommunityStore = ReturnType<typeof createCommunityStore>;

/** The switcher row data for each joined community (unread from its channel list). */
export function communityRows(
	state: Pick<CommunityState, "channels" | "directs"> & {
		communities: {
			data: Pick<CommunityState["communities"]["data"], "joined">;
		};
	},
): CommunityRow[] {
	return state.communities.data.joined.map((community) => ({
		communityId: community.id,
		name: community.name,
		readOnly: community.state === "read_only",
		unread: communityUnread(
			state.channels[community.id]?.data ?? [],
			state.directs[community.id]?.data ?? [],
		),
	}));
}
