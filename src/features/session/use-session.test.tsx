import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PromptImage } from "@/contracts";
import {
	RECONNECT_BACKOFF_MIN_MS,
	RECONNECT_DEADLINE_MS,
} from "@/features/session/connection-view";
import { OUTAGE_GRACE_MS } from "@/features/session/resume-hold";
import { resetTurnStopForTests } from "@/features/session/turn-stop";
import {
	type ComposerState,
	useComposer,
} from "@/features/session/use-composer";
import {
	type SessionRuntime,
	useSessionRuntime,
} from "@/features/session/use-session";
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
vi.mock("expo-crypto", async () => ({
	randomUUID: (await import("node:crypto")).randomUUID,
}));

/** `keyed: false` keeps ONE hook instance across a session change, the way a
 *  screen that re-renders with a new id does (refs survive the switch). */
function mount({ keyed = true }: { keyed?: boolean } = {}) {
	const dom = installDomShim();
	const root = createRoot(dom.container as Element);
	let current!: ReturnType<typeof useSessionRuntime>;
	function Probe({ sid }: { sid: string }) {
		current = useSessionRuntime(sid, true);
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

/** Expo's stack retains the old reader when navigating to another dynamic id.
 * Keep every route mounted; only the foreground flag changes on push/pop. */
function mountStack(composerRoute?: string) {
	const dom = installDomShim();
	const root = createRoot(dom.container as Element);
	const readers = new Map<string, SessionRuntime>();
	let composer!: ComposerState;
	function ComposerProbe({
		sid,
		runtime,
	}: {
		sid: string;
		runtime: SessionRuntime;
	}) {
		const [draft, setDraft] = useState("");
		const [images, setImages] = useState<PromptImage[]>([]);
		composer = useComposer({
			sessionId: sid,
			source: runtime.source,
			streaming: runtime.streaming,
			cached: runtime.hydrated,
			awaitingVisit: runtime.awaitingVisit,
			canActOnVisit: runtime.canActOnVisit,
			ended: false,
			capabilities: null,
			editor: { draft, images, setDraft, setImages },
		});
		return null;
	}
	function Probe({ route, focused }: { route: string; focused: boolean }) {
		const sid = route.split("/")[0] ?? "";
		const runtime = useSessionRuntime(sid, focused);
		readers.set(route, runtime);
		return route === composerRoute
			? createElement(ComposerProbe, { sid, runtime })
			: null;
	}
	return {
		show: (...routes: string[]) =>
			act(async () =>
				root.render(
					routes.map((route, i) =>
						createElement(Probe, {
							key: route,
							route,
							focused: i === routes.length - 1,
						}),
					),
				),
			),
		read: (sid: string) => readers.get(sid),
		composer: () => composer,
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
	commandGate?: (attempt: number) => Promise<void> | undefined,
) {
	const requests: string[] = [];
	const commands: {
		path: string;
		method: string | undefined;
		body: unknown;
	}[] = [];
	const signals: (AbortSignal | null | undefined)[] = [];
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
			if (path.endsWith("/command")) {
				commands.push({
					path,
					method: init?.method,
					body: JSON.parse(String(init?.body)),
				});
				await commandGate?.(commands.length);
				return Response.json({ ok: true, detail: "command accepted" });
			}
			if (path.endsWith("/history"))
				return Response.json({ entries: [], has_more: false });
			return Response.json({}, { status: 404 });
		}
		requests.push(sid);
		signals.push(init?.signal);
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
	return { attempts, commands, requests, signals };
}

const frame = (
	sid: string,
	overrides?: { streaming?: boolean; activity?: string },
	fixture = "sse/sse-projection-checkpoints-empty.json",
) =>
	`event: projection\ndata: ${JSON.stringify({
		...(fixtureBody(fixture) as object),
		session_id: sid,
		...overrides,
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

it("retires retained slots for A → B → A and restores the live reader on Back", async () => {
	vi.useFakeTimers();
	const backHeaders = Promise.withResolvers<void>();
	const { attempts, requests } = transport(undefined, (attempt) =>
		attempt === 4 ? backHeaders.promise : undefined,
	);
	const probe = mountStack();
	const a = "stack-a";
	const b = "stack-b";
	const aAgain = `${a}/again`;
	try {
		await probe.show(a);
		await act(async () => attempts[0]?.send(frame(a)));
		const retained = probe.read(a)?.projection;
		expect(retained?.session_id).toBe(a);

		await probe.show(a, b);
		expect(attempts[0]?.signal?.aborted).toBe(true);
		await act(async () => attempts[1]?.send(frame(b)));
		expect(probe.read(b)?.projection?.session_id).toBe(b);
		const bEpoch = probe.read(b)?.streamArrivalEpoch;
		expect(bEpoch).toEqual(expect.any(Number));

		await probe.show(a, b, aAgain);
		expect(attempts[1]?.signal?.aborted).toBe(true);
		await act(async () => attempts[2]?.send(frame(a)));
		expect(probe.read(aAgain)?.projection?.session_id).toBe(a);
		expect(probe.read(aAgain)?.connected).toBe(true);

		await probe.show(a, b);
		expect(attempts[2]?.signal?.aborted).toBe(true);
		// B was already live in its previous visit. Waiting on headers past
		// the reconnect deadline still isn't an outage on this new first leg.
		await advance(RECONNECT_DEADLINE_MS + 100);
		expect(probe.read(b)?.connection.id).toBeNull();
		expect(probe.read(b)?.projection?.session_id).toBe(b);
		expect(requests).toEqual([a, b, a, b]);
		expect(attempts).toHaveLength(3);
		await act(async () => backHeaders.resolve());
		await act(async () => attempts[3]?.send(frame(b, { activity: "new B" })));
		expect(probe.read(b)?.projection?.activity).toBe("new B");
		expect(probe.read(b)?.streamArrivalEpoch).toBeGreaterThan(bEpoch ?? 0);
	} finally {
		backHeaders.resolve();
		await probe.close();
	}
});

it("retains the editor but cannot abort a different desktop turn before Back seeds", async () => {
	const a = "busy-back-a";
	const b = "busy-back-b";
	const transcript = "sse/sse-projection-live-idle.json";
	const backHeaders = Promise.withResolvers<void>();
	const { attempts, commands } = transport(undefined, (attempt) =>
		attempt === 3 ? backHeaders.promise : undefined,
	);
	const probe = mountStack(a);
	try {
		await probe.show(a);
		await act(async () =>
			attempts[0]?.send(
				frame(a, { streaming: true, activity: "old turn" }, transcript),
			),
		);
		const retainedRows = probe.read(a)?.entries.map((row) => row.id);
		expect(retainedRows?.length).toBeGreaterThan(0);
		await act(async () => probe.composer().setDraft("unsent draft"));
		expect(probe.composer().controls.stopVisible).toBe(true);
		const previousStop = probe.composer().stop;
		const previousAnswer = probe.composer().answerApproval;
		const previousSubmit = probe.composer().send;

		await probe.show(a, b);
		await act(async () => attempts[1]?.send(frame(b)));
		await probe.show(a);
		// The retained projection is still busy, and `beginStream` is not a seed.
		expect(probe.read(a)?.projection?.activity).toBe("old turn");
		expect(probe.read(a)?.entries.map((row) => row.id)).toEqual(retainedRows);
		expect(probe.read(a)?.connected).toBe(true);
		expect(probe.composer().draft).toBe("unsent draft");
		expect(probe.composer().controls.stopVisible).toBe(false);
		expect(probe.composer().controls.primary.disabled).toBe(true);
		expect(probe.composer().controls.disabledReason).toBeNull();
		await act(async () => {
			expect(await probe.composer().stop()).toBe(false);
			expect(await previousStop()).toBe(false);
			previousAnswer("old-request", true, false);
			previousSubmit();
			probe.composer().send();
		});
		expect(commands).toEqual([]);

		await act(async () => backHeaders.resolve());
		await act(async () =>
			attempts[2]?.send(
				frame(a, { streaming: true, activity: "new turn" }, transcript),
			),
		);
		expect(probe.read(a)?.projection?.activity).toBe("new turn");
		expect(probe.composer().draft).toBe("unsent draft");
		expect(probe.composer().controls.stopVisible).toBe(true);
		expect(probe.composer().controls.primary.disabled).toBe(false);
		await act(async () => {
			expect(await previousStop()).toBe(false);
			expect(await probe.composer().stop()).toBe(true);
		});
		expect(commands).toEqual([
			{
				path: `/api/sessions/${a}/command`,
				method: "POST",
				body: { op: "abort" },
			},
		]);
	} finally {
		backHeaders.resolve();
		await probe.close();
		resetTurnStopForTests();
	}
});

it("joins a held Stop on authoritative Back until an idle frame ends the turn", async () => {
	vi.useFakeTimers();
	const a = "stop-back-a";
	const b = "stop-back-b";
	const heldAbort = Promise.withResolvers<void>();
	const { attempts, commands } = transport(undefined, undefined, (attempt) =>
		attempt === 1 ? heldAbort.promise : undefined,
	);
	const probe = mountStack(a);
	const busy = frame(a, { streaming: true, activity: "same turn" });
	const abort = {
		path: `/api/sessions/${a}/command`,
		method: "POST",
		body: { op: "abort" },
	};
	try {
		await probe.show(a);
		await act(async () => attempts[0]?.send(busy));
		const firstVisitEpoch = probe.read(a)?.streamArrivalEpoch ?? 0;
		let first!: Promise<boolean>;
		await act(async () => {
			first = probe.composer().stop();
		});
		expect(commands).toEqual([abort]);
		expect(probe.composer().stopping).toBe(true);

		await probe.show(a, b);
		await act(async () => attempts[1]?.send(frame(b)));
		expect(probe.read(a)?.awaitingVisit).toBe(true);
		expect(probe.composer().stopping).toBe(false);
		await probe.show(a);
		expect(probe.read(a)?.awaitingVisit).toBe(true);
		expect(probe.composer().controls.stopVisible).toBe(false);
		expect(probe.composer().stopping).toBe(false);
		await act(async () => expect(await probe.composer().stop()).toBe(false));
		expect(commands).toEqual([abort]);

		await act(async () => attempts[2]?.send(busy));
		expect(probe.read(a)?.streamArrivalEpoch).toBeGreaterThan(firstVisitEpoch);
		expect(probe.read(a)?.awaitingVisit).toBe(false);
		let joined!: Promise<boolean>;
		await act(async () => {
			joined = probe.composer().stop();
		});
		expect(commands).toEqual([abort]);
		expect(joined).toBe(first);
		expect(probe.composer().stopping).toBe(true);
		await act(async () => {
			heldAbort.resolve();
			expect(await joined).toBe(true);
		});

		await act(async () =>
			attempts[2]?.send(frame(a, { streaming: false, activity: "" })),
		);
		expect(probe.read(a)?.awaitingVisit).toBe(false);
		expect(probe.read(a)?.streaming).toBe(false);
		expect(probe.composer().stopping).toBe(false);
		await act(async () =>
			attempts[2]?.send(frame(a, { streaming: true, activity: "next turn" })),
		);
		expect(probe.composer().controls.stopVisible).toBe(true);
		expect(probe.composer().stopping).toBe(false);
		await act(async () => expect(await probe.composer().stop()).toBe(true));
		expect(commands).toEqual([abort, abort]);
	} finally {
		heldAbort.resolve();
		await probe.close();
		resetTurnStopForTests();
	}
});

it("ignores a retired frame and refusal during rapid A → B → C and waits for C's healthy seed", async () => {
	vi.useFakeTimers();
	let finishB: (() => void) | undefined;
	const { attempts, requests, signals } = transport(
		(attempt) => (attempt === 2 ? 401 : 200),
		(attempt) =>
			attempt === 2
				? new Promise<void>((resolve) => {
						finishB = resolve;
					})
				: undefined,
	);
	const probe = mountStack();
	const a = "rapid-a";
	const b = "rapid-b";
	const c = "rapid-c";
	try {
		await probe.show(a);
		await probe.show(a, b);
		await probe.show(a, b, c);
		expect(signals.map((signal) => signal?.aborted)).toEqual([
			true,
			true,
			false,
		]);
		await act(async () => {
			attempts[0]?.send(frame(a));
			finishB?.();
		});
		await advance(RECONNECT_DEADLINE_MS + 100);
		expect(probe.read(a)?.projection).toBeNull();
		expect(probe.read(b)?.error).toBeNull();
		expect(probe.read(c)?.error).toBeNull();
		expect(probe.read(c)?.connection.id).toBeNull();
		expect(requests).toEqual([a, b, c]);
		await act(async () => attempts.at(-1)?.send(frame(c)));
		expect(probe.read(c)?.projection?.session_id).toBe(c);

		// The app-wide wake event must not restart every retained reader.
		await changeAppState("background");
		await changeAppState("active");
		expect(requests).toEqual([a, b, c, c]);
	} finally {
		await probe.close();
	}
});

it("hands a same-session stream to a focused child and back without ending the active reader", async () => {
	const { attempts, requests } = transport();
	const probe = mountStack();
	const parent = "child-session";
	const child = `${parent}/agent`;
	try {
		await probe.show(parent);
		await act(async () => attempts[0]?.send(frame(parent)));
		await probe.show(parent, child);
		expect(attempts[0]?.signal?.aborted).toBe(true);
		await act(async () => attempts[1]?.send(frame(parent)));
		const childEpoch = probe.read(child)?.streamArrivalEpoch;
		expect(childEpoch).toEqual(expect.any(Number));
		await probe.show(parent);
		expect(attempts[1]?.signal?.aborted).toBe(true);
		expect(probe.read(parent)?.turnActionsReady).toBe(false);
		await act(async () =>
			attempts[2]?.send(frame(parent, { activity: "new parent seed" })),
		);
		expect(probe.read(parent)?.turnActionsReady).toBe(true);
		expect(probe.read(parent)?.projection?.activity).toBe("new parent seed");
		expect(probe.read(parent)?.streamArrivalEpoch).toBeGreaterThan(
			childEpoch ?? 0,
		);
		expect(requests).toEqual([parent, parent, parent]);
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

// #393 m1: a non-retryable failure inside the missed-seed grace must take the
// grace with it. Left armed, it set `overdue` behind the error, and a reload
// soon after painted "Reconnecting…" before its open had a chance. The reload
// lands between the seed grace's deadline (t=2.5 s, armed at the skipped seed)
// and the drop grace's (t=3.5 s, armed by the refusal's `lastEnd: "error"`),
// so only the seed grace can paint C2 there.
it("drops a pending missed-seed grace on a non-retryable failure, so reload opens quietly", async () => {
	vi.useFakeTimers();
	const { attempts, requests } = transport((attempt) =>
		attempt === 2 ? 401 : 200,
	);
	const probe = mount();
	try {
		await probe.show("stopped-a");
		// t=0: the seed is skipped, which arms the 2.5 s grace.
		await act(async () => attempts[0]?.send(KEEPALIVE));
		// t=1 s: the retry is refused, a stop the reader must resolve.
		await advance(RECONNECT_BACKOFF_MIN_MS);
		expect(requests).toHaveLength(2);
		expect(probe.read().error?.kind).toBe("relay-unauthorized");
		// t=2.6 s: past the seed grace's deadline; the reader retries.
		await advance(OUTAGE_GRACE_MS - RECONNECT_BACKOFF_MIN_MS + 100);
		await act(async () => probe.read().reload());
		expect(requests).toHaveLength(3);
		expect(probe.read().error).toBeNull();
		expect(probe.read().connection.id).toBeNull();
		await act(async () => attempts[1]?.send(frame("stopped-a")));
		expect(probe.read().projection?.session_id).toBe("stopped-a");
		expect(probe.read().connection.id).toBeNull();
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
