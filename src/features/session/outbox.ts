/**
 * The durable outbox: a sent message keeps being delivered after the reader
 * leaves the conversation, switches apps, locks the phone or kills the app.
 *
 * WHY THIS EXISTS. Operator report (2026-11-15): sends kept failing on a slow
 * phone→tunnel path while the computer itself answered `/healthz` in 2 ms. The
 * composer made ONE attempt under the transport's 20 s default and then handed
 * the reader a "not confirmed — retry below" line, so a server that only needed
 * longer to answer looked like a failure, and nothing tried again unless the
 * reader came back and pressed Retry.
 *
 * WHAT IT BUILDS ON, unchanged:
 *
 * - `sendPersistedCommand` + the persisted retry envelope (`@/relay`): the
 *   envelope is held in DEVICE storage before the first byte goes out, so it
 *   already survives an app kill. Every attempt here replays that envelope —
 *   the SAME `command_id` and the same bytes — and the relay's identity ledger
 *   answers `already admitted` for an id it has seen. That de-duplication is
 *   the whole reason automatic retries are safe; this module never mints an id.
 * - The error taxonomy (`errors.ts`): whether a failure leaves delivery unknown
 *   (`envelope: "keep"`) or is a definitive pre-admission refusal (`"clear"`) is
 *   read from `RelayError`, never re-derived. See `outboxVerdict`.
 * - The pending echo (`pending-echo.ts`): the row painted the instant the
 *   envelope is held. The outbox re-captions it (`waiting`/`exhausted`) instead
 *   of inventing a second row.
 *
 * THE LIFECYCLE of one send:
 *
 * 1. The composer calls `deliver`. The first attempt is ATTACHED: its outcome
 *    goes back to the composer exactly as before for success and for every
 *    failure the composer already words (a definitive refusal, a storage
 *    failure), so those flows are unchanged.
 * 2. A failure that leaves delivery unknown or is temporary (timeout, transport
 *    loss, computer offline, gateway busy) does NOT come back as an error: the
 *    composer gets `{kind: "background"}`, the row reads "waiting for your
 *    computer", and the outbox owns the send from here on.
 * 3. Before every later attempt the outbox RECONCILES: it reads the newest
 *    transcript page and, if a user row with this `command_id` is there, the
 *    command landed and only its acknowledgement was lost — the envelope is
 *    settled as acknowledged without another POST. Otherwise it replays the
 *    same envelope (a de-duplicated replay is free if it did land meanwhile).
 * 4. It stops on: an acknowledgement (delivered), a definitive refusal (the row
 *    becomes the existing `refused` row — tap to put back), a failure only the
 *    reader can resolve, the keep-trying window running out (the row offers
 *    Retry and Discard; the envelope is KEPT), or the reader's Discard.
 *
 * ONE SEND PER CONVERSATION AT A TIME, on purpose. The envelope store has one
 * slot per session, and a second, different instruction minted while the first
 * may already be admitted is the duplicate-or-reorder hazard the slot exists to
 * prevent. So while the outbox owns a session's send, that composer's primary is
 * disabled with a sentence saying why; every OTHER conversation is unaffected.
 *
 * PLATFORM LIMITS — said plainly, because they bound what "in the background"
 * means here:
 *
 * - iOS suspends a backgrounded app's JavaScript within seconds. Without
 *   `UIApplication.beginBackgroundTask` (~30 s of grace) or a background
 *   `URLSession` (transfers the OS completes for a suspended or killed app), no
 *   JS timer or `fetch` keeps running. Neither is exposed by any module this app
 *   ships: `expo-task-manager` only hosts tasks other modules start, and
 *   `expo-background-task`/`expo-background-fetch` are not dependencies (and
 *   are scheduled by the OS opportunistically, minutes to hours later — no use
 *   for a message in flight). True kill-survival of an in-flight POST would need
 *   a native module wrapping a background `URLSession`; that is NOT built here.
 *   What IS built: the send survives suspension and kill as a persisted
 *   envelope; on the next foreground (`onForeground`) or launch (`resume`) it is
 *   tried again at once; and when the OS wakes a SUSPENDED (still-alive)
 *   process for a silent push (`remote-notification`, ~30 s),
 *   `drainForBackgroundWake` uses that window. A KILLED process woken by a
 *   push has no jobs until `OutboxHost` mounts with a usable client and
 *   resumes the ledger, which a headless wake may not reach, so the wake is
 *   only a bonus for a live process; the relaunch resume is the guarantee
 *   (agent review round 1, R4).
 * - Android does not freeze a backgrounded process's JS immediately, so the
 *   retry loop simply keeps running until the process is killed or Doze cuts
 *   the network; kill and relaunch then resume from the envelope as on iOS.
 *
 * Node-safe: no `react-native` import, so the whole lifecycle is tested against
 * a real loopback HTTP relay (`outbox.http.test.ts`).
 */

