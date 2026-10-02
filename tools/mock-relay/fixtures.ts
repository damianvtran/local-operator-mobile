/**
 * Load the captured relay corpus.
 *
 * The fixtures under `fixtures/relay/**` are the *source of truth* for what the
 * relay answers, and this module is the only place that reads them. Two
 * consequences the mock depends on:
 *
 * 1. A route's default answer is the **captured bytes**, not a shape someone
 *    re-typed here. A mock that re-derives a payload drifts from the relay
 *    silently; a mock that replays a capture cannot.
 * 2. scenarios *compose* from the corpus and mutate copies. Every state the
 *    harness pins therefore starts from something a real relay produced.
 *
 * The corpus is read at load time, never vendored into this directory: the
 * fixtures belong to `docs/relay-map`'s commit, and a second copy is a second
 * thing to drift.
 *
 * Everything here arrives as `unknown` and leaves through a named accessor, so a
 * caller that needs a projection gets one that has been checked (`shape.ts`)
 * rather than a cast of a JSON file.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	PastSessionsResponse,
	SessionListFrame,
	SessionProjection,
} from "../../docs/relay/types.ts";
import { asString, asStringMap, isRecord, type Json } from "../lib/json.ts";
import {
	requirePastSessions,
	requireProjection,
	requireSessionList,
} from "./shape.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root, from this file's own location — never from the cwd. */
export const repoRoot = resolve(HERE, "..", "..");

export const defaultFixturesDir = join(repoRoot, "fixtures", "relay");

/** One recorded HTTP response, normalised from either corpus shape. */
export interface HttpFixture {
	name: string;
	status: number;
	headers: Record<string, string>;
	json: Json | undefined;
	text: string | undefined;
	request: Json | null;
}

/** A fixture ready to be written to the wire. `json` xor `text` is set. */
export interface FixtureResponse {
	status: number;
	headers: Record<string, string>;
	json?: Json;
	text?: string;
	fixture: string;
}

/** Field overrides a scenario or a fault applies to a captured response. */
export type FixtureResponseOverride = Partial<Omit<FixtureResponse, "fixture">>;

/**
 * One SSE fixture, as the frame it stands for.
 *
 * A capture is either an `{event, data}` pair or raw bytes captured off the
 * wire; both are normalised to this shape so a caller reads `.data` without
 * re-deciding which kind it got. A raw capture keeps its bytes in `data` with a
 * null event name, which is what the relay saw.
 */
export interface SseFramePayload {
	event: string | null;
	data: unknown;
}

/** The stored form of an SSE fixture, before it is normalised to a frame. */
export type SseFixture = Json;

export interface FixtureCorpus {
	dir: string;
	http: Map<string, HttpFixture>;
	sse: Map<string, SseFixture>;
	synthetic: Map<string, SseFixture>;
	gatewayConstants: Json;
	probes: Json;
	/** A fixture's body, deep-cloned so a scenario can mutate its copy freely. */
	body: (name: string) => Json;
	/** A fixture's recorded response as a ready-to-send `{status, headers, json|text}`. */
	response: (name: string) => FixtureResponse;
	/** An SSE fixture normalised to a frame, its `data` cloned. */
	frame: (name: string) => SseFramePayload;
	/** A fixture body admitted as a session projection, checked field by field. */
	projection: (name: string) => SessionProjection;
	/** A fixture body admitted as a session-list frame. */
	list: (name: string) => SessionListFrame;
	/** A fixture body admitted as a past-sessions response. */
	past: (name: string) => PastSessionsResponse;
	/** A fixture body as a plain object, for the routes that read one or two fields. */
	record: (name: string) => Record<string, Json>;
	/** A fixture's payload, resolved across the http, sse and synthetic corpora. */
	payload: (name: string) => unknown;
	/** A numeric signal from the measured probe data, with a fallback if absent. */
	probe: (key: string, fallback: number) => number;
	/** Every `RELAY_DETAIL` reason the gateway constants record, sorted. */
	gatewayReasons: () => string[];
	/** One `RELAY_DETAIL` sentence, failing loudly when the constants lack it. */
	gatewayDetail: (reason: string) => string;
}

/** The recorded-HTTP shape as the corpus writes it, before normalisation. */
const readJson = (path: string): unknown => {
	const text = readFileSync(path, "utf8");
	try {
		// `JSON.parse` is typed `any`; binding it to `unknown` is what keeps that
		// `any` from reaching a caller unexamined.
		const parsed: unknown = JSON.parse(text);
		return parsed;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`${path} is not valid JSON: ${reason}`);
	}
};

