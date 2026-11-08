import { describe, expect, it } from "vitest";

import { START_EFFORTS, startEffortAdmitted } from "./wire.ts";

/**
 * The mock's copy of the relay's `start_effort` (local-operator v0.101.9,
 * `mobile/start_receipts.py`). The refusal half runs over a socket in
 * `divergences.ts`; the admission half is asserted here, where accepting a level
 * does not create a session.
 */
describe("the start route's effort check", () => {
	it("admits every vocabulary word, case- and space-insensitively", () => {
		for (const word of START_EFFORTS) {
			expect(startEffortAdmitted(word)).toBe(true);
			expect(startEffortAdmitted(` ${word.toUpperCase()} `)).toBe(true);
		}
	});

	it("reads absent, null and blank as no choice", () => {
		expect(startEffortAdmitted(undefined)).toBe(true);
		expect(startEffortAdmitted(null)).toBe(true);
		expect(startEffortAdmitted("   ")).toBe(true);
	});

	it("refuses an unknown word or a non-string", () => {
		expect(startEffortAdmitted("turbo")).toBe(false);
		expect(startEffortAdmitted(3)).toBe(false);
		expect(startEffortAdmitted(["high"])).toBe(false);
	});
});
