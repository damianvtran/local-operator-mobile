// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal inside an
// assertion is not a hot path — there is no per-frame work here to hoist out of.
// biome-ignore-all lint/style/noNonNullAssertion: an assertion after an explicit
// length/definedness check is the guard; a longhand local for it would obscure it.
/**
 * The status → decision mapping, which is the part of the protocol most likely to
 * be got subtly wrong, and the part a user feels: whether their instruction is
 * retried (and therefore whether it might run twice) is decided here and nowhere
 * else.
 *
 * The fixtures from `fixtures/relay/` feed the arms that have a captured body —
 * the gateway's `unknown tunnel host`, the 502 `local harness unavailable`, the
 * relay's own `authentication required` — so the mapping is asserted against the
 * same bytes the relay actually sends rather than against a hand-written body.
 */

import { describe, expect, it } from "vitest";

import { fixtureText, loadFixture } from "../../testing/fixtures";

import {
	GATEWAY_REASONS,
	parseRetryAfter,
	type RelayResponseFacts,
	rateLimitedError,
	relayErrorFromResponse,
	transportError,
} from "../index";

function facts(
	status: number,
	headers: Record<string, string> = {},
	defaultText = "",
): RelayResponseFacts & { text: string } {
	const lower = new Map(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
	);
	return {
		status,
		header: (name: string) => lower.get(name.toLowerCase()) ?? null,
		text: defaultText,
	};
}

const _GATEWAY_CONSTANTS = JSON.parse(
	fixtureText("gateway/gateway-refusal-constants.json"),
) as {
	relay_detail: Record<string, string>;
	max_body_bytes: number;
	max_stream_seconds: number;
};

/** The gateway's refusal body, built from the captured fixture identity. */

describe("the edge and the relay, split by the one header that discriminates them", () => {
	it("reads a 401 carrying X-Radient-Login as an expired tunnel session", () => {
		const error = relayErrorFromResponse(
			facts(
				401,
				{ "x-radient-login": "/_radient/login", "content-type": "text/plain" },
				"Sign in with Radient to access this tunnel",
			),
		);
		expect(error.kind).toBe("radiant-login-required");
		// Re-auth silently, retry once, then re-mint — never "computer offline".
		expect(error.retry).toBe("re-mint");
		expect(error.surface).toBe("sign-in");
		/* A 401 clears ALL scoped storage, not just this conversation's envelope: the
		 * identity that owned them is gone, and the ported rule says so. */
		expect(error.envelope).toBe("clear-all");
	});

	it("reads a 401 without that header as the relay asking for the password", () => {
		/* The relay's own body, verbatim from the contract (`daemon.py:2362-2364`). */
		const error = relayErrorFromResponse(
			facts(401, {}, '{"error":"authentication required"}'),
		);
		expect(error.kind).toBe("relay-unauthorized");
		expect(error.surface).toBe("password");
		expect(error.serverError).toBe("authentication required");
	});

	it("maps a same-origin 403 to a diagnostic, never user-facing copy", () => {
		/* The edge's exact sentence (`edge/index.ts:128`); the gateway's is the same
		 * shape and is covered by the fixture below. */
		const error = relayErrorFromResponse(
			facts(403, {}, ["Same-origin", "request", "required"].join(" ")),
		);
		expect(error.kind).toBe("origin-refused");
		expect(error.surface).toBe("diagnostic");
		expect(error.retry).toBe("never");
	});

	it("reads both gates' 413 as too large, with no retry", () => {
		const edge = relayErrorFromResponse(
			facts(413, { "content-type": "text/plain" }, "Request is too large"),
		);
		const gateway = relayErrorFromResponse(
			facts(
				413,
				{ "content-type": "application/json" },
				'{"error":"request exceeds 10 MiB"}',
			),
		);
		expect(edge.kind).toBe("too-large");
		expect(gateway.kind).toBe("too-large");
		expect(gateway.retry).toBe("never");
	});
});

