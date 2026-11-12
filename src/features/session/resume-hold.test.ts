import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type ConnectionViewInput,
	connectionView,
	RECONNECT_DEADLINE_MS,
	reconnectDelay,
} from "@/features/session/connection-view";
import {
	createResumeClock,
	heldTimer,
	RESUME_GRACE_MS,
	type ResumeClock,
	SUSPEND_SLACK_MS,
} from "@/features/session/resume-hold";
import { RelayError } from "@/relay";
import type { ProjectionEntry } from "@/state";

/**
 * TestFlight 836: a return from the lock screen painted "The connection
 * dropped. Reconnecting…" before the reconnect could land. These tests drive the
 * resume hold the way `use-session.ts` does — a drop arms ONE held report at
 * `OUTAGE_GRACE_MS`, a frame cancels it, retries follow the real
 * `reconnectDelay` curve — under fake timers.
 *
 * A suspension cannot be faked by `vi.setSystemTime` (it shifts pending timers
 * with the clock), so the clock reads `Date.now() + suspended`: bumping
 * `suspended` is wall-clock time passing while no timer runs, exactly what a
 * frozen iOS process sees on its first tick back.
 */

const OUTAGE_GRACE_MS = 2500; // use-session.ts's value, mirrored from the relay

let suspended = 0;
const now = () => Date.now() + suspended;

/** The session runtime's drop → retry → report loop, reduced to its timers. */
const runtime = (clock: ResumeClock, outcomes: ("fail" | "ok")[]) => {
	const state = { dropped: false, reported: false, attempts: 0 };
	let cancelReport: (() => void) | null = null;
	let retry: ReturnType<typeof setTimeout> | null = null;
	let failures = 0;
	const drop = () => {
		if (state.dropped) return;
		state.dropped = true;
		cancelReport = heldTimer(clock, OUTAGE_GRACE_MS, () => {
			state.reported = true;
		});
	};
	const frame = () => {
		state.dropped = false;
		state.reported = false;
		failures = 0;
		cancelReport?.();
		cancelReport = null;
	};
	const attempt = () => {
		const outcome =
			outcomes[state.attempts] ?? outcomes[outcomes.length - 1] ?? "fail";
		state.attempts += 1;
		if (outcome === "ok") return frame();
		drop();
		retry = setTimeout(attempt, reconnectDelay(failures++, undefined));
	};
	return {
		state,
		drop,
		attempt,
		/** The AppState "active" handler: open the window, clear, reopen. */
		resume: () => {
			clock.resume();
			failures = 0;
			if (retry !== null) clearTimeout(retry);
			state.dropped = false;
			cancelReport?.();
			cancelReport = null;
			attempt();
		},
	};
};

beforeEach(() => {
	vi.useFakeTimers();
	suspended = 0;
});
afterEach(() => {
	vi.useRealTimers();
});

