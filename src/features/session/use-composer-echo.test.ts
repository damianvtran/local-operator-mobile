/**
 * The pending echo through the REAL composer hook (`use-composer.ts`), not a
 * copy of its wiring (review round 1, R5): the ack's empty-composer branch, the
 * failed-row path a definitive refusal takes while the reader is typing the
 * next message (R1/Q1/U1), the put-back, the unconfirmed row (U3), the silent
 * rapid-steer ack (U2) and the Retry arm's repaint under the same id.
 *
 * The draft is driven through the hook's `editor` input — the adopted-editor
 * seam the screen uses — so no device storage read races the assertions. The
 * relay client is a hand-resolved fake: each request stays open until the
 * test settles it, which is what lets the reader "type" mid-flight. The one
 * substitution is the envelope store's BACKING: device storage does not exist
 * in Node (`holdNew` refuses to hold without it), so the hook's per-session
 * store is the real `RetryEnvelopeStore` over the in-memory backing the relay
 * tests use.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRelayClient } from "@/connection";
import type { PromptImage, SlashCommand } from "@/contracts";
import * as attachmentSources from "@/features/session/attach";
import { composerCopy, composerFeedback } from "@/features/session/composer";
import { outbox } from "@/features/session/outbox";
import {
	clearPendingEchoes,
	type PendingEcho,
	pendingEchoBoxClass,
	pendingEchoCaption,
	usePendingEchoes,
} from "@/features/session/pending-echo";
import {
	type ComposerState,
	useComposer,
} from "@/features/session/use-composer";
import { useStoredModel } from "@/features/session/use-stored-model";
import { type RelayEndpoints, RelayError } from "@/relay";
import { MAX_STORED_ENVELOPE_CHARS } from "@/relay/retry-envelope";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

// PR #353 U1: the settings sentence must name neither the Send nor the Retry button.
const NAMES_SEND = /\bsend\b/i;
const NAMES_RETRY = /\bretry\b/i;

const storageFault = vi.hoisted(() => ({
	failWrite: false,
	reads: 0,
	failReadAt: 0,
}));

// Native UUID generation belongs to Expo; this Node hook host has no bridge.
vi.mock("expo-crypto", async () => ({
	randomUUID: (await import("node:crypto")).randomUUID,
}));

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
				const backing = relay.memoryEnvelopeStore();
				const set = backing.set.bind(backing);
				const get = backing.get.bind(backing);
				backing.get = async (key) => {
					storageFault.reads++;
					if (storageFault.reads === storageFault.failReadAt)
						throw new Error("synthetic private read failure");
					return get(key);
				};
				backing.set = async (key, value) => {
					if (storageFault.failWrite)
						throw new Error("synthetic private file failure");
					return set(key, value);
				};
				store = new relay.RetryEnvelopeStore({
					store: backing,
				});
				stores.set(sessionId, store);
			}
			return store;
		},
	};
});

/** A fresh session per test, so no envelope carries over between them. */
let SID = "s-composer-echo-0";
let sessions = 0;

/** One open request: the body the hook sent and the hand that settles it. */
type Pending = {
	body: Record<string, unknown>;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
};

function handClient() {
	const open: Pending[] = [];
	const client = {
		command(_sessionId: string, body: Record<string, unknown>) {
			return new Promise((resolve, reject) => {
				open.push({ body, resolve, reject });
			});
		},
	} as unknown as RelayEndpoints;
	return { client, open };
}

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let composer: ComposerState | null = null;
let rows: PendingEcho[] = [];
let storedSettings = false;
let ownership = "local";
let settingsServer: Server | null = null;
let storedModel: ReturnType<typeof useStoredModel>;

function Host({
	client,
	initial,
	streaming,
	ended,
	slashRefusal = null,
}: {
	client: RelayEndpoints | null;
	initial: string;
	streaming: boolean;
	ended: boolean;
	slashRefusal?: null | string;
}) {
	const [draft, setDraft] = useState(initial);
	const [images, setImages] = useState<PromptImage[]>([]);
	storedModel = useStoredModel({
		client,
		sessionId: SID,
		enabled: storedSettings && ended && ownership === "local",
		ownership,
		ended,
	});
	composer = useComposer({
		beforeSend: storedSettings ? storedModel.prepare : undefined,
		sessionId: SID,
		source: {
			endpoints: client,
			baseUrl: null,
			fromOrigin: false,
			reason: "ok",
		},
		streaming,
		ended,
		capabilities: null,
		editor: { draft, images, setDraft, setImages },
		slashRefusal,
	});
	rows = usePendingEchoes(SID, []);
	return null;
}

const mount = async (
	client: RelayEndpoints | null,
	initial: string,
	streaming = true,
	ended = false,
) => {
	await act(async () =>
		root?.render(createElement(Host, { client, initial, streaming, ended })),
	);
};

/** Lets the hook's awaits (envelope hold, peek) run, then flushes renders. */
const settle = async () => {
	for (let i = 0; i < 5; i++)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
};

const c = () => composer as ComposerState;

beforeEach(() => {
	storedSettings = false;
	ownership = "local";
	storageFault.failWrite = false;
	storageFault.reads = 0;
	storageFault.failReadAt = 0;
	sessions += 1;
	SID = `s-composer-echo-${sessions}`;
	clearPendingEchoes();
	composer = null;
	rows = [];
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});

afterEach(async () => {
	/* The outbox is process-wide: a send one test left waiting must not retry
	 *  into the next test's session. */
	outbox.abandonAll();
	if (settingsServer) {
		const server = settingsServer;
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		settingsServer = null;
	}
	vi.restoreAllMocks();
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	clearPendingEchoes();
});

