import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runTunnelTest } from "@/features/auth/tunnel-test";
import { verdictSentence } from "@/features/auth/tunnel-verdict";

/**
 * The own-tunnel test path, driven end to end with a stubbed transport.
 *
 * Why this file exists: the screen used to flatten EVERY failure into "That password
 * was not accepted." — a dead guard (`!result.detail.includes("HTTP 0")`, a string
 * nothing produces) rethrew each one as `relay-unauthorized`, so a whole-relay 503, a
 * 403 policy, a rejected certificate, an unresolvable host and a timeout all reached
 * the reader as a wrong-password sentence. QA measured that on five faults. A branch
 * no test could reach is exactly how it survived, so each outcome below drives the
 * real `runTunnelTest` — the real client, the real http layer, the real classifier —
 * and asserts the SENTENCE, which is what the reader gets.
 */

const URL_OK = "https://tunnel.example.test";

type Reply = {
	status: number;
	body?: string;
	headers?: Record<string, string>;
};

/** A REAL list frame, from the wire contract's own fixtures: the success case has to
 *  pass the app's schema, or it would be testing the stub rather than the path. */
import { RelayError } from "@/relay";

const LIST_FIXTURE = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL(
				"../../../fixtures/relay/http/list-after-wake.json",
				import.meta.url,
			),
		),
		"utf8",
	),
) as { status: number; body: unknown; headers: Record<string, string> };

const listReply: Reply = {
	status: LIST_FIXTURE.status,
	body: JSON.stringify(LIST_FIXTURE.body),
	headers: LIST_FIXTURE.headers,
};

/** A transport that answers the two routes this path uses, per test. */
const transport =
	(
		login: Reply | "reject" | "hang" | "tls" | "host",
		sessions: Reply = listReply,
	): typeof globalThis.fetch =>
	async (input: RequestInfo | URL) => {
		const url = String(input instanceof Request ? input.url : input);
		const reply = url.includes("/login") ? login : sessions;
		if (reply === "reject") throw new TypeError("Failed to fetch");
		/* The typed failures the real client raises when the platform CAN tell the
		 *  two apart. This is the seam's whole purpose: a browser's `fetch` reports a
		 *  rejected certificate and an unresolvable host as one untyped rejection, so
		 *  without this the classifier's two arms for them could not be reached. */
		if (reply === "tls")
			throw new RelayError(
				"certificate-rejected",
				"the certificate was rejected",
			);
		if (reply === "host")
			throw new RelayError("host-unresolved", "the host could not be resolved");
		if (reply === "hang") return new Promise<Response>(() => {});
		return new Response(reply.body ?? "", {
			status: reply.status,
			headers: { "content-type": "application/json", ...reply.headers },
		});
	};

const test = (
	login: Reply | "reject" | "hang" | "tls" | "host",
	timeoutMs = 300,
) =>
	runTunnelTest(
		{
			url: URL_OK,
			password: "[redacted]",
			allowInsecure: false,
			timeoutMs,
		},
		{ fetchImpl: transport(login) },
	);

