import { describe, expect, it, vi } from "vitest";
import type { DiscoveredComputer } from "@/connection";
import type {
	SavedCustomComputer,
	SavedRadientComputer,
} from "@/connection/saved-computers";
import {
	healthLabel,
	ownTunnelPrefill,
	pendingKeyFor,
	pendingLanded,
	performSwitcherTap,
	pickFailed,
	radientEntryBelongs,
	rowHint,
	type SwitcherDeps,
	type SwitcherInput,
	stableSections,
	switcherHealth,
	switcherSections,
	switcherTap,
} from "@/features/auth/computer-switcher-view";

/* Placeholder hosts only (AGENTS.md: never a real tunnel hostname). */
const HOST_A = "0123456789abcdef0123456789abcdef-lop.example.com";
const HOST_B = "fedcba9876543210fedcba9876543210-lop.example.com";
const HOST_C = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-lop.example.com";
const HOME = "https://home.example.com";
const PI = "http://pi.example.net";
const NOW = 1_800_000_000_000;
/* The pairing states' words: nothing may render them until pairing ships. */
const UNSHIPPED_WORDS = /approval|same computer/i;
const BRING_BACK = /bring it back/;

const discovered = (
	tunnelId: string,
	hostname: string,
	extra: Partial<DiscoveredComputer> = {},
): DiscoveredComputer => ({
	tunnelId,
	name: `Discovered ${tunnelId}`,
	deviceId: `device-${tunnelId}`,
	hostname,
	/* `ready` is the control plane's "active": provisioned, NOT online. Every
	 *  fixture carries it so a test proves Online never comes from it. */
	status: "ready",
	rawStatus: "active",
	supportsLocalOperator: true,
	billing: { eligible: true, message: null },
	updatedAt: NOW,
	...extra,
});

const radient = (
	id: string,
	tunnelId: string,
	hostname: string,
	extra: Partial<SavedRadientComputer> = {},
): SavedRadientComputer => ({
	id,
	transport: "radient",
	tunnelId,
	hostname,
	name: `Saved ${id}`,
	addedAt: NOW - 10_000_000,
	lastUsedAt: NOW - 1_000_000,
	hidden: false,
	identity: null,
	account: null,
	...extra,
});

const custom = (
	id: string,
	baseUrl: string,
	extra: Partial<SavedCustomComputer> = {},
): SavedCustomComputer => ({
	id,
	transport: "custom",
	baseUrl,
	allowInsecure: baseUrl.startsWith("http:"),
	name: new URL(baseUrl).host,
	addedAt: NOW - 10_000_000,
	lastUsedAt: NOW - 2_000_000,
	hidden: false,
	identity: null,
	...extra,
});

const input = (over: Partial<SwitcherInput> = {}): SwitcherInput => ({
	saved: [],
	discovered: [],
	probes: {},
	route: { phase: "signed-out", tunnelId: null },
	activeComputerId: null,
	pendingKey: null,
	radientSignedOut: false,
	...over,
});

const keys = (rows: { key: string }[]) => rows.map((row) => row.key);

