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
import { type RelayEndpoints, RelayError } from "@/relay";
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
	discard: vi.fn(async (_recording: MicrophoneRecording) => undefined),
	part: vi.fn(async (rec: MicrophoneRecording) => ({
		name: rec.name,
		type: rec.mimeType,
		bytes: async () => new Uint8Array([17, 0, 255]),
	})),
}));

vi.mock("@/stt/recorder", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/stt/recorder")>()),
	canRecord: () => true,
	warmRecorder: () => undefined,
	requestMicPermission: async () => mic.permission,
	startRecording: async () => mic.start(),
	discardRecording: mic.discard,
	/* The upload reads the file through `expo-file-system` (#337), which has no
	 * Node host; the stand-in keeps the real part's shape. */
	recordingUploadPart: mic.part,
}));

/** Drive the existing non-secret authorization-generation seam, not credentials.
 * Both hooks subscribe to it; stable route/session tests can change only account. */
const auth = vi.hoisted(() => ({
	current: null as { scope: string; revision: number } | null,
	listeners: new Set<() => void>(),
}));
vi.mock("@/connection/startup-authorization", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/connection/startup-authorization")
	>()),
	getStartupAuthorization: () => auth.current,
	subscribeStartupAuthorization: (listener: () => void) => {
		auth.listeners.add(listener);
		return () => auth.listeners.delete(listener);
	},
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
	const uploads: Uint8Array[] = [];
	const transcribe = {
		status: 200,
		body: JSON.stringify({ text: "", path: "" }),
		answer: null as (() => Promise<{ status: number; text: string }>) | null,
	};
	const client = {
		command(_sessionId: string, body: Record<string, unknown>) {
			commands.push(body);
			return Promise.resolve({ ok: true, detail: "queued" });
		},
		transcribe: async (part: {
			audio: { bytes: () => Promise<Uint8Array> };
		}) => {
			uploads.push(await part.audio.bytes());
			return (
				transcribe.answer?.() ?? {
					status: transcribe.status,
					text: transcribe.body,
				}
			);
		},
	} as unknown as RelayEndpoints;
	return { client, commands, transcribe, uploads };
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
	mic.discard.mockClear();
	mic.part.mockClear();
	auth.current = null;
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

const TAKE: MicrophoneRecording = {
	uri: "file:///synthetic/recoverable-take.m4a",
	name: "recoverable-take.m4a",
	mimeType: "audio/mp4",
	durationMs: 1200,
};

function installTake(
	stop: () => Promise<MicrophoneRecording | null> = async () => TAKE,
) {
	const start = vi.fn(() => ({
		stop,
		cancel: async () => undefined,
		level: () => null,
	}));
	mic.start = start;
	return start;
}

