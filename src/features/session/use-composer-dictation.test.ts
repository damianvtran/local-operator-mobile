/**
 * Issue #323 through the REAL composer hook (`use-composer.ts`) and the real
 * dictation hook under it: a resting mic line ("Couldn’t start recording…")
 * stayed on the dictation row after the reader typed and sent, because nothing
 * but a new press, a cancel or `available` ever left it.
 *
 * The machine's rule is pinned in `stt/__tests__/dictation-machine.test.ts`; this
 * file pins the WIRING the rule depends on: the field's change handler
 * (`ComposerState.setDraft`, what the session screen hands the TextInput) ends
 * the line, a send ends it, and the transcript append does NOT — it is what the
 * `added` line announces, so ending it there would hide the announcement.
 *
 * Only the platform edge is faked: `@/stt/recorder` (no native recorder in Node)
 * answers the permission and the start as each test needs, and the relay client
 * is a fake that accepts every command and answers a transcription at once. The draft is driven through the hook's `editor` seam,
 * as in `use-composer-echo.test.ts`, so no device storage read races the
 * assertions.
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Capabilities, PromptImage } from "@/contracts";
import { outbox } from "@/features/session/outbox";
import { clearPendingEchoes } from "@/features/session/pending-echo";
import {
	type ComposerState,
	useComposer,
} from "@/features/session/use-composer";
import type { RelayEndpoints } from "@/relay";
import { DICTATION_OUTCOME_COPY } from "@/stt/dictation-machine";
import type {
	ActiveRecording,
	MicPermission,
	MicrophoneRecording,
} from "@/stt/recorder";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/** What the fake platform answers on the next press. */
const mic = vi.hoisted(() => ({
	permission: "granted" as MicPermission,
	start: (): ActiveRecording | null => null,
}));

vi.mock("@/stt/recorder", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/stt/recorder")>()),
	canRecord: () => true,
	warmRecorder: () => undefined,
	requestMicPermission: async () => mic.permission,
	startRecording: async () => mic.start(),
	discardRecording: async () => undefined,
	/* The upload reads the file through `expo-file-system` (#337), which has no
	 * Node host; the stand-in keeps the real part's shape. */
	recordingUploadPart: async (rec: MicrophoneRecording) => ({
		name: rec.name,
		type: rec.mimeType,
		bytes: async () => new Uint8Array([1]),
	}),
}));

// Native UUID generation belongs to Expo; this Node hook host has no bridge.
vi.mock("expo-crypto", async () => ({
	randomUUID: (await import("node:crypto")).randomUUID,
}));

// Device storage does not exist in Node; the envelope store needs a backing.
vi.mock("@/features/session/envelope-store", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/features/session/envelope-store")>();
	const relay = await import("@/relay");
	const stores = new Map<
		string,
		InstanceType<typeof relay.RetryEnvelopeStore>
	>();
	return {
		...original,
		envelopeStoreFor: (sessionId: string) => {
			let store = stores.get(sessionId);
			if (store === undefined) {
				store = new relay.RetryEnvelopeStore({
					store: relay.memoryEnvelopeStore(),
				});
				stores.set(sessionId, store);
			}
			return store;
		},
	};
});

/** A relay that advertises speech-to-text, so the mic is live (not set-up). */
const VOICE = {
	stt: { available: true, path: "synthetic-stt" },
} as unknown as Capabilities;

let SID = "s-composer-dictation-0";
let sessions = 0;

function fakeClient() {
	const commands: Record<string, unknown>[] = [];
	const transcribe = {
		body: JSON.stringify({ text: "", path: "" }),
		/** Held open by a test that needs the transcription to still be in flight. */
		gate: null as Promise<void> | null,
	};
	const client = {
		command(_sessionId: string, body: Record<string, unknown>) {
			commands.push(body);
			return Promise.resolve({ ok: true, detail: "queued" });
		},
		transcribe: async () => {
			await transcribe.gate;
			return { status: 200, text: transcribe.body };
		},
	} as unknown as RelayEndpoints;
	return { client, commands, transcribe };
}

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let composer: ComposerState | null = null;

function Host({
	client,
	initial,
}: {
	client: RelayEndpoints;
	initial: string;
}) {
	const [draft, setDraft] = useState(initial);
	const [images, setImages] = useState<PromptImage[]>([]);
	composer = useComposer({
		sessionId: SID,
		source: {
			endpoints: client,
			baseUrl: null,
			fromOrigin: false,
			reason: "ok",
		},
		streaming: false,
		ended: false,
		capabilities: VOICE,
		editor: { draft, images, setDraft, setImages },
	});
	return null;
}

