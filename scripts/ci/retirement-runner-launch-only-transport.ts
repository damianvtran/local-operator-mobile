/** A ready grant is capability evidence, not process attestation. This listener
 * has no query/tap implementation: even an authenticated next request is denied
 * before the pinned Swift test constructs SpringBoard. No producer lives here. */
import { timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { deferred } from "./retirement-replay-transport.ts";

export interface HostReceipt {
	readyReceived: boolean;
	readyReplySent: boolean;
	beforeObserveReceived: boolean;
	denialSent: boolean;
	protocolFailed: boolean;
}

export class LaunchOnlyTransport {
	readonly ready = deferred<void>();
	readonly denied = deferred<void>();
	readonly failed = deferred<void>();
	#auth: { session: string; bearer: string };
	#state: "ready" | "observe" | "denied" | "failed" = "ready";
	#busy = false;
	#requests = 0;
	#challenges = new Set<string>();
	#receipt: HostReceipt = {
		readyReceived: false,
		readyReplySent: false,
		beforeObserveReceived: false,
		denialSent: false,
		protocolFailed: false,
	};
	readonly server = createServer((q, s) => void this.rpc(q, s));
	constructor(auth: { session: string; bearer: string }) {
		if (
			!/^[a-f0-9]{48}$/.test(auth.session) ||
			!/^[a-f0-9]{64}$/.test(auth.bearer)
		)
			throw new Error("closed");
		this.#auth = auth;
		this.server.maxConnections = 4;
		this.server.headersTimeout = 5000;
		this.server.requestTimeout = 5000;
		this.server.keepAliveTimeout = 1;
		this.server.on("drop", () => this.refuse());
		this.server.on("clientError", (_error, socket) => {
			this.refuse();
			socket.destroy();
		});
	}
	private refuse(s?: ServerResponse) {
		this.#state = "failed";
		this.#receipt.protocolFailed = true;
		this.failed.resolve();
		if (s && !s.destroyed && !s.writableEnded) {
			s.writeHead(403);
			s.end();
		}
	}
	private async rpc(q: IncomingMessage, s: ServerResponse) {
		const expected = Buffer.from(`Bearer ${this.#auth.bearer}`);
		const supplied = Buffer.from(q.headers.authorization ?? "");
		if (
			++this.#requests > 8 ||
			this.#busy ||
			this.#state === "failed" ||
			q.method !== "POST" ||
			q.url !== "/rpc" ||
			q.rawHeaders.filter(
				(_value, index) =>
					index % 2 === 0 &&
					q.rawHeaders[index]?.toLowerCase() === "authorization",
			).length !== 1 ||
			supplied.length !== expected.length ||
			!timingSafeEqual(supplied, expected)
		) {
			this.refuse(s);
			q.resume();
			return;
		}
		this.#busy = true;
		const timer = setTimeout(() => {
			this.refuse(s);
			q.destroy();
		}, 5000);
		try {
			let size = 0;
			const chunks: Buffer[] = [];
			for await (const chunk of q) {
				size += chunk.length;
				if (size > 8192) {
					this.refuse(s);
					q.resume();
					return;
				}
				chunks.push(Buffer.from(chunk));
			}
			const raw = Buffer.concat(chunks).toString("utf8");
			// All legitimate values are plain ASCII. Refuse duplicate/escaped keys
			// rather than letting JSON.parse silently choose the last occurrence.
			if (
				!/^\s*\{\s*"(?:session|kind|challenge)"\s*:\s*"[a-z0-9-]+"\s*(?:,\s*"(?:session|kind|challenge)"\s*:\s*"[a-z0-9-]+"\s*){2}\}\s*$/.test(
					raw,
				)
			) {
				this.refuse(s);
				return;
			}
			const b = JSON.parse(raw);
			if (
				this.#receipt.protocolFailed ||
				!b ||
				typeof b !== "object" ||
				Array.isArray(b) ||
				Object.keys(b).sort().join(",") !== "challenge,kind,session" ||
				b.session !== this.#auth.session ||
				typeof b.challenge !== "string" ||
				!/^[a-f0-9]{64}$/.test(b.challenge) ||
				this.#challenges.has(b.challenge)
			) {
				this.refuse(s);
				return;
			}
			this.#challenges.add(b.challenge);
			if (this.#state === "ready" && b.kind === "runner-ready") {
				this.#receipt.readyReceived = true;
				this.#state = "observe";
				const now = Date.now();
				s.once("finish", () => {
					this.#receipt.readyReplySent = true;
					this.ready.resolve();
				});
				s.writeHead(200, { "content-type": "application/json" });
				s.end(
					JSON.stringify({
						version: 1,
						kind: "runner-ready",
						session: b.session,
						challenge: b.challenge,
						phase: "seed",
						issuedAt: now,
						expiresAt: now + 1000,
						openAt: null,
						identity: null,
						fingerprint: null,
					}),
				);
			} else if (
				this.#state === "observe" &&
				this.#receipt.readyReplySent &&
				b.kind === "before-observe"
			) {
				this.#state = "denied";
				this.#receipt.beforeObserveReceived = true;
				s.once("finish", () => {
					this.#receipt.denialSent = true;
					this.denied.resolve();
				});
				s.writeHead(403);
				s.end();
			} else this.refuse(s);
		} catch {
			this.refuse(s);
		} finally {
			clearTimeout(timer);
			this.#busy = false;
		}
	}
	async listen(): Promise<string> {
		await new Promise<void>((yes, no) => {
			this.server.once("error", no);
			this.server.listen(0, "127.0.0.1", yes);
		});
		const address = this.server.address();
		if (!address || typeof address === "string") throw new Error("closed");
		return `http://127.0.0.1:${address.port}/rpc`;
	}
	receipt(): HostReceipt {
		return { ...this.#receipt };
	}
	async close() {
		this.server.closeAllConnections();
		await new Promise<void>((yes) => this.server.close(() => yes()));
	}
}
