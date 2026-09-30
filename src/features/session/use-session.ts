import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { useStore } from "zustand";

import type {
	ModelEntry,
	SlashCommand,
	SubagentDetail,
	TranscriptEntry,
} from "@/contracts";
import {
	type ConnectionView,
	connectionView,
	KEEPALIVE_GRACE_S,
	RECONNECT_DEADLINE_MS,
	reconnectDelay,
	relaySentence,
} from "@/features/session/connection-view";
import {
	pageOrigin,
	relaySource,
	type SessionRelaySource,
} from "@/features/session/relay-source";
import {
	deviceOnline,
	getActiveRoute,
	INITIAL_STREAM_FACTS,
	loadAttachments,
	type StreamFacts,
	sessions,
	subscribeRoute,
	transcriptRows,
} from "@/features/session/runtime";
import type { RelayError } from "@/relay";
import { readEntry } from "@/state";

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
	projection: ReturnType<typeof readEntry>["projection"];
	entries: TranscriptEntry[];
	streaming: boolean;
	streamingRowId: string | null;
	connection: ConnectionView;
	commands: SlashCommand[];
	models: ModelEntry[];
	loading: boolean;
	error: RelayError | null;
	/** Loads one attachment's bytes as a data URI, or `null` when the relay no
	 *  longer has them. */
	loadImage: (entryId: string, index: number) => Promise<string | null>;
	/** Loads a child's full detail, which the aggregate roster strips. */
	loadAgent: (jobId: string) => Promise<SubagentDetail | null>;
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
	error.kind === "transport" || error.kind === "ambiguous-delivery";

