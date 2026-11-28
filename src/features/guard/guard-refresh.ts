/**
 * The Guard surfaces' live refresh (review R1-5, slice M1).
 *
 * Guard sends NO push (RFC v0.9 §5.2.3), so the inbox row and the Settings
 * section are the only way a member learns a request arrived. Without this a
 * request that lands while one of them is already open stays invisible until
 * the screen remounts. Two triggers, both silent re-reads of the host's status:
 *
 *  - the app returning to the foreground (the member comes back to the phone);
 *  - a bounded interval, running ONLY while the app is in the foreground.
 *
 * Kept free of `react-native` / `expo-router` imports on purpose (the unit
 * tests run in Node): the caller hands in the AppState-shaped seam. WHO may call
 * this is the other half of "zero polling without `features.guard`": the hook is
 * only mounted under a Guard body that `useGuardAvailability` already gated, so
 * an older host, an offline phone and an unknown capability never reach it.
 */

/** The slice of `AppState` this needs: the current state and a change listener. */
export interface AppStateSeam {
	currentState: string;
	addEventListener(
		type: "change",
		listener: (state: string) => void,
	): { remove(): void };
}

/**
 * Start refreshing; returns the cleanup that stops it.
 *
 * `immediate` is for a RE-start (the screen regained focus after being away): it
 * reads once now. The first start must not, because the controller's own
 * activation is already issuing the visible first read.
 */
export function startGuardRefresh(
	refresh: () => void | Promise<unknown>,
	env: {
		appState: AppStateSeam;
		intervalMs: number;
		immediate?: boolean;
		setTimer?: typeof setInterval;
		clearTimer?: typeof clearInterval;
	},
): () => void {
	const setTimer = env.setTimer ?? setInterval;
	const clearTimer = env.clearTimer ?? clearInterval;
	let timer: ReturnType<typeof setInterval> | null = null;
	const stop = () => {
		if (timer !== null) clearTimer(timer);
		timer = null;
	};
	const run = () => {
		stop();
		timer = setTimer(() => void refresh(), env.intervalMs);
	};
	if (env.appState.currentState === "active") {
		if (env.immediate) void refresh();
		run();
	}
	const subscription = env.appState.addEventListener("change", (state) => {
		if (state === "active") {
			void refresh();
			run();
		} else {
			stop();
		}
	});
	return () => {
		stop();
		subscription.remove();
	};
}