import { useSyncExternalStore } from "react";
import {
	markPendingEchoAccepted,
	pendingEchoFor,
	projectedCommandIds,
	refusePendingEcho,
	registerPendingEcho,
	setPendingEchoOutbox,
} from "@/features/session/pending-echo";
import {
	type ContinuationEnvelope,
	isRelayError,
	type RelayEndpoints,
	RelayError,
	type RetryEnvelopeStore,
	type SendCommandInput,
	type SendResult,
	sendPersistedCommand,
	transportError,
} from "@/relay";

/**
 * The retry budget. The AGENTS.md rule is "no cap without the distribution it
 * bounds"; no phone-side latency distribution for the tunnel path exists yet, so
 * each number is anchored to the SERVER's own deadlines instead, cited here:
 *
 * - `attemptTimeoutMs` 60 s. The relay itself may hold a prompt before it
 *   answers for up to `SESSION_START_TIMEOUT_S` = 30 s (local-operator
 *   `mobile/daemon.py`: adopting or spawning the runtime of a cold
 *   conversation) plus `ACK_TIMEOUT_S` = 15 s (`mobile/attach_client.py`: the
 *   owner's acknowledgement, which waits on the turn lock) — 45 s that are the
 *   server working, not failing. The transport's 20 s default cut that path off
 *   and reported an unknown outcome for a prompt still being admitted, which is
 *   the reported symptom. The extra 15 s is an allowance for the tunnel/edge
 *   round trip on a slow cellular link — an allowance, not a measurement.
 * - `firstRetryMs` 2 s doubling to `maxRetryMs` 30 s. The connector renews its
 *   30 s lease on a 10 s poll (`errors.ts`, `defaultRetryFor`), so a
 *   `computer-offline`/gateway refusal clears within ~10–30 s; at the cap a
 *   returning computer is noticed within one lease. Jitter is "equal jitter" —
 *   a delay in [d/2, d] — so retries from several conversations after one
 *   network blip do not land together, and no retry is ever immediate.
 * - `keepTryingMs` 15 min. A PRODUCT bound, not a measurement: past it the row
 *   asks the reader (Retry / Discard) instead of retrying silently. The
 *   envelope is kept (its own TTL is 24 h), and the window restarts on Retry,
 *   on the next foreground, and on the next launch.
 */
export const OUTBOX_POLICY = Object.freeze({
	attemptTimeoutMs: 60_000,
	firstRetryMs: 2_000,
	maxRetryMs: 30_000,
	keepTryingMs: 15 * 60_000,
});

export interface OutboxPolicy {
	attemptTimeoutMs: number;
	firstRetryMs: number;
	maxRetryMs: number;
	keepTryingMs: number;
}

/** How long a silent-push wake may spend on the outbox. iOS gives a
 *  `content-available` handler about 30 s before it is suspended; 25 s leaves
 *  the badge clear that shares the wake its own margin. */
export const OUTBOX_WAKE_BUDGET_MS = 25_000;

/**
 * The delay before retry number `failures` (1-based), in ms.
 *
 * A server's `Retry-After` is honoured as a FLOOR (it knows better than our
 * curve), but never stretched past the keep-trying window.
 */
export function retryDelayMs(
	failures: number,
	random: () => number,
	policy: OutboxPolicy = OUTBOX_POLICY,
	retryAfterMs?: number,
): number {
	const exponent = Math.max(0, failures - 1);
	const ceiling = Math.min(
		policy.maxRetryMs,
		policy.firstRetryMs * 2 ** exponent,
	);
	const jittered = ceiling / 2 + random() * (ceiling / 2);
	const floor = Math.min(retryAfterMs ?? 0, policy.keepTryingMs);
	return Math.round(Math.max(jittered, floor));
}

