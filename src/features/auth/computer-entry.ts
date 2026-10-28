import type { DiscoveredComputer, RouteProfile } from "@/connection";
import type { SwitcherHealth } from "@/features/auth/computer-switcher-view";
import { healthLabel } from "@/features/auth/computer-switcher-view";
import { COMPACT_BELL_SCALE } from "@/features/home/header-fit";
import { listLabel } from "@/lib/route-label";
import type { ErrorSurface } from "@/relay";
import type { ConnectionPhase } from "@/state/connection-store";

/**
 * What the switcher's two NAVIGATION entry points say about the computer in use:
 * the Home header chip (`● Mac mini ▾`) and the drawer footer's workspace row
 * (`● Mac mini · Online ⇅`). Both open the ONE sheet `ComputerSwitcherProvider`
 * mounts (ux-flows F5); neither has its own list.
 *
 * WHY TWO ENTRY POINTS. The operator asked for the switcher "at the bottom of the
 * navigation". This app is a Stack with a drawer and no tab bar, so the bottom of
 * its navigation IS the drawer footer — the row Slack puts its workspace on. The
 * header chip is the other half: the computer is the context for everything on
 * Home, so its name and health must be readable without opening anything, and a
 * drawer-only switcher would hide both. A tab bar was rejected in F5 (it costs the
 * composer's bottom edge for one destination), and so was switching inside a
 * session (a session belongs to one computer).
 *
 * A plain module, like `computer-switcher-view.ts`: the unit suite runs in Node,
 * so the copy and the health decision are asserted here and the components only
 * paint them. The health WORD is the switcher's own (`healthLabel`) so the chip,
 * the row and the sheet cannot call one state two things.
 */

/** The label when no computer is in use. One sentence for both "signed in, none
 *  picked" and "nothing set up": the control opens the same sheet either way, and
 *  the sheet's own "Add a computer" covers the empty case. */
export const NO_COMPUTER_LABEL = "Choose a computer";

/** What the control does, appended to its accessible name: the visible chevron
 *  says it to a sighted reader, this says it to a screen reader. Matches the
 *  sheet's title, so the name a reader hears is the place they land. */
export const SWITCH_COMPUTER_ACTION = "Switch computer";

/** The active computer's health, beyond the switcher's own probe words. A refused
 *  route the reader must fix (a password, an address, a removed tunnel) is not
 *  "Asleep" — the computer may be fine — so it gets its own honest word. */
export type EntryHealth = SwitcherHealth | { kind: "refused" };

export const REFUSED_WORD = "Can't connect";

/** The phases in which the route in use has answered this phone. The switcher's
 *  "Online" means its own `/healthz` probe answered; a live route is the same
 *  fact, observed by the requests the app already made. */
const ANSWERED: readonly ConnectionPhase[] = ["live", "re-minting"];

/** Refusals that mean "the computer did not answer", which the switcher calls
 *  Asleep; every other refusal is about the route, not the machine. */
const SILENT_SURFACES: readonly ErrorSurface[] = [
	"computer-offline",
	"relay-stopped",
	"retry",
];

export type ComputerEntryInput = {
	computers: readonly DiscoveredComputer[];
	tunnelId: string | null;
	route: RouteProfile | null;
	phase: ConnectionPhase;
	surface: ErrorSurface | null;
};

export type ComputerEntry =
	| { kind: "none"; label: string; accessibilityLabel: string }
	| {
			kind: "computer";
			name: string;
			health: EntryHealth;
			accessibilityLabel: string;
	  };

/** The active computer's health, from the route's state. `null` input never
 *  reaches here: no route, or a Radient account with nothing picked, is "none". */
export function activeHealth(input: {
	phase: ConnectionPhase;
	surface: ErrorSurface | null;
	billingEligible: boolean | null;
	radient: boolean;
}): EntryHealth {
	if (input.radient && input.surface === "sign-in") return { kind: "sign-in" };
	if (input.radient && input.billingEligible === false)
		return { kind: "paused" };
	if (ANSWERED.includes(input.phase)) return { kind: "online" };
	/* Degraded: live, but the relay stopped answering — the switcher's probe would
	 *  call that silence Asleep, so the entry points do too. */
	if (input.phase === "degraded") return { kind: "asleep", lastSeenAt: null };
	if (input.phase === "refused")
		return input.surface !== null && SILENT_SURFACES.includes(input.surface)
			? { kind: "asleep", lastSeenAt: null }
			: { kind: "refused" };
	return { kind: "checking" };
}

/** The health word an entry point shows and speaks. `now` only matters for an
 *  "Asleep · 2 h ago", which the entry points never carry (no last-seen time). */
export function entryHealthWord(health: EntryHealth, now = 0): string {
	return health.kind === "refused" ? REFUSED_WORD : healthLabel(health, now);
}

/** The dot's token role per health, the sheet's own mapping (`DOT_TOKEN` in
 *  `computer-switcher-sheet.tsx`) plus the refusal, which is a warning: the
 *  reader has something to fix. Not-failures get no alarm colour. */
export const ENTRY_DOT_TOKEN: Record<
	EntryHealth["kind"],
	"success" | "warning" | "ink-dim"
> = {
	online: "success",
	asleep: "ink-dim",
	"sign-in": "warning",
	paused: "warning",
	checking: "ink-dim",
	refused: "warning",
};

/** Decides what both entry points say. The name comes from `listLabel`, the one
 *  ladder every surface that names the computer reads, so the chip, the row and
 *  the avatar cannot disagree. */
export function computerEntry(input: ComputerEntryInput): ComputerEntry {
	const active =
		input.computers.find((computer) => computer.tunnelId === input.tunnelId) ??
		null;
	/* A computer is "in use" when the Radient route names one the account lists,
	 *  or when a custom route exists at all (its address IS the computer). */
	const inUse =
		active !== null ||
		input.route?.mode === "custom" ||
		(input.route?.mode === "radient" && input.tunnelId !== null);
	if (!inUse)
		return {
			kind: "none",
			label: NO_COMPUTER_LABEL,
			accessibilityLabel: `No computer chosen. ${NO_COMPUTER_LABEL}`,
		};
	const name = listLabel(input.computers, input.tunnelId, input.route);
	const health = activeHealth({
		phase: input.phase,
		surface: input.surface,
		billingEligible: active?.billing.eligible ?? null,
		radient: input.route?.mode === "radient",
	});
	return {
		kind: "computer",
		name,
		health,
		/* "Computer: Mac mini, Online. Switch computer" — the word the dot stands
		 *  for is always in the name, never colour alone (U-03). */
		accessibilityLabel: `Computer: ${name}, ${entryHealthWord(health)}. ${SWITCH_COMPUTER_ACTION}`,
	};
}

/**
 * Whether the header chip paints its chevron at this text scale.
 *
 * WHAT YIELDS FIRST, decided at the type step for the reason `header-fit.ts`
 * records (a measured placement flashes for a frame on native). At 320 pt and
 * 200 % the header holds the chip, the bell and Settings; the chip is the one
 * that shrinks, and D24 was it squeezed to 36 pt painting "…1". The bell's pill
 * already yields at this step. The chip's chevron goes at the same step: it is a
 * decoration whose meaning ("this opens a picker") the button's accessible name
 * still carries, and its ~20 pt (glyph + gap) is better spent on the NAME, which
 * is the one thing the chip exists to show. The health dot stays: it is the only
 * visible trace of health in the header.
 */
export const headerChipShowsChevron = (scale: number): boolean =>
	scale < COMPACT_BELL_SCALE;
