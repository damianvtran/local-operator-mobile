/**
 * The composer's voice mic, as a hook.
 *
 * The state machine the design describes (`idle → recording → transcribing →
 * idle`), wired to this app's two seams: the native recorder boundary
 * (`stt/recorder.ts`) and the relay endpoint (`POST /api/transcribe` through
 * `RelayEndpoints.transcribe`). All the RULES it applies live in the pure modules
 * (`stt/capability.ts`, `stt/dictation.ts`, `stt/transcribe.ts`, `stt/dictate.ts`);
 * this file owns only the React state, the timers and the platform calls, so the
 * rules stay testable without a screen (matching `composer.ts`'s own division).
 *
 * Two behaviours it deliberately leaves to its caller: joining the transcript
 * into the draft and recording the provenance — both are the composer's, because
 * only it knows the draft's current bytes. `onTranscript` is handed the text and
 * the returned `path`; the caller appends (never focuses) and notes the span.
 *
 * Out of scope HERE, by the task's own boundary: the cancel-transcription
 * affordance, the send-cancels-a-dictation line and the "Transcript added"
 * announcement — the four UX items the follow-up PR owns. What this hook does
 * keep is the 120 s cap (stop AND transcribe, never discard) and the discard of
 * the local file after every upload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Capabilities } from "@/contracts";
import type { RelayEndpoints } from "@/relay";
import { micVisible as micGate } from "@/stt/capability";
import { dictate } from "@/stt/dictate";
import { MAX_RECORDING_MS } from "@/stt/dictation";
import {
	type ActiveRecording,
	discardRecording,
	type MicPermission,
	readMicPermission,
	recorderSupported,
	requestMicPermission,
	startRecording,
} from "@/stt/recorder";
import { STT_COPY } from "@/stt/transcribe";

export type DictationPhase = "idle" | "recording" | "transcribing";

/** The permission refusal copy. `undetermined` is "we could not ask", which is a
 *  different sentence from "you said no". */
const permissionSentence = (permission: MicPermission): string =>
	permission === "denied"
		? "Microphone access is blocked. Allow it in Settings and try again."
		: "Couldn’t start recording. Check your microphone and try again.";

export interface DictationState {
	/** Whether to render the mic at all: the relay says voice can run here AND this
	 *  build can record (see `stt/capability.ts`). */
	micVisible: boolean;
	phase: DictationPhase;
	/** Whole seconds since the recording started, for the status row. */
	seconds: number;
	/** The one control: start when idle, stop-and-transcribe when recording. */
	press: () => void;
}

export interface DictationInput {
	endpoints: RelayEndpoints | null;
	capabilities: Capabilities | null | undefined;
	/** The transcript landed: append it (never focus) and note the span. */
	onTranscript: (text: string, path: string) => void;
	/** A landed but blank transcript, or a recording that stopped with no audio. */
	onEmpty: () => void;
	/** A sentence to show on the composer's error line. */
	onError: (sentence: string) => void;
	/** A `401` was raised by the transport: the shared reload rule is the caller's. */
	onUnauthorized?: (error: unknown) => void;
}

