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
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptImage } from "@/contracts";
import * as attachmentSources from "@/features/session/attach";
import { composerCopy, composerFeedback } from "@/features/session/composer";
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
import { type RelayEndpoints, RelayError } from "@/relay";
import { MAX_STORED_ENVELOPE_CHARS } from "@/relay/retry-envelope";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

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

function Host({
	client,
	initial,
	streaming,
	ended,
}: {
	client: RelayEndpoints;
	initial: string;
	streaming: boolean;
	ended: boolean;
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
		streaming,
		ended,
		capabilities: null,
		editor: { draft, images, setDraft, setImages },
	});
	rows = usePendingEchoes(SID, []);
	return null;
}

const mount = async (
	client: RelayEndpoints,
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
	vi.restoreAllMocks();
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	clearPendingEchoes();
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

	it("an ambiguous 504 keeps the row as not confirmed; Retry repaints it under the same id (U3)", async () => {
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
		expect(rows[0]).toMatchObject({ commandId, failure: "unconfirmed" });
		expect(pendingEchoCaption(rows[0] as PendingEcho, true)).toBe(
			"not confirmed — retry below",
		);
		expect(c().retained?.command_id).toBe(commandId);
		/* Put-back is refused for an unconfirmed row: it may have been delivered. */
		await act(async () => c().putBack(commandId));
		expect(rows).toHaveLength(1);
		expect(c().draft).toBe("G: and squash at the end");

		/* Retry: same id on the wire, the row goes back to live in place, G stays,
		 *  and the ack says the earlier one went through without calling G edited. */
		await act(async () => c().retry());
		await settle();
		expect(open[1]?.body.command_id).toBe(commandId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.failure).toBeUndefined();
		await act(async () =>
			open[1]?.resolve({ ok: true, detail: "steer queued" }),
		);
		await settle();
		expect(rows[0]).toMatchObject({ commandId, accepted: true });
		expect(c().draft).toBe("G: and squash at the end");
		expect(c().notice).toBe(
			"Your earlier message went through. The text below hasn’t been sent yet.",
		);
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
	const read = vi
		.spyOn(attachmentSources, "pasteImage")
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
	const held = c().retained;
	expect(held).not.toBeNull();
	await act(async () => {
		c().setDraft("new unsent text");
		c().addImage({ mime_type: "image/png", data_b64: "iVBORw0KGgo=" });
	});
	await act(async () => c().dismissError());
	expect(c().retained).toEqual(held);
	expect(c().draft).toBe("new unsent text");
	await act(async () => c().clearUnsentDraft());
	expect(c().draft).toBe("");
	expect(c().images).toEqual([]);
	expect(c().error).toBeNull();
	expect(c().retained).toEqual(held);
	expect(rows[0]).toMatchObject({
		commandId: held?.command_id,
		failure: "unconfirmed",
	});
	expect(open).toHaveLength(1);
	await act(async () => c().retry());
	await settle();
	expect(open[1]?.body.command_id).toBe(held?.command_id);
	expect(open[1]?.body.text).toBe("earlier uncertain instruction");
	await act(async () => open[1]?.resolve({ ok: true, detail: "queued" }));
	await settle();
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
		const held = c().retained;
		expect(held?.images).toEqual([image]);
		await act(async () => c().setDraft("next draft"));
		await act(async () => c().clearImages());
		const nextImage = { mime_type: "image/png" as const, data_b64: "bmV4dA==" };
		await act(async () => c().addImage(nextImage));
		await mount(client, "unused", !ended, ended);
		// Retry first reads its displayed envelope, then preparation verifies the slot.
		storageFault.reads = 0;
		storageFault.failReadAt = 2;
		await act(async () => c().retry());
		await settle();
		expect(open).toHaveLength(1);
		expect(c().retained).toEqual(held);
		expect(c().draft).toBe("next draft");
		expect(c().images).toEqual([nextImage]);
		const feedback = composerFeedback({
			ended,
			error: c().error,
			retainedMessage:
				c().retained === null ? null : composerCopy().retainedError,
		});
		expect(feedback.retainedText).toContain(
			"An earlier instruction may have been delivered",
		);
		expect(feedback.errorText).toContain("This retry attempt wasn’t sent");
		expect(feedback.errorText).not.toContain("synthetic private file failure");
		expect(feedback.retryLabel).toBe("Retry earlier instruction");
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
		expect(c().retained).toBeNull();
	},
);
