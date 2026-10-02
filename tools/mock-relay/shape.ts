/**
 * Runtime shape checks for the captured corpus.
 *
 * The fixture corpus is the source of truth for what the relay answers, and
 * `docs/relay/types.ts` is the declaration of those shapes. TypeScript cannot
 * check a JSON file against a declaration, so something has to bridge the two —
 * and the choice here is a *check*, not a cast, for the fields a consumer
 * actually reads.
 *
 * Why this matters more than it looks: a fixture that drifts silently is the one
 * failure mode this instrument exists to prevent. If `projection.transcript`
 * became `entries`, a scenario would build a world with no rows and every
 * downstream screenshot would be of an empty state with no error anywhere. These
 * checks make that a load-time failure naming the field.
 */

import type {
	PastSessionsResponse,
	SessionListFrame,
	SessionProjection,
} from "../../docs/relay/types.ts";
import { asString, isRecord } from "../lib/json.ts";

/** A validator reports the first field that is missing or the wrong type. */
export class FixtureShapeError extends Error {}

function fail(name: string, path: string, reason: string): never {
	throw new FixtureShapeError(`fixture '${name}': ${path} ${reason}`);
}

/**
 * Admit a fixture payload as a domain type after checking the fields consumers
 * read. The cast is the one bridge between a JSON file and a declaration the
 * compiler cannot verify — and every field a call site touches is checked here,
 * so the claim the cast makes is the claim these lines just proved.
 */
function admit<T>(
	name: string,
	value: unknown,
	checks: Array<(root: Record<string, unknown>) => void>,
): T {
	if (!isRecord(value))
		fail(name, "value", `is ${typeof value}, expected an object`);
	for (const check of checks) check(value);
	return value as T;
}

const requireString = (path: string, value: unknown, name: string): string => {
	const text = asString(value);
	if (text === undefined)
		fail(name, path, `is ${typeof value}, expected a string`);
	return text;
};

const requireObject = (
	path: string,
	value: unknown,
	name: string,
): Record<string, unknown> => {
	if (!isRecord(value))
		fail(name, path, `is ${typeof value}, expected an object`);
	return value;
};

const requireArray = (
	path: string,
	value: unknown,
	name: string,
): unknown[] => {
	if (!Array.isArray(value))
		fail(name, path, `is ${typeof value}, expected an array`);
	return value;
};

/** The fields of a session projection the scenarios and the relay pump read. */
export function requireProjection(
	name: string,
	value: unknown,
): SessionProjection {
	return admit<SessionProjection>(name, value, [
		(root) => {
			requireString("session_id", root.session_id, name);
			if (typeof root.version !== "number")
				fail(name, "version", "is not a number");
			requireArray("transcript", root.transcript, name);
			// Every transcript row is read for `id`, `kind` and `text` by the
			// projection pump, the audit probe and the designer's dense-list
			// capture; a row missing one would render as a blank line or a React
			// key warning rather than as an error, so it is checked here.
			for (const [index, row] of requireArray(
				"transcript",
				root.transcript,
				name,
			).entries()) {
				const entry = requireObject(`transcript[${index}]`, row, name);
				requireString(`transcript[${index}].id`, entry.id, name);
				requireString(`transcript[${index}].kind`, entry.kind, name);
				requireString(`transcript[${index}].text`, entry.text, name);
			}
		},
	]);
}

/** The fields of a session-list frame the session list and the nav read. */
export function requireSessionList(
	name: string,
	value: unknown,
): SessionListFrame {
	return admit<SessionListFrame>(name, value, [
		(root) => {
			requireArray("sessions", root.sessions, name);
			if (root.capabilities !== undefined)
				requireObject("capabilities", root.capabilities, name);
		},
	]);
}

/** The fields of a past-sessions response the history list reads. */
export function requirePastSessions(
	name: string,
	value: unknown,
): PastSessionsResponse {
	return admit<PastSessionsResponse>(name, value, [
		(root) => {
			requireArray("sessions", root.sessions, name);
		},
	]);
}
