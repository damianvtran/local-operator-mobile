import { stageBDiagnosticText } from "../../src/testing/stage-b-draft-transport.ts";

/** Run 42078247373 on b9c7d765: a fresh simulator
 * library runs its first thumbnail rebuild inside assetsd while holding the
 * PhotoKit changes transaction. `PLThumbnailManager rebuildAllMissingThumbnails`
 * -> `generateThumbnailsWithImageSource` -> `IIORecodeHEIF_to_JPEG` ->
 * `CMPhotoJFIFTranscodeStrips` -> an untimed `dispatch_block_wait`, so the
 * caller's synchronous `performChangesAndWait` waits on the same serial
 * transaction: CoreSimulatorBridge sat in `_dispatch_mach_send_and_wait_for_reply`
 * (pid 4228, thread com.apple.PHPhotoLibrary.changes) while every assetsd sample
 * (pid 4490, 1552 samples) was in that rebuild. Nothing is rejected and nothing
 * is a permission, migration or credential failure — it is simulator library
 * warm-up state.
 *
 * The cheapest mitigation is therefore to spend that warm-up OUTSIDE the timed
 * import: give the rebuild one bounded attempt of its own, then run the timed
 * import with its existing cap. This is deliberately best-effort: a warm-up
 * that fails or times out must never fail the run, never satisfy the import
 * evidence and never be reported as the timed result. */
export async function stageBWarmMediaLibrary(
	warm: () => Promise<string>,
	evidence: Record<string, unknown>,
): Promise<boolean> {
	const started = Date.now();
	try {
		await warm();
		evidence.status = "completed";
		evidence.elapsedMs = Date.now() - started;
		return true;
	} catch (error) {
		evidence.status = "failed";
		evidence.elapsedMs = Date.now() - started;
		// Bounded and redacted like every other diagnostic; the timed import's own
		// exception stays the primary error and is never replaced by this one.
		evidence.error = stageBDiagnosticText(
			error instanceof Error ? error.message : String(error),
		).slice(0, 300);
		return false;
	}
}