describe("stored session model intent through the real composer", () => {
	it("an unavailable route is a catalogue failure, not an endless loading spinner", async () => {
		storedSettings = true;
		await mount(null, "draft", false, true);
		expect(storedModel.failed).toBe(true);
		expect(storedModel.loading).toBe(false);
		expect(c().draft).toBe("draft");
	});
	const model = {
		selector: "example/model-a",
		provider: "example",
		model_id: "model-a",
		name: "Model A",
		efforts: ["low", "high"],
		connected: true,
	};
	it.each(["before", "resume", "set_model", "set_effort"])(
		"revokes local intent on ownership drift at %s",
		async (stage) => {
			storedSettings = true;
			let release!: () => void;
			const calls: string[] = [];
			const client = {
				models: async () => ({ models: [model] }),
				resumeSession: async () => {
					calls.push("resume");
					if (stage === "resume")
						await new Promise<void>((resolve) => {
							release = resolve;
						});
				},
				command: async (_id: string, body: Record<string, unknown>) => {
					calls.push(String(body.op));
					if (stage === body.op)
						await new Promise<void>((resolve) => {
							release = resolve;
						});
				},
			} as unknown as RelayEndpoints;
			await mount(client, "retained", false, true);
			await act(async () => storedModel.pick(model, "high"));
			let result: Promise<unknown> | undefined;
			if (stage !== "before") {
				result = storedModel.prepare().catch((error) => error);
				await settle();
			}
			ownership = "remote:other-device";
			await mount(client, "retained", false, true);
			if (stage !== "before") release();
			else result = storedModel.prepare().catch((error) => error);
			expect(await result).toBeInstanceOf(Error);
			expect(calls).toEqual(
				stage === "before"
					? []
					: stage === "resume"
						? ["resume"]
						: stage === "set_model"
							? ["resume", "set_model"]
							: ["resume", "set_model", "set_effort"],
			);
			await act(async () => c().send());
			await settle();
			expect(calls).not.toContain("prompt");
			expect(c().draft).toBe("retained");
		},
	);

	it.each(["model", "effort"])(
		"new live %s intent supersedes partial preparation before send",
		async (kind) => {
			storedSettings = true;
			let fail = true;
			let appliedModel = "";
			let appliedEffort = "";
			const requests: string[] = [];
			settingsServer = createServer(async (request, response) => {
				let data = "";
				for await (const chunk of request) data += String(chunk);
				const body = data ? JSON.parse(data) : {};
				const op =
					request.url === "/api/models"
						? "models"
						: request.url === "/api/sessions/resume"
							? "resume"
							: body.op;
				requests.push(op);
				if (op === "set_model") appliedModel = String(body.model_id);
				const refused = op === "set_effort" && fail;
				if (op === "set_effort" && !refused)
					appliedEffort = String(body.effort);
				response.writeHead(refused ? 409 : 200, {
					"content-type": "application/json",
				});
				response.end(
					JSON.stringify(
						refused
							? { error: "synthetic effort refusal" }
							: op === "models"
								? { models: [model] }
								: op === "resume"
									? { ok: true, session_id: SID, pid: 42 }
									: { ok: true, detail: "accepted" },
					),
				);
			});
			const server = settingsServer;
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const port = (settingsServer.address() as AddressInfo).port;
			const client = createRelayClient({
				route: {
					mode: "custom",
					baseUrl: `http://127.0.0.1:${port}`,
					allowInsecure: true,
				},
			});
			await mount(client, "retained", false, true);
			const image: PromptImage = {
				data_b64: "aGVsbG8=",
				mime_type: "image/png",
			};
			await act(async () => {
				storedModel.pick(model, "high");
				c().addImage(image);
			});
			await act(async () => {
				await expect(storedModel.prepare()).rejects.toMatchObject({
					status: 409,
				});
			});
			await mount(client, "retained", false, false);
			// Use precisely the callbacks wired to the production sheets. A second
			// refusal must retain the NEW intent, not restore the failed old choice.
			await act(async () => {
				const selection =
					kind === "model"
						? storedModel.selectModel({
								...model,
								model_id: "model-b",
								selector: "example/model-b",
							})
						: storedModel.selectEffort("low");
				await expect(selection).rejects.toMatchObject({ status: 409 });
			});
			expect(storedModel.pending?.model.model_id).toBe(
				kind === "model" ? "model-b" : "model-a",
			);
			expect(storedModel.pending?.effort).toBe(
				kind === "effort" ? "low" : "high",
			);
			expect(c().draft).toBe("retained");
			expect(c().images).toEqual([image]);
			fail = false;
			// No render between the explicit choice and Send: the synchronous intent
			// ref, shared preparation barrier and ACKs determine admission.
			await act(async () => {
				const selection =
					kind === "model"
						? storedModel.selectModel({
								...model,
								model_id: "model-b",
								selector: "example/model-b",
							})
						: storedModel.selectEffort("low");
				c().send();
				await selection;
			});
			await settle();
			expect(appliedModel).toBe(kind === "model" ? "model-b" : "model-a");
			expect(appliedEffort).toBe(kind === "effort" ? "low" : "high");
			expect(c().error).toBeNull();
			expect(requests.filter((op) => op !== "models")).toEqual([
				"resume",
				"set_model",
				"set_effort",
				"set_model",
				"set_effort",
				"set_model",
				"set_effort",
				"prompt",
			]);
		},
	);

	it("a newer live choice during an old ACK is the only model admitted by Send", async () => {
		storedSettings = true;
		let release!: () => void;
		let hold = true;
		let appliedModel = "";
		let promptModel = "";
		const calls: string[] = [];
		const client = {
			models: async () => ({ models: [model] }),
			resumeSession: async () => ({ ok: true, session_id: SID, pid: 42 }),
			command: async (_id: string, body: Record<string, unknown>) => {
				calls.push(String(body.op));
				if (body.op === "set_model") {
					if (hold)
						await new Promise<void>((resolve) => {
							release = resolve;
						});
					appliedModel = String(body.model_id);
				}
				if (body.op === "prompt") promptModel = appliedModel;
				return { ok: true, detail: "accepted" };
			},
		} as unknown as RelayEndpoints;
		await mount(client, "retained", false, true);
		await act(async () => storedModel.pick(model, "high"));
		const preparing = storedModel.resume();
		await settle();
		await mount(client, "retained", false, false);
		hold = false;
		await act(async () => {
			const selecting = storedModel.selectModel({
				...model,
				model_id: "model-b",
				selector: "example/model-b",
				efforts: ["low"],
			});
			c().send();
			release();
			await Promise.all([preparing, selecting]);
		});
		await settle();
		// The new ladder excludes high, so the existing picker policy resets to
		// the model default (null): no stale high effort may reach the computer.
		expect(calls).toEqual(["set_model", "set_model", "prompt"]);
		expect(promptModel).toBe("model-b");
		expect(storedModel.pending).toBeNull();
		expect(c().error).toBeNull();
	});

	it("loads without a runtime, picks without waking, and sends once after same-session resume/model/effort", async () => {
		storedSettings = true;
		const calls: { sessionId: string; body: Record<string, unknown> }[] = [];
		const client = {
			models: vi.fn(async () => ({ models: [model] })),
			resumeSession: vi.fn(async (sessionId: string) => {
				calls.push({ sessionId, body: { op: "resume" } });
				return { ok: true, session_id: sessionId, pid: 42 };
			}),
			command: vi.fn(
				async (sessionId: string, body: Record<string, unknown>) => {
					calls.push({ sessionId, body });
					return { ok: true, detail: "accepted" };
				},
			),
		} as unknown as RelayEndpoints;
		await mount(client, "keep this conversation", false, true);
		expect(storedModel.models).toEqual([model]);
		expect(client.models).toHaveBeenCalledTimes(1);
		await act(async () => storedModel.pick(model, "high"));
		expect(calls).toEqual([]);
		expect(c().draft).toBe("keep this conversation");
		const image: PromptImage = { data_b64: "aGVsbG8=", mime_type: "image/png" };
		await act(async () => c().addImage(image));
		await act(async () => {
			const reopening = storedModel.resume();
			c().send();
			c().send();
			await reopening;
		});
		await settle();
		expect(calls.map((call) => call.body.op)).toEqual([
			"resume",
			"set_model",
			"set_effort",
			"prompt",
		]);
		expect(calls.every((call) => call.sessionId === SID)).toBe(true);
		expect(calls[1]?.body).toEqual({
			op: "set_model",
			provider: "example",
			model_id: "model-a",
		});
		expect(calls[2]?.body).toEqual({ op: "set_effort", effort: "high" });
		expect(calls[3]?.body).toMatchObject({
			text: "keep this conversation",
			images: [image],
		});
		expect(c().error).toBeNull();
	});

	it("settings refusal admits no prompt and preserves draft, attachment and choice for retry", async () => {
		storedSettings = true;
		let fail = true;
		const calls: string[] = [];
		const client = {
			models: async () => ({ models: [model] }),
			resumeSession: async () => ({ ok: true, session_id: SID, pid: 42 }),
			command: async (_id: string, body: Record<string, unknown>) => {
				calls.push(String(body.op));
				if (fail && body.op === "set_effort")
					throw new Error("synthetic refusal");
				return { ok: true, detail: "accepted" };
			},
		} as unknown as RelayEndpoints;
		await mount(client, "retained", false, true);
		await act(async () => storedModel.pick(model, "high"));
		const image: PromptImage = { data_b64: "aGVsbG8=", mime_type: "image/png" };
		await act(async () => c().addImage(image));
		await act(async () => c().send());
		await settle();
		expect(calls).toEqual(["set_model", "set_effort"]);
		expect(c().draft).toBe("retained");
		expect(c().images).toEqual([image]);
		expect(storedModel.pending?.effort).toBe("high");
		expect(c().error).not.toBeNull();
		fail = false;
		await act(async () => c().send());
		await settle();
		expect(calls.filter((op) => op === "prompt")).toHaveLength(1);
		expect(c().draft).toBe("");
	});

	/* PR #350 deferred D2/U1: a Send on an ENDED session resumes it, then applies
	 * the stored model/effort. When resume succeeds but a setting is refused, the
	 * composer used to say the session "couldn't be reopened" and point at the
	 * header's Ended control — which the now-Live/Idle header no longer shows.
	 * Both a typed relay refusal (the QA repro: set_effort 409) and an untyped
	 * failure must take the settings sentence; the draft stays for the retry. */
	/* PR #353 U1: the settings sentence shows after Send (Send enabled) AND
	 * after Retry of a held instruction (Send disabled until it is resolved),
	 * so its remedy must name neither button. Pinned against the rendered en
	 * text, not only the copy accessor, so a reword that says "send again"
	 * fails here on both paths. */
	const SETTINGS_SENTENCE_EN =
		"The session reopened, but your model or effort choice couldn’t be applied, so nothing was sent. Try again, or choose a different model or effort.";
	const expectButtonNeutralSettingsSentence = (text: string | null) => {
		expect(text).toBe(SETTINGS_SENTENCE_EN);
		expect(text).not.toMatch(NAMES_SEND);
		expect(text).not.toMatch(NAMES_RETRY);
	};

	it.each([
		["a relay 409", () => new RelayError("rejected", "busy", { status: 409 })],
		["an untyped failure", () => new Error("synthetic refusal")],
	])(
		"a settings refusal after a successful resume (%s) says the settings, not the reopen, failed",
		async (_label, refusal) => {
			storedSettings = true;
			const calls: string[] = [];
			const client = {
				models: async () => ({ models: [model] }),
				resumeSession: async () => {
					calls.push("resume");
					return { ok: true, session_id: SID, pid: 42 };
				},
				command: async (_id: string, body: Record<string, unknown>) => {
					calls.push(String(body.op));
					if (body.op === "set_effort") throw refusal();
					return { ok: true, detail: "accepted" };
				},
			} as unknown as RelayEndpoints;
			await mount(client, "retained", false, true);
			await act(async () => storedModel.pick(model, "high"));
			await act(async () => c().send());
			await settle();
			expect(calls).toEqual(["resume", "set_model", "set_effort"]);
			expect(c().error).toBe(composerCopy().settingsNotApplied);
			expect(c().error).not.toBe(composerCopy().endedSendFailed);
			// The card the screen actually renders: a plain error line, never the
			// combined reopen-failure card with its "Try again" retry.
			expect(
				composerFeedback({
					ended: false,
					error: c().error,
					retainedMessage: null,
				}).errorText,
			).toBe(composerCopy().settingsNotApplied);
			// Send path: the wording points at no specific control.
			expectButtonNeutralSettingsSentence(c().error);
			expect(c().draft).toBe("retained");
			expect(storedModel.pending?.effort).toBe("high");
		},
	);

	it("Retry of a held instruction on an ended session words a settings refusal the same way", async () => {
		storedSettings = true;
		let promptFails = true;
		const calls: string[] = [];
		const client = {
			models: async () => ({ models: [model] }),
			resumeSession: async () => {
				calls.push("resume");
				return { ok: true, session_id: SID, pid: 42 };
			},
			command: async (_id: string, body: Record<string, unknown>) => {
				calls.push(String(body.op));
				if (body.op === "prompt" && promptFails)
					throw new RelayError("transport", "lost ack");
				if (body.op === "set_effort")
					throw new RelayError("rejected", "busy", { status: 409 });
				return { ok: true, detail: "accepted" };
			},
		} as unknown as RelayEndpoints;
		await mount(client, "earlier instruction", false, true);
		await act(async () => c().send());
		await settle();
		// The relaunch shape: the envelope is persisted, the in-memory outbox
		// job is gone, so Retry runs the composer's own replay path.
		outbox.abandonAll();
		promptFails = false;
		await act(async () => storedModel.pick(model, "high"));
		calls.length = 0;
		/* Retry is "try now": it replays an instruction the send already counted,
		 *  so it sets `sending` and must not count again — the transcript would snap
		 *  to the end on a retry otherwise (round 2, m1). */
		const markBeforeRetry = c().sendMark;
		await act(async () => c().retry());
		await settle();
		expect(c().sendMark).toBe(markBeforeRetry);
		expect(calls).toEqual(["resume", "set_model", "set_effort"]);
		expect(c().error).toBe(composerCopy().settingsNotApplied);
		expect(c().retained).not.toBeNull();
		// Retry path: Send is disabled behind the held instruction, so the
		// sentence must not tell the reader to send again.
		expectButtonNeutralSettingsSentence(c().error);
	});

	it("a failed RESUME keeps the existing reopen-failure sentence", async () => {
		storedSettings = true;
		const calls: string[] = [];
		const client = {
			models: async () => ({ models: [model] }),
			resumeSession: async () => {
				calls.push("resume");
				throw new RelayError("transport", "offline");
			},
			command: async (_id: string, body: Record<string, unknown>) => {
				calls.push(String(body.op));
				return { ok: true, detail: "accepted" };
			},
		} as unknown as RelayEndpoints;
		await mount(client, "retained", false, true);
		await act(async () => storedModel.pick(model, "high"));
		await act(async () => c().send());
		await settle();
		expect(calls).toEqual(["resume"]);
		expect(c().error).toBe(composerCopy().endedSendFailed);
		expect(c().draft).toBe("retained");
	});

	/* PR #350 deferred U2: "Could not change the model." outlived the recovery —
	 * the screen kept it in its own state and nothing retired it when the same
	 * stored choice was later applied (and the message delivered). The hook now
	 * owns that error, so it clears exactly when the settings it names land. */
	it("retires the model-change error once the stored choice it names is applied and the message delivered", async () => {
		storedSettings = true;
		let fail = true;
		const calls: string[] = [];
		const client = {
			models: async () => ({ models: [model] }),
			resumeSession: async () => ({ ok: true, session_id: SID, pid: 42 }),
			command: async (_id: string, body: Record<string, unknown>) => {
				calls.push(String(body.op));
				if (fail && body.op === "set_effort")
					throw new RelayError("rejected", "busy", { status: 409 });
				return { ok: true, detail: "accepted" };
			},
		} as unknown as RelayEndpoints;
		await mount(client, "retained", false, true);
		await act(async () => storedModel.pick(model, "high"));
		await act(async () => c().send());
		await settle();
		// The session is Live/Idle now; a newer model choice still rides the
		// stored lane (pending exists) and is refused by the same effort fault.
		await mount(client, "retained", false, false);
		await act(async () =>
			storedModel
				.selectModel({ ...model, model_id: "model-b", selector: "example/b" })
				.catch(() => {}),
		);
		await settle();
		expect(storedModel.settingsError).toBe("model");
		fail = false;
		await act(async () => c().send());
		await settle();
		expect(calls.filter((op) => op === "prompt")).toHaveLength(1);
		expect(storedModel.pending).toBeNull();
		expect(storedModel.settingsError).toBeNull();
	});

	it("keeps a live model-change error through an unrelated delivered message", async () => {
		storedSettings = true;
		const calls: string[] = [];
		const client = {
			models: async () => ({ models: [model] }),
			resumeSession: async () => ({ ok: true, session_id: SID, pid: 42 }),
			command: async (_id: string, body: Record<string, unknown>) => {
				calls.push(String(body.op));
				if (body.op === "set_model")
					throw new RelayError("rejected", "busy", { status: 409 });
				return { ok: true, detail: "accepted" };
			},
		} as unknown as RelayEndpoints;
		// Live session, no stored intent: the switch goes straight to the runtime.
		await mount(client, "hello", false, false);
		await act(async () => storedModel.selectModel(model).catch(() => {}));
		expect(storedModel.settingsError).toBe("model");
		await act(async () => c().send());
		await settle();
		expect(calls).toEqual(["set_model", "prompt"]);
		// The model still was not changed: the delivered message is no recovery.
		expect(storedModel.settingsError).toBe("model");
	});

	it("retries a failed daemon-wide catalogue without waking a session and clamps a new model's effort", async () => {
		storedSettings = true;
		let fail = true;
		const client = {
			models: vi.fn(async () => {
				if (fail) throw new Error("offline");
				return { models: [model] };
			}),
			command: vi.fn(),
			resumeSession: vi.fn(),
		} as unknown as RelayEndpoints;
		await mount(client, "draft", false, true);
		expect(storedModel.failed).toBe(true);
		fail = false;
		await act(async () => storedModel.retry());
		expect(storedModel.models).toEqual([model]);
		await act(async () => storedModel.pick(model, "high"));
		await act(async () =>
			storedModel.pick({ ...model, model_id: "plain", efforts: [] }),
		);
		expect(storedModel.pending?.effort).toBeNull();
		expect(client.resumeSession).not.toHaveBeenCalled();
		expect(client.command).not.toHaveBeenCalled();
	});

	it("represents loading and empty catalogues and refuses disconnected choices without waking", async () => {
		storedSettings = true;
		let answer!: (value: { models: (typeof model)[] }) => void;
		const catalogue = new Promise<{ models: (typeof model)[] }>((resolve) => {
			answer = resolve;
		});
		const client = {
			models: () => catalogue,
			resumeSession: vi.fn(),
			command: vi.fn(),
		} as unknown as RelayEndpoints;
		await mount(client, "draft", false, true);
		expect(storedModel.loading).toBe(true);
		await act(async () => answer({ models: [] }));
		expect(storedModel.loading).toBe(false);
		expect(storedModel.failed).toBe(false);
		expect(storedModel.models).toEqual([]);
		await act(async () => storedModel.pick({ ...model, connected: false }));
		expect(storedModel.pending).toBeNull();
		expect(client.resumeSession).not.toHaveBeenCalled();
		expect(client.command).not.toHaveBeenCalled();
	});
});

