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
 * - this build can actually record (the native audio module is present, or a
 *   harness page carries the web capture hook; see `stt/recorder.ts`). A mic
 *   that appears on a build that cannot record is the "control that cannot
 *   work" pattern, and on the web target it is the only possible outcome.
 *
 * No React, no network.
 */

import type { Capabilities, SttCapability } from "@/contracts";
import { canRecord as buildCanRecord } from "@/stt/recorder";

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
 * rule without a native host; at the call site it defaults to
 * `stt/recorder.ts`'s `canRecord()`, which is the platform fact OR the web
 * capture hook (`lo-recorder`) that stands in for it on a harness page — read
 * there and not here, so a second platform check cannot drift from the
 * recorder's own.
 */
export const micVisible = (
	capabilities: Capabilities | null | undefined,
	canRecord: boolean = buildCanRecord(),
): boolean => sttAvailable(capabilities) && canRecord;

/**
 * Whether to render the mic in its SET-UP state: this build can record, the
 * computer has answered, and its answer is "no speech-to-text here".
 *
 * Why not simply hide it (which is what `micVisible` alone did, and what the
 * relay's web composer still does): the operator looked for a mic on a phone
 * whose computer had no persisted STT credential and found nothing — no
 * control, no reason, no way to learn that the fix is on the computer. The
 * daemon advertises `available: false` for exactly that case (it keys on
 * PERSISTED credentials only, `local_operator/mobile/stt.py`), so the phone can
 * say so. Transcription always runs on the computer with the operator's own STT
 * configuration; the phone never holds a key, so "set it up on your computer"
 * is the whole of the fix.
 *
 * `capabilities` that are absent, or carry no `stt` key at all, are "not
 * answered yet" (the list store's bare `{}` before its first frame), NOT
 * "unavailable": painting the set-up mic there would flash it on every cold
 * start before the real answer lands. A parsed frame always carries the key
 * (the schema defaults it), so an older relay that omits it reads as
 * unavailable once its frame has arrived.
 */
export const micSetupNeeded = (
	capabilities: Capabilities | null | undefined,
	canRecord: boolean = buildCanRecord(),
): boolean =>
	canRecord &&
	capabilities?.stt !== undefined &&
	capabilities.stt.available !== true;