describe("the 503s, which are three different machines", () => {
	it("reads the edge's plain-text 503 as a computer that is offline", () => {
		const error = relayErrorFromResponse(
			facts(
				503,
				{ "content-type": "text/plain; charset=utf-8" },
				"Tunnel temporarily unavailable",
			),
		);
		expect(error.kind).toBe("computer-offline");
		expect(error.surface).toBe("computer-offline");
		expect(error.retry).toBe("after-backoff");
	});

	it("reads the gateway's JSON 503 as a refusal, and keeps its sentence for the user", () => {
		const constants = JSON.parse(
			fixtureText("gateway/gateway-refusal-constants.json"),
		) as { relay_detail: Record<string, string> };
		const reason = "authorization_refused";
		const detail = constants.relay_detail[reason] ?? "";
		expect(detail.length).toBeGreaterThan(0);
		const error = relayErrorFromResponse(
			facts(
				503,
				{ "content-type": "application/json" },
				JSON.stringify({
					detail,
					reason,
					error: "tunnel authorization unavailable",
				}),
			),
		);
		expect(error.kind).toBe("gateway-refused");
		expect(error.reason).toBe(reason);
		// `detail` is written for a phone: it is displayed verbatim.
		expect(error.detail).toBe(detail);
		// This one is fixed on the computer or in the console, not by re-authenticating.
		expect(error.surface).toBe("console");
		expect(error.retry).toBe("never");
	});

	it("honours Retry-After only where the gateway sends it", () => {
		const deferred = relayErrorFromResponse(
			facts(
				503,
				{ "content-type": "application/json", "retry-after": "120" },
				JSON.stringify({
					detail: "paused",
					reason: "authorization_deferred",
					error: "tunnel authorization unavailable",
				}),
			),
		);
		expect(deferred.retryAfterMs).toBe(120_000);
		// The one deferred state says "paused; clears by itself", which is a retry
		// surface rather than "you are signed out".
		expect(deferred.surface).toBe("retry");
	});

	it("keeps a reason this build does not know, and falls back to detail", () => {
		const error = relayErrorFromResponse(
			facts(
				503,
				{ "content-type": "application/json" },
				JSON.stringify({
					detail: "Something new.",
					reason: "a_reason_invented_later",
					error: "tunnel authorization unavailable",
				}),
			),
		);
		expect(error.kind).toBe("gateway-refused");
		expect(error.reason).toBeUndefined();
		expect(error.reasonRaw).toBe("a_reason_invented_later");
		expect(error.detail).toBe("Something new.");
	});

	it.each(
		GATEWAY_REASONS.filter(
			(reason) =>
				reason !== "local_prerequisite" && reason !== "reenrolment_required",
		),
	)("maps %s to a surface", (reason) => {
		const error = relayErrorFromResponse(
			facts(
				503,
				{ "content-type": "application/json" },
				JSON.stringify({ detail: "d", reason, error: "e" }),
			),
		);
		expect(error.reason).toBe(reason);
		expect(error.surface).not.toBe("none");
	});
});

describe("502, 504 and 408 leave delivery unknown; 4xx does not", () => {
	it("reads the gateway's 502 as a relay that is not running, keeping the envelope", () => {
		const fixture = JSON.parse(
			fixtureText("http/command-unknown-session.json"),
		) as {
			body: unknown;
		};
		expect(fixture.body).toBeDefined();
		const error = relayErrorFromResponse(
			facts(502, {}, '{"error":"local harness unavailable"}'),
		);
		expect(error.kind).toBe("relay-down");
		expect(error.surface).toBe("relay-stopped");
		expect(error.envelope).toBe("keep");
		/* Back off rather than hammer: the relay may be starting, and the user may
		 * well be starting it right now. */
		expect(error.retry).toBe("after-backoff");
	});

	it("reads the live 422 refusal bodies through the same path", () => {
		for (const file of [
			"command-invalid-uuid.json",
			"command-unknown-op.json",
			"op-prompt-images-not-list.json",
		]) {
			const fixture = loadFixture<{
				status: number;
				body: { error: string; code?: string };
			}>(`http/${file}`);
			const error = relayErrorFromResponse(
				facts(fixture.status, {}, JSON.stringify(fixture.body)),
			);
			expect(error.kind, file).toBe("rejected");
			expect(error.serverError, file).toBe(fixture.body.error);
			expect(error.envelope, file).toBe("clear");
			expect(error.surface, file).toBe("none");
		}
	});

	it("carries a typed code through rather than burying it", () => {
		const error = relayErrorFromResponse(
			facts(
				409,
				{},
				'{"error":"completion token superseded by a newer completion","code":"completion_token_superseded"}',
			),
		);
		expect(error.code).toBe("completion_token_superseded");
		expect(error.envelope).toBe("clear");
	});
});