describe("useComposer's remote slash refusal (PR #271 R1-1/U2)", () => {
	it("refuses a typed /command with the honest sentence and sends nothing", async () => {
		const { client, open } = handClient();
		const refusal = "Slash commands work only on Studio computer for now.";
		await act(async () =>
			root?.render(
				createElement(Host, {
					client,
					initial: "/compact",
					streaming: false,
					ended: false,
					slashRefusal: refusal,
				}),
			),
		);
		await act(async () => c().send());
		await settle();
		expect(open).toHaveLength(0);
		expect(c().error).toBe(refusal);
		expect(c().draft).toBe("/compact");
	});

	it("still sends an ordinary prompt when slash is refused", async () => {
		const { client, open } = handClient();
		await act(async () =>
			root?.render(
				createElement(Host, {
					client,
					initial: "summarise the notes",
					streaming: false,
					ended: false,
					slashRefusal: "refused",
				}),
			),
		);
		await act(async () => c().send());
		await settle();
		expect(open).toHaveLength(1);
		expect(open[0]?.body.op).toBe("prompt");
	});
});

describe("useComposer's pending echo", () => {
	it("moves the draft into the row, and the ack leaves an empty composer silent", async () => {
		const { client, open } = handClient();
		await mount(client, "use pnpm");
		await act(async () => c().send());
		await settle();
		expect(open).toHaveLength(1);
		expect(c().draft).toBe("");
		expect(rows.map((r) => r.text)).toEqual(["use pnpm"]);
		await act(async () =>
			open[0]?.resolve({ ok: true, detail: "steer queued" }),
		);
		await settle();
		expect(rows[0]?.accepted).toBe(true);
		expect(c().draft).toBe("");
		expect(c().notice).toBeNull();
	});

	it("rapid steering: the next message typed in flight is kept, with no notice (U2)", async () => {
		const { client, open } = handClient();
		await mount(client, "A: skip the vendor dir");
		await act(async () => c().send());
		await settle();
		await act(async () => c().setDraft("B: and run lint after"));
		await act(async () =>
			open[0]?.resolve({ ok: true, detail: "steer queued" }),
		);
		await settle();
		expect(c().draft).toBe("B: and run lint after");
		expect(c().notice).toBeNull();
		expect(rows[0]?.accepted).toBe(true);
	});

	it.each([409, 413, 422])(
		"a definitive %i while the next message is typed keeps the failed row, and put-back merges it ahead (R1/Q1/U1)",
		async (status) => {
			const { client, open } = handClient();
			await mount(client, "C: also update the changelog");
			await act(async () => c().send());
			await settle();
			const commandId = String(open[0]?.body.command_id);
			await act(async () => c().setDraft("D: then stop"));
			await act(async () =>
				open[0]?.reject(
					new RelayError("rejected", "refused", {
						status,
						serverError: "request refused",
					}),
				),
			);
			await settle();
			/* C is still on screen — as its row, captioned as not sent — and D is
			 *  untouched; the error line names the EARLIER message. */
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				commandId,
				text: "C: also update the changelog",
				failure: "refused",
			});
			expect(pendingEchoCaption(rows[0] as PendingEcho, true)).toBe(
				"not sent — tap to put back",
			);
			expect(c().draft).toBe("D: then stop");
			expect(c().retained).toBeNull();
			expect(c().error).toBe(
				"Your earlier message wasn’t sent (request refused). Tap it above to put it back.",
			);
			/* The tap: C goes back AHEAD of D, and the row comes down. */
			await act(async () => c().putBack(commandId));
			expect(c().draft).toBe("C: also update the changelog\nD: then stop");
			expect(rows).toEqual([]);
		},
	);

	it("a definitive refusal into an EMPTY composer puts the text back there", async () => {
		const { client, open } = handClient();
		await mount(client, "E: also bump the version");
		await act(async () => c().send());
		await settle();
		await act(async () =>
			open[0]?.reject(
				new RelayError("rejected", "refused", {
					status: 413,
					serverError: "request exceeds 0.0 KiB",
				}),
			),
		);
		await settle();
		expect(rows).toEqual([]);
		expect(c().draft).toBe("E: also bump the version");
		expect(c().error).toBe("request exceeds 0.0 KiB");
	});

	it("an ambiguous 504 hands the send to the outbox: the row waits, Retry replays the same id (U3)", async () => {
		const { client, open } = handClient();
		await mount(client, "F: prefer small commits");
		await act(async () => c().send());
		await settle();
		const commandId = String(open[0]?.body.command_id);
		await act(async () => c().setDraft("G: and squash at the end"));
		await act(async () =>
			open[0]?.reject(
				new RelayError("ambiguous-delivery", "no answer", {
					status: 504,
					serverError: "session did not answer",
				}),
			),
		);
		await settle();
		/* Not a failure any more: the outbox owns it and keeps trying. */
		expect(rows[0]).toMatchObject({ commandId, outbox: "waiting" });
		expect(rows[0]?.failure).toBeUndefined();
		expect(pendingEchoCaption(rows[0] as PendingEcho, true)).toBe(
			"waiting for your computer — still trying",
		);
		expect(c().retained).toBeNull();
		expect(c().error).toBeNull();
		expect(outbox.entryFor(SID)).toMatchObject({ commandId, phase: "waiting" });
		/* One unresolved instruction per session: G waits, and the primary says why. */
		expect(c().controls.primary.disabled).toBe(true);
		expect(c().controls.disabledReason).toBe(
			"Your earlier message is still sending. You can send this one once it’s delivered.",
		);
		/* Put-back is refused for a row whose delivery is unknown. */
		await act(async () => c().putBack(commandId));
		expect(rows).toHaveLength(1);
		expect(c().draft).toBe("G: and squash at the end");

		/* Retry is "try now": same id on the wire, ONE row, G untouched. */
		await act(async () => c().retry());
		await settle();
		expect(open[1]?.body.command_id).toBe(commandId);
		expect(rows).toHaveLength(1);
		await act(async () =>
			open[1]?.resolve({ ok: true, detail: "already admitted" }),
		);
		await settle();
		expect(rows[0]).toMatchObject({ commandId, accepted: true });
		expect(rows[0]?.outbox).toBeUndefined();
		expect(outbox.entryFor(SID)).toBeNull();
		expect(c().controls.primary.disabled).toBe(false);
		expect(c().draft).toBe("G: and squash at the end");
	});

	it("a prompt reconciled to a steer keeps ONE row, untouched by the replay, and takes the steer's box (round 2)", async () => {
		const { client, open } = handClient();
		/* Not streaming: the composer mints a PROMPT, and the turn starts under it. */
		await mount(client, "H: also cover the cold path", false);
		await act(async () => c().send());
		await settle();
		const commandId = String(open[0]?.body.command_id);
		expect(open[0]?.body.op).toBe("prompt");
		await act(async () => c().setDraft("I: typed during the first attempt"));
		await act(async () =>
			open[0]?.reject(
				new RelayError(
					"rejected",
					"session is already streaming; use steer() to inject mid-turn",
					{
						status: 422,
						serverError:
							"session is already streaming; use steer() to inject mid-turn",
						envelope: "clear",
					},
				),
			),
		);
		await settle();
		/* The replay: same id, steer op. The row was painted once and is not
		 *  repainted, so the text typed during the first attempt survives. */
		expect(open).toHaveLength(2);
		expect(open[1]?.body).toMatchObject({ op: "steer", command_id: commandId });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			commandId,
			text: "H: also cover the cold path",
		});
		expect(rows[0]?.failure).toBeUndefined();
		expect(c().draft).toBe("I: typed during the first attempt");
		await act(async () =>
			open[1]?.resolve({ ok: true, detail: "steer queued" }),
		);
		await settle();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ commandId, accepted: true, op: "steer" });
		expect(c().draft).toBe("I: typed during the first attempt");
		expect(c().error).toBeNull();
	});
});

