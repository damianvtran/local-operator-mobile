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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Capabilities } from "@/contracts";
import type { RelayEndpoints } from "@/relay";
import { micVisible as micGate, micSetupNeeded } from "@/stt/capability";
import { dictate } from "@/stt/dictate";
import { joinDraft, MAX_RECORDING_MS } from "@/stt/dictation";
import { forcedDictation, forcedLevels } from "@/stt/dictation-hook";
import {
	type DictatedSend,
	type DictationEvent,
	type DictationOutcome,
	type DictationPhase,
	type DictationSnapshot,
	dictatedSendState,
	dictationStatusLine,
	IDLE_DICTATION,
	mayStartDictation,
	pressRoute,
	reduceDictation,
	transcriptSendable,
} from "@/stt/dictation-machine";
import {
	createMeterStore,
	METER_SAMPLE_MS,
	type MeterStore,
} from "@/stt/levels";
import {
	type ActiveRecording,
	discardRecording,
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
	/** The resting outcome behind `status`, or `null` while a take is live or
	 *  nothing is said. The composer reads it to keep `added` out of sight. */
	outcome: DictationOutcome | null;
	/** What Send does right now: `"live"` transcribes the take and sends it,
	 *  `"pending"` is that press waiting for its transcript. `null` is the
	 *  ordinary send. */
	sendMode: DictatedSend;
	/** The transcript of a "transcribe and send" press has landed in the draft:
	 *  the host sends it from an effect (the draft it must send is only the
	 *  current one after the render that holds the transcript) and then calls
	 *  `ackSend`. */
	sendReady: boolean;
	/** The recording meter's live history, oldest first, each a `[0, 1]` bar height.
	 *  Read by the meter component alone (through `useSyncExternalStore`), never by
	 *  React state, so a level change does not re-render the field. */
	meter: MeterStore;
	/** The one control: start when idle, stop-and-transcribe when recording. */
	press: () => void;
	/** The reader's own discard: stop and delete, send NO request, say nothing. */
	cancel: () => void;
	/** Send while recording (or transcribing): stop, transcribe, append the words
	 *  and then send them — the relay's "send recording". Nothing is sent if the
	 *  transcript is blank, the box changed meanwhile, or it would be a slash
	 *  command; the words stay in the box. */
	finishAndSend: () => void;
	/** The host has taken `sendReady`: clears it and the pending press. */
	ackSend: () => void;
	/** A send/steer took the composer: abort, discard, and SAY SO (U2). */
	cancelForSend: () => void;
	/** The reader edited the draft: end a resting line, leave a live take alone
	 *  (issue #323). Called from the FIELD's change handler only — never from the
	 *  transcript append, whose `added` line it would hide. */
	clearOutcome: () => void;
}

export interface DictationInput {
	endpoints: RelayEndpoints | null;
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
	/** The draft's CURRENT text, read at the "transcribe and send" press and again
	 *  when the transcript lands: a draft that moved in between was edited by the
	 *  reader, and what they typed was never part of the press. Absent: not
	 *  checked. */
	readDraft?: () => string;
	/** Whether a whole draft would be sent as a slash command (a transcript must
	 *  not run one). Absent: nothing is one. */
	isSlashCommand?: (draft: string) => boolean;
}

