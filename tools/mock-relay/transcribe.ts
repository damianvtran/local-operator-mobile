/**
 * `POST /api/transcribe` — the voice-upload route, as the mock answers it.
 *
 * The daemon's own route is `mobile/daemon.py` `api_transcribe`, and the
 * contract is `docs/relay/contract.md` §4.10. This module exists because the
 * route's answer is a *multipart* one: the daemon reads the `audio` PART, so a
 * mock that keyed off the request's `Content-Type` header alone (which is what
 * stood here before) could not tell a missing file from a bad mime, and could
 * not return the success shape at all — it answered a `200 {text: "",
 * degraded: ["stt"]}` that no client is written to read.
 *
 * WHAT IS MODELLED, and in the daemon's own ORDER (each refusal is checked only
 * after the ones above it, so a bad mime with no backend is the mime's 422, not
 * the 503):
 *
 *   1. declared `Content-Length` over the cap  → `413 STT_TOO_LARGE_ERROR`
 *   2. a body that is not multipart            → `422 invalid multipart body`
 *   3. no `audio` file part                    → `422 audio file is required`
 *   4. an empty `audio` file part              → `422 audio file is empty`
 *   5. a payload over the cap                  → `413`
 *   6. a mime outside the allowlist            → `422 Unsupported audio format: X.`
 *   7. no executable voice path                → `503 {code: "stt_unavailable"}`
 *   8. otherwise                               → `200 {text, provider, model, path}`
 *
 * WHERE THE COPY COMES FROM. Refusals whose sentence is fixed are served as the
 * CORPUS's own bytes (`TRANSCRIBE_FIXTURES` — `transcribe-413-declared` and
 * `transcribe-missing-audio`, both captured live), because a re-typed sentence is
 * a sentence that can drift. The rest are built here: `invalid multipart body`
 * and `audio file is empty` were never captured, and the bad-mime sentence
 * interpolates the request's own media type.
 *
 * WHAT IS DELIBERATELY NOT MODELLED (so the next reader knows the edge of this
 * fixture rather than inferring it is complete):
 *
 *   - **The provider refusal branch** (`402`, `502`, a provider-mapped 4xx) and
 *     the `500`. Reaching those needs a real transcription backend and an
 *     upstream that fails on demand; the mock's job is the transport shape and
 *     the status→sentence mapping a client drives, and a client's mapping for
 *     those statuses is exercised by the app's own unit tests against captured
 *     bodies. A scenario cannot make the mock return one.
 *   - **The byte cap's two arms differ in reachability.** Both are modelled —
 *     the declared `Content-Length` (with the daemon's 1 MB framing slack, which
 *     is what a >20 MB clip trips) AND the post-read `audio` payload length. The
 *     post-read arm is reachable only for a body between 20 MB and 21 MB, since
 *     the mock has no body ceiling by default: a payload one byte over the cap
 *     whose multipart framing still fits inside the declared arm's slack. BOTH
 *     arms are walked by `transcribe.test.ts` — the declared one at 21 MB + 64
 *     and the post-read one at 20 MB + 1.
 *   - **`language`/`prompt`/`model` semantics.** The parts are accepted and not
 *     read: the request has no `model` field at all. The success answer's `model`
 *     is the SCENARIO's declared `answer.model` — the value the daemon would have
 *     taken from the provider response — not an echo of the request. The daemon's
 *     own validators for the two text fields are not reproduced.
 *   - **A parameter whose value contains a `;`.** `parseMultipart` splits the
 *     Content-Disposition on `;` rather than running starlette's stricter
 *     parser, so a `filename` carrying one would be read short. No recorder
 *     produces one; a fixture that needs the difference should grow a real
 *     parser here rather than be assumed correct.
 *
 * THE DIVERGENCE SET DOES NOT COVER THIS. `divergences.ts` is the ten *fixed*
 * fall-through divergences a QA pass once found, not a general contract check:
 * a route added later is simply not in that list, and this fixture therefore
 * sits OUTSIDE it. That is the recurring shape of this harness — the mock
 * lagged the daemon on `GET /api/asks` too, and cost a QA round a shim — so it
 * is named here rather than left to be discovered.
 */

import type { Json } from "../lib/json.ts";

/** The daemon's `STT_MAX_UPLOAD_BYTES` (`daemon.py`). */
export const STT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** The daemon's multipart-framing slack on the declared length: the header may
 *  exceed the payload by the framing bytes without the clip being too large. */
export const STT_DECLARED_SLACK_BYTES = 1 << 20;

/** The daemon's `STT_MIME_ALLOWLIST`, lowercased bare types (codec parameters
 *  are stripped before the comparison, so `audio/webm;codecs=opus` passes). */
export const STT_MIME_ALLOWLIST: ReadonlySet<string> = new Set([
	"audio/mp4",
	"audio/webm",
	"audio/ogg",
	"audio/mpeg",
	"audio/wav",
	"audio/x-m4a",
	"audio/aac",
]);

/** The daemon's `STT_TOO_LARGE_ERROR`, derived from the cap the same way so the
 *  copy cannot claim a limit this file does not enforce. */
