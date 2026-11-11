import { loadNotifications } from "@/notifications/native";

/**
 * THE ONE WRITER of the app icon badge.
 *
 * Why a single owner. The icon badge is one number the OS keeps for the whole
 * app, and `setBadgeCountAsync` is last-writer-wins: two features that each set
 * "their" count would overwrite each other on every change, and the badge would
 * show whichever wrote last rather than anything true. So every feature that has
 * a count to contribute registers it here as a named SOURCE, and this module
 * writes the SUM. No other file may call `setBadgeCountAsync`
 * (`app-badge.test.ts` asserts that across `src/` and `app/`).
 *
 * Why the app owns it at all. Pushes never carry `aps.badge` (ADR 0006 §1.5 P3;
 * agent-server `bridge_push.go` sends none; `docs/team-bridge.md`): a count
 * derived from pushes received is wrong the moment one is missed or two arrive
 * for one conversation. The app sets it from an authoritative read instead.
 * The consequence, accepted: while the app is killed the badge is not updated
 * by an arriving push; it catches up on the next launch or foreground.
 *
 * Sources today, decided in the Team Bridge push-readiness PR:
 *  - `teamBridge` — the hub's account-wide unread total (`GET
 *    /messaging/unread?scope=account`), which already excludes muted
 *    conversations server-side. Fed by `src/team-bridge/badge.ts`.
 *  - Computer (relay) attention is NOT a source yet. ADR 0006 §1.4 defines its
 *    half — unread conversations on the connected computer, set on connect,
 *    foreground and ack, cleared on route removal — but that read/ack loop is
 *    not built on the app side and computer background alerts are not switched
 *    on, so adding it now would paint a number nothing keeps current. When it
 *    lands it adds a SECOND SOURCE here (summed), never a second writer.
 *
 * A source reports a count, or is cleared (sign-out, account switch). "Unknown"
 * is expressed by NOT calling: a failed read leaves the last number standing,
 * because a store that could not be read is not an empty one (ADR 0006 §1.4).
 */

export type BadgeSource = "teamBridge";

type Writer = (count: number) => Promise<unknown>;

const defaultWriter: Writer = async (count) => {
	const module = await loadNotifications();
	// Web and builds without the module have no icon badge; nothing to do.
	if (module === null) return;
	await module.setBadgeCountAsync(count);
};

let writer: Writer = defaultWriter;
const counts = new Map<BadgeSource, number>();
let written: number | null = null;
// Writes are chained so they reach the OS in the order they were decided; two
// overlapping async writes could otherwise land out of order and leave the
// older number on the icon.
let queue: Promise<void> = Promise.resolve();

const total = (): number => {
	let sum = 0;
	for (const value of counts.values()) sum += value;
	return sum;
};

function flush(force: boolean): Promise<void> {
	const next = total();
	if (!force && next === written) return queue;
	written = next;
	queue = queue
		.then(() => writer(next))
		.then(
			() => undefined,
			// Android launchers without badge support, or a permission the reader
			// withheld: the badge is decoration, never worth surfacing an error.
			() => undefined,
		);
	return queue;
}

/** Report a source's current count (negative and non-integer values are clamped). */
export function setBadgeSource(
	source: BadgeSource,
	count: number,
): Promise<void> {
	const clean = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
	counts.set(source, clean);
	return flush(false);
}

/** Drop a source's contribution: sign-out and account change. */
export function clearBadgeSource(source: BadgeSource): Promise<void> {
	counts.delete(source);
	return flush(false);
}

/**
 * Re-write the current total even if unchanged: on foreground, the OS (or a
 * previous install's state) may hold a number this process never wrote.
 */
export function reassertBadge(): Promise<void> {
	// Nothing decided yet in this process (cold start, read in flight): keep
	// whatever the icon shows rather than paint a 0 nobody read.
	if (written === null) return queue;
	return flush(true);
}

/** Test seam: swap the OS writer and reset all state. */
export function resetAppBadgeForTests(next?: Writer): void {
	writer = next ?? defaultWriter;
	counts.clear();
	written = null;
	queue = Promise.resolve();
}
