/**
 * A minimal Chrome DevTools Protocol client over Node's built-in `WebSocket`.
 *
 * Why hand-rolled: ADR 0003 requires the capture path to have no dependency
 * beyond Node and the installed Chrome — no `ws`, no puppeteer, no downloaded
 * engine. Node ships a global `WebSocket`, so the whole client is a message
 * router.
 *
 * Two traps this file exists to avoid:
 *
 * 1. **Every command is bounded.** A CDP call that never resolves hangs a CI job
 *    with no output. `send()` always carries a timeout and rejects with the
 *    method name, so a wedged browser reads as a failure rather than as silence.
 * 2. **Events must be routable per target.** Chrome multiplexes every target's
 *    events onto one socket; a handler that ignores `sessionId` sees the wrong
 *    page's console errors, which reads as the app failing when it is not.
 *
 * The protocol is a boundary this process does not own, so payloads arrive as
 * `unknown` and are narrowed where they are read — see `asParams` and
 * `narrowResult`, the two places a CDP message becomes something usable.
 */

/** Thrown when a CDP command does not answer inside its budget. */
export class CdpTimeout extends Error {}

/** A CDP command's parameters, as this client sends them. */
export type CdpParams = Record<string, unknown>;

/** A value returned by `Runtime.evaluate`; the JSON domain a page can produce. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

/** One listener for a CDP method, optionally bound to a single target's session. */
export type CdpListener = (params: CdpParams, sessionId?: string) => void;

/** A listener carrying the session it was registered against. */
type ScopedListener = CdpListener & { sessionId?: string };

interface PendingCommand {
	resolve: (value: CdpParams) => void;
	reject: (error: Error) => void;
	method: string;
	timer: ReturnType<typeof setTimeout>;
}

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The message-routing seam.
 *
 * `JSON.parse` is typed `any` and a CDP frame is not ours to trust, so this is
 * where a raw socket message is reduced to the three fields the router needs,
 * with `id`/`method`/`sessionId` checked by `typeof` rather than asserted.
 */
function narrowMessage(raw: unknown): NarrowedCdpMessage | undefined {
	const text = typeof raw === "string" ? raw : undefined;
	if (text === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined; // Chrome never sends non-JSON; if it does, it is not ours to fail on.
	}
	const bag = asParams(parsed);
	if (bag === undefined) return undefined;
	return {
		id: typeof bag.id === "number" ? bag.id : undefined,
		method: typeof bag.method === "string" ? bag.method : undefined,
		sessionId: typeof bag.sessionId === "string" ? bag.sessionId : undefined,
		// A command's result and an event's params occupy the same "payload" slot
		// for the router's purpose: either way it is the object the caller reads.
		params: asParams(bag.params ?? bag.result) ?? {},
		error: errorText(bag.error),
	};
}

/** A CDP `error` field as text, from either the string or the `{message}` form. */
function errorText(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	const bag = asParams(value);
	if (bag === undefined) return undefined;
	return typeof bag.message === "string" ? bag.message : "unknown CDP error";
}

/** A CDP payload as a string-keyed bag: `undefined` when it is not a plain object. */
function asParams(value: unknown): CdpParams | undefined {
	// The cast is safe because the `typeof`/null/Array checks beside it establish
	// exactly what `CdpParams` claims: a non-null, non-array object. The compiler
	// cannot carry that through the negation, which is why the cast is here.
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as CdpParams)
		: undefined;
}

/** The three fields the router reads off a CDP frame, each already narrowed. */
interface NarrowedCdpMessage {
	id?: number;
	method?: string;
	sessionId?: string;
	params: CdpParams;
	error?: string;
}

class CdpClient {
	readonly url: string;
	readonly commandTimeoutMs: number;
	private socket: WebSocket | undefined;
	private nextId = 1;
	private readonly pending = new Map<number, PendingCommand>();
	private readonly listeners = new Map<string, Set<ScopedListener>>();

	constructor(
		url: string,
		{ commandTimeoutMs = 30_000 }: { commandTimeoutMs?: number } = {},
	) {
		this.url = url;
		this.commandTimeoutMs = commandTimeoutMs;
	}