describe("section assignment", () => {
	it("puts every visible saved computer, of either transport, on this phone", () => {
		const sections = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A), custom("c1", HOME)],
				discovered: [discovered("t1", HOST_A)],
			}),
		);
		expect(keys(sections.onPhone).sort()).toEqual(["c1", "r1"]);
		expect(sections.notConnected).toEqual([]);
	});

	it("lists a discovered computer this phone never used as not connected", () => {
		const sections = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A)],
				discovered: [discovered("t1", HOST_A), discovered("t2", HOST_B)],
			}),
		);
		expect(keys(sections.onPhone)).toEqual(["r1"]);
		expect(keys(sections.notConnected)).toEqual(["radient:t2"]);
		expect(sections.notConnected[0]?.savedId).toBeNull();
	});

	it("moves a removed (hidden) Radient computer down, instead of losing it", () => {
		const sections = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A, { hidden: true })],
				discovered: [discovered("t1", HOST_A)],
			}),
		);
		expect(sections.onPhone).toEqual([]);
		expect(keys(sections.notConnected)).toEqual(["r1"]);
		expect(sections.notConnected[0]?.hidden).toBe(true);
	});

	it("drops a hidden computer the account no longer lists (nothing to connect to)", () => {
		const sections = switcherSections(
			input({ saved: [radient("r1", "t1", HOST_A, { hidden: true })] }),
		);
		expect(sections.onPhone).toEqual([]);
		expect(sections.notConnected).toEqual([]);
	});

	it("keeps a saved Radient computer on this phone when discovery has not listed it", () => {
		const sections = switcherSections(
			input({ saved: [radient("r1", "t1", HOST_A)] }),
		);
		expect(keys(sections.onPhone)).toEqual(["r1"]);
	});

	it("leaves out a discovered computer without the Local Operator harness", () => {
		const sections = switcherSections(
			input({
				discovered: [
					discovered("t2", HOST_B, { supportsLocalOperator: false }),
				],
			}),
		);
		expect(sections.notConnected).toEqual([]);
	});

	it("never keys a row by its address (identity is the registry id)", () => {
		/* Two saved custom computers at ONE address stay two rows. */
		const sections = switcherSections(
			input({ saved: [custom("c1", HOME), custom("c2", HOME)] }),
		);
		expect(keys(sections.onPhone).sort()).toEqual(["c1", "c2"]);
		for (const row of sections.onPhone) expect(row.key).not.toContain(HOME);
	});
});

describe("mixed transports", () => {
	it("tags a Radient row as Radient and a custom row with its host", () => {
		const sections = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A), custom("c1", PI)],
				discovered: [discovered("t1", HOST_A)],
			}),
		);
		const byKey = Object.fromEntries(sections.onPhone.map((r) => [r.key, r]));
		expect(byKey.r1?.transport).toEqual({
			kind: "radient",
			tunnelId: "t1",
			hostname: HOST_A,
		});
		expect(byKey.c1?.transport).toEqual({
			kind: "custom",
			baseUrl: PI,
			allowInsecure: true,
			host: "pi.example.net",
		});
		/* Probed where each one actually lives. */
		expect(byKey.r1?.origin).toBe(`https://${HOST_A}`);
		expect(byKey.c1?.origin).toBe(PI);
	});

	it("marks the custom computer active by registry id, the Radient one by tunnel id", () => {
		const live = switcherSections(
			input({
				saved: [
					radient("r1", "t1", HOST_A),
					custom("c1", HOME),
					custom("c2", HOME),
				],
				route: { phase: "live", tunnelId: null },
				activeComputerId: "c2",
			}),
		);
		expect(live.onPhone.filter((r) => r.active).map((r) => r.key)).toEqual([
			"c2",
		]);
		const radientLive = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A), custom("c1", HOME)],
				route: { phase: "live", tunnelId: "t1" },
			}),
		);
		expect(
			radientLive.onPhone.filter((r) => r.active).map((r) => r.key),
		).toEqual(["r1"]);
	});
});

