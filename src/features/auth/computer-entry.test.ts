import { describe, expect, it } from "vitest";
import type { DiscoveredComputer } from "@/connection";
import {
	activeHealth,
	computerEntry,
	ENTRY_DOT_TOKEN,
	entryHealthWord,
	headerChipShowsChevron,
	NO_COMPUTER_LABEL,
	REFUSED_WORD,
} from "@/features/auth/computer-entry";
import {
	ENTRY_HEALTH_MARK,
	type EntryHealthKind,
} from "@/features/auth/entry-health-marks";
import { headerBellShowsCount } from "@/features/home/header-fit";

/**
 * What the Home chip and the drawer row SAY (M2b, ux-flows F5). The components
 * only paint this, so every state the reader can see is decided — and asserted —
 * here: loading (checking), empty (no computer), error (refused / sign-in /
 * paused / asleep) and populated (online).
 */

/* Placeholder host only (AGENTS.md: never a real tunnel hostname). */
const HEALTH_WORDS = /Online|Not connected|Asleep/;
const COLOUR_ONLY_DOTS = /[●•]/;
const HOST = "0123456789abcdef0123456789abcdef-lop.example.com";
const mac = (eligible: boolean | null = true): DiscoveredComputer => ({
	tunnelId: "t1",
	name: "Mac mini",
	deviceId: "device-t1",
	hostname: HOST,
	status: "ready",
	rawStatus: "active",
	supportsLocalOperator: true,
	billing: { eligible, message: null },
	updatedAt: 0,
});
const radientRoute = {
	mode: "radient" as const,
	hostname: HOST,
	tunnelId: "t1",
};

describe("computerEntry", () => {
	it("names the computer in use with its health word, never colour alone", () => {
		const entry = computerEntry({
			computers: [mac()],
			tunnelId: "t1",
			route: radientRoute,
			phase: "live",
			surface: null,
		});
		expect(entry).toMatchObject({
			kind: "computer",
			name: "Mac mini",
			health: { kind: "online" },
		});
		expect(entry.accessibilityLabel).toBe(
			"Computer: Mac mini, Online. Switch computer",
		);
	});

	it("says 'Choose a computer' when none is picked or nothing is set up", () => {
		for (const input of [
			{ route: null, tunnelId: null, phase: "signed-out" as const },
			{ route: null, tunnelId: null, phase: "discovering" as const },
		]) {
			const entry = computerEntry({
				computers: [mac()],
				surface: null,
				...input,
			});
			expect(entry.kind).toBe("none");
			expect(entry).toMatchObject({ label: NO_COMPUTER_LABEL });
			expect(entry.accessibilityLabel).toBe(
				"No computer chosen. Choose a computer",
			);
		}
	});

	it("treats a custom route as a computer in use, named by its address", () => {
		const entry = computerEntry({
			computers: [],
			tunnelId: null,
			route: {
				mode: "custom",
				baseUrl: "https://relay.example.com",
				allowInsecure: false,
			},
			phase: "minting",
			surface: null,
		});
		expect(entry.kind).toBe("computer");
		expect(entry.accessibilityLabel).toContain("Checking…");
	});
});

describe("activeHealth", () => {
	const base = {
		surface: null,
		billingEligible: true,
		radient: true,
	} as const;
	it("maps every phase to the switcher's own vocabulary", () => {
		expect(activeHealth({ ...base, phase: "live" }).kind).toBe("online");
		expect(activeHealth({ ...base, phase: "re-minting" }).kind).toBe("online");
		expect(activeHealth({ ...base, phase: "minting" }).kind).toBe("checking");
		expect(activeHealth({ ...base, phase: "degraded" }).kind).toBe("asleep");
	});
	it("puts the account's refusals before any probe answer", () => {
		expect(
			activeHealth({ ...base, phase: "signed-out", surface: "sign-in" }).kind,
		).toBe("sign-in");
		expect(
			activeHealth({ ...base, phase: "live", billingEligible: false }).kind,
		).toBe("paused");
		// A custom route has no Radient account to pause or sign out of.
		expect(
			activeHealth({
				...base,
				radient: false,
				phase: "live",
				billingEligible: false,
			}).kind,
		).toBe("online");
	});
	it("calls a silent computer Asleep and a broken route Can't connect", () => {
		expect(
			activeHealth({ ...base, phase: "refused", surface: "computer-offline" })
				.kind,
		).toBe("asleep");
		expect(
			activeHealth({ ...base, phase: "refused", surface: "password" }).kind,
		).toBe("refused");
		expect(entryHealthWord({ kind: "refused" })).toBe(REFUSED_WORD);
		expect(ENTRY_DOT_TOKEN.refused).toBe("warning");
	});
});

describe("the header chip at large text", () => {
	it("drops its chevron at the same step the bell drops its pill", () => {
		// What yields first at 320 pt / 200 %: the bell's count AND the chip's
		// chevron, together, so the width goes to the computer's name (D24).
		for (const scale of [1, 1.35, 1.99, 2, 3])
			expect(headerChipShowsChevron(scale)).toBe(headerBellShowsCount(scale));
	});
});

