import { describe, expect, it } from "vitest";

import type { SessionTagsResponse, TagRef } from "@/contracts";
import {
	TagWriteQueue,
	type TagWriteRequest,
} from "@/features/sessions/tag-write-queue";
import type { TagWrite } from "@/features/sessions/tags";

const RESEARCH: TagRef = { id: "cb65004501", name: "Research" };
const WORK: TagRef = { id: "d28b35a273", name: "Work" };
const SESSION = "98a803224e43";
const OTHER = "b7c6d5e4f3a2";

const answer = (
	tags: TagRef[],
	primary: string | null,
): SessionTagsResponse => ({
	session_id: "98a803224e43",
	tags,
	primary,
});

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

/**
 * The sheet's write ordering, without a renderer.
 *
 * The component used to refuse a second press while one write was unanswered
 * (`if (pending !== null) return`), and the press disappeared with no signal
 * (review round 1, U2). These tests pin the replacement: every press is either
 * in flight or queued, the queue holds ONE request and always the newest, and a
 * refusal lands on the queued request it belongs to rather than being swallowed
 * or applied to the wrong one.
 */
describe("the tag write queue", () => {
	it("sends two rapid toggles as two PUTs, the last carrying both changes", async () => {
		const first = deferred<SessionTagsResponse>();
		const calls: TagWrite[] = [];
		const settled: TagWrite[] = [];
		const queue = new TagWriteQueue({
			send: (request) => {
				calls.push(request.desired);
				return calls.length === 1
					? first.promise
					: Promise.resolve(answer([RESEARCH, WORK], WORK.id));
			},
			onStart: () => {},
			onSettled: (request) => settled.push(request.desired),
			onRefused: () => {},
			onIdle: () => {},
		});

		/* Two presses in the time the first write is unanswered. The second
		 *  desired state is derived from the first's optimistic result, exactly
		 *  as the sheet's `toggle` derives it from the draft. */
		const one: TagWriteRequest = {
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id], primary: RESEARCH.id },
			key: RESEARCH.id,
		};
		const two: TagWriteRequest = {
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id, WORK.id], primary: RESEARCH.id },
			key: WORK.id,
		};
		queue.push(one);
		queue.push(two);

		expect(calls).toHaveLength(1);
		first.resolve(answer([RESEARCH], RESEARCH.id));
		await Promise.resolve();
		await Promise.resolve();

		expect(calls).toEqual([one.desired, two.desired]);
		expect(calls.at(-1)).toEqual({
			tags: [RESEARCH.id, WORK.id],
			primary: RESEARCH.id,
		});
		expect(settled).toEqual([one.desired, two.desired]);
	});

	it("coalesces several presses while one write is in flight to the newest", async () => {
		const first = deferred<SessionTagsResponse>();
		const calls: TagWrite[] = [];
		const queue = new TagWriteQueue({
			send: (request) => {
				calls.push(request.desired);
				return calls.length === 1
					? first.promise
					: Promise.resolve(answer([], null));
			},
			onStart: () => {},
			onSettled: () => {},
			onRefused: () => {},
			onIdle: () => {},
		});
		const stuck: TagWriteRequest = {
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id], primary: RESEARCH.id },
			key: "first",
		};
		queue.push(stuck);
		queue.push({
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id, WORK.id], primary: RESEARCH.id },
			key: "b",
		});
		queue.push({
			sessionId: SESSION,
			desired: { tags: [WORK.id], primary: WORK.id },
			key: "c",
		});

		first.resolve(answer([RESEARCH], RESEARCH.id));
		await Promise.resolve();
		await Promise.resolve();

		expect(calls).toEqual([
			stuck.desired,
			{ tags: [WORK.id], primary: WORK.id },
		]);
	});

	it("reverts through onRefused when the QUEUED write is refused", async () => {
		const first = deferred<SessionTagsResponse>();
		const second = deferred<SessionTagsResponse>();
		let inFlight = 0;
		let idle = 0;
		/** The sheet's draft: the revert it performs is dropping it to `null`. */
		let draft: TagWrite | null = {
			tags: [RESEARCH.id, WORK.id],
			primary: RESEARCH.id,
		};
		const refusals: unknown[] = [];
		const queue = new TagWriteQueue({
			send: () => (inFlight++ === 0 ? first.promise : second.promise),
			onStart: () => {},
			onSettled: () => {},
			onRefused: (_request, error) => {
				refusals.push(error);
				draft = null;
			},
			onIdle: () => {
				idle += 1;
			},
		});
		queue.push({
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id], primary: RESEARCH.id },
			key: RESEARCH.id,
		});
		queue.push({
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id, WORK.id], primary: RESEARCH.id },
			key: WORK.id,
		});

		first.resolve(answer([RESEARCH], RESEARCH.id));
		await Promise.resolve();
		await Promise.resolve();
		second.reject(new Error("Unknown category id"));
		await Promise.resolve();
		await Promise.resolve();

		expect(refusals).toHaveLength(1);
		expect(String(refusals[0])).toContain("Unknown category id");
		expect(draft).toBeNull();
		expect(idle).toBe(1);
	});

	it("comes to rest after a refusal with nothing queued", async () => {
		let idle = 0;
		const queue = new TagWriteQueue({
			send: () => Promise.reject(new Error("no")),
			onStart: () => {},
			onSettled: () => {},
			onRefused: () => {},
			onIdle: () => {
				idle += 1;
			},
		});
		queue.push({
			sessionId: SESSION,
			desired: { tags: [], primary: null },
			key: "*",
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(idle).toBe(1);
	});

	it("drops a queued write when the subject changes or the sheet closes", async () => {
		/* R2-1: the queue outlives `visible=false`. A queued press belongs to the
		 *  conversation that was on screen; it must not be sent after close (to an
		 *  empty id) or against whichever row opens next. */
		const first = deferred<SessionTagsResponse>();
		const calls: TagWriteRequest[] = [];
		const settled: TagWriteRequest[] = [];
		const queue = new TagWriteQueue({
			send: (request) => {
				calls.push(request);
				return calls.length === 1
					? first.promise
					: Promise.resolve(answer([], null));
			},
			onStart: () => {},
			onSettled: (request) => settled.push(request),
			onRefused: () => {},
			onIdle: () => {},
		});
		queue.push({
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id], primary: RESEARCH.id },
			key: RESEARCH.id,
		});
		queue.push({
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id, WORK.id], primary: RESEARCH.id },
			key: WORK.id,
		});
		expect(queue.hasQueued()).toBe(true);

		queue.reset();
		expect(queue.hasQueued()).toBe(false);

		first.resolve(answer([RESEARCH], RESEARCH.id));
		await Promise.resolve();
		await Promise.resolve();

		expect(calls.map((request) => request.sessionId)).toEqual([SESSION]);
		expect(settled).toHaveLength(0);
	});

	it("sends a press made after a subject change to the new subject only", async () => {
		const first = deferred<SessionTagsResponse>();
		const calls: TagWriteRequest[] = [];
		const queue = new TagWriteQueue({
			send: (request) => {
				calls.push(request);
				return calls.length === 1
					? first.promise
					: Promise.resolve(answer([WORK], WORK.id));
			},
			onStart: () => {},
			onSettled: () => {},
			onRefused: () => {},
			onIdle: () => {},
		});
		queue.push({
			sessionId: SESSION,
			desired: { tags: [RESEARCH.id], primary: RESEARCH.id },
			key: RESEARCH.id,
		});
		/* Close and open another row while the first PUT is still unanswered. */
		queue.reset();
		queue.push({
			sessionId: OTHER,
			desired: { tags: [WORK.id], primary: WORK.id },
			key: WORK.id,
		});

		first.resolve(answer([RESEARCH], RESEARCH.id));
		await Promise.resolve();
		await Promise.resolve();

		expect(calls.map((request) => request.sessionId)).toEqual([SESSION, OTHER]);
	});
});