export const STT_TOO_LARGE_ERROR = `Recording is too large — the limit is ${Math.floor(STT_MAX_UPLOAD_BYTES / (1024 * 1024))} MB. Try a shorter clip.`;

/** The `503` sentence and its machine code (contract §4.10). */
export const STT_UNAVAILABLE_ERROR =
	"Voice input isn't available on this machine.";
export const STT_UNAVAILABLE_CODE = "stt_unavailable";

/** The success answer's `{text, provider, model, path}` (contract §4.10). */
export interface TranscribeAnswer {
	text: string;
	provider?: string;
	model?: string | null;
	path?: string;
}

/** One part of a multipart body, reduced to what the route reads. */
export interface MultipartPart {
	/** The `name` of the part's Content-Disposition, or `""` when it carries none. */
	name: string;
	/** The part's `filename`, or `null` when it is a plain field (not a file). */
	filename: string | null;
	/** The part's bare, lowercased Content-Type, or `null` when it carries none. */
	contentType: string | null;
	/** The part's payload size in bytes. */
	size: number;
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

/**
 * The boundary a multipart Content-Type declares, or `null`.
 * Quoted and bare forms are both accepted, as starlette accepts both.
 */
export function multipartBoundary(contentType: string): string | null {
	for (const parameter of contentType.split(";").slice(1)) {
		const [rawName, ...rest] = parameter.split("=");
		if (rawName?.trim().toLowerCase() !== "boundary") continue;
		const value = rest.join("=").trim().replace(/^"|"$/g, "");
		if (value !== "") return value;
	}
	return null;
}

/**
 * The parts of a multipart body, or `null` when the body is not one.
 *
 * `null` is the daemon's `422 invalid multipart body`: a body with no boundary
 * parameter, no delimiter, or a part whose headers never end cannot be read as
 * a form at all. An EMPTY body is `null` too and not an empty list — the
 * daemon's `await request.form()` raises on it, and the route's own arm for
 * "no audio" is a form it could read and found no file in.
 */
export function parseMultipart(
	body: Buffer,
	contentType: string,
): MultipartPart[] | null {
	const boundary = multipartBoundary(contentType);
	if (boundary === null) return null;
	const delimiter = Buffer.from(`--${boundary}`);
	const parts: MultipartPart[] = [];
	let cursor = body.indexOf(delimiter);
	if (cursor === -1) return null;
	while (cursor !== -1) {
		const afterDelimiter = cursor + delimiter.length;
		// The closing delimiter (`--boundary--`) ends the body.
		if (
			body.subarray(afterDelimiter, afterDelimiter + 2).toString("latin1") ===
			"--"
		)
			break;
		const headerStart = body.indexOf(CRLF, afterDelimiter);
		if (headerStart === -1) return null;
		const headerEnd = body.indexOf(HEADER_END, headerStart);
		if (headerEnd === -1) return null;
		const headers = parseHeaders(
			body.subarray(headerStart + 2, headerEnd).toString("latin1"),
		);
		const contentStart = headerEnd + HEADER_END.length;
		const next = body.indexOf(delimiter, contentStart);
		if (next === -1) return null;
		// The CRLF that precedes the next delimiter belongs to the framing, not
		// to the part: a part is empty exactly when nothing sits between the
		// blank line and that CRLF.
		let contentEnd = next;
		if (
			contentEnd - 2 >= contentStart &&
			body.subarray(contentEnd - 2, contentEnd).equals(CRLF)
		)
			contentEnd -= 2;
		const disposition = headers.get("content-disposition") ?? "";
		parts.push({
			name: dispositionParameter(disposition, "name") ?? "",
			filename: dispositionParameter(disposition, "filename"),
			contentType:
				headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
				null,
			size: Math.max(0, contentEnd - contentStart),
		});
		cursor = next;
	}
	return parts;
}

/** A part's header block, lowercased names, last value winning. */
function parseHeaders(raw: string): Map<string, string> {
	const headers = new Map<string, string>();
	for (const line of raw.split("\r\n")) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		headers.set(
			line.slice(0, separator).trim().toLowerCase(),
			line.slice(separator + 1).trim(),
		);
	}
	return headers;
}

/** The quotes a quoted parameter may wear. A literal, so it is compiled once. */
const SURROUNDING_QUOTES = /^"|"$/g;

/**
 * A `key="value"` parameter of a Content-Disposition, or `null`.
 *
 * Built by splitting rather than by a per-call `RegExp` (biome's
 * `useTopLevelRegex`): the parameter names are compared case-insensitively, and
 * the value keeps whatever the quotes did not wrap. A value that itself
 * contains a `;` — never a `name` or a `filename` a recorder sends — would be
 * cut short; starlette's parser is stricter, and a fixture that needs the
 * difference should grow one here rather than be assumed correct.
 */
function dispositionParameter(disposition: string, key: string): string | null {
	for (const parameter of disposition.split(";")) {
		const separator = parameter.indexOf("=");
		if (separator <= 0) continue;
		if (
			parameter.slice(0, separator).trim().toLowerCase() !== key.toLowerCase()
		)
			continue;
		return parameter
			.slice(separator + 1)
			.trim()
			.replace(SURROUNDING_QUOTES, "");
	}
	return null;
}

