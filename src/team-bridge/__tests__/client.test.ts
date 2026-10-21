import { describe, expect, it, vi } from "vitest";

import { createHubClient, HubError, hubErrorKind } from "@/team-bridge/client";

import { conversation, message, status, TENANT } from "./fixtures";

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
			generation: 100,
			platform: "ios",
			token: "apns-token",
			environment: "sandbox",
		});
		await client.unregisterDevice("inst-1", 101);
		expect(calls[0]?.init.method).toBe("PUT");
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			install_id: "inst-1",
			generation: 100,
			platform: "ios",
			token: "apns-token",
			environment: "sandbox",
		});
		expect(calls[1]?.init.method).toBe("DELETE");
		expect(calls[1]?.url).toContain(
			"/v1/messaging/push/devices/inst-1?generation=101",
		);
	});

	describe("image attachments", () => {
		const PNG = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7,
		]);
		const client = (impl: typeof fetch) =>
			createHubClient({
				accessToken: async () => "token-a",
				fetchImpl: impl,
				baseUrl: "https://hub.example",
			});

		it("text-only send stays byte-identical (no attachment_ids for older hubs)", async () => {
			const { impl, calls } = fakeFetch([() => ok(message(1, "a", "x"))]);
			await client(impl).send(TENANT, "c1", { clientRef: "r", body: "hi" });
			expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
				tenant_id: TENANT,
				client_ref: "r",
				body: "hi",
			});
			const again = fakeFetch([() => ok(message(1, "a", "x"))]);
			await client(again.impl).send(TENANT, "c1", {
				clientRef: "r",
				body: "hi",
				attachmentIds: [],
			});
			expect(JSON.parse(String(again.calls[0]?.init.body))).not.toHaveProperty(
				"attachment_ids",
			);
		});

		it("image-only send carries an empty body and the ids", async () => {
			const { impl, calls } = fakeFetch([() => ok(message(1, "a", "x"))]);
			await client(impl).send(TENANT, "c1", {
				clientRef: "r",
				body: "",
				attachmentIds: ["batt_1", "batt_2"],
			});
			expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
				tenant_id: TENANT,
				client_ref: "r",
				body: "",
				attachment_ids: ["batt_1", "batt_2"],
			});
		});

		it("uploads raw bytes with the bearer to the conversation's attachments route", async () => {
			const { impl, calls } = fakeFetch([
				() =>
					json(201, {
						msg: "ok",
						result: {
							attachment: {
								id: "batt_1",
								mime: "image/png",
								size: 9,
								width: 1,
								height: 1,
								sha256: "h",
								state: "staged",
								expires_at: "2026-10-24T00:00:00Z",
							},
						},
					}),
			]);
			const answer = await client(impl).uploadAttachment(TENANT, "c 1", PNG);
			expect(answer).toMatchObject({ id: "batt_1", mime: "image/png" });
			expect(calls[0]?.url).toBe(
				`https://hub.example/v1/messaging/conversations/c%201/attachments?tenant_id=${TENANT}`,
			);
			expect(calls[0]?.init.method).toBe("POST");
			expect(calls[0]?.init.body).toBe(PNG);
			const headers = calls[0]?.init.headers as Record<string, string>;
			expect(headers.authorization).toBe("Bearer token-a");
			expect(headers["content-type"]).toBe("application/octet-stream");
			expect(calls[0]?.init.credentials).toBe("omit");
		});

		it("classifies upload refusals: 413/415/422 invalid, 404 not_found, 429 rate_limited", async () => {
			for (const [status, code, kind] of [
				[413, "attachment_too_large", "invalid"],
				[415, "attachment_type_unsupported", "invalid"],
				[422, "attachment_invalid", "invalid"],
				[404, "attachment_not_found", "not_found"],
				[429, "rate_limited", "rate_limited"],
			] as const) {
				const { impl } = fakeFetch([() => json(status, { error: "no", code })]);
				const error = await client(impl)
					.uploadAttachment(TENANT, "c1", PNG)
					.catch((e: unknown) => e);
				expect(error).toBeInstanceOf(HubError);
				expect((error as HubError).kind).toBe(kind);
				expect((error as HubError).code).toBe(code);
			}
		});

		it("fetches bytes with the bearer, retrying once on 401", async () => {
			const tokens = vi.fn(async (o?: { force?: boolean }) =>
				o?.force ? "token-b" : "token-a",
			);
			const { impl, calls } = fakeFetch([
				() => json(401, { error: "expired" }),
				() =>
					new Response(PNG, {
						status: 200,
						headers: { "content-type": "image/png" },
					}),
			]);
			const answer = await createHubClient({
				accessToken: tokens,
				fetchImpl: impl,
				baseUrl: "https://hub.example",
			}).attachmentBytes(TENANT, "c1", "m1", "batt_1");
			expect(answer.mime).toBe("image/png");
			expect(Array.from(answer.bytes)).toEqual(Array.from(PNG));
			expect(calls[1]?.url).toBe(
				`https://hub.example/v1/messaging/conversations/c1/messages/m1/attachments/batt_1?tenant_id=${TENANT}`,
			);
			expect(
				(calls[1]?.init.headers as Record<string, string>).authorization,
			).toBe("Bearer token-b");
		});

		it("fails closed on bytes that are not PNG/JPEG or contradict the served type", async () => {
			for (const response of [
				() =>
					new Response("<html>edge</html>", {
						status: 200,
						headers: { "content-type": "text/html" },
					}),
				() =>
					new Response(PNG, {
						status: 200,
						headers: { "content-type": "image/jpeg" },
					}),
			]) {
				const { impl } = fakeFetch([response]);
				const error = await client(impl)
					.attachmentBytes(TENANT, "c1", "m1", "batt_1")
					.catch((e: unknown) => e);
				expect((error as HubError).kind).toBe("malformed");
			}
			const missing = fakeFetch([
				() => json(404, { error: "not found", code: "attachment_not_found" }),
			]);
			const gone = await client(missing.impl)
				.attachmentBytes(TENANT, "c1", "m1", "batt_x")
				.catch((e: unknown) => e);
			expect((gone as HubError).kind).toBe("not_found");
		});

		it("delete of a staged image is idempotent (404 is success)", async () => {
			const { impl, calls } = fakeFetch([
				() => json(404, { error: "gone", code: "attachment_not_found" }),
			]);
			await expect(
				client(impl).deleteAttachment(TENANT, "c1", "batt_1"),
			).resolves.toBeUndefined();
			expect(calls[0]?.init.method).toBe("DELETE");
			expect(calls[0]?.url).toBe(
				`https://hub.example/v1/messaging/conversations/c1/attachments/batt_1?tenant_id=${TENANT}`,
			);
		});
	});
});
