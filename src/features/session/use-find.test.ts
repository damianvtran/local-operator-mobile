import { describe, expect, it } from "vitest";

import type { FindHit } from "@/features/session/find";
import { FIND_INITIAL, findNextState } from "@/features/session/use-find";

/**
 * The find session's transitions, pinned without a renderer: the flow that
 * matters is "browse -> land -> step -> back to results -> leave", and each
 * transition carries a rule a future edit could quietly break. The landing is
 * an IDENTITY (a message id), and two of these cases exist to keep it that
 * way — a rank stored in state re-points when the hits recompute under it.
 */

const hit = (id: string): FindHit => ({
	id,
	role: "user",
	snippet: id,
	ranges: [],
	tier: "exact",
});

describe("findNextState", () => {
	it("open is a FRESH search: a stale query and landing are not the reader's", () => {
		const stale = { open: false, query: "ledger", activeId: "h2", nonce: 9 };
		expect(findNextState(stale, { type: "open" })).toEqual({
			open: true,
			query: "",
			activeId: null,
			// The nonce is monotone across the screen's life: a reset that
			// reused it would make the list skip the next landing.
			nonce: 9,
		});
	});

	it("query resets the landing — a new answer set is not the old one", () => {
		const landed = { open: false, query: "ledger", activeId: "h1", nonce: 3 };
		expect(findNextState(landed, { type: "query", query: "retry" })).toEqual({
			open: false,
			query: "retry",
			activeId: null,
			nonce: 3,
		});
	});

	it("activate closes the sheet, records the landing by IDENTITY and bumps the nonce", () => {
		const browsing = { open: true, query: "ledger", activeId: null, nonce: 0 };
		const hits = [hit("h0"), hit("h1"), hit("h2")];
		expect(
			findNextState(browsing, { type: "activate", index: 2, hits }),
		).toEqual({
			open: false,
			query: "ledger",
			activeId: "h2",
			nonce: 1,
		});
	});

	it("closeSheet keeps the bar when a hit is landed, and ends find mode when none is", () => {
		const landed = { open: true, query: "ledger", activeId: "h1", nonce: 2 };
		expect(findNextState(landed, { type: "closeSheet" })).toEqual({
			open: false,
			query: "ledger",
			activeId: "h1",
			nonce: 2,
		});
		const neverLanded = {
			open: true,
			query: "ledger",
			activeId: null,
			nonce: 0,
		};
		expect(findNextState(neverLanded, { type: "closeSheet" })).toEqual(
			FIND_INITIAL,
		);
		// The nonce survives the reset whichever arm runs.
		const stale = { open: true, query: "ledger", activeId: null, nonce: 7 };
		expect(findNextState(stale, { type: "closeSheet" })).toEqual({
			...FIND_INITIAL,
			nonce: 7,
		});
	});

	it("reopen returns to the results with query and place kept", () => {
		const landed = { open: false, query: "ledger", activeId: "h1", nonce: 4 };
		expect(findNextState(landed, { type: "reopen" })).toEqual({
			open: true,
			query: "ledger",
			activeId: "h1",
			nonce: 4,
		});
	});

	it("exit clears everything but the monotone nonce", () => {
		const landed = { open: false, query: "ledger", activeId: "h1", nonce: 4 };
		expect(findNextState(landed, { type: "exit" })).toEqual({
			...FIND_INITIAL,
			nonce: 4,
		});
	});

	it("step wraps, bumps the nonce, and resolves an empty list to no landing", () => {
		const landed = { open: false, query: "ledger", activeId: "h2", nonce: 1 };
		const hits = [hit("h0"), hit("h1"), hit("h2")];
		expect(findNextState(landed, { type: "step", delta: 1, hits })).toEqual({
			open: false,
			query: "ledger",
			activeId: "h0",
			nonce: 2,
		});
		expect(findNextState(landed, { type: "step", delta: -1, hits })).toEqual({
			open: false,
			query: "ledger",
			activeId: "h1",
			nonce: 2,
		});
		// Stepping on an empty answer leaves no landing — `n of m` must not
		// claim a position that is not one.
		expect(findNextState(landed, { type: "step", delta: 1, hits: [] })).toEqual(
			{ open: false, query: "ledger", activeId: null, nonce: 1 },
		);
	});

	it("steps from the landed message's CURRENT rank, not the rank it landed at", () => {
		// The frames slid and "h2" now leads the list. The reader's next step
		// must leave from h2 — an index kept from activation would walk from
		// whatever message now sits at that rank (reviewer MINOR-3).
		const landed = { open: false, query: "ledger", activeId: "h2", nonce: 1 };
		const shifted = [hit("h2"), hit("h3"), hit("h4")];
		expect(
			findNextState(landed, { type: "step", delta: 1, hits: shifted }),
		).toEqual({ open: false, query: "ledger", activeId: "h3", nonce: 2 });
	});
});
