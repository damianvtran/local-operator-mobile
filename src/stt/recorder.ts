/**
 * The one module that touches `expo-audio`.
 *
 * Same rule as `src/notifications/native.ts` for push and
 * `src/connection/storage.ts` for the keystore: the platform contact lives in one
 * place, behind async functions whose failure modes are stated, and every other
 * module reads this one. Two properties are load-bearing:
 *
 * - **The import is lazy and its absence is a value.** A binary built without the
 *   audio module (the planned `foss` flavour; the web target and the Node test
 *   host today) must not crash at module load and must not pretend: `load()`
 *   answers `null` and every function below degrades to `unsupported` / `null` —
 *   the caller hides the mic rather than rendering a control that throws.
 * - **A platform guard before every call, not just before the import.** The web
 *   build resolves the package (its JS imports fine) but the native recorder
 *   calls reject; `Platform.OS` is checked first so the web target never reaches
 *   them.
 *
 * The permission is requested HERE, at the moment the reader presses the mic —
 * never at first launch (the same honest-opt-in rule the notifications work
 * followed, ADR 0006 §5). The declaration that makes the prompt legal lives in
 * `app.config.ts` (`NSMicrophoneUsageDescription` / `RECORD_AUDIO`).
 *
 * What this module deliberately does NOT do: it does not transcribe, it does not
 * join the draft and it does not hold the recording after it is stopped. It hands
 * back a file the caller uploads and then DISCARDS (see `stt/dictate.ts`) — the
 * phone must not become the retention point the daemon is not.
 */

import { Platform } from "react-native";

import { MAX_RECORDING_SECONDS, pickRecorderMime } from "@/stt/dictation";

type AudioModule = typeof import("expo-audio");

/** Hoisted per biome's `useTopLevelRegex`: each of these runs per call and a
 *  literal in the body is recompiled every time. */
