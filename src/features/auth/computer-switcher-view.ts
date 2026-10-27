import type { DiscoveredComputer } from "@/connection";
import type { SavedComputer } from "@/connection/saved-computers";
import type { ConnectionPhase } from "@/state/connection-store";

/**
 * What the computer switcher shows and what a tap on one of its rows does,
 * decided from state alone (docs: ux-flows F5).
 *
 * Why the switcher exists: the operator asked for an easy way to move between
 * every computer this phone knows, with Radient computers and own-address
 * (custom) computers as first-class equals. Before it, a custom computer was not
 * in any list — reaching it again meant re-typing it — and a Radient computer the
 * reader removed came back on the next refresh.
 *
 * A plain module for the same reason as `computers-view.ts`: the unit suite runs
 * in Node without a React Native host, so every decision that can be wrong —
 * which section a row lands in, what its health word says, the order, what a tap
 * starts — is asserted here and `computer-switcher-sheet.tsx` only paints it.
 *
 * Three rules the functions below keep, and why:
 *
 * - **Online means THIS phone's `/healthz` probe answered.** Never `status:
 *   active` from `/v1/tunnels`, which only says the cloud route is provisioned
 *   (`docs/relay/tunnel-edge.md` § 4): a phone learns a computer is down only by
 *   failing to reach it.
 * - **Identity is the registry's local id, never the address** (operator
 *   decision a-2a8b). A Radient row is matched to discovery by tunnel id, the
 *   key Radient issues; a custom row is the saved entry itself.
 * - **Only states that exist today.** "Waiting for approval" and "Not the same
 *   computer" need pairing, which is not built; the repository forbids describing
 *   a feature before it ships, so they have no member in `SwitcherHealth`.
 */

/** The probe's own answer for one origin, as the sheet holds it. */
export type ProbeState = "checking" | "answered" | "silent";

export type SwitcherHealth =
	| { kind: "online" }
	/** No answer from this phone's probe. `lastSeenAt` is the last time this phone
	 *  is known to have reached it (a live route, or a probe that answered), or
	 *  `null` when it never has — the word is then "Asleep" with no time. */
	| { kind: "asleep"; lastSeenAt: number | null }
	/** Radient refused the grant (the edge's or the control plane's 401). */
	| { kind: "sign-in" }
	/** Radient reports billing for this computer as not eligible. Only from an
	 *  explicit `false`: an absent field is unknown, never "paused". */
	| { kind: "paused" }
	| { kind: "checking" };

export type SwitcherTransport =
	| { kind: "radient"; tunnelId: string; hostname: string }
	| {
			kind: "custom";
			baseUrl: string;
			allowInsecure: boolean;
			/** The address's host, for the "Your address · host" tag. */
			host: string;
	  };

export type SwitcherRow = {
	/** Stable for the row's lifetime: the registry id when the computer is
	 *  saved, else `radient:<tunnelId>`. Never derived from an address. */
	key: string;
	/** The registry id, when the computer is saved on this phone. */
	savedId: string | null;
	name: string;
	transport: SwitcherTransport;
	/** The origin this phone probes for the health word. */
	origin: string;
	health: SwitcherHealth;
	/** The route in use reaches this computer. */
	active: boolean;
	/** A tap on this row is connecting to it right now. */
	connecting: boolean;
	/** The reader removed it from this phone; a tap brings it back. */
	hidden: boolean;
	/** Epoch ms; 0 for a computer this phone has never used. */
	lastUsedAt: number;
	/** The discovery record, when the account lists this computer. */
	discovered: DiscoveredComputer | null;
};

export type SwitcherSections = {
	/** "On this phone": every visible saved computer, of either transport. */
	onPhone: SwitcherRow[];
	/** "On your Radient account, not connected": listed by discovery and not
	 *  saved, or saved and removed (hidden) but still listed. */
	notConnected: SwitcherRow[];
};

export type SwitcherInput = {
	saved: readonly SavedComputer[];
	/** Discovery's last answer BEFORE the removed-set filter
	 *  (`discoveredComputers` in the store). */
	discovered: readonly DiscoveredComputer[];
	/** Probe answers, keyed by origin (`SwitcherRow.origin`). */
	probes: Readonly<Record<string, ProbeState>>;
	/** When this phone last saw each origin answer during this app run. */
	answeredAt?: Readonly<Record<string, number>>;
	route: { phase: ConnectionPhase; tunnelId: string | null };
	/** The registry id of the computer the live route reaches (store
	 *  `computerId`), or `null` before the provider has recorded it. */
	activeComputerId: string | null;
	/** The tunnel id of a pending Radient pick, or the registry id of a pending
	 *  custom reconnect — whichever row the reader tapped. */
	pendingKey: string | null;
	/** Radient refused this phone's grant: the `sign-in` refusal is up. */
	radientSignedOut: boolean;
};

