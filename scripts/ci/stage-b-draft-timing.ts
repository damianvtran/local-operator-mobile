/** Run 41831921831 measured individual Maestro hierarchy calls at 53.7–83.3s.
 * 180s exceeds twice the observed maximum. Never spend this budget inside the
 * production /me proof's unchanged 20s deadline. */
export const STAGE_B_FRAME_HIERARCHY_SECONDS = 180;
/** simctl addmedia took 90s (41804068676), 115s (41818693532), and 118s
 * (41831921831). Reserve >=2x the observed maximum, not run()'s 120s default. */
export const STAGE_B_ADD_MEDIA_SECONDS = 240;
/** Run 41918042114: screenshot took 10s under concurrent Maestro load.
 * Release after both serial loading frames, never later than 17s after /me;
 * production's independent 20s proof deadline remains unchanged. */
export const STAGE_B_HELD_RELEASE_MS = 17_000;
export const STAGE_B_TIMEOUT_HOLD_MS = 22_000;
// Run 41918042114 measured a 10s screenshot; 12s allows completion diagnostics.
export const STAGE_B_SCREENSHOT_SECONDS = 12;
export const STAGE_B_SETTLE_GAP_MS = 1_000;
export const STAGE_B_RESTORE_GAP_MS = 300;
export const STAGE_B_POST_RELEASE_WINDOW_MS = 10_000;

/** The assertion driver MUST start after the held response has been released.
 * The UI performs its own timed negative assertion loop. In production,
 * observe() flushes queued UI work, so its lease sample is POST-SEGMENT (at
 * least 10s after release), not concurrent observation during driver startup.
 * The assertion command and observer retain their existing bounded caps. */
export async function verifyStageBPostReleaseWindow<
	T extends { recoveryAdmitted?: unknown },
>(options: {
	afterRelease(): Promise<void>;
	assertUI(): Promise<void>;
	observe(): Promise<T>;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	windowMs?: number;
}): Promise<T> {
	await options.afterRelease();
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? stageBSleep;
	const deadline = now() + (options.windowMs ?? STAGE_B_POST_RELEASE_WINDOW_MS);
	let finished = false;
	let failed: { cause: unknown } | undefined;
	const assertion = options.assertUI().then(
		() => {
			finished = true;
		},
		(cause) => {
			failed = { cause };
			finished = true;
		},
	);
	let latest: T;
	do {
		if (failed) throw failed.cause;
		latest = await options.observe();
		if (latest.recoveryAdmitted !== false)
			throw new Error("late post-release proof admitted recovery");
		if (finished && now() >= deadline) break;
		await sleep(250);
	} while (!finished || now() < deadline);
	await assertion;
	// The callback can change this while observe/sleep is awaited; read through
	// a function so flow narrowing cannot freeze the earlier no-failure state.
	const terminalFailure = (): { cause: unknown } | undefined => failed;
	const terminal = terminalFailure();
	if (terminal) throw terminal.cause;
	return latest;
}
export const stageBSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** A consecutive settle frame needs fresh pixels, not another 54–83s driver
 * roundtrip. Reuse is recorded in the receipt, never represented as fresh AX. */
export async function stageBFrameHierarchy(
	read: (seconds: number) => Promise<string>,
	reused?: string,
	sleep: (ms: number) => Promise<void> = stageBSleep,
): Promise<string> {
	const hierarchy = reused ?? (await read(STAGE_B_FRAME_HIERARCHY_SECONDS));
	if (!hierarchy.includes("bounds") && !hierarchy.includes("frame"))
		throw new Error("actual native hierarchy geometry unavailable");
	if (reused !== undefined) await sleep(STAGE_B_SETTLE_GAP_MS);
	return hierarchy;
}

/** Started by the fixture's actual /me arrival, not after a slow Maestro flow.
 * The fixture owns an independent release timer even if capture hangs/fails. */
export async function captureStageBHeldPair(
	screenshot: (name: string, seconds: number) => Promise<void>,
	prefix: string,
	sleep: (ms: number) => Promise<void> = stageBSleep,
	proof?: {
		deadlineAt: number;
		readonly releasedAt?: number;
		recordFrame(name: string, completedAtMs?: number): void;
	},
): Promise<void> {
	const names = [prefix, `${prefix}-consecutive`];
	for (const name of names) proof?.recordFrame(name);
	try {
		for (const [index, name] of names.entries()) {
			if (index) await sleep(STAGE_B_SETTLE_GAP_MS);
			if (
				proof &&
				(proof.releasedAt !== undefined || Date.now() >= proof.deadlineAt)
			)
				throw new Error("proof released");
			await screenshot(name, STAGE_B_SCREENSHOT_SECONDS);
			proof?.recordFrame(name, Date.now());
			if (
				proof &&
				(proof.releasedAt !== undefined || Date.now() >= proof.deadlineAt)
			)
				throw new Error("proof released");
		}
	} catch (cause) {
		throw new Error("loading frame not captured before proof release", {
			cause,
		});
	}
}
export async function captureStageBRestoreBurst(
	screenshot: (name: string, seconds: number) => Promise<void>,
	prefix: string,
	sleep: (ms: number) => Promise<void> = stageBSleep,
): Promise<void> {
	// Serialise device capture: measured simctl calls take 0.9–2.4s, so starting
	// them 300ms apart overlapped commands on one simulator. These are honest
	// 300ms QUIET GAPS after completion, not a claimed 300ms sampling interval.
	for (let i = 0; i < 3; i++) {
		if (i > 0) await sleep(STAGE_B_RESTORE_GAP_MS);
		await screenshot(`${prefix}-restore-${i}`, STAGE_B_SCREENSHOT_SECONDS);
	}
}