describe("runTunnelTest reaches its own verdict for every fault", () => {
	it("succeeds when the login is accepted and the list answers", async () => {
		const result = await test({ status: 303 });
		expect(result.verdict.kind).toBe("ok");
	});

	it("reads a refused password as a password problem", async () => {
		const result = await test({ status: 401, body: "nope" });
		expect(result.verdict.kind).toBe("password");
	});

	it("reads a 403 as the access policy, NOT as a password", async () => {
		// The finding: this rendered "That password was not accepted." before the fix.
		const result = await test({ status: 403, body: "forbidden" });
		expect(result.verdict.kind).toBe("forbidden");
		expect(verdictSentence(result.verdict, "ios")).not.toContain(
			"password was not",
		);
	});

	it("reads a 503 as the computer being offline, NOT as a password", async () => {
		const result = await test({
			status: 503,
			body: "Tunnel temporarily unavailable",
		});
		expect(result.verdict.kind).toBe("offline");
		expect(verdictSentence(result.verdict, "ios")).toContain(
			"Tunnel temporarily unavailable",
		);
		expect(verdictSentence(result.verdict, "ios")).not.toContain(
			"password was not",
		);
	});

	it("reads a 404 as unreachable rather than as a password problem", async () => {
		// The name states what the assertion checks. It used to claim a reading the
		// taxonomy has no kind for ("the address no longer being a tunnel"); a 404 on
		// the admission route means nothing is there, and the assertion says so.
		const result = await test({ status: 404, body: "unknown tunnel host" });
		expect(result.verdict.kind).toBe("unreachable");
		expect(verdictSentence(result.verdict, "ios")).not.toContain(
			"password was not",
		);
	});

	it("reads a rejected request as unreachable rather than as a bad password", async () => {
		// The transport case. On the web target a rejected certificate and a DNS
		// failure arrive identically here — Chrome withholds the reason — which is why
		// `tls`/`host` are unevidenced on web rather than claimed.
		const result = await test("reject");
		expect(["unreachable", "host", "tls"]).toContain(result.verdict.kind);
		expect(verdictSentence(result.verdict, "ios")).not.toContain(
			"password was not",
		);
	});

	it("reads a request that never answers as a timeout", async () => {
		const result = await test("hang", 150);
		expect(["timeout", "unreachable"]).toContain(result.verdict.kind);
	});

	it("names a rejected certificate as the certificate", async () => {
		// The case a self-signed cloudflared/ngrok certificate produces. Unreachable
		// from a browser capture, reachable here.
		const result = await test("tls");
		expect(result.verdict.kind).toBe("tls");
		expect(verdictSentence(result.verdict, "ios")).not.toContain(
			"password was not",
		);
	});

	it("names an unresolvable host as one", async () => {
		const result = await test("host");
		expect(result.verdict.kind).toBe("host");
		expect(verdictSentence(result.verdict, "ios")).not.toContain(
			"password was not",
		);
	});
});

describe("a private address reads its failures through the permission question", () => {
	/* The defect this pins: a same-Wi-Fi address that never answered used to render
	 *  the generic sentence, which says nothing about the one cause a phone adds to
	 *  that failure — the OS's local-network permission — and sends the reader to
	 *  check a computer that may be fine. A private ADDRESS changes the reading; a
	 *  public host must NOT change, or the sentence becomes a misdiagnosis — and a
	 *  private NAME must not either: a name that fails to resolve cannot be told
	 *  apart from one the OS gate blotted out on a platform that hides the DNS
	 *  reason (measured on the web target, 2026-10-06), so the branch is claimed
	 *  for literal addresses only (`isPrivateAddress`). */
	it("gets the local-network verdict, with the Settings path and the retry", async () => {
		const result = await runTunnelTest(
			{
				url: "http://192.168.7.7:4098",
				password: "[redacted]",
				allowInsecure: true,
				timeoutMs: 300,
			},
			{ fetchImpl: transport("reject") },
		);
		expect(result.verdict.kind).toBe("local-network");
		const sentence = verdictSentence(result.verdict, "ios");
		expect(sentence).toContain("Settings → Privacy & Security → Local Network");
		// The retry is named for the control the reader sees ("Test the connection"),
		// not for an action that has no matching label on screen.
		expect(sentence).toContain("Test the connection");
	});

	it("leaves a public address's identical failure on the generic sentence", async () => {
		const result = await test("reject");
		expect(result.verdict.kind).toBe("unreachable");
	});

	it("does not read a private NAME as the permission question", async () => {
		// The measured web case: `…local` that does not resolve used to render the
		// permission sentence the reader cannot act on (no typo is fixed in
		// Settings). The promotion is literal-only, so this now renders what an
		// unresolvable public name renders — never the Settings path.
		const result = await runTunnelTest(
			{
				url: "http://no-such-host-9f3a4c.local:4098",
				password: "[redacted]",
				allowInsecure: true,
				timeoutMs: 300,
			},
			{ fetchImpl: transport("reject") },
		);
		expect(result.verdict.kind).toBe("unreachable");
		expect(verdictSentence(result.verdict, "ios")).not.toContain("Settings");
	});
});

describe("the screen the reader actually sees", () => {
	it("keeps the taxonomy's sentence for a failure the relay stated", async () => {
		const result = await test({
			status: 503,
			body: "Tunnel temporarily unavailable",
		});
		const sentence = verdictSentence(result.verdict, "ios");
		expect(sentence).not.toContain("computer-offline");
		expect(sentence).not.toMatch(/\b[1-5]\d{2}\b/);
	});
});
