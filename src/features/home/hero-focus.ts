/**
 * When a Retry's success may move focus to the home's hero (UX U5).
 *
 * WHY THIS EXISTS. The alert holding focus unmounts when its Retry succeeds, and
 * focus otherwise falls to the top of the document (web) or wherever the screen
 * reader lands (native). So Home bumps a `focusRequest` counter and the splash
 * moves focus to its greeting. Two things made that move fire when nobody asked
 * for it (agent review round 2):
 *
 *  - M1: the splash is mounted conditionally and remounts on every New chat and
 *    every cleared recovery state, while Home's counter never goes back to 0.
 *    React runs an effect on mount, so each remount replayed the last request
 *    and pulled focus to a greeting that is still invisible (opacity 0 until
 *    measured). `focusLatch` remembers the value seen at mount and answers only
 *    a LATER change.
 *  - m2: a Retry pressed while no relay was live never ran its read, so its
 *    "pressed" flag survived until the automatic re-read on reconnect, which
 *    then moved focus nobody asked to move. `pressAnswered` ties the move to the
 *    exact attempt the press created, and Home drops that attempt when it could
 *    not be served.
 *
 * Plain functions with no `react-native` import, so Node's vitest can assert
 * them (see `vitest.config.ts`); the splash and Home are the thin glue.
 */

/** Answers "is this a new request?" for one mounted splash. */
export type FocusLatch = { take(request: number): boolean };

/**
 * A latch seeded with the request value the splash MOUNTED with: that value
 * was consumed (or deliberately ignored) by an earlier splash, so only a
 * change after mount asks for focus. Taking the same value twice answers
 * `true` once — an effect re-run (StrictMode) cannot move focus a second time.
 */
export const focusLatch = (seenAtMount: number): FocusLatch => {
	let seen = seenAtMount;
	return {
		take(request) {
			if (request === seen) return false;
			seen = request;
			return true;
		},
	};
};

/** No press is pending. Attempts start at 0 and a press always makes ≥ 1. */
export const NO_PRESS = 0;

/**
 * Whether the read that just settled is the one the reader's Retry created.
 * `pressed` is the attempt number the press produced (or `NO_PRESS`); an
 * automatic re-ask produces a different attempt, so it never matches.
 */
export const pressAnswered = (pressed: number, attempt: number): boolean =>
	pressed !== NO_PRESS && pressed === attempt;