describe("health mapping", () => {
	it("says Online ONLY when this phone's /healthz probe answered", () => {
		const base = input({
			saved: [radient("r1", "t1", HOST_A)],
			/* status: ready ("active" from /v1/tunnels) on every fixture */
			discovered: [discovered("t1", HOST_A)],
		});
		expect(switcherSections(base).onPhone[0]?.health.kind).toBe("checking");
		expect(
			switcherSections({
				...base,
				probes: { [`https://${HOST_A}`]: "checking" },
			}).onPhone[0]?.health.kind,
		).toBe("checking");
		expect(
			switcherSections({
				...base,
				probes: { [`https://${HOST_A}`]: "silent" },
			}).onPhone[0]?.health.kind,
		).toBe("asleep");
		expect(
			switcherSections({
				...base,
				probes: { [`https://${HOST_A}`]: "answered" },
			}).onPhone[0]?.health.kind,
		).toBe("online");
	});

	it("says Asleep with the last time this phone saw it", () => {
		const sections = switcherSections(
			input({
				saved: [custom("c1", HOME, { lastUsedAt: NOW - 2 * 60 * 60_000 })],
				probes: { [HOME]: "silent" },
			}),
		);
		const health = sections.onPhone[0]?.health;
		expect(health).toEqual({
			kind: "asleep",
			lastSeenAt: NOW - 2 * 60 * 60_000,
		});
		if (!health) throw new Error("no row");
		expect(healthLabel(health, NOW)).toBe("Asleep · 2 h ago");
	});

	it("prefers an answer seen this run over the last use", () => {
		const sections = switcherSections(
			input({
				saved: [custom("c1", HOME, { lastUsedAt: NOW - 86_400_000 })],
				probes: { [HOME]: "silent" },
				answeredAt: { [HOME]: NOW - 5 * 60_000 },
			}),
		);
		const health = sections.onPhone[0]?.health;
		if (!health) throw new Error("no row");
		expect(healthLabel(health, NOW)).toBe("Asleep · 5 min ago");
	});

	it("says Asleep with no time for a computer never seen", () => {
		expect(
			healthLabel(
				switcherHealth({
					transport: "radient",
					probe: "silent",
					radientSignedOut: false,
					billingEligible: null,
					lastSeenAt: null,
				}),
				NOW,
			),
		).toBe("Asleep");
	});

	it("says Sign in again for Radient rows after a Radient 401, never for custom ones", () => {
		const sections = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A), custom("c1", HOME)],
				probes: { [`https://${HOST_A}`]: "answered", [HOME]: "answered" },
				radientSignedOut: true,
			}),
		);
		const byKey = Object.fromEntries(sections.onPhone.map((r) => [r.key, r]));
		expect(byKey.r1?.health.kind).toBe("sign-in");
		expect(byKey.c1?.health.kind).toBe("online");
	});

	it("says Paused only when discovery says billing is NOT eligible", () => {
		const paused = switcherSections(
			input({
				discovered: [
					discovered("t2", HOST_B, {
						billing: { eligible: false, message: null },
					}),
					discovered("t3", HOST_C, {
						billing: { eligible: null, message: null },
					}),
				],
			}),
		);
		const byKey = Object.fromEntries(
			paused.notConnected.map((r) => [r.key, r.health.kind]),
		);
		expect(byKey["radient:t2"]).toBe("paused");
		/* Absent billing is unknown, never "paused". */
		expect(byKey["radient:t3"]).toBe("checking");
	});

	it("has no word for states that need pairing (not built yet)", () => {
		const words = (["online", "sign-in", "paused", "checking"] as const).map(
			(kind) => healthLabel({ kind }, NOW),
		);
		words.push(healthLabel({ kind: "asleep", lastSeenAt: null }, NOW));
		for (const word of words) {
			expect(word).not.toMatch(UNSHIPPED_WORDS);
		}
	});
});

