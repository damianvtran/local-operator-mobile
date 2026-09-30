/**
 * The SSE client: framing, keep-alives, the 60-second rotation, and snapshot
 * resync.
 *
 * Four rules from the contract shape everything here, and each one exists
 * because the obvious implementation gets it wrong:
 *
 * 1. **The 60-second cut is normal.** The gateway's lease
 *    (`MAX_STREAM_SECONDS = 60`, `gateway.py:34`) ends the body cleanly — no
 *    error frame, no status change — so an EOF is only *information* if it comes
 *    early. The client reopens at once with a small jitter and must not paint a
 *    reconnecting state on the boundary, because a user who sees a flash every
 *    minute learns to distrust the app.
 * 2. **Resync is by snapshot, never by replay.** The relay pushes full
 *    projections with a monotonic `version`, and nothing reads `Last-Event-ID`,
 *    so recovery is: reopen, render the seed frame the stream opens with.
 * 3. **The fence is per connection.** `version` may be compared *only* within
 *    one connection and only after its first frame: the daemon's epoch counter
 *    restarts across a reconnection, so a lower number after reconnect is a new
 *    epoch, not a stale frame. Persisting a version across connections is how a
 *    client blanks a live transcript.
 * 4. **Silence is the real failure signal.** The relay keeps the connection warm
 *    every 25 s, so a stream quiet for ~35 s has stopped working even though the
 *    socket is open. Without a watchdog the UI shows a live conversation that
 *    will never update.
 *
 * Not `EventSource`: it is absent from React Native, its retry is immediate on
 * some server-close shapes, and — the decisive reason — a `401` on a stream is
 * invisible to it, so a stale session retries forever instead of re-authenticating.
 */

import { createParser, type EventSourceMessage } from "eventsource-parser";

import {
	type Payload,
	type SchemaName,
	safeParseJsonPayload,
} from "../contracts";
import { RelayError, transportError } from "./errors";

/* The timings the client's behaviour is defined against, named so the reader can
 * match them to the sources: the relay's keep-alive (`daemon.py:105`), the
 * gateway's stream lease (`gateway.py:34`), and the point at which silence stops
 * being explainable by jitter (`ADR 0002` §4 "SSE over the 60-second lease"). */
/** A timer handle as either runtime spells it: the DOM's number, or the object
 *  Node returns. Both are injectable, so both have to be nameable. */
type TimerHandle = ReturnType<typeof setTimeout> | number;

export const KEEPALIVE_INTERVAL_MS = 25_000;
export const GATEWAY_LEASE_MS = 60_000;
export const STREAM_SILENCE_MS = 35_000;
/** An open shorter than this cannot be the lease running out, so its EOF means
 *  the gateway stopped forwarding (lease lapse or revoke) and is reported. */
export const ROTATION_MIN_OPEN_MS = 50_000;
/** Jitter on a normal rotation. Small on purpose: this is not backoff, it is
 *  de-synchronising reconnects from many devices behind one connector. */
const ROTATION_JITTER_MS = 250;
/** Backoff after a body that FAILED mid-stream (a TCP reset, a socket error). The
 *  first retry is a quarter second — imperceptible to a user, and enough to stop a
 *  reset that repeats from becoming a hot loop — doubling per consecutive failure
 *  up to the cap. A failure to OPEN still stops the loop, so this delay can never
 *  hide a relay that is gone: a retry that cannot open ends the loop there. */
export const STREAM_RETRY_BASE_MS = 250;
export const STREAM_RETRY_MAX_MS = 5_000;

/** The gap before a retry after `failures` consecutive mid-stream failures: the
 *  base doubled per failure, capped. Exported because it is an algorithm worth
 *  pinning without watching a clock — a test that timed the loop against the wall
 *  clock would be measuring the machine as much as the client. */
export function streamRetryDelayMs(failures: number): number {
	const step = Math.max(1, Math.trunc(failures));
	return Math.min(STREAM_RETRY_BASE_MS * 2 ** (step - 1), STREAM_RETRY_MAX_MS);
}

/* ------------------------------------------------------------------ framing */

/** One framed SSE event, still as text. */
export interface SseFrame {
	/** The `event:` name; `""` when the frame carried none. */
	event: string;
	/** The joined `data:` payload. */
	data: string;
	id?: string;
	/** Received-at, from the injected clock, so a test can drive rotation. */
	receivedAt: number;
}