/**
 * Admit an already-JSON-decoded value as `Json`.
 *
 * The casts below are the module's single point of assertion and they are safe
 * for a reason the compiler cannot see: the value came from `JSON.parse`, whose
 * output domain IS `Json`, so the check beside each cast is confirming what the
 * parser produced rather than claiming a shape nobody examined. Anything that
 * needs a *specific* shape goes through `shape.ts`, which checks field by field.
 */
const admitJson = (value: unknown): Json | undefined => {
	if (value === null) return null;
	if (typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (typeof value === "object") return value as Json;
	return undefined;
};

/**
 * Normalise the two shapes the corpus uses:
 *   - `{request:{method,path}, status, headers:{...}, body}` for the recorded
 *     HTTP responses, and
 *   - `{raw_status:"HTTP/1.1 400 Bad Request", headers:[...], body:"..."}` for
 *     four samples captured as raw bytes, where the body is a JSON *string*.
 * `body` is parsed when we can prove it is JSON, so callers get `json` or
 * `text` without re-deciding per fixture.
 */
function normaliseHttp(name: string, raw: unknown): HttpFixture {
	if (!isRecord(raw))
		throw new Error(`http fixture '${name}' is not an object`);
	const rawStatus = asString(raw.raw_status);
	if (rawStatus !== undefined) {
		const match = /^HTTP\/[\d.]+\s+(\d+)/.exec(rawStatus);
		const headers: Record<string, string> = {};
		for (const line of Array.isArray(raw.headers) ? raw.headers : []) {
			if (typeof line !== "string") continue;
			const idx = line.indexOf(":");
			if (idx > 0)
				headers[line.slice(0, idx).trim().toLowerCase()] = line
					.slice(idx + 1)
					.trim();
		}
		let json: Json | undefined;
		try {
			json = admitJson(JSON.parse(String(raw.body ?? "")));
		} catch {
			json = undefined;
		}
		const text = asString(raw.body);
		return {
			name,
			status: match ? Number(match[1]) : 500,
			headers,
			json,
			text: json === undefined ? text : undefined,
			request: null,
		};
	}
	const headers = asStringMap(raw.headers) ?? {};
	const contentType = headers["content-type"] ?? "";
	const isJson =
		typeof raw.body === "object" &&
		raw.body !== null &&
		!contentType.startsWith("text/");
	return {
		name,
		status: typeof raw.status === "number" ? raw.status : 500,
		headers,
		json: isJson ? admitJson(raw.body) : undefined,
		// The login page and the web-bundle-missing message are HTML/text bodies
		// and must stay strings: a client that gets HTML where it expected JSON
		// is a case this corpus exists to test.
		text: isJson ? undefined : String(raw.body ?? ""),
		request: admitJson(raw.request) ?? null,
	};
}

/** The `text` of a response that is expected to carry one, failing loudly otherwise. */
export function textOf(response: FixtureResponse): string {
	if (typeof response.text !== "string") {
		throw new Error(
			`fixture '${response.fixture}' carries no text body (it has JSON)`,
		);
	}
	return response.text;
}

/** Load every file the mock can serve. Throws with the missing path when absent. */
export function loadFixtures(dir: string = defaultFixturesDir): FixtureCorpus {
	if (!existsSync(dir)) {
		throw new Error(
			`relay fixtures not found at ${dir}. They ship with the relay-contract ` +
				"work (docs/relay-map); pass --fixtures <dir> to point at a checkout of it.",
		);
	}
	const http = new Map<string, HttpFixture>();
	const httpDir = join(dir, "http");
	for (const file of readdirSync(httpDir)
		.filter((f) => f.endsWith(".json"))
		.sort()) {
		const name = file.replace(/\.json$/, "");
		http.set(name, normaliseHttp(name, readJson(join(httpDir, file))));
	}

	const sse = new Map<string, SseFixture>();
	const sseDir = join(dir, "sse");
	for (const file of readdirSync(sseDir).sort()) {
		const path = join(sseDir, file);
		if (file.endsWith(".json"))
			sse.set(file.replace(/\.json$/, ""), admitJson(readJson(path)) ?? null);
		else sse.set(file.replace(/\.txt$/, ""), readFileSync(path, "utf8"));
	}

	const synthetic = new Map<string, SseFixture>();
	const syntheticDir = join(dir, "synthetic");
	if (existsSync(syntheticDir)) {
		for (const file of readdirSync(syntheticDir)
			.filter((f) => f.endsWith(".json"))
			.sort()) {
			const parsed = readJson(join(syntheticDir, file));
			const admitted = admitJson(parsed) ?? null;
			const wrapped = isRecord(admitted) && admitted.data !== undefined;
			synthetic.set(
				file.replace(/\.json$/, ""),
				wrapped ? admitted : { event: null, data: admitted },
			);
		}
	}

	const gatewayConstants = readJson(
		join(dir, "gateway", "gateway-refusal-constants.json"),
	);
	const rawProbes = readJson(join(dir, "probes", "wedged-row-signal.json"));

	const fixtureOrThrow = (name: string): HttpFixture => {
		const fixture = http.get(name);
		if (!fixture) throw new Error(`no such http fixture: ${name}`);
		return fixture;
	};

	/** A fixture's body, deep-cloned so a scenario can mutate its copy freely. */
	const body = (name: string): Json => {
		const fixture = fixtureOrThrow(name);
		if (fixture.json !== undefined) return structuredClone(fixture.json);
		return fixture.text ?? "";
	};

	/** A fixture's recorded response as a ready-to-send `{status, headers, json|text}`. */
	const response = (name: string): FixtureResponse => {
		const fixture = fixtureOrThrow(name);
		return {
			status: fixture.status,
			headers: { ...fixture.headers },
			json:
				fixture.json === undefined ? undefined : structuredClone(fixture.json),
			text: fixture.text,
			fixture: name,
		};
	};

	/** An SSE fixture normalised to a frame, its `data` cloned. */
	const frame = (name: string): SseFramePayload => {
		const entry = sse.get(name) ?? synthetic.get(name);
		if (entry === undefined) throw new Error(`no such sse fixture: ${name}`);
		if (typeof entry === "string") return { event: null, data: entry };
		if (!isRecord(entry))
			return { event: null, data: admitJson(entry) ?? null };
		if ("raw" in entry)
			return { event: null, data: admitJson(entry.raw) ?? null };
		const event = typeof entry.event === "string" ? entry.event : null;
		return {
			event,
			data: admitJson(structuredClone(entry.data ?? null)) ?? null,
		};
	};

	const record = (name: string): Record<string, Json> => {
		const value = body(name);
		if (!isRecord(value)) throw new Error(`fixture '${name}' is not an object`);
		return value;
	};

	/**
	 * A fixture's *payload*, wherever the corpus keeps it.
	 *
	 * Projections and list frames are captured as SSE frames (`sse/`), the error
	 * and form bodies as recorded HTTP responses (`http/`), and a few frames are
	 * synthesised for states no capture exists for. A caller asserting a shape
	 * should not have to know which directory its fixture lives in, and guessing
	 * wrong would silently read an empty object — so this resolves by name and
	 * fails loudly when neither corpus has it.
	 */
	const payload = (name: string): unknown => {
		if (sse.has(name) || synthetic.has(name)) {
			const entry = frame(name);
			if (isRecord(entry) && entry.data !== undefined) return entry.data;
			return entry;
		}
		if (http.has(name)) return body(name);
		throw new Error(
			`no such fixture in the http, sse or synthetic corpus: ${name}`,
		);
	};

	return {
		dir,
		http,
		sse,
		synthetic,
		gatewayConstants: admitJson(gatewayConstants) ?? null,
		probes: admitJson(rawProbes) ?? null,
		body,
		response,
		frame,
		payload,
		projection: (name) => requireProjection(name, payload(name)),
		list: (name) => requireSessionList(name, payload(name)),
		past: (name) => requirePastSessions(name, payload(name)),
		record,
		gatewayReasons: () => {
			const constants = admitJson(gatewayConstants);
			const detail =
				isRecord(constants) && isRecord(constants.relay_detail)
					? constants.relay_detail
					: {};
			return Object.keys(detail).sort();
		},
		gatewayDetail: (reason) => {
			const constants = admitJson(gatewayConstants);
			const detail =
				isRecord(constants) && isRecord(constants.relay_detail)
					? constants.relay_detail[reason]
					: undefined;
			if (typeof detail !== "string")
				throw new Error(`no such gateway reason: ${reason}`);
			return detail;
		},
		probe: (key, fallback) => {
			const probes = admitJson(rawProbes);
			const value = isRecord(probes) ? probes[key] : undefined;
			return typeof value === "number" && Number.isFinite(value)
				? value
				: fallback;
		},
	};
}
