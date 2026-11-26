/**
 * How a session stream behaves when the relay is slow to seed it (PR #369).
 *
 * WHY. Under machine load the relay daemon answers a session stream's headers
 * at once and then says NOTHING until its durable projection capture finishes
 * (`daemon.py` `api_session_events`: capture first, keepalives only after the
 * seed step). Opening an idle or ended conversation pays the same silent build.
 * The operator saw slow loads and frequent "Reconnecting" on the app where the
 * relay web app stayed quiet; this file replays those shapes against a real
 * loopback HTTP server, the real fetch body reader, the real SSE parser and the
 * real session hook, and prints one table row per scenario.
 *
 * OPT-IN ONLY: it waits on real clocks (~60 s), so it is skipped unless
 * `SESSION_LOAD_MEASURE=1`. It measures loopback, not the Radient tunnel or a
 * phone radio. To compare another tree, check out that tree's
 * `src/features/session/use-session.ts` and `connection-view.ts` and rerun.
 *
 *   SESSION_LOAD_MEASURE=1 pnpm vitest run --maxWorkers=1 src/e2e/session-load.e2e.test.tsx
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it, vi } from "vitest";
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
		route: { mode: "lan", baseUrl: "http://127.0.0.1" },
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

const SEED = fixtureBody("sse/sse-projection-live-idle.json") as object;
const seedFor = (sid: string) =>
	`event: projection\ndata: ${JSON.stringify({ ...SEED, session_id: sid })}\n\n`;
const KEEPALIVE_S = 15; // daemon.py SSE_KEEPALIVE_S
const COOKIE_NONE = null;

type Shape =
	/** Headers at once; the seed trickles in evenly over `seconds`. */
	| { kind: "progressing"; seconds: number }
	/** Headers at once; nothing for `seconds` (capture or wake); then the seed. */
	| { kind: "silent"; seconds: number }
	/** Headers late by `seconds` (a blocked event loop); then the seed. */
	| { kind: "late-headers"; seconds: number }
	/** The daemon skipped the seed: keepalives only, on the first request. */
	| { kind: "skipped" };

const SCENARIOS: { name: string; shape: Shape }[] = [
	{ name: "progressing seed 3 s", shape: { kind: "progressing", seconds: 3 } },
	{ name: "progressing seed 8 s", shape: { kind: "progressing", seconds: 8 } },
	{
		name: "progressing seed 20 s",
		shape: { kind: "progressing", seconds: 20 },
	},
	{
		name: "progressing seed 45 s",
		shape: { kind: "progressing", seconds: 45 },
	},
	{ name: "silent build 8 s", shape: { kind: "silent", seconds: 8 } },
	{ name: "silent build 20 s", shape: { kind: "silent", seconds: 20 } },
	{ name: "wake: silent build 12 s", shape: { kind: "silent", seconds: 12 } },
	{ name: "late headers 8 s", shape: { kind: "late-headers", seconds: 8 } },
	{ name: "skipped seed (no-progress control)", shape: { kind: "skipped" } },
];

/** Every request repeats its scenario's delay: a restarted stream makes the
 *  daemon capture again, so a client restart costs the full build again. The
 *  skipped seed is the exception: only the first request skips it. */
function serve(
	shape: Shape,
	sid: string,
	attempt: number,
	response: ServerResponse,
	timers: Set<ReturnType<typeof setTimeout>>,
) {
	const later = (ms: number, run: () => void) => {
		const timer = setTimeout(() => {
			timers.delete(timer);
			if (!response.writableEnded && !response.destroyed) run();
		}, ms);
		timers.add(timer);
	};
	const open = () => {
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.flushHeaders();
	};
	const seed = seedFor(sid);
	if (shape.kind === "late-headers") {
		later(shape.seconds * 1000, () => {
			open();
			response.write(seed);
		});
		return;
	}
	open();
	if (shape.kind === "silent") {
		later(shape.seconds * 1000, () => response.write(seed));
	} else if (shape.kind === "progressing") {
		const chunks = Math.max(2, shape.seconds);
		const size = Math.ceil(seed.length / chunks);
		for (let i = 0; i < chunks; i += 1)
			later((shape.seconds * 1000 * i) / (chunks - 1), () =>
				response.write(seed.slice(i * size, (i + 1) * size)),
			);
	} else if (attempt === 1) {
		const tick = () => {
			response.write(": keepalive\n\n");
			later(KEEPALIVE_S * 1000, tick);
		};
		later(KEEPALIVE_S * 1000, tick);
	} else {
		response.write(seed);
	}
}

