/**
 * Dictation: the pure logic behind the composer's voice mic.
 *
 * Ported from the reference implementation the design names as authoritative —
 * `local_operator/mobile/web/src/lib/dictation.ts` — with the browser's DOM half
 * (MediaRecorder, streams, the request) left behind: this module owns the RULES,
 * `stt/recorder.ts` owns the platform, and `stt/dictate.ts` owns the request. The
 * web file is the semantics to match, not code to transliterate, so the two stay
 * comparable by reading rather than by sharing a package.
 *
 * Provenance contract (`input-mode-v1`, history-based and STICKY): once the window
 * since the draft's last accepted send/clear has SEEN typing or a dictation, it
 * stays seen — deletion and edits do not un-see it, and the empty draft is what
 * resets the window (a fresh message starts clean). The dictated SPANS survive
 * only to name the `input_path` of the most recent dictation still present in the
 * sent text.
 *
 * No React, no React Native, no network.
 */

import type { InputMode } from "@/contracts";

/** The recorder's hard stop; the server's 20 MB byte cap is the other bound. */
export const MAX_RECORDING_MS = 120_000;

/** Hoisted: matched once per append, but a literal in the body is recompiled. */
const TRAILING_WHITESPACE = /\s$/;

/** The same bound in the unit expo-audio's `record({ forDuration })` takes. */
export const MAX_RECORDING_SECONDS = MAX_RECORDING_MS / 1000;

/**
 * First supported wins. `audio/mp4` leads because iOS records AAC/mp4
 * (`expo-audio`'s m4a preset); the rest follow the codecs Android and the web
 * target prefer. `""` means "platform default", which the server's allowlist
 * still has to recognise — hence the wide server allowlist.
 */
export const RECORDER_MIME_CANDIDATES = [
	"audio/mp4",
	"audio/webm;codecs=opus",
	"audio/webm",
	"audio/ogg;codecs=opus",
	"audio/mpeg",
	"audio/wav",
] as const;

export function pickRecorderMime(
	isSupported: (mime: string) => boolean,
): string {
	for (const mime of RECORDER_MIME_CANDIDATES) {
		if (isSupported(mime)) return mime;
	}
	return "";
}

/** `m:ss` for the recording status row. */
export function formatDuration(seconds: number): string {
	const safe = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(safe / 60);
	return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * Append a transcript to the draft — never replace, never reorder.
 *
 * With a whitespace-only base this returns the CLEANED join (no leading space,
 * trailing newlines collapsed to the separator); otherwise the join keeps the
 * existing text byte-for-byte and adds exactly one separator only when it is
 * missing. No punctuation surgery: the transcript keeps its own casing and
 * punctuation. The caller MUST NOT `focus()` the field afterwards — a
 * programmatic focus pops the iOS keyboard over wherever the reader moved on to
 * (design §2.5/U1).
 */
export function joinDraft(base: string, transcript: string): string {
	const cleaned = transcript.trim();
	if (cleaned === "") return base;
	if (base.trim() === "") return cleaned;
	return TRAILING_WHITESPACE.test(base)
		? `${base}${cleaned}`
		: `${base} ${cleaned}`;
}

/** One dictated range still tracked on the draft. */
export interface DictatedSpan {
	start: number;
	/** Exclusive. */
	end: number;
	path: string;
}

/** One edit between two draft strings, in OLD-text coordinates. */
export interface DraftEdit {
	start: number;
	/** Exclusive end in the old text. */
	endOld: number;
	/** Exclusive end in the new text. */
	endNew: number;
}

/**
 * The one edit between `previous` and `next` (common prefix + suffix).
 * A replacement is one edit; equal strings are no edit at all.
 */
export function computeEdit(previous: string, next: string): DraftEdit | null {
	if (previous === next) return null;
	let start = 0;
	const max = Math.min(previous.length, next.length);
	while (start < max && previous[start] === next[start]) start++;
	let endOld = previous.length;
	let endNew = next.length;
	while (
		endOld > start &&
		endNew > start &&
		previous[endOld - 1] === next[endNew - 1]
	) {
		endOld--;
		endNew--;
	}
	return { start, endOld, endNew };
}

export interface DictationProvenance {
	/** Any user edit since the window opened (sticky). */
	sawTyping: boolean;
	/** Any dictation since the window opened (sticky). */
	sawDictation: boolean;
	/** Dictated ranges — `input_path` bookkeeping only, never the mode. */
	spans: DictatedSpan[];
	/** The newest dictation's path, kept for the history edge. */
	lastPath: string;
}

export function emptyProvenance(): DictationProvenance {
	return { sawTyping: false, sawDictation: false, spans: [], lastPath: "" };
}

/** Record one dictation: sticky flag, the new span, and its path. */
export function noteDictation(
	provenance: DictationProvenance,
	span: DictatedSpan,
): DictationProvenance {
	return {
		...provenance,
		sawDictation: true,
		spans: [...provenance.spans, span],
		lastPath: span.path || provenance.lastPath,
	};
}

/**
 * Classify one user edit: sticky `sawTyping`, and spans intersect-trimmed.
 *
 * A span the edit touches stops counting as a dictated range (the text under it
 * is no longer the transcript that came back), while spans strictly after the
 * edited range shift with the delta. The MODE is not affected — history is sticky
 * by the frozen contract.
 */
export function applyEdit(
	provenance: DictationProvenance,
	edit: DraftEdit,
): DictationProvenance {
	const delta = edit.endNew - edit.endOld;
	const spans = provenance.spans
		.filter((span) => span.end <= edit.start || span.start >= edit.endOld)
		.map((span) =>
			span.start >= edit.endOld
				? { ...span, start: span.start + delta, end: span.end + delta }
				: span,
		);
	return { ...provenance, sawTyping: true, spans };
}

/**
 * Reset the window when the draft is emptied: the frozen contract's one reset
 * (`empty draft`). Whitespace-only counts as empty, matching `joinDraft`'s own
 * reading of a blank base — a space left behind must not carry a dictation's
 * provenance into the next message.
 */
export function resetOnEmptyDraft(
	provenance: DictationProvenance,
	draft: string,
): DictationProvenance {
	return draft.trim() === "" ? emptyProvenance() : provenance;
}

export interface DraftAnnotation {
	input_mode: InputMode;
	input_path?: string;
}

/**
 * The annotation a send carries. Mode: both seen is a mixed message; only a
 * dictation is dictated; otherwise typed (sent explicitly by new clients —
 * absence is the legacy reading for everyone else). Path: the most recent
 * dictated span still present; on the deletion edge (nothing present but a
 * dictation was seen) the last recorded path, so the annotation never contradicts
 * the sticky mode.
 *
 * The path is ALWAYS the token the transcribe response actually returned (stored
 * as the span's `path`), never re-derived from `capabilities.stt.path` — the
 * capability names what would run, the response names what did.
 *
 * When there is no path, the field is OMITTED, not `""`: absence is the legacy
 * reading and an empty string would be a malformed present value the relay
 * refuses (422) rather than drops (design §2.1).
 */
export function annotationForSend(
	provenance: DictationProvenance,
): DraftAnnotation {
	const mode: InputMode = !provenance.sawDictation
		? "typed"
		: provenance.sawTyping
			? "mixed"
			: "dictated";
	if (mode === "typed") return { input_mode: mode };
	const span = provenance.spans[provenance.spans.length - 1];
	const path = span?.path || provenance.lastPath;
	return path ? { input_mode: mode, input_path: path } : { input_mode: mode };
}
