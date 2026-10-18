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
	relaySource,
	type SessionRelaySource,
} from "@/features/session/relay-source";
import {
	deviceOnline,
	INITIAL_STREAM_FACTS,
	loadAttachments,
	loadVideoSource,
	mergeTranscript,
	olderThanLoaded,
	rowIdentity,
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
	error.kind === "transport" || error.kind === "ambiguous-delivery";

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

	const entry = useStore(sessions, () =>
		readEntry(sessions.getState(), sessionId),
	);

	const [facts, setFacts] = useState<StreamFacts>(INITIAL_STREAM_FACTS);
	const [history, setHistory] = useState<TranscriptEntry[]>([]);
	/** Whether the last successful page read said the conversation runs deeper
	 *  than the page's oldest row. The find caveat reads it together with the
	 *  page's own rows (`history`), so the facts move with every successful page
	 *  — a reload that finds the transcript complete must retract the claim
	 *  rather than keep it stale. A failed read leaves this false — and it is
	 *  `historyRead` beside it, not this default, that keeps the failure from
	 *  reading as completeness. */
	const [pageHasMore, setPageHasMore] = useState(false);
	/** The last settled history read: `"ok"` once a page has landed, `"failed"`
	 *  when the most recent attempt came back with nothing, `"unknown"` before
	 *  any attempt settles (in flight, or no endpoints to read from). The find
	 *  caveat's first fact: only `"ok"` may back its silence, because a capped
	 *  projection (≤80 rows) cannot be told from a whole conversation without
	 *  a read (reviewer MAJOR-2 residual / QA Q63-7). */
	const [historyRead, setHistoryRead] = useState<"ok" | "failed" | "unknown">(
		"unknown",
	);
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
	}, [endpoints, sessionId, source.reason]);

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
			/* The history read records its OUTCOME as well as its result: a failure is
			 * swallowed here (the screen's connection state owns the sentence), but it
			 * must not read as completeness for the find caveat — a device that cannot
			 * read the page cannot know whether a capped window holds a whole
			 * conversation (reviewer MAJOR-2 residual / QA Q63-7). */
			const readHistory = endpoints.history(sessionId).then(
				(page) => {
					if (cancelled) return;
					setHistory(page.entries);
					// The find caveat reads this, so it moves with every successful page —
					// a reload that finds the transcript complete must retract the claim
					// rather than keep it stale. It describes the PAGE; where the page and
					// the held rows must agree is `olderThanLoaded`.
					setPageHasMore(page.has_more);
					setHistoryRead("ok");
				},
				() => {
					if (!cancelled) setHistoryRead("failed");
				},
			);
			Promise.all([
				// One page of history, always: the projection's tail is capped at 80 rows,
				// so a long conversation needs the page beneath it even when the stream is
				// healthy.
				readHistory,
				endpoints.commands().catch(() => null),
				endpoints.models().catch(() => null),
			])
				.then(([, commandList, modelList]) => {
					if (cancelled) return;
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
	/* ONE list, from the first paint, out of both sources: the page's rows stay
	 * held when the live frame lands, so the open paints its page and then GROWS
	 * with the frame instead of being replaced by it (`mergeTranscript`). The
	 * `holeBelowPage` fact rides along because the merge is the only place that
	 * can see it, and the find caveat needs it (see `olderThanLoaded`). */
	const merged = useMemo(
		() => mergeTranscript(projection, history),
		[projection, history],
	);
	const entries = merged.rows;
	/* The frame watch behind the find caveat's third proof (reviewer MAJOR-2):
	 * a row held in an earlier frame and gone from this one left the ≤80-row
	 * tail window — the frames only append or slide, so it still exists
	 * conversation-side and cannot be searched. This is the one channel that
	 * needs no history page at all (the failed-read case), and it is sticky on
	 * purpose: nothing re-enters the window, so a claim that could flicker off
	 * would be a lie twice. The PREVIOUS frame lives in a ref; only the verdict
	 * is state.
	 *
	 * BY IDENTITY, NOT BY ID (review round 1, BLOCKER-1 secondary). The two
	 * folds disagree about a tool row's id (`rowIdentity`), so a later frame
	 * that rebuilds a row under the page's naming swaps `tc-call-x` for
	 * `<message>:call-x` — the SAME row, re-labelled. Comparing raw ids read
	 * that as a slide and made the caveat claim a row had left the window when
	 * only its label had changed. Identity is what the claim is about. */
	const heldIdsRef = useRef<{ sessionId: string; ids: Set<string> } | null>(
		null,
	);
	const [slidUnderWindow, setSlidUnderWindow] = useState(false);
	useEffect(() => {
		const ids = new Set(entries.map(rowIdentity));
		const before = heldIdsRef.current;
		heldIdsRef.current = { sessionId, ids };
		if (before === null) return;
		if (before.sessionId !== sessionId) {
			// Another conversation's rows are not this one's: start clean.
			setSlidUnderWindow(false);
			return;
		}
		for (const id of before.ids) {
			if (!ids.has(id)) {
				setSlidUnderWindow(true);
				return;
			}
		}
	}, [entries, sessionId]);
	const olderRowClaim = useMemo(
		() =>
			olderThanLoaded({
				hasMore: pageHasMore,
				read: historyRead,
				page: history,
				entries,
				slid: slidUnderWindow,
				holeBelowPage: merged.holeBelowPage,
			}),
		[
			pageHasMore,
			historyRead,
			history,
			entries,
			slidUnderWindow,
			merged.holeBelowPage,
		],
	);

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
			reconnectExpired: facts.overdue,
			online: deviceOnline(),
			error: error ?? providerConnection.lastError,
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
		olderThanLoaded: olderRowClaim,
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
		supplementCommand,
		reload,
	};
};

/** Exposed for the connection-state test: the window the `C3` rule is derived
 *  from, re-exported so a screen cannot quietly use a different one. */
export { KEEPALIVE_GRACE_S };
