import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResumeClock, RESUME_GRACE_MS } from "./resume-hold";
import {
	catalogueRereadOnConfig,
	holdResumeRead,
	insideResumeWindow,
	resumeHistoryRead,
	STREAM_WAKE_SILENCE_MS,
	shouldWakeStream,
} from "./resume-plan";

describe("resumeHistoryRead", () => {
	it("reads only when the gate is open AND the first frame does not overlap", () => {
		expect(
			resumeHistoryRead({ gateOpen: true, frameOverlapsHeld: false }),
		).toBe(true);
		// The duplicate newest page: dropped.
		expect(resumeHistoryRead({ gateOpen: true, frameOverlapsHeld: true })).toBe(
			false,
		);
		// A second `active` inside the debounce is the same return.
		expect(
			resumeHistoryRead({ gateOpen: false, frameOverlapsHeld: false }),
		).toBe(false);
	});
});

describe("catalogueRereadOnConfig", () => {
	it("the seed frame (no changed keys) never re-reads; any named change does", () => {
		expect(catalogueRereadOnConfig([])).toBe(false);
		expect(catalogueRereadOnConfig(["language"])).toBe(true);
		expect(catalogueRereadOnConfig(["model.default"])).toBe(true);
	});
});

describe("shouldWakeStream", () => {
	it("wakes a silent, never-seen or backed-off stream; leaves a recently live one", () => {
		expect(
			shouldWakeStream({ silentMs: STREAM_WAKE_SILENCE_MS, inBackoff: false }),
		).toBe(true);
		expect(shouldWakeStream({ silentMs: null, inBackoff: false })).toBe(true);
		expect(shouldWakeStream({ silentMs: 1_000, inBackoff: true })).toBe(true);
		expect(
			shouldWakeStream({
				silentMs: STREAM_WAKE_SILENCE_MS - 1,
				inBackoff: false,
			}),
		).toBe(false);
	});
});

describe("holdResumeRead: a failure inside the resume window is held, retried once, then shown", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const flush = async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	};

	it("holds a first failure in the window and shows the retry's own failure after it", async () => {
		const clock = createResumeClock(() => Date.now());
		clock.background();
		clock.resume();
		let failed = false;
		const held: boolean[] = [];
		const read = vi.fn(async () => {
			failed = true;
		});
		const retry = vi.fn(async () => {
			failed = true;
		});
		holdResumeRead({
			clock,
			read,
			retry,
			failed: () => failed,
			setHeld: (h) => held.push(h),
		});
		await flush();
		expect(insideResumeWindow(clock)).toBe(true);
		expect(held).toEqual([true]); // hidden while the window is open
		expect(retry).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(RESUME_GRACE_MS + 10);
		await flush();
		expect(retry).toHaveBeenCalledTimes(1); // exactly one silent retry
		expect(held).toEqual([true, false]); // ... then whatever it left shows
	});

	it("a success inside the window releases the hold at once, no retry", async () => {
		const clock = createResumeClock(() => Date.now());
		clock.resume();
		const held: boolean[] = [];
		const retry = vi.fn(async () => undefined);
		holdResumeRead({
			clock,
			read: async () => undefined,
			retry,
			failed: () => false,
			setHeld: (h) => held.push(h),
		});
		await flush();
		expect(held).toEqual([true, false]);
		await vi.advanceTimersByTimeAsync(RESUME_GRACE_MS + 10);
		expect(retry).not.toHaveBeenCalled();
	});

	it("outside the window a failure is not held: it shows at once", async () => {
		const clock = createResumeClock(() => Date.now());
		clock.resume();
		await vi.advanceTimersByTimeAsync(RESUME_GRACE_MS + 10);
		expect(insideResumeWindow(clock)).toBe(false);
		const held: boolean[] = [];
		const read = vi.fn(async () => undefined);
		holdResumeRead({
			clock,
			read,
			retry: read,
			failed: () => true,
			setHeld: (h) => held.push(h),
		});
		await flush();
		expect(read).toHaveBeenCalledTimes(1);
		expect(held).toEqual([]);
	});
});

describe("PR #246 round-1 remediation: resume-plan regressions", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());
	const flush = async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	};

	it("R4: cancelling a held read releases its hold, so a later outside-window error shows", async () => {
		const clock = createResumeClock(() => Date.now());
		clock.background();
		clock.resume();
		const held: boolean[] = [];
		const cancel = holdResumeRead({
			clock,
			read: async () => undefined,
			retry: async () => undefined,
			failed: () => true,
			setHeld: (h) => held.push(h),
		});
		await flush();
		expect(held).toEqual([true]);
		// A later return's read supersedes this one before its retry ran.
		cancel();
		expect(held).toEqual([true, false]);
		// Cancelling twice (unmount after supersession) writes nothing more.
		cancel();
		expect(held).toEqual([true, false]);
	});

	it("R4: a read that already released is not released again on cancel", async () => {
		const clock = createResumeClock(() => Date.now());
		clock.resume();
		const held: boolean[] = [];
		const cancel = holdResumeRead({
			clock,
			read: async () => undefined,
			retry: async () => undefined,
			failed: () => false,
			setHeld: (h) => held.push(h),
		});
		await flush();
		cancel();
		expect(held).toEqual([true, false]);
	});

	it("R3: a woken reopen's baseline frame re-reads the catalogues; a plain seed does not", () => {
		expect(catalogueRereadOnConfig([], false)).toBe(false);
		expect(catalogueRereadOnConfig([], true)).toBe(true);
		expect(catalogueRereadOnConfig(["providers"], false)).toBe(true);
	});
});