/**
 * Turns a byte stream into frames.
 *
 * All the wire's awkwardness lives in `eventsource-parser` (fields split across
 * chunk boundaries, multiple frames per chunk, multi-line `data:`, CRLF and LF
 * terminators, `: keepalive` comments); this class owns only the byte-to-text
 * decoding and the clock. Tests feed it *literal* wire bytes — including a frame
 * split mid-field and a keep-alive — because a hand-written encoder in the test
 * would stop testing the wire.
 */
export class SseFrameReader {
	private readonly decoder = new TextDecoder("utf-8");
	private readonly pending: SseFrame[] = [];
	/** Counts keep-alives so a caller can tell "no frames because nothing changed"
	 *  from "no frames because the connection is dead". */
	private keepalives = 0;

	/** The relay's only comment is its keep-alive (`: keepalive` every 25 s,
	 *  `SSE_KEEPALIVE_S`). It is reported through `onComment`, NOT through
	 *  `onEvent` — a comment is not an event, so a counter incremented in the event
	 *  callback stays at zero and a caller reading it cannot tell a quiet stream
	 *  from a dead one. That is exactly the bug a `>= 0` assertion hid. */
	private readonly parser: {
		feed: (chunk: string) => void;
		reset: (options?: { consume?: boolean }) => void;
	};

	private readonly now: () => number;

	constructor(now: () => number = () => Date.now()) {
		this.now = now;
		this.parser = createParser({
			onComment: () => {
				this.keepalives += 1;
				this.pending.push({ event: "", data: "", receivedAt: this.now() });
			},
			onEvent: (message: EventSourceMessage) => {
				/* A block that carries fields but no data (an `id:`-only block, say) is
				 * the same signal as a comment: the relay said something and nothing
				 * changed. It is counted as liveness, and it is not a data frame. */
				if (message.event === undefined && message.data === "") {
					this.keepalives += 1;
					this.pending.push({ event: "", data: "", receivedAt: this.now() });
					return;
				}
				this.pending.push({
					event: message.event ?? "",
					data: message.data,
					id: message.id,
					receivedAt: this.now(),
				});
			},
		});
	}

	/** Feeds a chunk and returns whatever frames it completed. A partial frame
	 *  stays inside the parser; the caller gets nothing rather than half an event. */
	push(chunk: Uint8Array): SseFrame[] {
		/* `stream: true` keeps a multi-byte UTF-8 sequence split across chunks
		 * intact — a transcript carrying an emoji or a CJK character would otherwise
		 * decode as U+FFFD and corrupt the frame. */
		this.parser.feed(this.decoder.decode(chunk, { stream: true }));
		return this.drain();
	}

	/** Signals end-of-body. A frame the server left unterminated is NOT emitted:
	 *  the relay always writes a blank line, so an unterminated tail is a cut, and
	 *  emitting it would mean acting on half an event. */
	finish(): SseFrame[] {
		this.parser.feed(this.decoder.decode());
		return this.drain();
	}

	get keepaliveCount(): number {
		return this.keepalives;
	}

	private drain(): SseFrame[] {
		const out = this.pending.slice();
		this.pending.length = 0;
		return out;
	}
}

/* ----------------------------------------------------- typed frame decoding */

/** A `sessions` list frame: the same body as `GET /api/sessions`. */
export type SessionsFrame = {
	kind: "sessions";
	data: Payload<"sessionListFrame">;
};
/** One session's projection. */
export type ProjectionFrame = {
	kind: "projection";
	data: Payload<"sessionProjection">;
};
/** A keep-alive comment, or an event name this build does not read. */
export type IgnorableFrame = {
	kind: "ignorable";
	event: string;
	reason: "keepalive" | "unknown-event";
};
/** A frame that claimed one of the two known events and did not match its schema. */
export type MalformedFrame = {
	kind: "malformed";
	event: string;
	error: ReturnType<typeof safeParseJsonPayload>;
};

export type DecodedFrame =
	| SessionsFrame
	| ProjectionFrame
	| IgnorableFrame
	| MalformedFrame;

/**
 * Decodes a framed event into the payload it claims to be.
 *
 * An unknown event name is *ignorable*, not malformed: the relay's streams are
 * additive by contract, and a future third event on the session stream must not
 * tear down a working client. A frame that names a known event and fails its
 * schema IS malformed, and the caller decides — the projection store keeps the
 * last good snapshot and counts the failure rather than blanking the screen.
 */
