/**
 * Team Bridge push registration: rate discipline (the 2026-11-17 incident).
 *
 * Builds 1139/1157 sent `PUT /v1/messaging/push/devices` up to ~20 times a
 * second, ignored the hub's 429 + Retry-After, and got the owner's network
 * address blocked by the edge WAF. These tests drive the REAL
 * `registerTeamBridgeDevice`, the real hub client (over a fake fetch that
 * answers like agent-server and the WAF), the real single-flight lifecycle and
 * the real token-change filter; only the native notifications module and the
 * keystore are seams. The fake module behaves like expo's native one: a token
 * read resolves AND emits `onDevicePushToken` to every listener.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
	token: "synthetic-apns-token-1",
	reads: 0,
	listeners: new Set<(event: { data?: unknown }) => void>(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-constants", () => ({
	default: { expoConfig: { version: "0.0.0" } },
}));
vi.mock("@/notifications/install-id", () => {
	let generation = 0;
	return {
		ensureInstallRecord: async () => ({
			v: 1,
			install_id: "5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
		}),
		nextBridgePushGeneration: async () => ++generation,
	};
});
const fakeModule = {
	getPermissionsAsync: async () => ({ status: "granted" }),
	getDevicePushTokenAsync: async () => {
		seam.reads += 1;
		const data = seam.token;
		// expo `PushTokenModule.didRegister`: resolve, then emit to listeners.
		queueMicrotask(() => {
			for (const listener of seam.listeners) listener({ data });
		});
		return { type: "ios", data };
	},
	addPushTokenListener: (listener: (event: { data?: unknown }) => void) => {
		seam.listeners.add(listener);
		return { remove: () => seam.listeners.delete(listener) };
	},
};
vi.mock("@/notifications/native", () => ({
	notificationsSupported: () => true,
	loadNotifications: async () => fakeModule,
}));

import {
	addPushTokenChangeListener,
	notePushToken,
	resetPushTokenMemory,
} from "@/notifications/push-token-changes";
import { createHubClient, HubError } from "@/team-bridge/client";
import {
	BACKOFF_BASE_MS,
	BACKOFF_MAX_MS,
	backoffRemainingMs,
	createBackoffRetry,
	createRegistrationMemory,
	RATE_LIMITED_FLOOR_MS,
	REREGISTER_MS,
	registerTeamBridgeDevice,
	registrationBackoffMs,
} from "@/team-bridge/push";
import { createPushLifecycle } from "@/team-bridge/push-lifecycle";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type Answer = () => Response;
/** A hub that counts PUTs and answers from a script (last answer repeats). */
function fakeHub(answers: Answer[]) {
	const puts: unknown[] = [];
	const hub = createHubClient({
		accessToken: async () => "synthetic-access",
		baseUrl: "https://api.example.com",
		fetchImpl: (async (_url: unknown, init?: RequestInit) => {
			if (init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
			const answer = answers[Math.min(puts.length - 1, answers.length - 1)];
			return answer ? answer() : new Response(null, { status: 500 });
		}) as typeof fetch,
	});
	return { hub, puts };
}
const accepted: Answer = () =>
	new Response(
		JSON.stringify({
			result: { device_id: "synthetic-device", platform: "ios" },
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
/** agent-server's push-register bucket: 429 + Retry-After + details. */
const hubLimited: Answer = () =>
	new Response(
		JSON.stringify({
			error: "Too many requests.",
			code: "rate_limited",
			details: { retry_after_seconds: 42 },
		}),
		{
			status: 429,
			headers: { "content-type": "application/json", "retry-after": "42" },
		},
	);
/** The edge WAF's block: object-shaped error, NO Retry-After header. */
const wafBlocked: Answer = () =>
	new Response(
		JSON.stringify({
			error: {
				type: "rate_limit_error",
				code: "rate_limited",
				message: "Too many requests from this address; retry in 300 seconds.",
			},
		}),
		{ status: 429, headers: { "content-type": "application/json" } },
	);

/** A controllable clock; `random` 0.5 unless a test pins it. */
function clockAt(start = 1_000_000) {
	const clock = { t: start, now: () => clock.t, random: () => 0.5 };
	return clock;
}
const settle = async (rounds = 10) => {
	for (let i = 0; i < rounds; i++)
		await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
	seam.token = "synthetic-apns-token-1";
	seam.reads = 0;
	seam.listeners.clear();
	resetPushTokenMemory();
});

describe("dedupe", () => {
	it("a repeat of an accepted registration sends no second PUT", async () => {
		const { hub, puts } = fakeHub([accepted]);
		const memory = createRegistrationMemory();
		const clock = clockAt();
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"registered",
		);
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"unchanged",
		);
		expect(puts).toHaveLength(1);
	});

	it("a rotated token registers at once; the same token after REREGISTER_MS refreshes", async () => {
		const { hub, puts } = fakeHub([accepted]);
		const memory = createRegistrationMemory();
		const clock = clockAt();
		await registerTeamBridgeDevice(hub, () => true, memory, clock);
		seam.token = "synthetic-apns-token-2";
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"registered",
		);
		expect((puts[1] as { token: string }).token).toBe("synthetic-apns-token-2");
		clock.t += REREGISTER_MS;
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"registered",
		);
		expect(puts).toHaveLength(3);
	});

	it("forgetting the accepted row (after a DELETE) re-registers", async () => {
		const { hub, puts } = fakeHub([accepted]);
		const memory = createRegistrationMemory();
		await registerTeamBridgeDevice(hub, () => true, memory, clockAt());
		memory.accepted = null;
		await registerTeamBridgeDevice(hub, () => true, memory, clockAt());
		expect(puts).toHaveLength(2);
	});
});

