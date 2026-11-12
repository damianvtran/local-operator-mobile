/**
 * What a return to the foreground re-reads, as pure decisions so they are
 * testable without React (`use-session.ts` and `connection-provider.tsx` call
 * these; the tests pin them).
 *
 * WHY. Before this, every return fired the stream reopen AND, in parallel, the
 * newest history page plus `/api/commands` and `/api/models`. The newest page is
 * the same rows the stream's seed frame carries (the relay's no-cursor history
 * read is "the rendered newest page"), so on an ordinary return the tail was
 * downloaded twice, and the two catalogues almost never change while a phone is
 * in a pocket. The resume cost 8–10 requests where three or four do the work
 * (design: warm resume, §1.3).
 *
 * The invariants each decision names are checked in `resume-plan.test.ts` and
 * `history-window.test.ts`.
 */

import { heldTimer, type ResumeClock } from "./resume-hold";

/**
 * Whether the first frame after a return needs the newest durable page read
 * behind it.
 *
 * INVARIANT: a live frame is the newest CONTIGUOUS tail of the conversation
 * (plus, when capped, a pinned opener). If it contains the newest row the
 * reader already holds, every row newer than that one is in the frame, so the
 * held list plus the frame has no hole and the page read would fetch nothing
 * new. If it does not (more rows arrived than the frame carries, or nothing was
 * held), the read stays — it is what finds the hole the auto-heal then closes.
 * `HistoryWindow.overlapsHeld` computes `frameOverlapsHeld`.
 *
 * `gateOpen` is the resume gate (`resume-gate.ts`): a second `active` within
 * 1.5 s of the first is the same return and never reads twice.
 */
export function resumeHistoryRead(input: {
	gateOpen: boolean;
	frameOverlapsHeld: boolean;
}): boolean {
	return input.gateOpen && !input.frameOverlapsHeld;
}

/**
 * Whether a config frame should re-read the command and model catalogues.
 *
 * The relay's `changed_keys` are settings-registry keys
 * (`local_operator/config_watch.py`), and no single registry key provably owns
 * the catalogues (providers, credentials and skills all move them), so ANY
 * named change re-reads. The seed frame every (re)connect sends carries
 * `changed_keys: []` and never re-reads: it announces nothing that changed.
 * A return from the background therefore costs no catalogue request at all.
 */
export function catalogueRereadOnConfig(
	changedKeys: readonly string[],
): boolean {
	return changedKeys.length > 0;
}

/**
 * Whether a failed read is inside the resume window (`resume-hold.ts`), where
 * the radio or the route may still be waking: such a failure is held silent and
 * retried once at the window's end; only a retry that fails again surfaces.
 * Outside the window a failure is news and shows at once.
 */
export function insideResumeWindow(clock: ResumeClock): boolean {
	return clock.backgrounded() || clock.holdMs(0) > 0;
}

/**
 * The list/config stream's wake rule on a return to `active`, after the relay's
 * own web client (`docs/mobile.md` "Live streams over a tunnel"): reopen now when
 * the stream has been silent ≥ 20 s — past the daemon's phone-view grace, so the
 * socket the OS suspended is certainly gone — or is waiting out an error backoff,
 * instead of letting the backoff timer (up to 15 s) decide when the list
 * returns.
 */
export const STREAM_WAKE_SILENCE_MS = 20_000;
export function shouldWakeStream(input: {
	silentMs: number | null;
	inBackoff: boolean;
}): boolean {
	return (
		input.inBackoff ||
		input.silentMs === null ||
		input.silentMs >= STREAM_WAKE_SILENCE_MS
	);
}

/**
 * Runs a resume read with its failure HELD while the resume window is open
 * (the same pattern as the #232 drop grace): the radio or the route may still be
 * waking, so a first failure is expected, not news. `setHeld(true)` hides the
 * failure from the screen; at the window's end the read is retried ONCE, and
 * `setHeld(false)` then lets whatever that retry left — success or its own
 * error — show. Outside the window the read runs plainly and a failure shows at
 * once. Returns a cancel for unmount.
 */
export function holdResumeRead(input: {
	clock: ResumeClock;
	read: () => Promise<void>;
	retry: () => Promise<void>;
	failed: () => boolean;
	setHeld: (held: boolean) => void;
	hold?: (clock: ResumeClock, minMs: number, fire: () => void) => () => void;
}): () => void {
	const hold = input.hold ?? heldTimer;
	let cancelled = false;
	let cancelTimer: (() => void) | null = null;
	if (!insideResumeWindow(input.clock)) {
		void input.read();
		return () => undefined;
	}
	input.setHeld(true);
	void input.read().then(() => {
		if (cancelled) return;
		if (!input.failed()) {
			input.setHeld(false);
			return;
		}
		cancelTimer = hold(input.clock, 0, () => {
			cancelTimer = null;
			if (cancelled) return;
			void input.retry().finally(() => {
				if (!cancelled) input.setHeld(false);
			});
		});
	});
	return () => {
		cancelled = true;
		cancelTimer?.();
	};
}
