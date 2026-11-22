/**
 * The composer's voice mic, as a hook.
 *
 * The state machine the design describes is `stt/dictation-machine.ts`'s — the
 * phases, what a send does to a dictation in flight, and every sentence the polite
 * status row can say. This file owns only what a pure module cannot: the React
 * state, the timers, the meter, the native recorder handle and the request. The
 * same division the rest of `stt/` follows (`stt/capability.ts` and
 * `stt/transcribe.ts` are the other two halves), and the reason the four behaviours
 * this PR fixes are testable at all: the Node runner has no renderer, so a rule
 * enforced here and nowhere else has no test that can fail.
 *
 * Three properties it deliberately holds:
 *
 * - **The press is acknowledged in the same frame it happens.** `press` moves the
 *   machine to `starting` BEFORE the microphone is asked for, so a press that is
 *   still paying for the permission prompt and the audio session is visible and
 *   announced rather than silent. That is the first half of the start-lag fix; the
 *   second is `warmRecorder()` below, which takes the cold `expo-audio` import off
 *   the press path.
 * - **A send cancels a dictation, and says so** (design §2.5/U2). `cancelForSend`
 *   is the hook's own entry point for that, called by the composer's send path
 *   before the message leaves.
 * - **A send in flight does NOT gate the mic** (defect 4). `press` consults
 *   `mayStartDictation`, which reads `sending` and ignores it by design.
 *
 * Two behaviours it leaves to its caller: joining the transcript into the draft and
 * recording the provenance — both need the draft's current bytes, which only the
 * composer has. `onTranscript` is handed the text and the returned `path`; the caller
 * appends (never focuses) and notes the span.
 */

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import {
	getStartupAuthorization,
	subscribeStartupAuthorization,
} from "@/connection/startup-authorization";

import type { Capabilities } from "@/contracts";
import type { RelayEndpoints } from "@/relay";
import { micVisible as micGate, micSetupNeeded } from "@/stt/capability";
import { dictate } from "@/stt/dictate";
import { joinDraft, MAX_RECORDING_MS } from "@/stt/dictation";
import { forcedDictation, forcedLevels } from "@/stt/dictation-hook";
import {
	type DictationEvent,
	type DictationPhase,
	type DictationSnapshot,
	dictationStatusLine,
	IDLE_DICTATION,
	mayStartDictation,
	pressRoute,
	reduceDictation,
} from "@/stt/dictation-machine";
import {
	createMeterStore,
	METER_SAMPLE_MS,
	type MeterStore,
} from "@/stt/levels";
import {
	type ActiveRecording,
	discardRecording,
	type MicrophoneRecording,
	readMicPermission,
	recordingUploadPart,
	requestMicPermission,
	startRecording,
	warmRecorder,
} from "@/stt/recorder";
import { STT_COPY } from "@/stt/transcribe";

export type { DictationPhase };

/** How often the meter samples the recorder's level — `stt/levels.ts` owns the
 *  number, because the waveform rolls each new bar in over exactly this interval. */
const METER_INTERVAL_MS = METER_SAMPLE_MS;

export interface DictationState {
	/** Whether to render the mic at all: the relay says voice can run here AND this
	 *  build can record (see `stt/capability.ts`). */
	micVisible: boolean;
	/** Render the mic in its SET-UP state: this build can record but the computer
	 *  has no speech-to-text configured (`stt/capability.ts` `micSetupNeeded`). A
	 *  press says where to fix it instead of recording. Separate from `micVisible`
	 *  because that flag is also the session state marker's claim that voice can
	 *  RUN here, which the set-up mic must not make. */
	micSetup: boolean;
	phase: DictationPhase;
	/** Whole seconds since the recording started, for the status row. */
	seconds: number;
	/** The polite `role="status"` row's line, for every state (design §2.5). `""` is
	 *  the only "nothing to say" and is reserved for a resting machine with no
	 *  outcome. */
	status: string;
	/** The recording meter's live history, oldest first, each a `[0, 1]` bar height.
	 *  Read by the meter component alone (through `useSyncExternalStore`), never by
	 *  React state, so a level change does not re-render the field. */
	meter: MeterStore;
	/** Start when idle, finish while recording, or explicitly retry a failed take. */
	press: () => void;
	/** The reader's own discard: stop and delete, send NO request, say nothing. */
	cancel: () => void;
	/** A send/steer took the composer: abort, discard, and SAY SO (U2). */
	cancelForSend: () => void;
	/** The reader edited the draft: end a resting line, leave a live take alone
	 *  (issue #323). Called from the FIELD's change handler only — never from the
	 *  transcript append, whose `added` line it would hide. */
	clearOutcome: () => void;
}