describe("the pending row's box", () => {
	/* QA round 1, Q2 (PR #256): `items-end` inside the box pushed a short text
	 *  to the right of an image strip, 181 pt from the settled row's text. The
	 *  caption lives below the box now, so nothing inside needs it. */
	it.each(["prompt", "steer"] as const)(
		"aligns a %s's contents as the settled bubble does (no items-end)",
		(op) => {
			expect(pendingEchoBoxClass(op).split(" ")).not.toContain("items-end");
		},
	);

	/* Agent review round 1, M1: a prompt in flight wears the settled bubble's
	 *  fill, with no hairline, so the message does not change colour or lose
	 *  an edge when the daemon's echo replaces it. */
	it("gives a prompt the settled bubble's fill and no hairline", () => {
		const classes = pendingEchoBoxClass("prompt").split(" ");
		expect(classes).toContain("bg-user-bubble");
		expect(classes).not.toContain("bg-surface");
		expect(classes).not.toContain("border");
		expect(classes).not.toContain("border-hairline");
	});
});

it("keeps paste retry available after a null read, adds a second image, and retains explicit duplicates", async () => {
	const { client, open } = handClient();
	await mount(client, "image instructions");
	const first = { mime_type: "image/png", data_b64: "iVBORw0KGgo=" };
	const second = { mime_type: "image/jpeg", data_b64: "/9j/" };
	/* Spied at `readImageFrom`, the hook's one entry into the attach sources since
	 * the attach menu (PR #278) moved the source dispatch there (shared with the
	 * home composer). `readImageFrom` reaches `pasteImage` through attach.ts's own
	 * binding, which an export spy cannot see; the guarantee is unchanged: every
	 * retry after a null read asks the clipboard again, as a paste. */
	const read = vi
		.spyOn(attachmentSources, "readImageFrom")
		.mockResolvedValueOnce(null)
		.mockResolvedValueOnce(first)
		.mockResolvedValueOnce(second)
		.mockResolvedValueOnce(second);
	await act(async () => c().attach("paste", "offer"));
	await settle();
	expect(c().images).toEqual([]);
	expect(c().error).not.toBeNull();
	for (let attempt = 0; attempt < 3; attempt++) {
		await act(async () => c().attach("paste", "offer"));
		await settle();
	}
	expect(read).toHaveBeenCalledTimes(4);
	expect(read.mock.calls).toEqual([["paste"], ["paste"], ["paste"], ["paste"]]);
	// Existing policy: an intentional repeat is a separate removable thumbnail,
	// never silently deduplicated. The encoded envelope size is the admission bound.
	expect(c().images).toEqual([first, second, second]);
	expect(c().error).toBeNull();
	expect(c().draft).toBe("image instructions");
	expect(open).toHaveLength(0);
});