/**
 * What the outbox does with one failed attempt, read off the taxonomy's own
 * verdicts rather than a second table:
 *
 * - `retry` — delivery is unknown or the refusal is upstream and temporary
 *   (`envelope: "keep"` and an automatic retry is allowed): replay the same id.
 * - `refused` — a definitive pre-admission refusal (`envelope: "clear"`): the
 *   relay did not take it, the envelope is already discarded, stop.
 * - `stop` — the envelope is kept but no automatic retry can help (a storage
 *   failure, a rejected certificate, an earlier unresolved instruction), or the
 *   identity that owned the storage is gone (`clear-all`, a 401). The reader
 *   decides.
 */
export function outboxVerdict(error: RelayError): "retry" | "refused" | "stop" {
	if (error.envelope === "clear") return "refused";
	if (error.envelope === "clear-all") return "stop";
	return error.retry === "never" ? "stop" : "retry";
}

/** What the composer's `deliver` resolves to. */
export type OutboxOutcome =
	| { kind: "delivered"; result: SendResult }
	/** The first attempt failed with an unknown or temporary outcome; the
	 *  outbox owns the send now and reports through the pending row. */
	| { kind: "background"; commandId: string };

/** One send the outbox owns, as the screens read it. */
export interface OutboxEntry {
	sessionId: string;
	/** `null` only before the envelope is held (the first instants). */
	commandId: string | null;
	/** `sending` — the composer's first attempt; `waiting` — the outbox is
	 *  retrying (an attempt may be on the wire); `failed` — it stopped and the
	 *  row offers Retry / Discard; `discarding` — the reader tapped Discard
	 *  while an attempt was on the wire, and the job lingers only until that
	 *  attempt settles (the envelope slot stays reserved so a new instruction
	 *  cannot race the old one), with nothing left for the reader to do. */
	phase: "sending" | "waiting" | "failed" | "discarding";
	/** Attempts made so far in this keep-trying window. */
	attempts: number;
	/** When the next attempt is scheduled, or `null`. */
	nextAttemptAt: number | null;
}

/** The composer's input: `sendPersistedCommand`'s, minus the deadline, which is
 *  the outbox's policy. */
export type OutboxSendInput = Omit<SendCommandInput, "timeoutMs">;

/**
 * Which sessions the outbox owns, persisted, so a relaunch resumes exactly
 * those. Why not "every held envelope": the startup coordinator
 * (`new-session/startup-coordinator.ts`) keeps its OWN durable queue in the
 * same envelope slots for a new conversation's first messages, and an envelope
 * the composer kept after a failure the outbox did not take (a storage fault)
 * is the composer's retained-retry card. Resuming those would put a second
 * sender on a queue another owner drains. The value is only a session id —
 * nothing a reader wrote — and it lives under the scoped private-storage
 * family `lo-mobile-outbox:`, purged at sign-out with the envelopes.
 * Best effort: a failed write costs only the relaunch resume, and the
 * composer's retained-retry card still offers the same envelope.
 */
export interface OutboxLedger {
	add(sessionId: string): Promise<void>;
	remove(sessionId: string): Promise<void>;
}

/** The ledger's key family (see `OutboxLedger`). */
export const OUTBOX_KEY_PREFIX = "lo-mobile-outbox:";

/** A loaded session's held envelope, for `resume`. */
export interface HeldSession {
	sessionId: string;
	envelopes: RetryEnvelopeStore;
}

type CommandClient = Pick<RelayEndpoints, "command" | "history">;