describe("backoff and Retry-After", () => {
	it("honours the hub's Retry-After: no PUT and no token read until it passes", async () => {
		const { hub, puts } = fakeHub([hubLimited, accepted]);
		const memory = createRegistrationMemory();
		const clock = clockAt();
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"failed",
		);
		// 42 s asked + up to 10 % jitter (random 0.5 → 2.1 s).
		expect(memory.notBefore - clock.t).toBe(42_000 + 2_100);
		const readsAfterFailure = seam.reads;
		for (let i = 0; i < 100; i++) {
			clock.t += 400;
			expect(
				await registerTeamBridgeDevice(hub, () => true, memory, clock),
			).toBe("backoff");
		}
		expect(puts).toHaveLength(1);
		expect(seam.reads).toBe(readsAfterFailure);
		clock.t = memory.notBefore;
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"registered",
		);
		expect(puts).toHaveLength(2);
		expect(memory).toMatchObject({ failures: 0, notBefore: 0 });
	});

	it("a WAF block with no Retry-After waits the WAF's whole 300 s window", async () => {
		const { hub, puts } = fakeHub([wafBlocked]);
		const memory = createRegistrationMemory();
		const clock = clockAt();
		await registerTeamBridgeDevice(hub, () => true, memory, clock);
		expect(memory.notBefore - clock.t).toBeGreaterThanOrEqual(300_000);
		clock.t += 299_000;
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"backoff",
		);
		expect(puts).toHaveLength(1);
	});

	it("other failures back off exponentially with full jitter, capped", () => {
		const error = new HubError({ kind: "server", message: "x", status: 500 });
		const top = () => 0.999_999;
		expect(registrationBackoffMs(1, error, top)).toBe(BACKOFF_BASE_MS - 1);
		expect(registrationBackoffMs(2, error, top)).toBe(2 * BACKOFF_BASE_MS - 1);
		expect(registrationBackoffMs(30, error, top)).toBe(BACKOFF_MAX_MS - 1);
		// Full jitter: anywhere in [0, cap), so a fleet does not retry in step.
		expect(registrationBackoffMs(4, error, () => 0)).toBe(0);
		// A 429 never retries before the server's figure, jitter or not.
		const limited = new HubError({
			kind: "rate_limited",
			message: "x",
			status: 429,
			retryAfterMs: 10_000,
		});
		expect(registrationBackoffMs(1, limited, () => 0)).toBe(10_000);
		const bare = new HubError({ kind: "rate_limited", message: "x" });
		expect(registrationBackoffMs(1, bare, () => 0)).toBe(RATE_LIMITED_FLOOR_MS);
	});

	it("repeated failures widen the wait", async () => {
		const { hub } = fakeHub([() => new Response(null, { status: 503 })]);
		const memory = createRegistrationMemory();
		const clock = clockAt();
		clock.random = () => 0.999;
		const waits: number[] = [];
		for (let i = 0; i < 4; i++) {
			await registerTeamBridgeDevice(hub, () => true, memory, clock);
			waits.push(memory.notBefore - clock.t);
			clock.t = memory.notBefore;
		}
		expect(waits).toEqual([4995, 9990, 19980, 39960]);
	});
});