describe("sort and stability while open", () => {
	it("sorts active first, then online, then by last use", () => {
		const sections = switcherSections(
			input({
				saved: [
					custom("old", HOME, { lastUsedAt: NOW - 9_000_000 }),
					custom("recent", PI, { lastUsedAt: NOW - 1_000 }),
					radient("online", "t2", HOST_B, { lastUsedAt: NOW - 8_000_000 }),
					radient("active", "t1", HOST_A, { lastUsedAt: NOW - 7_000_000 }),
				],
				probes: { [`https://${HOST_B}`]: "answered" },
				route: { phase: "live", tunnelId: "t1" },
			}),
		);
		expect(keys(sections.onPhone)).toEqual([
			"active",
			"online",
			"recent",
			"old",
		]);
	});

	it("does not reorder rows when a probe answers while the sheet is open", () => {
		const saved = [
			custom("first", HOME, { lastUsedAt: NOW - 1_000 }),
			custom("second", PI, { lastUsedAt: NOW - 5_000 }),
		];
		const opened = stableSections(switcherSections(input({ saved })), null);
		expect(keys(opened.sections.onPhone)).toEqual(["first", "second"]);
		/* `second` answers: by the sort rule it would now jump above `first`. */
		const answered = switcherSections(
			input({ saved, probes: { [PI]: "answered", [HOME]: "silent" } }),
		);
		expect(keys(answered.onPhone)).toEqual(["second", "first"]);
		const held = stableSections(answered, opened.order);
		expect(keys(held.sections.onPhone)).toEqual(["first", "second"]);
		/* ...and the health word still changed: only the ORDER is held. */
		expect(held.sections.onPhone[1]?.health.kind).toBe("online");
	});

	it("places a row that appears while open after the held ones", () => {
		const opened = stableSections(
			switcherSections(input({ saved: [custom("c1", HOME)] })),
			null,
		);
		const later = switcherSections(
			input({
				saved: [custom("c1", HOME), custom("c0", PI, { lastUsedAt: NOW })],
			}),
		);
		expect(keys(stableSections(later, opened.order).sections.onPhone)).toEqual([
			"c1",
			"c0",
		]);
	});
});

describe("what a tap does", () => {
	const slot = { baseUrl: HOME, password: "test-only", allowInsecure: false };

	it("reconnects a custom row through connectCustom, by registry id, with the slot's password", () => {
		const row = switcherSections(input({ saved: [custom("c1", `${HOME}/`)] }))
			.onPhone[0];
		if (!row) throw new Error("no row");
		expect(switcherTap(row, slot)).toEqual({
			kind: "connect-custom",
			input: {
				url: `${HOME}/`,
				password: "test-only",
				allowInsecure: false,
				computerId: "c1",
			},
		});
	});

	it("opens the own-address entry by registry id when the one slot is another address", () => {
		const row = switcherSections(input({ saved: [custom("c2", PI)] }))
			.onPhone[0];
		if (!row) throw new Error("no row");
		/* The id ONLY (review round 1, m1): the screen reads the address and the
		 *  plain-http opt-in from the registry, never from link parameters. */
		expect(switcherTap(row, slot)).toEqual({
			kind: "enter-password",
			computerId: "c2",
		});
		/* ...and when the slot holds no password at all. */
		const home = switcherSections(input({ saved: [custom("c1", HOME)] }))
			.onPhone[0];
		if (!home) throw new Error("no row");
		expect(switcherTap(home, { ...slot, password: null }).kind).toBe(
			"enter-password",
		);
	});

	it("un-hides a removed computer before connecting to it", () => {
		const row = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A, { hidden: true })],
				discovered: [discovered("t1", HOST_A)],
			}),
		).notConnected[0];
		if (!row) throw new Error("no row");
		const tap = switcherTap(row, null);
		expect(tap).toMatchObject({
			kind: "select-radient",
			unhide: { savedId: "r1", tunnelId: "t1" },
		});
		expect(pendingKeyFor(tap)).toBe("t1");
	});

	it("closes on the row already in use, and sends Sign in again to sign-in", () => {
		const sections = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A)],
				route: { phase: "live", tunnelId: "t1" },
			}),
		);
		const row = sections.onPhone[0];
		if (!row) throw new Error("no row");
		expect(switcherTap(row, null)).toEqual({ kind: "close" });
		expect(pendingLanded(sections, "t1")).toBe(true);
		const signedOut = switcherSections(
			input({ saved: [radient("r1", "t1", HOST_A)], radientSignedOut: true }),
		).onPhone[0];
		if (!signedOut) throw new Error("no row");
		expect(switcherTap(signedOut, null)).toEqual({ kind: "sign-in" });
	});

	it("performs a custom tap as one connectCustom call and nothing else", async () => {
		const deps: SwitcherDeps = {
			selectComputer: vi.fn(async () => {}),
			connectCustom: vi.fn(async () => {}),
			signInWithRadient: vi.fn(async () => {}),
			unhide: vi.fn(),
			enterPassword: vi.fn(),
			openConsole: vi.fn(),
			close: vi.fn(),
		};
		const row = switcherSections(input({ saved: [custom("c1", HOME)] }))
			.onPhone[0];
		if (!row) throw new Error("no row");
		await performSwitcherTap(switcherTap(row, slot), deps);
		expect(deps.connectCustom).toHaveBeenCalledWith({
			url: HOME,
			password: "test-only",
			allowInsecure: false,
			computerId: "c1",
		});
		expect(deps.selectComputer).not.toHaveBeenCalled();
		expect(deps.enterPassword).not.toHaveBeenCalled();
	});
});