it("refuses an oversized encoded attachment before POST and keeps the complete draft", async () => {
	const { client, open } = handClient();
	await mount(client, "keep this oversized draft");
	const image = {
		mime_type: "image/png",
		data_b64: "A".repeat(MAX_STORED_ENVELOPE_CHARS),
	};
	await act(async () => c().addImage(image));
	await act(async () => c().send());
	await settle();
	expect(open).toHaveLength(0);
	expect(c().draft).toBe("keep this oversized draft");
	expect(c().images).toEqual([image]);
	expect(c().error).toContain("Not sent");
	expect(c().retained).toBeNull();
});

it("keeps the real hook's text and image draft on a pre-dispatch storage failure", async () => {
	const { client, open } = handClient();
	await mount(client, "do not lose my text");
	const image = { mime_type: "image/png" as const, data_b64: "aGVsbG8=" };
	await act(async () => c().addImage(image));
	storageFault.failWrite = true;
	await act(async () => c().send());
	await settle();
	expect(open).toHaveLength(0);
	expect(c().draft).toBe("do not lose my text");
	expect(c().images).toEqual([image]);
	expect(rows).toHaveLength(0);
	expect(c().error).toContain("Not sent");
	expect(c().error).not.toContain("synthetic private file failure");
	expect(c().retained).toBeNull();
	await act(async () => c().dismissError());
	expect(c().error).toBeNull();
	expect(c().draft).toBe("do not lose my text");
	expect(c().images).toEqual([image]);
	expect(open).toHaveLength(0);
	storageFault.failWrite = false;
	await act(async () => {
		c().send();
		c().send();
	});
	await settle();
	expect(open).toHaveLength(1);
	expect(open[0]?.body.images).toEqual([image]);
	await act(async () => open[0]?.resolve({ ok: true, detail: "queued" }));
	await settle();
});