describe("the resume hold", () => {
	it("first reconnect after unlock fails, the next succeeds: no banner, ever", () => {
		const clock = createResumeClock(now);
		const rt = runtime(clock, ["fail", "ok"]);
		clock.background();
		rt.drop(); // the socket dies as the phone locks
		suspended += 10 * 60_000;
		rt.resume();
		for (let t = 0; t < RESUME_GRACE_MS * 2; t += 100) {
			vi.advanceTimersByTime(100);
			expect(rt.state.reported).toBe(false);
		}
		expect(rt.state.attempts).toBe(2);
		expect(rt.state.dropped).toBe(false);
	});

	it("radio still waking: two failures, success at t≈3 s, past the old 2.5 s grace: no banner", () => {
		const clock = createResumeClock(now);
		const rt = runtime(clock, ["fail", "fail", "ok"]);
		rt.resume();
		for (let t = 0; t < RESUME_GRACE_MS * 2; t += 100) {
			vi.advanceTimersByTime(100);
			expect(rt.state.reported).toBe(false);
		}
		expect(rt.state.attempts).toBe(3);
	});

	it("reports once the retry budget is spent: 4 attempts, at RESUME_GRACE_MS", () => {
		const clock = createResumeClock(now);
		const rt = runtime(clock, ["fail"]);
		rt.resume();
		vi.advanceTimersByTime(RESUME_GRACE_MS - 1);
		expect(rt.state.reported).toBe(false);
		// t≈0, 1 s, 3 s, 7 s: the immediate reopen plus three backoff retries.
		expect(rt.state.attempts).toBe(4);
		vi.advanceTimersByTime(1);
		expect(rt.state.reported).toBe(true);
	});

	it("clears the banner on its own when a later retry succeeds", () => {
		const clock = createResumeClock(now);
		const rt = runtime(clock, ["fail", "fail", "fail", "fail", "ok"]);
		rt.resume();
		vi.advanceTimersByTime(RESUME_GRACE_MS);
		expect(rt.state.reported).toBe(true);
		// Attempt 5 lands at t≈15 s (0, 1, 3, 7, 15).
		vi.advanceTimersByTime(15_000 - RESUME_GRACE_MS);
		expect(rt.state.reported).toBe(false);
		expect(rt.state.dropped).toBe(false);
	});

	it("a timer that slept through the lock does not count background time", () => {
		const clock = createResumeClock(now);
		const fired = vi.fn();
		heldTimer(clock, OUTAGE_GRACE_MS, fired); // armed by the drop at lock
		suspended += 10 * 60_000; // frozen: wall clock moves, no timer runs
		vi.advanceTimersByTime(OUTAGE_GRACE_MS); // first tick back: fires late
		expect(fired).not.toHaveBeenCalled();
		// Treated as a return: the window opened from the late tick.
		vi.advanceTimersByTime(RESUME_GRACE_MS - OUTAGE_GRACE_MS - 1);
		expect(fired).not.toHaveBeenCalled();
		vi.advanceTimersByTime(OUTAGE_GRACE_MS + 1);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it("a late tick is cancelled by the reopen's first frame (event-order race)", () => {
		const clock = createResumeClock(now);
		const rt = runtime(clock, ["ok"]);
		rt.drop();
		suspended += 60_000;
		vi.advanceTimersByTime(OUTAGE_GRACE_MS); // timer fires before AppState
		rt.resume(); // ...then "active" arrives and the reopen succeeds
		vi.advanceTimersByTime(RESUME_GRACE_MS * 2);
		expect(rt.state.reported).toBe(false);
	});

	it("never reports while backgrounded, and re-arms rather than forgetting", () => {
		const clock = createResumeClock(now);
		const fired = vi.fn();
		clock.background();
		heldTimer(clock, OUTAGE_GRACE_MS, fired);
		vi.advanceTimersByTime(60_000);
		expect(fired).not.toHaveBeenCalled();
		clock.resume();
		vi.advanceTimersByTime(RESUME_GRACE_MS + OUTAGE_GRACE_MS);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it("a foreground drop far from any resume keeps the 2.5 s grace", () => {
		const clock = createResumeClock(now);
		clock.resume();
		vi.advanceTimersByTime(60_000);
		const fired = vi.fn();
		heldTimer(clock, OUTAGE_GRACE_MS, fired);
		vi.advanceTimersByTime(OUTAGE_GRACE_MS - 1);
		expect(fired).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it("a busy JS thread is not mistaken for a suspension", () => {
		const clock = createResumeClock(now);
		const fired = vi.fn();
		heldTimer(clock, OUTAGE_GRACE_MS, fired);
		suspended += SUSPEND_SLACK_MS - 100; // a long render, not a lock
		vi.advanceTimersByTime(OUTAGE_GRACE_MS);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it("the window outlasts the reconnect deadline, so a silent reopen still surfaces", () => {
		expect(RESUME_GRACE_MS).toBeGreaterThan(RECONNECT_DEADLINE_MS);
		const clock = createResumeClock(now);
		clock.resume();
		expect(clock.holdMs(RECONNECT_DEADLINE_MS)).toBe(RESUME_GRACE_MS);
		vi.advanceTimersByTime(RESUME_GRACE_MS);
		expect(clock.holdMs(RECONNECT_DEADLINE_MS)).toBe(RECONNECT_DEADLINE_MS);
	});
});

describe("a 401 on resume is not held", () => {
	const ENTRY = {
		connected: true,
		awaitingSnapshot: true,
		projection: null,
	} as unknown as ProjectionEntry;
	it("shows the sign-in state while the drop is still held silent", () => {
		const input: ConnectionViewInput = {
			phase: "refused",
			stream: "closed",
			lastEnd: "error",
			// The hold has NOT reported the drop or the overdue reopen yet...
			droppedSinceFrame: false,
			reconnectExpired: false,
			// ...but the refusal arrives through `setError`, not the hold.
			error: new RelayError("radiant-login-required", "401", {
				status: 401,
				envelope: "clear-all",
			}),
			entry: ENTRY,
			stale: false,
			ageS: null,
			online: true,
			computerLabel: "Studio desktop",
			computerLastSeenS: null,
			ended: false,
		};
		const view = connectionView(input);
		expect(view.id).toBe("C5");
		expect(view.action?.kind).toBe("sign-in");
	});
});

/* Hoisted: the lint wants regex literals compiled once. */
const HELD_TIMER_CALL = /heldTimer\(/g;
const DEADLINE_HELD = /heldTimer\(resumeClock\.current, RECONNECT_DEADLINE_MS/;
const REFUSAL_DIRECT =
	/if \(isTransient\(streamError\)\) \{[\s\S]*?return;\n\t{5}\}\n\t{5}sessions\.getState\(\)\.endStream\(sessionId\);\n\t{5}setError\(streamError\);/;
const APPSTATE_HANDLER =
	/AppState\.addEventListener\("change", \(state\) => \{[\s\S]*?\n\t\t\}\);/;

describe("use-session wiring", () => {
	const source = readFileSync(
		new URL("./use-session.ts", import.meta.url),
		"utf8",
	);
	it("routes both report timers through the hold, and only them", () => {
		expect(source.match(HELD_TIMER_CALL)?.length).toBe(2);
		expect(source).toContain("OUTAGE_GRACE_MS,");
		expect(source).toMatch(DEADLINE_HELD);
		// The refusal path stays direct: a typed failure is never held.
		expect(source).toMatch(REFUSAL_DIRECT);
	});
	it("the AppState handler opens the window and clears the drop before reopening", () => {
		const handler = source.match(APPSTATE_HANDLER)?.[0] ?? "";
		expect(handler).toContain('if (state === "background") {');
		expect(handler).toContain("resumeClock.current.background();");
		const resume = handler.indexOf("resumeClock.current.resume();");
		const cleared = handler.indexOf("droppedSinceFrame: false,");
		const reopen = handler.indexOf("reconnectRef.current();");
		expect(resume).toBeGreaterThan(-1);
		expect(cleared).toBeGreaterThan(resume);
		expect(reopen).toBeGreaterThan(cleared);
		expect(handler).toContain("retries.current = 0;");
	});
});

describe("heldTimer while backgrounded (PR #246 R2)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("a minMs = 0 report re-arms at most once a second in the background, not in a 0 ms loop", async () => {
		const clock = createResumeClock(() => Date.now());
		clock.background();
		const timers = vi.spyOn(globalThis, "setTimeout");
		const fire = vi.fn();
		const cancel = heldTimer(clock, 0, fire);
		await vi.advanceTimersByTimeAsync(10_000);
		const armed = timers.mock.calls.length;
		// The initial 0 ms arm, then one re-arm per second (t = 0, 1, … 10 s):
		// 12. Before the floor this was a 0 ms busy loop (883 re-arms per second).
		expect(armed).toBeLessThanOrEqual(12);
		expect(fire).not.toHaveBeenCalled();
		cancel();
		timers.mockRestore();
	});

	it("after the return, a background re-arm waits out the window before it reports", async () => {
		const clock = createResumeClock(() => Date.now());
		clock.background();
		const fire = vi.fn();
		heldTimer(clock, 0, fire);
		await vi.advanceTimersByTimeAsync(2_500);
		clock.resume();
		// The pending background re-arm comes due within a second of the return;
		// it must not report inside the window it never measured.
		await vi.advanceTimersByTimeAsync(SUSPEND_SLACK_MS + 50);
		expect(fire).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(RESUME_GRACE_MS);
		expect(fire).toHaveBeenCalledTimes(1);
	});
});