/* ------------------------------------------------- PR #122 round-1 remediation */

describe("a failed Radient pick (review M1, UX U2)", () => {
	const picked = (phase: SwitcherInput["route"]["phase"]) =>
		switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A)],
				route: { phase, tunnelId: "t1" },
				pendingKey: "t1",
				radientSignedOut: phase === "signed-out",
			}),
		).onPhone[0];

	it("is connecting only while it mints", () => {
		expect(picked("minting")?.connecting).toBe(true);
		/* Each of these held the spinner and the disabled row on c0d07c7. */
		expect(picked("refused")?.connecting).toBe(false);
		expect(picked("signed-out")?.connecting).toBe(false);
		expect(picked("degraded")?.connecting).toBe(false);
	});

	it("leaves a signed-out row tappable into Sign in again", () => {
		const row = picked("signed-out");
		if (!row) throw new Error("no row");
		expect(row.health.kind).toBe("sign-in");
		expect(switcherTap(row, null)).toEqual({ kind: "sign-in" });
	});

	it("is a failure the sheet closes on only once refused or signed out", () => {
		expect(pickFailed("refused")).toBe(true);
		expect(pickFailed("signed-out")).toBe(true);
		for (const phase of ["minting", "live", "degraded", "re-minting"] as const)
			expect(pickFailed(phase)).toBe(false);
	});
});

describe("saved Radient computers are scoped to their account (review M2)", () => {
	const saved = [
		radient("a1", "ta", HOST_A, { account: "acct-A" }),
		radient("b1", "tb", HOST_B, { account: "acct-B" }),
		radient("u1", "tu", HOST_C, { account: null }),
	];
	const onPhone = (over: Partial<SwitcherInput>) =>
		keys(switcherSections(input({ saved, ...over })).onPhone);

	it("lists only the signed-in account's computers, never another account's", () => {
		expect(onPhone({ radientAccount: "acct-B" })).toEqual(["b1"]);
		expect(onPhone({ radientAccount: "acct-A" })).toEqual(["a1"]);
	});

	it("lists an unstamped (pre-key) entry only when this account's discovery lists it", () => {
		expect(onPhone({ radientAccount: "acct-B" })).not.toContain("u1");
		expect(
			onPhone({
				radientAccount: "acct-B",
				discovered: [discovered("tu", HOST_C)],
			}),
		).toContain("u1");
	});

	it("trusts discovery over a stale stamp: Radient says the tunnel is this account's", () => {
		expect(
			onPhone({
				radientAccount: "acct-B",
				discovered: [discovered("ta", HOST_A)],
			}),
		).toContain("a1");
	});

	it("lists them all when no account is known: nobody else's to leak to, and Sign in again lives there", () => {
		expect(onPhone({ radientAccount: null }).sort()).toEqual(
			["a1", "b1", "u1"].sort(),
		);
		expect(radientEntryBelongs({ account: "x" }, null, false)).toBe(true);
	});

	it("never filters an own-address computer by account", () => {
		expect(
			keys(
				switcherSections(
					input({ saved: [custom("c1", HOME)], radientAccount: "acct-B" }),
				).onPhone,
			),
		).toEqual(["c1"]);
	});
});

