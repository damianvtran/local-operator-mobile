/** Narrow trusted-CI loopback surfaces. Refusals change coarse counters only;
 * no token service, URL delivery, credential write or grant from assertions. */

import { timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import {
	receiptCause,
	receiptRefusal,
} from "./auth-retirement-phase-diagnostics.ts";
import { signalRefusal } from "./auth-retirement-readiness.ts";
import {
	type Deadline,
	type GrantSession,
	ReplayRefused,
} from "./retirement-replay-core.ts";
export function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	void promise.catch(() => undefined);
	return { promise, resolve, reject };
}
export interface OriginalIdentity {
	nonce: string;
	receiverPort: number;
	sourceSha: string;
	flavor: string;
}
async function waitFor<T>(promise: Promise<T>, milliseconds: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, no) => {
				timer = setTimeout(
					() => no(new ReplayRefused("deadline")),
					milliseconds,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
export class ReplayTransport {
	readonly ready = deferred<void>();
	readonly runner = deferred<void>();
	readonly receipt = deferred<Record<string, unknown>>();
	readonly opened = deferred<void>();
	readyArmed = false;
	readySeen = false;
	receiptArmed = false;
	receiptSeen = false;
	urlProgress = "none";
	refused: Record<string, number> = {};
	requests = 0;
	closed = false;
	readonly control = createServer((q, s) => void this.rpc(q, s));
	readonly seed = createServer((q, s) => void this.signal(q, s));
	constructor(
		readonly identity: OriginalIdentity,
		readonly session: GrantSession,
		readonly deadline: Deadline,
	) {
		if (
			!/^[a-f0-9]{32}$/.test(identity.nonce) ||
			!Number.isInteger(identity.receiverPort) ||
			identity.receiverPort < 20000 ||
			identity.receiverPort > 39999 ||
			identity.flavor !== "auth-retirement-proof" ||
			!/^[a-f0-9]{40}$/.test(identity.sourceSha)
		)
			throw new ReplayRefused("identity");
		for (const server of [this.seed, this.control]) {
			server.maxConnections = 16;
			server.headersTimeout = 10000;
			server.requestTimeout = 10000;
			server.keepAliveTimeout = 1;
		}
	}
	private refuse(s: ServerResponse, reason: string) {
		this.refused[reason] = (this.refused[reason] ?? 0) + 1;
		if (!s.destroyed && !s.writableEnded) {
			s.writeHead(400);
			s.end();
		}
	}
	private admitRequest() {
		if (this.closed || this.deadline.remaining() <= 0)
			throw new ReplayRefused("closed");
		if (++this.requests > 16) throw new ReplayRefused("request-count");
	}
	private async body(q: IncomingMessage) {
		const chunks: Buffer[] = [];
		let bytes = 0;
		const timer = setTimeout(() => q.destroy(), this.deadline.cap(10000));
		try {
			for await (const chunk of q) {
				const data = Buffer.from(chunk);
				bytes += data.length;
				if (bytes > 8192) throw new ReplayRefused("body-cap");
				chunks.push(data);
			}
			return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
		} catch (error) {
			throw error instanceof ReplayRefused ? error : new ReplayRefused("json");
		} finally {
			clearTimeout(timer);
		}
	}
	private auth(q: IncomingMessage, header: string, expected: string) {
		const value = q.headers[header];
		return (
			typeof value === "string" &&
			Buffer.byteLength(value) === Buffer.byteLength(expected) &&
			timingSafeEqual(Buffer.from(value), Buffer.from(expected))
		);
	}
	private async signal(q: IncomingMessage, s: ServerResponse) {
		try {
			this.admitRequest();
			if (
				q.method !== "POST" ||
				!["/ready", "/progress", "/receipt"].includes(q.url ?? "")
			) {
				this.refuse(s, "method-or-path");
				return;
			}
			if (!this.auth(q, "x-proof-nonce", this.identity.nonce)) {
				this.refuse(s, "nonce");
				return;
			}
			const body = await this.body(q);
			let refusal: string | null = null;
			if (q.url === "/ready") {
				refusal = signalRefusal(
					body,
					"/ready",
					"seed",
					this.identity.flavor,
					this.identity.sourceSha,
				);
				if (!refusal && (!this.readyArmed || this.readySeen))
					refusal = "no-waiter";
				if (!refusal) {
					this.readySeen = true;
					this.ready.resolve();
				}
			} else if (q.url === "/progress") {
				refusal = signalRefusal(
					body,
					"/progress",
					"seed",
					this.identity.flavor,
					this.identity.sourceSha,
				);
				if (!refusal && (!this.receiptArmed || this.receiptSeen))
					refusal = "no-waiter";
				if (!refusal) {
					const b = body as Record<string, unknown>;
					this.urlProgress =
						b.kind === "url-admitted"
							? "admitted"
							: `refused:${String(b.reason)}`;
				}
			} else {
				refusal = receiptRefusal(
					body,
					"seed",
					this.identity.flavor,
					this.identity.sourceSha,
				);
				if (!refusal && (!this.receiptArmed || this.receiptSeen))
					refusal = "no-waiter";
				if (!refusal) {
					const b = body as Record<string, unknown>;
					if (
						b.ok === true &&
						Object.keys(b).sort().join(",") !==
							"flavor,ok,phase,rawOauthPresent,sourceSha"
					)
						refusal = "unknown-key";
					else {
						this.receiptSeen = true;
						this.receiptArmed = false;
						const cause = receiptCause("seed", b, 0);
						if (cause) this.receipt.reject(new ReplayRefused(cause));
						else this.receipt.resolve(b);
					}
				}
			}
			if (refusal) {
				this.refuse(s, refusal);
				return;
			}
			s.writeHead(204);
			s.end();
		} catch (error) {
			this.refuse(
				s,
				error instanceof ReplayRefused ? error.code : "coarse-type",
			);
		}
	}
	private async rpc(q: IncomingMessage, s: ServerResponse) {
		try {
			this.admitRequest();
			if (
				q.method !== "POST" ||
				q.url !== "/rpc" ||
				!this.auth(q, "authorization", `Bearer ${this.session.bearer}`)
			) {
				this.refuse(s, "rpc-auth");
				return;
			}
			const body = await this.body(q);
			if (!body || typeof body !== "object" || Array.isArray(body))
				throw new ReplayRefused("rpc-schema");
			const b = body as Record<string, unknown>;
			if (
				Object.keys(b).some(
					(key) =>
						!["session", "kind", "challenge", "observation"].includes(key),
				) ||
				b.session !== this.session.id ||
				typeof b.kind !== "string" ||
				typeof b.challenge !== "string" ||
				["observed", "authorize-tap"].includes(b.kind) !==
					Object.hasOwn(b, "observation")
			)
				throw new ReplayRefused("rpc-schema");
			// Waiting is not inspection authority. Runner-ready reaches the host before
			// launch; this one bounded long-poll waits for openURL, with no polling retry.
			if (b.kind === "before-observe" && this.session.stage === "bootstrap")
				await waitFor(this.opened.promise, this.deadline.cap(100000));
			if (this.closed) throw new ReplayRefused("closed");
			const permit = await this.session.request(
				b.kind,
				b.challenge,
				b.observation,
			);
			if (b.kind === "runner-ready") this.runner.resolve();
			if (this.closed || s.destroyed) return;
			const bytes = Buffer.from(JSON.stringify(permit));
			if (bytes.length > 8192) throw new ReplayRefused("response-cap");
			s.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "no-store",
			});
			s.end(bytes);
		} catch (error) {
			this.refuse(s, error instanceof ReplayRefused ? error.code : "rpc-error");
		}
	}
	async listen() {
		const listen = (server: Server, port: number) =>
			new Promise<void>((yes, no) => {
				server.once("error", no);
				server.listen(port, "127.0.0.1", () => {
					server.removeListener("error", no);
					yes();
				});
			});
		try {
			await listen(this.seed, this.identity.receiverPort);
			await listen(this.control, 0);
		} catch (error) {
			await this.close();
			throw error;
		}
		const address = this.control.address();
		if (!address || typeof address === "string")
			throw new ReplayRefused("receiver");
		return `http://127.0.0.1:${address.port}/rpc`;
	}
	armReady() {
		if (this.closed || this.readyArmed) throw new ReplayRefused("stage");
		this.readyArmed = true;
	}
	open() {
		if (this.closed || !this.readySeen || this.receiptArmed)
			throw new ReplayRefused("stage");
		this.session.opened();
		this.receiptArmed = true;
		this.opened.resolve();
	}
	async close() {
		if (this.closed) return;
		this.closed = true;
		this.session.stage = "terminal";
		const error = new ReplayRefused("closed");
		for (const pending of [this.opened, this.ready, this.runner, this.receipt])
			pending.reject(error);
		await Promise.all(
			[this.control, this.seed].map(
				(server) =>
					new Promise<void>((yes) => {
						server.closeAllConnections();
						server.close(() => yes());
					}),
			),
		);
	}
}