describe("the token-listener echo loop (builds 1139/1157)", () => {
	/** The provider's wiring: a token listener that asks the lifecycle to register. */
	function wire(subscribe: (onEvent: () => void) => void) {
		const { hub, puts } = fakeHub([accepted]);
		const memory = createRegistrationMemory();
		const lifecycle = createPushLifecycle({
			register: async (isCurrent) => {
				await registerTeamBridgeDevice(hub, isCurrent, memory);
			},
			unregister: async () => {},
		});
		lifecycle.activate();
		subscribe(() => void lifecycle.register());
		return { lifecycle, puts };
	}
	/** Another token reader (session push registration) reading on every event,
	 *  as the pre-fix session hook did: each read echoes to every listener. */
	function echoingReader(limit: number) {
		fakeModule.addPushTokenListener(() => {
			if (seam.reads < limit) void fakeModule.getDevicePushTokenAsync();
		});
	}

	it("even a listener that reacts to every echo cannot PUT twice: dedupe holds", async () => {
		// The pre-fix provider wiring (raw `addPushTokenListener`) against the
		// other reader's echo storm. Builds 1139/1157 PUT once per echo here;
		// the dedupe layer alone now holds it to one.
		const { lifecycle, puts } = wire((onEvent) =>
			fakeModule.addPushTokenListener(onEvent),
		);
		echoingReader(40);
		await lifecycle.register();
		await settle(200);
		expect(seam.reads).toBeGreaterThan(10);
		expect(puts).toHaveLength(1);
	});

	it("reacting only to a changed token: no echo storm, one PUT", async () => {
		const { lifecycle, puts } = wire((onEvent) =>
			addPushTokenChangeListener(fakeModule, onEvent),
		);
		echoingReader(40);
		await lifecycle.register();
		await settle(200);
		expect(puts).toHaveLength(1);
		// …while a real rotation still re-registers.
		seam.token = "synthetic-apns-token-2";
		for (const listener of seam.listeners)
			listener({ data: "synthetic-apns-token-2" });
		await settle(50);
		expect(puts).toHaveLength(2);
	});
});

