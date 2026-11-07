/**
 * The pending echo: the row a send paints at the transcript's edge before the
 * daemon answers, and its hand-over to the real row (`pending-echo.ts`).
 *
 * Two layers, both real code:
 *
 *  - the store and `usePendingEchoes`, mounted through react-dom (the hook is
 *    plain React, no React Native), asserting what the screen would be handed;
 *  - the composer's send chain — the REAL `sendPersistedCommand` and retry
 *    envelope store, whose `onHeld` drives the same `paintPendingEcho` /
 *    `unpaintPendingEcho` / `markPendingEchoAccepted` calls `use-composer.ts`
 *    makes — against a fake relay client that can fail and then succeed.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptImage, TranscriptEntry } from "@/contracts";
import {
	clearPendingEchoes,
	type EchoDraft,
	markPendingEchoAccepted,
	type PaintedEcho,
	type PendingEcho,
	paintPendingEcho,
	pendingEchoCaption,
	putBackPendingEcho,
	registerPendingEcho,
	unpaintPendingEcho,
	usePendingEchoes,
} from "@/features/session/pending-echo";
import {
	memoryEnvelopeStore,
	type RelayEndpoints,
	RetryEnvelopeStore,
	sendPersistedCommand,
} from "@/relay";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

const SID = "s-echo";

const row = (id: string, kind: TranscriptEntry["kind"], text = "hi") =>
	({ id, kind, text }) as unknown as TranscriptEntry;

const echo = (overrides: Partial<PendingEcho> = {}): PendingEcho => ({
	commandId: "c-1",
	text: "hello",
	imageCount: 0,
	op: "prompt",
	accepted: false,
	...overrides,
});

/* ------------------------------------------------------------ hook harness */

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;
/** Every value the hook returned, in render order — the "frames". */
let frames: PendingEcho[][] = [];

function Probe({ entries }: { entries: TranscriptEntry[] }) {
	frames.push(usePendingEchoes(SID, entries));
	return null;
}

const render = async (entries: TranscriptEntry[]) => {
	await act(async () => root?.render(createElement(Probe, { entries })));
};
const latest = () => frames[frames.length - 1] ?? [];

beforeEach(() => {
	clearPendingEchoes();
	frames = [];
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	clearPendingEchoes();
});

describe("usePendingEchoes", () => {
	it("shows the echo the moment it is registered", async () => {
		const entries = [row("a-1", "assistant")];
		await render(entries);
		expect(latest()).toEqual([]);
		await act(async () => registerPendingEcho(SID, echo()));
		expect(latest().map((e) => e.commandId)).toEqual(["c-1"]);
		expect(latest()[0]?.text).toBe("hello");
	});

	it.each(["user", "steer", "parent_message"] as const)(
		"hands over to the real %s row under the same id, with no frame showing both",
		async (kind) => {
			await render([]);
			await act(async () => registerPendingEcho(SID, echo()));
			expect(latest()).toHaveLength(1);
			const real = [row("c-1", kind, "hello")];
			await render(real);
			/* Every frame rendered WITH the real row carries no echo — the filter is
			 *  structural, not the cleanup effect racing a paint. */
			const withReal = frames.slice(-2);
			for (const frame of withReal) expect(frame).toEqual([]);
			/* And the store entry is gone, so a transcript that later loses the row
			 *  (a re-cap) cannot resurrect a phantom. */
			await render([]);
			expect(latest()).toEqual([]);
		},
	);

	it("paints nothing when the real row arrived BEFORE the echo was registered", async () => {
		await render([row("c-1", "steer", "hello")]);
		frames = [];
		await act(async () => registerPendingEcho(SID, echo({ op: "steer" })));
		for (const frame of frames) expect(frame).toEqual([]);
		await render([]);
		expect(latest()).toEqual([]);
	});

	it("never reconciles by words: a repeated message keeps its own row", async () => {
		await render([row("c-old", "user", "yes")]);
		await act(async () =>
			registerPendingEcho(SID, echo({ commandId: "c-new", text: "yes" })),
		);
		expect(latest().map((e) => e.commandId)).toEqual(["c-new"]);
	});

	it("does not retire an echo on a non-user row that happens to share the id", async () => {
		await render([row("c-1", "assistant")]);
		await act(async () => registerPendingEcho(SID, echo()));
		expect(latest()).toHaveLength(1);
	});

	it("keeps a referentially stable result across streamed frames", async () => {
		await act(async () => registerPendingEcho(SID, echo()));
		await render([row("a-1", "assistant", "par")]);
		const before = latest();
		await render([row("a-1", "assistant", "partial answer")]);
		expect(latest()).toBe(before);
	});

	it("scopes echoes per session", async () => {
		await render([]);
		await act(async () => registerPendingEcho("other", echo()));
		expect(latest()).toEqual([]);
	});
});

