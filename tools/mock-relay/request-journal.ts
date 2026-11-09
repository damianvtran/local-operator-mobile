import type { IncomingMessage, ServerResponse } from "node:http";

export type WireEvent = {
	id: number;
	phase: string;
	event: "start" | "headers" | "finish" | "close";
	method: string;
	path: string;
	origin: string | null;
	cookie: "present" | "absent";
	status: number | null;
};

/** Finish-only ledgers hide live SSE requests. Observe admission and headers
 * without consuming the stream or retaining credentials, bodies or query values.
 * A phase is captured at admission, so a host stream closing after native starts
 * cannot masquerade as a native request. Only synthetic proof relays arm this. */
function safeOrigin(value: string): string | null {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

export function createRequestJournal(events: WireEvent[]) {
	let nextId = 0;
	let phase = "host-preflight";
	return {
		mark(next: string) {
			phase = next;
		},
		observe(req: IncomingMessage, res: ServerResponse) {
			const base = {
				id: ++nextId,
				phase,
				method: req.method ?? "GET",
				path: new URL(req.url ?? "/", "http://fixture.invalid").pathname,
				origin:
					typeof req.headers.origin === "string"
						? safeOrigin(req.headers.origin)
						: null,
				cookie: req.headers.cookie ? ("present" as const) : ("absent" as const),
			};
			const record = (event: WireEvent["event"]) =>
				events.push({
					...base,
					event,
					status: event === "start" ? null : res.statusCode,
				});
			record("start");
			// Forward Node's overloads and receiver unchanged; observing headers
			// must neither flush them early nor change the response contract.
			res.writeHead = new Proxy(res.writeHead, {
				apply(target, receiver, args) {
					const result = Reflect.apply(target, receiver, args);
					record("headers");
					return result;
				},
			});
			res.once("finish", () => record("finish"));
			res.once("close", () => record("close"));
		},
	};
}