describe("a rotation reaches EVERY token listener (QA round 1, Q1)", () => {
	/* Session pushes and Team Bridge both subscribe, after independent async
	 * module loads, so either can subscribe first. One shared "last seen" let
	 * the first listener record a rotation and filter it out for the second. */
	for (const order of [
		["session", "bridge"],
		["bridge", "session"],
	] as const) {
		it(`an event rotation calls both back once (${order.join(" then ")})`, async () => {
			const calls = { session: 0, bridge: 0 };
			for (const name of order)
				addPushTokenChangeListener(fakeModule, () => {
					calls[name] += 1;
				});
			// Launch: one path has registered token 1; a later read echoes it.
			notePushToken("synthetic-apns-token-1");
			notePushToken((await fakeModule.getDevicePushTokenAsync()).data);
			await settle();
			expect(calls).toEqual({ session: 0, bridge: 0 });
			// APNs rotates: the event reaches every subscriber.
			for (const listener of [...seam.listeners])
				listener({ data: "synthetic-apns-token-2" });
			expect(calls).toEqual({ session: 1, bridge: 1 });
			// The re-registrations' own reads of token 2, and their echoes, are quiet.
			seam.token = "synthetic-apns-token-2";
			notePushToken((await fakeModule.getDevicePushTokenAsync()).data);
			notePushToken((await fakeModule.getDevicePushTokenAsync()).data);
			await settle();
			expect(calls).toEqual({ session: 1, bridge: 1 });
		});
	}

	it("a READ that discovers a new token calls back every listener once (reviewer m2)", async () => {
		const calls = { session: 0, bridge: 0 };
		addPushTokenChangeListener(fakeModule, () => {
			calls.session += 1;
		});
		addPushTokenChangeListener(fakeModule, () => {
			calls.bridge += 1;
		});
		notePushToken("synthetic-apns-token-1");
		// The first token of the process is a launch, not a rotation.
		expect(calls).toEqual({ session: 0, bridge: 0 });
		// The session path's read surfaces a rotated token before any event.
		seam.token = "synthetic-apns-token-2";
		notePushToken((await fakeModule.getDevicePushTokenAsync()).data);
		expect(calls).toEqual({ session: 1, bridge: 1 });
		await settle(); // the read's echo event
		expect(calls).toEqual({ session: 1, bridge: 1 });
	});

	it("a callback that reads the token itself cannot loop", async () => {
		let calls = 0;
		addPushTokenChangeListener(fakeModule, () => {
			calls += 1;
			void fakeModule
				.getDevicePushTokenAsync()
				.then((t) => notePushToken(t.data));
		});
		notePushToken("synthetic-apns-token-1");
		seam.token = "synthetic-apns-token-2";
		notePushToken("synthetic-apns-token-2");
		await settle(50);
		expect(calls).toBe(1);
		expect(seam.reads).toBe(1);
	});
});

describe("a trigger refused by a backoff is retried once when it ends (reviewer m1)", () => {
	function fakeTimers() {
		const pending = new Map<number, { run: () => void; ms: number }>();
		let next = 0;
		return {
			pending,
			set: (run: () => void, ms: number) => {
				next += 1;
				pending.set(next, { run, ms });
				return next;
			},
			clear: (handle: unknown) => {
				pending.delete(handle as number);
			},
			fire() {
				const entries = [...pending.entries()];
				pending.clear();
				for (const [, entry] of entries) entry.run();
			},
		};
	}

	it("a rotation during a 429 wait re-registers at the wait's end with ONE timer", async () => {
		const { hub, puts } = fakeHub([hubLimited, accepted]);
		const memory = createRegistrationMemory();
		const clock = clockAt();
		const timers = fakeTimers();
		const lifecycle = createPushLifecycle({
			// The provider's wiring: arm the retry on a "backoff" outcome.
			register: async (isCurrent) => {
				const outcome = await registerTeamBridgeDevice(
					hub,
					isCurrent,
					memory,
					clock,
				);
				if (outcome === "backoff" && isCurrent()) retry.arm();
			},
			unregister: async () => retry.cancel(),
		});
		const retry = createBackoffRetry(
			memory,
			() => void lifecycle.register(),
			clock,
			timers,
		);
		lifecycle.activate();
		await lifecycle.register();
		expect(puts).toHaveLength(1); // 429
		// Rotations land inside the wait: refused, but one retry is armed.
		seam.token = "synthetic-apns-token-2";
		await lifecycle.register();
		await lifecycle.register();
		expect(puts).toHaveLength(1);
		expect(timers.pending.size).toBe(1);
		expect([...timers.pending.values()][0]?.ms).toBe(
			memory.notBefore - clock.t,
		);
		clock.t = memory.notBefore;
		timers.fire();
		await settle();
		expect(puts).toHaveLength(2);
		expect(puts[1]).toMatchObject({ token: "synthetic-apns-token-2" });
		expect(timers.pending.size).toBe(0);
	});

	it("withdraw / sign-out cancels a pending retry", async () => {
		const memory = createRegistrationMemory();
		const clock = clockAt();
		memory.notBefore = clock.t + 10_000;
		memory.maxWaitMs = BACKOFF_MAX_MS;
		const timers = fakeTimers();
		let retried = 0;
		const retry = createBackoffRetry(memory, () => retried++, clock, timers);
		retry.arm();
		retry.arm();
		expect(timers.pending.size).toBe(1);
		retry.cancel();
		expect(timers.pending.size).toBe(0);
		expect(retry.pending()).toBe(false);
		timers.fire();
		expect(retried).toBe(0);
	});

	it("arms nothing when no backoff remains", () => {
		const timers = fakeTimers();
		createBackoffRetry(
			createRegistrationMemory(),
			() => {},
			clockAt(),
			timers,
		).arm();
		expect(timers.pending.size).toBe(0);
	});
});