const servers: Server[] = [];
const timers = new Set<ReturnType<typeof setTimeout>>();
afterAll(async () => {
	for (const timer of timers) clearTimeout(timer);
	await Promise.all(
		servers.map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				}),
		),
	);
});

const EVENTS = /^\/api\/sessions\/([^/]+)\/events/;

/** All scenarios run at once against ONE loopback relay, routed by session
 *  id, so the table costs one ~75 s wall instead of their sum. */
async function measureAll() {
	const requests = new Map<string, number>();
	const shapes = new Map<string, Shape>();
	const server = createServer((request, response) => {
		const sid = EVENTS.exec(request.url ?? "")?.[1];
		const shape = sid === undefined ? undefined : shapes.get(sid);
		if (sid !== undefined && shape !== undefined) {
			const attempt = (requests.get(sid) ?? 0) + 1;
			requests.set(sid, attempt);
			serve(shape, sid, attempt, response, timers);
			return;
		}
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ entries: [], has_more: false }));
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const client = new RelayEndpoints(
		new RelayHttpClient({
			baseUrl: `http://127.0.0.1:${port}`,
			auth: () => ({
				cookie: COOKIE_NONE,
				origin: `http://127.0.0.1:${port}`,
				credentials: "omit",
			}),
		}),
	);
	admission.relay = () => client;
	const probes = SCENARIOS.map(({ name, shape }, index) => {
		const sid = `load${index}${Math.random().toString(16).slice(2, 8)}`;
		shapes.set(sid, shape);
		const dom = installDomShim();
		const root = createRoot(dom.container as Element);
		const probe = {
			name,
			sid,
			root,
			dom,
			current: null as ReturnType<typeof useSessionRuntime> | null,
			rowsAt: null as number | null,
			reconnectingShown: false,
		};
		function Probe() {
			probe.current = useSessionRuntime(sid, true);
			return null;
		}
		return { probe, Probe };
	});
	const started = Date.now();
	await act(async () => {
		for (const { probe, Probe } of probes)
			probe.root.render(createElement(Probe));
	});
	while (
		Date.now() - started < 75_000 &&
		probes.some(({ probe }) => probe.rowsAt === null)
	) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
		for (const { probe } of probes) {
			if (probe.rowsAt !== null) continue;
			if (probe.current?.connection.id === "C2") probe.reconnectingShown = true;
			if (probe.current?.projection?.session_id === probe.sid)
				probe.rowsAt = Date.now() - started;
		}
	}
	await act(async () => {
		for (const { probe } of probes) probe.root.unmount();
	});
	for (const { probe } of probes) probe.dom.dispose();
	return probes.map(({ probe }) => ({
		name: probe.name,
		firstRowsMs: probe.rowsAt,
		reconnectingShown: probe.reconnectingShown,
		restarts: Math.max(0, (requests.get(probe.sid) ?? 0) - 1),
	}));
}

describe.skipIf(process.env.SESSION_LOAD_MEASURE !== "1")(
	"session load under a slow relay (loopback)",
	() => {
		it("prints the measurement table", async () => {
			const rows = await measureAll();
			console.log(
				[
					"| scenario | time to first rows | Reconnecting shown | stream restarts |",
					"|---|---|---|---|",
					...rows.map(
						(row) =>
							`| ${row.name} | ${row.firstRowsMs === null ? "none in 75 s" : `${row.firstRowsMs} ms`} | ${row.reconnectingShown ? "yes" : "no"} | ${row.restarts} |`,
					),
				].join("\n"),
			);
			expect(rows).toHaveLength(SCENARIOS.length);
		}, 900_000);
	},
);
