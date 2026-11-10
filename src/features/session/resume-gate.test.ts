import { describe, expect, it } from "vitest";
import { createResumeGate, RESUME_DEBOUNCE_MS } from "./resume-gate";

describe("one return to the app reads once (d)", () => {
	it("a quick flick out and back, or a system sheet bounce, does not re-read twice", () => {
		let now = 10_000;
		const gate = createResumeGate(RESUME_DEBOUNCE_MS, () => now);
		expect(gate()).toBe(true); // AppState "active"
		now += 400;
		expect(gate()).toBe(false); // "active" again after a flick
		now += 600;
		expect(gate()).toBe(false); // the reopened stream's first frame
	});

	it("a real later return is always served", () => {
		let now = 0;
		const gate = createResumeGate(RESUME_DEBOUNCE_MS, () => now);
		expect(gate()).toBe(true);
		now += RESUME_DEBOUNCE_MS;
		expect(gate()).toBe(true);
		now += 60_000;
		expect(gate()).toBe(true);
	});
});
