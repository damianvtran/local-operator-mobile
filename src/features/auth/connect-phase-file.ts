/**
 * The connect phase ring (`connect-phases.ts`) mirrored to a FILE in the app's
 * own container, for proof bundles only.
 *
 * **Why a file.** PR #216's diagnostic run 42855980853 could read the ring
 * through neither carrier it had: the hidden `connect-phase-log` node lives in
 * the root layout, and while the sidebar is open iOS exposes only the sidebar to
 * the accessibility hierarchy; and a Release build does not forward
 * `console.info` to the unified log. A file under `Paths.document` survives
 * both: the native proof driver reads it from the host with
 * `xcrun simctl get_app_container <udid> <bundle> data`, whatever is on screen.
 *
 * **Same content, same bounds.** The file is the ring's own redacted text
 * (`formatConnectPhases`), rewritten whole on every append, so it is never
 * bigger than `CAPACITY` entries of `MESSAGE_CAP`-capped messages and never
 * carries anything the hidden node would not. Gated by the caller on the same
 * `EXPO_PUBLIC_CONNECT_PHASE_NODE` flag; no shipped build writes it.
 *
 * **Never breaks a connect.** A write failure is swallowed: this is evidence,
 * and the hidden node remains the fallback.
 */

import { formatConnectPhases, subscribeConnectPhases } from "./connect-phases";

/** The file's name under the app's Documents directory. The driver
 *  (`scripts/ci/chrome-ios-proof.ts`) reads `Documents/<this>`. */
export const CONNECT_PHASE_FILE = "connect-phases.txt";

export interface PhaseFileSink {
	write(text: string): void;
}

/** Writes the ring now and after every append; returns the unsubscribe. */
export function persistConnectPhases(sink: PhaseFileSink): () => void {
	const flush = () => {
		try {
			sink.write(formatConnectPhases());
		} catch {
			/* evidence only: the hidden node still carries the ring */
		}
	};
	flush();
	return subscribeConnectPhases(flush);
}

/** The native sink: `Documents/connect-phases.txt` through expo-file-system,
 *  imported on call like the app's other file-system users. */
export async function nativePhaseFileSink(): Promise<PhaseFileSink> {
	const { File, Paths } = await import("expo-file-system");
	const file = new File(Paths.document, CONNECT_PHASE_FILE);
	return { write: (text) => file.write(text) };
}
