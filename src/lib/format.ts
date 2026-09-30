/**
 * Pure formatting helpers: the small conversions every screen would otherwise
 * write three slightly different ways.
 *
 * Everything here takes values and returns strings — no React, no React Native —
 * so the app's copy rules are unit tests rather than review notes.
 */

/**
 * Shorten a home-directory path to `~/…`.
 *
 * The row's second line is a `cwd`, and on a phone the useful part is the tail:
 * `/Users/someone/Development/thing` spends its first 22 characters saying what
 * every path on the machine says. The client already renders home-shortened
 * paths, so the shortening rule lives in one place instead of being re-decided by
 * whoever renders a path next.
 *
 * The home directory is passed in rather than read from the environment: this
 * module must stay pure, and the caller already knows the home path.
 */
export const homeShortened = (path: string, home: string): string => {
	if (!home || !path) return path;
	if (path === home) return "~";
	// Only a real path segment counts: `/Users/damianother/x` is not under
	// `/Users/damian`.
	if (!path.startsWith(`${home}/`)) return path;
	return `~${path.slice(home.length)}`;
};

/**
 * `1 agent` / `2 agents`, `1 todo` / `3 todos`.
 *
 * The row's counts are read at a glance, and "1 agents" is the kind of thing a
 * reader notices once and distrusts the rest of the screen for. Irregular plurals
 * are passed in by the caller, which is the only place that knows them.
 */
export const countLabel = (
	count: number,
	singular: string,
	plural = `${singular}s`,
): string => `${count} ${count === 1 ? singular : plural}`;

/**
 * Elapsed time in the register the transcript uses: `0s`, `59s`, `1m 04s`,
 * `2h 07m`.
 *
 * Two things this is careful about. The seconds are zero-padded once minutes
 * appear, so the width does not jitter every second — a clock that changes width
 * once a second is the noisiest thing on a transcript. And a duration is never
 * shortened to a PREFIX of itself: `59m 59s` rendering as `59m` is still a valid
 * duration, so nothing looks wrong, which is exactly how that bug survives review
 * (docs/design/components.md § 7, "Do not").
 */
export const elapsedLabel = (totalSeconds: number): string => {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
};
