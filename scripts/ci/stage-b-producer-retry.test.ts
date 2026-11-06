import { describe, expect, it } from "vitest";
import { stageBShouldRetryProducer } from "./stage-b-producer-retry.ts";

describe("the producer's one bounded retry", () => {
	it("retries its own timeout when no artifact exists", () => {
		const verdict = stageBShouldRetryProducer({
			attempts: 1,
			last: { timedOut: true, elapsedMs: 2_719_600 },
			artifactPresent: false,
		});
		expect(verdict.allow).toBe(true);
		expect(verdict.reason).toContain("timed out");
	});
	it("never retries a normal build failure", () => {
		// A compile error is rc non-zero with NO timeout: retrying would double the
		// cost and could mask a real error behind a longer run.
		const verdict = stageBShouldRetryProducer({
			attempts: 1,
			last: { timedOut: false, elapsedMs: 90_000 },
			artifactPresent: false,
		});
		expect(verdict.allow).toBe(false);
		expect(verdict.reason).toContain("never retried");
	});
	it("refuses a retry when an artifact already exists", () => {
		const verdict = stageBShouldRetryProducer({
			attempts: 1,
			last: { timedOut: true, elapsedMs: 2_700_000 },
			artifactPresent: true,
		});
		expect(verdict.allow).toBe(false);
		expect(verdict.reason).toContain("artifact already exists");
	});
	it("is one-time only, and refuses without a receipt to judge", () => {
		expect(
			stageBShouldRetryProducer({
				attempts: 2,
				last: { timedOut: true, elapsedMs: 1 },
				artifactPresent: false,
			}).allow,
		).toBe(false);
		expect(
			stageBShouldRetryProducer({
				attempts: 1,
				last: null,
				artifactPresent: false,
			}).reason,
		).toContain("no producer command receipt");
	});
});
