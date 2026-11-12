import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useStore } from "zustand";
import type {
	ModelEntry,
	SlashCommand,
	SubagentDetail,
	TranscriptEntry,
} from "@/contracts";
import {
	configStore,
	currentWarmScope,
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import {
	type ConnectionView,
	connectionView,
	isRouteRefused,
	KEEPALIVE_GRACE_S,
	RECONNECT_DEADLINE_MS,
	reconnectDelay,
	relaySentence,
} from "@/features/session/connection-view";
import {
	type HealthLink,
	headerHealth,
	healthLink,
} from "@/features/session/health";
import { turnRunning } from "@/features/session/projection";
import {
	relaySource,
	type SessionRelaySource,
} from "@/features/session/relay-source";
import {
	createResumeClock,
	heldTimer,
	OUTAGE_GRACE_MS,
} from "@/features/session/resume-hold";
import {
	deviceOnline,
	INITIAL_STREAM_FACTS,
	loadAttachments,
	loadVideoSource,
	type StreamFacts,
	sessions,
} from "@/features/session/runtime";
import {
	type SupplementBeat,
	supplementsFromWire,
} from "@/features/session/supplements";
import type { ImageBytes, RelayError } from "@/relay";
import { readEntry } from "@/state";
import { isUsable } from "@/state/connection-store";
import { HistoryWindow } from "./history-window";
import { createResumeGate } from "./resume-gate";
import {
	catalogueRereadOnConfig,
	holdResumeRead,
	resumeHistoryRead,
} from "./resume-plan";
import {
	type ProjectionOwner,
	sameProjectionOwner,
	sessionContent,
} from "./session-content";
import { warmCache } from "./warm-store";

/**
 * Everything a session screen reads: the relay client, the projection stream, the
 * connection state, and the two catalogues the composer's sheets need.
 *
 * **The reconnect deadline is the only timer that changes a user-visible state.**
 * `C1` — the gateway's 60-second lease ending — must be invisible, so a clean EOF
 * starts no state at all; what this hook watches for is the case the contract
 * calls `C2`: a reconnect that OPENED but produced no snapshot, which becomes a
 * state only when the deadline passes. The alternative (marking any stream
 * transition as a loss) is the bug the flows exist to catch, because a one-minute
 * flicker teaches the reader to ignore the indicator that matters.
 *
 * **The snapshot age ticks locally**, once a second, because `C3` is an absence:
 * nothing arrives to tell the screen that nothing arrived, so the screen has to
 * notice the silence itself.
 */
export interface SessionRuntime {
	source: SessionRelaySource;
	content: ReturnType<typeof sessionContent>;
	projection: ReturnType<typeof readEntry>["projection"];
	entries: TranscriptEntry[];
	loadOlder: () => Promise<void>;
	reloadHistory: () => Promise<void>;
	/** Repeats the history request that failed (newest refresh or older page). */
	retryHistory: () => Promise<void>;
	/** Continues filling the newest disconnected gap with a fresh budget
	 *  (`HistoryWindow.heal`); the quiet gap row's Load action. */
	healHistory: () => Promise<void>;
	loadingOlder: boolean;
	historyError: string | null;
	hasOlder: boolean;
	/** A hole the automatic fill could not close; false while it is filling. */
	historyGap: boolean;
	/** Entry id of the first row after the newest hole, where the list marks it. */
	historyGapBefore: string | null;
	/** Which read `historyError` belongs to; decides retry target and copy. */
	historyErrorScope: "newest" | "older" | null;
	streaming: boolean;
	streamingRowId: string | null;
	/** True while the frame on screen came from the warm cache and no live frame
	 *  has arrived yet: the conversation is shown as it was when saved, not live. */
	hydrated: boolean;
	connection: ConnectionView;
	/** The session stream's own liveness (the store's flag). */
	connected: boolean;
	/** The phone's link as the header's status dot reads it (`healthLink`):
	 *  `retrying` the moment a link that was up drops, `stopped` once the
	 *  client has given up — fed by the same facts as the connection banner. */
	link: HealthLink;
	commands: SlashCommand[];
	models: ModelEntry[];
	loading: boolean;
	/** Whether the conversation provably runs deeper than the rows this device
	 *  holds — `olderThanLoaded`, which fires unless a successful page read
	 *  backs the silence: a failed or unsettled read, a page row the window no
	 *  longer carries, `has_more` with nothing held past the page, or an
	 *  observed slide. The find sheet's caveat line is its one reader. */
	olderThanLoaded: boolean;
	error: RelayError | null;
	/** Loads one attachment's bytes as a data URI, or `null` when the relay no
	 *  longer has them. */
	loadImage: (entryId: string, index: number) => Promise<string | null>;
	/** Loads one video artifact as a playable source URI (a cache file on
	 *  native, a Blob object URL on web), or `null` when the relay no longer
	 *  has the bytes. The caller revokes a web object URL when done with it
	 *  (`loadVideoSource`'s contract). */
	loadVideo: (entryId: string, index: number) => Promise<string | null>;
	/** Loads a child's full detail, which the aggregate roster strips. */
	loadAgent: (jobId: string) => Promise<SubagentDetail | null>;
	/** Turn supplements (memo §2.4/§3.1 row 18): the projection's newest beat
	 *  per anchor, read through `supplementsFromWire` — absent on an older relay
	 *  and empty when no anchor carries one. */
	supplements: Record<string, SupplementBeat>;
	/** The projection's own process identity, for `beatLive` (0 is a disk
	 *  rebuild). */
	projectionPid: number;
	/** One supplement component's assembled document, `{html}`. */
	loadSupplementDocument: (digest: string) => Promise<string>;
	/** One recorded callout's bytes, by the row's own index. */
	loadSupplementFile: (job: string, index: number) => Promise<ImageBytes>;
	/** One supplement sound's bytes, by its `sounds[].attachment` digest. */
	loadSupplementSound: (digest: string) => Promise<ImageBytes>;
	/** `supplement_cancel|restart|steer` over the session command route — the
	 *  same route every other mutation uses. */
	supplementCommand: (
		op: "cancel" | "restart" | "steer",
		anchor: string,
		job: string,
		text?: string,
	) => Promise<void>;
	/** Re-runs the requests a refusal interrupted. */
	reload: () => void;
}

/** Whether a stream failure is one to reconnect through rather than surface.
 *
 * Keyed on the KIND, not on the `retry` directive: a typed gateway refusal
 * carries the server's own sentence and a remedy, so it must be shown (`C6`),
 * and reconnecting through it would both hide that sentence and fight a relay
 * that is refusing on purpose. `after-backoff` is true for a plain transport
 * drop AND for `authorization_deferred`; only the first is silent. */

const isTransient = (error: RelayError): boolean =>
	error.kind === "transport" ||
	error.kind === "ambiguous-delivery" ||
	/* The tunnel grant could not be renewed for a reason that clears by itself
	 * (a control-plane 5xx/408, no answer, a rate limit): `refusal.ts` types it
	 * `rejected` with the `retry` surface. It is the app's own renewal, not a
	 * gateway refusal with a sentence to show, and it recurs every ~4 minutes on
	 * a live route — stopping here left an open conversation behind "Check
	 * again" after one Radient blip (PR #178 UX round 1, U1). Terminal renewal
	 * failures (401/402/403/404) map to other surfaces and still stop. */
	(error.kind === "rejected" && error.surface === "retry");

/** Whether a session id names anything.
 *
 *  `""` is NOT an id: it builds `/api/sessions//events` and `//history`, which the
 *  relay answers 404 and the browser logs as two failed loads on every mount. The
 *  inbox and its detail read the runtime for a conversation they may not have yet
 *  (no answer sheet open, an item whose source conversation is unknown), so they
 *  pass `""` — QA round 5, Q10. Every reader below skips an unnamed session rather
 *  than asking the relay about nothing. */
export const hasSessionId = (sessionId: string): boolean =>
	sessionId.trim() !== "";

export const useSessionRuntime = (sessionId: string): SessionRuntime => {
	const providerConnection = useConnection();
	const snapshot = useConnectionState((state) => state);
	const route = snapshot.route;
	const client = isUsable(snapshot) ? providerConnection.relay() : null;
	const pending =
		!providerConnection.coldStartSettled ||
		snapshot.phase === "minting" ||
		snapshot.phase === "discovering";
	const source = useMemo(
		() => relaySource(route, client, pending),
		[route, client, pending],
	);
	const endpoints = source.endpoints;

	const cachedEntry = useStore(sessions, () =>
		readEntry(sessions.getState(), sessionId),
	);

	// One identity scopes every reader value, not merely the transcript branch.
	const identity = useMemo<ProjectionOwner>(
		() => ({
			revision: snapshot.revision,
			tunnelId: snapshot.tunnelId,
			sessionId,
		}),
		[snapshot.revision, snapshot.tunnelId, sessionId],
	);

	const [facts, setFacts] = useSessionValue<StreamFacts>(
		identity,
		INITIAL_STREAM_FACTS,
	);
	/* OUTAGE HYSTERESIS, the relay's own rule (`store.ts` at 24d328a1:
	 * `OUTAGE_GRACE_MS = 2500`, with `STABLE_STREAM_MS = 2000` before it calls a
	 * reconnect recovered). Without it the dot flipped Live ↔ Reconnecting every
	 * 300–700 ms on a flapping link and re-announced each flip, moving the header
	 * every time (review round 2 m-a, design D11).
	 *
	 * Applied to the DROP SIGNAL, not to the health verdict, so the dot, the
	 * connection banner and the state markers cannot disagree about whether there
	 * is an outage. A drop arms a 2.5 s grace; only a drop still standing when it
	 * fires is reported. An accepted frame clears it immediately — recovery is
	 * immediate, as the relay's `healthy()` is. */
	const [droppedGrace, setDroppedGrace] = useSessionValue<boolean>(
		identity,
		false,
	);
	/* The resume hold (`resume-hold.ts`, TestFlight 836): a drop seen while
	 * backgrounded, or inside RESUME_GRACE_MS of a return, is held silent while
	 * the stream retries, and a timer that slept through a suspension does not
	 * count the time the phone was locked. Both report timers below go through it;
	 * typed refusals never do (they reach `setError` directly). */
	const resumeClock = useRef(createResumeClock());
	/** Bumped on every return so the reconnect deadline re-arms for the fresh
	 *  reopen even when the stream was already `connecting` before the lock. */
	const [resumeEpoch, setResumeEpoch] = useState(0);
	const dropGraceTimer = useRef<(() => void) | null>(null);
	useEffect(() => {
		if (!facts.droppedSinceFrame) {
			// Recovery: cancel any pending report and clear at once.
			dropGraceTimer.current?.();
			dropGraceTimer.current = null;
			setDroppedGrace(false);
			return;
		}
		if (dropGraceTimer.current !== null) return; // already armed
		dropGraceTimer.current = heldTimer(
			resumeClock.current,
			OUTAGE_GRACE_MS,
			() => {
				dropGraceTimer.current = null;
				setDroppedGrace(true);
			},
		);
		return () => {
			dropGraceTimer.current?.();
			dropGraceTimer.current = null;
		};
	}, [facts.droppedSinceFrame, setDroppedGrace]);
	const [, historyChanged] = useState(0);
	// Endpoint and owner changes allocate a new reader synchronously, so an old
	// account/session's cached rows cannot paint before effect cleanup runs.
	const historyWindow = useMemo(() => {
		const owner = identity;
		return new HistoryWindow(
			(before) => {
				if (!endpoints || !sameProjectionOwner(owner, currentIdentity.current))
					return Promise.reject(new Error("History is unavailable."));
				return endpoints.history(sessionId, { before });
			},
			() => historyChanged((revision) => revision + 1),
			// A hole left by a background, a network change or a stream reconnect
			// is filled from the relay without the reader acting (the TestFlight
			// "Reload from latest messages" report); only a fill that runs out of
			// budget surfaces, as a quiet notice.
			{ autoHeal: true },
		);
	}, [endpoints, identity, sessionId]);
	useEffect(() => {
		historyWindow.activate();
		return () => historyWindow.retire();
	}, [historyWindow]);
	/** The stream effect does not re-run per reader; it reaches the current one
	 *  through this ref. */
	const historyRef = useRef(historyWindow);
	historyRef.current = historyWindow;
	const loadOlder = useCallback(() => historyWindow.load(), [historyWindow]);
	const reloadHistory = useCallback(
		() => historyWindow.reload(),
		[historyWindow],
	);
	const retryHistory = useCallback(
		() => historyWindow.retry(),
		[historyWindow],
	);
	const healHistory = useCallback(() => historyWindow.heal(), [historyWindow]);
	const [commands, setCommands] = useSessionValue<SlashCommand[]>(identity, []);
	const [models, setModels] = useSessionValue<ModelEntry[]>(identity, []);
	const [error, setError] = useSessionValue<RelayError | null>(identity, null);
	const [loading, setLoading] = useSessionValue(identity, true);

	/* `reload` is an ACT rather than a value in a dependency array.
	 *
	 * A `reloadToken` state counter is the obvious spelling and it is worse in two
	 * ways: the effects it re-runs have to list a value they never read (so the
	 * dependency is a lie the lint is right to flag), and bumping it re-runs them
	 * through a render pass rather than when the reader asked. Holding the two
	 * entry points in refs means `reload` calls exactly the work it means to redo.
	 */
	const reconnectRef = useRef<() => void>(() => undefined);
	/** `history: false` re-reads commands and models only: the resume gate
	 * dedupes the history read, never the rest of a return (PR #217 R1-4). */
	const rereadRef = useRef<(history?: boolean) => void>(() => undefined);
	const streamRef = useRef<{ stop: () => void } | null>(null);
	/** One gate for every resume signal (foreground, stream recovery). */
	const resumeGate = useRef(createResumeGate());
	/** Set when the stream reported a drop or stall; the next frame is the
	 *  reconnect, and the moment to re-read the newest durable page. */
	const recovering = useRef(false);
	/** A pending reconnect after a transient drop; cleared whenever the stream is. */
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastFrameAt = useRef<number | null>(null);
	/** Which session the current `lastFrameAt` reading belongs to, so a reconnect for
	 *  the SAME session keeps it and a session change does not inherit it. */
	const ageOwner = useRef<ProjectionOwner | null>(null);

	const currentIdentity = useRef(identity);
	currentIdentity.current = identity;
	const projectionOwner = useRef<ProjectionOwner | null>(null);
	/** Set by a return to the foreground to the resume gate's verdict; the first
	 *  frame after it decides whether the newest history page is read at all
	 *  (`resumeHistoryRead`: only when that frame does not overlap what is held).
	 *  `null` when no return is pending. */
	const resumePending = useRef<boolean | null>(null);
	/** Whether the last commands/models read answered both. */
	const catalogueLoaded = useRef(false);
	/** Saves this conversation's live frame to the warm cache; replaced per
	 *  render so the AppState handler always reaches the current owner. */
	const saveWarmRef = useRef<() => void>(() => undefined);
	/** Cancels a held resume history read (`holdResumeRead`) on unmount. */
	const heldHistoryRead = useRef<(() => void) | null>(null);
	const [historyErrorHeld, setHistoryErrorHeld] = useSessionValue<boolean>(
		identity,
		false,
	);

	/* ------------------------------------------------------------- the stream */
	useEffect(() => {
		// An unnamed session has no stream to open (Q10).
		if (!hasSessionId(sessionId)) return;
		let active = true;
		const owner: ProjectionOwner = {
			revision: snapshot.revision,
			tunnelId: snapshot.tunnelId,
			sessionId,
		};
		const connect = () => {
			if (!active || !sameProjectionOwner(owner, currentIdentity.current))
				return;
			if (endpoints === null) {
				setLoading(source.reason === "pending");
				return;
			}
			// A reload replaces the stream: leaving the old one open would put two
			// subscribers on one projection and let a stale frame overtake a fresh one.
			if (retryTimer.current !== null) clearTimeout(retryTimer.current);
			retryTimer.current = null;
			streamRef.current?.stop();
			// The age is only reset for a session this screen has not shown before. It must
			// NOT be reset per reconnect: `ageS` is "how long since anything arrived", and a
			// stream that reconnects silently would otherwise reset the one reading `C3`
			// fires on, so `C3` could never appear for the failure it exists for. A frame
			// retires the age honestly, because a frame is news.
			if (!sameProjectionOwner(ageOwner.current, owner)) {
				ageOwner.current = owner;
				lastFrameAt.current = null;
			}
			sessions.getState().beginStream(sessionId);
			setError(null);
			const stream = endpoints.sessionStream(sessionId, {
				onFrame: (frame) => {
					if (
						!active ||
						frame.kind !== "projection" ||
						!sameProjectionOwner(owner, currentIdentity.current)
					)
						return;
					projectionOwner.current = owner;
					lastFrameAt.current = Date.now();
					retries.current = 0;
					/* The first frame after a return. Decided BEFORE the frame is
					 * applied, against what the reader holds: a frame that reaches back
					 * to the newest held row proves there is no hole, and the newest
					 * page it would re-download is the same rows (`resume-plan.ts`). */
					const resumeGateOpen = resumePending.current;
					resumePending.current = null;
					const readOnResume =
						resumeGateOpen !== null &&
						resumeHistoryRead({
							gateOpen: resumeGateOpen,
							frameOverlapsHeld: historyRef.current.overlapsHeld(frame.data),
						});
					sessions.getState().applyFrame(sessionId, frame.data);
					if (readOnResume) {
						const reader = historyRef.current;
						heldHistoryRead.current?.();
						heldHistoryRead.current = holdResumeRead({
							clock: resumeClock.current,
							read: () => reader.load(true),
							retry: () => reader.retry(),
							failed: () =>
								reader.error !== null && reader.errorScope === "newest",
							setHeld: setHistoryErrorHeld,
						});
					}
					// First frame after a drop/stall (a network change lands here too:
					// native has no route signal, see deviceOnline): re-read the newest
					// page so a hole the capped frame cannot reveal is found and filled.
					// History only: the reader's own lease fences a late answer after
					// unmount, which the commands/models re-read (rereadRef) does not.
					if (recovering.current) {
						recovering.current = false;
						if (resumeGate.current()) void historyRef.current.load(true);
					}
					setLoading(false);
					// Any frame proves the path is alive, so a deadline that fired is
					// retired by the next frame rather than by a timer of its own.
					setFacts((current) => ({
						...current,
						ageMs: 0,
						overdue: false,
						// The drop is over the moment a frame lands: without this, C2's
						// "Reconnecting…" would outlive the reconnect it announced.
						lastEnd: current.lastEnd === "error" ? undefined : current.lastEnd,
						droppedSinceFrame: false,
					}));
				},
				onState: (status) => {
					if (!active || !sameProjectionOwner(owner, currentIdentity.current))
						return;
					if (status.lastEnd === "error" || status.state === "stalled")
						recovering.current = true;
					setFacts((current) => ({
						...current,
						state: status.state,
						lastEnd: status.lastEnd,
						droppedSinceFrame:
							current.droppedSinceFrame || status.lastEnd === "error",
						// A rotation is a clean EOF: the lease is over, nothing is wrong, and
						// `overdue` is reset here so a previous loss cannot leak through it.
						overdue: status.lastEnd === "error" ? current.overdue : false,
					}));
				},
				onError: (streamError) => {
					if (!active || !sameProjectionOwner(owner, currentIdentity.current))
						return;
					/* `sse.ts` stops its loop on ANY error, by design: "a caller that
					 * wants to retry a transient failure restarts the loop itself", so a
					 * persistent 401 cannot become an infinite reconnect. This is that
					 * caller, and the error's own `retry` directive is the decision —
					 * one reading of one failure, made in `errors.ts`.
					 *
					 * A transient drop (`after-backoff` / `same-id`) is reconnected here
					 * and presented as `C2`, NOT as a refusal: the first captured drop
					 * painted "The relay can't be reached right now / Check again" over
					 * a stream the relay was still serving, and left the reader to
					 * reconnect by hand. Only a failure the reader must resolve (a 401, a
					 * typed gateway refusal, a client bug) stops and surfaces. */
					if (isTransient(streamError)) {
						recovering.current = true;
						setFacts((current) => ({
							...current,
							state: "connecting",
							lastEnd: "error",
							overdue: false,
							droppedSinceFrame: true,
						}));
						const delay = reconnectDelay(
							retries.current,
							streamError.retryAfterMs,
						);
						retries.current += 1;
						retryTimer.current = setTimeout(
							() => reconnectRef.current(),
							delay,
						);
						return;
					}
					sessions.getState().endStream(sessionId);
					setError(streamError);
					setFacts((current) => ({
						...current,
						state: "closed",
						overdue: false,
					}));
				},
			});
			streamRef.current = stream;
			stream.connection.start();
		};
		reconnectRef.current = connect;
		connect();
		return () => {
			active = false;
			if (retryTimer.current !== null) clearTimeout(retryTimer.current);
			retryTimer.current = null;
			streamRef.current?.stop();
			streamRef.current = null;
			sessions.getState().endStream(sessionId);
		};
	}, [
		endpoints,
		sessionId,
		source.reason,
		snapshot.revision,
		snapshot.tunnelId,
		setLoading,
		setError,
		setFacts,
		setHistoryErrorHeld,
	]);

	/** Consecutive failed reconnects, for the backoff. Reset by any delivered frame,
	 *  so one blip does not leave the next one waiting fifteen seconds. */
	const retries = useRef(0);

	/* --------------------------------------------------- the reconnect deadline */
	useEffect(() => {
		if (facts.state !== "connecting") return;
		// `resumeEpoch` is read so a return re-arms this for the new reopen.
		void resumeEpoch;
		return heldTimer(resumeClock.current, RECONNECT_DEADLINE_MS, () =>
			setFacts((current) => ({ ...current, overdue: true })),
		);
	}, [facts.state, resumeEpoch, setFacts]);

	/* ---------------------------------------------------------- the age ticker */
	useEffect(() => {
		const tick = setInterval(() => {
			const at = lastFrameAt.current;
			if (at === null) return;
			const ageMs = Date.now() - at;
			setFacts((current) =>
				current.ageMs !== null && Math.abs(current.ageMs - ageMs) < 900
					? current
					: { ...current, ageMs },
			);
		}, 1000);
		return () => clearInterval(tick);
	}, [setFacts]);

	/* A screen that was backgrounded has a stale age and a possibly dead stream:
	 * `beginStream` on return makes the next frame authoritative, which is the
	 * contract's rule for the first frame of a connection. */
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			// Only "background" means the process may be suspended; "inactive" is
			// also a system sheet over a running app, which must not hide a drop.
			if (state === "background") {
				resumeClock.current.background();
				// The moment that matters for the warm cache: the JS thread still
				// runs now, and iOS may end the process without another word.
				saveWarmRef.current();
			}
			if (state !== "active") return;
			// Open the silent window BEFORE anything below can report: the drop
			// the lock caused, and any timer it armed, are expected, not news.
			resumeClock.current.resume();
			// A fresh start for the backoff too: a curve left at 15 s by the drop
			// before the lock would push the first retry past the window.
			retries.current = 0;
			// A quick flick out and back, or a system sheet, reports "active"
			// again within moments; the first signal's history read already
			// covers it. ONLY that read is deduped: the gate is shared with the
			// stream-recovery frame, so gating the reopen too could leave a
			// return within 1.5 s of a recovery with a dead stream (PR #217 R1-4).
			const readHistory = resumeGate.current();
			// This return re-opens the stream itself; its first frame is not a
			// second resume.
			recovering.current = false;
			lastFrameAt.current = null;
			// The drop and the overdue reopen are cleared, not just the age: before
			// TestFlight 836 they survived the return and painted C2 on its first
			// tick. If the reopen below fails, its own drop re-arms the (held) report.
			setFacts((current) => ({
				...current,
				ageMs: null,
				droppedSinceFrame: false,
				overdue: false,
			}));
			setResumeEpoch((epoch) => epoch + 1);
			// Re-open the stream: its seed frame re-syncs the conversation. The
			// newest history page is NOT read here any more — the seed carries the
			// same rows, so the read is deferred to that first frame and runs only
			// when the frame does not overlap what is held (the hole case #217
			// heals; `resumeHistoryRead`). Commands and models are not re-read on a
			// return either: they move on a config change (`catalogueRereadOnConfig`
			// below), not on a phone being pocketed — unless the last read failed.
			resumePending.current = readHistory;
			reconnectRef.current();
			if (!catalogueLoaded.current) rereadRef.current(false);
		});
		return () => subscription.remove();
		// The reload refs are current, but the setter also has an identity lease.
		// Re-register on identity changes rather than using a retired setter.
	}, [setFacts]);

	/* ------------------------------------------------- the one-off read requests */
	/* Also an act, for the same reason as the stream: these are the three requests a
	 * refusal interrupted, and `Check again` has to be able to run them. */
	useEffect(() => {
		const owner = identity;
		const read = (history = true) => {
			// Nothing to read, and nothing to ask the relay about (Q10).
			if (!hasSessionId(sessionId)) return;
			if (
				endpoints === null ||
				!sameProjectionOwner(owner, currentIdentity.current)
			)
				return;
			let cancelled = false;
			setLoading(true);
			const readHistory = history
				? historyWindow.load(true)
				: Promise.resolve();
			Promise.all([
				// Refresh the newest durable page without discarding paged history.
				readHistory,
				endpoints.commands().catch(() => null),
				endpoints.models().catch(() => null),
			])
				.then(([, commandList, modelList]) => {
					if (cancelled) return;
					if (commandList) setCommands(commandList.commands);
					if (modelList) setModels(modelList.models);
					/* A failed catalogue read is the one reason a RETURN re-reads
					 * them (the AppState handler above); a good read waits for a
					 * config change. */
					catalogueLoaded.current = commandList !== null && modelList !== null;
				})
				.finally(() => {
					if (!cancelled) setLoading(false);
				});
			return () => {
				cancelled = true;
			};
		};
		rereadRef.current = (history = true) => {
			void read(history);
		};
		const cancel = read();
		return cancel;
	}, [
		endpoints,
		sessionId,
		identity,
		setLoading,
		historyWindow,
		setCommands,
		setModels,
	]);

	/* ---------------------------------------------------------- the warm cache */
	/* HYDRATE ON OPEN (`state/warm-cache.ts`). A conversation this process holds
	 * nothing for — a relaunch after the OS killed the app, or a conversation not
	 * opened since launch — paints its last saved frame at once instead of a
	 * blank screen. The entry is `hydrated`, not connected and awaiting its
	 * snapshot, so every gate that holds before a first frame still holds; the
	 * seeded age (`savedAt`) makes the age machinery say how old it is rather
	 * than "live". The first live frame replaces it exactly as it replaces any
	 * frame of a previous connection. */
	useEffect(() => {
		if (!hasSessionId(sessionId)) return;
		const scope = currentWarmScope();
		if (scope === null || sessions.getState().entries[sessionId]?.projection)
			return;
		const owner = identity;
		let active = true;
		void warmCache.loadSession(scope, sessionId).then((cached) => {
			if (
				!active ||
				cached === null ||
				currentWarmScope() !== scope ||
				!sameProjectionOwner(owner, currentIdentity.current) ||
				sessions.getState().entries[sessionId]?.projection
			)
				return;
			// The cache is keyed by account and computer, so this owner IS the
			// frame's owner; `ownsProjection` needs to know before the store
			// update re-renders.
			projectionOwner.current = owner;
			if (!sessions.getState().hydrate(sessionId, cached.projection)) return;
			ageOwner.current = owner;
			lastFrameAt.current = cached.savedAt;
			setFacts((current) => ({
				...current,
				ageMs: Math.max(0, Date.now() - cached.savedAt),
			}));
		});
		return () => {
			active = false;
		};
	}, [identity, sessionId, setFacts]);

	/* SAVE, on three moments and never per frame (frames arrive at up to 10/s and
	 * a save is one sealed write of up to 700 KB): going to the background, a
	 * turn ending (below, after the derivations), and leaving the conversation.
	 * Only a LIVE frame of this owner is saved — re-saving a hydrated one would
	 * stamp an old frame with a new `savedAt`. */
	const saveWarmFor = useCallback((sid: string, owner: ProjectionOwner) => {
		const scope = currentWarmScope();
		const held = sessions.getState().entries[sid];
		if (
			scope === null ||
			!held?.projection ||
			held.hydrated === true ||
			!sameProjectionOwner(projectionOwner.current, owner)
		)
			return;
		void warmCache.saveSession(scope, sid, held.projection);
	}, []);
	saveWarmRef.current = () => saveWarmFor(sessionId, identity);
	useEffect(() => {
		const sid = sessionId;
		const owner = identity;
		return () => {
			heldHistoryRead.current?.();
			heldHistoryRead.current = null;
			if (hasSessionId(sid)) saveWarmFor(sid, owner);
		};
	}, [sessionId, identity, saveWarmFor]);

	/* CATALOGUES FOLLOW THE CONFIG STREAM, not the AppState. A config frame
	 * that names any changed key re-reads commands and models; the seed frame
	 * every (re)connect sends names none and costs nothing
	 * (`catalogueRereadOnConfig`). */
	useEffect(() => {
		let seen = configStore.getState().frameCount;
		return configStore.subscribe((next) => {
			if (next.frameCount === seen) return;
			seen = next.frameCount;
			if (catalogueRereadOnConfig(next.changedKeys)) rereadRef.current(false);
		});
	}, []);

	/* ------------------------------------------------------------- derivations */
	// A cached entry is private to the frame owner. Filtering HERE protects the
	// header, panels, pending/working facts and composer as well as the row list.
	const ownsProjection =
		route !== null && sameProjectionOwner(projectionOwner.current, identity);
	const entry = ownsProjection
		? cachedEntry
		: readEntry({ entries: {} }, sessionId);
	const projection = entry.projection;
	/** The frame on screen is the warm cache's, not a live one. */
	const hydrated = entry.hydrated === true;
	if (ownsProjection) historyWindow.accept(projection);
	/* Turn end is a save moment: the conversation's shape just settled. A
	 * hydrated frame never counts as running, so it can neither trigger this nor
	 * offer the composer a "steer" for a turn that may long be over. */
	const running = !hydrated && projection !== null && turnRunning(projection);
	const wasRunning = useRef(false);
	useEffect(() => {
		if (wasRunning.current && !running) saveWarmRef.current();
		wasRunning.current = running;
	}, [running]);
	const entries = ownsProjection ? historyWindow.visibleRows : EMPTY_HISTORY;
	const olderRowClaim =
		historyWindow.read !== "ok" ||
		historyWindow.hasMore ||
		historyWindow.hasGap;

	/* The phone's link as the header dot reads it — computed once, here, so the
	 *  dot and the connection banner read the same facts (`healthLink`). */
	const link = healthLink({
		entryConnected: entry.connected,
		/* Set by any transport drop (`sse.ts`'s `stalled`/`closed` with
		 *  `lastEnd: "error"`, and the transient arm above), cleared only by the
		 *  next accepted frame — the relay's "outage until a fresh frame" rule.
		 *  A clean EOF (the lease rotation, C1) never sets it. */
		droppedSinceFrame: droppedGrace,
		reopenOverdue: facts.overdue,
		online: deviceOnline(),
		/* The SAME terminal error the banner reads (`error ?? providerConnection.
		 * lastError` below), not just this hook's own. A 401 or a gateway
		 * `authorization_refused` is recorded by the PROVIDER, so reading only
		 * `error` left the dot saying "Reconnecting — keeps trying" beside a
		 * banner naming the remedy, after the phone had stopped retrying (UX
		 * round 2, U4). */
		stoppedOnError: (error ?? providerConnection.lastError) !== null,
		/* The loop's own end, so a terminal failure the provider never saw still
		 *  reads as stopped (QA round 3, Q10). */
		streamClosed: facts.state === "closed",
		/* The route's own refusal, which outlives the effect teardown that drops
		 *  the stream's terminal report (review round 4, N1). */
		routeRefused: source.reason === "refused",
	});

	const connection = useMemo((): ConnectionView => {
		const factsForView = {
			// Authentication failures belong to the provider even though this screen
			// correctly sent no request of its own. Pending admission is not refusal.
			phase: isRouteRefused({
				noRoute: source.reason === "no-route",
				error: error ?? providerConnection.lastError,
			})
				? ("refused" as const)
				: ("live" as const),
			stream: facts.state,
			lastEnd: facts.lastEnd,
			/* The graced drop — the dot's own input, so the two cannot disagree. */
			droppedSinceFrame: droppedGrace,
			reconnectExpired: facts.overdue,
			online: deviceOnline(),
			error: error ?? providerConnection.lastError,
			entry,
			/* The DOT's ended verdict (pid 0 included), not `projection.ended`
			 *  alone: a history rebuild is ended too, and a band saying "Not
			 *  answering" over it contradicted the grey dot (UX round 1, U6). */
			ended: headerHealth(projection, link) === "ended",
			healthDotShown: headerHealth(projection, link) !== null,
			stale: entry.connected && projection?.degraded === true,
			ageS:
				facts.ageMs === null
					? null
					: Math.min(Math.round(facts.ageMs / 1000), 3600),
			computerLabel:
				route?.mode === "radient" ? route.hostname : "this computer",
			computerLastSeenS: null,
			// The relay's own sentence only, never the runtime's prose: see
			// `relaySentence`, which is the one place that decides what a failure is
			// allowed to say.
			phaseDetail:
				snapshot.detail ??
				(error === null ? null : (relaySentence(error) ?? null)),
			phaseSurface: snapshot.surface ?? (error === null ? null : error.surface),
		};
		return connectionView(factsForView);
	}, [
		error,
		source.reason,
		facts,
		entry,
		projection,
		link,
		/* The graced drop the banner's C2 now reads — without it the memo would
		 *  keep painting the previous outage state (QA round 3, Q11). */
		droppedGrace,
		route,
		providerConnection.lastError,
		snapshot.detail,
		snapshot.surface,
	]);

	const loadImage = useCallback(
		async (entryId: string, index: number): Promise<string | null> => {
			if (endpoints === null) return null;
			return loadAttachments(endpoints, sessionId, entryId, index);
		},
		[endpoints, sessionId],
	);

	const loadVideo = useCallback(
		async (entryId: string, index: number): Promise<string | null> => {
			if (endpoints === null) return null;
			return loadVideoSource(endpoints, sessionId, entryId, index);
		},
		[endpoints, sessionId],
	);

	const loadAgent = useCallback(
		async (jobId: string): Promise<SubagentDetail | null> => {
			if (endpoints === null) return null;
			try {
				return await endpoints.agentDetail(sessionId, jobId);
			} catch {
				return null;
			}
		},
		[endpoints, sessionId],
	);

	/* ------------------------------------------------------- turn supplements */
	/* The projection's sibling map, re-read through its ONE reader at this trust
	 * boundary (the store keeps the frame as parsed; a beat whose anchor/state
	 * does not parse is dropped rather than rendered from a guess). ABSENT stays
	 * absent: the daemon emits the key only when it carries beats. */
	const supplements = useMemo(
		() => supplementsFromWire(projection?.supplements),
		[projection?.supplements],
	);

	const loadSupplementDocument = useCallback(
		async (digest: string): Promise<string> => {
			if (endpoints === null) throw new Error("no relay route");
			const { html } = await endpoints.supplementDocument(sessionId, digest);
			return html;
		},
		[endpoints, sessionId],
	);

	const loadSupplementFile = useCallback(
		(job: string, index: number): Promise<ImageBytes> => {
			if (endpoints === null) {
				return Promise.reject(new Error("no relay route"));
			}
			return endpoints.supplementFile(sessionId, job, index);
		},
		[endpoints, sessionId],
	);

	const loadSupplementSound = useCallback(
		(digest: string): Promise<ImageBytes> => {
			if (endpoints === null) {
				return Promise.reject(new Error("no relay route"));
			}
			return endpoints.supplementSound(sessionId, digest);
		},
		[endpoints, sessionId],
	);

	const supplementCommand = useCallback(
		async (
			op: "cancel" | "restart" | "steer",
			anchor: string,
			job: string,
			text?: string,
		): Promise<void> => {
			if (endpoints === null) throw new Error("no relay route");
			if (op === "cancel") {
				await endpoints.command(sessionId, {
					op: "supplement_cancel",
					anchor,
					job,
				});
				return;
			}
			if (op === "restart") {
				await endpoints.command(sessionId, {
					op: "supplement_restart",
					anchor,
					job,
				});
				return;
			}
			await endpoints.command(sessionId, {
				op: "supplement_steer",
				anchor,
				job,
				text: text ?? "",
			});
		},
		[endpoints, sessionId],
	);

	const reload = useCallback(() => {
		reconnectRef.current();
		rereadRef.current();
	}, []);

	const streamingRowId = useMemo(() => {
		if (hydrated || projection?.streaming !== true) return null;
		const tail = entries[entries.length - 1];
		return tail ? tail.id : null;
	}, [hydrated, projection?.streaming, entries]);

	return {
		source,
		content: sessionContent(
			source.reason,
			projection !== null &&
				sameProjectionOwner(projectionOwner.current, identity),
			error !== null || providerConnection.lastError !== null,
		),
		projection,
		entries,
		/* `turnRunning`, not the raw flag: the composer's op and the header's
		 *  "Working" must be one reading (see the predicate). `streamingRowId`
		 *  above stays on the raw flag — it marks where streamed TEXT lands. */
		streaming: running,
		streamingRowId,
		hydrated,
		connection,
		/** The session stream's own liveness, for the header's status dot
		 *  (`sessionHealth`: a down link reads "reconnecting", and every frame
		 *  reading below it is stale). `entry.connected`, not the route's phase —
		 *  a stale frame kept on screen still counts as a reading. */
		connected: entry.connected,
		link,
		commands: ownsProjection ? commands : [],
		models: ownsProjection ? models : [],
		loading,
		olderThanLoaded: olderRowClaim,
		loadOlder,
		reloadHistory,
		retryHistory,
		// Only an older-page read is "loading earlier": a foreground refresh
		// re-reads the newest page and must not claim that (PR #207 D1).
		loadingOlder:
			historyWindow.loading && historyWindow.loadingScope === "older",
		/* A newest-page failure inside the resume window is held (one silent
		 * retry at the window's end, `holdResumeRead`); only what is left after
		 * that retry is shown. */
		historyError:
			historyErrorHeld && historyWindow.errorScope === "newest"
				? null
				: historyWindow.error,
		hasOlder: historyWindow.hasMore,
		// The notice is for a hole the automatic fill could not close; while the
		// fill runs the list shows nothing (no flash, no layout jump).
		historyGap: historyWindow.hasGap && historyWindow.healState !== "healing",
		healHistory,
		historyGapBefore: historyWindow.gapBefore,
		historyErrorScope: historyWindow.errorScope,
		// The shared route can be refused by its catalogue stream before this
		// session's stream reports an error. Publish the same typed failure the
		// banner already uses, so screen/composer facts cannot claim a healthy
		// session while authenticated readiness has correctly been withdrawn.
		error: error ?? providerConnection.lastError,
		loadImage,
		loadVideo,
		loadAgent,
		supplements,
		projectionPid: projection?.pid ?? 0,
		loadSupplementDocument,
		loadSupplementFile,
		loadSupplementSound,
		supplementCommand,
		reload,
	};
};

