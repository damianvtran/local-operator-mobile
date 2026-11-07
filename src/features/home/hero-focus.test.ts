import { describe, expect, it } from "vitest";
import { focusLatch, NO_PRESS, pressAnswered } from "./hero-focus";

/* Agent review round 2, M1: the splash remounts on New chat and on a cleared
 * recovery state with Home's never-reset counter, and must not replay it. */
describe("focusLatch", () => {
	it("does not move focus for the value a splash mounts with, even non-zero", () => {
		const latch = focusLatch(3);
		expect(latch.take(3)).toBe(false);
	});
	it("moves focus once for a request made after mount", () => {
		const latch = focusLatch(3);
		expect(latch.take(4)).toBe(true);
		/* An effect re-run with the same value (StrictMode, a re-render). */
		expect(latch.take(4)).toBe(false);
	});
	it("does not move focus when the splash remounts with the same value", () => {
		const first = focusLatch(0);
		expect(first.take(1)).toBe(true);
		/* New chat → transcript → back to the splash: a fresh mount, same value. */
		const remount = focusLatch(1);
		expect(remount.take(1)).toBe(false);
		expect(remount.take(2)).toBe(true);
	});
	it("still answers the first request of a never-asked home", () => {
		const latch = focusLatch(0);
		expect(latch.take(0)).toBe(false);
		expect(latch.take(1)).toBe(true);
	});
});

/* Agent review round 2, m2: only the read a reader's press created may ask. */
describe("pressAnswered", () => {
	it("answers the attempt the press created", () => {
		expect(pressAnswered(2, 2)).toBe(true);
	});
	it("ignores an automatic re-ask, which is a different attempt", () => {
		expect(pressAnswered(2, 3)).toBe(false);
	});
	it("ignores every read when no press is pending", () => {
		expect(pressAnswered(NO_PRESS, 0)).toBe(false);
		expect(pressAnswered(NO_PRESS, 5)).toBe(false);
	});
});
