import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
	RECONNECT_BACKOFF_MIN_MS,
	RECONNECT_DEADLINE_MS,
} from "@/features/session/connection-view";
import { OUTAGE_GRACE_MS } from "@/features/session/resume-hold";
import { useSessionRuntime } from "@/features/session/use-session";
import { RelayEndpoints } from "@/relay/endpoints";
import { RelayHttpClient } from "@/relay/http";
import { installDomShim } from "@/testing/dom-shim";
import { fixtureBody } from "@/testing/fixture-relay";

const admission = vi.hoisted(() => ({
	relay: () => null as RelayEndpoints | null,
}));
const appState = vi.hoisted(() => ({
	currentState: "active",
	listeners: new Set<(state: string) => void>(),
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({
		...admission,
		coldStartSettled: true,
		lastError: null,
	}),
	useConnectionState: () => ({
		route: { mode: "lan", baseUrl: "https://relay.invalid" },
		phase: "live",
		revision: 1,
		tunnelId: null,
	}),
	configStore: { getState: () => ({}), subscribe: () => () => {} },
	listStore: { getState: () => ({ liveFrameAt: null, capabilities: {} }) },
	currentWarmScope: () => null,
}));
vi.mock("react-native", () => ({
	AppState: {
		get currentState() {
			return appState.currentState;
		},
		addEventListener: (_type: string, listener: (state: string) => void) => {
			appState.listeners.add(listener);
			return { remove: () => appState.listeners.delete(listener) };
		},
	},
	Platform: { OS: "web" },
}));
vi.mock("@/state/warm-sync", () => ({ warmSync: { view: () => () => {} } }));
vi.mock("@/features/session/warm-store", () => ({ warmCache: {} }));

/** `keyed: false` keeps ONE hook instance across a session change, the way a
 *  screen that re-renders with a new id does (refs survive the switch). */
function mount({ keyed = true }: { keyed?: boolean } = {}) {
	const dom = installDomShim();
	const root = createRoot(dom.container as Element);
	let current!: ReturnType<typeof useSessionRuntime>;
	function Probe({ sid }: { sid: string }) {
		current = useSessionRuntime(sid);
		return null;
	}
	return {
		show: (sid: string) =>
			act(async () =>
				root.render(createElement(Probe, keyed ? { key: sid, sid } : { sid })),
			),
		read: () => current,
		close: async () => {
			await act(async () => root.unmount());
			dom.dispose();
		},
	};
}

const SESSION_EVENTS_PATH = /\/sessions\/([^/]+)\/events$/;
const KEEPALIVE = ": keepalive\n\n";

// Keep the real HTTP/SSE parser and session hook: only the network boundary
// is injected. Like the relay daemon (`api_session_events`), a body says
// nothing until its seed; `gate` holds an attempt's HTTP headers.
function transport(
	status?: (attempt: number) => number,
	gate?: (attempt: number) => Promise<void> | undefined,
) {
	const requests: string[] = [];
	const attempts: {
		sid: string;
		signal: AbortSignal | null | undefined;
		send: (chunk: string) => void;
		fail: () => void;
	}[] = [];
	const encoder = new TextEncoder();
	const fetchImpl: typeof fetch = async (input, init) => {
		const path = new URL(input instanceof Request ? input.url : input).pathname;
		const sid = SESSION_EVENTS_PATH.exec(path)?.[1];
		if (!sid) {
			if (path.endsWith("/history"))
				return Response.json({ entries: [], has_more: false });
			return Response.json({}, { status: 404 });
		}
		requests.push(sid);
		const attempt = requests.length;
		const code = status?.(attempt) ?? 200;
		await gate?.(attempt);
		if (code !== 200)
			return Response.json(
				{ error: "authentication required" },
				{ status: code },
			);
		return new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					attempts.push({
						sid,
						signal: init?.signal,
						send: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
						fail: () => controller.error(new TypeError("network lost")),
					});
				},
			}),
			{ headers: { "content-type": "text/event-stream" } },
		);
	};
	const client = new RelayEndpoints(
		new RelayHttpClient({
			fetchImpl,
			baseUrl: "https://relay.invalid",
			auth: () => ({
				cookie: null,
				origin: "https://relay.invalid",
				credentials: "omit",
			}),
		}),
	);
	admission.relay = () => client;
	return { attempts, requests };
}

