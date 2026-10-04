/**
 * The device-list vocabulary, carried verbatim from the core.
 *
 * `push_devices.STATE_DESCRIPTIONS` (local-operator, `mobile/push_devices.py`) is
 * "the product's own words for each state — the CLI's legend renders them and
 * the app's Settings will mirror them … two surfaces that spell the same state
 * two ways is the defect the single resolver exists to prevent". This module is
 * that mirror: the strings are copied, never re-worded, and the test beside it
 * pins each one against the core's own text so a drift is a failing test rather
 * than two screens disagreeing.
 *
 * `absent` is in the vocabulary but can never be a row's state (it IS the
 * absence of a row); it is kept because the same table is what a future "this
 * device is not registered" line renders from.
 *
 * An UNKNOWN state (a future core's fifth name) renders as itself — the machine
 * word — rather than being mapped to the nearest known one: guessing would put
 * this app's word in the machine's mouth.
 */

import type { PushDeviceRow } from "@/contracts";

/** Copied from `push_devices.STATE_DESCRIPTIONS` (core origin/main, 2026-10-04). */
export const PUSH_DEVICE_STATE_DESCRIPTIONS: Readonly<Record<string, string>> =
	{
		live: "registered, and push resumes on its next authenticated read",
		expired: "notifications are paused for this device until you sign in again",
		unpaired: "this computer is no longer paired",
		revoked: "this device was revoked on this computer",
		absent: "not in this computer's registry; it may register again",
	};

/** The reader-facing sentence for a row's state. */
export const deviceStateDescription = (state: string): string =>
	PUSH_DEVICE_STATE_DESCRIPTIONS[state] ?? state;

/** The row's title: its name when the machine recorded one, else the platform
 *  it is — never the device id, which names nothing a reader recognises. */
export const deviceTitle = (
	row: Pick<PushDeviceRow, "name" | "platform">,
): string => {
	const name = row.name?.trim();
	if (name !== undefined && name.length > 0) return name;
	return row.platform === "ios" ? "iPhone" : "Android device";
};
