import { afterEach, describe, expect, it, vi } from "vitest";
import { createSetupPoller, SETUP_POLL_MS } from "./setup-poll";

/* The cadence these timelines are written in (15 s). */
const STEP = SETUP_POLL_MS;

/** A fake clock and a refresh whose settling the test controls. */
function rig(options: { enabled?: () => boolean } = {}) {
	let now = 0;
	let next = 1;
	const due = new Map<number, { at: number; run: () => void }>();
	const started: number[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const settle: Array<() => void> = [];
	const poller = createSetupPoller({
		refresh: () => {
			started.push(now);
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			return new Promise<void>((resolve) =>
				settle.push(() => {
					inFlight -= 1;
					resolve();
				}),
			);
		},
		isEnabled: options.enabled ?? (() => true),
		timers: {
			now: () => now,
			setTimeout: (run, ms) => {
				const id = next++;
				due.set(id, { at: now + ms, run });
				return id;
			},
			clearTimeout: (handle) => due.delete(handle as number),
		},
	});
	const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
	return {
		poller,
		started,
		maxInFlight: () => maxInFlight,
		pendingTimers: () => due.size,
		/** Settle every request in flight, as a fast Radient would. */
		async answer() {
			for (const run of settle.splice(0)) run();
			await flush();
		},
		/** Advance the clock in 1 s steps, answering each request at once. */
		async advance(ms: number, answer = true) {
			for (let step = 0; step < ms; step += 1_000) {
				now += 1_000;
				for (const [id, timer] of [...due]) {
					if (timer.at <= now) {
						due.delete(id);
						timer.run();
					}
				}
				if (answer) await this.answer();
			}
		},
	};
}

/* PR #261 Q1 (BLOCKER) and U2. The invariant, over a fake clock: at most ONE
 *  request in flight, automatic starts at least SETUP_POLL_MS apart, Check
 *  again at once, nothing while blurred or backgrounded. */
describe("the set-up screen's re-listing", () => {
	it("focus starts ONE request, and a focused minute is a slow poll, not a loop", async () => {
		const r = rig();
		r.poller.focus();
		expect(r.started).toEqual([0]);
		await r.answer();
		/* QA measured 200 requests in 2.5 s from the old effect. */
		await r.advance(60_000);
		expect(r.started).toEqual([0, STEP, 2 * STEP, 3 * STEP, 4 * STEP]);
		expect(r.maxInFlight()).toBe(1);
	});

	it("re-focus inside the window waits for the window instead of starting now", async () => {
		const r = rig();
		r.poller.focus();
		await r.answer();
		await r.advance(3_000);
		r.poller.blur();
		r.poller.focus();
		r.poller.blur();
		r.poller.focus();
		expect(r.started).toEqual([0]);
		await r.advance(12_000);
		expect(r.started).toEqual([0, 15_000]);
	});

	it("never overlaps: a slow Radient holds the next start until it answers", async () => {
		const r = rig();
		r.poller.focus();
		await r.advance(45_000, false);
		r.poller.checkNow();
		expect(r.started).toEqual([0]);
		expect(r.maxInFlight()).toBe(1);
		await r.answer();
		await r.advance(15_000);
		expect(r.started.length).toBe(2);
	});

	it("Check again starts at once and restarts the window", async () => {
		const r = rig();
		r.poller.focus();
		await r.answer();
		await r.advance(5_000);
		r.poller.checkNow();
		expect(r.started).toEqual([0, 5_000]);
		await r.answer();
		await r.advance(14_000);
		expect(r.started).toEqual([0, 5_000]);
		await r.advance(1_000);
		expect(r.started).toEqual([0, 5_000, 20_000]);
	});

	it("stops while blurred or backgrounded, and resumes on return", async () => {
		const r = rig();
		r.poller.focus();
		await r.answer();
		r.poller.blur();
		await r.advance(120_000);
		expect(r.started).toEqual([0]);
		expect(r.pendingTimers()).toBe(0);
		r.poller.focus();
		expect(r.started).toEqual([0, 120_000]);
		await r.answer();
		r.poller.foreground(false);
		await r.advance(60_000);
		expect(r.started).toEqual([0, 120_000]);
		r.poller.foreground(true);
		expect(r.started).toEqual([0, 120_000, 180_000]);
	});

	it("an enable flag that flips on every render cannot start a request", async () => {
		let flips = 0;
		const r = rig({ enabled: () => ++flips % 2 === 0 });
		r.poller.focus();
		/* The old effect ran per flip; here flips are only READ at a trigger. */
		for (let i = 0; i < 100; i += 1) r.poller.checkNow();
		expect(r.started.length).toBeLessThanOrEqual(1);
		await r.answer();
		r.poller.dispose();
		await r.advance(60_000);
		expect(r.started.length).toBeLessThanOrEqual(1);
	});
});

/* PR #261 R2-1 (MAJOR). The fake clock above steps in 1 s and fires each due
 *  timer once per step, which hid a poller that re-armed a 0 ms timer whenever
 *  a poll was due but could not start (QA: ~242 arms a second on the real path).
 *  These run on REAL timers and count every arm, so a re-arm spin shows up as
 *  hundreds of calls however the clock is stepped. */
describe("the set-up poll never spins its timer (real timers)", () => {
	afterEach(() => vi.restoreAllMocks());

	/** Run `body` for `ms` of real time and count the poller's setTimeout arms. */
	async function countArms(
		deps: Parameters<typeof createSetupPoller>[0],
		ms: number,
		body: (poller: ReturnType<typeof createSetupPoller>) => void,
	) {
		const delays: number[] = [];
		const realSetTimeout = globalThis.setTimeout;
		const poller = createSetupPoller({
			...deps,
			timers: {
				now: () => Date.now(),
				setTimeout: (run, wait) => {
					delays.push(wait);
					return realSetTimeout(run, wait);
				},
				clearTimeout: (handle) =>
					clearTimeout(handle as ReturnType<typeof setTimeout>),
			},
		});
		body(poller);
		await new Promise((resolve) => realSetTimeout(resolve, ms));
		poller.dispose();
		return delays;
	}

	const never = () => new Promise<void>(() => {});

	it("a focused poll-off screen (populated list, waiting, signed out, discovery failure) arms at most a handful", async () => {
		let refreshes = 0;
		const delays = await countArms(
			{
				refresh: async () => {
					refreshes += 1;
				},
				isEnabled: () => false,
				intervalMs: 100,
			},
			1_000,
			(poller) => poller.focus(),
		);
		/* One arm per interval: ~10 in a second at 100 ms (the old code: 878). */
		expect(delays.length).toBeLessThanOrEqual(12);
		expect(delays.every((wait) => wait > 0)).toBe(true);
		expect(refreshes).toBe(0);
	});

	it("a request hung past the interval arms at most a handful while it runs", async () => {
		let refreshes = 0;
		const delays = await countArms(
			{
				refresh: () => {
					refreshes += 1;
					return never();
				},
				isEnabled: () => true,
				intervalMs: 100,
			},
			1_000,
			(poller) => poller.focus(),
		);
		/* The old code: 824 arms in this second. */
		expect(delays.length).toBeLessThanOrEqual(12);
		expect(delays.every((wait) => wait > 0)).toBe(true);
		expect(refreshes).toBe(1);
	});

	it("at the shipped cadence, a focused poll-off second arms ONE timer", async () => {
		const delays = await countArms(
			{ refresh: async () => {}, isEnabled: () => false },
			1_000,
			(poller) => poller.focus(),
		);
		expect(delays).toEqual([SETUP_POLL_MS]);
	});

	it("control: a healthy poll still lists every interval", async () => {
		let refreshes = 0;
		await countArms(
			{
				refresh: async () => {
					refreshes += 1;
				},
				isEnabled: () => true,
				intervalMs: 100,
			},
			1_000,
			(poller) => poller.focus(),
		);
		expect(refreshes).toBeGreaterThanOrEqual(8);
		expect(refreshes).toBeLessThanOrEqual(11);
	});

	it("Q9: a listing someone else just made (sign-in's discovery) counts as the last start", async () => {
		const started: number[] = [];
		const t0 = Date.now();
		await countArms(
			{
				refresh: async () => {
					started.push(Date.now() - t0);
				},
				isEnabled: () => true,
				/* Sign-in listed the account a moment before the screen's focus
				 *  and the popup's return to the foreground. */
				listedAt: () => t0,
				intervalMs: 300,
			},
			450,
			(poller) => {
				poller.focus();
				poller.foreground(true);
			},
		);
		/* The real path, before: GETs at 0.00 s and 0.17 s. Now the poll's first
		 *  start is one interval after sign-in's listing. */
		expect(started.length).toBe(1);
		expect(started[0]).toBeGreaterThanOrEqual(290);
	});

	it("a screen that becomes eligible is listed on the next tick, not by a 0 ms spin the instant it settles", async () => {
		let enabled = false;
		const started: number[] = [];
		const t0 = Date.now();
		await countArms(
			{
				refresh: async () => {
					started.push(Date.now() - t0);
				},
				isEnabled: () => enabled,
				intervalMs: 200,
			},
			300,
			(poller) => {
				/* Focus lands while the poll is still off (sign-in running). */
				poller.focus();
				enabled = true;
			},
		);
		/* Not the instant it became eligible: one interval later. */
		expect(started.length).toBe(1);
		expect(started[0]).toBeGreaterThanOrEqual(190);
	});
});
