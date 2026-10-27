import { describe, expect, it } from "vitest";

import type { DiscoveredComputer } from "@/connection";
import {
	computersView,
	discoveryFailureMessage,
	rowState,
} from "./computers-view";

/**
 * The Computers screen's branch decisions (PR #121 round 1: R1-M1, D1–D4).
 * Each case is a state a reader reached in the design or QA rig, with the
 * branch that rendered then and the one that must render now.
 */
const row = (id: string, name = `Synthetic ${id}`): DiscoveredComputer => ({
	tunnelId: id,
	name,
	deviceId: "synthetic-device",
	hostname: `${id}-lop.example.com`,
	status: "ready",
	rawStatus: "active",
	supportsLocalOperator: true,
	billing: { eligible: true, message: null },
	updatedAt: 0,
});

describe("computersView", () => {
	it("shows the skeleton while a route-less discovery runs (D4)", () => {
		const view = computersView({
			computers: [],
			discovering: true,
			discoveryFailure: null,
		});
		expect(view).toMatchObject({
			skeleton: true,
			setup: false,
			list: false,
			banner: null,
			title: "Computers",
		});
	});

	it("keeps cached rows under a failed refresh, with a banner, not a refusal (D2)", () => {
		const view = computersView({
			computers: [row("a", "Studio Mac"), row("b")],
			discovering: false,
			discoveryFailure: "unreachable",
		});
		expect(view.list).toBe(true);
		expect(view.setup).toBe(false);
		expect(view.banner).toBe(
			"Radient could not be reached, so this list may be out of date.",
		);
		/* The headline blames Radient, never the first computer (R1-m2). */
		expect(view.banner).not.toContain("Studio Mac");
		expect(view.banner).not.toMatch(/keep trying/);
	});

	it("keeps the banner and the rows while a retry is in flight", () => {
		const view = computersView({
			computers: [row("a")],
			discovering: true,
			discoveryFailure: "rejected",
		});
		expect(view).toMatchObject({ list: true, skeleton: false, setup: false });
		expect(view.banner).toContain("may be out of date");
	});

	it("does not stack a discovery error over the set-up tutorial (D3)", () => {
		const view = computersView({
			computers: [],
			discovering: false,
			discoveryFailure: "unreachable",
		});
		expect(view.setup).toBe(false);
		expect(view.title).toBe("Computers");
		expect(view.banner).toBe(
			"Radient could not be reached to list your computers. Check this device's connection.",
		);
		expect(view.banner).not.toContain("That address");
	});

	it("offers set-up only when Radient answered with no computers", () => {
		expect(
			computersView({
				computers: [],
				discovering: false,
				discoveryFailure: null,
			}),
		).toMatchObject({ setup: true, title: "Set up a computer", banner: null });
	});

	it("clears the banner once a discovery succeeds", () => {
		/* The store clears `discoveryFailure` in `setComputers`; with it null the
		 *  banner is gone and the fresh rows render. */
		expect(
			computersView({
				computers: [row("a")],
				discovering: false,
				discoveryFailure: null,
			}).banner,
		).toBeNull();
	});
});

describe("discoveryFailureMessage", () => {
	it("never promises an automatic retry", () => {
		for (const failure of ["unreachable", "rejected"] as const)
			for (const rows of [true, false])
				expect(discoveryFailureMessage(failure, rows)).not.toMatch(
					/keep trying|by itself/,
				);
	});
});

describe("rowState", () => {
	it("marks the tapped row connecting while its session is minted (D1)", () => {
		expect(rowState(row("a"), { tunnelId: "a", phase: "minting" })).toBe(
			"connecting",
		);
		expect(rowState(row("b"), { tunnelId: "a", phase: "minting" })).toBe(
			"idle",
		);
	});

	it("marks it active once usable, and neither when refused", () => {
		expect(rowState(row("a"), { tunnelId: "a", phase: "live" })).toBe("active");
		expect(rowState(row("a"), { tunnelId: "a", phase: "refused" })).toBe(
			"idle",
		);
	});
});