const LEADING_DOT = /^\./;
const URI_QUERY = /[?#]/;

/** Whether this PLATFORM can record at all. The web target cannot — capture
 *  needs a native recorder; the web composer's MediaRecorder path is a different
 *  build and deliberately not emulated here. */
export const recorderSupported = (): boolean =>
	Platform.OS === "ios" || Platform.OS === "android";

let loaded: Promise<AudioModule | null> | null = null;

/** The module, or `null` when this binary does not carry it. Cached: a dynamic
 *  import resolves once, and a failure is a fact about the build, not a
 *  per-call condition. */
export async function loadRecorder(): Promise<AudioModule | null> {
	if (!recorderSupported()) return null;
	if (loaded === null) {
		loaded = import("expo-audio").catch(() => null);
	}
	return loaded;
}

/** The microphone permission in the app's vocabulary. `unsupported` is a build
 *  without the module; `undetermined` is "not asked yet", which is what makes the
 *  press the moment of asking rather than a launch effect. */
export type MicPermission =
	| "granted"
	| "denied"
	| "undetermined"
	| "unsupported";

const fromStatus = (status: string): MicPermission =>
	status === "granted"
		? "granted"
		: status === "denied"
			? "denied"
			: "undetermined";

/** The current permission WITHOUT raising a prompt, for a Settings row or a
 *  pre-flight check. Never throws: a read that fails is `undetermined`. */
export async function readMicPermission(): Promise<MicPermission> {
	const module = await loadRecorder();
	if (module === null) return "unsupported";
	try {
		const response = await module.getRecordingPermissionsAsync();
		return fromStatus(response.status);
	} catch {
		return "undetermined";
	}
}

/**
 * Ask the OS for microphone access — the act behind the mic button, never a mount
 * effect. On iOS this is the standard dialog; on Android 6+ it is the
 * `RECORD_AUDIO` runtime grant. A module whose call fails is `undetermined`
 * rather than `denied`: "we could not ask" and "you said no" are different
 * sentences.
 */
export async function requestMicPermission(): Promise<MicPermission> {
	const module = await loadRecorder();
	if (module === null) return "unsupported";
	try {
		const response = await module.requestRecordingPermissionsAsync();
		return fromStatus(response.status);
	} catch {
		return "undetermined";
	}
}

/** A stopped recording, local and about to be uploaded once and then discarded. */
export interface MicrophoneRecording {
	/** The local file URI (`file://…`), the form `FormData` uploads from. */
	uri: string;
	/** The recorder's own container type, derived from the file extension. */
	mimeType: string;
	/** The multipart part's filename. */
	name: string;
	/** Elapsed milliseconds, for the caller's own bookkeeping. */
	durationMs: number;
}

/** The live recording, before it is stopped. */
export interface ActiveRecording {
	/** Stops the recorder and returns the file, or `null` when nothing was
	 *  captured (a stop with no URI is an empty take, not an error). Idempotent. */
	stop(): Promise<MicrophoneRecording | null>;
	/** Stops and deletes the file — the explicit-cancel path, which sends NO
	 *  request. */
	cancel(): Promise<void>;
}

/**
 * The MIME type for a recorded file, from its extension.
 *
 * The server's allowlist is the closed set; the recorder's preset decides which
 * member a platform produces (AAC/m4a on both native platforms). An extension
 * with no mapping falls back to the bare type the allowlist lists for it rather
 * than to `application/octet-stream`, which the server would refuse with a
 * sentence the reader cannot act on.
 */
export function mimeForExtension(extension: string): string {
	const normalized = extension.replace(LEADING_DOT, "").toLowerCase();
	switch (normalized) {
		case "m4a":
		case "mp4":
		case "aac":
			return "audio/mp4";
		case "webm":
			return "audio/webm";
		case "ogg":
		case "oga":
		case "opus":
			return "audio/ogg";
		case "mp3":
			return "audio/mpeg";
		case "wav":
			return "audio/wav";
		default:
			return "audio/mp4";
	}
}

/**
 * Begins a recording. Returns `null` when the platform, the module or the
 * permission is missing — the caller treats null as "no mic" and says so, rather
 * than starting a UI state it cannot finish.
 *
 * The 120 s cap is passed to the recorder itself (`forDuration`) as well as
 * enforced by the caller's own timer: the design requires that the cap STOPS and
 * TRANSCRIBES, and a JS timer does not run while the app is backgrounded — the
 * native bound is what holds the promise there.
 */
export async function startRecording(): Promise<ActiveRecording | null> {
	const module = await loadRecorder();
	if (module === null) return null;
	try {
		const permission = await module.getRecordingPermissionsAsync();
		if (permission.status !== "granted") return null;
		/* The iOS audio session has to allow recording before `record()`; without
		 * it the recorder starts and captures silence. */
		await module.setAudioModeAsync({ allowsRecording: true });
		const recorder = new module.AudioModule.AudioRecorder(
			module.RecordingPresets.HIGH_QUALITY,
		);
		await recorder.prepareToRecordAsync();
		recorder.record({ forDuration: MAX_RECORDING_SECONDS });
		let stopped = false;
		const stop = async (): Promise<MicrophoneRecording | null> => {
			if (stopped) return null;
			stopped = true;
			try {
				await recorder.stop();
			} catch {
				return null;
			}
			const uri = recorder.uri;
			if (uri === null || uri === "") return null;
			const status = recorder.getStatus();
			return {
				uri,
				mimeType: mimeForExtension(extensionOf(uri)),
				name: fileNameOf(uri),
				durationMs: status.durationMillis,
			};
		};
		return {
			stop,
			cancel: async () => {
				const recording = await stop();
				if (recording !== null) await discardRecording(recording);
			},
		};
	} catch {
		return null;
	}
}

/**
 * Deletes a stopped recording's local file.
 *
 * This is a hard requirement, not a nicety: the web composer replaces the blob
 * with the transcript, and the phone must too, or the phone becomes the
 * retention point the daemon is not. Called exactly once per upload by
 * `stt/dictate.ts`; a delete that fails is swallowed (the file is in the OS cache
 * directory and the system reclaims it), because failing the transcription over a
 * cleanup error would trade a real result for a tidiness rule.
 */
export async function discardRecording(
	recording: MicrophoneRecording,
): Promise<void> {
	try {
		const { File } = await import("expo-file-system");
		const file = new File(recording.uri);
		if (file.exists) file.delete();
	} catch {
		/* See above: cleanup never fails the caller. */
	}
}

/** The extension, with its dot, of a file URI path. */
export function extensionOf(uri: string): string {
	const withoutQuery = uri.split(URI_QUERY)[0] ?? uri;
	const lastSegment = withoutQuery.split("/").pop() ?? "";
	const dot = lastSegment.lastIndexOf(".");
	return dot === -1 ? "" : lastSegment.slice(dot);
}

/** The multipart filename for a recording URI. */
export function fileNameOf(uri: string): string {
	const withoutQuery = uri.split(URI_QUERY)[0] ?? uri;
	const lastSegment = withoutQuery.split("/").pop() ?? "";
	return lastSegment === "" ? "recording.m4a" : lastSegment;
}

/**
 * The MIME the shipped recorder preset produces.
 *
 * `RecordingPresets.HIGH_QUALITY` writes AAC in an m4a container on both native
 * platforms (see the package's own docs), so this is `audio/mp4` — the first
 * entry of `RECORDER_MIME_CANDIDATES` and a member of the server allowlist. It is
 * derived through `pickRecorderMime` rather than hardcoded so that a future
 * preset change is a one-line edit in `dictation.ts`; the device check that
 * confirms the container on a real handset is named as a QA gap, not assumed.
 */
export const recorderMimeType = (): string =>
	pickRecorderMime((mime) => mime === "audio/mp4" || mime.startsWith("audio/"));
