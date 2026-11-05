import assert from "node:assert/strict";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

export type Authority = "loopback-ipv4" | "published-local";
export function transportAuthorities(port: number, published: string) {
	const local = new URL(published);
	assert(
		local.protocol === "http:" &&
			local.hostname.endsWith(".local") &&
			local.port === String(port),
		"transport authorities must share the actual listener port",
	);
	return [
		{ label: "loopback-ipv4" as const, url: `http://127.0.0.1:${port}` },
		{ label: "published-local" as const, url: local.origin },
	];
}
/** Arrival is observed BEFORE the mock handler, not inferred from its finish
 * journal. No header, query, address, cookie or body is retained. */
export function observeTransportRequests(
	server: Server,
	authorities: ReturnType<typeof transportAuthorities>,
) {
	let phase: "host-preflight" | "native-pair" = "host-preflight";
	let sequence = 0;
	const arrivals: {
		id: number;
		phase: string;
		authority: string;
		endpoint: string;
		method: string;
		atMs: number;
	}[] = [];
	const completions: {
		id: number;
		phase: string;
		authority: string;
		endpoint: string;
		status: number;
		elapsedMs: number;
	}[] = [];
	server.prependListener(
		"request",
		(req: IncomingMessage, res: ServerResponse) => {
			const id = ++sequence,
				started = Date.now(),
				requestPhase = phase;
			const authority =
				authorities.find((a) => new URL(a.url).host === req.headers.host)
					?.label ?? "other";
			const endpoint =
				(req.url ?? "").split("?")[0] === "/api/sessions"
					? "sessions"
					: "other";
			arrivals.push({
				id,
				phase: requestPhase,
				authority,
				endpoint,
				method: req.method === "GET" ? "GET" : "other",
				atMs: started,
			});
			res.once("finish", () =>
				completions.push({
					id,
					phase: requestPhase,
					authority,
					endpoint,
					status: res.statusCode,
					elapsedMs: Date.now() - started,
				}),
			);
		},
	);
	return {
		beginNative: () => {
			phase = "native-pair";
		},
		snapshot: () => ({
			arrivals: [...arrivals],
			completions: [...completions],
		}),
	};
}
export type TransportObservation = {
	authority: Authority;
	uiVerdict:
		| "password-refused"
		| "timeout"
		| "host"
		| "tls"
		| "unreachable"
		| "other";
	elapsedMs: number;
};
const VERDICTS = new Set([
	"password-refused",
	"timeout",
	"host",
	"tls",
	"unreachable",
	"other",
]);
const MARKER = "TRANSPORT_PROBE ";
export function parseTransportObservations(
	output: string,
): TransportObservation[] {
	const rows: TransportObservation[] = [];
	for (const line of output.split("\n")) {
		const i = line.indexOf(MARKER);
		if (i < 0) continue;
		try {
			const r = JSON.parse(line.slice(i + MARKER.length));
			if (
				!["loopback-ipv4", "published-local"].includes(r.authority) ||
				!VERDICTS.has(r.uiVerdict) ||
				!Number.isFinite(r.elapsedMs) ||
				r.elapsedMs < 0 ||
				r.elapsedMs > 900000
			)
				continue;
			rows.push({
				authority: r.authority,
				uiVerdict: r.uiVerdict,
				elapsedMs: r.elapsedMs,
			});
		} catch {
			/* Never retain arbitrary CLI/error text as an observation. */
		}
	}
	return rows;
}
export function assertTransportPair(rows: readonly TransportObservation[]) {
	assert.deepEqual(
		rows.map((r) => r.authority),
		["loopback-ipv4", "published-local"],
		"missing/duplicate/out-of-order transport authority observation",
	);
}
const NATIVE_CODE =
	/(NSURLErrorDomain|kCFErrorDomainCFNetwork)[^\r\n]{0,100}?\bCode\s*[:=]\s*(-?\d{1,6})(?!\d)/gi;
/** Only actual app-process OS lines reach this parser. A JS TypeError is NOT a
 * native NSError code. Missing OS observations remain an explicit gap. */
export function parseNativeTransportCodes(text: string) {
	return [...text.matchAll(NATIVE_CODE)]
		.slice(0, 32)
		.map((m) => ({ domain: m[1], code: Number(m[2]) }));
}

export function transportOutcome(
	rows: readonly TransportObservation[],
	completions: {
		phase: string;
		authority: string;
		endpoint: string;
		status: number;
	}[],
) {
	assertTransportPair(rows);
	const answered = (label: Authority) =>
		rows.some(
			(r) => r.authority === label && r.uiVerdict === "password-refused",
		) &&
		completions.some(
			(c) =>
				c.phase === "native-pair" &&
				c.authority === label &&
				c.endpoint === "sessions" &&
				c.status === 401,
		);
	const ip = answered("loopback-ipv4"),
		local = answered("published-local");
	return ip && local
		? "both-401"
		: ip
			? "loopback-only-401"
			: local
				? "local-only-401"
				: "neither-401";
}
