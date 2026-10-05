/**
 * The mic's visibility rule, as one pure function.
 *
 * Two facts decide it, and both must hold:
 *
 * - the relay advertised `capabilities.stt.available` — and **absence of the key
 *   means the same as `available: false`** (contract §3.2: an older relay omits
 *   the whole block, and the design is explicit that the right answer is to hide,
 *   not to error). The schema already defaults the block, but a caller may pass a
 *   bare `{}` — the list store's initial snapshot — so this reads absence again
 *   rather than trusting a shape;
 * - this build can actually record (the native audio module is present; see
 *   `stt/recorder.ts`). A mic that appears on a build that cannot record is the
 *   "control that cannot work" pattern, and on the web target it is the only
 *   possible outcome.
 *
 * No React, no network.
 */

import type { Capabilities, SttCapability } from "@/contracts";
import { recorderSupported } from "@/stt/recorder";

/** What an absent `capabilities.stt` block reads as. The same value the relay
 *  would send for "no transcription backend", so every downstream reader can use
 *  `available`/`path` without a second absence check. */
export const STT_UNAVAILABLE: SttCapability = { available: false, path: null };

/** The capability block, with absence resolved to unavailable. */
export const sttCapability = (
	capabilities: Capabilities | null | undefined,
): SttCapability => capabilities?.stt ?? STT_UNAVAILABLE;

/**
 * Whether the relay says voice input can run here. Deliberately does NOT consult
 * `capabilities.features["input-mode-v1"]`: the mobile side never gates the
 * annotation on that key (design §2.1) — the relay and the daemon's attach client
 * strip the fields for an owner that cannot store them, so the app sends
 * provenance whenever it has it.
 */
export const sttAvailable = (
	capabilities: Capabilities | null | undefined,
): boolean => sttCapability(capabilities).available === true;

/**
 * Whether to render the mic. `canRecord` is injectable so a test can assert the
 * rule without a native host; at the call site it defaults to what this build
 * actually supports.
 */
export const micVisible = (
	capabilities: Capabilities | null | undefined,
	canRecord: boolean = recorderSupported(),
): boolean => sttAvailable(capabilities) && canRecord;
