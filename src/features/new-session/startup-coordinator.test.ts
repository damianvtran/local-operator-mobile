import { describe, expect, it, vi } from "vitest";
import { DispatchClosedError } from "@/relay/command-lifecycle";
import { RelayError } from "@/relay/errors";
import { StartupCoordinator, type StartupRecord } from "./startup-coordinator";

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	// A RED implementation may not have subscribed yet; the original promise
	// still rejects for its eventual consumer, without an unrelated runner error.
	void promise.catch(() => undefined);
	return { promise, resolve, reject };
};
const setup = (saved: StartupRecord | null = null) => {
	let disk = saved;
	let valid = true;
	let counter = 0;
	const create = deferred<{ session_id: string }>();
	const admissions: Array<{ id: string; text: string; images?: unknown }> = [];
	const store = {
		load: vi.fn(async () => disk),
		save: vi.fn(async (value: StartupRecord) => {
			disk = structuredClone(value);
		}),
	};
	const entered = deferred<void>();
	/* Scripted starts, for the cases whose point is WHICH attempt fails. The default
	 * still hands back the one deferred the older tests drive by hand, so nothing
	 * else in this file changes shape. */
	const selections: unknown[] = [];
	let script:
		| ((call: number, selection: unknown) => Promise<{ session_id: string }>)
		| null = null;
	let calls = 0;
	const start = vi.fn((selection?: unknown) => {
		selections.push(selection);
		entered.resolve();
		if (script !== null) return script(++calls, selection);
		return create.promise;
	});
	const send = vi.fn(
		async (
			_id: string,
			message: { command_id: string; text: string; images?: unknown },
		) => {
			admissions.push({
				id: message.command_id,
				text: message.text,
				images: message.images,
			});
		},
	);
	const coordinator = new StartupCoordinator("authorization-a/server-a", {
		store,
		start,
		send,
		isCurrent: () => valid,
		uuid: () =>
			`00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
	});
	return {
		coordinator,
		store,
		start,
		send,
		create,
		entered,
		admissions,
		selections,
		setStart: (
			fn: (call: number, selection: unknown) => Promise<{ session_id: string }>,
		) => {
			script = fn;
		},
		disk: () => disk,
		revoke: () => {
			valid = false;
		},
	};
};

// Deferred barriers prove ordering without wall-clock sleeps or a fake successful network.
describe("durable provisional conversation", () => {
	it("is editable before configuration and creates only on explicit Send", async () => {
		const x = setup();
		await x.coordinator.ready;
		x.coordinator.edit("hello", []);
		await x.coordinator.flush();
		expect(x.coordinator.snapshot().draft.text).toBe("hello");
		expect(x.start).not.toHaveBeenCalled();
		await x.coordinator.enqueue();
		expect(x.coordinator.snapshot().queue).toHaveLength(1);
		expect(x.start).not.toHaveBeenCalled();
		await x.coordinator.configure({
			cwd: "/home/fixture",
			provider: "test",
			model_id: "chosen",
		});
		await x.coordinator.flush();
		expect(x.start).toHaveBeenCalledExactlyOnceWith({
			cwd: "/home/fixture",
			provider: "test",
			model_id: "chosen",
		});
		expect(x.send).not.toHaveBeenCalled();
	});

	it("queues equal text with distinct immutable IDs and stores SID before FIFO dispatch", async () => {
		const x = setup();
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/home/fixture" });
		const images = [{ mime_type: "image/png" as const, data_b64: "YWJj" }];
		x.coordinator.edit("same", images);
		await x.coordinator.enqueue();
		const held = images[0];
		if (held === undefined) throw new Error("fixture image missing");
		held.data_b64 = "changed";
		x.coordinator.edit("same", []);
		await x.coordinator.enqueue();
		x.coordinator.edit("newer unsent", []);
		expect(x.coordinator.snapshot().queue).toHaveLength(2);
		x.send.mockImplementation(async (id, message) => {
			expect(x.disk()?.sessionId).toBe(id);
			expect(x.disk()?.queue[0]?.command_id).toBe(message.command_id);
			x.admissions.push({
				id: message.command_id,
				text: message.text,
				images: message.images,
			});
		});
		x.create.resolve({ session_id: "session-a" });
		await x.coordinator.settled();
		expect(x.admissions.map((item) => item.text)).toEqual(["same", "same"]);
		expect(new Set(x.admissions.map((item) => item.id)).size).toBe(2);
		expect(x.admissions[0]?.images).toEqual([
			{ mime_type: "image/png", data_b64: "YWJj" },
		]);
		expect(x.coordinator.snapshot().draft.text).toBe("newer unsent");
		expect(x.coordinator.snapshot().queue).toEqual([]);
	});

	it("coalesces same-tick Send without clearing typing after its persistence barrier", async () => {
		const x = setup();
		await x.coordinator.ready;
		x.coordinator.edit("A", []);
		await x.coordinator.flush();
		const barrier = deferred<void>();
		x.store.save.mockImplementationOnce(async () => barrier.promise);
		const first = x.coordinator.enqueue();
		const duplicate = x.coordinator.enqueue();
		x.coordinator.edit("B", []);
		barrier.resolve();
		await Promise.all([first, duplicate]);
		expect(x.coordinator.snapshot().queue).toHaveLength(1);
		expect(x.coordinator.snapshot().draft.text).toBe("B");
	});

	it("refuses network on quota failure and retains complete live draft", async () => {
		const x = setup();
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/home/fixture" });
		x.coordinator.edit("retain", [
			{ mime_type: "image/png", data_b64: "aW1hZ2U=" },
		]);
		await x.coordinator.flush();
		x.store.save.mockRejectedValueOnce(new Error("quota"));
		await x.coordinator.enqueue();
		expect(x.start).not.toHaveBeenCalled();
		expect(x.coordinator.snapshot().draft.text).toBe("retain");
		expect(x.coordinator.snapshot().draft.images).toHaveLength(1);
		expect(x.coordinator.snapshot().error).toContain("save");
	});

	it("holds a lost legacy create response across restore, never guesses a SID or retries", async () => {
		const x = setup();
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/home/fixture" });
		x.coordinator.edit("A", []);
		await x.coordinator.enqueue();
		x.create.reject(new Error("response lost"));
		await x.coordinator.settled();
		expect(x.coordinator.snapshot().phase).toBe("unconfirmed");
		await x.coordinator.retry();
		await x.coordinator.settled();
		expect(x.start).toHaveBeenCalledTimes(1);
		const restored = setup(x.disk());
		await restored.coordinator.ready;
		await restored.coordinator.retry();
		expect(restored.start).not.toHaveBeenCalled();
		expect(restored.coordinator.snapshot().queue).toHaveLength(1);
	});

	it("retries command ACK loss with the original ID/body and holds the following item", async () => {
		const x = setup();
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/home/fixture" });
		x.coordinator.edit("A", []);
		await x.coordinator.enqueue();
		x.coordinator.edit("B", []);
		await x.coordinator.enqueue();
		x.send.mockRejectedValueOnce(new Error("ack lost"));
		x.create.resolve({ session_id: "session-a" });
		await x.coordinator.settled();
		const id = x.coordinator.snapshot().queue[0]?.command_id;
		expect(x.send).toHaveBeenCalledTimes(1);
		const restored = setup(x.disk());
		await restored.coordinator.ready;
		await restored.coordinator.retry();
		await restored.coordinator.settled();
		expect(restored.start).not.toHaveBeenCalled();
		expect(restored.admissions[0]?.id).toBe(id);
		expect(restored.admissions.map((message) => message.text)).toEqual([
			"A",
			"B",
		]);
	});

	it("fences late create completion after back or authorization replacement", async () => {
		const x = setup();
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/home/fixture" });
		x.coordinator.edit("private", []);
		await x.coordinator.enqueue();
		await x.entered.promise;
		x.revoke();
		x.coordinator.pause();
		x.create.resolve({ session_id: "old-session" });
		await x.coordinator.settled();
		expect(x.send).not.toHaveBeenCalled();
		expect(x.disk()?.sessionId).toBe("old-session");
	});

	it("rejects another authorization scope and corrupt records instead of overwriting them", async () => {
		const x = setup();
		await x.coordinator.ready;
		x.coordinator.edit("old account", []);
		await x.coordinator.flush();
		const foreign = { ...x.disk(), scope: "other-account" } as StartupRecord;
		const y = setup(foreign);
		await y.coordinator.ready;
		expect(y.coordinator.snapshot().draft.text).toBe("");
		expect(y.coordinator.snapshot().error).toContain("restore");
		y.coordinator.edit("new", []);
		await y.coordinator.enqueue();
		expect(y.store.save).not.toHaveBeenCalled();
		expect(y.start).not.toHaveBeenCalled();
	});
});

/** A relay's ANSWER and a lost answer are different facts, and the queue must
 *  treat them differently: one is recoverable work, the other is a HOLD. These
 *  are the review's R1-2/R1-3 expressed against the real error type, so the
 *  classification under test is the one `errors.ts` publishes. */
describe("definite refusals are not ambiguity", () => {
	const refused = (status: number, message: string) =>
		new RelayError("rejected", message, { status, detail: message });

	it("surfaces a refused create and lets the reader correct and retry", async () => {
		const x = setup();
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/outside/home" });
		x.coordinator.edit("A", []);
		await x.coordinator.enqueue();
		x.create.reject(
			refused(400, "That folder doesn't exist on this computer."),
		);
		await x.coordinator.settled();
		expect(x.coordinator.snapshot().phase).toBe("refused");
		expect(x.coordinator.snapshot().queue).toHaveLength(1);
		expect(x.coordinator.snapshot().error).toContain("folder");

		// The correction path: retry is a NEW attempt, not a replay of the refusal.
		await x.coordinator.retry();
		await x.coordinator.settled();
		expect(x.start).toHaveBeenCalledTimes(2);
	});

	it("keeps an unanswered create in the permanent HOLD", async () => {
		const x = setup();
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/home/fixture" });
		x.coordinator.edit("A", []);
		await x.coordinator.enqueue();
		x.create.reject(new TypeError("network request failed"));
		await x.coordinator.settled();
		expect(x.coordinator.snapshot().phase).toBe("unconfirmed");
		await x.coordinator.retry();
		expect(x.start).toHaveBeenCalledTimes(1);
	});

	it("returns a refused command to the editor and keeps draining", async () => {
		const x = setup();
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/home/fixture" });
		x.coordinator.edit("invalid", []);
		await x.coordinator.enqueue();
		x.coordinator.edit("later", []);
		await x.coordinator.enqueue();
		let call = 0;
		x.send.mockImplementation(
			async (
				_id: string,
				message: { command_id: string; text: string; images?: unknown },
			) => {
				x.admissions.push({
					id: message.command_id,
					text: message.text,
					images: message.images,
				});
				if (++call === 1) throw refused(422, "that command is not valid here");
			},
		);
		x.create.resolve({ session_id: "session-a" });
		await x.coordinator.settled();
		// The rejected item is gone from the queue, its bytes are editable again, and
		// the message behind it was not stalled behind a dead replay.
		expect(x.coordinator.snapshot().queue).toHaveLength(0);
		expect(x.coordinator.snapshot().draft.text).toBe("invalid");
		expect(x.admissions.map((item) => item.text)).toEqual(["invalid", "later"]);
	});
});

/**
 * QA round 1: a refused create must not be a dead end. The copy asks the reader to
 * check the folder, so the controls and the restart path have to honour that.
 */
describe("a refused create is recoverable", () => {
	const refusal = () =>
		new RelayError("rejected", "That folder is outside your home.", {
			status: 400,
		});

	it("accepts a corrected selection and retries with the new target", async () => {
		const x = setup();
		x.setStart(async (call) => {
			if (call === 1) throw refusal();
			return { session_id: "session-a" };
		});
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/etc" });
		x.coordinator.edit("A", []);
		await x.coordinator.enqueue();
		await x.coordinator.settled();
		expect(x.coordinator.snapshot().phase).toBe("refused");

		// The correction the copy promises: change the folder, then send again.
		await x.coordinator.configure({ cwd: "/tmp/valid" }, true);
		await x.coordinator.settled();
		expect(x.coordinator.snapshot().phase).toBe("ready");
		expect(x.selections.at(-1)).toMatchObject({ cwd: "/tmp/valid" });
	});

	it("restores a persisted refused record instead of discarding its queue", async () => {
		const x = setup();
		x.setStart(async () => {
			throw refusal();
		});
		await x.coordinator.ready;
		await x.coordinator.configure({ cwd: "/etc" });
		x.coordinator.edit("keep me", []);
		await x.coordinator.enqueue();
		await x.coordinator.settled();
		expect(x.coordinator.snapshot().phase).toBe("refused");

		// A fresh process over the same disk: the record is legal, the bytes survive.
		const reloaded = setup(x.disk());
		await reloaded.coordinator.ready;
		expect(reloaded.coordinator.snapshot().phase).toBe("refused");
		expect(
			reloaded.coordinator.snapshot().queue.map((item) => item.text),
		).toEqual(["keep me"]);
		expect(reloaded.coordinator.snapshot().error).toBeNull();
	});
});

/**
 * R3-1: a closed dispatch is a refusal to start, not an unknown outcome. It must
 * not leave the item in the blocked/HOLD state, because nothing was ever sent.
 */
describe("a sign-out refusal is not an ambiguous delivery", () => {
	it("returns the message to the editor when dispatch is closed", async () => {
		const x = setup();
		const session = setup();
		await session.coordinator.ready;
		await session.coordinator.configure({ cwd: "/home/fixture" });
		session.coordinator.edit("unsent", []);
		await session.coordinator.enqueue();
		session.send.mockImplementation(async () => {
			throw new DispatchClosedError();
		});
		session.create.resolve({ session_id: "session-a" });
		await session.coordinator.settled();
		expect(session.coordinator.snapshot().phase).not.toBe("blocked");
		expect(session.coordinator.snapshot().queue).toHaveLength(0);
		expect(session.coordinator.snapshot().error).toContain("not sent");
	});
});

/* UX U1, the trapped state: an ambiguous create leaves no session id, `retry()`
 * refuses it by design, and the old Home let Send keep appending to a queue that
 * nothing could drain. These three cases are the whole escape route. */
describe("a queue that cannot drain is not a dead end", () => {
	const unconfirmed = async () => {
		const x = setup();
		await x.coordinator.ready;
		x.coordinator.edit("first", []);
		await x.coordinator.enqueue();
		x.setStart(async () => {
			throw new Error("network unreachable");
		});
		await x.coordinator.configure({ cwd: "/home/fixture" });
		await x.coordinator.quiesce();
		expect(x.coordinator.snapshot().phase).toBe("unconfirmed");
		expect(x.coordinator.snapshot().queue).toHaveLength(1);
		return x;
	};

	it("refuses a send that would join the stranded queue and keeps the text editable", async () => {
		const x = await unconfirmed();
		x.coordinator.edit("second", []);
		await x.coordinator.enqueue();
		await x.coordinator.quiesce();

		expect(x.coordinator.snapshot().queue).toHaveLength(1);
		expect(x.coordinator.snapshot().draft.text).toBe("second");
		expect(x.coordinator.snapshot().error).toContain(
			"never confirmed as started",
		);
	});

	it("returns the stranded messages to the editor, in order, with no invented id", async () => {
		const x = await unconfirmed();
		x.coordinator.edit("second", []);

		expect(await x.coordinator.restoreQueueToDraft()).toBe(true);
		const snapshot = x.coordinator.snapshot();
		expect(snapshot.queue).toHaveLength(0);
		expect(snapshot.draft.text).toBe("second\n\nfirst");
		expect(snapshot.sessionId).toBeNull();

		await x.coordinator.flush();
		expect(x.disk()?.queue).toHaveLength(0);
		expect(x.disk()?.draft.text).toBe("second\n\nfirst");
	});

	it("discards only on an explicit word", async () => {
		const x = setup();
		await x.coordinator.ready;
		x.coordinator.edit("held", []);
		await x.coordinator.enqueue();
		await x.coordinator.flush();
		expect(x.coordinator.snapshot().queue).toHaveLength(1);

		expect(await x.coordinator.discardQueue()).toBe(true);
		expect(x.coordinator.snapshot().queue).toHaveLength(0);
		expect(x.coordinator.snapshot().draft.text).toBe("");
		await x.coordinator.flush();
		expect(x.disk()?.queue).toHaveLength(0);
	});
});