/** Exposed for the connection-state test: the window the `C3` rule is derived
 *  from, re-exported so a screen cannot quietly use a different one. */
export { KEEPALIVE_GRACE_S };

const EMPTY_HISTORY: TranscriptEntry[] = [];

/** A route switch must withdraw accepted state in the very next render, before
 * effects run. Tagging values also rejects late async completions (including a
 * prior reload's history/catalogue callbacks); clearing state in an effect would
 * briefly expose old rows and cannot stop a late promise from putting them back.
 * Keeping the same owner preserves useful history/drafts through auth expiry. */
function useSessionValue<T>(
	owner: ProjectionOwner,
	initial: T,
): [T, (action: T | ((previous: T) => T)) => void] {
	const seed = useRef(initial);
	const currentOwner = useRef(owner);
	currentOwner.current = owner;
	const [stored, setStored] = useState({ owner, value: initial });
	const setValue = useCallback(
		(action: T | ((previous: T) => T)) => {
			if (!sameProjectionOwner(owner, currentOwner.current)) return;
			setStored((previous) => {
				if (!sameProjectionOwner(owner, currentOwner.current)) return previous;
				const value = sameProjectionOwner(previous.owner, owner)
					? previous.value
					: seed.current;
				const next =
					typeof action === "function"
						? (action as (previous: T) => T)(value)
						: action;
				// Preserve React's normal no-op update bailout for this owner.
				if (
					sameProjectionOwner(previous.owner, owner) &&
					Object.is(previous.value, next)
				)
					return previous;
				return { owner, value: next };
			});
		},
		[owner],
	);
	return [
		sameProjectionOwner(stored.owner, owner) ? stored.value : seed.current,
		setValue,
	];
}
