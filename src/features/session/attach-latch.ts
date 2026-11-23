import { launchingFromFallback } from "@/features/session/attach-handoff";

/**
 * An owner's "attaching" latch: busy from a pick's start until it settles,
 * with one escape for the pick that may never settle.
 *
 * WHAT IT GATES. `attaching` disables Attach, Paste and Clear draft, and the
 * web composer's Enter-to-send. It does NOT disable Send (`controls.primary`
 * reads no `attaching`), on any platform; that predates #248.
 *
 * WHY THE ESCAPE (#248, PR #328 QA round 1 Q2). A picker that UIKit refuses to
 * present never calls back, so its promise never settles and the owner's
 * `finally` never runs: Attach, Paste and Clear stayed disabled until the
 * composer remounted. The one launch that can be refused that way is the
 * attach handoff's FALLBACK — fired because the sheet's `onDismiss` had not
 * arrived, possibly before UIKit began the dismissal. So a pick that begins
 * inside a fallback launch (`launchingFromFallback`) is released after
 * `ATTACH_STRANDED_MS` if it has not settled.
 *
 * WHY ONLY THEN (review round 2 R6, QA Q3). A pick settles AFTER its picker
 * leaves the screen: expo-image-picker dismisses, then downloads an iCloud
 * original and re-encodes it; Files reads the file. Released during that
 * window, Clear, a second pick and web Enter ran against an image still in
 * flight. A pick launched from `onDismiss` (the normal path) or immediately
 * (Android, web) is never released early: it holds busy until it settles, as
 * before this PR. A fallback-launched pick that is merely slow can still be
 * released while it reads; that window is the cost of the escape, and it
 * exists only when `onDismiss` was lost or late.
 *
 * NO REAL "PRESENTED" SIGNAL. JavaScript cannot see the picker appear:
 * presenting it does not change `AppState`, and the module reports nothing
 * until it settles. Hence a timer.
 *
 * THE VALUE IS NOT MEASURED. It bounds how long a stranded Attach stays
 * disabled, and it is a floor on how long a reader may browse plus the read
 * before a fallback-launched pick is released. Three seconds is several times
 * a sheet-style presentation (~0.35 s) plus the picker module's first import;
 * the release trail in Copy diagnostics shows which picks fell back.
 *
 * Q4: a released pick that settles later must not end a NEWER pick's busy.
 * Each pick ends once — by its `finally` or by its release, whichever comes
 * first — so a late settle after the release changes nothing. Since PR #354
 * a second pick CAN start while the first is in flight (native Attach stays
 * pressable, `attachLocksWhilePicking`), so each pick also carries a
 * generation: only the newest pick ends busy, and an older pick's result is
 * dropped by its owner (`AttachTicket.current`).
 */
export const ATTACH_STRANDED_MS = 3_000;

/**
 * Whether a pick in flight disables the Attach button itself, on this platform.
 *
 * WHY NOT ON NATIVE (PR #354 review round 1, R1). The watchdog above covers
 * only fallback-launched picks; the NORMAL iOS launch is the sheet's
 * `onDismiss`, and a picker launched there that never presents (taken down
 * with a sheet, refused by UIKit) also never settles. With Attach disabled by
 * the latch that left Attach, Paste and Clear dead with no message until the
 * composer remounted, and no timer can tell that pick from a reader browsing
 * a large library. Native gives a better signal instead: a live system picker
 * (PHPicker, the document picker, the camera; an Android picker activity)
 * covers the app, so a press the reader can land on Attach means the pick
 * behind it is not on screen. Attach therefore stays pressable on iOS and
 * Android, and that press `abandon`s the pick (below).
 *
 * WEB KEEPS THE LOCK: its chooser does not cover the page reliably (a
 * mouse-driven reader can reach Attach with the chooser up), so a second
 * press there would race a live pick. Unchanged from before this PR.
 */
export const attachLocksWhilePicking = (os: string): boolean => os === "web";

/** A pick's end, plus whether it is still the owner's current pick. */
export type AttachTicket = (() => void) & {
	/** False once a newer pick began or the pick was abandoned: its late result
	 *  or error is dropped, so a superseded read never lands on the strip or the
	 *  error line under the reader's newer choice. */
	current: () => boolean;
};

export const createAttachLatch = (setBusy: (busy: boolean) => void) => {
	/* Q4 (above) relied on Attach being disabled while busy to rule out two
	 *  picks at once. On native that no longer holds, so each pick takes a
	 *  generation, and only the current generation may end busy. */
	let generation = 0;
	return {
		/** Marks a pick in flight; call the returned ticket in `finally`. */
		begin: (): AttachTicket => {
			generation += 1;
			const mine = generation;
			setBusy(true);
			let ended = false;
			const end = () => {
				if (ended) return;
				ended = true;
				if (watchdog !== undefined) clearTimeout(watchdog);
				if (mine === generation) setBusy(false);
			};
			const watchdog = launchingFromFallback()
				? setTimeout(end, ATTACH_STRANDED_MS)
				: undefined;
			return Object.assign(end, { current: () => mine === generation });
		},
		/**
		 * The reader pressed Attach while a pick was in flight (native only, see
		 * `attachLocksWhilePicking`): that pick is not on screen, so it no longer
		 * holds Attach, Paste or Clear. Its result, if it ever comes, is dropped.
		 * The cost: a pick that DID present and is past its picker — an iCloud
		 * original still downloading — is dropped too if the reader presses
		 * Attach before it lands; they are choosing again, and get that choice.
		 * A no-op when nothing is in flight.
		 */
		abandon: (): void => {
			generation += 1;
			setBusy(false);
		},
	};
};
