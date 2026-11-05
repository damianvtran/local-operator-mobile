/**
 * Diagnose the save -> provider -> first native request boundary, not the setup
 * form's earlier successful login. Native proof41968443800 had no completed
 * post-save request and cannot distinguish a privacy barrier from a cookie/ATS
 * failure. Only fixed event classes and HTTP status may leave this boundary:
 * never URLs, origins, cookie/auth values, error names/messages or route keys.
 *
 * One bounded trace per connect attempt; retries/streams cannot fill native logs.
 * This is evidence instrumentation, not a transport retry or policy change.
 */
import { RelayError, transportError } from "../../relay/errors.ts";
import { resolveFetch } from "../../relay/platform-fetch.ts";

const STAGES = [
	"save.begin",
	"restore.begin",
	"route.accepted",
	"route.rejected",
	"privacy.wait",
	"privacy.ready",
	"native-retirement.wait",
	"native-retirement.ready",
	"admission.superseded",
	"authentication.begin",
	"authentication.ready",
	"authentication.declined",
	"provider.returned",
	"provider.failed",
	"cold-list.begin",
	"cold-list.applied",
	"cold-list.failed",
] as const;
type Stage = (typeof STAGES)[number];
const ERROR_CLASSES = new Set([
	"Error",
	"TypeError",
	"AbortError",
	"RelayError",
]);
const CAUSE_CLASSES = new Set([
	"transport",
	"aborted",
	"host-unresolved",
	"certificate-rejected",
	"relay-unauthorized",
	"rejected",
	"malformed-frame",
]);
export type SavedRouteDiagnostic = {
	event: "stage" | "request" | "response" | "rejected";
	stage?: Stage | "unknown";
	requestClass?:
		| "login"
		| "peer-list"
		| "session-list"
		| "list-stream"
		| "config-stream"
		| "other";
	status?: number;
	errorClass?: string;
	causeClass?: string;
};
const safeStatus = (value: unknown): number | undefined =>
	typeof value === "number" &&
	Number.isInteger(value) &&
	(value === 0 || (value >= 100 && value <= 599))
		? value
		: undefined;
const errorFacts = (error: unknown) => {
	const typed = error instanceof RelayError ? error : transportError(error);
	return {
		errorClass:
			error instanceof Error && ERROR_CLASSES.has(error.name)
				? error.name
				: "Error",
		causeClass: CAUSE_CLASSES.has(typed.kind) ? typed.kind : "unknown",
		...(safeStatus(typed.status) === undefined
			? {}
			: { status: safeStatus(typed.status) }),
	};
};
const requestClass = (
	input: RequestInfo | URL,
): SavedRouteDiagnostic["requestClass"] => {
	try {
		const url = new URL(
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url,
		);
		if (url.pathname === "/login") return "login";
		if (url.pathname === "/api/sessions")
			return url.searchParams.get("include_peers") === "true"
				? "peer-list"
				: "session-list";
		if (url.pathname === "/api/sessions/events") return "list-stream";
		if (url.pathname === "/api/config/events") return "config-stream";
	} catch {
		/* Even malformed input must not appear in the diagnostic. */
	}
	return "other";
};

export function createSavedRouteDiagnostics(
	write: (event: SavedRouteDiagnostic) => void = (event) =>
		console.info(`[saved-route] ${JSON.stringify(event)}`),
) {
	let remaining = 32;
	const emit = (event: SavedRouteDiagnostic) => {
		if (remaining-- <= 0) return;
		// Instrumentation must not alter admission or replace the real rejection
		// if a native logging sink is unavailable during teardown/backgrounding.
		try {
			write(event);
		} catch {
			/* best-effort diagnostic only */
		}
	};
	return {
		stage(stage: Stage, error?: unknown) {
			emit({
				event: "stage",
				stage: STAGES.includes(stage) ? stage : "unknown",
				...(error === undefined ? {} : errorFacts(error)),
			});
		},
		fetch(underlying = resolveFetch()): typeof globalThis.fetch {
			return async (input, init) => {
				const operation = requestClass(input);
				emit({ event: "request", requestClass: operation });
				try {
					const response = await underlying(input, init);
					emit({
						event: "response",
						requestClass: operation,
						status: safeStatus(response.status),
					});
					return response;
				} catch (error) {
					emit({
						event: "rejected",
						requestClass: operation,
						...errorFacts(error),
					});
					throw error;
				}
			};
		},
	};
}

/** Strip unified-log metadata and any unknown fields BEFORE persisting evidence.
 * The proof runner imports this module directly in Node, hence the explicit
 * relative .ts imports above (no React Native or alias-loader dependency). */
export function parseSavedRouteDiagnostics(
	text: string,
): SavedRouteDiagnostic[] {
	const result: SavedRouteDiagnostic[] = [];
	for (const line of text.split("\n")) {
		const marker = line.indexOf("[saved-route] ");
		if (marker < 0 || result.length >= 64) continue;
		try {
			const row = JSON.parse(
				line.slice(marker + "[saved-route] ".length),
			) as Record<string, unknown>;
			if (
				!["stage", "request", "response", "rejected"].includes(
					String(row.event),
				)
			)
				continue;
			const safe: SavedRouteDiagnostic = {
				event: row.event as SavedRouteDiagnostic["event"],
			};
			if (row.stage !== undefined)
				safe.stage = STAGES.includes(row.stage as Stage)
					? (row.stage as Stage)
					: "unknown";
			if (row.requestClass !== undefined)
				safe.requestClass = [
					"login",
					"peer-list",
					"session-list",
					"list-stream",
					"config-stream",
					"other",
				].includes(String(row.requestClass))
					? (row.requestClass as SavedRouteDiagnostic["requestClass"])
					: "other";
			if (safeStatus(row.status) !== undefined)
				safe.status = safeStatus(row.status);
			if (row.errorClass !== undefined)
				safe.errorClass = ERROR_CLASSES.has(String(row.errorClass))
					? String(row.errorClass)
					: "Error";
			if (row.causeClass !== undefined)
				safe.causeClass = CAUSE_CLASSES.has(String(row.causeClass))
					? String(row.causeClass)
					: "unknown";
			result.push(safe);
		} catch {
			/* Non-JSON native log lines are not diagnostic evidence. */
		}
	}
	return result;
}