const c = () => composer as ComposerState;

const mount = async (client: RelayEndpoints, initial = "") => {
	await act(async () => root?.render(createElement(Host, { client, initial })));
};

/** Lets the hook's awaits (permission, start, upload) run, then flushes renders. */
const settle = async () => {
	for (let i = 0; i < 5; i++)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
};

/** A press the fake platform refuses, resting the row on its line. */
const refusedPress = async (permission: MicPermission) => {
	mic.permission = permission;
	await act(async () => c().voice.press());
	await settle();
};

beforeEach(() => {
	sessions += 1;
	SID = `s-composer-dictation-${sessions}`;
	mic.permission = "granted";
	mic.start = () => null;
	clearPendingEchoes();
	composer = null;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});

afterEach(async () => {
	outbox.abandonAll();
	vi.restoreAllMocks();
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	clearPendingEchoes();
});

describe("a resting mic line in the session composer (issue #323)", () => {
	it("ends on the reader's own edit of the draft", async () => {
		const { client } = fakeClient();
		await mount(client);
		// `undetermined` is "the permission could not be asked": the mic-failed line.
		await refusedPress("undetermined");
		expect(c().voice.status).toBe(DICTATION_OUTCOME_COPY["mic-failed"]);
		await act(async () => c().setDraft("t"));
		expect(c().voice.status).toBe("");
		expect(c().draft).toBe("t");
	});

	it("ends when the reader clears the draft with × (round 1, D1/Q1)", async () => {
		// The clear-draft control is the reader's own deletion; without this the
		// line sat under an emptied field, the exact frame #323 was reported from.
		const { client } = fakeClient();
		await mount(client, "summarise the notes");
		await refusedPress("undetermined");
		expect(c().voice.status).toBe(DICTATION_OUTCOME_COPY["mic-failed"]);
		await act(async () => c().clearUnsentDraft());
		expect(c().draft).toBe("");
		expect(c().voice.status).toBe("");
	});

	it("ends when the message is sent", async () => {
		const { client, commands } = fakeClient();
		await mount(client, "summarise the notes");
		await refusedPress("denied");
		expect(c().voice.status).toBe(DICTATION_OUTCOME_COPY.blocked);
		await act(async () => c().send());
		await settle();
		expect(commands).toHaveLength(1);
		expect(c().voice.status).toBe("");
	});

	it("keeps the transcript's own line through the append, and ends it on the next edit", async () => {
		const { client, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "run the tests", path: "x" });
		mic.start = () => ({
			stop: async () => ({
				uri: "file:///synthetic/take.m4a",
				name: "take.m4a",
				mimeType: "audio/mp4",
				durationMs: 1200,
			}),
			cancel: async () => undefined,
			level: () => null,
		});
		await mount(client);
		await act(async () => c().voice.press());
		await settle();
		expect(c().voice.phase).toBe("recording");
		await act(async () => c().voice.press());
		await settle();
		// The append landed AND its announcement survived it: the transcript setter
		// is not the field's change handler.
		expect(c().draft).toBe("run the tests");
		expect(c().voice.status).toBe(DICTATION_OUTCOME_COPY.added);
		await act(async () => c().setDraft("run the tests twice"));
		expect(c().voice.status).toBe("");
	});
});

/** A fake microphone that records one take of synthetic audio. */
const recordTake = () => {
	mic.start = () => ({
		stop: async () => ({
			uri: "file:///synthetic/take.m4a",
			name: "take.m4a",
			mimeType: "audio/mp4",
			durationMs: 1200,
		}),
		cancel: async () => undefined,
		level: () => null,
	});
};

const startRecording = async () => {
	await act(async () => c().voice.press());
	await settle();
	expect(c().voice.phase).toBe("recording");
};

