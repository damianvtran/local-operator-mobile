import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * WHAT THIS GUARDS. The upload defect was not in the multipart builder but in
 * what the composer's hook handed it: React Native's `{ uri, name, type }`
 * descriptor, which SDK 57's global `fetch` (`expo/fetch`) refuses with
 * "Unsupported FormDataPart implementation" before a request is sent, so every
 * dictation surfaced as the retry sentence. The fix is `recordingUploadPart`
 * (`stt/recorder.ts`), and the half that can regress silently is the CALL SITE.
 *
 * WHY A SOURCE ASSERTION. `useDictation` needs a renderer plus the native audio
 * module (`expo-audio`): driving a recording through it is a device test, not
 * this host. What remains checkable here is the line that decides the wire shape,
 * so the assertion is on that line rather than on a reimplementation of it. The
 * bytes themselves are covered where they are built (recorder test) and where
 * they are encoded (transcribe test).
 */
const HOOK = readFileSync(
	new URL("./use-dictation.ts", import.meta.url),
	"utf8",
);

/** The shape the multipart encoder refuses: an `audio` part given as a URI. */
const URI_DESCRIPTOR = /audio:\s*\{\s*uri:/;

describe("the dictation upload's wire shape", () => {
	it("hands the endpoint a bytes part from the recorder, not a `{ uri }` descriptor", () => {
		/* Presence first: the assertions below are about absence, and a hook whose
		 * upload was deleted would satisfy them while proving nothing. */
		expect(HOOK).toContain("endpoints.transcribe(");
		expect(HOOK).toContain("recordingUploadPart(");
		/* The shape the encoder refuses. Named explicitly because `rec.uri` still
		 * appears in the hook's own mocks — only the DESCRIPTOR is the defect. */
		expect(HOOK).not.toMatch(URI_DESCRIPTOR);
	});

	it("keeps the SDK contact in the recorder, so a Node test never loads it", () => {
		/* `stt/recorder.ts` owns `expo-audio` and `expo-file-system` (its own
		 * docstring states the rule); a second importer here is how the hook became
		 * the module that could not be tested. */
		expect(HOOK).not.toContain('import("expo-file-system")');
	});
});
