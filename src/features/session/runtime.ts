/**
 * The session screen's runtime: the relay client, the projection stream, and the
 * connection state that falls out of both.
 *
 * **Two module-level singletons, and both are deliberate.** The projection store
 * holds the last good frame per session so a navigation away and back does not
 * blank a transcript, and the route slot holds the active connection profile. Both
 * must outlive a screen mount; neither belongs in React state.
 *
 * **The route slot is a seam, not a second authority.** `setActiveRoute` is what
 * the app's connection provider calls when a computer is chosen (the provider
 * lands with the connection store — see `app/_layout.tsx`'s own note). Until then
 * the slot is empty, and on the WEB build an empty slot falls through to the page
 * origin (`relay-source.ts`). The slot is never consulted for anything else: a
 * screen cannot ask which computer it is talking to, because it is not a question a
 * screen has.
 *
 * No React in this file's data half — the store and the route slot are plain
 * objects, so `use-session.ts` is the only place that subscribes.
 */

import type { RouteProfile } from "@/connection";
import type { SessionProjection, TranscriptEntry } from "@/contracts";
import {
	type ErrorSurface,
	isRelayMissing,
	type RelayEndpoints,
	RelayError,
	type StreamState,
	type StreamStatus,
} from "@/relay";
import { createProjectionStore } from "@/state";

/** The app's projection store: one instance, because a second would hold a second
 *  answer to "what is the current frame". */
export const sessions = createProjectionStore();

/* ------------------------------------------------------------- the route slot */

let activeRoute: RouteProfile | null = null;
const routeListeners = new Set<() => void>();

export const setActiveRoute = (route: RouteProfile | null): void => {
	activeRoute = route;
	for (const listener of routeListeners) listener();
};

export const getActiveRoute = (): RouteProfile | null => activeRoute;

export const subscribeRoute = (listener: () => void): (() => void) => {
	routeListeners.add(listener);
	return () => {
		routeListeners.delete(listener);
	};
};

/* --------------------------------------------------------------- stream state */

/** What the stream is doing, plus the two facts the C-state derivation needs and
 *  the connection layer does not expose: how long ago the last frame landed, and
 *  whether a reconnect has outlived its deadline. */
export interface StreamFacts {
	state: StreamState;
	lastEnd: StreamStatus["lastEnd"];
	/** Milliseconds since the last accepted frame, or `null` before the first. */
	ageMs: number | null;
	/** A reconnect opened, no snapshot landed, and the deadline has passed. */
	overdue: boolean;
}

export const INITIAL_STREAM_FACTS: StreamFacts = {
	state: "idle",
	lastEnd: undefined,
	ageMs: null,
	overdue: false,
};

/* ------------------------------------------------------------- image loading */

/**
 * The bytes of one attachment, as a data URI.
 *
 * The route requires a LIVE generation: a previous conversation's attachment
 * answers `404 no such image`, which is a normal answer for an old transcript and
 * so resolves to `null` rather than throwing — the caller renders "no longer
 * available" for it.
 */
export const loadAttachments = async (
	endpoints: RelayEndpoints,
	sessionId: string,
	entryId: string,
	index: number,
): Promise<string | null> => {
	try {
		const { bytes, mimeType } = await endpoints.image(
			sessionId,
			entryId,
			index,
		);
		return `data:${mimeType};base64,${toBase64(bytes)}`;
	} catch (error) {
		/* Only the relay's OWN `no such image` 404 is proof the bytes are gone.
		 *  The edge and the gateway answer `404` for "not a tunnel" too, and reading
		 *  that as absence would tell the reader a live attachment vanished when the
		 *  real problem is that the host was never reached — so anything else, the
		 *  unknown-tunnel 404 included, rethrows as a failure to reach the host. */
		if (isRelayMissing(error)) return null;
		throw error;
	}
};

/**
 * Base64 of a byte array, without `Buffer` (which does not exist on native).
 *
 * Written out rather than encoded with a spreading `String.fromCharCode(...bytes)`,
 * which overflows the call stack on exactly the payload this serves — a phone
 * photo is megabytes — in the one code path whose whole job is not to lose the
 * reader's attachment.
 */
export const toBase64 = (bytes: Uint8Array): string => {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] ?? 0;
		const b = bytes[i + 1];
		const c = bytes[i + 2];
		out += alphabet[a >> 2] ?? "";
		out += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] ?? "";
		out +=
			b === undefined
				? "="
				: (alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] ?? "");
		out += c === undefined ? "=" : (alphabet[c & 63] ?? "");
	}
	return out;
};

/* --------------------------------------------------------------- projections */

/** What the transcript should render, plus the one fact the merge is the only
 *  place that can know. */
export interface TranscriptMerge {
	rows: TranscriptEntry[];
	/** True when the held rows have a HOLE under the page: a row exists below
	 *  the page's oldest row that the page did not supply (the relay's pinned
	 *  opener — the only such row in practice), or `rows` is two windows that
	 *  share no row at all. Either way the rows between them are held by
	 *  nobody, which is what `olderThanLoaded` needs to know and cannot see
	 *  from the ids alone. */
	holeBelowPage: boolean;
}