export const useDictation = (input: DictationInput): DictationState => {
	const {
		endpoints,
		capabilities,
		sending,
		onTranscript,
		onError,
		onUnauthorized,
		readDraft,
		isSlashCommand,
	} = input;

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
	const readDraftRef = useRef(readDraft);
	readDraftRef.current = readDraft;
	const isSlashCommandRef = useRef(isSlashCommand);
	isSlashCommandRef.current = isSlashCommand;

	/* "Transcribe and send". `sendRequestRef` is the press (and the draft it saw);
	 * `sendPending` is what the Send control reads (inert until the press settles);
	 * `sendReady` is the hand-off to the host's effect. Three pieces because they
	 * are read by three different consumers, and ONE `endSendRequest` ends all of
	 * them, so no exit can leave Send inert. */
	const sendRequestRef = useRef<{ draft: string | null } | null>(null);
	const [sendPending, setSendPending] = useState(false);
	const [sendReady, setSendReady] = useState(false);
	const endSendRequest = useCallback(() => {
		sendRequestRef.current = null;
		setSendPending(false);
		setSendReady(false);
	}, []);

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

	const stopAndTranscribe = useCallback(async () => {
		const active = activeRef.current;
		if (active === null) return;
		const run = ++runIdRef.current;
		clearTimers();
		dispatch({ type: "stop" });
		activeRef.current = null;
		let recording = null;
		try {
			recording = await active.stop();
		} catch {
			recording = null;
		}
		if (run !== runIdRef.current) return;
		if (recording === null) {
			/* Nothing was captured — a stop that produced no file is the same reader
			 * outcome as an empty transcript (D2's sentence). */
			endSendRequest();
			dispatch({ type: "settle", outcome: "empty" });
			return;
		}
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
						return endpoints.transcribe(
							{ audio: await recordingUploadPart(rec) },
							options,
						);
					},
					discard: discardRecording,
				},
				{ signal: controller.signal },
			);
			/* A cancel or a send superseded this run: the result is dropped, and its
			 * own line (if any) has already been set. */
			if (run !== runIdRef.current) return;
			if (outcome.kind === "transcript") {
				const request = sendRequestRef.current;
				const before = readDraftRef.current?.() ?? null;
				onTranscriptRef.current(outcome.text, outcome.path);
				if (request !== null) {
					/* The words are in the box either way. Whether they are also SENT is
					 * decided against the draft the press saw, and the send itself runs in
					 * the host's effect, against the render that holds the transcript. */
					const sendable = transcriptSendable({
						transcript: outcome.text,
						draftAtPress: request.draft,
						draftAtLanding: before,
						joined: joinDraft(before ?? "", outcome.text),
						isSlashCommand: isSlashCommandRef.current ?? (() => false),
					});
					if (sendable) setSendReady(true);
					else endSendRequest();
				}
				/* U3: the completion announcement. It is the machine's outcome rather
				 * than a second notice state, so it rides the same polite row the live
				 * states use. */
				dispatch({ type: "settle", outcome: "added" });
			} else if (outcome.kind === "empty") {
				endSendRequest();
				dispatch({ type: "settle", outcome: "empty" });
			} else {
				endSendRequest();
				dispatch({ type: "settle", outcome: null });
				onErrorRef.current(outcome.sentence);
			}
		} catch (cause) {
			if (run !== runIdRef.current) return;
			endSendRequest();
			dispatch({ type: "settle", outcome: null });
			/* Only the `clear-all` (401) arm reaches here; `dictate` turns every other
			 * failure into a sentence. The caller's own handler owns the reload rule. */
			onUnauthorizedRef.current?.(cause);
		} finally {
			if (abortRef.current === controller) abortRef.current = null;
		}
	}, [clearTimers, dispatch, endSendRequest, endpoints]);

	const openMic = useCallback(async () => {
		/* The permission is asked HERE, at the press — never at first launch. */
		const permission = await requestMicPermission();
		/* Cancelled (or superseded) while the prompt was up: never leave a recorder
		 * hot. The machine has already moved off `starting` if so. */
		if (snapshotRef.current.phase !== "starting") return;
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
		if (snapshotRef.current.phase !== "starting") {
			if (active !== null) void active.cancel();
			return;
		}
		if (active === null) {
			dispatch({ type: "mic-refused", blocked: false });
			return;
		}
		activeRef.current = active;
		const run = runIdRef.current;
		dispatch({ type: "mic-opened" });
		setSeconds(0);
		meter.set([]);
		tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
		meterTimerRef.current = setInterval(() => {
			if (run !== runIdRef.current) return;
			const level = active.level();
			if (level !== null) meter.push(level);
		}, METER_INTERVAL_MS);
		/* The cap STOPS and TRANSCRIBES; it is a bound on the recording, not a
		 * discard. The recorder is also given the same bound natively
		 * (`startRecording`), which is what holds while the app is backgrounded. */
		capRef.current = setTimeout(() => {
			void stopAndTranscribe();
		}, MAX_RECORDING_MS);
	}, [dispatch, meter, stopAndTranscribe]);

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
		/* A discarded take cannot be sent. */
		endSendRequest();
		meter.set([]);
		setSeconds(0);
	}, [clearTimers, endSendRequest, meter]);

	const press = useCallback(() => {
		const phase = snapshotRef.current.phase;
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
		if (effects.includes("open-mic")) void openMic();
	}, [
		dispatch,
		endpoints,
		micSetup,
		micVisible,
		openMic,
		sending,
		stopAndTranscribe,
	]);

	const cancel = useCallback(() => {
		const { effects } = dispatch({ type: "cancel" });
		if (
			!effects.includes("abort-request") &&
			!effects.includes("discard-recording")
		)
			return;
		discardLive();
	}, [discardLive, dispatch]);

	const finishAndSend = useCallback(() => {
		const phase = snapshotRef.current.phase;
		if (phase !== "recording" && phase !== "transcribing") return;
		if (sendRequestRef.current !== null) return;
		sendRequestRef.current = { draft: readDraftRef.current?.() ?? null };
		setSendPending(true);
		/* While transcribing the stop already happened; the press only rides the
		 * transcript that is on its way. */
		if (phase === "recording") void stopAndTranscribe();
	}, [stopAndTranscribe]);

	const ackSend = useCallback(() => {
		endSendRequest();
	}, [endSendRequest]);

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
	useEffect(
		() => () => {
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
		},
		[clearTimers],
	);

	return {
		micVisible,
		micSetup,
		phase: forced?.phase ?? snapshot.phase,
		seconds,
		status: dictationStatusLine(forced ?? snapshot),
		outcome: (forced ?? snapshot).outcome,
		sendMode: dictatedSendState({
			phase: forced?.phase ?? snapshot.phase,
			sendPending,
		}),
		sendReady,
		meter,
		press,
		cancel,
		finishAndSend,
		ackSend,
		cancelForSend,
		clearOutcome,
	};
};

/**
 * The host half of "transcribe and send": once the transcript is in the draft,
 * send it. An effect, not a call from the hook, because the send reads the draft
 * of the render it runs in — a call made in the same tick as the append would
 * send the draft from before the transcript. `send` is the host's own send, so
 * every refusal it has (a send in flight, an unresolved instruction) leaves the
 * words in the box like any other send would.
 */
export const useDictatedSend = (
	voice: Pick<DictationState, "sendReady" | "ackSend">,
	send: () => void,
): void => {
	const { sendReady, ackSend } = voice;
	useEffect(() => {
		if (!sendReady) return;
		ackSend();
		send();
	}, [sendReady, ackSend, send]);
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
		readDraft: () => draftRef.current,
	});
};

/** Re-exported so a caller (or a test) can read the seed state without the live
 *  recorder: the permission this build would report before any prompt. */
export const initialMicPermission = readMicPermission;

export { STT_COPY };
