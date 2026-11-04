import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mintTunnelSession } from "../tunnel-session";

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
	it.each([
		[401, "account unavailable", "oauth"],
		[402, "billing inactive", "billing"],
		[403, "tunnel unavailable", "disabled"],
		[404, "harness hostname not found", "harness"],
		[404, "tunnel not found", "account"],
		[500, "server unavailable", "rejected"],
	])("classifies HTTP %i (%s) as %s", async (status, message, failure) => {
		await expect(
			mintTunnelSession(input, {
				fetchImpl: async () =>
					Response.json({ message }, { status: Number(status) }),
			}),
		).rejects.toMatchObject({ failure, status });
	});
});