describe("pendingEchoCaption", () => {
	it("says sending, then sent for a prompt, and queued for a steer", () => {
		expect(pendingEchoCaption(echo(), false)).toBe("sending…");
		expect(pendingEchoCaption(echo({ accepted: true }), true)).toBe("sent");
		expect(
			pendingEchoCaption(echo({ op: "steer", accepted: true }), true),
		).toBe("queued — sends when this step finishes");
		expect(
			pendingEchoCaption(echo({ op: "steer", accepted: true }), false),
		).toBe("queued — sends with your next message");
	});
});

/* ------------------------------------------------- the composer send chain */

/** A composer draft as `use-composer.ts` exposes it to the helpers. */
function fakeDraft(text: string, images: PromptImage[] = []) {
	const state = { text, images };
	const draft: EchoDraft = {
		read: () => ({ text: state.text.trim(), imageCount: state.images.length }),
		clear: () => {
			state.text = "";
			state.images = [];
		},
		restore: (t, i) => {
			state.text = t;
			state.images = i;
		},
		prepend: (t, i) => {
			state.text = state.text.trim() === "" ? t : `${t}\n${state.text}`;
			state.images = [...i, ...state.images];
		},
	};
	return { state, draft };
}

/** A relay command route that fails (transport) the first N calls. */
function flakyClient(failures: number) {
	const bodies: Record<string, unknown>[] = [];
	let remaining = failures;
	const client = {
		async command(_sessionId: string, body: Record<string, unknown>) {
			bodies.push(body);
			if (remaining-- > 0) throw new TypeError("Network request failed");
			return {
				ok: true as const,
				detail: body.op === "steer" ? "steer queued" : "prompt admitted",
			};
		},
	} as unknown as Pick<RelayEndpoints, "command">;
	return { client, bodies };
}

/** The send exactly as `use-composer.ts`'s `runSend`/`retry` wire it. */
async function composerSend(input: {
	client: Pick<RelayEndpoints, "command">;
	envelopes: RetryEnvelopeStore;
	op: "prompt" | "steer";
	text: string;
	draft: EchoDraft;
	onHeldCalls?: { count: number };
}): Promise<"ok" | "failed"> {
	let painted: PaintedEcho | null = null;
	try {
		const result = await sendPersistedCommand({
			client: input.client,
			envelopes: input.envelopes,
			sessionId: SID,
			op: input.op,
			text: input.text,
			onHeld: (envelope) => {
				if (input.onHeldCalls) input.onHeldCalls.count += 1;
				painted = paintPendingEcho(
					SID,
					envelope,
					{ text: input.text, images: undefined },
					input.draft,
				);
			},
		});
		markPendingEchoAccepted(SID, result.commandId, result.op);
		return "ok";
	} catch {
		/* Every failure the fake client throws is a transport loss: ambiguous. */
		unpaintPendingEcho(
			SID,
			painted,
			{ text: input.text, images: [] },
			input.draft,
			"unconfirmed",
		);
		return "failed";
	}
}

