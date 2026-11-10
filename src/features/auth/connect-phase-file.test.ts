import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { persistConnectPhases } from "./connect-phase-file";
import {
	CAPACITY,
	recordConnectPhase,
	resetConnectPhases,
} from "./connect-phases";

/* The file is what the native proof reads out of the app container when the
 * hidden node is not in the hierarchy (PR #216 run 42855980853), so it must
 * track every append, stay bounded and redacted, and never throw into a connect. */
describe("connect phase file mirror", () => {
	beforeEach(() => {
		resetConnectPhases();
		vi.spyOn(console, "info").mockImplementation(() => undefined);
	});
	afterEach(() => vi.restoreAllMocks());

	it("writes the current ring at once and again on every append", () => {
		recordConnectPhase("start");
		const writes: string[] = [];
		const stop = persistConnectPhases({ write: (text) => writes.push(text) });
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatch(/^t\+\d+ start$/);
		recordConnectPhase("error", {
			error: new Error("keychain: password=hunter2"),
		});
		expect(writes).toHaveLength(2);
		expect(writes[1]).toMatch(/\nt\+\d+ error kind=Error/);
		expect(writes[1]).not.toContain("hunter2");
		stop();
		recordConnectPhase("done");
		expect(writes).toHaveLength(2);
	});

	it("stays bounded to the ring's capacity", () => {
		let last = "";
		const stop = persistConnectPhases({
			write: (text) => {
				last = text;
			},
		});
		for (let i = 0; i < CAPACITY + 20; i++) recordConnectPhase("start");
		expect(last.split("\n")).toHaveLength(CAPACITY);
		stop();
	});

	it("swallows a failing write so the connect it observes carries on", () => {
		const stop = persistConnectPhases({
			write: () => {
				throw new Error("disk full");
			},
		});
		expect(() => recordConnectPhase("start")).not.toThrow();
		stop();
	});
});