export function decodeFrame(frame: SseFrame): DecodedFrame {
	if (frame.event === "")
		return { kind: "ignorable", event: "", reason: "keepalive" };
	if (frame.event !== "sessions" && frame.event !== "projection") {
		return { kind: "ignorable", event: frame.event, reason: "unknown-event" };
	}
	const schema: SchemaName =
		frame.event === "sessions" ? "sessionListFrame" : "sessionProjection";
	const result = safeParseJsonPayload(schema, frame.data);
	if (!result.ok) {
		/* The event name is retained so a caller can say which stream misbehaved
		 * without parsing the error. */
		const malformed: MalformedFrame = {
			kind: "malformed",
			event: frame.event,
			error: result,
		};
		return malformed;
	}
	/* The casts are needed, not decorative: `safeParseJsonPayload` returns a union
	 * over every registered schema, and the event name selected which schema ran,
	 * which the compiler cannot correlate with the result. The data was validated by
	 * that schema a line above, so the cast only names what zod already proved. */
	return frame.event === "sessions"
		? { kind: "sessions", data: result.data as Payload<"sessionListFrame"> }
		: { kind: "projection", data: result.data as Payload<"sessionProjection"> };
}

/* ---------------------------------------------------------- the version fence */

export type FenceDecision =
	| "accepted-snapshot"
	| "accepted-newer"
	| "dropped-older";

/**
 * The resync rule, as a small pure object so it can be tested without a socket.
 *
 * It holds exactly one number and one bit, which is the whole point: a client
 * that persists a version, or compares one across a reconnect, is the bug this
 * exists to prevent.
 */
export class ProjectionFence {
	private version: number | undefined;
	private awaitingSnapshot = true;

	/** Called when a connection opens (including the first one): the next frame is
	 *  authoritative regardless of its version. */
	reset(): void {
		this.awaitingSnapshot = true;
	}

	accept(version: number): FenceDecision {
		if (this.awaitingSnapshot) {
			this.awaitingSnapshot = false;
			this.version = version;
			return "accepted-snapshot";
		}
		if (this.version !== undefined && version < this.version)
			return "dropped-older";
		this.version = version;
		return "accepted-newer";
	}

	get currentVersion(): number | undefined {
		return this.version;
	}

	get needsSnapshot(): boolean {
		return this.awaitingSnapshot;
	}
}

/* ------------------------------------------------------- connection lifecycle */

export type StreamState =
	| "idle"
	| "connecting"
	| "open"
	| "rotating"
	| "stalled"
	| "closed";

export interface StreamStatus {
	state: StreamState;
	/** Which reopen this is, from 1. Surfaced for diagnostics only; no screen
	 *  shows it, which is the point of rule 1 in the file header. */
	attempt: number;
	/** How long the last connection stayed open, in ms. */
	lastOpenMs?: number;
	/** Why the last open ended: a clean EOF (rotation or an early gateway stop) or
	 *  an error. */
	lastEnd?: "eof" | "error" | "stopped";
	/** The failure that ended the last open, when one did. Carried in the STATUS
	 *  rather than through `onError` because a mid-stream failure reconnects rather
	 *  than stopping: a screen must be able to stay on "reconnecting" for a phone
	 *  that changed networks while a diagnostics surface still sees the cause. */
	lastError?: RelayError;
}

export interface SseConnectionOptions {
	/** Opens the stream. Called once per attempt; the caller builds the request,
	 *  so this module never learns which route it is on. */
	open: (signal: AbortSignal) => Promise<{
		reader: ReadableStreamDefaultReader<Uint8Array>;
		release: () => Promise<void>;
	}>;
	/** Every decoded frame, in wire order. */
	onFrame: (frame: DecodedFrame) => void;
	/** Every state change, including the `connecting` → `open` pair of each reopen.
	 *
	 *  A caller that paints every transition would flash on the minute, so a screen
	 *  should map states to a label (`rotating` is not an outage) rather than show
	 *  them. A caller that owns a `ProjectionFence` MUST call the store's
	 *  `beginStream` on EVERY `open`, not only the first: the fence is per
	 *  connection, and a reopen's seed frame carries a version unrelated to the last
	 *  connection's, so an un-reset fence would drop it as "older" and freeze the
	 *  view on stale data. `src/e2e/relay-client.e2e.test.ts` wires it this way. */
	onState?: (status: StreamStatus) => void;
	/** An error that stopped the loop. The caller decides whether to restart; this
	 *  module never retries a failure it does not understand (a 401 needs a
	 *  re-mint, a 503 needs the connection state machine). */
	onError?: (error: RelayError) => void;
	now?: () => number;
	random?: () => number;
	setTimeout?: (handler: () => void, ms: number) => TimerHandle;
	clearTimeout?: (handle: TimerHandle) => void;
	/** Overridable so the watchdog and the rotation policy are testable without
	 *  minute-long waits. */
	silenceMs?: number;
}

