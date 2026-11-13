import { describe, expect, it } from "vitest";

import type { DiscoveredComputer } from "@/connection";
import { t } from "@/i18n";
import {
	ADD_COMPUTER_HREF,
	backAction,
	computersView,
	discoveryFailureKey,
	landingAfterPick,
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
			title: "mobile.computers.title.list",
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
		expect(view.banner).toBe("mobile.computers.banner.unreachable_stale");
		/* The headline blames Radient, never the first computer (R1-m2). The view
		 *  returns a key, so the sentence is read through the catalogue. */
		expect(t(view.banner!)).toBe(
			"Radient could not be reached, so this list may be out of date.",
		);
		expect(t(view.banner!)).not.toContain("Studio Mac");
		expect(t(view.banner!)).not.toMatch(/keep trying/);
	});

	it("keeps the banner and the rows while a retry is in flight", () => {
		const view = computersView({
			computers: [row("a")],
			discovering: true,
			discoveryFailure: "rejected",
		});
		expect(view).toMatchObject({ list: true, skeleton: false, setup: false });
		expect(view.banner).toBe("mobile.computers.banner.unreadable_stale");
		expect(t(view.banner!)).toContain("may be out of date");
	});

	it("does not stack a discovery error over the set-up tutorial (D3)", () => {
		const view = computersView({
			computers: [],
			discovering: false,
			discoveryFailure: "unreachable",
		});
		expect(view.setup).toBe(false);
		expect(view.title).toBe("mobile.computers.title.list");
		expect(view.banner).toBe("mobile.computers.banner.unreachable_empty");
		expect(t(view.banner!)).toBe(
			"Radient could not be reached to list your computers. Check this device's connection.",
		);
		expect(t(view.banner!)).not.toContain("That address");
	});

	it("offers set-up only when Radient answered with no computers", () => {
		expect(
			computersView({
				computers: [],
				discovering: false,
				discoveryFailure: null,
			}),
		).toMatchObject({
			setup: true,
			title: "mobile.computers.title.set_up",
			banner: null,
		});
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

describe("discoveryFailureKey", () => {
	it("never promises an automatic retry", () => {
		for (const failure of ["unreachable", "rejected"] as const)
			for (const rows of [true, false])
				expect(t(discoveryFailureKey(failure, rows))).not.toMatch(
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

describe("signed out (PR #121 QA round 2, Q-r2-1)", () => {
	it("reads a revoked grant's empty list as signed out, not an empty account", () => {
		expect(
			computersView({
				computers: [],
				discovering: false,
				discoveryFailure: null,
				signedOut: true,
			}),
		).toMatchObject({
			title: "mobile.computers.title.list",
			setup: false,
			skeleton: false,
			banner: null,
		});
	});
});

describe("landingAfterPick (PR #121 UX round 1, U1)", () => {
	const base = {
		picked: "tun-a",
		tunnelId: "tun-a",
		canGoBack: false,
	} as const;

	it("takes a cold-start pick Home once its route is live", () => {
		expect(landingAfterPick({ ...base, phase: "live" })).toBe("home");
	});

	it("stays while the pick mints, and on a refusal the reader must see", () => {
		for (const phase of ["minting", "refused"] as const)
			expect(landingAfterPick({ ...base, phase })).toBe("stay");
	});

	it("keeps the pushed screen's behaviour: the reader pops back themselves", () => {
		expect(landingAfterPick({ ...base, phase: "live", canGoBack: true })).toBe(
			"stay",
		);
	});

	it("does not leave for a route that was live before anything was tapped here", () => {
		expect(landingAfterPick({ ...base, picked: null, phase: "live" })).toBe(
			"stay",
		);
		expect(
			landingAfterPick({ ...base, tunnelId: "tun-b", phase: "live" }),
		).toBe("stay");
	});
});

describe("backAction (U1)", () => {
	it("pops when the stack has a screen underneath", () => {
		expect(backAction({ canGoBack: true, routed: false })).toBe("pop");
	});

	it("goes Home from the cold-start root once a route exists (Back during a mint)", () => {
		expect(backAction({ canGoBack: false, routed: true })).toBe("home");
	});

	it("is absent at the root with no route, where Home would bounce straight back", () => {
		expect(backAction({ canGoBack: false, routed: false })).toBeNull();
	});
});

describe("Add a computer opens the set-up paths over a populated list (PR #122 U12)", () => {
	it("shows set-up, not the rows, when the reader asked to add", () => {
		const view = computersView({
			computers: [row("a", "Studio Mac")],
			discovering: false,
			discoveryFailure: null,
			adding: true,
		});
		expect(view).toMatchObject({
			title: "mobile.computers.title.set_up",
			setup: true,
			list: false,
			banner: null,
		});
	});

	it("keeps the list without the add mode, and signed out still wins", () => {
		const base = {
			computers: [row("a", "Studio Mac")],
			discovering: false,
			discoveryFailure: null,
		};
		expect(computersView(base).list).toBe(true);
		expect(
			computersView({ ...base, adding: true, signedOut: true }).setup,
		).toBe(false);
	});

	it("is the one destination every Add a computer uses", () => {
		expect(ADD_COMPUTER_HREF).toEqual({
			pathname: "/tunnels",
			params: { add: "1" },
		});
	});
});