describe("Stop and Send while recording (Ben, 2026-11-22)", () => {
	it("Stop transcribes into the box and sends nothing", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "run the tests", path: "x" });
		recordTake();
		await mount(client);
		await startRecording();
		// The mic slot's ✓ is the press that stops.
		await act(async () => c().voice.press());
		await settle();
		expect(c().draft).toBe("run the tests");
		expect(commands).toHaveLength(0);
	});

	it("leaves no visible line after a transcript lands, only the announcement", async () => {
		const { client, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "run the tests", path: "x" });
		recordTake();
		await mount(client);
		await startRecording();
		await act(async () => c().voice.press());
		await settle();
		// The announcement is still said (a screen reader hears it) ...
		expect(c().voice.status).toBe(DICTATION_OUTCOME_COPY.added);
		// ... but the composer is told it is `added`, which draws no row.
		expect(c().voice.outcome).toBe("added");
	});

	it("keeps Send live on an empty draft while recording, labelled for what it does", async () => {
		const { client } = fakeClient();
		recordTake();
		await mount(client);
		expect(c().controls.primary.disabled).toBe(true);
		await startRecording();
		expect(c().controls.primary.disabled).toBe(false);
		expect(c().controls.primary.accessibilityLabel).toBe("Transcribe and send");
	});

	it("Send transcribes the take and sends the words at once", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "run the tests", path: "x" });
		recordTake();
		await mount(client);
		await startRecording();
		await act(async () => c().send());
		await settle();
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ op: "prompt", text: "run the tests" });
		// Dictated, and said so for the provenance annotation.
		expect(commands[0]).toHaveProperty("input_mode");
		expect(c().voice.phase).toBe("idle");
		expect(c().voice.sendMode).toBeNull();
		// A message that left carries no resting "Transcript added" with it.
		expect(c().voice.status).toBe("");
	});

	it("Send joins the words to what was already typed and sends the whole", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "twice", path: "x" });
		recordTake();
		await mount(client, "run the tests");
		await startRecording();
		await act(async () => c().send());
		await settle();
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ text: "run the tests twice" });
	});

	it("is inert while its transcript is on the way, and a second tap sends nothing twice", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "run the tests", path: "x" });
		let release = () => {};
		transcribe.gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		recordTake();
		await mount(client);
		await startRecording();
		await act(async () => c().send());
		await settle();
		expect(c().voice.phase).toBe("transcribing");
		expect(c().voice.sendMode).toBe("pending");
		expect(c().controls.primary.disabled).toBe(true);
		await act(async () => c().send());
		await act(async () => release());
		await settle();
		expect(commands).toHaveLength(1);
	});

	it("Send tapped while the Stop transcription is still running sends when it lands", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "run the tests", path: "x" });
		let release = () => {};
		transcribe.gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		recordTake();
		await mount(client);
		await startRecording();
		await act(async () => c().voice.press());
		await settle();
		expect(c().voice.phase).toBe("transcribing");
		expect(c().voice.sendMode).toBe("live");
		await act(async () => c().send());
		expect(commands).toHaveLength(0);
		await act(async () => release());
		await settle();
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ text: "run the tests" });
	});

	it("× while waiting sends nothing and says nothing", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "run the tests", path: "x" });
		let release = () => {};
		transcribe.gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		recordTake();
		await mount(client);
		await startRecording();
		await act(async () => c().send());
		await settle();
		await act(async () => c().voice.cancel());
		await act(async () => release());
		await settle();
		expect(commands).toHaveLength(0);
		expect(c().draft).toBe("");
		expect(c().voice.sendMode).toBeNull();
		expect(c().voice.status).toBe("");
	});

	it("puts the words in the box and sends nothing when the box was edited meanwhile", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "twice", path: "x" });
		let release = () => {};
		transcribe.gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		recordTake();
		await mount(client, "run the tests");
		await startRecording();
		await act(async () => c().send());
		await settle();
		await act(async () => c().setDraft("run the tests please"));
		await act(async () => release());
		await settle();
		expect(commands).toHaveLength(0);
		expect(c().draft).toBe("run the tests please twice");
		expect(c().voice.sendMode).toBeNull();
	});

	it("never sends a transcript that would make the box a slash command", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "/clear", path: "x" });
		recordTake();
		await mount(client);
		await startRecording();
		await act(async () => c().send());
		await settle();
		expect(commands).toHaveLength(0);
		expect(c().draft).toBe("/clear");
		expect(c().voice.sendMode).toBeNull();
	});

	it("sends nothing for a blank transcript and says it did not catch it", async () => {
		const { client, commands, transcribe } = fakeClient();
		transcribe.body = JSON.stringify({ text: "  ", path: "" });
		recordTake();
		await mount(client);
		await startRecording();
		await act(async () => c().send());
		await settle();
		expect(commands).toHaveLength(0);
		expect(c().voice.status).toBe(DICTATION_OUTCOME_COPY.empty);
		expect(c().voice.sendMode).toBeNull();
	});
});
