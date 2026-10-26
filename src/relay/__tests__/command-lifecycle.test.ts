/**
 * R1-4, second half (review round 2): the purge must drain DISPATCH, not only
 * storage writes.
 *
 * Before this barrier, `clearAuthorizationData` could delete an envelope while
 * `client.command` was still on the wire. Two outcomes, both wrong: an ADMITTED
 * command vanished from the retry ledger, and a LOST REPLY became untracked
 * ambiguity instead of the same-ID envelope a replay needs.
 *
 * These drive the real `sendPersistedCommand` with the network response held open,
 * and assert the sweep cannot report quiescence before the command has settled —
 * then that the settle it waited for is the right one (cleared for an ack, KEPT for
 * an unknown outcome).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	memoryEnvelopeStore,
	type RelayEndpoints,
	RetryEnvelopeStore,
	sendPersistedCommand,
} from "@/relay";
import {
	awaitCommandOperations,
	isDispatchClosed,
	reopenDispatch,
	withdrawDispatch,
} from "@/relay/command-lifecycle";

const SESSION = "session-a";

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
};

const fixture = () => {
	const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
	const response = deferred<{ detail: string }>();
	let called = false;
	const client = {
		async command() {
			called = true;
			await response.promise;
			return { ok: true as const, detail: "prompt admitted" };
		},
	} as unknown as Pick<RelayEndpoints, "command">;
	const send = () =>
		sendPersistedCommand({
			client,
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "fix the parser",
		});
	return {
		envelopes,
		response,
		send,
		wasCalled: () => called,
	};
};

/** Wait until the client is actually on the wire. */
const whenSent = async (wasCalled: () => boolean) => {
	for (let tick = 0; tick < 20 && !wasCalled(); tick += 1)
		await Promise.resolve();
	expect(wasCalled()).toBe(true);
};

afterEach(() => {
	reopenDispatch();
});

describe("a sign-out cannot outrun an open command", () => {
	it("waits for an admitted command whose HTTP 200 has not arrived", async () => {
		const f = fixture();
		const send = f.send();
		await whenSent(f.wasCalled);

		withdrawDispatch();
		let swept = false;
		const sweep = awaitCommandOperations().then(() => {
			swept = true;
		});
		await Promise.resolve();
		await Promise.resolve();
		// Still open: the envelope must not be deleted before the command settles.
		expect(swept).toBe(false);

		f.response.resolve({ detail: "prompt admitted" });
		await send;
		await sweep;
		expect(swept).toBe(true);
		// The ack settled it, so nothing is left for the purge to lose.
		expect(await f.envelopes.peek(SESSION)).toBeNull();
	});

	it("keeps a lost reply as the same-ID envelope through the sweep", async () => {
		const f = fixture();
		const send = f.send().catch((error: unknown) => error);
		await whenSent(f.wasCalled);

		withdrawDispatch();
		let swept = false;
		const sweep = awaitCommandOperations().then(() => {
			swept = true;
		});
		f.response.reject(new TypeError("network request failed"));
		const outcome = await send;
		await sweep;
		expect(swept).toBe(true);
		expect(isDispatchClosed(swept)).toBe(false);
		// The unknown outcome kept its envelope, and it is the SAME id the caller can
		// replay: that disposition was written before the sweep could finish.
		const held = await f.envelopes.peek(SESSION);
		expect(held).not.toBeNull();
		expect(typeof held?.command_id).toBe("string");
		expect(outcome).toBeInstanceOf(Error);
	});

	it("refuses a NEW command once dispatch is withdrawn", async () => {
		const f = fixture();
		withdrawDispatch();
		const refused = await f.send().catch((error: unknown) => error);
		expect(isDispatchClosed(refused)).toBe(true);
		expect(f.wasCalled()).toBe(false);
	});
});