/**
 * One SSE stream, kept open across the gateway's lease.
 *
 * The loop is single-flight: `start()` opens, reads until EOF or failure, then
 * reopens after a jitter, until `stop()`. A clean EOF is a rotation — silent,
 * immediate, and resynced from the seed frame the relay sends — while anything
 * else ends the loop and reaches `onError`, because a client that keeps
 * reconnecting through a `401` is the failure the contract calls out by name.
 */
export class SseConnection {
	private readonly options: Required<
		Pick<SseConnectionOptions, "now" | "random" | "silenceMs">
	> &
		SseConnectionOptions;
	private controller: AbortController | undefined;
	private silenceTimer: TimerHandle | undefined;
	/** Set by the watchdog immediately before it aborts. An abort surfaces as a
	 *  rejected `read()`, indistinguishable from a socket error by its shape, so
	 *  the flag is how the read-error branch tells "we tore this down because it
	 *  went quiet" (reopen, silently) from "the transport failed" (stop, report). */
	private watchdogFired = false;
	private jitterTimer: TimerHandle | undefined;
	private running = false;
	private attempt = 0;
	/** Consecutive mid-stream failures, which space the retries out. Reset as soon
	 *  as a leg delivers a real frame. */
	private failures = 0;
	private openedAt = 0;
	private lastStatus: StreamStatus = { state: "idle", attempt: 0 };

	constructor(options: SseConnectionOptions) {
		this.options = {
			...options,
			now: options.now ?? (() => Date.now()),
			random: options.random ?? Math.random,
			silenceMs: options.silenceMs ?? STREAM_SILENCE_MS,
		};
	}

	get isRunning(): boolean {
		return this.running;
	}

	get status(): StreamStatus {
		return this.lastStatus;
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.attempt = 0;
		this.failures = 0;
		void this.run();
	}

	/** Stops the loop and aborts any open body. Safe to call twice, and safe to
	 *  call from inside a frame handler (a route switch does). */
	stop(): void {
		if (!this.running) return;
		this.running = false;
		this.clearTimers();
		this.controller?.abort();
		this.controller = undefined;
		this.emit({ ...this.lastStatus, state: "closed", lastEnd: "stopped" });
	}

	private clearTimers(): void {
		const clear = this.options.clearTimeout ?? clearTimeout;
		if (this.silenceTimer !== undefined) clear(this.silenceTimer);
		if (this.jitterTimer !== undefined) clear(this.jitterTimer);
		this.silenceTimer = undefined;
		this.jitterTimer = undefined;
	}

	private emit(status: StreamStatus): void {
		this.lastStatus = status;
		this.options.onState?.(status);
	}

	private async run(): Promise<void> {
		while (this.running) {
			this.attempt += 1;
			const controller = new AbortController();
			this.controller = controller;
			this.emit({ state: "connecting", attempt: this.attempt });

			let reader: ReadableStreamDefaultReader<Uint8Array>;
			let release: () => Promise<void>;
			try {
				const opened = await this.options.open(controller.signal);
				reader = opened.reader;
				release = opened.release;
			} catch (cause) {
				/* Opening failed. A caller that wants to retry a transient failure
				 * restarts the loop itself; this module stops so a persistent 401 cannot
				 * become an infinite reconnect. */
				const error = errorFrom(cause, "sse open");
				this.running = false;
				this.emit({ state: "closed", attempt: this.attempt, lastEnd: "error" });
				this.options.onError?.(error);
				return;
			}

			this.openedAt = this.options.now();
			this.watchdogFired = false;
			this.emit({ state: "open", attempt: this.attempt });
			this.armSilenceWatchdog(controller);
			const frames = new SseFrameReader(this.options.now);

			let ended: "eof" | "error" = "eof";
			let error: RelayError | undefined;
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					if (!this.running) break;
					if (!value) continue;
					/* Any byte at all — including a `: keepalive` comment, which the parser
					 * may surface as an empty event or may swallow — proves the path is
					 * alive, so the watchdog is reset on the CHUNK rather than on a decoded
					 * frame. Keying it on frames would declare a quiet-but-healthy stream
					 * dead the moment the parser's comment handling changed. */
					this.armSilenceWatchdog(controller);
					for (const frame of frames.push(value)) {
						/* A real frame (not a keep-alive comment, which arrives as an empty
						 * event) means this leg is genuinely working, so the next failure retries
						 * from the short delay instead of inheriting an earlier backoff. */
						if (frame.event !== "") this.failures = 0;
						this.handle(frame);
					}
				}
			} catch (cause) {
				/* A fired watchdog is a stall, not a failure: the socket looked alive and
				 * delivered nothing for longer than two keep-alive periods, and we
				 * aborted it. Treating the resulting rejection as an error would stop
				 * the loop for good and surface a user-visible failure for what the
				 * contract calls routine (rule 4). Fall through as a clean end instead,
				 * so it reopens at once and resyncs from the new seed frame. */
				if (!this.watchdogFired) {
					ended = "error";
					error = errorFrom(cause, "sse read");
				}
			} finally {
				this.clearSilenceTimer();
				await release().catch(() => undefined);
			}