const USABLE: readonly ConnectionPhase[] = ["live", "degraded", "re-minting"];

export function radientOrigin(hostname: string): string {
	return `https://${hostname}`;
}

function hostOf(baseUrl: string): string {
	try {
		return new URL(baseUrl).host || baseUrl;
	} catch {
		return baseUrl;
	}
}

/** The health word's decision, in precedence order. A Radient refusal and a
 *  billing pause come first because no probe answer can make those computers
 *  usable; "Online" only ever comes from the probe. */
export function switcherHealth(input: {
	transport: SwitcherTransport["kind"];
	probe: ProbeState | undefined;
	radientSignedOut: boolean;
	billingEligible: boolean | null;
	lastSeenAt: number | null;
}): SwitcherHealth {
	if (input.transport === "radient" && input.radientSignedOut)
		return { kind: "sign-in" };
	if (input.transport === "radient" && input.billingEligible === false)
		return { kind: "paused" };
	if (input.probe === "answered") return { kind: "online" };
	if (input.probe === "silent")
		return { kind: "asleep", lastSeenAt: input.lastSeenAt };
	return { kind: "checking" };
}

/** "2 h ago", for "Asleep · 2 h ago". Rounded coarse on purpose: a last-seen
 *  time is a hint, not a timestamp. */
