import { expect, it } from "vitest";
import { receiptForError } from "@/features/session/composer";
import {
	malformedFrameError,
	memoryEnvelopeStore,
	RelayError,
	RetryEnvelopeStore,
	sendPersistedCommand,
} from "@/relay";

it("does not call HTTP or consume a text/image draft when retry persistence fails", async () => {
	const backing = memoryEnvelopeStore();
	backing.set = async () => {
		throw new Error("private storage exception");
	};
	const envelopes = new RetryEnvelopeStore({ store: backing });
	let requests = 0;
	let held = 0;
	const images = [{ mime_type: "image/png" as const, data_b64: "aGVsbG8=" }];
	const draft = { text: "keep this draft", images };
	let failure: unknown;
	try {
		await sendPersistedCommand({
			client: {
				command: async () => {
					requests++;
					return { ok: true, detail: "unexpected" };
				},
			},
			envelopes,
			sessionId: "synthetic-session",
			op: "steer",
			...draft,
			onHeld: () => {
				held++;
			},
		});
	} catch (cause) {
		failure = cause;
	}
	expect(requests).toBe(0);
	expect(held).toBe(0);
	expect(draft).toEqual({
		text: "keep this draft",
		images: [{ mime_type: "image/png", data_b64: "aGVsbG8=" }],
	});
	expect(failure).toBeInstanceOf(RelayError);
	const receipt = receiptForError(failure as RelayError, "steer");
	expect(receipt.kind).toBe("not-sent");
	expect(receipt.message).toContain("Not sent");
	expect(receipt.message).not.toContain("private storage exception");
});

const image = { mime_type: "image/png" as const, data_b64: "aGVsbG8=" };
const sessionId = "synthetic-prior";

it("keeps an older unresolved image envelope when preparation of a conflicting retry fails", async () => {
	const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
	const { envelope } = await envelopes.holdNew(sessionId, "steer", "older", [
		image,
	]);
	let calls = 0;
	await expect(
		sendPersistedCommand({
			envelopes,
			sessionId,
			op: "steer",
			text: "different",
			images: [image],
			envelope,
			client: {
				command: async () => {
					calls++;
					return { ok: true, detail: "unexpected" };
				},
			},
		}),
	).rejects.toMatchObject({
		stage: "pre-dispatch",
		category: "local-storage",
		envelope: "keep",
		retry: "never",
	});
	expect(calls).toBe(0);
	expect(await envelopes.peek(sessionId)).toEqual(envelope);
});

it("refuses to overwrite an older envelope when its backing read is unavailable", async () => {
	const backing = memoryEnvelopeStore();
	const envelopes = new RetryEnvelopeStore({ store: backing });
	const { envelope } = await envelopes.holdNew(sessionId, "steer", "older", [
		image,
	]);
	const get = backing.get.bind(backing);
	backing.get = async () => {
		throw new Error("private read failure");
	};
	let calls = 0;
	await expect(
		sendPersistedCommand({
			envelopes,
			sessionId,
			op: "steer",
			text: "new draft",
			images: [image],
			client: {
				command: async () => {
					calls++;
					return { ok: true, detail: "unexpected" };
				},
			},
		}),
	).rejects.toMatchObject({ stage: "pre-dispatch" });
	expect(calls).toBe(0);
	backing.get = get;
	expect(await envelopes.peek(sessionId)).toEqual(envelope);
});

it("keeps post-dispatch transport and acknowledgement failures ambiguous, replaying the same image and id", async () => {
	for (const kind of ["transport", "malformed-frame"] as const) {
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		const bodies: unknown[] = [];
		const client = {
			command: async (_id: string, body: unknown) => {
				bodies.push(body);
				if (bodies.length === 1)
					throw kind === "malformed-frame"
						? malformedFrameError(
								"command acknowledgement",
								new Error("private HTTP failure"),
								200,
							)
						: new RelayError(kind, "private HTTP failure");
				return { ok: true as const, detail: "already admitted" };
			},
		};
		let failure: unknown;
		try {
			await sendPersistedCommand({
				client,
				envelopes,
				sessionId,
				op: "steer",
				text: "keep",
				images: [image],
			});
		} catch (cause) {
			failure = cause;
		}
		expect(receiptForError(failure as RelayError, "steer").kind).toBe(
			"ambiguous",
		);
		expect((await envelopes.peek(sessionId))?.images).toEqual([image]);
		await sendPersistedCommand({
			client,
			envelopes,
			sessionId,
			op: "steer",
			text: "keep",
			images: [image],
		});
		expect(bodies[1]).toEqual(bodies[0]);
		expect(await envelopes.peek(sessionId)).toBeNull();
	}
});

it("retains images and command id when a steer reconciles to an idle prompt", async () => {
	const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
	const bodies: Array<{ op: string; command_id: string; images?: unknown }> =
		[];
	await sendPersistedCommand({
		envelopes,
		sessionId,
		op: "steer",
		text: "keep",
		images: [image],
		client: {
			command: async (_id, body) => {
				bodies.push(body as (typeof bodies)[number]);
				if (bodies.length === 1)
					throw new RelayError("rejected", "session not connected", {
						status: 409,
						serverError: "session not connected",
						envelope: "clear",
					});
				return { ok: true, detail: "prompt admitted" };
			},
		},
	});
	expect(bodies.map((body) => body.op)).toEqual(["steer", "prompt"]);
	expect(bodies[1]?.command_id).toBe(bodies[0]?.command_id);
	expect(bodies[1]?.images).toEqual([image]);
	expect(await envelopes.peek(sessionId)).toBeNull();
});

it("does not label a reconciliation storage error after HTTP dispatch as not sent", async () => {
	const backing = memoryEnvelopeStore();
	const envelopes = new RetryEnvelopeStore({ store: backing });
	let calls = 0;
	let failure: unknown;
	try {
		await sendPersistedCommand({
			envelopes,
			sessionId,
			op: "steer",
			text: "keep",
			images: [image],
			client: {
				command: async () => {
					calls++;
					backing.set = async () => {
						throw new Error("rehold failed");
					};
					throw new RelayError("rejected", "session not connected", {
						status: 409,
						serverError: "session not connected",
						envelope: "clear",
					});
				},
			},
		});
	} catch (cause) {
		failure = cause;
	}
	expect(calls).toBe(1);
	expect(receiptForError(failure as RelayError, "steer").kind).toBe(
		"ambiguous",
	);
	expect((await envelopes.peek(sessionId))?.images).toEqual([image]);
});

it("does not automatically dispatch a different waiter after local preparation fails", async () => {
	const backing = memoryEnvelopeStore();
	backing.set = async () => {
		throw new Error("synthetic write failure");
	};
	const envelopes = new RetryEnvelopeStore({ store: backing });
	let requests = 0;
	const client = {
		command: async () => {
			requests++;
			return { ok: true as const, detail: "unexpected" };
		},
	};
	const first = sendPersistedCommand({
		envelopes,
		client,
		sessionId,
		op: "steer",
		text: "first",
		images: [image],
	});
	const second = sendPersistedCommand({
		envelopes,
		client,
		sessionId,
		op: "steer",
		text: "second",
		images: [image],
	});
	const outcomes = await Promise.allSettled([first, second]);
	for (const outcome of outcomes) {
		expect(outcome.status).toBe("rejected");
		if (outcome.status === "rejected")
			expect(receiptForError(outcome.reason).kind).toBe("not-sent");
	}
	expect(requests).toBe(0);
});