const frame = (sid: string) =>
	`event: projection\ndata: ${JSON.stringify({
		...(fixtureBody("sse/sse-projection-checkpoints-empty.json") as object),
		session_id: sid,
	})}\n\n`;
const advance = (ms: number) =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	appState.currentState = "active";
	appState.listeners.clear();
});

const changeAppState = (state: string) =>
	act(async () => {
		appState.currentState = state;
		for (const listener of appState.listeners) listener(state);
	});

it("retries only when a keepalive proves the seed was skipped, then clears recovery", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("silent-a");
		expect(attempts.map(({ sid }) => sid)).toEqual(["silent-a"]);
		// The daemon is still building the seed: no bytes, no banner, no restart.
		await advance(20_000);
		expect(attempts[0]?.signal?.aborted).toBe(false);
		expect(probe.read().connection.id).toBeNull();
		await act(async () => attempts[0]?.send(KEEPALIVE));
		expect(attempts[0]?.signal?.aborted).toBe(true);
		// The restart has not failed: no banner yet (#369 design D1).
		expect(probe.read().connection.id).toBeNull();
		await advance(RECONNECT_BACKOFF_MIN_MS);
		expect(probe.read().connection.id).toBeNull();
		expect(attempts.map(({ sid }) => sid)).toEqual(["silent-a", "silent-a"]);
		await act(async () => attempts[1]?.send(frame("silent-a")));
		expect(probe.read().projection?.session_id).toBe("silent-a");
		expect(probe.read().content).toBe("transcript");
		expect(probe.read().connection.id).toBeNull();
		await advance(RECONNECT_DEADLINE_MS + 1);
		expect(attempts).toHaveLength(2);
	} finally {
		await probe.close();
	}
});

it("holds a missed-seed restart behind the outage grace, then reports it (#369 D1)", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("grace-a");
		// t=0: the seed is skipped. The restart has not failed, so no banner.
		await act(async () => attempts[0]?.send(KEEPALIVE));
		expect(probe.read().connection.id).toBeNull();
		await advance(RECONNECT_BACKOFF_MIN_MS);
		expect(attempts).toHaveLength(2);
		expect(probe.read().connection.id).toBeNull();
		// t=1 s: the restart skips its seed too. That does not re-arm the grace.
		await act(async () => attempts[1]?.send(KEEPALIVE));
		await advance(OUTAGE_GRACE_MS - RECONNECT_BACKOFF_MIN_MS - 1);
		expect(probe.read().connection.id).toBeNull();
		// t=2.5 s: still no seed, so the recovery is reported — as a reconnect,
		// not as a drop that never happened.
		await advance(1);
		expect(probe.read().connection.id).toBe("C2");
		expect(probe.read().connection.text).toBe("Reconnecting…");
		// The next seed retires the report at once.
		await advance(RECONNECT_BACKOFF_MIN_MS * 2);
		expect(attempts).toHaveLength(3);
		await act(async () => attempts[2]?.send(frame("grace-a")));
		expect(probe.read().connection.id).toBeNull();
	} finally {
		await probe.close();
	}
});

it("lets a 5.1 s first projection finish without a restart or Reconnecting", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("slow-a");
		const seed = frame("slow-a");
		const split = Math.floor(seed.length / 2);
		await act(async () => attempts[0]?.send(seed.slice(0, split)));
		await advance(RECONNECT_DEADLINE_MS);
		expect(probe.read().connection.id).toBeNull();
		expect(attempts[0]?.signal?.aborted).toBe(false);
		await advance(100);
		await act(async () => attempts[0]?.send(seed.slice(split)));
		expect(attempts).toHaveLength(1);
		expect(probe.read().projection?.session_id).toBe("slow-a");
		expect(probe.read().connection.id).toBeNull();
	} finally {
		await probe.close();
	}
});