export function relativeAgo(then: number, now: number): string {
	const minutes = Math.round((now - then) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return `${Math.round(hours / 24)} d ago`;
}

/** The health word a row shows. Never colour alone: the dot beside it is
 *  decoration and this is the content. */
export function healthLabel(health: SwitcherHealth, now: number): string {
	switch (health.kind) {
		case "online":
			return "Online";
		case "asleep":
			return health.lastSeenAt === null
				? "Asleep"
				: `Asleep · ${relativeAgo(health.lastSeenAt, now)}`;
		case "sign-in":
			return "Sign in again";
		case "paused":
			return "Paused";
		case "checking":
			return "Checking…";
	}
}

function latest(...values: Array<number | null | undefined>): number | null {
	const known = values.filter(
		(value): value is number => typeof value === "number" && value > 0,
	);
	return known.length === 0 ? null : Math.max(...known);
}

/**
 * Sorts every computer into the two sections.
 *
 * - A visible saved computer is "On this phone", Radient or custom alike —
 *   including a Radient one discovery has not listed (yet, or any more): the
 *   phone used it, and only a tap can tell whether it still answers.
 * - A hidden saved Radient computer the account still lists drops to "not
 *   connected" instead of vanishing (audit §e: Remove used to come back as if
 *   still in use). Hidden and not listed: nowhere, because nothing could connect.
 * - A discovered computer not saved is "not connected". One without the Local
 *   Operator harness is left out: there is nothing on it this app can switch to.
 */
export function switcherSections(input: SwitcherInput): SwitcherSections {
	const byTunnel = new Map(
		input.discovered.map((computer) => [computer.tunnelId, computer]),
	);
	const savedTunnels = new Set<string>();
	const phaseUsable = USABLE.includes(input.route.phase);
	const onPhone: SwitcherRow[] = [];
	const notConnected: SwitcherRow[] = [];

	for (const entry of input.saved) {
		if (entry.transport === "radient") {
			savedTunnels.add(entry.tunnelId);
			const discovered = byTunnel.get(entry.tunnelId) ?? null;
			if (entry.hidden && !discovered) continue;
			/* Discovery's hostname wins when it has one: Radient may re-issue the
			 *  origin, and the tunnel id is what makes it the same computer. */
			const hostname = discovered?.hostname ?? entry.hostname;
			const origin = radientOrigin(hostname);
			const row: SwitcherRow = {
				key: entry.id,
				savedId: entry.id,
				name: entry.name,
				transport: { kind: "radient", tunnelId: entry.tunnelId, hostname },
				origin,
				health: switcherHealth({
					transport: "radient",
					probe: input.probes[origin],
					radientSignedOut: input.radientSignedOut,
					billingEligible: discovered?.billing.eligible ?? null,
					lastSeenAt: latest(entry.lastUsedAt, input.answeredAt?.[origin]),
				}),
				active: phaseUsable && input.route.tunnelId === entry.tunnelId,
				connecting:
					input.pendingKey === entry.tunnelId &&
					!phaseUsable &&
					input.route.tunnelId === entry.tunnelId,
				hidden: entry.hidden,
				lastUsedAt: entry.lastUsedAt,
				discovered,
			};
			(entry.hidden ? notConnected : onPhone).push(row);
			continue;
		}
		/* A hidden custom computer has no way back in this slice (nothing hides
		 *  one yet) and no account to list it, so it stays out of both sections. */
		if (entry.hidden) continue;
		const origin = entry.baseUrl;
		onPhone.push({
			key: entry.id,
			savedId: entry.id,
			name: entry.name,
			transport: {
				kind: "custom",
				baseUrl: entry.baseUrl,
				allowInsecure: entry.allowInsecure,
				host: hostOf(entry.baseUrl),
			},
			origin,
			health: switcherHealth({
				transport: "custom",
				probe: input.probes[origin],
				radientSignedOut: input.radientSignedOut,
				billingEligible: null,
				lastSeenAt: latest(entry.lastUsedAt, input.answeredAt?.[origin]),
			}),
			active: phaseUsable && input.activeComputerId === entry.id,
			connecting:
				input.pendingKey === entry.id &&
				input.route.phase === "minting" &&
				input.route.tunnelId === null,
			hidden: false,
			lastUsedAt: entry.lastUsedAt,
			discovered: null,
		});
	}

	for (const computer of input.discovered) {
		if (savedTunnels.has(computer.tunnelId)) continue;
		if (!computer.supportsLocalOperator) continue;
		const origin = radientOrigin(computer.hostname);
		notConnected.push({
			key: `radient:${computer.tunnelId}`,
			savedId: null,
			name: computer.name,
			transport: {
				kind: "radient",
				tunnelId: computer.tunnelId,
				hostname: computer.hostname,
			},
			origin,
			health: switcherHealth({
				transport: "radient",
				probe: input.probes[origin],
				radientSignedOut: input.radientSignedOut,
				billingEligible: computer.billing.eligible,
				lastSeenAt: latest(input.answeredAt?.[origin]),
			}),
			active: phaseUsable && input.route.tunnelId === computer.tunnelId,
			connecting:
				input.pendingKey === computer.tunnelId &&
				!phaseUsable &&
				input.route.tunnelId === computer.tunnelId,
			hidden: false,
			lastUsedAt: 0,
			discovered: computer,
		});
	}

	return { onPhone: sortRows(onPhone), notConnected: sortRows(notConnected) };
}

/** Active first, then online, then most recently used; the name breaks a tie so
 *  two never-used computers do not swap between renders. */
export function sortRows(rows: readonly SwitcherRow[]): SwitcherRow[] {
	return [...rows].sort(
		(a, b) =>
			Number(b.active) - Number(a.active) ||
			Number(b.health.kind === "online") - Number(a.health.kind === "online") ||
			b.lastUsedAt - a.lastUsedAt ||
			a.name.localeCompare(b.name),
	);
}

/**
 * Holds the order the sheet opened with. Probes answer one by one while the sheet
 * is up, and re-sorting on each answer would move a row from under the finger
 * about to tap it — so the order is frozen at open (`frozen`, the keys in the
 * order first shown) and only rows that did not exist then are placed, after the
 * frozen ones, by the normal rule. Call with `frozen = null` to take a fresh order.
 */
export function stableSections(
	sections: SwitcherSections,
	frozen: readonly string[] | null,
): { sections: SwitcherSections; order: string[] } {
	if (frozen === null) {
		return {
			sections,
			order: [...sections.onPhone, ...sections.notConnected].map((r) => r.key),
		};
	}
	const rank = new Map(frozen.map((key, index) => [key, index]));
	const hold = (rows: SwitcherRow[]): SwitcherRow[] => {
		const known = rows
			.filter((row) => rank.has(row.key))
			.sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
		const fresh = rows.filter((row) => !rank.has(row.key));
		return [...known, ...fresh];
	};
	const held = {
		onPhone: hold(sections.onPhone),
		notConnected: hold(sections.notConnected),
	};
	const order = [...frozen];
	for (const row of [...held.onPhone, ...held.notConnected])
		if (!rank.has(row.key)) order.push(row.key);
	return { sections: held, order };
}

/** What the phone holds for the single custom password slot (`lop.mobile.custom`).
 *  Only one exists until per-phone keys arrive with pairing. */
export type CustomSlot = {
	baseUrl: string;
	password: string | null;
	allowInsecure: boolean;
} | null;

export type SwitcherTap =
	/** Already in use: the sheet just closes. */
	| { kind: "close" }
	| { kind: "sign-in" }
	/** Billing is paused: the fix is in the Radient console, not here. */
	| { kind: "open-console" }
	| {
			kind: "select-radient";
			computer: DiscoveredComputer;
			/** Set when the computer was removed: brought back before connecting. */
			unhide: { savedId: string | null; tunnelId: string } | null;
	  }
	| {
			kind: "connect-custom";
			input: {
				url: string;
				password: string;
				allowInsecure: boolean;
				computerId: string;
			};
	  }
	/** No password stored for this address: the own-address entry, pre-filled. */
	| { kind: "enter-password"; url: string; allowInsecure: boolean };

const TRAILING_SLASHES = /\/+$/;
const sameAddress = (a: string, b: string) =>
	a.trim().replace(TRAILING_SLASHES, "") ===
	b.trim().replace(TRAILING_SLASHES, "");

/**
 * What a tap starts. A custom row reconnects through the SAME `connectCustom` path
 * the own-address screen uses, with the password read from the one slot when that
 * slot belongs to this row's address — the slot is the only password store today,
 * and inventing per-computer passwords would put a secret in the registry, which
 * holds metadata only. Any other custom row opens the own-address entry with its
 * address filled in.
 */
export function switcherTap(row: SwitcherRow, slot: CustomSlot): SwitcherTap {
	if (row.active) return { kind: "close" };
	if (row.health.kind === "sign-in") return { kind: "sign-in" };
	if (row.health.kind === "paused") return { kind: "open-console" };
	if (row.transport.kind === "custom") {
		const transport = row.transport;
		if (
			row.savedId !== null &&
			slot !== null &&
			slot.password !== null &&
			sameAddress(slot.baseUrl, transport.baseUrl)
		)
			return {
				kind: "connect-custom",
				input: {
					url: transport.baseUrl,
					password: slot.password,
					allowInsecure: transport.allowInsecure,
					computerId: row.savedId,
				},
			};
		return {
			kind: "enter-password",
			url: transport.baseUrl,
			allowInsecure: transport.allowInsecure,
		};
	}
	return {
		kind: "select-radient",
		computer: row.discovered ?? radientStandIn(row),
		unhide: row.hidden
			? { savedId: row.savedId, tunnelId: row.transport.tunnelId }
			: null,
	};
}

/** The pending key a tap sets: a Radient pick is tracked by tunnel id (the store's
 *  `tunnelId` is how its route names it), a custom reconnect by registry id. Taps
 *  that start no route set none. */
export function pendingKeyFor(tap: SwitcherTap): string | null {
	if (tap.kind === "select-radient") return tap.computer.tunnelId;
	if (tap.kind === "connect-custom") return tap.input.computerId;
	return null;
}

/** Whether the computer the reader tapped is now the one in use, so the sheet can
 *  close. Matched the way `pendingKeyFor` keyed it, because a Radient row's key
 *  changes when the live route saves it (`radient:<id>` → a registry id). */
export function pendingLanded(
	sections: SwitcherSections,
	pendingKey: string | null,
): boolean {
	if (pendingKey === null) return false;
	return [...sections.onPhone, ...sections.notConnected].some(
		(row) =>
			row.active &&
			(row.transport.kind === "radient"
				? row.transport.tunnelId === pendingKey
				: row.savedId === pendingKey),
	);
}

/** A saved Radient computer discovery has not listed this run. A pick needs only
 *  the tunnel id and hostname (the mint and the route are built from those), so
 *  the rest is the honest "unknown" rather than a guess. */
function radientStandIn(row: SwitcherRow): DiscoveredComputer {
	const transport = row.transport as Extract<
		SwitcherTransport,
		{ kind: "radient" }
	>;
	return {
		tunnelId: transport.tunnelId,
		name: row.name,
		deviceId: "",
		hostname: transport.hostname,
		status: "unknown",
		rawStatus: "",
		supportsLocalOperator: true,
		billing: { eligible: null, message: null },
		updatedAt: 0,
	};
}

/** The connection calls a tap may make, injected so a test drives the real
 *  provider through the same function the sheet calls. */
export type SwitcherDeps = {
	selectComputer: (computer: DiscoveredComputer) => Promise<void>;
	connectCustom: (input: {
		url: string;
		password: string;
		allowInsecure: boolean;
		computerId?: string;
	}) => Promise<void>;
	signInWithRadient: () => Promise<void>;
	unhide: (target: { savedId: string | null; tunnelId: string }) => void;
	enterPassword: (url: string, allowInsecure: boolean) => void;
	openConsole: () => void;
	close: () => void;
};

/** Carries a tap out. The un-hide goes first so the computer is back in every
 *  list before its route starts, and a pick that fails still leaves it visible. */
export async function performSwitcherTap(
	tap: SwitcherTap,
	deps: SwitcherDeps,
): Promise<void> {
	switch (tap.kind) {
		case "close":
			deps.close();
			return;
		case "sign-in":
			deps.close();
			await deps.signInWithRadient();
			return;
		case "open-console":
			deps.openConsole();
			return;
		case "enter-password":
			deps.close();
			deps.enterPassword(tap.url, tap.allowInsecure);
			return;
		case "select-radient":
			if (tap.unhide) deps.unhide(tap.unhide);
			await deps.selectComputer(tap.computer);
			return;
		case "connect-custom":
			await deps.connectCustom(tap.input);
			return;
	}
}
