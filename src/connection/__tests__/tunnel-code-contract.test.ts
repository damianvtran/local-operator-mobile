import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mintTunnelSession, TunnelSessionError } from "../tunnel-session";

// The server has two writers, not one uniform API envelope. Pin the observed
// issueSessionCode writer so a raw-only test double cannot hide this bug again.
const capture = JSON.parse(
	readFileSync(
		new URL("../../../fixtures/radient/session-code.json", import.meta.url),
		"utf8",
	),
);
const hostname = `${"0".repeat(32)}-lop.radienthq.com`;
const input = {
	tunnelId: "fixture-tunnel",
	hostname,
	oauthAccessToken: "fixture-oauth",
};
const rawTokens = {
	access_token: "fixture-grant",
	refresh_token: "fixture-handle",
	expires_in: 300,
};

describe("server-pinned session response contract", () => {
	it("records responses.WriteJSON's msg/result envelope and the three result keys", () => {
		expect(capture.source.writer).toBe("responses.WriteJSON");
		expect(capture.source.handler).toBe("issueSessionCode");
		expect(Object.keys(capture.body).sort()).toEqual(["msg", "result"]);
		expect(Object.keys(capture.body.result).sort()).toEqual([
			"callback_uri",
			"code",
			"state",
		]);
	});
	it.each(["enveloped", "legacy raw"])(
		"mints from %s code, then RAW token response",
		async (mode) => {
			const calls: string[] = [];
			const value = mode === "enveloped" ? capture.body : capture.body.result;
			const result = await mintTunnelSession(input, {
				fetchImpl: async (url, options) => {
					calls.push(String(url));
					if (String(url).endsWith("/code")) return Response.json(value);
					expect(JSON.parse(String(options?.body)).code).toBe(
						capture.body.result.code,
					);
					return Response.json(rawTokens);
				},
			});
			expect(result.grant).toBe(rawTokens.access_token);
			expect(calls).toHaveLength(2);
		},
	);
	it("does not exchange a malformed enveloped code, even if a decoy top-level code exists", async () => {
		let calls = 0;
		await expect(
			mintTunnelSession(input, {
				fetchImpl: async () => {
					calls++;
					return Response.json({ msg: "ok", result: {}, code: "decoy" });
				},
			}),
		).rejects.toMatchObject({ failure: "contract" });
		expect(calls).toBe(1);
	});
	const refusals = JSON.parse(
		readFileSync(
			new URL(
				"../../../fixtures/radient/session-refusals.json",
				import.meta.url,
			),
			"utf8",
		),
	) as {
		source: { handler: string };
		cases: { status: number; body: { error: string }; failure: string }[];
	};
	it.each(refusals.cases)(
		"classifies real HTTP $status/$body.error as $failure",
		async ({ status, body, failure }) => {
			expect(refusals.source.handler).toBe("httpErrorResponse");
			expect(Object.keys(body)).toEqual(["error"]);
			await expect(
				mintTunnelSession(input, {
					fetchImpl: async () => Response.json(body, { status }),
				}),
			).rejects.toMatchObject({ failure, status });
		},
	);
	it("prefers error over legacy msg/message and sends a missing harness to the concrete console remedy", async () => {
		const { refusalFromError, tunnelSessionRelayError } = await import(
			"../../features/auth/refusal"
		);
		const error = await mintTunnelSession(input, {
			fetchImpl: async () =>
				Response.json(
					{
						error: "harness hostname not found",
						msg: "tunnel not found",
						message: "tunnel not found",
					},
					{ status: 404 },
				),
		}).catch((error: unknown) => error);
		if (!(error instanceof TunnelSessionError))
			throw new Error("Expected typed refusal");
		expect(error.failure).toBe("harness");
		const relayError = tunnelSessionRelayError(error);
		const view = refusalFromError({
			error: relayError,
			surface: relayError.surface,
			detail: relayError.detail ?? null,
			retryAfterMs: null,
			subject: "Fixture computer",
		});
		expect(view?.kind).toBe("console");
		expect(view?.detail).toContain("Local Operator harness");
		expect(view?.remedy).toBeNull();
	});
});