/**
 * The rows to render: ONE list, from the first paint, out of the two sources
 * the screen holds.
 *
 * WHY THIS IS A MERGE AND NOT A SWAP. This used to return the projection whole
 * as soon as it had any rows, discarding the page — so the open painted the
 * page's rows and then replaced them with the projection's different window (a
 * different tail cut, the opener pinned at the head, live rows), which moved
 * every row, re-ran condensation over a different head, and remounted the lot.
 * The two windows are not alternatives: both are TAILS of one append-only
 * conversation, so their union is the honest answer, and the page's rows stay
 * held while the live frame slides its own window on top.
 *
 * HOW THE ORDER IS DECIDED, without a timestamp. The page is the spine (it is
 * the older, already-settled read). The projection's rows that the page also
 * carries are the same rows — the projection's copy wins, because the frame is
 * the live authority and is what the reader is currently watching. A projection
 * row the page does NOT carry follows the last row the page does carry, which
 * places the pinned opener (older than everything, so it precedes them all) at
 * the head and a row appended while the page was in flight at the tail. That is
 * exact for an append-only log — the only order the wire can produce — and it
 * needs no clock, which is what the wire does not carry.
 *
 * The result is bounded by the two windows (`history` + projection rows, so
 * about twice the page) and NEVER reorders or drops a row that is already on
 * screen, which is what keeps a row from remounting when the frame lands.
 */
export const mergeTranscript = (
	projection: SessionProjection | null,
	history: readonly TranscriptEntry[],
): TranscriptMerge => {
	const frame = projection?.transcript ?? [];
	// A seed frame with no rows is the reopened-session shape: the page IS the
	// conversation on this device. And with no page yet the frame is all there is.
	if (frame.length === 0) return { rows: [...history], holeBelowPage: false };
	if (history.length === 0) return { rows: [...frame], holeBelowPage: false };

	const onPage = new Set(history.map((row) => row.id));
	/** The projection's copy of a shared row: the live authority. */
	const live = new Map<string, TranscriptEntry>();
	/** Rows the page does not carry, keyed by the id of the last row the page DOES
	 *  carry before them — `""` for the head, where the pinned opener lands. */
	const insertedAt = new Map<string, TranscriptEntry[]>();
	let anchor = "";
	for (const row of frame) {
		if (onPage.has(row.id)) {
			live.set(row.id, row);
			anchor = row.id;
			continue;
		}
		const bucket = insertedAt.get(anchor);
		if (bucket === undefined) insertedAt.set(anchor, [row]);
		else bucket.push(row);
	}

	/* NO ROW IN COMMON: the two windows have moved past each other, and the frame
	 * is the NEWER one. Which is provable from the wire rather than assumed: both
	 * are tails of one append-only fold, and the frame is built when the stream
	 * opens (after the page read started). If the page were the newer of the two it
	 * would carry every row the frame has that is newer than its own oldest row —
	 * it is the newest pageful — so the absence of ANY shared row means the frame's
	 * rows were appended after the page's last row. Appending them keeps the tail
	 * the newest row, which is the only end the reader is looking at. (A frame that
	 * is instead a stale projection held through a reconnect is the one shape this
	 * does not order — and it is also the shape today paints whole, so this is no
	 * regression on it.)
	 *
	 * The hole is CLAIMED here, one window down: whatever sits between the page's
	 * last row and the frame's first is held by nobody, which is the same fact the
	 * pinned opener states below the page and the same reason the find caveat
	 * fires — silence is a claim, and this shape cannot back it. */
	if (live.size === 0) {
		return { rows: [...history, ...frame], holeBelowPage: true };
	}

	const rows: TranscriptEntry[] = [];
	// A frame row before every shared row is older than the page's oldest — and
	// the page proves the rows between them are not held at all.
	const head = insertedAt.get("");
	if (head !== undefined) rows.push(...head);
	for (const row of history) {
		rows.push(live.get(row.id) ?? row);
		const after = insertedAt.get(row.id);
		if (after !== undefined) rows.push(...after);
	}
	return { rows, holeBelowPage: head !== undefined };
};