it("clears only the new draft and dismisses an error without discarding uncertainty", async () => {
	const { client, open } = handClient();
	await mount(client, "earlier uncertain instruction");
	await act(async () => c().send());
	await settle();
	// A newer draft keeps the earlier unconfirmed instruction in its own row.
	await act(async () => c().setDraft("new unsent text"));
	await act(async () =>
		open[0]?.reject(
			new RelayError("ambiguous-delivery", "no answer", {
				status: 504,
				serverError: "session did not answer",
			}),
		),
	);
	await settle();
	/* The uncertainty now lives in the outbox, not in the composer. */
	const owned = outbox.entryFor(SID);
	expect(owned?.phase).toBe("waiting");
	await act(async () => {
		c().setDraft("new unsent text");
		c().addImage({ mime_type: "image/png", data_b64: "iVBORw0KGgo=" });
	});
	await act(async () => c().dismissError());
	expect(c().draft).toBe("new unsent text");
	await act(async () => c().clearUnsentDraft());
	expect(c().draft).toBe("");
	expect(c().images).toEqual([]);
	expect(c().error).toBeNull();
	expect(outbox.entryFor(SID)?.commandId).toBe(owned?.commandId);
	expect(rows[0]).toMatchObject({
		commandId: owned?.commandId,
		outbox: "waiting",
	});
	expect(open).toHaveLength(1);
	await act(async () => c().retry());
	await settle();
	expect(open[1]?.body.command_id).toBe(owned?.commandId);
	expect(open[1]?.body.text).toBe("earlier uncertain instruction");
	await act(async () => open[1]?.resolve({ ok: true, detail: "queued" }));
	await settle();
	expect(outbox.entryFor(SID)).toBeNull();
});