export interface OutboxDeps {
	policy?: OutboxPolicy;
	now?: () => number;
	random?: () => number;
	setTimer?: (run: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	/**
	 * Did the session write a row for this command? `true` only on positive
	 * evidence; any read failure is `false`, which falls through to a
	 * de-duplicated replay — never to a discard.
	 */
	reconcile?: (
		client: CommandClient,
		sessionId: string,
		commandId: string,
	) => Promise<boolean>;
}

/** The newest transcript page, as a cheap first check: a user row is written
 *  at admission, before any reply, so a recent send is usually on it. It is
 *  NOT guaranteed — a relaunch resume can run up to the envelope's 24 h TTL
 *  later, and a busy turn can push the row past 50 entries. Safety does not
 *  depend on it: a miss falls through to a same-id replay, and the relay
 *  answers `already admitted` for any id durably in its transcript
 *  (`command_reservation.py`). (Agent review round 1, R7.) */
const RECONCILE_PAGE = 50;

async function transcriptCarries(
	client: CommandClient,
	sessionId: string,
	commandId: string,
): Promise<boolean> {
	try {
		const page = await client.history(sessionId, { limit: RECONCILE_PAGE });
		return projectedCommandIds(page.entries).has(commandId);
	} catch {
		return false;
	}
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

interface Job {
	entry: OutboxEntry;
	envelopes: RetryEnvelopeStore;
	/** The client the composer sent with; used when the host has none. */
	client: CommandClient | null;
	/** The composer's draft identity while the first attempt is attached, so a
	 *  double tap joins it instead of being refused. */
	payload: string | null;
	/** The composer awaiting the first attempt; `null` once detached. */
	attached: Deferred<OutboxOutcome> | null;
	since: number;
	failures: number;
	timer: unknown;
	running: boolean;
	cancelled: boolean;
	/** Resolves whenever an attempt finishes; awaited by `discard` and drains. */
	idle: Promise<void>;
	markIdle: () => void;
}

function payloadOf(input: OutboxSendInput): string {
	return JSON.stringify([
		input.envelope?.command_id ?? null,
		input.op,
		input.text,
		(input.images ?? []).map((image) => [image.mime_type, image.data_b64]),
		input.input_mode ?? null,
		input.input_path ?? null,
		input.expand_skills === true,
	]);
}

/** Refusal for a DIFFERENT instruction while the outbox owns this session's
 *  send. The composer's disabled primary normally prevents it; this is the
 *  structural guard behind it. Worded like `send-command.ts`'s own. */
function outboxBusy(sessionId: string): RelayError {
	return new RelayError(
		"ambiguous-delivery",
		"an earlier instruction on this session is still being delivered, so this one was not sent",
		{
			diagnostic: `the outbox owns an unresolved send for session ${sessionId}`,
			retry: "never",
			envelope: "keep",
		},
	);
}

export class Outbox {
	private readonly policy: OutboxPolicy;
	private readonly now: () => number;
	private readonly random: () => number;
	private readonly setTimer: (run: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	private readonly reconcile: NonNullable<OutboxDeps["reconcile"]>;
	private readonly jobs = new Map<string, Job>();
	private readonly listeners = new Set<() => void>();
	private client: CommandClient | null = null;
	private ledger: OutboxLedger | null = null;
	/** Rebuilt on every change so `useSyncExternalStore` sees a new identity. */
	private snapshot: ReadonlyMap<string, OutboxEntry> = new Map();

	constructor(deps: OutboxDeps = {}) {
		this.policy = deps.policy ?? OUTBOX_POLICY;
		this.now = deps.now ?? Date.now;
		this.random = deps.random ?? Math.random;
		this.setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
		this.clearTimer =
			deps.clearTimer ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.reconcile = deps.reconcile ?? transcriptCarries;
	}

	/* ------------------------------------------------------------ reading */

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	entries = (): ReadonlyMap<string, OutboxEntry> => this.snapshot;

	entryFor(sessionId: string): OutboxEntry | null {
		return this.snapshot.get(sessionId) ?? null;
	}

	/** Whether the outbox owns a send for this session (any phase). */
	owns(sessionId: string): boolean {
		return this.jobs.has(sessionId);
	}

	/** The live client, set by the host whenever the route's client changes. A
	 *  retry always uses the CURRENT one: a renewed credential or a switched
	 *  route replaces the endpoints object the composer sent with. */
	setClient(client: CommandClient | null): void {
		this.client = client;
	}

	/** The persisted ownership ledger for the current identity (see
	 *  `OutboxLedger`); `null` while there is none. */
	setLedger(ledger: OutboxLedger | null): void {
		this.ledger = ledger;
	}

	/** Write or drop the ownership mark. Returns the write so the first attempt
	 *  can await it (see `attempt`); every other caller fires and forgets. */
	private note(sessionId: string, owned: boolean): Promise<void> {
		const ledger = this.ledger;
		if (ledger === null) return Promise.resolve();
		return (owned ? ledger.add(sessionId) : ledger.remove(sessionId)).catch(
			() => undefined,
		);
	}

	/* ------------------------------------------------------------ sending */

	/**
	 * Send one instruction through the outbox. Resolves `delivered` or
	 * `background` (see the header); rejects with the composer's own errors for
	 * a first attempt that failed definitively or needs the reader.
	 */
	deliver(input: OutboxSendInput): Promise<OutboxOutcome> {
		const existing = this.jobs.get(input.sessionId);
		if (existing) {
			const sameCommand =
				input.envelope !== undefined &&
				existing.entry.commandId === input.envelope.command_id;
			const sameDraft = existing.payload === payloadOf(input);
			if (!sameCommand && !sameDraft)
				return Promise.reject(outboxBusy(input.sessionId));
			/* The composer's Retry on a send the outbox already owns: one attempt
			 * now (a stopped one restarts its window) rather than a parallel loop. */
			if (existing.attached) return existing.attached.promise;
			this.retryNow(input.sessionId);
			return Promise.resolve({
				kind: "background",
				commandId: existing.entry.commandId ?? "",
			});
		}
		const job = this.createJob(input.sessionId, input.envelopes, {
			client: input.client as CommandClient,
			commandId: input.envelope?.command_id ?? null,
			phase: "sending",
			payload: payloadOf(input),
		});
		const attached = deferred<OutboxOutcome>();
		job.attached = attached;
		void this.attempt(job, input);
		return attached.promise;
	}

	/**
	 * Pick up the given sessions' held envelopes (the ledger's marks) that no
	 * job in this process owns — after a launch, or when a route becomes
	 * usable. The row is repainted from the envelope's own bytes (the echo
	 * store is memory-only), then an attempt starts at once.
	 */
	async resume(held: readonly HeldSession[]): Promise<void> {
		for (const { sessionId, envelopes } of held) {
			if (this.jobs.has(sessionId)) continue;
			let envelope: ContinuationEnvelope | null;
			try {
				envelope = await envelopes.peek(sessionId);
			} catch {
				continue;
			}
			/* Re-checked after the await: the composer may have started a send. */
			if (this.jobs.has(sessionId)) continue;
			if (envelope === null) {
				/* Delivered, discarded or expired elsewhere: a stale mark. */
				this.note(sessionId, false);
				continue;
			}
			/* A row the composer left as a FAILURE ("not confirmed — retry below")
			 *  is replaced, not re-captioned: the outbox is the retry now. */
			const painted = pendingEchoFor(sessionId, envelope.command_id);
			if (painted === undefined || painted.failure !== undefined) {
				registerPendingEcho(sessionId, {
					commandId: envelope.command_id,
					text: envelope.text,
					imageCount: envelope.images?.length ?? 0,
					op: envelope.op,
					accepted: false,
					outbox: "waiting",
					...(envelope.images && envelope.images.length > 0
						? { images: envelope.images }
						: {}),
				});
			} else {
				setPendingEchoOutbox(sessionId, envelope.command_id, "waiting");
			}
			const job = this.createJob(sessionId, envelopes, {
				client: null,
				commandId: envelope.command_id,
				phase: "waiting",
				payload: null,
			});
			void this.attempt(job);
		}
	}

	/** Attempt now: skips a pending backoff, and restarts a stopped send with a
	 *  fresh keep-trying window. A no-op while an attempt is on the wire. */
	retryNow(sessionId: string): void {
		const job = this.jobs.get(sessionId);
		if (!job || job.running || job.cancelled || job.attached) return;
		if (job.timer !== null) this.clearTimer(job.timer);
		job.timer = null;
		if (job.entry.phase === "failed") {
			job.since = this.now();
			job.failures = 0;
			job.entry = { ...job.entry, phase: "waiting", attempts: 0 };
			if (job.entry.commandId)
				setPendingEchoOutbox(sessionId, job.entry.commandId, "waiting");
			this.emit();
		}
		void this.attempt(job);
	}

	/**
	 * The app came back to the foreground. Time spent suspended was not time
	 * spent trying, so each waiting send gets a fresh window and one attempt
	 * now. A send that already stopped stays stopped: the reader was told.
	 */
	onForeground(): void {
		for (const [sessionId, job] of this.jobs) {
			if (job.entry.phase !== "waiting") continue;
			job.since = this.now();
			job.failures = 0;
			this.retryNow(sessionId);
		}
	}

	/**
	 * The OS woke the app in the background (a silent push). Spend at most
	 * `budgetMs` of that window: nudge every waiting send, then wait until no
	 * attempt is on the wire. Never throws; returns early when idle.
	 */
	async drainForBackgroundWake(
		budgetMs: number = OUTBOX_WAKE_BUDGET_MS,
	): Promise<void> {
		if (this.jobs.size === 0) return;
		this.onForeground();
		const deadline = this.now() + budgetMs;
		while (this.now() < deadline) {
			const running = [...this.jobs.values()].filter((job) => job.running);
			if (running.length === 0) return;
			const remaining = deadline - this.now();
			let handle: unknown = null;
			await Promise.race([
				Promise.all(running.map((job) => job.idle)),
				new Promise<void>((resolve) => {
					handle = this.setTimer(resolve, remaining);
				}),
			]);
			if (handle !== null) this.clearTimer(handle);
		}
	}

	/**
	 * The reader's Discard. Stops retrying and drops the envelope; the row
	 * becomes a `discarded` row whose tap puts the words back in the composer
	 * (UX round 1, U2), because the envelope was the text's only other copy.
	 *
	 * VISIBLE AT ONCE (UX round 1, U1): the row and the entry change
	 * synchronously, before any await, so the tap never looks ignored. An
	 * attempt already on the wire cannot be aborted (`RelayEndpoints.command`
	 * takes no `AbortSignal`), so the job lingers as `discarding` until it
	 * settles: should it land, the message WAS delivered, the row turns `sent`
	 * and the transcript shows it — the truth beats the discard. Every await in
	 * `attempt` re-checks `cancelled`, so no NEW POST starts after the tap
	 * (agent review round 1, R1).
	 */
	async discard(sessionId: string): Promise<void> {
		const job = this.jobs.get(sessionId);
		if (!job || job.cancelled) return;
		job.cancelled = true;
		if (job.timer !== null) this.clearTimer(job.timer);
		job.timer = null;
		if (job.entry.commandId !== null)
			setPendingEchoOutbox(sessionId, job.entry.commandId, "discarded");
		if (job.running) {
			job.entry = { ...job.entry, phase: "discarding", nextAttemptAt: null };
			this.emit();
			await job.idle;
			/* Delivered while we waited: `attempt` already finished the job. */
			if (this.jobs.get(sessionId) !== job) return;
		}
		await this.finalizeDiscard(job);
	}

	/** The identity changed (sign-out, account switch): forget every job without
	 *  touching storage — clearing scoped storage is the auth layer's job. A
	 *  composer still awaiting is released with `background`. */
	abandonAll(): void {
		for (const job of this.jobs.values()) {
			job.cancelled = true;
			if (job.timer !== null) this.clearTimer(job.timer);
			job.attached?.resolve({
				kind: "background",
				commandId: job.entry.commandId ?? "",
			});
			job.attached = null;
		}
		this.jobs.clear();
		this.emit();
	}

	/* ------------------------------------------------------------ internals */

	private createJob(
		sessionId: string,
		envelopes: RetryEnvelopeStore,
		init: {
			client: CommandClient | null;
			commandId: string | null;
			phase: OutboxEntry["phase"];
			payload: string | null;
		},
	): Job {
		const job: Job = {
			entry: {
				sessionId,
				commandId: init.commandId,
				phase: init.phase,
				attempts: 0,
				nextAttemptAt: null,
			},
			envelopes,
			client: init.client,
			payload: init.payload,
			attached: null,
			since: this.now(),
			failures: 0,
			timer: null,
			running: false,
			cancelled: false,
			idle: Promise.resolve(),
			markIdle: () => {},
		};
		this.jobs.set(sessionId, job);
		this.emit();
		return job;
	}

	private async attempt(job: Job, first?: OutboxSendInput): Promise<void> {
		if (job.cancelled || job.running) return;
		const sessionId = job.entry.sessionId;
		job.running = true;
		job.timer = null;
		const idle = deferred<void>();
		job.idle = idle.promise;
		job.markIdle = () => idle.resolve();
		job.entry = {
			...job.entry,
			attempts: job.entry.attempts + 1,
			nextAttemptAt: null,
		};
		this.emit();
		try {
			/* Custody BEFORE the first byte (QA round 1, Q1): the composer's
			 * attached attempt can run for the whole 60 s deadline, and iOS may
			 * suspend and kill the app inside it. Marking only at hand-off left
			 * such a send with a held envelope but no mark, so the relaunch never
			 * resumed it. Awaited (a few ms of device storage) so the mark is on
			 * disk before the POST; a kill before the envelope is held leaves a
			 * mark with no envelope, which `resume` drops as stale. `finish`
			 * removes it on every terminal outcome. */
			if (first) await this.note(sessionId, true);
			const client = first ? job.client : (this.client ?? job.client);
			if (client === null) {
				/* No usable route right now (reconnecting, minting): a temporary
				 * state like any other, so wait and try again. */
				this.afterFailure(job, null);
				return;
			}
			let input: SendCommandInput;
			if (first) {
				input = {
					...first,
					timeoutMs: this.policy.attemptTimeoutMs,
					onHeld: (envelope) => {
						job.entry = { ...job.entry, commandId: envelope.command_id };
						this.emit();
						first.onHeld?.(envelope);
					},
				};
			} else {
				const held = await this.heldEnvelope(job);
				if (held === null) return;
				/* Discarded during an await: stop here and let `discard` finalize.
				 * Checked after EVERY await before the POST (agent review round 1,
				 * R1): a history read on a slow link can take the transport's 20 s,
				 * and a Discard inside it must not be followed by a fresh POST. */
				if (job.cancelled) return;
				/* Did the previous, unanswered attempt land? Positive evidence
				 * settles it with no second POST. */
				if (await this.reconcile(client, sessionId, held.command_id)) {
					await job.envelopes
						.settle(sessionId, { kind: "ack" })
						.catch(() => undefined);
					markPendingEchoAccepted(sessionId, held.command_id, held.op);
					this.finish(job);
					return;
				}
				if (job.cancelled) return;
				input = {
					client,
					envelopes: job.envelopes,
					sessionId,
					op: held.op,
					text: held.text,
					...(held.images ? { images: held.images } : {}),
					...(held.input_mode !== undefined
						? { input_mode: held.input_mode }
						: {}),
					...(held.input_path !== undefined
						? { input_path: held.input_path }
						: {}),
					...(held.expand_skills === true ? { expand_skills: true } : {}),
					envelope: held,
					timeoutMs: this.policy.attemptTimeoutMs,
				};
			}
			/* The last gate before the wire. `discard` finalizes. An attached
			 * first attempt is exempt: the row offers no Discard while the
			 * composer still awaits it, and the composer must get an outcome. */
			if (job.cancelled && job.attached === null) return;
			let result: SendResult;
			try {
				result = await sendPersistedCommand(input);
			} catch (cause) {
				this.afterFailure(
					job,
					isRelayError(cause) ? cause : transportError(cause, "send command"),
				);
				return;
			}
			if (job.attached) {
				/* The composer marks its own row accepted, as it always has. */
				job.attached.resolve({ kind: "delivered", result });
				job.attached = null;
			} else {
				markPendingEchoAccepted(sessionId, result.commandId, result.op);
			}
			this.finish(job);
		} finally {
			job.running = false;
			idle.resolve();
		}
	}

	/** The envelope a retry replays, re-read from storage every time: a
	 *  reconciled op swap re-holds it, and a discard, a 401 or the TTL removes
	 *  it. Gone (or replaced) means this job has nothing left to deliver. */
	private async heldEnvelope(job: Job): Promise<ContinuationEnvelope | null> {
		const sessionId = job.entry.sessionId;
		let held: ContinuationEnvelope | null;
		try {
			held = await job.envelopes.peek(sessionId);
		} catch {
			/* Unreadable storage is a failure only the reader can see past. */
			this.stop(job);
			return null;
		}
		if (held !== null && held.command_id === job.entry.commandId) return held;
		const commandId = job.entry.commandId;
		/* A row nobody resolved would otherwise read "waiting" for ever. It
		 *  becomes the `refused` row, whose tap puts the words back. */
		if (commandId !== null) {
			const echo = pendingEchoFor(sessionId, commandId);
			if (echo !== undefined && !echo.accepted)
				refusePendingEcho(sessionId, commandId);
		}
		this.finish(job);
		return null;
	}

	private afterFailure(job: Job, error: RelayError | null): void {
		const sessionId = job.entry.sessionId;
		/* Abandoned (`abandonAll`) while the attempt was out: the identity that
		 *  owned it is gone, and storage belongs to the auth layer now. */
		if (this.jobs.get(sessionId) !== job) return;
		const verdict = error === null ? "retry" : outboxVerdict(error);
		if (job.attached) {
			if (verdict !== "retry" || job.entry.commandId === null) {
				/* The composer words these, exactly as before the outbox. */
				const attached = job.attached;
				job.attached = null;
				this.finish(job);
				attached.reject(error ?? transportError(undefined, "send command"));
				return;
			}
			job.attached.resolve({
				kind: "background",
				commandId: job.entry.commandId,
			});
			job.attached = null;
			job.payload = null;
			/* Custody: from here a kill must not orphan the send. */
			this.note(sessionId, true);
		}
		if (job.cancelled) {
			void this.finalizeDiscard(job);
			return;
		}
		const commandId = job.entry.commandId;
		if (verdict === "refused" || error?.envelope === "clear-all") {
			if (commandId !== null) refusePendingEcho(sessionId, commandId);
			this.finish(job);
			return;
		}
		if (verdict === "stop") {
			this.stop(job);
			return;
		}
		job.failures += 1;
		if (this.now() - job.since >= this.policy.keepTryingMs) {
			this.stop(job);
			return;
		}
		const delay = retryDelayMs(
			job.failures,
			this.random,
			this.policy,
			error?.retryAfterMs,
		);
		job.entry = {
			...job.entry,
			phase: "waiting",
			nextAttemptAt: this.now() + delay,
		};
		if (commandId !== null)
			setPendingEchoOutbox(sessionId, commandId, "waiting");
		job.timer = this.setTimer(() => {
			job.timer = null;
			void this.attempt(job);
		}, delay);
		this.emit();
	}

	/** Stopped, envelope kept: the row offers Retry and Discard. */
	private stop(job: Job): void {
		job.entry = { ...job.entry, phase: "failed", nextAttemptAt: null };
		if (job.entry.commandId !== null)
			setPendingEchoOutbox(
				job.entry.sessionId,
				job.entry.commandId,
				"exhausted",
			);
		this.emit();
	}

	/** The row was already turned `discarded` by `discard` and stays, so its
	 *  tap can put the words back; only the job and the envelope go. */
	private async finalizeDiscard(job: Job): Promise<void> {
		const { sessionId } = job.entry;
		this.finish(job);
		await job.envelopes.clear(sessionId).catch(() => undefined);
	}

	private finish(job: Job): void {
		if (job.timer !== null) this.clearTimer(job.timer);
		job.timer = null;
		if (this.jobs.get(job.entry.sessionId) === job) {
			this.jobs.delete(job.entry.sessionId);
			/* Every terminal outcome but `stop` (which keeps the job) ends here,
			 *  so the mark goes with the job. `abandonAll` does not come here: the
			 *  identity is gone and the auth purge owns its storage. */
			this.note(job.entry.sessionId, false);
			this.emit();
		}
	}

	private emit(): void {
		const next = new Map<string, OutboxEntry>();
		for (const [sessionId, job] of this.jobs) next.set(sessionId, job.entry);
		this.snapshot = next;
		for (const listener of this.listeners) listener();
	}
}

/** The app's one outbox. Process-wide like the envelope stores and the echo
 *  store, so a send outlives the screen that started it. */
export const outbox = new Outbox();

const NO_ENTRY = (): null => null;

/** This session's outbox entry, or `null`; re-renders on change. */
export function useOutboxEntry(sessionId: string): OutboxEntry | null {
	return useSyncExternalStore(
		outbox.subscribe,
		() => outbox.entryFor(sessionId),
		NO_ENTRY,
	);
}

/** The outbox phase for a conversation-list row, as a primitive so a memoised
 *  row re-renders only when ITS phase changes. */
export function useOutboxPhase(sessionId: string): OutboxEntry["phase"] | null {
	return useSyncExternalStore(
		outbox.subscribe,
		() => outbox.entryFor(sessionId)?.phase ?? null,
		NO_ENTRY,
	);
}
