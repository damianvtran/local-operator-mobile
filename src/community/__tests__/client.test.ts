import { describe, expect, it } from "vitest";
import {
	CommunityError,
	communityErrorFrom,
	createCommunityClient,
} from "@/community/client";

/**
 * The community client's wire behaviour: the root-relative route, the bearer,
 * the one forced refresh on 401, the idempotency header, and the refusal ladder
 * every composer outcome depends on. Bodies mirror agent-server
 * `docs/community-api.yaml` (branch feat/community-dm).
 */

type Call = { url: string; init: RequestInit };

function recorder(responses: Response[]) {
	const calls: Call[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const next = responses.shift();
		if (!next) throw new Error("unexpected request");
		return next;
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
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

const header = (call: Call | undefined, name: string) =>
	(call?.init.headers as Record<string, string> | undefined)?.[name];

describe("community client", () => {
	it("reads under the root-relative /community/v1 route with the phone's own bearer", async () => {
		const { calls, fetchImpl } = recorder([
			json(200, { joined: [], featured: [] }),
		]);
		const client = createCommunityClient({
			accessToken: async () => "tok-a",
			fetchImpl,
			baseUrl: "https://api.example.com/",
		});
		await client.listCommunities();
		expect(calls[0]?.url).toBe(
			"https://api.example.com/community/v1/communities",
		);
		expect(header(calls[0], "authorization")).toBe("Bearer tok-a");
		expect(calls[0]?.init.credentials).toBe("omit");
	});

	it("asks for exactly one forced refresh on a 401 and then signs out", async () => {
		const forced: boolean[] = [];
		const { calls, fetchImpl } = recorder([
			json(401, { message: "expired" }),
			json(401, { message: "expired" }),
		]);
		const client = createCommunityClient({
			accessToken: async (options) => {
				forced.push(Boolean(options?.force));
				return "tok";
			},
			fetchImpl,
		});
		const error = await client.listCommunities().catch((e) => e);
		expect(error).toBeInstanceOf(CommunityError);
		expect(error.kind).toBe("sign_in");
		expect(forced).toEqual([false, true]);
		expect(calls).toHaveLength(2);
	});

	it("submits multipart text with the attempt's Idempotency-Key", async () => {
		const { calls, fetchImpl } = recorder([
			json(200, {
				idempotency_key: "k".repeat(32),
				state: "published",
				message_id: "m1",
			}),
		]);
		const client = createCommunityClient({
			accessToken: async () => "t",
			fetchImpl,
		});
		const outcome = await client.submit({
			communityId: "local-operator-community",
			conversationId: "ch-general",
			text: "hello",
			idempotencyKey: "k".repeat(32),
			guidelinesVersion: "2026-11",
		});
		expect(outcome.state).toBe("published");
		expect(calls[0]?.url).toBe(
			"https://api.radienthq.com/community/v1/communities/local-operator-community/conversations/ch-general/submissions",
		);
		expect(header(calls[0], "idempotency-key")).toBe("k".repeat(32));
		/* The runtime writes the multipart boundary; a hand-set type would break it. */
		expect(header(calls[0], "content-type")).toBeUndefined();
		const form = calls[0]?.init.body as FormData;
		expect(form.get("text")).toBe("hello");
		expect(form.get("guidelines_version")).toBe("2026-11");
	});

	it("never sends a channel action as a nested path (`:join` stays on the id)", async () => {
		const { calls, fetchImpl } = recorder([
			json(200, { channel_id: "c1", state: "member" }),
		]);
		const client = createCommunityClient({
			accessToken: async () => "t",
			fetchImpl,
		});
		await client.joinChannel("local-operator-community", "c1");
		expect(calls[0]?.url?.endsWith("/channels/c1:join")).toBe(true);
		expect(calls[0]?.init.method).toBe("POST");
	});
});

describe("refusal ladder", () => {
	it("a 422 refusal carries its sender-only category and MOD reference", async () => {
		const error = await communityErrorFrom(
			json(422, {
				status: "refused",
				category: "spam_or_promotion",
				reference: "MOD-AB12-CD34",
			}),
		);
		expect(error.kind).toBe("refused");
		expect(error.refusal).toEqual({
			status: "refused",
			category: "spam_or_promotion",
			reference: "MOD-AB12-CD34",
		});
	});

	it("an unknown refusal category is never rendered as a guessed label", async () => {
		const error = await communityErrorFrom(
			json(422, {
				status: "refused",
				category: "new_kind",
				reference: "MOD-AB12-CD34",
			}),
		);
		expect(error.kind).toBe("malformed");
		expect(error.refusal).toBeNull();
	});

	it("429 keeps the server's retry_after (seconds) and scope", async () => {
		const error = await communityErrorFrom(
			json(429, {
				message: "slow down",
				retry_after: 12,
				scope: "conversation",
			}),
		);
		expect(error.kind).toBe("rate_limited");
		expect(error.retryAfterMs).toBe(12_000);
		expect(error.scope).toBe("conversation");
	});

	it("falls back to the Retry-After header when the body has no retry_after", async () => {
		const error = await communityErrorFrom(
			new Response("busy", { status: 429, headers: { "retry-after": "7" } }),
		);
		expect(error.retryAfterMs).toBe(7_000);
	});

	it.each([
		[503, { code: "moderation_unavailable" }, "moderation_unavailable"],
		[503, { message: "auth" }, "auth_unavailable"],
		[403, { code: "images_unavailable" }, "images_unavailable"],
		[403, { code: "restricted", reference: "MOD-AAAA-BBBB" }, "restricted"],
		[403, { message: "locked" }, "forbidden"],
		[
			409,
			{ code: "guidelines_changed", guidelines_version: "2026-12" },
			"guidelines_changed",
		],
		[409, { message: "read-only" }, "conflict"],
		[410, { code: "resync_required" }, "resync_required"],
		[404, { message: "not found" }, "not_found"],
		[500, { message: "x" }, "unavailable"],
	])("%i %j → %s", async (status, body, kind) => {
		const error = await communityErrorFrom(json(status, body));
		expect(error.kind).toBe(kind);
	});

	it("guidelines_changed names the version to re-accept", async () => {
		const error = await communityErrorFrom(
			json(409, {
				code: "guidelines_changed",
				guidelines_version: "2026-12",
				message: "x",
			}),
		);
		expect(error.guidelinesVersion).toBe("2026-12");
	});
});

describe("reports (review round 1, R1-1)", () => {
	const receipt = () =>
		json(201, { case_reference: "MOD-AAAA-BBBB", state: "submitted" });

	it("a DM message is reported as dm with consent and the revision read", async () => {
		const { calls, fetchImpl } = recorder([receipt()]);
		const client = createCommunityClient({
			accessToken: async () => "t",
			fetchImpl,
		});
		await client.report("loc", {
			targetKind: "dm",
			targetId: "m1",
			category: "harassment_or_abuse",
			dmConsent: true,
			revision: 3,
			idempotencyKey: "k".repeat(32),
		});
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			target_kind: "dm",
			target_id: "m1",
			category: "harassment_or_abuse",
			dm_consent: true,
			revision: 3,
		});
		expect(header(calls[0], "idempotency-key")).toBe("k".repeat(32));
	});

	it("a channel message carries no DM fields", async () => {
		const { calls, fetchImpl } = recorder([receipt()]);
		const client = createCommunityClient({
			accessToken: async () => "t",
			fetchImpl,
		});
		await client.report("loc", {
			targetKind: "message",
			targetId: "m1",
			category: "spam_or_promotion",
			idempotencyKey: "k".repeat(32),
		});
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			target_kind: "message",
			target_id: "m1",
			category: "spam_or_promotion",
		});
	});

	it("409 revision_changed is a conflict that names its code", async () => {
		const error = await communityErrorFrom(
			json(409, { code: "revision_changed", message: "edited" }),
		);
		expect(error.kind).toBe("conflict");
		expect(error.code).toBe("revision_changed");
	});
});
