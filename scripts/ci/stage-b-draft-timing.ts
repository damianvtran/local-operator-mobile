/** Run 41831921831 measured individual Maestro hierarchy calls at 53.7–83.3s.
 * 180s exceeds twice the observed maximum. Never spend this budget inside the
 * production /me proof's unchanged 20s deadline. */
export const STAGE_B_FRAME_HIERARCHY_SECONDS = 180;
export const STAGE_B_HELD_RELEASE_MS = 10_000;
export const STAGE_B_TIMEOUT_HOLD_MS = 22_000;
export const STAGE_B_SCREENSHOT_SECONDS = 3;
export const STAGE_B_SETTLE_GAP_MS = 1_000;
export const STAGE_B_RESTORE_GAP_MS = 300;
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
): Promise<void> {
	await screenshot(prefix, STAGE_B_SCREENSHOT_SECONDS);
	await sleep(STAGE_B_SETTLE_GAP_MS);
	await screenshot(`${prefix}-consecutive`, STAGE_B_SCREENSHOT_SECONDS);
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
