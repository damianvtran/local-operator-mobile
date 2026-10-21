import { describe, expect, it, vi } from "vitest";

import { createHubClient, HubError, hubErrorKind } from "@/team-bridge/client";

import { conversation, status, TENANT } from "./fixtures";

type Call = { url: string; init: RequestInit };

/** A fetch that answers from a queue and records what it was asked. */
function fakeFetch(answers: Array<() => Response | Promise<Response>>) {
	const calls: Call[] = [];
	const impl = vi.fn(
		async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			const next = answers.shift();
			if (!next) throw new Error("unexpected request");
			return next();
		},
	);
	return { impl: impl as unknown as typeof fetch, calls };
}

const json = (
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

const ok = (result: unknown) => json(200, { msg: "ok", result });

describe("hub client", () => {
	it("calls the hub directly with the Radient bearer, never a cookie, and parses the envelope", async () => {
		const { impl, calls } = fakeFetch([() => ok(status())]);
		const client = createHubClient({
			accessToken: async () => "token-a",
			fetchImpl: impl,
			baseUrl: "https://hub.example/",
		});
		const answer = await client.status();
		expect(answer.tenants[0]?.tenant_id).toBe(TENANT);
		expect(calls[0]?.url).toBe("https://hub.example/v1/messaging/status");
		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer token-a");
		expect(calls[0]?.init.credentials).toBe("omit");
	});

	it("refreshes once on a 401 and retries once; a second 401 is sign_in, not a loop", async () => {
		const tokens = vi.fn(async (options?: { force?: boolean }) =>
			options?.force ? "token-b" : "token-a",
		);
		const first = fakeFetch([
			() => json(401, { error: "invalid or expired token" }),
			() => ok(status()),
		]);
		await createHubClient({
			accessToken: tokens,
			fetchImpl: first.impl,
		}).status();
		expect(tokens).toHaveBeenLastCalledWith({ force: true });
		const retried = first.calls[1]?.init.headers as
			| Record<string, string>
			| undefined;
		expect(retried?.authorization).toBe("Bearer token-b");

		const twice = fakeFetch([
			() => json(401, { error: "x" }),
			() => json(401, { error: "x" }),
		]);
		await expect(
			createHubClient({ accessToken: tokens, fetchImpl: twice.impl }).status(),
		).rejects.toMatchObject({ kind: "sign_in", status: 401 });
		expect(twice.calls).toHaveLength(2);
	});

	it("no token at all is sign_in without a request", async () => {
		const { impl, calls } = fakeFetch([]);
		await expect(
			createHubClient({
				accessToken: async () => null,
				fetchImpl: impl,
			}).status(),
		).rejects.toMatchObject({ kind: "sign_in" });
		expect(calls).toHaveLength(0);
	});

	it("classifies the hub's coded refusals", () => {
		expect(hubErrorKind(403, "bridge_not_available")).toBe("plan");
		expect(hubErrorKind(403, "not_a_member")).toBe("refused");
		expect(hubErrorKind(503, "messaging_unavailable")).toBe("unavailable");
		expect(hubErrorKind(422, "invalid_request")).toBe("invalid");
		expect(hubErrorKind(409, "client_ref_conflict")).toBe("conflict");
		expect(hubErrorKind(429, "rate_limited")).toBe("rate_limited");
		expect(hubErrorKind(404, "conversation_not_found")).toBe("not_found");
		expect(hubErrorKind(500, null)).toBe("server");
	});

	it("carries the hub's field/rule and Retry-After on a refusal", async () => {
		const { impl } = fakeFetch([
			() =>
				json(422, {
					error: "invalid",
					code: "invalid_request",
					details: { field: "body", rule: "required" },
				}),
			() =>
				json(
					429,
					{ error: "slow down", code: "rate_limited" },
					{ "retry-after": "7" },
				),
		]);
		const client = createHubClient({
			accessToken: async () => "t",
			fetchImpl: impl,
		});
		await expect(
			client.send(TENANT, "c", { clientRef: "r", body: "" }),
		).rejects.toMatchObject({
			kind: "invalid",
			field: "body",
			rule: "required",
		});
		await expect(client.status()).rejects.toMatchObject({
			kind: "rate_limited",
			retryAfterMs: 7000,
		});
	});

	it("fails closed on a payload this build cannot read", async () => {
		const { impl } = fakeFetch([
			() => ok({ conversations: [{ id: "x" }] }),
			() => new Response("<html>edge</html>", { status: 200 }),
		]);
		const client = createHubClient({
			accessToken: async () => "t",
			fetchImpl: impl,
		});
		await expect(client.listConversations(TENANT)).rejects.toMatchObject({
			kind: "malformed",
		});
		await expect(client.status()).rejects.toMatchObject({ kind: "malformed" });
	});

	it("keeps additive fields (a newer hub) instead of failing", async () => {
		const { impl } = fakeFetch([
			() =>
				ok({
					conversations: [
						{ ...conversation(), thread_root_id: "x", reactions: [] },
					],
					has_more: false,
				}),
		]);
		const page = await createHubClient({
			accessToken: async () => "t",
			fetchImpl: impl,
		}).listConversations(TENANT);
		expect(page.conversations).toHaveLength(1);
	});

	it("a dead network is unreachable", async () => {
		const impl = vi.fn(async () => {
			throw new TypeError("Network request failed");
		}) as unknown as typeof fetch;
		await expect(
			createHubClient({
				accessToken: async () => "t",
				fetchImpl: impl,
			}).status(),
		).rejects.toBeInstanceOf(HubError);
	});

	it("sends the exact wire bodies: send carries client_ref, read carries seq, scope stays off writes", async () => {
		const { impl, calls } = fakeFetch([
			() =>
				ok({
					id: "bcm_1",
					conversation_id: "c1",
					seq: 5,
					sender: { account_id: "a", kind: "human", display_label: "Sam" },
					body: "hi",
					origin: "human",
					created_at: "2026-10-21T10:00:00Z",
				}),
			() =>
				ok({
					conversation_id: "c1",
					last_read_seq: 5,
					unread_count: 0,
					muted: false,
					notify: "all",
				}),
			() => ok({ total: 3, organizations: [] }),
		]);
		const client = createHubClient({
			accessToken: async () => "t",
			fetchImpl: impl,
		});
		await client.send(TENANT, "c1", { clientRef: "ref-1", body: "hi" });
		await client.markRead(TENANT, "c1", { seq: 5 });
		await client.accountUnread();
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			tenant_id: TENANT,
			client_ref: "ref-1",
			body: "hi",
		});
		expect(calls[0]?.url).toContain("/v1/messaging/conversations/c1/messages");
		expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
			tenant_id: TENANT,
			seq: 5,
		});
		expect(calls[2]?.url).toContain("/v1/messaging/unread?scope=account");
	});

	it("device registration and sign-out deregistration; a 404 on delete is already-gone success", async () => {
		const { impl, calls } = fakeFetch([
			() =>
				ok({
					device_id: "pd_1",
					platform: "ios",
					registered_at: "x",
					updated_at: "x",
				}),
			() => json(404, { error: "not found" }),
		]);
		const client = createHubClient({
			accessToken: async () => "t",
			fetchImpl: impl,
		});
		await client.registerDevice({
			installId: "inst-1",
			platform: "ios",
			token: "apns-token",
			environment: "sandbox",
		});
		await client.unregisterDevice("inst-1");
		expect(calls[0]?.init.method).toBe("PUT");
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			install_id: "inst-1",
			platform: "ios",
			token: "apns-token",
			environment: "sandbox",
		});
		expect(calls[1]?.init.method).toBe("DELETE");
		expect(calls[1]?.url).toContain("/v1/messaging/push/devices/inst-1");
	});
});