export const useDictation = (input: DictationInput): DictationState => {
	const {
		endpoints,
		capabilities,
		onTranscript,
		onEmpty,
		onError,
		onUnauthorized,
	} = input;

	const micVisible = useMemo(
		() => micGate(capabilities, recorderSupported()),
		[capabilities],
	);

	const [phase, setPhase] = useState<DictationPhase>("idle");
	const [seconds, setSeconds] = useState(0);
	/* The live recording and its timers. Refs, not state: they are read inside
	 * callbacks that must see the CURRENT handle, and a re-render is not what
	 * makes them valid. */
	const activeRef = useRef<ActiveRecording | null>(null);
	const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/* Guards a stop that has already begun: the cap timer and the button can race,
	 * and each must not transcribe the same clip twice. */
	const stoppingRef = useRef(false);

	const clearTimers = useCallback(() => {
		if (tickRef.current !== null) {
			clearInterval(tickRef.current);
			tickRef.current = null;
		}
		if (capRef.current !== null) {
			clearTimeout(capRef.current);
			capRef.current = null;
		}
	}, []);

	/* Callbacks live in refs so the async chain below never reads a stale closure
	 * and the hook's identity does not churn on every render. */
	const onTranscriptRef = useRef(onTranscript);
	onTranscriptRef.current = onTranscript;
	const onEmptyRef = useRef(onEmpty);
	onEmptyRef.current = onEmpty;
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;
	const onUnauthorizedRef = useRef(onUnauthorized);
	onUnauthorizedRef.current = onUnauthorized;

	const stopAndTranscribe = useCallback(async () => {
		const active = activeRef.current;
		if (active === null || stoppingRef.current) return;
		stoppingRef.current = true;
		clearTimers();
		setPhase("transcribing");
		let recording = null;
		try {
			recording = await active.stop();
		} catch {
			recording = null;
		}
		activeRef.current = null;
		if (recording === null) {
			/* Nothing was captured — a stop that produced no file is the same reader
			 * outcome as an empty transcript. */
			setPhase("idle");
			setSeconds(0);
			stoppingRef.current = false;
			onEmptyRef.current();
			return;
		}
		try {
			const outcome = await dictate(recording, {
				transcribe: (rec, options) =>
					endpoints === null
						? Promise.reject(new Error("no relay route"))
						: endpoints.transcribe(
								{
									audio: { uri: rec.uri, name: rec.name, type: rec.mimeType },
								},
								options,
							),
				discard: discardRecording,
			});
			if (outcome.kind === "transcript") {
				onTranscriptRef.current(outcome.text, outcome.path);
			} else if (outcome.kind === "empty") {
				onEmptyRef.current();
			} else {
				onErrorRef.current(outcome.sentence);
			}
		} catch (cause) {
			/* Only the `clear-all` (401) arm reaches here; `dictate` turns every other
			 * failure into a sentence. The caller's own handler owns the reload rule. */
			onUnauthorizedRef.current?.(cause);
		} finally {
			setPhase("idle");
			setSeconds(0);
			stoppingRef.current = false;
		}
	}, [clearTimers, endpoints]);

	const press = useCallback(() => {
		if (stoppingRef.current) return;
		if (phase === "recording") {
			void stopAndTranscribe();
			return;
		}
		if (phase !== "idle" || !micVisible || endpoints === null) return;
		void (async () => {
			/* The permission is asked HERE, at the press — never at first launch. */
			const permission = await requestMicPermission();
			if (permission !== "granted") {
				onErrorRef.current(permissionSentence(permission));
				return;
			}
			const active = await startRecording();
			if (active === null) {
				onErrorRef.current(
					"Couldn’t start recording. Check your microphone and try again.",
				);
				return;
			}
			activeRef.current = active;
			setSeconds(0);
			setPhase("recording");
			tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
			/* The cap STOPS and TRANSCRIBES; it is a bound on the recording, not a
			 * discard. The recorder is also given the same bound natively
			 * (`startRecording`), which is what holds while the app is backgrounded. */
			capRef.current = setTimeout(() => {
				void stopAndTranscribe();
			}, MAX_RECORDING_MS);
		})();
	}, [phase, micVisible, endpoints, stopAndTranscribe]);

	/* Navigating away must not leave the microphone hot: a recording in flight is
	 * stopped and its file discarded. A transcription already on the wire is left
	 * to finish (it has no side effect beyond its own result, which the unmounted
	 * caller's `onTranscript` guards). */
	useEffect(
		() => () => {
			clearTimers();
			const active = activeRef.current;
			activeRef.current = null;
			if (active !== null) void active.cancel();
		},
		[clearTimers],
	);

	return { micVisible, phase, seconds, press };
};

/** Re-exported so a caller (or a test) can read the seed state without the live
 *  recorder: the permission this build would report before any prompt. */
export const initialMicPermission = readMicPermission;

export { STT_COPY };
