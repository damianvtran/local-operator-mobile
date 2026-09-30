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
		login: Reply | "reject" | "hang",
		sessions: Reply = listReply,
	): typeof globalThis.fetch =>
	async (input: RequestInfo | URL) => {
		const url = String(input instanceof Request ? input.url : input);
		const reply = url.includes("/login") ? login : sessions;
		if (reply === "reject") throw new TypeError("Failed to fetch");
		if (reply === "hang") return new Promise<Response>(() => {});
		return new Response(reply.body ?? "", {
			status: reply.status,
			headers: { "content-type": "application/json", ...reply.headers },
		});
	};

const test = (login: Reply | "reject" | "hang", timeoutMs = 300) =>
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
		expect(verdictSentence(result.verdict)).not.toContain("password was not");
	});

	it("reads a 503 as the computer being offline, NOT as a password", async () => {
		const result = await test({
			status: 503,
			body: "Tunnel temporarily unavailable",
		});
		expect(result.verdict.kind).toBe("offline");
		expect(verdictSentence(result.verdict)).toContain(
			"Tunnel temporarily unavailable",
		);
		expect(verdictSentence(result.verdict)).not.toContain("password was not");
	});

	it("reads a 404 as the address no longer being a tunnel", async () => {
		const result = await test({ status: 404, body: "unknown tunnel host" });
		expect(result.verdict.kind).toBe("unreachable");
	});

	it("reads a rejected request as unreachable rather than as a bad password", async () => {
		// The transport case. On the web target a rejected certificate and a DNS
		// failure arrive identically here — Chrome withholds the reason — which is why
		// `tls`/`host` are unevidenced on web rather than claimed.
		const result = await test("reject");
		expect(["unreachable", "host", "tls"]).toContain(result.verdict.kind);
		expect(verdictSentence(result.verdict)).not.toContain("password was not");
	});

	it("reads a request that never answers as a timeout", async () => {
		const result = await test("hang", 150);
		expect(["timeout", "unreachable"]).toContain(result.verdict.kind);
	});
});

describe("the screen the reader actually sees", () => {
	it("keeps the taxonomy's sentence for a failure the relay stated", async () => {
		const result = await test({
			status: 503,
			body: "Tunnel temporarily unavailable",
		});
		const sentence = verdictSentence(result.verdict);
		expect(sentence).not.toContain("computer-offline");
		expect(sentence).not.toMatch(/\b[1-5]\d{2}\b/);
	});
});
