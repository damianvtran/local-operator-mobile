import { describe, expect, it } from "vitest";

import {
	START_EFFORTS,
	startEffortAdmitted,
	startTargetRefusal,
} from "./wire.ts";

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

/** The mock's copy of the relay's start-target check (local-operator #4367). */
describe("the start route's agent/team check", () => {
	const roster = {
		agents: [{ name: "coder" }],
		teams: [{ name: "lopdev" }],
	};
	it("admits no target, and a listed one case-insensitively", () => {
		expect(startTargetRefusal({ cwd: "/tmp" }, roster)).toBeNull();
		expect(startTargetRefusal({ team: " LOPDEV " }, roster)).toBeNull();
		expect(startTargetRefusal({ agent: "coder", team: "" }, roster)).toBeNull();
	});
	it("refuses both kinds, a bad shape, and an unknown name as the relay does", () => {
		expect(
			startTargetRefusal({ agent: "coder", team: "lopdev" }, roster),
		).toEqual({
			status: 400,
			code: "invalid_start_target",
		});
		expect(startTargetRefusal({ team: 7 }, roster)?.code).toBe(
			"invalid_start_target",
		);
		expect(startTargetRefusal({ team: "x".repeat(129) }, roster)?.code).toBe(
			"invalid_start_target",
		);
		expect(startTargetRefusal({ team: "gone" }, roster)).toEqual({
			status: 404,
			code: "unknown_start_target",
		});
	});
});
