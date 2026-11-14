import { describe, expect, it } from "vitest";
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