describe("the composer's send chain", () => {
	it("paints the echo before the request resolves, under the wire's command_id", async () => {
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		const { draft, state } = fakeDraft("steer left");
		let seenDuringRequest: PendingEcho[] = [];
		await render([]);
		const client = {
			command: vi.fn(async () => {
				/* Mid-request: the echo is on screen and the draft has left. The
				 *  empty act flushes the render the store emission scheduled. */
				await act(async () => {});
				seenDuringRequest = latest();
				expect(state.text).toBe("");
				return { ok: true as const, detail: "steer queued" };
			}),
		} as unknown as Pick<RelayEndpoints, "command">;
		/* Not wrapped in act: the request itself flushes mid-flight (above), and
		 *  an outer act would hold every render until the send had resolved. */
		await composerSend({
			client,
			envelopes,
			op: "steer",
			text: "steer left",
			draft,
		});
		await act(async () => {});
		expect(seenDuringRequest).toHaveLength(1);
		const wired = (client.command as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[1] as { command_id: string };
		expect(seenDuringRequest[0]?.commandId).toBe(wired.command_id);
		expect(seenDuringRequest[0]?.accepted).toBe(false);
		/* Acknowledged: same row, now queued rather than sending. */
		expect(latest()[0]?.accepted).toBe(true);
		expect(pendingEchoCaption(latest()[0] as PendingEcho, true)).toBe(
			"queued — sends when this step finishes",
		);
		/* Delivered: the real row lands under that id and the echo is gone. */
		await render([row(wired.command_id, "steer", "steer left")]);
		expect(latest()).toEqual([]);
	});

	it("on failure withdraws the row, gives the draft back, and Retry replays the same id", async () => {
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		const { draft, state } = fakeDraft("ship it");
		const { client, bodies } = flakyClient(1);
		await render([]);
		let outcome: string | undefined;
		const onHeldCalls = { count: 0 };
		await act(async () => {
			outcome = await composerSend({
				client,
				envelopes,
				op: "prompt",
				text: "ship it",
				draft,
				onHeldCalls,
			});
		});
		/* Painted exactly once, before the one request (review round 1, R2). */
		expect(onHeldCalls.count).toBe(1);
		expect(outcome).toBe("failed");
		expect(latest()).toEqual([]);
		expect(state.text).toBe("ship it");
		/* The retry affordance: the ambiguous send left its envelope retained. */
		const held = await envelopes.peek(SID);
		expect(held?.text).toBe("ship it");

		/* Retry, as `use-composer.ts`'s `retry` does: the held body, the visible
		 *  draft as `sent` (it is untouched, so it moves into the row again). */
		await act(async () => {
			outcome = await composerSend({
				client,
				envelopes,
				op: held?.op ?? "prompt",
				text: held?.text ?? "",
				draft,
			});
		});
		expect(outcome).toBe("ok");
		expect(bodies).toHaveLength(2);
		expect(bodies[1]?.command_id).toBe(bodies[0]?.command_id);
		expect(latest().map((e) => e.commandId)).toEqual([bodies[0]?.command_id]);
		expect(state.text).toBe("");
	});

	it("keeps the failed row, and leaves text typed while the send was out (R1)", async () => {
		const { draft, state } = fakeDraft("first");
		await render([]);
		let painted: PaintedEcho | null = null;
		await act(async () => {
			painted = paintPendingEcho(
				SID,
				{ op: "prompt", command_id: "c-9", text: "first" },
				{ text: "first", images: undefined },
				draft,
			);
		});
		expect(latest()).toHaveLength(1);
		state.text = "second thought";
		let kept: string | undefined;
		await act(async () => {
			kept = unpaintPendingEcho(
				SID,
				painted,
				{ text: "first", images: [] },
				draft,
				"refused",
			);
		});
		expect(kept).toBe("kept");
		expect(latest()).toMatchObject([{ text: "first", failure: "refused" }]);
		expect(state.text).toBe("second thought");
		/* The tap puts it back AHEAD of what was typed, and the row comes down. */
		await act(async () => putBackPendingEcho(SID, "c-9", draft));
		expect(state.text).toBe("first\nsecond thought");
		expect(latest()).toEqual([]);
	});

	it("leaves a draft edited between the tap and the hold in the composer (R3)", async () => {
		const { draft, state } = fakeDraft("first, then more");
		await render([]);
		let painted: PaintedEcho | null = null;
		await act(async () => {
			painted = paintPendingEcho(
				SID,
				{ op: "steer", command_id: "c-10", text: "first" },
				{ text: "first", images: undefined },
				draft,
			);
		});
		expect(state.text).toBe("first, then more");
		expect(painted).toMatchObject({ movedDraft: false, draftKeepsBody: true });
		/* A failure then needs no row: the composer still holds those words. */
		await act(async () =>
			unpaintPendingEcho(
				SID,
				painted,
				{ text: "first", images: [] },
				draft,
				"refused",
			),
		);
		expect(latest()).toEqual([]);
		expect(state.text).toBe("first, then more");
	});

	it("paints a replayed EARLIER envelope without clearing the new draft", async () => {
		const { draft, state } = fakeDraft("new words");
		await render([]);
		await act(async () => {
			paintPendingEcho(
				SID,
				{ op: "prompt", command_id: "c-old", text: "old words" },
				{ text: "new words", images: undefined },
				draft,
			);
		});
		expect(latest()[0]?.text).toBe("old words");
		expect(state.text).toBe("new words");
	});

	it("takes the op the command was finally delivered as", async () => {
		await render([]);
		await act(async () => registerPendingEcho(SID, echo({ op: "prompt" })));
		await act(async () => markPendingEchoAccepted(SID, "c-1", "steer"));
		expect(latest()[0]).toMatchObject({ op: "steer", accepted: true });
	});
});
