/**
 * The parse boundary: the one place a relay payload becomes a typed value.
 *
 * Every frame the app consumes — an HTTP body, an SSE `data:` payload — goes
 * through here, and a malformed frame ends as a `RelayFrameError` carrying the
 * payload name, the failing paths and the raw value. Nothing throws out of a
 * schema and nothing is coerced: a screen that renders a number the relay never
 * sent is a worse outcome than a card that says "something new from your
 * computer", and the contract's own additive-evolution rule (an unknown field
 * must not break an old client) is enforced by the schemas' loose objects, not
 * by being permissive here.
 *
 * `safeParse` is the form callers in a stream want (a bad frame is data, not an
 * exception — it must not tear the stream down and must not be retried);
 * `parse` is the form a request wants, where a body that does not match its
 * route is an error the caller acts on once.
 */

import { type Payload, SCHEMAS, type SchemaName } from "./schemas";

/** One failing path inside a frame, flattened from zod's issue tree. */
export interface FrameIssue {
	/** Dotted path into the payload; `""` for the value itself. */
	path: string;
	/** Zod's issue code, e.g. `invalid_type`, `invalid_value`, `too_small`. */
	code: string;
	message: string;
}

/**
 * A frame that did not match its schema, or was not JSON at all.
 *
 * It is deliberately NOT a transport error: the relay answered, the bytes were
 * wrong. A caller must not retry it (the same bytes will fail again) and must
 * not clear a retry envelope on it (`retry-envelope.ts` treats it as
 * ambiguous-safe: the command was never proven admitted, so the envelope stays).
 */
export class RelayFrameError extends Error {
	override readonly name = "RelayFrameError";

	constructor(
		/** Which schema rejected it — the caller's own name for the payload. */
		readonly payload: SchemaName,
		readonly issues: readonly FrameIssue[],
		/** The offending value, kept for diagnostics. Never rendered to a user. */
		readonly raw: unknown,
		cause?: unknown,
	) {
		super(
			`${payload}: ${issues.length} issue${issues.length === 1 ? "" : "s"} — ` +
				issues
					.slice(0, 3)
					.map((issue) => `${issue.path || "<root>"} ${issue.message}`)
					.join("; "),
		);
		if (cause !== undefined) this.cause = cause;
	}

	/** A stable, loggable summary. Contains no payload content by design: a frame
	 *  can carry transcript text and a hostname, and neither belongs in a log. */
	get summary(): string {
		const paths = this.issues.map((issue) => issue.path || "<root>").join(",");
		return `${this.payload} rejected (${paths})`;
	}
}

export function isRelayFrameError(value: unknown): value is RelayFrameError {
	return value instanceof RelayFrameError;
}

/** A successful parse, or the typed rejection. */
export type ParseResult<K extends SchemaName> =
	| { ok: true; data: Payload<K> }
	| { ok: false; error: RelayFrameError };

/** Flattens zod's issue list. Paths are joined with `.` so a table of issues
 *  reads like the wire; an empty path names the value itself, which is what an
 *  "expected object, received array" rejection produces. */
function toIssues(error: {
	issues: readonly { path: PropertyKey[]; code: string; message: string }[];
}): FrameIssue[] {
	return error.issues.map((issue) => ({
		path: issue.path.map((segment) => String(segment)).join("."),
		code: issue.code,
		message: issue.message,
	}));
}

/**
 * Validate `value` against the named schema without throwing.
 *
 * Use this wherever a bad frame is expected to be survivable — an SSE push, a
 * cached body replayed at cold start. `RelayFrameError` is returned, never
 * thrown, so a stream loop cannot accidentally die on one frame.
 */
export function safeParsePayload<K extends SchemaName>(
	payload: K,
	value: unknown,
): ParseResult<K> {
	const result = SCHEMAS[payload].safeParse(value);
	if (result.success) return { ok: true, data: result.data as Payload<K> };
	return {
		ok: false,
		error: new RelayFrameError(payload, toIssues(result.error), value),
	};
}

/** Validate `value`, throwing `RelayFrameError` on a mismatch. Use at a request
 *  boundary, where a wrong body means the route or the build is wrong. */
export function parsePayload<K extends SchemaName>(
	payload: K,
	value: unknown,
): Payload<K> {
	const result = safeParsePayload(payload, value);
	if (result.ok) return result.data;
	throw result.error;
}

/**
 * Parse a JSON text body and validate it in one step.
 *
 * Kept separate from `parsePayload` because the failure modes differ in a way
 * the UI cares about: invalid JSON means the responder is not the relay (a
 * captive portal or a proxy answered), while a validation failure means it is
 * the relay and this client's reading of it is stale. Both end in a
 * `RelayFrameError` so one handler covers them; the issue code `invalid_json`
 * is the discriminator.
 */
export function parseJsonPayload<K extends SchemaName>(
	payload: K,
	text: string,
): Payload<K> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (cause) {
		throw new RelayFrameError(
			payload,
			[{ path: "", code: "invalid_json", message: "body is not JSON" }],
			text,
			cause,
		);
	}
	return parsePayload(payload, value);
}

/** As `safeParsePayload`, for a JSON text body. */
export function safeParseJsonPayload<K extends SchemaName>(
	payload: K,
	text: string,
): ParseResult<K> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (cause) {
		return {
			ok: false,
			error: new RelayFrameError(
				payload,
				[{ path: "", code: "invalid_json", message: "body is not JSON" }],
				text,
				cause,
			),
		};
	}
	return safeParsePayload(payload, value);
}
