import { describe, expect, it } from "vitest";

import { reuseRows } from "@/features/session/row-identity";

/**
 * `reuseRows` is the identity half of the transcript's render isolation: a row
 * that kept its object is a row `memo(TranscriptRow)` skips. Its two failure
 * modes are opposite and both silent on a green render-count test — reusing
 * too little re-renders the window every frame (the jitter this PR fixes),
 * reusing too much freezes a row on stale content or order (review round 1,
 * R1-1 / R1-4). Each case below pins one side.
 */

type Row = {
	id: string;
	kind: string;
	text: string;
	details: { status?: string; tags?: string[] };
};

const row = (id: string, text = `text ${id}`, status = "done"): Row => ({
	id,
	kind: "assistant",
	text,
	details: { status, tags: ["a", "b"] },
});

/** A fresh copy of every row: what the relay delivers on each frame. */
const copies = (rows: readonly Row[]): Row[] =>
	rows.map((r) => ({
		...r,
		details: { ...r.details, tags: [...(r.details.tags ?? [])] },
	}));

describe("reuseRows", () => {
	it("returns the previous array for an identical frame of fresh objects", () => {
		const previous = [row("1"), row("2"), row("3")];
		expect(reuseRows(previous, copies(previous))).toBe(previous);
	});

	it("passes the next frame through when there is no previous one", () => {
		const next = [row("1")];
		expect(reuseRows(null, next)).toBe(next);
		expect(reuseRows(undefined, next)).toBe(next);
	});

	it("follows a reorder of unchanged rows instead of keeping the old order (R1-1)", () => {
		const previous = [row("1"), row("2"), row("3")];
		const next = copies([previous[1], previous[0], previous[2]] as Row[]);
		const out = reuseRows(previous, next);
		expect(out).not.toBe(previous);
		expect(out.map((r) => r.id)).toEqual(["2", "1", "3"]);
		// Every row is still the reused object, just in the new order.
		expect(out[0]).toBe(previous[1]);
		expect(out[1]).toBe(previous[0]);
		expect(out[2]).toBe(previous[2]);
	});

	it("reuses the neighbours of a mid-list insert", () => {
		const previous = [row("1"), row("2"), row("3")];
		const next = copies([
			previous[0],
			row("new"),
			previous[1],
			previous[2],
		] as Row[]);
		const out = reuseRows(previous, next);
		expect(out.map((r) => r.id)).toEqual(["1", "new", "2", "3"]);
		expect(out[0]).toBe(previous[0]);
		expect(out[1]).toBe(next[1]);
		expect(out[2]).toBe(previous[1]);
		expect(out[3]).toBe(previous[2]);
	});

	it("reuses the survivors of a mid-list remove, and is a new array", () => {
		const previous = [row("1"), row("2"), row("3")];
		const next = copies([previous[0], previous[2]] as Row[]);
		const out = reuseRows(previous, next);
		expect(out).not.toBe(previous);
		expect(out).toEqual([previous[0], previous[2]]);
		expect(out[0]).toBe(previous[0]);
		expect(out[1]).toBe(previous[2]);
	});

	it("hands over the new object for a streaming text change, and only for it", () => {
		const previous = [row("1"), row("2"), row("3", "partial")];
		const next = copies(previous);
		next[2] = { ...next[2], text: "partial and more" } as Row;
		const out = reuseRows(previous, next);
		expect(out).not.toBe(previous);
		expect(out[0]).toBe(previous[0]);
		expect(out[1]).toBe(previous[1]);
		expect(out[2]).toBe(next[2]);
		expect(out[2]?.text).toBe("partial and more");
	});

	it("hands over the new object for a nested tool status change", () => {
		const previous = [row("t", "bash", "running")];
		const next = [row("t", "bash", "done")];
		const out = reuseRows(previous, next);
		expect(out[0]).toBe(next[0]);
		expect(out[0]?.details.status).toBe("done");
	});

	it("notices a change inside a nested array", () => {
		const previous = [row("1")];
		const next = copies(previous);
		next[0]?.details.tags?.push("c");
		expect(reuseRows(previous, next)[0]).toBe(next[0]);
	});

	it("pairs duplicate ids positionally and never crosses their content", () => {
		/* The wire's ids are not unique (the `rich-rows` fixture stamps every row
		 *  `m-1`): the n-th row with an id pairs with the n-th previous one. */
		const previous = [row("m-1", "first"), row("m-1", "second")];
		const same = copies(previous);
		expect(reuseRows(previous, same)).toBe(previous);

		const changed = copies(previous);
		changed[1] = { ...changed[1], text: "second, edited" } as Row;
		const out = reuseRows(previous, changed);
		expect(out[0]).toBe(previous[0]);
		expect(out[1]).toBe(changed[1]);

		// A swap of duplicate-id rows is a reorder of content: never the old array.
		const swapped = copies([previous[1], previous[0]] as Row[]);
		const swappedOut = reuseRows(previous, swapped);
		expect(swappedOut).not.toBe(previous);
		expect(swappedOut.map((r) => r.text)).toEqual(["second", "first"]);
	});
});