/**
 * Whether the conversation demonstrably runs deeper than the rows this device
 * holds — the honest gate for the find sheet's "older messages aren't
 * searched" caveat.
 *
 * SILENCE IS THE CLAIM — "this is everything" — so the gate fires unless a
 * successful page read backs the quiet. Four facts, any one fires:
 *
 *   1. THE READ DID NOT SUCCEED (`read`). A history read that failed, or that
 *      has not settled at all, leaves the device unable to tell a whole
 *      conversation from the relay's capped window (`_cap_tail`: ≤80 rows of
 *      a journal that may run to hundreds) — the shape a cold open past the
 *      cap lands in when its first read fails and no slide is ever watched
 *      (reviewer MAJOR-2 residual / QA Q63-7). Only `"ok"` may back the
 *      silence; every other outcome fires. The founding rule — a claim is
 *      made only when it can be backed — now also binds the claim that
 *      SILENCE makes.
 *   2. A PAGE ROW IS NO LONGER HELD. The conversation only appends and the
 *      window only drops its oldest rows, so a row the last successful page
 *      read carried that is absent from `entries` is a row that exists
 *      conversation-side and cannot be searched. This is what makes the
 *      grow-in-place sequence visible: the page fetched at mount said
 *      `has_more: false` (the conversation WAS complete), the window slid
 *      anyway, and the held page's own rows are the witness — no refetch
 *      needed.
 *   3. `hasMore` WITH NOTHING HELD PAST THE PAGE. The page proves rows older
 *      than its oldest exist, and the held rows do not reach them: the page's
 *      oldest row sits at the head of `entries` (or, subsumed by 2, is not
 *      held at all). This is the reopened-conversation shape (the device holds
 *      one incomplete history page and nothing older).
 *   4. THE WINDOW WAS OBSERVED TO SLIDE (`slid`). The screen watched a held
 *      row leave between two frames, which needs no page at all — the frames
 *      themselves are the proof. Sticky by nature: a dropped row never
 *      re-enters the window, so once true it stays true for the session.
 *
 * THE COMPARISON STAYS EXACT UNDER THE RELAY'S OWN SHAPES, both the page and
 * the projection being contiguous TAILS of one append-only conversation: the
 * projection is `_cap_tail`'s pinned opener + newest ≤79 rows, the page is the
 * newest `limit`, so "held extends past the page" is exactly "the page's
 * oldest row heads `entries`": it is not held at all (`-1`: nothing older can
 * be — case 2), the oldest thing held (`0`: nothing older is), or sits below
 * older rows (don't claim).
 */
export const olderThanLoaded = (input: {
	hasMore: boolean;
	/** The last settled read of the page: `"ok"` (the page facts below are
	 *  current), `"failed"` (the attempt came back with nothing), or
	 *  `"unknown"` (no attempt has settled — in flight, or no endpoints to
	 *  read from). Only `"ok"` can back the silence; the others cannot know
	 *  whether older rows exist, so they fire (the capped-window shape above). */
	read: "ok" | "failed" | "unknown";
	/** The rows the last successful page read returned, oldest first — `[]`
	 *  when no page arrived; whether that reads as completeness is the `read`
	 *  fact's call, never the empty array's. */
	page: readonly TranscriptEntry[];
	entries: readonly TranscriptEntry[];
	/** Whether the screen has watched a held row leave the window. The frames
	 *  only append or slide, so a row that left exists conversation-side. */
	slid: boolean;
	/** Whether the held rows carry a row older than the page's oldest that the
	 *  page did not supply — `mergeTranscript`'s `disjointBelow`, which is the
	 *  pinned opener on a capped frame. The rows BETWEEN that row and the page's
	 *  oldest are held by nobody, so the conversation demonstrably runs deeper
	 *  than this device can search and the caveat must fire. It is a separate
	 *  fact rather than something the id walk below could see: that walk asks
	 *  whether anything is held BELOW the page, and it cannot tell a contiguous
	 *  older run (a second page's rows — searchable) from one pinned row with a
	 *  hole under it (not searchable). */
	holeBelowPage: boolean;
}): boolean => {
	if (input.slid) return true;
	if (input.read !== "ok") return true;
	if (input.page.length === 0) return false;
	const held = new Set(input.entries.map((entry) => entry.id));
	if (input.page.some((row) => !held.has(row.id))) return true;
	if (!input.hasMore) return false;
	if (input.holeBelowPage) return true;
	return (
		input.entries.findIndex((entry) => entry.id === input.page[0]?.id) === 0
	);
};

/** The failure's own surface, or `null`. Used to hand a refusal to the state
 *  derivation without re-deriving anything from a status code. */
export const surfaceOf = (error: unknown): ErrorSurface | null =>
	error instanceof RelayError ? error.surface : null;

/* ------------------------------------------------------------- connectivity */

/**
 * Whether the device has a network route, or `null` when it cannot be known.
 *
 * `null` is a real answer and not a placeholder: `C4` says "Offline. Messages will
 * send when you're back." and painting that over a request that merely failed
 * would be a claim about the reader's network this app cannot back up. Native
 * needs a connectivity package for a route signal (`@react-native-community/
 * netinfo` or `expo-network`), and neither is installed; until one is, native
 * reports unknown and a failure surfaces as its own state (`C2`/`C3`/`C6`), which
 * is the honest reading. The web build has the signal for free.
 */
export const deviceOnline = (): boolean | null => {
	const navigatorLike = globalThis.navigator;
	if (!navigatorLike || typeof navigatorLike.onLine !== "boolean") return null;
	return navigatorLike.onLine;
};
