/** Injected OS envelopes through the ACTUAL registered task callback, production
 * endpoints, coordinator and cache against tools/mock-relay on loopback. Native
 * delivery is not exercised. BACKGROUND_TASK_BASELINE replays main's unmodified
 * callback body for the before-fix negative control (see docs). */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("@/features/session/outbox", () => ({
	outbox: { drainForBackgroundWake: async () => undefined },
}));
vi.mock("@/notifications/native", () => ({
	loadNotifications: async () => ({
		getPresentedNotificationsAsync: async () => [],
		dismissNotificationAsync: async () => undefined,
	}),
}));

import { RelayEndpoints, RelayHttpClient } from "@/relay";
import { createPushHandleStore } from "@/state/push-computer-handle";
import { createWarmCache, memoryWarmStore } from "@/state/warm-cache";
import { warmSync } from "@/state/warm-sync";
import { relayWarmSyncScope } from "@/state/warm-sync-relay";
import { loadFixture } from "@/testing/fixtures";
import { createRelay, DEFAULT_PASSWORD } from "../../tools/mock-relay/relay";
import {
	BackgroundResult,
	registerBackgroundUnreadScope,
	runBackgroundClear,
	waitForBackgroundUnreadScope,
} from "./background-clear";
import { runBackgroundPushRefresh } from "./background-push-refresh";
import { backgroundNotificationTask } from "./background-task";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.useRealTimers();
});
const scope = {
	accountId: "synthetic-account",
	routeKey: "radient:synthetic-route",
};
const attention = (computer: string) => ({
	v: 1,
	type: "attention",
	computer,
	count: 0,
});
const completion = (computer: string, conversation: string) => ({
	v: 1,
	type: "completion",
	computer,
	conversation,
});
const ios = (body: unknown) => ({ data: { data: { body } } });
const android = (body: unknown) => ({
	data: { data: { dataString: JSON.stringify(body) } },
});

function task() {
	if (!process.env.BACKGROUND_TASK_BASELINE) return backgroundNotificationTask;
	const source = readFileSync(process.env.BACKGROUND_TASK_BASELINE, "utf8");
	const start =
		source.indexOf("async ({ data, error }) => {") +
		"async ({ data, error }) => {".length;
	const end = source.indexOf("\n\t\t\t},\n\t\t);", start);
	if (start < 28 || end < start) throw Error("baseline callback not found");
	// Only native bindings/outbox are replaced, exactly as in the current task.
	return new Function(
		"runBackgroundClear",
		"nativeDeps",
		"outbox",
		"BackgroundResult",
		`return async ({data,error}) => {${source.slice(start, end)}\n}`,
	)(
		runBackgroundClear,
		{
			scope: waitForBackgroundUnreadScope,
			presented: async () => [],
			dismiss: async () => undefined,
			badgeSettled: async () => undefined,
		},
		{ drainForBackgroundWake: async () => undefined },
		BackgroundResult,
	) as typeof backgroundNotificationTask;
}

