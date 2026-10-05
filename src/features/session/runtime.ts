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

/**
 * The rows to render.
 *
 * The projection's tail wins when it has one. When it is empty and the session has
 * older history, the fetched page is used instead: a session reopened from the
 * past list has a seed frame with no rows, and showing an empty transcript for a
 * conversation that has forty would read as data loss.
 */
export const transcriptRows = (
	projection: SessionProjection | null,
	history: TranscriptEntry[],
): TranscriptEntry[] => {
	if (projection && projection.transcript.length > 0)
		return projection.transcript;
	return history;
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
