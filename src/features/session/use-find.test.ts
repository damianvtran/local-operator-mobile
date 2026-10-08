import { describe, expect, it } from "vitest";

import { FIND_INITIAL, findNextState } from "@/features/session/use-find";

/**
 * The find session's transitions, pinned without a renderer: the flow that
 * matters is "browse -> land -> step -> back to results -> leave", and each
 * transition carries a rule a future edit could quietly break.
 */

describe("findNextState", () => {
	it("open is a FRESH search: a stale query and landing are not the reader's", () => {
		const stale = { open: false, query: "ledger", active: 2, nonce: 9 };
		expect(findNextState(stale, { type: "open" })).toEqual({
			open: true,
			query: "",
			active: -1,
			// The nonce is monotone across the screen's life: a reset that
			// reused it would make the list skip the next landing.
			nonce: 9,
		});
	});

	it("query resets the landing — a new answer set is not the old one", () => {
		const landed = { open: false, query: "ledger", active: 1, nonce: 3 };
		expect(findNextState(landed, { type: "query", query: "retry" })).toEqual({
			open: false,
			query: "retry",
			active: -1,
			nonce: 3,
		});
	});

	it("activate closes the sheet, records the landing and bumps the nonce", () => {
		const browsing = { open: true, query: "ledger", active: -1, nonce: 0 };
		expect(findNextState(browsing, { type: "activate", index: 2 })).toEqual({
			open: false,
			query: "ledger",
			active: 2,
			nonce: 1,
		});
	});

	it("closeSheet keeps the bar when a hit is landed, and ends find mode when none is", () => {
		const landed = { open: true, query: "ledger", active: 1, nonce: 2 };
		expect(findNextState(landed, { type: "closeSheet" })).toEqual({
			open: false,
			query: "ledger",
			active: 1,
			nonce: 2,
		});
		const neverLanded = { open: true, query: "ledger", active: -1, nonce: 0 };
		expect(findNextState(neverLanded, { type: "closeSheet" })).toEqual(
			FIND_INITIAL,
		);
		// The nonce survives the reset whichever arm runs.
		const stale = { open: true, query: "ledger", active: -1, nonce: 7 };
		expect(findNextState(stale, { type: "closeSheet" })).toEqual({
			...FIND_INITIAL,
			nonce: 7,
		});
	});

	it("reopen returns to the results with query and place kept", () => {
		const landed = { open: false, query: "ledger", active: 1, nonce: 4 };
		expect(findNextState(landed, { type: "reopen" })).toEqual({
			open: true,
			query: "ledger",
			active: 1,
			nonce: 4,
		});
	});

	it("exit clears everything but the monotone nonce", () => {
		const landed = { open: false, query: "ledger", active: 1, nonce: 4 };
		expect(findNextState(landed, { type: "exit" })).toEqual({
			...FIND_INITIAL,
			nonce: 4,
		});
	});

	it("step wraps, bumps the nonce, and resolves an empty list to no landing", () => {
		const landed = { open: false, query: "ledger", active: 2, nonce: 1 };
		expect(findNextState(landed, { type: "step", delta: 1, count: 3 })).toEqual(
			{ open: false, query: "ledger", active: 0, nonce: 2 },
		);
		expect(
			findNextState(landed, { type: "step", delta: -1, count: 3 }),
		).toEqual({ open: false, query: "ledger", active: 1, nonce: 2 });
		// Stepping on an empty answer leaves no landing — `n of m` must not
		// claim a position that is not one.
		expect(findNextState(landed, { type: "step", delta: 1, count: 0 })).toEqual(
			{ open: false, query: "ledger", active: -1, nonce: 1 },
		);
	});
});