it.each([false, true])(
	"keeps original uncertainty and retry target after preparation fails (ended=%s)",
	async (ended) => {
		const { client, open } = handClient();
		await mount(client, "earlier instruction");
		const image = { mime_type: "image/png" as const, data_b64: "aGVsbG8=" };
		await act(async () => c().addImage(image));
		await act(async () => c().send());
		await settle();
		await act(async () =>
			open[0]?.reject(new RelayError("transport", "lost ack")),
		);
		await settle();
		const commandId = outbox.entryFor(SID)?.commandId;
		expect(commandId).toBe(open[0]?.body.command_id);
		await act(async () => c().setDraft("next draft"));
		await act(async () => c().clearImages());
		const nextImage = { mime_type: "image/png" as const, data_b64: "bmV4dA==" };
		await act(async () => c().addImage(nextImage));
		await mount(client, "unused", !ended, ended);
		/* The outbox's attempt reads the held envelope (read 1), then preparation
		 * verifies the slot (read 2) — which fails. */
		storageFault.reads = 0;
		storageFault.failReadAt = 2;
		await act(async () => c().retry());
		await settle();
		expect(open).toHaveLength(1);
		/* Stopped, not dropped: the row offers Retry/Discard, the id is kept. */
		expect(outbox.entryFor(SID)).toMatchObject({ commandId, phase: "failed" });
		expect(rows[0]).toMatchObject({ commandId, outbox: "exhausted" });
		expect(c().draft).toBe("next draft");
		expect(c().images).toEqual([nextImage]);
		// Recovering storage does not send anything until an explicit retry. The
		// retry still targets the original body/ID, not the newer visible draft.
		storageFault.failReadAt = 0;
		await settle();
		expect(open).toHaveLength(1);
		await act(async () => c().retry());
		await settle();
		expect(open).toHaveLength(2);
		expect(open[1]?.body.command_id).toBe(open[0]?.body.command_id);
		expect(open[1]?.body.images).toEqual([image]);
		expect(open[1]?.body.text).toBe("earlier instruction");
		await act(async () => open[1]?.resolve({ ok: true, detail: "queued" }));
		await settle();
		expect(c().draft).toBe("next draft");
		expect(c().images).toEqual([nextImage]);
		expect(outbox.entryFor(SID)).toBeNull();
		expect(rows[0]).toMatchObject({ commandId, accepted: true });
	},
);