	/** Open the socket and resolve once the protocol is ready to carry commands. */
	open(): Promise<this> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(this.url);
			this.socket = socket;
			socket.addEventListener("message", (event: MessageEvent) =>
				this.dispatch(event.data),
			);
			socket.addEventListener("error", () => {
				reject(new Error(`CDP socket error connecting to ${this.url}`));
			});
			socket.addEventListener("close", () => {
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

	private dispatch(raw: unknown): void {
		const message = narrowMessage(raw);
		if (message === undefined) return;
		if (message.id !== undefined) {
			const entry = this.pending.get(message.id);
			if (entry === undefined) return;
			this.pending.delete(message.id);
			clearTimeout(entry.timer);
			if (message.error !== undefined)
				entry.reject(new Error(`${entry.method}: ${message.error}`));
			else entry.resolve(message.params);
			return;
		}
		if (message.method === undefined) return;
		for (const listener of this.listeners.get(message.method) ?? []) {
			// A listener bound to one target must not fire for another's events.
			const bound = listener.sessionId;
			if (bound !== undefined && bound !== message.sessionId) continue;
			listener(message.params, message.sessionId);
		}
	}

	send(
		method: string,
		params: CdpParams = {},
		sessionId?: string,
	): Promise<CdpParams> {
		return new Promise((resolve, reject) => {
			if (this.socket === undefined) {
				reject(new Error(`CDP socket is not open (cannot call ${method})`));
				return;
			}
			const id = this.nextId++;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new CdpTimeout(
						`CDP ${method} did not answer within ${this.commandTimeoutMs} ms`,
					),
				);
			}, this.commandTimeoutMs);
			this.pending.set(id, { resolve, reject, method, timer });
			this.socket.send(
				JSON.stringify(
					sessionId === undefined
						? { id, method, params }
						: { id, method, params, sessionId },
				),
			);
		});
	}

	on(method: string, fn: ScopedListener): () => void {
		const set = this.listeners.get(method) ?? new Set<ScopedListener>();
		set.add(fn);
		this.listeners.set(method, set);
		return () => set.delete(fn);
	}

	/** Create a fresh page target and attach to it flat, so its commands carry a sessionId. */
	async newPage(url = "about:blank"): Promise<CdpPage> {
		const created = await this.send("Target.createTarget", { url });
		const targetId =
			typeof created.targetId === "string" ? created.targetId : "";
		const attached = await this.send("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		const sessionId =
			typeof attached.sessionId === "string" ? attached.sessionId : "";
		if (targetId === "" || sessionId === "")
			throw new Error("Chrome refused to create or attach a page target");
		return new CdpPage(this, sessionId, targetId);
	}

	async close(): Promise<void> {
		try {
			this.socket?.close();
		} catch {
			// A socket already closed by Chrome is the normal teardown race.
		}
	}
}

/** A page target: every call is the same client with the sessionId pre-bound. */
export class CdpPage {
	private readonly client: CdpClient;
	readonly sessionId: string;
	readonly targetId: string;

	constructor(client: CdpClient, sessionId: string, targetId: string) {
		this.client = client;
		this.sessionId = sessionId;
		this.targetId = targetId;
	}

	send(method: string, params: CdpParams = {}): Promise<CdpParams> {
		return this.client.send(method, params, this.sessionId);
	}

	/** Subscribe to one of this page's own events; other targets' events are filtered out. */
	on(method: string, fn: CdpListener): () => void {
		// The session binding rides on the listener itself, which is how the client
		// knows which of several pages an event belongs to.
		const scoped: ScopedListener = Object.assign(fn, {
			sessionId: this.sessionId,
		});
		return this.client.on(method, scoped);
	}

	/** `Runtime.evaluate` with awaitPromise, returning the value or throwing on a JS error. */
	async evaluate(
		expression: string,
		{ awaitPromise = true }: { awaitPromise?: boolean } = {},
	): Promise<unknown> {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise,
			returnByValue: true,
		});
		const exception = asParams(result.exceptionDetails);
		if (exception !== undefined) {
			const inner = asParams(exception.exception);
			const description =
				typeof inner?.description === "string"
					? inner.description
					: String(exception.text ?? "no description");
			throw new Error(`evaluate failed: ${description}`);
		}
		return asParams(result.result)?.value ?? null;
	}
}

/** Resolve the browser-level WebSocket URL from Chrome's HTTP listing. */
export async function browserWebSocketUrl(
	port: number,
	{ timeoutMs = 15_000 } = {},
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			const body: unknown = await res.json();
			const bag = asParams(body);
			const url = bag?.webSocketDebuggerUrl;
			if (typeof url === "string" && url !== "") return url;
			lastError = new Error("/json/version had no webSocketDebuggerUrl");
		} catch (error) {
			lastError = error;
		}
		await sleep(200);
	}
	const reason =
		lastError instanceof Error ? lastError.message : String(lastError);
	throw new Error(`Chrome never answered /json/version on ${port}: ${reason}`);
}

/** Connect and hand back a client whose socket is open. */
export async function connect(
	wsUrl: string,
	options: { commandTimeoutMs?: number } = {},
): Promise<CdpClient> {
	const client = new CdpClient(wsUrl, options);
	return client.open();
}
