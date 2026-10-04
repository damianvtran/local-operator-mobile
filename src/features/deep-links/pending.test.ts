import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	clearPendingDestination,
	noteConversationPush,
	noteSessionLink,
	peekPendingDestination,
	subscribePendingDestination,
	takePendingDestination,
} from "@/features/deep-links/pending";
import {
	THIS_COMPUTER,
	unknownConversationNote,
	unreachableComputerNote,
} from "@/features/deep-links/sentences";

/** The store is a module singleton (it has to be: `+native-intent` runs outside
 *  React), so each test starts by draining it through its public API. */
beforeEach(() => {
	clearPendingDestination();
});

describe("pending destinations", () => {
	it("holds a session link until it is taken, exactly once", () => {
		noteSessionLink("6714def86197");
		const held = peekPendingDestination();
		expect(held?.kind).toBe("session");
		if (held?.kind !== "session") throw new Error("unreachable");
		expect(held.sessionId).toBe("6714def86197");

		const taken = takePendingDestination();
		expect(taken?.id).toBe(held.id);
		// Consumed once: a second take — a re-render, a StrictMode double-effect,
		// a re-auth — resolves nothing.
		expect(peekPendingDestination()).toBeNull();
		expect(takePendingDestination()).toBeNull();
	});

	it("lets a push tap outrank a link recorded after it (ADR 0006 §6.2)", () => {
		// Both halves of a cold start arrive before anything is consumed; the
		// notification response wins even when the link was recorded LAST.
		noteConversationPush({ conversation: "handle-1", computer: null });
		noteSessionLink("6714def86197");
		const held = peekPendingDestination();
		expect(held?.kind).toBe("conversation");
		if (held?.kind !== "conversation") throw new Error("unreachable");
		expect(held.handle).toBe("handle-1");
	});

	it("does not let a link displace a held push tap", () => {
		noteConversationPush({ conversation: "handle-1", computer: "acct-x" });
		noteSessionLink("abc");
		expect(peekPendingDestination()?.kind).toBe("conversation");
	});

	it("replaces the latest of an equal rank", () => {
		noteSessionLink("first");
		noteSessionLink("second");
		const held = peekPendingDestination();
		if (held?.kind !== "session") throw new Error("expected a session");
		expect(held.sessionId).toBe("second");

		takePendingDestination();
		noteConversationPush({ conversation: "h1", computer: null });
		noteConversationPush({ conversation: "h2", computer: null });
		const push = peekPendingDestination();
		if (push?.kind !== "conversation") throw new Error("expected a push");
		expect(push.handle).toBe("h2");
	});

	it("notifies subscribers of notes and takes, and stops after unsubscribe", () => {
		const listener = vi.fn();
		const unsubscribe = subscribePendingDestination(listener);
		noteSessionLink("abc");
		expect(listener).toHaveBeenCalledTimes(1);
		takePendingDestination();
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
		noteSessionLink("def");
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("the resolver's sentences", () => {
	it("uses the app's name for the computer, or the honest placeholder", () => {
		expect(unknownConversationNote("Mini")).toBe(
			"That conversation isn't on Mini any more.",
		);
		expect(unknownConversationNote(THIS_COMPUTER)).toBe(
			"That conversation isn't on this computer any more.",
		);
		expect(unreachableComputerNote(THIS_COMPUTER)).toBe(
			"Could not reach this computer; here are your conversations.",
		);
	});
});
