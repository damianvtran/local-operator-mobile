/**
 * Shared bound for `xcrun simctl ui <udid> appearance <theme>` in the iOS proof
 * runners (chrome, projects-create, theme).
 *
 * Why its own cap: the appearance switch was capped at 60 s like the other
 * short simctl calls, but on hosted macOS runners it is not short. Measured
 * (n=2, GitHub-hosted macOS, chrome-ios-proof): 63.5 s on the run before
 * 42875725248, and 66.6 s on 42875725248 itself, which the 60 s cap killed with
 * no output. Both sit just above 60 s, so the old cap failed a healthy call.
 * 180 s is ~2.7x the observed max; it stays far inside each runner's overall
 * budget and still kills a genuinely hung simctl. Only appearance steps take
 * this cap — boot, install and the rest keep their own, tighter bounds.
 *
 * Every appearance call logs its measured duration (`appearanceTimingLine`) so
 * the next runs grow the distribution this cap is set from; revisit the value
 * from those log lines rather than guessing.
 */
export const APPEARANCE_CAP_SECONDS = 180;

export type SimctlAppearance = "light" | "dark";

/** argv for `xcrun` that switches the simulator's system appearance. */
export const appearanceArgs = (
	udid: string,
	theme: SimctlAppearance,
): string[] => ["simctl", "ui", udid, "appearance", theme];

/** One grep-able line per appearance call: step, measured seconds, cap. */
export const appearanceTimingLine = (
	step: string,
	elapsedMs: number,
	capSeconds: number = APPEARANCE_CAP_SECONDS,
): string =>
	`simctl-appearance ${step}: ${(elapsedMs / 1000).toFixed(1)}s (cap ${capSeconds}s)`;