describe("registry name source", () => {
	const base = {
		computers: [],
		tunnelId: "t1",
		route: radientRoute,
		phase: "live" as const,
		surface: null,
	};
	const saved = {
		id: "saved-t1",
		transport: "radient" as const,
		tunnelId: "t1",
		hostname: HOST,
		name: "QA Laptop",
		account: "account-a",
		addedAt: 1,
		lastUsedAt: 1,
		hidden: false,
		identity: null,
	};
	it("uses the sheet's saved name with empty discovery, not Choose a computer", () => {
		const entry = computerEntry({
			...base,
			saved: [saved],
			radientAccount: "account-a",
		});
		expect(entry).toMatchObject({ kind: "computer", name: "QA Laptop" });
		expect(entry.accessibilityLabel).not.toContain(NO_COMPUTER_LABEL);
	});
	it("does not expose another account's saved label (negative control)", () => {
		expect(
			computerEntry({ ...base, saved: [saved], radientAccount: "account-b" })
				.accessibilityLabel,
		).not.toContain("QA Laptop");
	});
	it("names an own-address route Home relay, not the host, even before first live", () => {
		const route = {
			mode: "custom" as const,
			baseUrl: "https://relay.example.com",
			allowInsecure: false,
		};
		const entry = {
			id: "home",
			transport: "custom" as const,
			baseUrl: route.baseUrl,
			allowInsecure: false,
			name: "Home relay",
			addedAt: 1,
			lastUsedAt: 1,
			hidden: false,
			identity: null,
		};
		for (const phase of ["live", "minting", "refused"] as const)
			expect(
				computerEntry({
					...base,
					route,
					phase,
					tunnelId: null,
					saved: [entry],
				}),
			).toMatchObject({ kind: "computer", name: "Home relay" });
	});
	it("matches a saved address by the sheet's rule, trailing slash or not", () => {
		/* Review round 2, m5: during a connect the chip painted the raw address for a
		 * route saved as `https://host/`, because this module compared addresses
		 * exactly while `switcherSections` — and so the sheet's row — used
		 * `sameAddress`. One address rule, one place; this is the regression. */
		const route = (baseUrl: string) => ({
			mode: "custom" as const,
			baseUrl,
			allowInsecure: false,
		});
		const entry = {
			id: "home",
			transport: "custom" as const,
			baseUrl: "https://relay.example.com",
			allowInsecure: false,
			name: "Home relay",
			addedAt: 1,
			lastUsedAt: 1,
			hidden: false,
			identity: null,
		};
		for (const baseUrl of [
			"https://relay.example.com/",
			"https://relay.example.com//",
			"  https://relay.example.com  ",
		])
			expect(
				computerEntry({
					...base,
					route: route(baseUrl),
					phase: "minting",
					tunnelId: null,
					saved: [entry],
				}),
				baseUrl,
			).toMatchObject({ kind: "computer", name: "Home relay" });
	});
	it("never gives no computer a health word or glyph", () => {
		const entry = computerEntry({ ...base, route: null, tunnelId: null });
		expect(entry.kind).toBe("none");
		expect(entry).not.toHaveProperty("health");
		expect(entry.accessibilityLabel).not.toMatch(HEALTH_WORDS);
	});
	it("distinguishes every status by shape, not just its colour", () => {
		/* The mark set moved to an alias-free module so the frame audit's own test can
		 * import the REAL marks (QA round 2, Q6). Two forms carry a status here: a
		 * glyph the shipped Figtree subset covers, or paths drawn in the 12-unit
		 * viewBox for the three codepoints it does not (↪ ↪ … see
		 * `entry-health-marks.ts`). Both are distinct SHAPES, which is what U-03 asks
		 * for — so the assertion covers whichever form each kind takes. */
		const carriers = Object.values(ENTRY_HEALTH_MARK).map((mark) =>
			mark.form === "text" ? mark.glyph : mark.paths.join(" "),
		);
		expect(new Set(carriers).size).toBe(carriers.length);
		expect(
			carriers.every(
				(carrier) =>
					carrier.trim().length > 0 && !COLOUR_ONLY_DOTS.test(carrier),
			),
		).toBe(true);
	});
	it("covers every health kind the switcher can report", () => {
		/* The marks module cannot import the switcher's type and stay alias-free, so
		 * the two lists are tied HERE: a new kind in `computer-switcher-view.ts` fails
		 * this line until it has a mark. */
		const kinds: EntryHealthKind[] = [
			"online",
			"asleep",
			"refused",
			"sign-in",
			"paused",
			"checking",
		];
		expect(Object.keys(ENTRY_HEALTH_MARK).sort()).toEqual([...kinds].sort());
	});
});

it("does not choose the first unsaved discovery row when both saved ids are null", () => {
	expect(
		computerEntry({
			computers: [mac()],
			route: radientRoute,
			tunnelId: null,
			computerId: null,
			phase: "discovering",
			surface: null,
		}),
	).toMatchObject({ kind: "none" });
});
