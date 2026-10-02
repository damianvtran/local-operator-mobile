import { describe, expect, it } from "vitest";
import {
	classify,
	type TunnelTestVerdict,
	transportKind,
	verdictSentence,
} from "@/features/auth/tunnel-verdict";
import { RelayError } from "@/relay";

/**
 * The own-tunnel verdict taxonomy.
 *
 * This is the logic the feature is made of: a self-hosted tunnel fails in six ways
 * that look identical from a phone, each with a different fix, and every one of
 * them is decided HERE rather than in a screen. The runner that feeds it
 * (`tunnel-test.ts`) is proven outside-in against the mock relay, because it needs
 * `@/connection` and cannot be imported by a Node test.
 */

const transport = (message: string) => {
	// The shape the relay layer produces when `fetch` itself rejects: a
	// `transport` RelayError whose cause carries the platform's own wording.
	const cause = new TypeError(message);
	return new RelayError("transport", `could not reach it: ${message}`, {
		detail: message,
		cause,
	});
};

describe("transportKind", () => {
	it("recognises a certificate problem, because that is a different fix", () => {
		// A self-signed edge is the common owned-tunnel failure, and "unreachable"
		// would send the reader to check DNS instead of the certificate.
		for (const message of [
			"unable to verify the first certificate",
			"SSL certificate problem: self signed certificate",
			"TLS handshake failed",
		]) {
			expect(transportKind(new TypeError(message))).toBe("tls");
		}
	});

	it("recognises a timeout", () => {
		expect(transportKind(new Error("tunnel test timeout"))).toBe("timeout");
		expect(transportKind(new Error("The operation was aborted"))).toBe(
			"timeout",
		);
	});

	it("names an unresolvable host as its own outcome, not as unreachable", () => {
		// The review's rule: a host that does not resolve gets its own sentence,
		// because the reader fixes it in the address, not in the tunnel.
		for (const message of [
			"getaddrinfo ENOTFOUND nope.invalid",
			"nodename nor servname provided, or not known",
			"Name or service not known",
		]) {
			expect(transportKind(new TypeError(message))).toBe("host");
		}
	});

	it("defaults to unreachable rather than guessing", () => {
		// A wrong specific pattern sends someone to fix the wrong thing: a socket that
		// refused the connection stayed unreachable, because the NAME was fine.
		expect(transportKind(new TypeError("Network request failed"))).toBe(
			"unreachable",
		);
		expect(
			transportKind(new TypeError("connect ECONNREFUSED 127.0.0.1:4098")),
		).toBe("unreachable");
	});
});

describe("classify", () => {
	it("maps the relay's own kinds onto the six reader-visible outcomes", () => {
		const cases: Array<[RelayError, TunnelTestVerdict["kind"]]> = [
			[
				new RelayError("relay-unauthorized", "authentication required"),
				"password",
			],
			[new RelayError("radiant-login-required", "sign in again"), "password"],
			[new RelayError("origin-refused", "cross-origin refused"), "forbidden"],
			[
				new RelayError("computer-offline", "Tunnel temporarily unavailable"),
				"offline",
			],
			[new RelayError("relay-down", "relay is not answering"), "offline"],
			[new RelayError("unknown-tunnel", "unknown tunnel host"), "unreachable"],
			[new RelayError("too-large", "too large"), "refused"],
		];
		for (const [error, kind] of cases) {
			expect(classify(error).kind).toBe(kind);
		}
	});

	it("gives an offline verdict the command that fixes it", () => {
		// The remedy is the difference between a diagnosis and an action, and the
		// command is the CLI's own (`lop mobile status`).
		const verdict = classify(new RelayError("computer-offline", "unavailable"));
		expect(verdict).toMatchObject({
			kind: "offline",
			remedy: "On that computer: lop mobile status",
		});
	});

	it("reads a rejected fetch's cause, not just its wrapper", () => {
		expect(
			classify(transport("self signed certificate in certificate chain")).kind,
		).toBe("tls");
		expect(classify(transport("Network request failed")).kind).toBe(
			"unreachable",
		);
	});

	it("treats a bare thrown value the way a failed fetch arrives", () => {
		expect(classify(new Error("getaddrinfo ENOTFOUND x")).kind).toBe("host");
	});

	it("splits the two outcomes the protocol layer now distinguishes", () => {
		// `certificate-rejected` and `host-unresolved` arrive as kinds PR #7's
		// remediation added. They are read by name here (this branch's union predates
		// them), and they must land on DIFFERENT verdicts.
		const certificate = new RelayError(
			"certificate-rejected" as never,
			"the certificate was rejected",
		);
		const host = new RelayError(
			"host-unresolved" as never,
			"the host name could not be found",
		);
		expect(classify(certificate).kind).toBe("tls");
		expect(classify(host).kind).toBe("host");
		expect(verdictSentence(classify(certificate))).not.toBe(
			verdictSentence(classify(host)),
		);
	});
});

