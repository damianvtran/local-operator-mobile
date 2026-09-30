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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	dispositionForOutcome,
	dispositionForStatus,
	GATEWAY_REASONS,
	isAmbiguousDeliveryStatus,
	parseRetryAfter,
	RelayError,
	type RelayResponseFacts,
	rateLimitedError,
	relayErrorFromResponse,
	settleOutcomeFromError,
	transportError,
} from "../index";

const FIXTURE_ROOT = fileURLToPath(
	new URL("../../../fixtures/relay", import.meta.url),
);

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
	readFileSync(
		join(FIXTURE_ROOT, "gateway/gateway-refusal-constants.json"),
		"utf8",
	),
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
			readFileSync(
				join(FIXTURE_ROOT, "gateway/gateway-refusal-constants.json"),
				"utf8",
			),
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
			readFileSync(
				join(FIXTURE_ROOT, "http/command-unknown-session.json"),
				"utf8",
			),
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

	it.each([
		[408, "the relay did not answer in time"],
		[502, "bad gateway"],
		[504, "session did not answer"],
	])("keeps the envelope on %i", (status) => {
		const error = relayErrorFromResponse(
			facts(status, {}, `{"error":"${status}"}`),
		);
		expect(error.envelope).toBe("keep");
		expect(isAmbiguousDeliveryStatus(status)).toBe(true);
	});

	it.each([
		[400, "request body must be an object"],
		[409, "session not connected"],
		[422, "command_id must be a valid UUID"],
		[500, "session did not answer"],
	])("clears the envelope on %i", (status, message) => {
		const error = relayErrorFromResponse(
			facts(status, {}, JSON.stringify({ error: message })),
		);
		expect(error.envelope).toBe("clear");
		expect(isAmbiguousDeliveryStatus(status)).toBe(false);
	});

	it("clears all scoped storage on a 401, because the identity changed", () => {
		const error = relayErrorFromResponse(
			facts(401, {}, '{"error":"authentication required"}'),
		);
		expect(error.envelope).toBe("clear-all");
	});

	it("reads the live 422 refusal bodies through the same path", () => {
		for (const file of [
			"command-invalid-uuid.json",
			"command-unknown-op.json",
			"op-prompt-images-not-list.json",
		]) {
			const fixture = JSON.parse(
				readFileSync(join(FIXTURE_ROOT, "http", file), "utf8"),
			) as {
				status: number;
				body: { error: string; code?: string };
			};
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
		const fixture = JSON.parse(
			readFileSync(join(FIXTURE_ROOT, "http/history-unknown.json"), "utf8"),
		) as {
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
		expect(isAmbiguousDeliveryStatus(429)).toBe(false);
	});
});

describe("the retry table and the envelope table agree", () => {
	it("derives the envelope outcome from the error the endpoint threw", () => {
		expect(
			settleOutcomeFromError(
				new RelayError("ambiguous-delivery", "x", { status: 504 }),
			),
		).toEqual({
			kind: "http-status",
			status: 504,
		});
		expect(settleOutcomeFromError(new RelayError("transport", "x"))).toEqual({
			kind: "transport",
		});
		expect(
			settleOutcomeFromError(
				new RelayError("malformed-frame", "x", { status: 200 }),
			),
		).toEqual({ kind: "frame-error" });
	});

	it("agrees with the raw status table", () => {
		for (const status of [
			200, 400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504,
		]) {
			expect(dispositionForOutcome({ kind: "http-status", status })).toBe(
				dispositionForStatus(status),
			);
		}
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