export const useSessionRuntime = (sessionId: string): SessionRuntime => {
	// The route slot is a plain module value, so a change to it has to re-render
	// this hook explicitly. `useSyncExternalStore` is the whole subscription: the
	// store half of this app is zustand vanilla, and a second state library for one
	// value would be a second answer to "which route is active".
	const route = useSyncExternalStore(
		subscribeRoute,
		getActiveRoute,
		getActiveRoute,
	);
	const source = useMemo(() => relaySource(route, pageOrigin()), [route]);
	const endpoints = source.endpoints;

	const entry = useStore(sessions, () =>
		readEntry(sessions.getState(), sessionId),
	);

	const [facts, setFacts] = useState<StreamFacts>(INITIAL_STREAM_FACTS);
	const [history, setHistory] = useState<TranscriptEntry[]>([]);
	const [commands, setCommands] = useState<SlashCommand[]>([]);
	const [models, setModels] = useState<ModelEntry[]>([]);
	const [error, setError] = useState<RelayError | null>(null);
	const [loading, setLoading] = useState(true);

	/* `reload` is an ACT rather than a value in a dependency array.
	 *
	 * A `reloadToken` state counter is the obvious spelling and it is worse in two
	 * ways: the effects it re-runs have to list a value they never read (so the
	 * dependency is a lie the lint is right to flag), and bumping it re-runs them
	 * through a render pass rather than when the reader asked. Holding the two
	 * entry points in refs means `reload` calls exactly the work it means to redo.
	 */
	const reconnectRef = useRef<() => void>(() => undefined);
	const rereadRef = useRef<() => void>(() => undefined);
	const streamRef = useRef<{ stop: () => void } | null>(null);
	/** A pending reconnect after a transient drop; cleared whenever the stream is. */
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastFrameAt = useRef<number | null>(null);
	/** Which session the current `lastFrameAt` reading belongs to, so a reconnect for
	 *  the SAME session keeps it and a session change does not inherit it. */
	const ageOwner = useRef<string | null>(null);

	/* ------------------------------------------------------------- the stream */
	useEffect(() => {
		const connect = () => {
			if (endpoints === null) {
				setLoading(false);
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
			if (ageOwner.current !== sessionId) {
				ageOwner.current = sessionId;
				lastFrameAt.current = null;
			}
			sessions.getState().beginStream(sessionId);
			setError(null);
			const stream = endpoints.sessionStream(sessionId, {
				onFrame: (frame) => {
					if (frame.kind !== "projection") return;
					lastFrameAt.current = Date.now();
					retries.current = 0;
					sessions.getState().applyFrame(sessionId, frame.data);
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
					}));
				},
				onState: (status) => {
					setFacts((current) => ({
						...current,
						state: status.state,
						lastEnd: status.lastEnd,
						// A rotation is a clean EOF: the lease is over, nothing is wrong, and
						// `overdue` is reset here so a previous loss cannot leak through it.
						overdue: status.lastEnd === "error" ? current.overdue : false,
					}));
				},
				onError: (streamError) => {
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
						setFacts((current) => ({
							...current,
							state: "connecting",
							lastEnd: "error",
							overdue: false,
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
			if (retryTimer.current !== null) clearTimeout(retryTimer.current);
			retryTimer.current = null;
			streamRef.current?.stop();
			streamRef.current = null;
			sessions.getState().endStream(sessionId);
		};
	}, [endpoints, sessionId]);

	/** Consecutive failed reconnects, for the backoff. Reset by any delivered frame,
	 *  so one blip does not leave the next one waiting fifteen seconds. */
	const retries = useRef(0);

	/* --------------------------------------------------- the reconnect deadline */
	useEffect(() => {
		if (facts.state !== "connecting") return;
		const timer = setTimeout(
			() => setFacts((current) => ({ ...current, overdue: true })),
			RECONNECT_DEADLINE_MS,
		);
		return () => clearTimeout(timer);
	}, [facts.state]);

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
	}, []);

	/* A screen that was backgrounded has a stale age and a possibly dead stream:
	 * `beginStream` on return makes the next frame authoritative, which is the
	 * contract's rule for the first frame of a connection. */
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") return;
			lastFrameAt.current = null;
			setFacts((current) => ({ ...current, ageMs: null }));
			// A return from the background is exactly a reload: re-open the stream (which
			// re-syncs from a fresh snapshot) and re-read the requests that may have
			// failed while the app was suspended.
			reconnectRef.current();
			rereadRef.current();
		});
		return () => subscription.remove();
		// No `sessionId` here any more: the two refs already close over the session the
		// screen is showing, and a listener that re-registered on every session change
		// would be re-registering a subscription that never went stale.
	}, []);

	/* ------------------------------------------------- the one-off read requests */
	/* Also an act, for the same reason as the stream: these are the three requests a
	 * refusal interrupted, and `Check again` has to be able to run them. */
	useEffect(() => {
		const read = () => {
			if (endpoints === null) return;
			let cancelled = false;
			setLoading(true);
			Promise.all([
				// One page of history, always: the projection's tail is capped at 80 rows,
				// so a long conversation needs the page beneath it even when the stream is
				// healthy.
				endpoints.history(sessionId).catch(() => null),
				endpoints.commands().catch(() => null),
				endpoints.models().catch(() => null),
			])
				.then(([historyPage, commandList, modelList]) => {
					if (cancelled) return;
					if (historyPage) setHistory(historyPage.entries);
					if (commandList) setCommands(commandList.commands);
					if (modelList) setModels(modelList.models);
				})
				.finally(() => {
					if (!cancelled) setLoading(false);
				});
			return () => {
				cancelled = true;
			};
		};
		rereadRef.current = () => {
			void read();
		};
		const cancel = read();
		return cancel;
	}, [endpoints, sessionId]);

	/* ------------------------------------------------------------- derivations */
	const projection = entry.projection;
	const entries = useMemo(
		() => transcriptRows(projection, history),
		[projection, history],
	);

	const connection = useMemo((): ConnectionView => {
		const factsForView = {
			// A null route with no origin means there is nothing to talk to; the
			// screen renders its own "not connected" state for that rather than a
			// connection state, so the derivation is not asked.
			phase:
				error !== null || source.reason === "no-route"
					? ("refused" as const)
					: ("live" as const),
			stream: facts.state,
			lastEnd: facts.lastEnd,
			reconnectExpired: facts.overdue,
			online: deviceOnline(),
			error,
			entry,
			ended: projection?.ended === true,
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
			phaseDetail: error === null ? null : (relaySentence(error) ?? null),
			phaseSurface: error === null ? null : error.surface,
		};
		return connectionView(factsForView);
	}, [error, source.reason, facts, entry, projection, route]);

	const loadImage = useCallback(
		async (entryId: string, index: number): Promise<string | null> => {
			if (endpoints === null) return null;
			return loadAttachments(endpoints, sessionId, entryId, index);
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

	const reload = useCallback(() => {
		reconnectRef.current();
		rereadRef.current();
	}, []);

	const streamingRowId = useMemo(() => {
		if (projection?.streaming !== true) return null;
		const tail = entries[entries.length - 1];
		return tail ? tail.id : null;
	}, [projection?.streaming, entries]);

	return {
		source,
		projection,
		entries,
		streaming: projection?.streaming === true,
		streamingRowId,
		connection,
		commands,
		models,
		loading,
		error,
		loadImage,
		loadAgent,
		reload,
	};
};

/** Exposed for the connection-state test: the window the `C3` rule is derived
 *  from, re-exported so a screen cannot quietly use a different one. */
export { KEEPALIVE_GRACE_S };