describe("verdictSentence", () => {
	it("counts the sessions it can actually see", () => {
		expect(verdictSentence({ kind: "ok", sessions: 1 })).toContain("1 session");
		expect(verdictSentence({ kind: "ok", sessions: 4 })).toContain(
			"4 sessions",
		);
	});

	it("never shows a status code", () => {
		// The operator's rule for this screen, and the flows' rule for every refusal
		// surface: a reader is told what happened and what to change. A three-digit
		// code appearing here means somebody pasted a raw error instead of writing
		// the sentence.
		const verdicts: TunnelTestVerdict[] = [
			{ kind: "ok", sessions: 2 },
			{ kind: "invalid", reason: "Enter the address of your relay." },
			{ kind: "password" },
			{ kind: "forbidden", detail: "The edge refused a cross-origin request." },
			{
				kind: "offline",
				detail: "Tunnel temporarily unavailable",
				remedy: "lop mobile status",
			},
			{ kind: "tls", detail: "unable to verify the first certificate" },
			{ kind: "host", detail: "ENOTFOUND" },
			{ kind: "unreachable", detail: null },
			{ kind: "timeout" },
			{ kind: "refused", detail: null },
		];
		for (const verdict of verdicts) {
			// Addresses and ports legitimately contain three digits, so they are
			// stripped before the check: what must never appear is a bare status code.
			const prose = verdictSentence(verdict)
				.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "ADDRESS")
				.replace(/:\d+/g, ":PORT");
			expect(prose).not.toMatch(/\b[1-5]\d{2}\b/);
			expect(prose).not.toMatch(/\bHTTP\b/);
		}
	});

	it("says what to change for the failures that need a change", () => {
		// A 403 and a certificate failure are the two a reader can act on, so the
		// sentence has to name the change rather than only the symptom.
		expect(verdictSentence({ kind: "forbidden", detail: null })).toMatch(
			/allow the app through/i,
		);
		expect(verdictSentence({ kind: "tls", detail: null })).toMatch(
			/certificate/i,
		);
		expect(verdictSentence({ kind: "host", detail: null })).toMatch(
			/host name could not be found/i,
		);
		expect(
			verdictSentence({
				kind: "offline",
				detail: null,
				remedy: "lop mobile status",
			}),
		).toMatch(/lop mobile status/);
	});
});

describe("the rendered sentence, through the real classifier", () => {
	/* The finding this pins (review M1 / QA Q-02): the verdict's `detail` was built
	 *  from `error.summary` — the loggable `"<kind> <status> <reason>"` line — so an
	 *  offline Alert read "computer-offline 503 Tunnel temporarily unavailable On that
	 *  computer: lop mobile status". The hand-built verdicts above could not catch it,
	 *  because they never passed through `classify`. These do. */
	it("gives a refusal the guidance instead, with no kind and no status in it", () => {
		// `forbidden` is the one verdict that does not render the relay's words: its
		// sentence says what is likely in front of the tunnel and what to allow.
		const sentence = verdictSentence(
			classify(new RelayError("origin-refused", "refused", { status: 403 })),
		);
		expect(sentence).toContain("access policy");
		expect(sentence).not.toContain("origin-refused");
		// The sentence names a loopback ADDRESS on purpose, so addresses and ports are
		// stripped before looking for a bare status code — the same normalisation the
		// "never shows a status code" case above uses.
		const prose = sentence
			.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "ADDRESS")
			.replace(/:\d+/g, ":PORT");
		expect(prose).not.toMatch(/\b[1-5]\d{2}\b/);
	});

	it("carries the relay's own words, and neither the kind nor a status code", () => {
		const cases: Array<[RelayError, string]> = [
			[
				new RelayError("computer-offline", "Tunnel temporarily unavailable", {
					status: 503,
				}),
				"Tunnel temporarily unavailable",
			],
			[
				new RelayError("relay-down", "The relay is not answering", {
					status: 502,
				}),
				"The relay is not answering",
			],
			[
				new RelayError("too-large", "That message is too large", {
					status: 413,
				}),
				"That message is too large",
			],
		];
		// `forbidden` carries the taxonomy's own guidance rather than the detail; it is
		// checked separately below, so it is not in the table.
		for (const [error, expected] of cases) {
			const sentence = verdictSentence(classify(error));
			expect(sentence).toContain(expected);
			expect(sentence).not.toContain(error.kind);
			expect(sentence).not.toMatch(/\b[1-5]\d{2}\b/);
		}
	});
});
