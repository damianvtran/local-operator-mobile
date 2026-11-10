import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelayError } from "@/relay";
import {
	CAPACITY,
	connectPhaseSnapshot,
	errorFacts,
	formatConnectPhases,
	MESSAGE_CAP,
	recordConnectPhase,
	resetConnectPhases,
	sanitizeDiagnostic,
	subscribeConnectPhases,
} from "./connect-phases";

/* The ring is read off a public CI artifact (a Maestro hierarchy dump and the
 * simulator's unified log), so redaction is the property these tests exist for:
 * a password, cookie, token or URL query reaching the ring is a leak. */
const PASSWORD = "hunter2-correct-horse";

describe("connect phase ring", () => {
	beforeEach(() => {
		resetConnectPhases();
		vi.spyOn(console, "info").mockImplementation(() => undefined);
	});
	afterEach(() => vi.restoreAllMocks());

	it("records phases in order with closed-vocabulary facts", () => {
		recordConnectPhase("start", { facts: { allowInsecure: true } });
		recordConnectPhase("auth-response", { facts: { signedIn: true } });
		const phases = connectPhaseSnapshot().map((entry) => entry.phase);
		expect(phases).toEqual(["start", "auth-response"]);
		expect(formatConnectPhases()).toMatch(
			/^t\+\d+ start allowInsecure=true\nt\+\d+ auth-response signedIn=true$/,
		);
	});

	it("maps an unknown phase name to `unknown` rather than recording the text", () => {
		recordConnectPhase(`password=${PASSWORD}` as never);
		expect(connectPhaseSnapshot()[0]?.phase).toBe("unknown");
		expect(formatConnectPhases()).not.toContain(PASSWORD);
	});

	it("drops fact keys that are not plain words", () => {
		recordConnectPhase("start", {
			facts: { "set-cookie": "lo_session=abc", ok: 1 } as never,
		});
		expect(connectPhaseSnapshot()[0]?.facts).toEqual({ ok: 1 });
	});

	it("is bounded at CAPACITY entries, oldest dropped", () => {
		for (let i = 0; i < CAPACITY + 10; i += 1)
			recordConnectPhase("stream-state", { facts: { i } });
		const ring = connectPhaseSnapshot();
		expect(ring).toHaveLength(CAPACITY);
		expect(ring[0]?.facts?.i).toBe(10);
	});

	it("notifies subscribers and writes one log line per entry", () => {
		const listener = vi.fn();
		const off = subscribeConnectPhases(listener);
		recordConnectPhase("golive-start");
		off();
		recordConnectPhase("done");
		expect(listener).toHaveBeenCalledTimes(1);
		expect(console.info).toHaveBeenCalledWith(
			expect.stringMatching(/^\[connect-phase\] t\+\d+ golive-start$/),
		);
	});

	it("never carries the attempt's password, a cookie or a token in an error", () => {
		const native = Object.assign(
			new Error(
				`POST http://user:${PASSWORD}@relay.local/login?next=/x&token=abc failed; Cookie: lo_session=s3cr3t; body password=${PASSWORD}; Authorization: Bearer eyJabc.def`,
			),
			{ code: "ERR_NETWORK" },
		);
		recordConnectPhase("error", { error: native, secrets: [PASSWORD] });
		const text = formatConnectPhases();
		for (const leak of [PASSWORD, "s3cr3t", "token=abc", "eyJabc", "user:"])
			expect(text).not.toContain(leak);
		expect(text).toContain("code=ERR_NETWORK");
		expect(text).toContain("http://relay.local/login");
	});

	it("keeps a RelayError's typed fields and its platform cause's code", () => {
		const cause = Object.assign(new Error("Could not connect to the server."), {
			domain: "NSURLErrorDomain",
			code: -1004,
		});
		const facts = errorFacts(
			new RelayError("transport", "the request did not reach the relay", {
				cause,
			}),
		);
		expect(facts).toMatchObject({
			kind: "transport",
			surface: expect.any(String),
			code: "NSURLErrorDomain:-1004",
		});
		expect(facts.message).toContain("Could not connect to the server.");
	});

	it("refuses a `code` that is a sentence rather than a code", () => {
		const facts = errorFacts(
			Object.assign(new Error("x"), { code: "not a code, a sentence" }),
		);
		expect(facts.code).toBeUndefined();
	});

	it("caps a message at MESSAGE_CAP characters", () => {
		expect(sanitizeDiagnostic("a".repeat(MESSAGE_CAP * 3))).toHaveLength(
			MESSAGE_CAP,
		);
	});
});
