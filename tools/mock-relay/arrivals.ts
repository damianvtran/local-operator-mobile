/**
 * The mock relay's ARRIVAL log: one row the moment a request's headers are parsed,
 * completed later if and when its response finishes or its socket closes.
 *
 * **Why the ledger was not enough.** `recordRequest` in `relay.ts` writes a row on
 * `res.finish`. A request that arrived and never finished — a held login, an SSE
 * stream that is still open when the run ends, a socket the client dropped — leaves
 * no row, so the chrome proof's ledger (run 42789156345) could not tell "Save and
 * connect never sent a request" from "it arrived and never completed". This log
 * records arrival separately, so `open` rows are exactly the in-flight requests and
 * streams at snapshot time.
 *
 * **What a row may carry.** Method, pathname (no query string: a query could carry
 * a token on some route), the peer address, a user-agent CLASS (never the raw
 * string), and timestamps/status. No header values, no cookies, no bodies.
 *
 * **Bounded.** `capacity` rows, oldest dropped; a full matrix run must not grow
 * this without limit. Control routes (`/__mock/…`) are excluded by the caller, for
 * the same reason `requestsServed` excludes them.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface ArrivalRow {
	seq: number;
	arrivedAt: string;
	method: string;
	path: string;
	remote: string;
	userAgent: UserAgentClass;
	/** `open` until the response finished (`finished`) or the socket closed
	 *  first (`aborted`). */
	outcome: "open" | "finished" | "aborted";
	status?: number;
	endedAt?: string;
	ms?: number;
}

export type UserAgentClass =
	| "ios-native"
	| "android-native"
	| "browser"
	| "node"
	| "curl"
	| "none"
	| "other";

/** Classifies a user agent without keeping it: the raw string can carry a
 *  device model or an app build, which a public CI artifact should not hold. */
export function userAgentClass(raw: string | undefined): UserAgentClass {
	if (!raw) return "none";
	if (/CFNetwork|Darwin\//.test(raw)) return "ios-native";
	if (/okhttp/i.test(raw)) return "android-native";
	if (/^curl\//i.test(raw)) return "curl";
	if (/^node|undici/i.test(raw)) return "node";
	if (/Mozilla\//.test(raw)) return "browser";
	return "other";
}

export function createArrivalLog(capacity = 2000) {
	let rows: ArrivalRow[] = [];
	let seq = 0;
	return {
		arrive(req: IncomingMessage, res: ServerResponse, pathname: string): void {
			const started = Date.now();
			seq += 1;
			const row: ArrivalRow = {
				seq,
				arrivedAt: new Date(started).toISOString(),
				method: (req.method ?? "GET").toUpperCase(),
				path: pathname,
				remote: req.socket?.remoteAddress ?? "",
				userAgent: userAgentClass(req.headers["user-agent"]),
				outcome: "open",
			};
			rows.push(row);
			if (rows.length > capacity) rows = rows.slice(-capacity);
			const end = (outcome: "finished" | "aborted") => {
				if (row.outcome !== "open") return;
				row.outcome = outcome;
				row.status = res.statusCode;
				row.endedAt = new Date().toISOString();
				row.ms = Date.now() - started;
			};
			res.once("finish", () => end("finished"));
			// `close` without a prior `finish` is a client that went away mid-response
			// — the shape an abandoned SSE stream or a timed-out fetch leaves.
			res.once("close", () => end("aborted"));
		},
		/** Copies, so a later completion cannot mutate a snapshot already written. */
		snapshot(): { rows: ArrivalRow[]; open: ArrivalRow[] } {
			const copy = rows.map((row) => ({ ...row }));
			return { rows: copy, open: copy.filter((row) => row.outcome === "open") };
		},
	};
}

export type ArrivalLog = ReturnType<typeof createArrivalLog>;
