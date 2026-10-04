import { describe, expect, it } from "vitest";

import { sessionLinkOutcome } from "@/features/deep-links/session-link";
import { RelayError } from "@/relay";

/**
 * The stale-link verdict, and the half that matters most: silence must not
 * read as absence.
 *
 * A clean 404 from the existence route IS proof the conversation is gone
 * (contract.md §3.5), and earns the §6.6 sentence. Everything else — a
 * transport drop, a refusal, a timeout, a bug's TypeError — is not proof, and
 * must land on the unreachable path instead.
 */

describe("sessionLinkOutcome", () => {
	it("reads a relay 404 as missing", () => {
		expect(
			sessionLinkOutcome(
				new RelayError("rejected", "unknown session", { status: 404 }),
			),
		).toBe("missing");
	});

	it.each([
		["a transport failure", new RelayError("transport", "could not reach it")],
		[
			"a refusal with another status",
			new RelayError("relay-unauthorized", "authentication required", {
				status: 401,
			}),
		],
	])("reads %s as failed, never missing", (_label, error) => {
		expect(sessionLinkOutcome(error)).toBe("failed");
	});

	it.each([
		["a plain TypeError", new TypeError("undefined is not a function")],
		["a string", "boom"],
		["null", null],
		["undefined", undefined],
	])("reads a non-relay shape (%s) as failed", (_label, error) => {
		expect(sessionLinkOutcome(error)).toBe("failed");
	});
});