			if (!this.running) return;

			const openMs = this.options.now() - this.openedAt;
			if (ended === "error" && error) {
				/* The body failed mid-stream: a TCP reset, a socket error after the headers
				 * arrived. That is a broken CONNECTION — not a lease rotation, and not an
				 * authentication failure, because a `401` arrives at `open` and stops the
				 * loop there. So the loop self-heals exactly as a silence stall does, with
				 * consecutive failures spacing the retries instead of retrying flat out.
				 *
				 * The error rides the STATE, not `onError`: the stream is reconnecting, not
				 * failed, and a screen that paints a failure for a phone that changed
				 * networks is the flash rule 1 exists to prevent. A caller that wants to
				 * report something reads `lastEnd`/`lastError` from the status. */
				this.failures += 1;
				this.emit({
					state: "stalled",
					attempt: this.attempt,
					lastOpenMs: openMs,
					lastEnd: "error",
					lastError: error,
				});
				await this.pause(streamRetryDelayMs(this.failures));
				continue;
			}

			/* A clean EOF. Long ones are the lease expiring (normal); short ones mean
			 * the gateway stopped forwarding, which is worth reporting as a distinct
			 * state while still reconnecting at once — an early EOF carries no
			 * information about *why* (`tunnel-edge.md` §3). */
			const rotation = !this.watchdogFired && openMs >= ROTATION_MIN_OPEN_MS;
			this.emit({
				state: rotation ? "rotating" : "stalled",
				attempt: this.attempt,
				lastOpenMs: openMs,
				lastEnd: "eof",
			});
			await this.pause(rotation ? ROTATION_JITTER_MS : 0);
		}
	}

	private handle(frame: SseFrame): void {
		/* Finished frames only: `finish()` is never called, because a body that ends
		 * without a blank line was cut mid-event and the parser must not be told the
		 * wire is complete. */
		this.options.onFrame(decodeFrame(frame));
	}

	private armSilenceWatchdog(controller: AbortController): void {
		this.clearSilenceTimer();
		const setTimer = this.options.setTimeout ?? setTimeout;
		this.silenceTimer = setTimer(() => {
			if (!this.running) return;
			/* The socket is open and nothing has arrived for ~35 s while the relay
			 * keep-alives every 25 s: the stream is dead even though it looks alive.
			 * The flag goes up BEFORE the abort so the read loop can tell this
			 * teardown from a transport error; the loop emits the `stalled` state
			 * itself once the read has unwound, so it is not emitted twice. */
			this.watchdogFired = true;
			controller.abort();
		}, this.options.silenceMs);
	}

	private clearSilenceTimer(): void {
		const clear = this.options.clearTimeout ?? clearTimeout;
		if (this.silenceTimer !== undefined) clear(this.silenceTimer);
		this.silenceTimer = undefined;
	}

	private pause(ms: number): Promise<void> {
		const jitter = ms > 0 ? Math.floor(this.options.random() * ms) : 0;
		const setTimer = this.options.setTimeout ?? setTimeout;
		return new Promise((resolve) => {
			this.jitterTimer = setTimer(() => {
				this.jitterTimer = undefined;
				resolve();
			}, jitter);
		});
	}
}

/** Normalises anything a stream loop can catch into a `RelayError`, so an
 *  `onError` handler never has to type-switch on a raw platform error. */
function errorFrom(cause: unknown, diagnostic: string): RelayError {
	return cause instanceof RelayError
		? cause
		: transportError(cause, diagnostic);
}