/** What the route needs to answer one request. */
export interface TranscribeRequest {
	/** The declared `Content-Length`, when the request carries a numeric one. */
	declaredLength: number | null;
	/** The raw body bytes. Binary payloads are NEVER decoded to a string first. */
	body: Buffer;
	/** The request's `Content-Type` header (the whole value, parameters included). */
	contentType: string;
	/** Whether the pinned world advertises an executable voice path. */
	available: boolean;
	/** The world's declared success answer; the default stands in when it is absent. */
	answer?: TranscribeAnswer;
}

/**
 * The captured refusals whose COPY this route serves verbatim.
 *
 * The corpus is the source of a sentence (`fixtures.ts`'s own rule): these two
 * refusals were captured from a live relay, so replaying the fixture is what
 * keeps the words the daemon's rather than a copy that drifts. The refusals with
 * no entry are BUILT, and that is a statement about the corpus rather than a
 * licence: `audio file is empty` and `invalid multipart body` were never
 * captured, and the bad-mime sentence interpolates the request's own media type.
 */
export const TRANSCRIBE_FIXTURES = {
	tooLarge: "transcribe-413-declared",
	missingAudio: "transcribe-missing-audio",
} as const;

/** The mock's default success answer: one deterministic transcript. */
export const DEFAULT_TRANSCRIBE_ANSWER: Required<
	Pick<TranscribeAnswer, "text" | "provider" | "path">
> & { model: string | null } = {
	text: "Add a retry to the send path.",
	provider: "radient",
	model: null,
	path: "provider_stt_radient",
};

/** Whether a part is a file the route will accept as the upload. */
const isFilePart = (part: MultipartPart): boolean => part.filename !== null;

/** The media type for the 422's sentence: the bare type, or `unknown`. */
const mediaTypeOrUnknown = (part: MultipartPart): string =>
	part.contentType ?? "unknown";

/** One transcribed request's answer: a status, a body, and — when one was
 *  captured — the fixture whose bytes ARE that answer. */
export interface TranscribeResult {
	status: number;
	body: Json;
	fixture?: string;
}

/**
 * The status and body for one `POST /api/transcribe`.
 *
 * Pure: every input a request carries is an argument, so the whole table is
 * testable without a socket, and the route's only job is to read those inputs
 * off the wire, hand them here, and send whatever comes back.
 */
export function transcribeResponse(
	request: TranscribeRequest,
): TranscribeResult {
	const { declaredLength, body, contentType, available } = request;
	// 1. The declared-length fast path (the daemon's `Content-Length` arm), with
	//    the same framing slack: a 20 MB clip plus a few hundred bytes of
	//    multipart framing is not "too large".
	if (
		declaredLength !== null &&
		declaredLength > STT_MAX_UPLOAD_BYTES + STT_DECLARED_SLACK_BYTES
	)
		return {
			status: 413,
			body: { error: STT_TOO_LARGE_ERROR },
			fixture: TRANSCRIBE_FIXTURES.tooLarge,
		};
	const parts = parseMultipart(body, contentType);
	if (parts === null)
		return { status: 422, body: { error: "invalid multipart body" } };
	const audio = parts.find((part) => part.name === "audio");
	if (audio === undefined || !isFilePart(audio))
		return {
			status: 422,
			body: { error: "audio file is required" },
			fixture: TRANSCRIBE_FIXTURES.missingAudio,
		};
	if (audio.size === 0)
		return { status: 422, body: { error: "audio file is empty" } };
	if (audio.size > STT_MAX_UPLOAD_BYTES)
		return {
			status: 413,
			body: { error: STT_TOO_LARGE_ERROR },
			fixture: TRANSCRIBE_FIXTURES.tooLarge,
		};
	if (audio.contentType === null || !STT_MIME_ALLOWLIST.has(audio.contentType))
		return {
			status: 422,
			body: {
				error: `Unsupported audio format: ${mediaTypeOrUnknown(audio)}.`,
			},
		};
	if (!available)
		return {
			status: 503,
			body: { error: STT_UNAVAILABLE_ERROR, code: STT_UNAVAILABLE_CODE },
		};
	return {
		status: 200,
		body: {
			text: request.answer?.text ?? DEFAULT_TRANSCRIBE_ANSWER.text,
			provider: request.answer?.provider ?? DEFAULT_TRANSCRIBE_ANSWER.provider,
			model: request.answer?.model ?? DEFAULT_TRANSCRIBE_ANSWER.model,
			// The token that ACTUALLY ran: a real `provider_stt_*` key, because the
			// client stores the returned value as the send envelope's `input_path`
			// and must never re-derive it from the cached capability.
			path: request.answer?.path ?? DEFAULT_TRANSCRIBE_ANSWER.path,
		},
	};
}

/** Read the declared `Content-Length` as a number, or `null` when it is not one. */
export function declaredLengthOf(
	header: string | string[] | undefined,
): number | null {
	const raw = Array.isArray(header) ? header[0] : header;
	if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
	return Number(raw.trim());
}