describe("the send mark (code review round 2, m1)", () => {
	/* The transcript snaps to the end on a CHANGE of `sendMark`, never on
	 *  `sending`: Approve/Deny, an ask answer, a retry and a slash TAP all set
	 *  `sending` so the composer disables itself, and none of them is a message
	 *  leaving. These are the sites code review round 1 (R2) found reading
	 *  `sending`, pinned here against the real hook so the fix cannot rot. */
	const compact: SlashCommand = {
		name: "compact",
		description: "Summarise the conversation so far",
		aliases: [],
		arguments: "none",
	};

	it("holds still for an approval, an ask answer and a slash tap, each of which sets `sending`", async () => {
		const { client, open } = handClient();
		await mount(client, "", false, false);
		const mark = c().sendMark;

		await act(async () => c().answerApproval("approval-1", true, false));
		await settle();
		expect(open[0]?.body.op).toBe("approval_answer");
		expect(c().sending).toBe(true);
		expect(c().sendMark).toBe(mark);
		await act(async () => open[0]?.resolve({}));
		await settle();

		await act(async () => c().answerAsk("ask-1", "yes", 0));
		await settle();
		expect(open[1]?.body.op).toBe("ask_answer");
		expect(c().sending).toBe(true);
		expect(c().sendMark).toBe(mark);
		await act(async () => open[1]?.resolve({}));
		await settle();

		await act(async () => c().slash(compact));
		await settle();
		expect(open[2]?.body.op).toBe("slash");
		expect(c().sending).toBe(true);
		expect(c().sendMark).toBe(mark);
		await act(async () => open[2]?.resolve({}));
		await settle();
		expect(c().sendMark).toBe(mark);
	});

	/* The control the pin above needs: the mark is live, so "unchanged" is a
	 *  statement about these paths and not about a mark nothing ever moves. */
	it("counts the admitted send it exists for", async () => {
		const { client, open } = handClient();
		await mount(client, "A: one message", false, false);
		const mark = c().sendMark;
		await act(async () => c().send());
		await settle();
		expect(open[0]?.body.op).toBe("prompt");
		expect(c().sendMark).toBe(mark + 1);
		await act(async () => open[0]?.resolve({ ok: true, detail: "queued" }));
		await settle();
	});
});