async function open(
	options: {
		missing?: boolean;
		locked?: boolean;
		noSeed?: boolean;
		persistFails?: boolean;
	} = {},
) {
	const relay = createRelay({ quiet: true });
	cleanup.push(() => relay.shutdown());
	const { url } = await relay.listen({ port: 0 });
	const login = await fetch(`${url}/login`, {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(DEFAULT_PASSWORD)}`,
	});
	const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
	const capture = loadFixture<{
		request: { path: string };
		body: { session_id: string };
	}>("http/push-conversation-ok.json");
	const id = capture.body.session_id;
	const handle = capture.request.path.split("/").pop() ?? "";
	const projection = Object.values(relay.state.world.projections ?? {})[0];
	if (!projection) throw Error("mock projection missing");
	relay.state.world.projections ??= {};
	relay.state.world.projections[id] = { ...projection, session_id: id };
	if (options.noSeed) relay.state.faults.sse.noSeed = true;
	const seen: Array<{ path: string; status: number }> = [];
	const signals: AbortSignal[] = [];
	let credentialsLocked = false;
	const client = new RelayEndpoints(
		new RelayHttpClient({
			baseUrl: url,
			auth: () => {
				if (credentialsLocked) throw Error("credential read locked");
				return { cookie, origin: null, credentials: "omit" };
			},
			fetchImpl: async (input, init) => {
				if (init?.signal) signals.push(init.signal);
				const response = await fetch(input, init);
				seen.push({
					path: new URL(String(input)).pathname,
					status: response.status,
				});
				return response;
			},
		}),
	);
	const response = await client.registerDevice({
		platform: "ios",
		environment: "sandbox",
		token: "synthetic-token",
		app_version: "test",
		install_id: "synthetic-install",
	});
	expect(response.computer_handle).toBe("mock-computer-handle");
	const port = memoryWarmStore();
	const handles = createPushHandleStore(
		options.locked
			? {
					...port,
					get: async () => {
						throw Error("credential locked");
					},
				}
			: port,
	);
	if (!options.missing && !options.locked)
		await handles.record(scope, response.computer_handle);
	const cachePort = memoryWarmStore();
	const cache = createWarmCache(
		options.persistFails
			? {
					...cachePort,
					set: async () => {
						throw Error("locked persist");
					},
				}
			: cachePort,
		{ warn: () => undefined },
	);
	let active = true;
	const retire = warmSync.register(
		relayWarmSyncScope({
			client,
			cache,
			scope,
			isActive: () => active,
			background: {
				key: JSON.stringify(scope),
				matches: async (computer) => computer === (await handles.lookup(scope)),
			},
		}),
	);
	cleanup.push(retire);
	const releaseView = warmSync.view(id);
	releaseView(); // Phone has backgrounded; the mounted screen is no longer onscreen.
	const retireUnread = registerBackgroundUnreadScope({
		isActive: () => active,
		refreshUnread: async () => ({ total: 0, byTenant: new Map() }),
	});
	cleanup.push(retireUnread);
	seen.length = 0;
	signals.length = 0;
	const computer = response.computer_handle;
	if (!computer) throw Error("mock authenticated binding missing");
	return {
		relay,
		client,
		cache,
		handles,
		id,
		handle,
		seen,
		signals,
		computer,
		retire: () => {
			active = false;
			retire();
		},
		retireUnread,
		lockCredentials: () => {
			credentialsLocked = true;
		},
	};
}

describe("push-wake warm refresh over the production task path", () => {
	it("badge/tray clearing spends the same 25 s budget, not a second warming budget", async () => {
		vi.useFakeTimers();
		const pushed = vi.fn(async () => false);
		const pending = runBackgroundPushRefresh(
			{ data: { body: attention("computer") } },
			{
				scope: async () => ({
					isActive: () => true,
					refreshUnread: async () => {
						await new Promise((resolve) => setTimeout(resolve, 20_000));
						return { total: 0, byTenant: new Map() };
					},
				}),
				presented: async () => [],
				dismiss: async () => undefined,
				badgeSettled: async () => undefined,
			},
			{ pushed },
		);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(await pending).toBe(BackgroundResult.NewData);
		expect(pushed).toHaveBeenCalledWith(
			{ reason: "attention", computer: "computer" },
			5_000,
		);
	});
	it.each([ios, android])(
		"matching attention clears first, reads list 200, takes one seed and writes cache (%#)",
		async (envelope) => {
			const h = await open();
			expect(await task()(envelope(attention(h.computer)))).toBe(
				BackgroundResult.NewData,
			);
			expect(h.seen).toEqual([
				{ path: "/api/sessions", status: 200 },
				{ path: `/api/sessions/${h.id}/events`, status: 200 },
			]);
			expect(await h.cache.loadList(scope)).not.toBeNull();
			expect(
				(await h.cache.loadSession(scope, h.id))?.projection.session_id,
			).toBe(h.id);
			console.log(
				"attention",
				JSON.stringify(h.seen),
				"list+session cache written",
			);
		},
		10_000,
	);

	it.each([ios, android])(
		"matching completion resolves 200 then takes one seed and writes cache (%#)",
		async (envelope) => {
			const h = await open();
			expect(await task()(envelope(completion(h.computer, h.handle)))).toBe(
				BackgroundResult.NewData,
			);
			expect(h.seen).toEqual([
				{ path: `/api/push/conversation/${h.handle}`, status: 200 },
				{ path: `/api/sessions/${h.id}/events`, status: 200 },
			]);
			expect(await h.cache.loadSession(scope, h.id)).not.toBeNull();
			console.log(
				"completion",
				JSON.stringify(h.seen),
				"session cache written",
			);
		},
	);

	it.each(["mismatch", "missing", "locked"])(
		"%s mapping causes zero relay requests for both push forms",
		async (kind) => {
			const h = await open({
				missing: kind === "missing",
				locked: kind === "locked",
			});
			const computer = kind === "mismatch" ? "some-other-computer" : h.computer;
			await task()(ios(attention(computer)));
			expect(await task()(android(completion(computer, h.handle)))).toBe(
				BackgroundResult.NoData,
			);
			expect(h.seen).toEqual([]);
		},
	);

	it("a second attention/completion within 60 s never duplicates the seed", async () => {
		const h = await open();
		await task()(ios(attention(h.computer)));
		await task()(android(attention(h.computer)));
		await task()(android(completion(h.computer, h.handle)));
		expect(h.seen.filter((row) => row.path.endsWith("/events"))).toHaveLength(
			1,
		);
		expect(h.seen.filter((row) => row.path === "/api/sessions")).toHaveLength(
			1,
		);
	});

	it("cold/no-provider completion is NoData quickly and never reads credentials", async () => {
		const h = await open({ locked: true });
		h.retire();
		h.retireUnread();
		const lookup = vi.spyOn(h.handles, "lookup");
		const before = Date.now();
		expect(await task()(android(completion(h.computer, h.handle)))).toBe(
			BackgroundResult.NoData,
		);
		expect(Date.now() - before).toBeLessThan(1000);
		expect(await task()(ios(attention(h.computer)))).toBe(
			BackgroundResult.NoData,
		);
		expect(lookup).not.toHaveBeenCalled();
		expect(h.seen).toEqual([]);
	});

	it("a credential read throwing while locked is NoData, not a sign-out or refusal", async () => {
		const h = await open();
		h.retireUnread();
		h.lockCredentials();
		expect(await task()(ios(attention(h.computer)))).toBe(
			BackgroundResult.NoData,
		);
		expect(await task()(android(completion(h.computer, h.handle)))).toBe(
			BackgroundResult.NoData,
		);
		expect(h.seen).toEqual([]);
	});

	it("a failed encrypted-cache persist is tolerated and does not retire the live scope", async () => {
		const h = await open({ persistFails: true });
		await expect(task()(ios(attention(h.computer)))).resolves.toBe(
			BackgroundResult.NewData,
		);
		expect(h.seen).toHaveLength(2);
		expect(await h.cache.loadSession(scope, h.id)).toBeNull();
		await h.handles.record(scope, "changed");
		await task()(android(completion("changed", h.handle)));
		expect(h.seen.filter((row) => row.path.endsWith("/events"))).toHaveLength(
			2,
		);
	});

	it("account switch mid-list-response aborts and cannot write the old account's cache", async () => {
		const h = await open();
		const original = h.client.sessions.bind(h.client);
		vi.spyOn(h.client, "sessions").mockImplementation(async (...args) => {
			const frame = await original(...args);
			h.retire();
			return frame;
		});
		await task()(ios(attention(h.computer)));
		expect(h.seen).toEqual([{ path: "/api/sessions", status: 200 }]);
		expect(await h.cache.loadList(scope)).toBeNull();
		expect(await h.cache.loadSession(scope, h.id)).toBeNull();
	});

	it("the original 25 s task budget aborts the actual quiet SSE transport", async () => {
		const h = await open({ noSeed: true });
		const before = Date.now();
		await task()(ios(attention(h.computer)));
		const elapsed = Date.now() - before;
		expect(elapsed).toBeGreaterThanOrEqual(24_900);
		expect(elapsed).toBeLessThan(27_000);
		expect(h.signals.at(-1)?.aborted).toBe(true);
		expect(await h.cache.loadSession(scope, h.id)).toBeNull();
		console.log(
			"quiet SSE task elapsed_ms",
			elapsed,
			"transport aborted",
			h.signals.at(-1)?.aborted,
		);
	}, 30_000);
});
