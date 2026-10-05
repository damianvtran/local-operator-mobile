/**
 * `POST /api/transcribe`'s answer, read into the app's outcome vocabulary.
 *
 * The daemon has its own sentence for each refusal (contract §4.10) and the design
 * says to show it: "the daemon's own sentence for 402/413/422/503; a retry sentence
 * for 502/transport" (design §2.5). So this module prefers the body's `error`
 * string and falls back to the app's copy only when the body carries none — the
 * relay rewrites its prose, and pinning our own copy of a sentence it owns would
 * describe the state two ways as soon as it changes.
 *
 * Two rules it must not break:
 *
 * - **Never surface a raw upstream payload.** A `502` is "everything else
 *   upstream", and its body may be the provider's transport text; the design
 *   routes it to OUR retry sentence rather than the daemon's. The daemon scrubs
 *   upstream bodies at the client, and this is the second seatbelt.
 * - **A malformed success is refused, not coerced.** A `200` whose body is not
 *   JSON, or whose `text` is not a string, is `failed` — never `""`. Coercing it
 *   would append silence to the draft and report success.
 *
 * `401` is deliberately absent: it is the shared reload rule, raised by the relay
 * transport as a `RelayError` before any status ever reaches this function (see
 * `relay/http.ts`), so a caller applies it once rather than a second time here.
 *
 * No React, no network.
 */

/** The copy this module owns. The daemon's own sentences arrive in the body and
 *  are preferred; these are only the fallbacks for a body that carries none. */
export const STT_COPY = {
	/** 502 / a transport failure: the design's own retry sentence. */
	retry: "Couldn’t transcribe that. Try again.",
	/** 413 fallback, matching the daemon's `STT_MAX_UPLOAD_BYTES` sentence. */
	tooLarge: "Recording is too large — the limit is 20 MB. Try a shorter clip.",
	/** 422 fallback for a missing/empty part or a mime outside the allowlist. */
	badAudio: "That recording could not be read. Try again.",
	/** 503 fallback; the mic is hidden in that state, so this is the race answer. */
	unavailable: "Voice input isn’t available on this machine.",
	/** 500 fallback. */
	failed: "Voice input failed unexpectedly.",
	/** A 200 the client refuses to believe (not JSON, or no `text`). */
	malformed: "Voice input returned an answer this app could not read.",
} as const;

export type TranscribeOutcome =
	| { kind: "transcript"; text: string; path: string }
	/** A landed but blank transcript: the design's one non-alarming sentence. */
	| { kind: "empty" }
	/** Any refusal, already carrying the sentence to show. */
	| { kind: "failed"; sentence: string };

/** The daemon's own sentence from a `{"error": "..."}` body, when it is one. */
function serverSentence(bodyText: string): string | null {
	try {
		const parsed: unknown = JSON.parse(bodyText);
		if (typeof parsed !== "object" || parsed === null) return null;
		const error = (parsed as { error?: unknown }).error;
		return typeof error === "string" && error.trim() !== "" ? error : null;
	} catch {
		/* A non-JSON error body means "no more than the status" (contract §2.1). */
		return null;
	}
}

/** A successful body, in the shape contract §4.10 names. `path` is OMITTED when
 *  empty so the caller stores absence rather than `""`. */
function successOutcome(bodyText: string): TranscribeOutcome {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		return { kind: "failed", sentence: STT_COPY.malformed };
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { kind: "failed", sentence: STT_COPY.malformed };
	}
	const text = (parsed as { text?: unknown }).text;
	if (typeof text !== "string") {
		return { kind: "failed", sentence: STT_COPY.malformed };
	}
	if (text.trim() === "") return { kind: "empty" };
	const rawPath = (parsed as { path?: unknown }).path;
	/* The token that ACTUALLY ran, stored as returned — never re-derived from the
	 * capability. An absent/blank path reads as `""` here and the caller stores it
	 * as absence (no `input_path`), never as an empty string on the wire. */
	const path = typeof rawPath === "string" ? rawPath.trim() : "";
	return { kind: "transcript", text, path };
}

/**
 * Map one transcribe response to an outcome. `status` is the HTTP status and
 * `bodyText` is the raw body; nothing else is needed, so the whole mapping is
 * table-testable without a socket.
 */
export function transcribeOutcome(
	status: number,
	bodyText: string,
): TranscribeOutcome {
	if (status === 200) return successOutcome(bodyText);
	const sentence = serverSentence(bodyText);
	switch (status) {
		case 413:
			return { kind: "failed", sentence: sentence ?? STT_COPY.tooLarge };
		case 422:
			return { kind: "failed", sentence: sentence ?? STT_COPY.badAudio };
		case 402:
			/* A quota refusal — a real sentence the reader must see, so a body
			 * without one falls back to the generic retry rather than a guess. */
			return { kind: "failed", sentence: sentence ?? STT_COPY.retry };
		case 503:
			return { kind: "failed", sentence: sentence ?? STT_COPY.unavailable };
		case 500:
			return { kind: "failed", sentence: sentence ?? STT_COPY.failed };
		case 502:
			/* Never the body: a 502 is upstream by definition and the design routes
			 * it to our retry sentence. */
			return { kind: "failed", sentence: STT_COPY.retry };
		default:
			return { kind: "failed", sentence: sentence ?? STT_COPY.retry };
	}
}