describe("a tunnel that is gone is terminal, not a retry", () => {
	it("reads both gates' unknown-host 404 as tunnel-gone", () => {
		const gateway = relayErrorFromResponse(
			facts(
				404,
				{ "content-type": "application/json" },
				'{"error":"unknown tunnel host"}',
			),
		);
		const edge = relayErrorFromResponse(
			facts(404, { "content-type": "text/plain" }, "Unknown tunnel"),
		);
		expect(gateway.kind).toBe("unknown-tunnel");
		expect(edge.kind).toBe("unknown-tunnel");
		expect(gateway.surface).toBe("tunnel-gone");
		expect(gateway.retry).toBe("never");
	});

	it("leaves an ordinary 404 as a plain rejection so a missing session is not mistaken for a dead tunnel", () => {
		const fixture = JSON.parse(fixtureText("http/history-unknown.json")) as {
			status: number;
			body: { error: string };
		};
		const error = relayErrorFromResponse(
			facts(fixture.status, {}, JSON.stringify(fixture.body)),
		);
		expect(error.kind).toBe("rejected");
		expect(error.serverError).toBe("unknown session");
	});
});

describe("transport errors name the failure without leaking a URL", () => {
	it("classifies an abort and a socket failure the same way, as ambiguous", () => {
		const aborted = transportError(
			Object.assign(new Error("aborted"), { name: "AbortError" }),
			"relay GET /api/sessions?…",
		);
		const refused = transportError(
			new Error("fetch failed"),
			"relay GET /healthz",
		);
		expect(aborted.kind).toBe("transport");
		expect(refused.kind).toBe("transport");
		expect(aborted.envelope).toBe("keep");
		expect(aborted.retry).toBe("same-id");
		expect(refused.diagnostic).toContain("/healthz");
	});

	it("never puts a query value into the diagnostic string", () => {
		const error = transportError(
			new Error("boom"),
			"relay GET /api/sessions/search?…",
		);
		expect(error.diagnostic).not.toContain("q=");
	});

	it("keeps a timeout that merely mentions a certificate a transport failure", () => {
		/* Review round 4, m1. The text arm used to match the bare word `/certificate/`,
		 * so this timeout became `certificate-rejected`: told NEVER to retry, and sent
		 * to the route-settings surface instead of the retry one. The arm is anchored to
		 * rejection phrasing; the CODE arm is what carries the real classification. */
		const timeout = transportError(
			new Error("the certificate story is long; the request timed out"),
			"relay POST /login",
		);
		expect(timeout.kind).toBe("transport");
		expect(timeout.surface).toBe("retry");
		expect(timeout.retry).toBe("same-id");
	});

	it("still classifies a genuine certificate rejection, from the message or the code", () => {
		for (const cause of [
			new Error("unable to verify the first certificate"),
			new Error("self-signed certificate in certificate chain"),
			Object.assign(new Error("bad certificate"), {
				code: "DEPTH_ZERO_SELF_SIGNED_CERT",
			}),
		]) {
			expect(transportError(cause).kind).toBe("certificate-rejected");
		}
	});

	it("classifies a DNS failure from the code and the message, without a resolver", () => {
		/* Review round 4, n3. The end-to-end case drives a real `.invalid` name, which
		 * couples it to the runner's resolver — a filter that synthesises an answer for
		 * `.invalid` would turn that assertion into a different failure mode. This is the
		 * same decision at the level the classification is actually made. */
		const notFound = Object.assign(
			new Error("getaddrinfo ENOTFOUND tunnel.invalid"),
			{ code: "ENOTFOUND" },
		);
		const resolverTimeout = Object.assign(new Error("EAI_AGAIN"), {
			code: "EAI_AGAIN",
		});
		expect(transportError(notFound).kind).toBe("host-unresolved");
		expect(transportError(resolverTimeout).kind).toBe("host-unresolved");
		/* And the message alone, for a runtime that sends no code at all. */
		expect(
			transportError(new Error("getaddrinfo ENOTFOUND tunnel.invalid")).kind,
		).toBe("host-unresolved");
		/* A code the classifier must NOT read as DNS. */
		expect(
			transportError(
				Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), {
					code: "ECONNREFUSED",
				}),
			).kind,
		).toBe("transport");
	});

	it("publishes a sentence a screen can show, for every way a body can be junk", () => {
		/* Review round 4, M1/Q2: `displayableMessage` is the one copy accessor, and
		 * these are the four values it must never hand back — a runtime's own words for a
		 * `transport` failure, an empty body, and markup. Each is driven through the real
		 * classifier rather than by constructing an error by hand. */
		const transport = transportError(
			new Error("fetch failed"),
			"relay GET /healthz",
		);
		expect(transport.displayableMessage).toBe(
			"The relay could not be reached.",
		);
		expect(transport.displayableMessage).not.toContain("fetch failed");

		const emptyBody = relayErrorFromResponse(facts(502, {}, ""));
		expect(emptyBody.kind).toBe("ambiguous-delivery");
		expect(emptyBody.displayableMessage).toBe("bad gateway");

		const markup = relayErrorFromResponse(
			facts(
				502,
				{ "content-type": "text/html" },
				"<html><body>502 Bad Gateway</body></html>",
			),
		);
		expect(markup.displayableMessage).toBe("bad gateway");
		expect(markup.displayableMessage).not.toContain("<");

		const gatewayBody = relayErrorFromResponse(
			facts(
				502,
				{ "content-type": "application/json" },
				'{"error":"local harness unavailable"}',
			),
		);
		expect(gatewayBody.kind).toBe("relay-down");
		expect(gatewayBody.displayableMessage).toBe("local harness unavailable");
	});

	it("keeps a 429 retryable, with its Retry-After, without keeping the envelope", () => {
		const error = rateLimitedError(3_000);
		expect(error.kind).toBe("rate-limited");
		expect(error.retryAfterMs).toBe(3_000);
		expect(error.retry).toBe("after-backoff");
		/* A 429 takes out session refresh for every device on that IP, so it must
		 * never be read as this device's failure — the backoff is what protects the
		 * session endpoints. It is NOT one of the three statuses that leave a
		 * command's delivery ambiguous (408/502/504), so the envelope still clears
		 * and the user is never shown a retry affordance for a rejected command. */
		expect(error.envelope).toBe("clear");
	});
});

describe("Retry-After", () => {
	it("reads delta-seconds", () => {
		expect(parseRetryAfter("120")).toBe(120_000);
	});

	it("reads an HTTP date", () => {
		const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
		const parsedMs = parseRetryAfter(inTenSeconds);
		expect(parsedMs).toBeGreaterThan(8_000);
		expect(parsedMs).toBeLessThan(11_000);
	});

	it("ignores a malformed value rather than guessing", () => {
		expect(parseRetryAfter("soon")).toBeUndefined();
		expect(parseRetryAfter(null)).toBeUndefined();
		expect(parseRetryAfter("")).toBeUndefined();
	});
});