async function finishTake() {
	await act(async () => c().voice.press());
	await settle();
	expect(c().voice.phase).toBe("recording");
	await act(async () => c().voice.press());
	await settle();
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const switchAccount = async (scope: string) => {
	await act(async () => {
		auth.current = { scope, revision: (auth.current?.revision ?? 0) + 1 };
		for (const listener of auth.listeners) listener();
	});
};

describe("manual recovery through the real composer and dictation hooks", () => {
	it("retains failure without automatic work, retries the same bytes once and never sends", async () => {
		const h = fakeClient();
		h.transcribe.status = 502;
		const start = installTake();
		await mount(h.client, "original");
		await finishTake();
		expect(c().voice.phase).toBe("failed");
		expect(c().draft).toBe("original");
		expect(h.uploads).toHaveLength(1);
		expect(mic.discard).not.toHaveBeenCalled();
		await settle();
		expect(h.uploads).toHaveLength(1);
		await act(async () => c().setDraft("edited"));
		expect(c().voice.phase).toBe("failed");
		h.transcribe.status = 200;
		h.transcribe.body = JSON.stringify({
			text: "recovered",
			path: "synthetic-stt",
		});
		await act(async () => {
			c().voice.press();
			c().voice.press();
			c().voice.press();
		});
		await settle();
		expect(h.uploads).toEqual([
			new Uint8Array([17, 0, 255]),
			new Uint8Array([17, 0, 255]),
		]);
		expect(mic.part.mock.calls.map(([rec]) => rec)).toEqual([TAKE, TAKE]);
		expect(start).toHaveBeenCalledTimes(1);
		expect(c().draft).toBe("edited recovered");
		expect(c().voice.phase).toBe("idle");
		expect(c().error).toBeFalsy();
		expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
		expect(h.commands).toEqual([]);
	});

	it("keeps a second failure until explicit Discard, which sends nothing", async () => {
		const h = fakeClient();
		h.transcribe.answer = async () => {
			throw new Error("synthetic network failure");
		};
		installTake();
		await mount(h.client, "typed");
		await finishTake();
		await act(async () => c().voice.press());
		await settle();
		expect(c().voice.phase).toBe("failed");
		expect(h.uploads).toHaveLength(2);
		expect(mic.discard).not.toHaveBeenCalled();
		await act(async () => c().voice.cancel());
		await settle();
		expect(c().voice.phase).toBe("idle");
		expect(c().error).toBeFalsy();
		expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
		expect(c().draft).toBe("typed");
		expect(h.commands).toEqual([]);
	});

	for (const boundary of ["route", "session", "account"] as const) {
		it(`drops a late success across a ${boundary} boundary without retargeting`, async () => {
			const h = fakeClient();
			const result = deferred<{ status: number; text: string }>();
			h.transcribe.answer = () => result.promise;
			installTake();
			await switchAccount("synthetic-account-a");
			await mount(h.client, "old draft");
			await finishTake();
			expect(c().voice.phase).toBe("transcribing");
			if (boundary === "route") await mount(fakeClient().client);
			if (boundary === "session") {
				SID = `${SID}-next`;
				await mount(h.client);
			}
			if (boundary === "account") await switchAccount("synthetic-account-b");
			await act(async () => c().setDraft("new draft"));
			await act(async () =>
				result.resolve({
					status: 200,
					text: JSON.stringify({ text: "stale" }),
				}),
			);
			await settle();
			expect(c().draft).toBe("new draft");
			expect(c().voice.phase).toBe("idle");
			expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
			expect(h.commands).toEqual([]);
		});

		it(`invalidates a retained retry across a ${boundary} boundary`, async () => {
			const h = fakeClient();
			h.transcribe.status = 502;
			installTake();
			await switchAccount("synthetic-account-a");
			await mount(h.client);
			await finishTake();
			expect(c().voice.phase).toBe("failed");
			const oldRetry = c().voice.press;
			if (boundary === "route") await mount(fakeClient().client);
			if (boundary === "session") {
				SID = `${SID}-next`;
				await mount(h.client);
			}
			if (boundary === "account") await switchAccount("synthetic-account-b");
			await act(async () => oldRetry());
			await settle();
			expect(h.uploads).toHaveLength(1);
			expect(c().voice.phase).toBe("idle");
			expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
		});
	}

	it("never starts an upload if the audio adapter resolves after account change", async () => {
		const h = fakeClient();
		const ready = deferred<void>();
		mic.part.mockImplementationOnce(async (rec) => {
			await ready.promise;
			return {
				name: rec.name,
				type: rec.mimeType,
				bytes: async () => new Uint8Array([17, 0, 255]),
			};
		});
		installTake();
		await switchAccount("synthetic-account-a");
		await mount(h.client, "typed");
		await finishTake();
		expect(h.uploads).toEqual([]);
		await switchAccount("synthetic-account-b");
		await act(async () => ready.resolve());
		await settle();
		expect(h.uploads).toEqual([]);
		expect(c().draft).toBe("typed");
		expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
	});

	it("fences a changed authorization generation before any subscriber render", async () => {
		const h = fakeClient();
		const result = deferred<{ status: number; text: string }>();
		h.transcribe.answer = () => result.promise;
		installTake();
		await switchAccount("synthetic-account-a");
		await mount(h.client, "typed");
		await finishTake();
		// Same account scope, but a fresh authorization revision is also a boundary.
		// Deliberately omit listener notification: only the synchronous getter can win.
		auth.current = { scope: "synthetic-account-a", revision: 2 };
		await act(async () =>
			result.resolve({ status: 200, text: JSON.stringify({ text: "stale" }) }),
		);
		await settle();
		expect(c().draft).toBe("typed");
		expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
		await act(async () => {
			for (const listener of auth.listeners) listener();
		});
		expect(c().voice.phase).toBe("idle");
	});

	it("preserves 401 handling and deletes instead of offering cross-login recovery", async () => {
		const h = fakeClient();
		h.transcribe.answer = async () => {
			throw new RelayError("relay-unauthorized", "synthetic auth required", {
				status: 401,
			});
		};
		installTake();
		await mount(h.client, "typed");
		await finishTake();
		expect(c().voice.phase).toBe("idle");
		expect(c().error).toBeTruthy();
		expect(c().draft).toBe("typed");
		expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
		expect(h.uploads).toHaveLength(1);
		expect(h.commands).toEqual([]);
	});

	it("drops a late result after Discard even when the endpoint ignores abort", async () => {
		const h = fakeClient();
		const result = deferred<{ status: number; text: string }>();
		h.transcribe.answer = () => result.promise;
		installTake();
		await mount(h.client, "typed");
		await finishTake();
		await act(async () => c().voice.cancel());
		await act(async () =>
			result.resolve({ status: 200, text: JSON.stringify({ text: "stale" }) }),
		);
		await settle();
		expect(c().draft).toBe("typed");
		expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
	});

	it("deletes a file whose native stop finishes after unmount", async () => {
		const h = fakeClient();
		const stopped = deferred<MicrophoneRecording | null>();
		installTake(() => stopped.promise);
		await mount(h.client);
		await finishTake();
		await act(async () => root?.unmount());
		root = null;
		await act(async () => stopped.resolve(TAKE));
		await settle();
		expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
		expect(h.uploads).toEqual([]);
	});

	it("leaves typed-send semantics intact: only explicit send submits a command", async () => {
		const h = fakeClient();
		h.transcribe.status = 502;
		installTake();
		await mount(h.client, "typed message");
		await finishTake();
		expect(h.commands).toEqual([]);
		await act(async () => c().send());
		await settle();
		expect(h.commands).toHaveLength(1);
		expect(h.commands[0]).toMatchObject({
			op: "prompt",
			text: "typed message",
		});
		expect(mic.discard).toHaveBeenCalledExactlyOnceWith(TAKE);
		expect(c().voice.phase).toBe("idle");
	});
});
