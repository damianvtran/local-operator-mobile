/**
 * A minimal Chrome DevTools Protocol client over Node's built-in `WebSocket`.
 *
 * Why hand-rolled: ADR 0003 requires the capture path to have no dependency
 * beyond Node and the installed Chrome — no `ws`, no puppeteer, no downloaded
 * engine. Node 22+ ships a global `WebSocket`, so the whole client is a message
 * router.
 *
 * Two traps this file exists to avoid:
 *
 * 1. **Every command is bounded.** A CDP call that never resolves hangs a CI
 *    job with no output. `send()` always carries a timeout and rejects with the
 *    method name in the message, so a wedged browser reads as a failure rather
 *    than as silence.
 * 2. **Events must be routable per target.** Chrome multiplexes every target's
 *    events onto one socket; a handler that ignores `sessionId` sees the wrong
 *    page's console errors, which reads as the app failing when it is not.
 */

/** Thrown when a CDP command does not answer inside its budget. */
export class CdpTimeout extends Error {}

class CdpClient {
	constructor(url, { commandTimeoutMs = 30_000 } = {}) {
		this.url = url;
		this.commandTimeoutMs = commandTimeoutMs;
		this.nextId = 1;
		this.pending = new Map(); // id → {resolve, reject, method, timer}
		this.listeners = new Map(); // "method" | "method@sessionId" → Set<fn>
		this.closed = false;
	}

	/** Open the socket and resolve once the protocol is ready to carry commands. */
	open() {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(this.url);
			this.socket = socket;
			socket.addEventListener("message", (event) => this.#dispatch(event.data));
			socket.addEventListener("error", () => {
				reject(new Error(`CDP socket error connecting to ${this.url}`));
			});
			socket.addEventListener("close", () => {
				this.closed = true;
				// Fail every in-flight command rather than leaving callers parked.
				for (const [id, entry] of this.pending) {
					clearTimeout(entry.timer);
					entry.reject(new Error(`CDP socket closed during ${entry.method}`));
					this.pending.delete(id);
				}
			});
			socket.addEventListener("open", () => resolve(this));
		});
	}

	#dispatch(raw) {
		let message;
		try {
			message = JSON.parse(typeof raw === "string" ? raw : String(raw));
		} catch {
			return; // Chrome never sends non-JSON; if it does, it is not ours to fail on.
		}
		if (message.id !== undefined) {
			const entry = this.pending.get(message.id);
			if (!entry) return;
			this.pending.delete(message.id);
			clearTimeout(entry.timer);
			if (message.error) {
				entry.reject(new Error(`${entry.method}: ${message.error.message}`));
			} else entry.resolve(message.result ?? {});
			return;
		}
		if (!message.method) return;
		for (const key of [`${message.method}@${message.sessionId}`, message.method]) {
			const set = this.listeners.get(key);
			if (!set) continue;
			for (const fn of set) fn(message.params ?? {}, message.sessionId);
		}
	}

	on(method, fn) {
		const key = `${method}@${fn.sessionId ?? ""}`.replace(/@$/, "");
		const set = this.listeners.get(key) ?? new Set();
		set.add(fn);
		this.listeners.set(key, set);
		return () => set.delete(fn);
	}

	/** Resolve a flat-session command on `sessionId`, or the browser session when omitted. */
	send(method, params = {}, sessionId = undefined) {
		if (this.closed) return Promise.reject(new Error(`CDP closed; ${method} not sent`));
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new CdpTimeout(`${method} did not answer within ${this.commandTimeoutMs} ms`));
			}, this.commandTimeoutMs);
			this.pending.set(id, { resolve, reject, method, timer });
			this.socket.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}

	/** Create a fresh page target and attach to it flat, so its commands carry a sessionId. */
	async newPage(url = "about:blank") {
		const { targetId } = await this.send("Target.createTarget", { url });
		const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
		return new CdpPage(this, sessionId, targetId);
	}

	async close() {
		this.closed = true;
		try {
			this.socket?.close();
		} catch {
			// A socket already closed by Chrome is the normal teardown race.
		}
	}
}

/**
 * Resolve the browser-level WebSocket URL from Chrome's HTTP listing.
 *
 * A standalone export rather than a static on the client class: this module
 * exports `connect`, a plain function, so a static method on `CdpClient` is not
 * reachable through it — a mistake that fails at the first real browser launch
 * and never at import time.
 */
export async function browserWebSocketUrl(port, { timeoutMs = 15_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let lastError;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			const body = await res.json();
			if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
			lastError = new Error("/json/version had no webSocketDebuggerUrl");
		} catch (error) {
			lastError = error;
		}
		await sleep(200);
	}
	throw new Error(`Chrome never answered /json/version on ${port}: ${lastError?.message}`);
}

/** A page target: every call is the same client with the sessionId pre-bound. */
class CdpPage {
	constructor(client, sessionId, targetId) {
		this.client = client;
		this.sessionId = sessionId;
		this.targetId = targetId;
	}

	send(method, params = {}) {
		return this.client.send(method, params, this.sessionId);
	}

	/** Subscribe to one of this page's own events; other targets' events are filtered out. */
	on(method, fn) {
		fn.sessionId = this.sessionId;
		return this.client.on(method, fn);
	}

	/** `Runtime.evaluate` with awaitPromise, returning the JSON-cloned value or throwing on a JS error. */
	async evaluate(expression, { awaitPromise = true } = {}) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			const detail = result.exceptionDetails.exception?.description
				?? result.exceptionDetails.text;
			throw new Error(`evaluate failed: ${detail}`);
		}
		return result.result?.value;
	}
}

export async function connect(wsUrl, options = {}) {
	const client = new CdpClient(wsUrl, options);
	await client.open();
	return client;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
