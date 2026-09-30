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
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root, from this file's own location — never from the cwd. */
export const repoRoot = resolve(HERE, "..", "..");

export const defaultFixturesDir = join(repoRoot, "fixtures", "relay");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * Normalise the two shapes the corpus uses:
 *   - `{request:{method,path}, status, headers:{...}, body}` for the recorded
 *     HTTP responses, and
 *   - `{raw_status:"HTTP/1.1 400 Bad Request", headers:[...], body:"..."}` for
 *     four samples captured as raw bytes, where the body is a JSON *string*.
 * `body` is parsed when we can prove it is JSON, so callers get `json` or
 * `text` without re-deciding per fixture.
 */
function normaliseHttp(name, raw) {
	if (raw.raw_status) {
		const match = /^HTTP\/[\d.]+\s+(\d+)/.exec(raw.raw_status);
		const headers = {};
		for (const line of raw.headers ?? []) {
			const idx = line.indexOf(":");
			if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
		}
		let json;
		try {
			json = JSON.parse(raw.body);
		} catch {
			json = undefined;
		}
		return {
			name,
			status: match ? Number(match[1]) : 500,
			headers,
			json,
			text: json === undefined ? raw.body : undefined,
			request: undefined,
		};
	}
	const contentType = raw.headers?.["content-type"] ?? "";
	const isJson = typeof raw.body === "object" && raw.body !== null && !contentType.startsWith("text/");
	return {
		name,
		status: raw.status,
		headers: raw.headers ?? {},
		json: isJson ? raw.body : undefined,
		// The login page and the web-bundle-missing message are HTML/text bodies
		// and must stay strings: a client that gets HTML where it expected JSON
		// is a case this corpus exists to test.
		text: isJson ? undefined : String(raw.body ?? ""),
		request: raw.request ?? null,
	};
}

/** Load every file the mock can serve. Throws with the missing path when absent. */
export function loadFixtures(dir = defaultFixturesDir) {
	if (!existsSync(dir)) {
		throw new Error(
			`relay fixtures not found at ${dir}. They ship with the relay-contract `
			+ "work (docs/relay-map); pass --fixtures <dir> to point at a checkout of it.",
		);
	}
	const http = new Map();
	const httpDir = join(dir, "http");
	for (const file of readdirSync(httpDir).filter((f) => f.endsWith(".json")).sort()) {
		http.set(file.replace(/\.json$/, ""), normaliseHttp(file.replace(/\.json$/, ""), readJson(join(httpDir, file))));
	}

	const sse = new Map();
	const sseDir = join(dir, "sse");
	for (const file of readdirSync(sseDir).sort()) {
		const path = join(sseDir, file);
		if (file.endsWith(".json")) sse.set(file.replace(/\.json$/, ""), readJson(path));
		else sse.set(file.replace(/\.txt$/, ""), { raw: readFileSync(path, "utf8"), event: null, data: null });
	}

	const synthetic = new Map();
	const syntheticDir = join(dir, "synthetic");
	if (existsSync(syntheticDir)) {
		for (const file of readdirSync(syntheticDir).filter((f) => f.endsWith(".json")).sort()) {
			const parsed = readJson(join(syntheticDir, file));
			synthetic.set(file.replace(/\.json$/, ""), parsed.data ? parsed : { event: null, data: parsed });
		}
	}

	const gatewayConstants = readJson(join(dir, "gateway", "gateway-refusal-constants.json"));
	const probes = readJson(join(dir, "probes", "wedged-row-signal.json"));

	/** A fixture's body, deep-cloned so a scenario can mutate its copy freely. */
	const body = (name) => {
		const fixture = http.get(name);
		if (!fixture) throw new Error(`no such http fixture: ${name}`);
		if (fixture.json !== undefined) return structuredClone(fixture.json);
		return fixture.text;
	};

	/** A fixture's recorded response as a ready-to-send `{status, headers, json|text}`. */
	const response = (name) => {
		const fixture = http.get(name);
		if (!fixture) throw new Error(`no such http fixture: ${name}`);
		return {
			status: fixture.status,
			headers: { ...fixture.headers },
			json: fixture.json === undefined ? undefined : structuredClone(fixture.json),
			text: fixture.text,
			fixture: name,
		};
	};

	/** An SSE frame's `data` payload, cloned. */
	const frame = (name) => {
		const entry = sse.get(name) ?? synthetic.get(name);
		if (!entry) throw new Error(`no such sse fixture: ${name}`);
		if (entry.raw !== undefined) return entry.raw;
		return { event: entry.event, data: structuredClone(entry.data) };
	};

	return { dir, http, sse, synthetic, gatewayConstants, probes, body, response, frame };
}
