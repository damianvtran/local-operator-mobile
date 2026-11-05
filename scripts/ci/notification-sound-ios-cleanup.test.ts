import { describe, expect, it } from "vitest";
import { shutdownOwnedSimulator } from "./notification-sound-ios-cleanup.ts";

const OWNED = "11111111-2222-3333-4444-555555555555";
const OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const listing = (state: string, udid = OWNED) =>
	JSON.stringify({
		devices: {
			runtime: [
				{ udid, state },
				{ udid: OTHER, state: "Booted" },
			],
		},
	});
function fixture(states: string[], failure?: Error) {
	const calls: string[][] = [];
	const run = (args: string[]): string => {
		calls.push(args);
		if (args[0] === "shutdown") {
			if (failure) throw failure;
			return "";
		}
		const state = states.shift();
		if (!state) throw new Error("Unexpected extra simulator query");
		return listing(state);
	};
	return { run, calls };
}

describe("owned simulator cleanup (no local SDK dispatch)", () => {
	it("treats an already Shutdown simulator as clean without another shutdown", () => {
		const f = fixture(["Shutdown"]);
		expect(shutdownOwnedSimulator(OWNED, f.run)).toContain("already Shutdown");
		expect(f.calls).toEqual([["list", "devices", "--json"]]);
	});
	it("shuts down only the owned Booted UUID and verifies Shutdown", () => {
		const f = fixture(["Booted", "Shutdown"]);
		expect(shutdownOwnedSimulator(OWNED, f.run)).toContain(
			"Booted -> Shutdown",
		);
		expect(f.calls).toEqual([
			["list", "devices", "--json"],
			["shutdown", OWNED],
			["list", "devices", "--json"],
		]);
	});
	it("propagates a genuine shutdown command failure", () => {
		const error = new Error("simctl shutdown exited 149");
		const f = fixture(["Booted"], error);
		expect(() => shutdownOwnedSimulator(OWNED, f.run)).toThrow(error);
		expect(f.calls).toHaveLength(2);
	});
	it("rejects a missing UUID rather than shutting down all or another device", () => {
		const calls: string[][] = [];
		expect(() =>
			shutdownOwnedSimulator(OWNED, (args) => {
				calls.push(args);
				return listing("Booted", OTHER);
			}),
		).toThrow("missing or ambiguous");
		expect(calls).toHaveLength(1);
	});
	it("rejects unknown transitional state without issuing shutdown", () => {
		const f = fixture(["Shutting Down"]);
		expect(() => shutdownOwnedSimulator(OWNED, f.run)).toThrow("Unexpected");
		expect(f.calls).toHaveLength(1);
	});
	it("rejects a shutdown that did not reach the required state", () => {
		const f = fixture(["Booted", "Booted"]);
		expect(() => shutdownOwnedSimulator(OWNED, f.run)).toThrow(
			"did not shut down",
		);
	});
	it("rejects malformed/all selectors before any native call", () => {
		const f = fixture([]);
		for (const input of ["", "all", "booted", "../device"])
			expect(() => shutdownOwnedSimulator(input, f.run)).toThrow(
				"exact simulator UUID",
			);
		expect(f.calls).toEqual([]);
	});
	it("propagates list command failure rather than pretending the device is off", () => {
		expect(() =>
			shutdownOwnedSimulator(OWNED, () => {
				throw Error("simctl list unavailable");
			}),
		).toThrow("list unavailable");
	});
});
