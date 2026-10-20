/**
 * The listing's in-flight authority (review round 1, major 1).
 *
 * The regression shape: a query changes, a debounced start is pending, and a
 * cursor page already in flight resolves afterwards. The page must be discarded
 * and the list must settle on the query the reader sees — not on the rows the
 * cursor belonged to, with the new query sitting in the field forever.
 */

import { describe, expect, it } from "vitest";

import { createLibraryRequestGate } from "@/features/library/library-request-gate";

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

describe("library request generations", () => {
	it("discards a cursor page that resolves after the query changed", async () => {
		const gate = createLibraryRequestGate();
		const firstQuery = gate.queryChanged();
		const cursorTicket = gate.begin();

		// The reader types again while the cursor page is in flight.
		const secondQuery = gate.queryChanged();
		expect(secondQuery).not.toBe(firstQuery);

		const page = deferred<{ rows: string[] }>();
		let painted = false;
		void page.promise.then(() => {
			if (gate.accepts(cursorTicket)) painted = true;
		});
		page.resolve({ rows: ["old"] });
		await page.promise;
		await Promise.resolve();

		expect(painted).toBe(false);

		// The debounced start for the new query takes the next ticket and wins.
		const searchTicket = gate.begin();
		expect(gate.accepts(searchTicket)).toBe(true);
		expect(gate.accepts(cursorTicket)).toBe(false);
	});

	it("invalidates a pending debounced start as soon as the query moves", () => {
		const gate = createLibraryRequestGate();
		const generation = gate.queryChanged();
		gate.queryChanged();
		expect(gate.currentQuery()).not.toBe(generation);
	});

	it("supersedes an older cursor page for the same query", () => {
		const gate = createLibraryRequestGate();
		gate.queryChanged();
		const older = gate.begin();
		const newer = gate.begin();
		expect(gate.accepts(older)).toBe(false);
		expect(gate.accepts(newer)).toBe(true);
	});
});
