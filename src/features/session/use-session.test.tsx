import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
	RECONNECT_BACKOFF_MIN_MS,
	RECONNECT_DEADLINE_MS,
} from "@/features/session/connection-view";
import { useSessionRuntime } from "@/features/session/use-session";
import { RelayEndpoints } from "@/relay/endpoints";
import { RelayHttpClient } from "@/relay/http";
import { installDomShim } from "@/testing/dom-shim";
import { fixtureBody } from "@/testing/fixture-relay";

const admission = vi.hoisted(() => ({
	relay: () => null as RelayEndpoints | null,
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
		currentState: "active",
		addEventListener: () => ({ remove() {} }),
	},
	Platform: { OS: "web" },
}));
vi.mock("@/state/warm-sync", () => ({ warmSync: { view: () => () => {} } }));
vi.mock("@/features/session/warm-store", () => ({ warmCache: {} }));

function mount() {
	const dom = installDomShim();
	const root = createRoot(dom.container as Element);
	let current!: ReturnType<typeof useSessionRuntime>;
	function Probe({ sid }: { sid: string }) {
		current = useSessionRuntime(sid);
		return null;
	}
	return {
		show: (sid: string) =>
			act(async () => root.render(createElement(Probe, { key: sid, sid }))),
		read: () => current,
		close: async () => {
			await act(async () => root.unmount());
			dom.dispose();
		},
	};
}

const SESSION_EVENTS_PATH = /\/sessions\/([^/]+)\/events$/;

// Keep the real HTTP/SSE parser and session hook: only the network boundary
// is injected to make a header-only open and late bytes deterministic.
function transport(status?: (attempt: number) => number) {
	const requests: string[] = [];
	const attempts: {
		sid: string;
		signal: AbortSignal | null | undefined;
		send: (chunk: string) => void;
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
		const code = status?.(requests.length) ?? 200;
		if (code !== 200)
			return Response.json(
				{ error: "authentication required" },
				{ status: code },
			);
		return new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					const send = (chunk: string) =>
						controller.enqueue(encoder.encode(chunk));
					attempts.push({ sid, signal: init?.signal, send });
					send(": keepalive\n\n");
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
	vi.useRealTimers();
});

it("retries an open stream that only sends keepalives, then clears recovery on a projection", async () => {
	vi.useFakeTimers();
	const { attempts } = transport();
	const probe = mount();
	try {
		await probe.show("silent-a");
		expect(attempts.map(({ sid }) => sid)).toEqual(["silent-a"]);
		expect(probe.read().projection).toBeNull();
		await advance(RECONNECT_DEADLINE_MS - 1);
		await act(async () => attempts[0]?.send(": keepalive\n\n"));
		expect(attempts[0]?.signal?.aborted).toBe(false);
		await advance(1);
		expect(attempts[0]?.signal?.aborted).toBe(true);
		expect(probe.read().connection.id).toBe("C2");
		await advance(RECONNECT_BACKOFF_MIN_MS);
		expect(attempts.map(({ sid }) => sid)).toEqual(["silent-a", "silent-a"]);
		expect(probe.read().connection.id).toBe("C2");
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

it("retires A's stream and deadline when switching to B", async () => {
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
		await act(async () => attempts[1]?.send(frame("switch-a")));
		expect(probe.read().projection).toBeNull();
		await act(async () => attempts[1]?.send(frame("switch-b")));
		expect(probe.read().projection?.session_id).toBe("switch-b");
	} finally {
		await probe.close();
	}
});

it("backs off repeated unseeded opens and stops on a typed authentication failure", async () => {
	vi.useFakeTimers();
	const { attempts, requests } = transport((attempt) =>
		attempt < 3 ? 200 : 401,
	);
	const probe = mount();
	try {
		await probe.show("refused-a");
		await advance(RECONNECT_DEADLINE_MS + RECONNECT_BACKOFF_MIN_MS);
		expect(requests).toEqual(["refused-a", "refused-a"]);
		await advance(RECONNECT_DEADLINE_MS);
		expect(attempts[1]?.signal?.aborted).toBe(true);
		await advance(2 * RECONNECT_BACKOFF_MIN_MS - 1);
		expect(requests).toHaveLength(2);
		await advance(1);
		expect(requests).toHaveLength(3);
		expect(probe.read().error?.kind).toBe("relay-unauthorized");
		expect(probe.read().content).toBe("recovery");
		expect(probe.read().link).toBe("stopped");
		await advance(5 * RECONNECT_DEADLINE_MS);
		expect(requests).toHaveLength(3);
	} finally {
		await probe.close();
	}
});
