import { describe, expect, it } from "vitest";
import {
	COPY_FEEDBACK_MS,
	type CopyFeedback,
	createCopyFeedback,
} from "./copy-feedback";

/** A fake clock: timers run only when the test advances it. */
function fakeClock() {
	let now = 0;
	let next = 1;
	const due = new Map<number, { at: number; run: () => void }>();
	return {
		timers: {
			setTimeout: (run: () => void, ms: number) => {
				const id = next++;
				due.set(id, { at: now + ms, run });
				return id;
			},
			clearTimeout: (handle: unknown) => due.delete(handle as number),
		},
		advance(ms: number) {
			now += ms;
			for (const [id, timer] of [...due].sort((a, b) => a[1].at - b[1].at)) {
				if (timer.at <= now) {
					due.delete(id);
					timer.run();
				}
			}
		},
	};
}

/* PR #261 R7/U7/D9: the label used to stay "Diagnostics copied" forever, and a
 *  refused clipboard was a silent unhandled rejection. */
describe("Copy diagnostics feedback", () => {
	it("shows Copied, then returns to the button's label after ~2 s", async () => {
		const clock = fakeClock();
		const seen: CopyFeedback[] = [];
		const copier = createCopyFeedback({
			write: async () => undefined,
			onChange: (state) => seen.push(state),
			timers: clock.timers,
		});
		await copier.copy("text");
		expect(seen).toEqual(["copied"]);
		clock.advance(COPY_FEEDBACK_MS - 1);
		expect(seen).toEqual(["copied"]);
		clock.advance(1);
		expect(seen).toEqual(["copied", "idle"]);
	});

	it("says so when the clipboard refuses, without an unhandled rejection", async () => {
		const clock = fakeClock();
		const seen: CopyFeedback[] = [];
		const copier = createCopyFeedback({
			write: () => Promise.reject(new Error("NotAllowedError")),
			onChange: (state) => seen.push(state),
			timers: clock.timers,
		});
		await expect(copier.copy("text")).resolves.toBeUndefined();
		expect(seen).toEqual(["failed"]);
		clock.advance(COPY_FEEDBACK_MS);
		expect(seen).toEqual(["failed", "idle"]);
	});

	it("restarts the window on a second press, and stops after dispose", async () => {
		const clock = fakeClock();
		const seen: CopyFeedback[] = [];
		const copier = createCopyFeedback({
			write: async () => undefined,
			onChange: (state) => seen.push(state),
			timers: clock.timers,
		});
		await copier.copy("a");
		clock.advance(1_500);
		await copier.copy("b");
		clock.advance(1_500);
		/* Still "copied": the first window was replaced, not left to fire. */
		expect(seen).toEqual(["copied", "copied"]);
		clock.advance(500);
		expect(seen).toEqual(["copied", "copied", "idle"]);
		await copier.copy("c");
		copier.dispose();
		clock.advance(COPY_FEEDBACK_MS);
		expect(seen).toEqual(["copied", "copied", "idle", "copied"]);
	});
});