it("accepts a projection progressing at 0, 30 and 40 seconds", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("long-a");
		const seed = frame("long-a");
		const first = Math.floor(seed.length / 3);
		const second = Math.floor((seed.length * 2) / 3);
		await act(async () => attempts[0]?.send(seed.slice(0, first)));
		await advance(30_000);
		expect(attempts[0]?.signal?.aborted).toBe(false);
		expect(probe.read().connection.id).toBeNull();
		await act(async () => attempts[0]?.send(seed.slice(first, second)));
		await advance(10_000);
		expect(attempts[0]?.signal?.aborted).toBe(false);
		await act(async () => attempts[0]?.send(seed.slice(second)));
		expect(attempts).toHaveLength(1);
		expect(probe.read().projection?.session_id).toBe("long-a");
		expect(probe.read().connection.id).toBeNull();
	} finally {
		await probe.close();
	}
});

it("keeps a slow first answer quiet but reports a reconnect that gets no answer", async () => {
	vi.useFakeTimers();
	const held: (() => void)[] = [];
	const { attempts } = transport(undefined, (attempt) =>
		attempt === 1 || attempt === 2
			? new Promise<void>((resolve) => held.push(resolve))
			: undefined,
	);
	const probe = mount();
	try {
		await probe.show("quiet-a");
		await advance(RECONNECT_DEADLINE_MS + 1_000);
		expect(probe.read().connection.id).toBeNull();
		await act(async () => held.shift()?.());
		await act(async () => attempts[0]?.send(frame("quiet-a")));
		expect(probe.read().projection?.session_id).toBe("quiet-a");
		// A real drop: the replacement's headers are now late, which is C2.
		await act(async () => attempts[0]?.fail());
		await advance(RECONNECT_DEADLINE_MS + 2_000);
		expect(probe.read().connection.id).toBe("C2");
		await act(async () => held.shift()?.());
		await act(async () => attempts[1]?.send(frame("quiet-a")));
		expect(probe.read().connection.id).toBeNull();
	} finally {
		await probe.close();
	}
});

it("does not start the held retry while backgrounded", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("retry-background-a");
		await act(async () => attempts[0]?.send(KEEPALIVE));
		expect(attempts[0]?.signal?.aborted).toBe(true);
		await changeAppState("background");
		await advance(RECONNECT_BACKOFF_MIN_MS + 2_000);
		expect(attempts).toHaveLength(1);
		await changeAppState("active");
		expect(attempts).toHaveLength(2);
		await act(async () => attempts[1]?.send(frame("retry-background-a")));
		await advance(10_000);
		expect(attempts).toHaveLength(2);
	} finally {
		await probe.close();
	}
});

it("does not reconnect on a retry timer that fires late before the active event", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("suspended-a");
		await act(async () => attempts[0]?.send(KEEPALIVE));
		// A frozen process: the wall clock jumps a minute while no timer ran, so
		// the pending retry fires late before AppState reports active.
		vi.setSystemTime(Date.now() + 60_000);
		await advance(RECONNECT_BACKOFF_MIN_MS);
		expect(attempts).toHaveLength(1);
		await changeAppState("active");
		expect(attempts).toHaveLength(2);
	} finally {
		await probe.close();
	}
});

it("retries a failed reopen after a return at the backoff delay, with no banner (#369 R3-1)", async () => {
	vi.useFakeTimers();
	// Request 2 is the return's reopen: the radio is still waking, so it fails
	// before any headers, the way a stale socket does right after an unlock.
	const { attempts, requests } = transport(undefined, (attempt) =>
		attempt === 2 ? Promise.reject(new TypeError("network lost")) : undefined,
	);
	const probe = mount();
	try {
		await probe.show("wake-a");
		await act(async () => attempts[0]?.send(frame("wake-a")));
		expect(probe.read().projection?.session_id).toBe("wake-a");
		await changeAppState("background");
		vi.setSystemTime(Date.now() + 10 * 60_000);
		await changeAppState("active");
		expect(requests).toHaveLength(2);
		await advance(RECONNECT_BACKOFF_MIN_MS - 1);
		expect(requests).toHaveLength(2);
		expect(probe.read().connection.id).toBeNull();
		// The retry fires at the plain backoff delay, not at the end of the
		// 8 s resume window (where it used to come due with the drop report).
		await advance(1);
		expect(requests).toHaveLength(3);
		await act(async () => attempts[1]?.send(frame("wake-a")));
		expect(probe.read().connection.id).toBeNull();
		for (let elapsed = 0; elapsed < 12_000; elapsed += 500) {
			await advance(500);
			expect(probe.read().connection.id).toBeNull();
		}
		expect(requests).toHaveLength(3);
	} finally {
		await probe.close();
	}
});