describe("a removed computer that is in use (QA Q4)", () => {
	it("is brought back by the tap its row promises", async () => {
		const row = switcherSections(
			input({
				saved: [radient("r1", "t1", HOST_A, { hidden: true })],
				discovered: [discovered("t1", HOST_A)],
				route: { phase: "live", tunnelId: "t1" },
			}),
		).notConnected[0];
		if (!row) throw new Error("no row");
		expect(row.active && row.hidden).toBe(true);
		expect(rowHint(row, "not-connected")).toMatch(BRING_BACK);
		const tap = switcherTap(row, null);
		expect(tap).toEqual({
			kind: "unhide",
			target: { savedId: "r1", tunnelId: "t1" },
		});
		const deps: SwitcherDeps = {
			selectComputer: vi.fn(async () => {}),
			connectCustom: vi.fn(async () => {}),
			signInWithRadient: vi.fn(async () => {}),
			unhide: vi.fn(),
			enterPassword: vi.fn(),
			openConsole: vi.fn(),
			close: vi.fn(),
		};
		await performSwitcherTap(tap, deps);
		expect(deps.unhide).toHaveBeenCalledWith({ savedId: "r1", tunnelId: "t1" });
		expect(deps.close).toHaveBeenCalled();
		/* Already live: no second route. */
		expect(deps.selectComputer).not.toHaveBeenCalled();
	});
});

describe("the line under a row says what its tap does (design D3/D7, UX U7)", () => {
	const row = (over: Partial<SwitcherInput>) =>
		switcherSections(input(over)).notConnected[0];

	it("says Add credit on a paused computer, whose tap opens the console", () => {
		const paused = row({
			discovered: [
				discovered("t1", HOST_A, {
					billing: { eligible: false, message: null },
				}),
			],
		});
		if (!paused) throw new Error("no row");
		expect(switcherTap(paused, null)).toEqual({ kind: "open-console" });
		expect(rowHint(paused, "not-connected")).toBe("Add credit in Radient");
	});

	it("says nothing under Connecting…", () => {
		const connecting = row({
			discovered: [discovered("t1", HOST_A)],
			route: { phase: "minting", tunnelId: "t1" },
			pendingKey: "t1",
		});
		if (!connecting) throw new Error("no row");
		expect(connecting.connecting).toBe(true);
		expect(rowHint(connecting, "not-connected")).toBeNull();
	});

	it("says Tap to connect only on the account's not-connected rows", () => {
		const fresh = row({ discovered: [discovered("t1", HOST_A)] });
		if (!fresh) throw new Error("no row");
		expect(rowHint(fresh, "not-connected")).toBe("Tap to connect");
		const mine = switcherSections(input({ saved: [custom("c1", HOME)] }))
			.onPhone[0];
		if (!mine) throw new Error("no row");
		expect(rowHint(mine, "on-phone")).toBeNull();
	});
});

describe("the own-address hand-off reads the registry, not the link (review m1)", () => {
	const entries = [custom("c1", HOME), custom("c2", PI)];

	it("fills the address and opt-in from the entry the id names", () => {
		expect(ownTunnelPrefill(entries, "c2", null)).toEqual({
			computerId: "c2",
			name: "pi.example.net",
			url: PI,
			allowInsecure: true,
			password: "",
		});
	});

	it("offers the one slot's password only when the slot IS that address", () => {
		const slot = {
			baseUrl: `${HOME}/`,
			password: "test-only",
			allowInsecure: false,
		};
		expect(ownTunnelPrefill(entries, "c1", slot)?.password).toBe("test-only");
		expect(ownTunnelPrefill(entries, "c2", slot)?.password).toBe("");
	});

	it("ignores an unknown id or a Radient entry", () => {
		expect(ownTunnelPrefill(entries, "nope", null)).toBeNull();
		expect(
			ownTunnelPrefill([radient("r1", "t1", HOST_A)], "r1", null),
		).toBeNull();
	});
});