describe("a clock set backwards cannot stretch a backoff (reviewer m3)", () => {
	it("a remaining wait beyond max(15 min, Retry-After) + 10 % counts as elapsed", async () => {
		const { hub, puts } = fakeHub([hubLimited, accepted]);
		const memory = createRegistrationMemory();
		const clock = clockAt(10_000_000_000);
		await registerTeamBridgeDevice(hub, () => true, memory, clock);
		expect(memory.maxWaitMs).toBe(BACKOFF_MAX_MS + 4_200); // 15 min + 42 s × 10 %
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"backoff",
		);
		// The user sets the clock back a day: the remaining wait is now ~24 h.
		clock.t -= 24 * 60 * 60 * 1000;
		expect(backoffRemainingMs(memory, clock.t)).toBe(0);
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"registered",
		);
		expect(puts).toHaveLength(2);
	});

	it("a long server-named wait is still honoured in full", async () => {
		const longLimit: Answer = () =>
			new Response(
				JSON.stringify({ error: "slow down", code: "rate_limited" }),
				{
					status: 429,
					headers: {
						"content-type": "application/json",
						"retry-after": "3600",
					},
				},
			);
		const { hub } = fakeHub([longLimit]);
		const memory = createRegistrationMemory();
		const clock = clockAt();
		await registerTeamBridgeDevice(hub, () => true, memory, clock);
		expect(memory.maxWaitMs).toBe(3_960_000);
		clock.t += 1_000;
		expect(backoffRemainingMs(memory, clock.t)).toBeGreaterThan(BACKOFF_MAX_MS);
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"backoff",
		);
	});

	// Reviewer round 2, R2-M1: at failures >= 9 the exponential cap is the full
	// 15 min, so a jittered wait near 15 min PLUS the Retry-After's 10 % jitter
	// exceeded the old ceiling max(15 min, asked × 1.1) and the guard read a
	// genuine backoff as a clock jump, opening the gate during a sustained 429.
	it("a fresh 429 backoff at the 15-min cap is never read as a clock jump (R2-M1)", async () => {
		const { hub, puts } = fakeHub([wafBlocked]);
		const memory = createRegistrationMemory();
		memory.failures = 8; // this refusal is the 9th consecutive failure
		const clock = { ...clockAt(), random: () => 0.999 };
		clock.now = () => clock.t;
		await registerTeamBridgeDevice(hub, () => true, memory, clock);
		const wait = memory.notBefore - clock.t;
		expect(wait).toBeGreaterThan(BACKOFF_MAX_MS); // jitter + 10 % past the cap
		expect(wait).toBe(
			registrationBackoffMs(
				9,
				new HubError({ kind: "rate_limited", message: "x" }),
				() => 0.999,
			),
		);
		expect(backoffRemainingMs(memory, clock.t)).toBe(wait);
		expect(await registerTeamBridgeDevice(hub, () => true, memory, clock)).toBe(
			"backoff",
		);
		expect(puts).toHaveLength(1);
	});
});