it("does not carry a recovery into the next session's first load (#369 R3-2)", async () => {
	vi.useFakeTimers();
	// Request 2 is B's first open; its headers are slow (machine load).
	const held: (() => void)[] = [];
	const { attempts } = transport(undefined, (attempt) =>
		attempt === 2
			? new Promise<void>((resolve) => held.push(resolve))
			: undefined,
	);
	const probe = mount({ keyed: false });
	try {
		await probe.show("carry-a");
		// A skipped seed puts A into recovery, and the reader switches away
		// before A's retry fires.
		await act(async () => attempts[0]?.send(KEEPALIVE));
		expect(attempts[0]?.signal?.aborted).toBe(true);
		await probe.show("carry-b");
		await advance(RECONNECT_DEADLINE_MS + 1_000);
		expect(probe.read().connection.id).toBeNull();
		await act(async () => held.shift()?.());
		await act(async () => attempts[1]?.send(frame("carry-b")));
		expect(probe.read().projection?.session_id).toBe("carry-b");
		expect(probe.read().connection.id).toBeNull();
	} finally {
		await probe.close();
	}
});

it("retires A's stream when switching to B and ignores A's late frame", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("switch-a");
		await advance(RECONNECT_DEADLINE_MS - 10);
		await probe.show("switch-b");
		expect(attempts[0]?.signal?.aborted).toBe(true);
		await act(async () => attempts[0]?.send(frame("switch-a")));
		await advance(10 + RECONNECT_BACKOFF_MIN_MS);
		expect(attempts.map(({ sid }) => sid)).toEqual(["switch-a", "switch-b"]);
		expect(probe.read().projection).toBeNull();
		await act(async () => attempts[1]?.send(frame("switch-b")));
		expect(probe.read().projection?.session_id).toBe("switch-b");
	} finally {
		await probe.close();
	}
});

it.each([
	["a finished malformed projection", "event: projection\ndata: <html>\n\n"],
	["a finished projection for another session", frame("foreign-b")],
])("retries %s instead of waiting for the seed", async (_name, wire) => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("selected-a");
		await act(async () => attempts[0]?.send(wire));
		expect(attempts[0]?.signal?.aborted).toBe(true);
		expect(probe.read().projection).toBeNull();
		await advance(RECONNECT_BACKOFF_MIN_MS);
		expect(attempts).toHaveLength(2);
		await act(async () => attempts[1]?.send(frame("selected-a")));
		expect(probe.read().projection?.session_id).toBe("selected-a");
	} finally {
		await probe.close();
	}
});

it("ignores an unknown event before the seed (the streams are additive)", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("additive-a");
		await act(async () => attempts[0]?.send("event: future\ndata: {}\n\n"));
		expect(attempts[0]?.signal?.aborted).toBe(false);
		await act(async () => attempts[0]?.send(frame("additive-a")));
		expect(probe.read().projection?.session_id).toBe("additive-a");
	} finally {
		await probe.close();
	}
});

it("backs off repeated skipped seeds and stops on a typed authentication failure", async () => {
	vi.useFakeTimers();
	const { attempts, requests } = transport((attempt) =>
		attempt < 4 ? 200 : 401,
	);
	const probe = mount();
	try {
		await probe.show("refused-a");
		for (const [index, backoff] of [
			[0, 1_000],
			[1, 2_000],
			[2, 4_000],
		] as const) {
			await act(async () => attempts[index]?.send(KEEPALIVE));
			expect(attempts[index]?.signal?.aborted).toBe(true);
			await advance(backoff - 1);
			expect(requests).toHaveLength(index + 1);
			await advance(1);
			expect(requests).toHaveLength(index + 2);
		}
		expect(probe.read().error?.kind).toBe("relay-unauthorized");
		expect(probe.read().content).toBe("recovery");
		expect(probe.read().link).toBe("stopped");
		await advance(60_000);
		expect(requests).toHaveLength(4);
	} finally {
		await probe.close();
	}
});
