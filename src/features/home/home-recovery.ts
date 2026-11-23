/**
 * Which recovery line (if any) Home's new-conversation screen shows above the
 * composer — the ONE decision `home.tsx` renders through `HomeRecovery`.
 *
 * WHY IT IS ITS OWN MODULE. The "Connecting to {host}…" spinner was decided
 * inline from the provider's `busy` / `coldStartSettled` flags alone, and those
 * flags do not mean "not connected yet". They mean "the attempt that opened the
 * route has not RETURNED". `goLive` publishes the route live (header chip ✓,
 * list and config streams running) and only THEN awaits startup-authorization
 * admission, which queues behind every other private-storage step on that
 * lifecycle's tail (keychain writes, the image-picker drain, a retirement's
 * cleanup). While that tail is held, `selectComputer` — and with it the cold
 * start's `openUsualComputer` — has not returned, so `busy` stays true and
 * `coldStartSettled` stays false while the reader is plainly connected:
 * TestFlight, 2026-11-18 08:47, a spinner under a green chip with the drawer
 * and the composer's model both populated, cleared only by relaunching.
 *
 * So "restoring" is now derived from the same live fact the header chip
 * reads (`connected` = a route whose phase is usable and whose client is
 * published): an in-flight attempt only shows the spinner while there is no
 * live route to show instead. This module adds no timer of its own: hiding the
 * spinner is not a licence for the wait behind it to be unbounded, and the
 * held steps are bounded at their source (the picker drain gives up after
 * `PICKER_DRAIN_BOUND_MS`, `picker-privacy.ts`), so admission still returns
 * and `busy` still clears on a live route. Every other branch keeps its original order: a refusal or an offline device
 * still outranks a quiet composer.
 */
import type { HomeRecoveryKind } from "./home-splash";

export function homeRecoveryKind(input: {
	/** The provider's `busy`: a connection attempt has not returned yet. */
	busy: boolean;
	/** The provider's `coldStartSettled`. */
	coldStartSettled: boolean;
	/** A route is selected, its phase is usable and its client is published —
	 *  what the header chip's check means. */
	connected: boolean;
	/** The device reports no network (`deviceOnline() === false`). */
	offline: boolean;
	/** The provider's current refusal, by kind only. */
	refusal: { kind: string } | null;
}): HomeRecoveryKind | null {
	const { busy, coldStartSettled, connected, offline, refusal } = input;
	if ((busy || !coldStartSettled) && !connected) return "restoring";
	if (refusal?.kind === "sign-in" || refusal?.kind === "account-mismatch")
		return "auth";
	if (offline) return "offline";
	if (refusal !== null) return "error";
	if (!connected) return "no-host";
	return null;
}