export interface DictationInput {
	endpoints: RelayEndpoints | null;
	/** The originating draft, independent of the relay (sessions share endpoints). */
	scopeKey?: string;
	capabilities: Capabilities | null | undefined;
	/** A message is on the wire. Read by `mayStartDictation` and deliberately not
	 *  allowed to gate the mic (defect 4). */
	sending: boolean;
	/** The transcript landed: append it (never focus) and note the span. */
	onTranscript: (text: string, path: string) => void;
	/** A sentence to show on the composer's error line. Empty transcripts are the
	 *  machine's own outcome line, not an error. */
	onError: (sentence: string) => void;
	/** A `401` was raised by the transport: the shared reload rule is the caller's. */
	onUnauthorized?: (error: unknown) => void;
}

export const useDictation = (input: DictationInput): DictationState => {
	const {
		endpoints,
		scopeKey,
		capabilities,
		sending,
		onTranscript,
		onError,
		onUnauthorized,
	} = input;

	const authorization = useSyncExternalStore(
		subscribeStartupAuthorization,
		getStartupAuthorization,
		getStartupAuthorization,
	);
	/* Render-time identity blocks stale continuations even before effect cleanup.
	 * The synchronous authorization getter also fences a revoke before React renders. */
	const identity = useMemo(
		() => ({ endpoints, scopeKey, authorization }),
		[endpoints, scopeKey, authorization],
	);
	const identityRef = useRef(identity);
	identityRef.current = identity;
	const isCurrent = useCallback(
		() =>
			identityRef.current === identity &&
			getStartupAuthorization() === identity.authorization,
		[identity],
	);

	const micVisible = useMemo(
		/* The gate's own default is `stt/recorder.ts`'s `canRecord()` — the
		 * platform fact, or the web capture hook a harness page carries — so this
		 * reader does not spell the platform check a second time. */
		() => micGate(capabilities),
		[capabilities],
	);

	const micSetup = useMemo(
		() => !micVisible && micSetupNeeded(capabilities),
		[capabilities, micVisible],
	);

	/* The first-press lag's second half: resolve the audio module while the mic is
	 * merely VISIBLE, so the press that opens the microphone does not pay for a cold
	 * `import("expo-audio")`. Deduplicated by the recorder's own cached promise. */
	useEffect(() => {
		if (micVisible) warmRecorder();
	}, [micVisible]);

	const [snapshot, setSnapshot] = useState<DictationSnapshot>(IDLE_DICTATION);
	/* The machine's current state, read synchronously by the callbacks below: a
	 * second press in the same tick must see the first one's transition, and React
	 * state does not update within the tick. */
	const snapshotRef = useRef<DictationSnapshot>(IDLE_DICTATION);
	const [seconds, setSeconds] = useState(0);
	const meter = useMemo(() => createMeterStore(), []);

	/* The harness page may FORCE a dictation state so the design round can review a
	 * frame of it (`stt/dictation-hook.ts`; the web target cannot record, so these
	 * states have no other rendering). A forced snapshot is what this hook REPORTS;
	 * the machine underneath stays idle, so a capture cannot open a microphone. */
	const forced = useMemo(() => forcedDictation(), []);
	useEffect(() => {
		if (forced?.phase === "recording") meter.set(forcedLevels());
	}, [forced, meter]);

	/* The live recording and its timers. Refs, not state: they are read inside
	 * callbacks that must see the CURRENT handle, and a re-render is not what makes
	 * them valid. */
	const activeRef = useRef<ActiveRecording | null>(null);
	/* A stopped file is immutable: retries upload this exact take, never record
	 * again. Ownership includes the draft and authorization, not merely the URI. */
	const retainedRef = useRef<{
		recording: MicrophoneRecording;
		identity: typeof identity;
	} | null>(null);
	const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/* The in-flight transcription, so a cancel (or a send) aborts the request for
	 * REAL rather than only hiding the wait (design §2.5/U5). */
	const abortRef = useRef<AbortController | null>(null);
	/* Bumped by every cancel/send and by every new attempt. An async continuation
	 * that finds its run superseded drops its result — the guard that makes "the
	 * result is discarded" true rather than hoped for. */
	const runIdRef = useRef(0);

	const clearTimers = useCallback(() => {
		if (tickRef.current !== null) {
			clearInterval(tickRef.current);
			tickRef.current = null;
		}
		if (meterTimerRef.current !== null) {
			clearInterval(meterTimerRef.current);
			meterTimerRef.current = null;
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
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;
	const onUnauthorizedRef = useRef(onUnauthorized);
	onUnauthorizedRef.current = onUnauthorized;

	/** Feed one event to the machine and publish the result. Returns the transition
	 *  so a caller can read the effects it still has to perform. */
	const dispatch = useCallback((event: DictationEvent) => {
		const transition = reduceDictation(snapshotRef.current, event);
		snapshotRef.current = transition.state;
		setSnapshot(transition.state);
		return transition;
	}, []);

	/* The mic became usable (speech-to-text was set up on the computer): drop a
	 * resting "Set up speech-to-text…" line so it does not sit beside a working mic
	 * until the next press (agent review round 1, M2). The reducer leaves every
	 * other outcome and any live take alone. */
	useEffect(() => {
		if (micVisible) dispatch({ type: "available" });
	}, [micVisible, dispatch]);

	/* Releasing the slot before awaiting deletion makes cancellation racing a
	 * successful upload idempotent: both paths may release, only one deletes. */
	const releaseRecording = useCallback(
		async (recording: MicrophoneRecording) => {
			if (retainedRef.current?.recording !== recording) return;
			retainedRef.current = null;
			await discardRecording(recording);
		},
		[],
	);

	const transcribeRetained = useCallback(
		async (run: number) => {
			const retained = retainedRef.current;
			if (retained === null || retained.identity !== identity || !isCurrent())
				return;
			const recording = retained.recording;
			const controller = new AbortController();
			abortRef.current = controller;
			try {
				const outcome = await dictate(
					recording,
					{
						transcribe: async (rec, options) => {
							if (endpoints === null) throw new Error("no relay route");
							/* The recording goes up as bytes: SDK 57's global `fetch` is `expo/fetch`,
							 * which cannot encode React Native's `{ uri }` descriptor (see
							 * `transcribeForm` and `recordingUploadPart`). The file is read inside
							 * this call, not when the part is built. */
							const audio = await recordingUploadPart(rec);
							/* Resolving the native file adapter can cross a logout or route
							 * change. Never begin an old upload under a newer identity. */
							if (run !== runIdRef.current || !isCurrent())
								throw new Error("superseded dictation");
							return endpoints.transcribe({ audio }, options);
						},
						discard: releaseRecording,
					},
					{ signal: controller.signal },
				);
				/* A cancel or a send superseded this run: the result is dropped, and its
				 * own line (if any) has already been set. */
				if (run !== runIdRef.current || !isCurrent()) return;
				if (outcome.kind === "transcript") {
					onTranscriptRef.current(outcome.text, outcome.path);
					/* U3: the completion announcement. It is the machine's outcome rather
					 * than a second notice state, so it rides the same polite row the live
					 * states use. */
					dispatch({ type: "settle", outcome: "added" });
				} else if (outcome.kind === "empty") {
					dispatch({ type: "settle", outcome: "empty" });
				} else {
					dispatch({ type: "failed" });
					onErrorRef.current(outcome.sentence);
				}
			} catch (cause) {
				if (run !== runIdRef.current || !isCurrent()) return;
				dispatch({ type: "settle", outcome: null });
				/* Only the `clear-all` (401) arm reaches here; `dictate` turns every other
				 * failure into a sentence. The caller's own handler owns the reload rule. */
				onUnauthorizedRef.current?.(cause);
			} finally {
				if (abortRef.current === controller) abortRef.current = null;
			}
		},
		[dispatch, endpoints, identity, isCurrent, releaseRecording],
	);

	const stopAndTranscribe = useCallback(async () => {
		const active = activeRef.current;
		if (active === null || !isCurrent()) return;
		const run = ++runIdRef.current;
		clearTimers();
		dispatch({ type: "stop" });
		activeRef.current = null;
		let recording: MicrophoneRecording | null = null;
		try {
			recording = await active.stop();
		} catch {
			recording = null;
		}
		if (run !== runIdRef.current || !isCurrent()) {
			/* Cancel may win while native stop is pending, before there is a retained
			 * handle to release. The late file still belongs to that cancelled take. */
			if (recording !== null) await discardRecording(recording);
			return;
		}
		if (recording === null) {
			dispatch({ type: "settle", outcome: "empty" });
			return;
		}
		retainedRef.current = { recording, identity };
		await transcribeRetained(run);
	}, [clearTimers, dispatch, identity, isCurrent, transcribeRetained]);

	const openMic = useCallback(async () => {
		const run = runIdRef.current;
		/* The permission is asked HERE, at the press — never at first launch. */
		const permission = await requestMicPermission();
		/* Cancelled (or superseded) while the prompt was up: never leave a recorder
		 * hot. The machine has already moved off `starting` if so. */
		if (
			run !== runIdRef.current ||
			!isCurrent() ||
			snapshotRef.current.phase !== "starting"
		)
			return;
		if (permission !== "granted") {
			/* The refusal is the dictation row's outcome line, not the composer's
			 * error line (D6/U6/Q4, see `DictationOutcome`). `undetermined` is "we
			 * could not ask", which is a different sentence from "you said no". */
			dispatch({ type: "mic-refused", blocked: permission === "denied" });
			return;
		}
		/* `permission` is passed so the recorder does not read it from the OS a second
		 * time — one of the awaited round-trips between the press and `record()`. */
		const active = await startRecording({ permission });
		if (
			run !== runIdRef.current ||
			!isCurrent() ||
			snapshotRef.current.phase !== "starting"
		) {
			if (active !== null) void active.cancel();
			return;
		}
		if (active === null) {
			dispatch({ type: "mic-refused", blocked: false });
			return;
		}
		activeRef.current = active;
		dispatch({ type: "mic-opened" });
		setSeconds(0);
		meter.set([]);
		tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
		meterTimerRef.current = setInterval(() => {
			if (run !== runIdRef.current || !isCurrent()) return;
			const level = active.level();
			if (level !== null) meter.push(level);
		}, METER_INTERVAL_MS);
		/* The cap STOPS and TRANSCRIBES; it is a bound on the recording, not a
		 * discard. The recorder is also given the same bound natively
		 * (`startRecording`), which is what holds while the app is backgrounded. */
		capRef.current = setTimeout(() => {
			void stopAndTranscribe();
		}, MAX_RECORDING_MS);
	}, [dispatch, isCurrent, meter, stopAndTranscribe]);

	/** Tear down whatever is live. Shared by the two ways a dictation ends without
	 *  a transcript: the reader's own cancel, and a send taking the composer. */
	const discardLive = useCallback(() => {
		clearTimers();
		/* Supersede any in-flight run BEFORE aborting, so its continuation sees the
		 * bump and drops its result even if the abort itself races. */
		runIdRef.current += 1;
		abortRef.current?.abort();
		abortRef.current = null;
		const active = activeRef.current;
		activeRef.current = null;
		if (active !== null) void active.cancel();
		const retained = retainedRef.current;
		if (retained !== null) void releaseRecording(retained.recording);
		meter.set([]);
		setSeconds(0);
	}, [clearTimers, meter, releaseRecording]);

	const press = useCallback(() => {
		if (!isCurrent()) return;
		const phase = snapshotRef.current.phase;
		if (phase === "failed") {
			if (retainedRef.current?.identity !== identity) return;
			/* The transition happens before the first await: repeated taps cannot
			 * upload twice or append the same result twice. No send is involved. */
			const { effects } = dispatch({ type: "retry" });
			onErrorRef.current("");
			if (effects.includes("retry-transcription"))
				void transcribeRetained(++runIdRef.current);
			return;
		}
		/* `pressRoute` owns the order: a live take always finishes, and only a
		 * resting press on a computer that cannot transcribe is answered with the
		 * set-up line (and records nothing). */
		const route = pressRoute({ phase, micSetup });
		if (route === "setup") {
			dispatch({ type: "unavailable" });
			return;
		}
		if (route === "finish") {
			void stopAndTranscribe();
			return;
		}
		if (
			!mayStartDictation({
				phase,
				micVisible,
				hasEndpoints: endpoints !== null,
				sending,
			})
		)
			return;
		const { effects } = dispatch({ type: "press", sending });
		if (effects.includes("open-mic")) {
			runIdRef.current += 1;
			void openMic();
		}
	}, [
		dispatch,
		endpoints,
		micSetup,
		micVisible,
		identity,
		isCurrent,
		transcribeRetained,
		openMic,
		sending,
		stopAndTranscribe,
	]);

	const cancel = useCallback(() => {
		const failed = snapshotRef.current.phase === "failed";
		const { effects } = dispatch({ type: "cancel" });
		if (failed) onErrorRef.current("");
		if (
			!effects.includes("abort-request") &&
			!effects.includes("discard-recording")
		)
			return;
		discardLive();
	}, [discardLive, dispatch]);

	const cancelForSend = useCallback(() => {
		/* `sending` is passed through and ignored by the machine: this is the SEND
		 * path, not a second gate on the mic. */
		const { effects } = dispatch({ type: "send" });
		if (
			!effects.includes("abort-request") &&
			!effects.includes("discard-recording")
		)
			return;
		discardLive();
	}, [discardLive, dispatch]);

	/* No effects to perform: `edit` never touches a live take. */
	const clearOutcome = useCallback(() => {
		dispatch({ type: "edit" });
	}, [dispatch]);

	/* Navigating away must not leave the microphone hot: a recording in flight is
	 * stopped and its file discarded, and a transcription on the wire is aborted
	 * (its result would have nowhere to land). */
	useEffect(() => {
		/* A scope superseded before passive effects ran owns no new work. The
		 * previous effect's cleanup still releases its audio on the boundary. */
		if (!isCurrent()) return;
		dispatch({ type: "cancel" });
		return () => {
			/* Supersede any in-flight run BEFORE aborting, exactly as `discardLive` does:
			 * without the bump a late abort rejection (or a result that raced the abort)
			 * still passed the epoch check and ran the "live failure" arm — `setError`
			 * through the parent's handler — against an unmounted tree. With it, the
			 * continuation sees the bump and drops its result (agent review round 1). */
			runIdRef.current += 1;
			clearTimers();
			abortRef.current?.abort();
			abortRef.current = null;
			const active = activeRef.current;
			activeRef.current = null;
			if (active !== null) void active.cancel();
			const retained = retainedRef.current;
			if (retained !== null) void releaseRecording(retained.recording);
		};
	}, [clearTimers, dispatch, isCurrent, releaseRecording]);

	return {
		micVisible,
		micSetup,
		phase: forced?.phase ?? snapshot.phase,
		seconds,
		status: dictationStatusLine(forced ?? snapshot),
		meter,
		press,
		cancel,
		cancelForSend,
		clearOutcome,
	};
};

/**
 * Dictation for the HOME composer (the new-conversation page).
 *
 * The operator found no mic there (TestFlight 578): the home passed no `voice`
 * at all, on the theory that its mic "belonged with the new-chat flow". But
 * `/api/transcribe` is not session-bound — the computer transcribes with its
 * own STT configuration and returns text — so the home can run the very same
 * machine and land the transcript in its draft.
 *
 * What differs from the session composer, and why: the session's
 * `use-composer.ts` records the dictated span so its `prompt` can carry
 * `input_mode`/`input_path`; the home's start coordinator sends its first prompt
 * without either field today, so the transcript is appended and nothing else is
 * noted (an unannotated prompt reads as typed — the pre-existing home behaviour,
 * not a new claim). The draft is read through a
 * ref so a transcript landing after more typing joins the CURRENT text, never a
 * stale render's.
 */
export const useHomeDictation = (input: {
	endpoints: RelayEndpoints | null;
	capabilities: Capabilities | null | undefined;
	draft: string;
	setDraft: (text: string) => void;
	onError: (sentence: string) => void;
}): DictationState => {
	const draftRef = useRef(input.draft);
	draftRef.current = input.draft;
	const setDraftRef = useRef(input.setDraft);
	setDraftRef.current = input.setDraft;
	return useDictation({
		endpoints: input.endpoints,
		capabilities: input.capabilities,
		/* The home's send is a start that hands off to the session; it never
		 * holds the composer "sending", and the machine ignores this anyway. */
		sending: false,
		onTranscript: (text) => {
			const previous = draftRef.current;
			const joined = joinDraft(previous, text);
			if (text.trim() === "" || joined === previous) return;
			setDraftRef.current(joined);
		},
		onError: input.onError,
	});
};

/** Re-exported so a caller (or a test) can read the seed state without the live
 *  recorder: the permission this build would report before any prompt. */
export const initialMicPermission = readMicPermission;

export { STT_COPY };
