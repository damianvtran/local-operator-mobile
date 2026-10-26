import { describe, expect, it, vi } from "vitest";

import {
	avatarFailure,
	avatarKey,
	avatarVersion,
	createAvatarCache,
} from "@/team-bridge/avatars";
import {
	AVATAR_MAX_BYTES,
	createHubClient,
	HubError,
} from "@/team-bridge/client";
import { directorySchema } from "@/team-bridge/contract";

import { ADA, BEN, person } from "./fixtures";

const HASH = "0123456789abcdef";
const NEW_HASH = "fedcba9876543210";
const avatarUrl = (accountId: string, hash = HASH) =>
	`/v1/accounts/${accountId}/avatar?v=${hash}`;

/** A directory row as agent-server `BridgeDirectoryMember` serializes it today. */
const profileRow = (overrides: Record<string, unknown> = {}) => ({
	account_id: ADA,
	display_label: "Ada",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	profile: {
		display_name: "Ada",
		title: "Staff engineer",
		description: "Builds the mobile client.",
		pronouns: "she/her",
		timezone: "Europe/London",
		avatar: {
			source: "uploaded",
			hash: HASH,
			updated_at: "2026-10-20T09:00:00Z",
		},
	},
	avatar_url: avatarUrl(ADA),
	...overrides,
});

describe("directory profile fields", () => {
	it("parses an OLD hub's row with no profile and no avatar_url unchanged", () => {
		const parsed = directorySchema.parse({
			members: [
				{
					account_id: ADA,
					display_label: "Ada",
					role: "member",
					bridge_enabled: true,
					bridge_state: "active",
				},
			],
		});
		expect(parsed.unavailable_count).toBe(0);
		expect(parsed.members[0]?.profile).toBeUndefined();
		expect(parsed.members[0]?.avatar_url).toBeUndefined();
		expect(avatarVersion(parsed.members[0])).toBeNull();
	});

	it("parses a NEW hub's row with profile and avatar_url, and drops pronouns at the parse", () => {
		const parsed = directorySchema.parse({ members: [profileRow()] });
		const row = parsed.members[0];
		expect(row?.profile?.title).toBe("Staff engineer");
		expect(row?.profile?.timezone).toBe("Europe/London");
		expect(row?.avatar_url).toBe(avatarUrl(ADA));
		expect(row?.profile && "pronouns" in row.profile).toBe(false);
		expect(JSON.stringify(row)).not.toContain("she/her");
	});

	it("a malformed profile or avatar_url costs that field, never the row", () => {
		const parsed = directorySchema.parse({
			members: [
				profileRow({
					profile: "not an object",
					avatar_url: "https://x.example/a.png",
				}),
				profileRow({
					account_id: BEN,
					profile: { title: 42, timezone: "Europe/Paris" },
					avatar_url: avatarUrl(BEN, "NOTHEX"),
				}),
			],
		});
		expect(parsed.members).toHaveLength(2);
		expect(parsed.unavailable_count).toBe(0);
		expect(parsed.members[0]?.profile).toBeUndefined();
		expect(parsed.members[0]?.avatar_url).toBeUndefined();
		expect(parsed.members[1]?.profile?.title).toBeUndefined();
		expect(parsed.members[1]?.profile?.timezone).toBe("Europe/Paris");
		expect(parsed.members[1]?.avatar_url).toBeUndefined();
	});

	it("a salvaged row (unknown role/state) keeps its profile and avatar", () => {
		const parsed = directorySchema.parse({
			members: [profileRow({ role: "", bridge_state: "future_state" })],
		});
		expect(parsed.members[0]?.bridge_state).toBe("none");
		expect(parsed.members[0]?.profile?.title).toBe("Staff engineer");
		expect(parsed.members[0]?.avatar_url).toBe(avatarUrl(ADA));
	});
});

describe("avatarVersion", () => {
	it("reads the account and hash from the hash-pinned path", () => {
		const row = directorySchema.parse({ members: [profileRow()] }).members[0];
		expect(avatarVersion(row)).toEqual({ accountId: ADA, hash: HASH });
	});

	it("refuses a path naming another account, or a hash the profile disagrees with", () => {
		expect(
			avatarVersion(person(ADA, "Ada", { avatar_url: avatarUrl(BEN) })),
		).toBeNull();
		expect(
			avatarVersion(
				person(ADA, "Ada", {
					avatar_url: avatarUrl(ADA),
					profile: { avatar: { hash: NEW_HASH } },
				}),
			),
		).toBeNull();
	});
});

describe("avatar cache", () => {
	const permanent = () => "permanent" as const;

	it("keys on account + hash + size, so a new photo or another size is a new read", async () => {
		const cache = createAvatarCache();
		const fetchUri = vi.fn(async () => "data:image/png;base64,AAAA");
		await cache.load(avatarKey(ADA, HASH, 64), fetchUri, permanent);
		await cache.load(avatarKey(ADA, HASH, 64), fetchUri, permanent);
		expect(fetchUri).toHaveBeenCalledTimes(1);
		await cache.load(avatarKey(ADA, HASH, 256), fetchUri, permanent);
		await cache.load(avatarKey(ADA, NEW_HASH, 64), fetchUri, permanent);
		await cache.load(avatarKey(BEN, HASH, 64), fetchUri, permanent);
		expect(fetchUri).toHaveBeenCalledTimes(4);
	});

	it("shares one in-flight read between concurrent callers", async () => {
		const cache = createAvatarCache();
		let resolve: (uri: string) => void = () => undefined;
		const fetchUri = vi.fn(
			() => new Promise<string>((done) => (resolve = done)),
		);
		const key = avatarKey(ADA, HASH, 64);
		const a = cache.load(key, fetchUri, permanent);
		const b = cache.load(key, fetchUri, permanent);
		resolve("data:image/png;base64,AAAA");
		expect(await a).toBe("data:image/png;base64,AAAA");
		expect(await b).toBe("data:image/png;base64,AAAA");
		expect(fetchUri).toHaveBeenCalledTimes(1);
	});

	it("evicts least-recently-used entries by count", async () => {
		const cache = createAvatarCache({ maxEntries: 2 });
		const uri = async () => "data:x";
		await cache.load("a", uri, permanent);
		await cache.load("b", uri, permanent);
		cache.peek("a"); // a is now the most recent
		await cache.load("c", uri, permanent);
		expect(cache.peek("a")).toBe("data:x");
		expect(cache.peek("b")).toBeNull();
		expect(cache.peek("c")).toBe("data:x");
		expect(cache.stats().entries).toBe(2);
	});

	it("evicts by bytes; a photo bigger than the whole budget is refused (R1-1)", async () => {
		const cache = createAvatarCache({ maxBytes: 10 });
		await cache.load("a", async () => "123456", permanent);
		await cache.load("b", async () => "abcdef", permanent);
		expect(cache.peek("a")).toBeNull();
		expect(cache.peek("b")).toBe("abcdef");
		expect(cache.stats().bytes).toBe(6);
		expect(
			await cache.load("huge", async () => "x".repeat(11), permanent),
		).toBeNull();
		expect(cache.peek("huge")).toBeNull();
		expect(cache.stats().bytes).toBeLessThanOrEqual(10);
	});

	it("clear() (sign-out / account switch) drops every photo and retires reads in flight", async () => {
		const cache = createAvatarCache();
		await cache.load("a", async () => "data:a", permanent);
		let resolve: (uri: string) => void = () => undefined;
		const late = cache.load(
			"b",
			() => new Promise<string>((done) => (resolve = done)),
			permanent,
		);
		cache.clear();
		resolve("data:b");
		await late;
		expect(cache.peek("a")).toBeNull();
		expect(cache.peek("b")).toBeNull();
		expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
	});

	it("a 404 resolves to null (initials) and is never re-requested for that hash", async () => {
		const cache = createAvatarCache();
		const fetchUri = vi.fn(async () => {
			throw new HubError({ kind: "not_found", message: "x", status: 404 });
		});
		const key = avatarKey(ADA, HASH, 64);
		for (let i = 0; i < 5; i += 1)
			expect(await cache.load(key, fetchUri, avatarFailure)).toBeNull();
		expect(fetchUri).toHaveBeenCalledTimes(1);
	});

	it("a network failure is retried once after the cool-down, not on every render", async () => {
		let clock = 0;
		const cache = createAvatarCache({
			transientCooldownMs: 1000,
			now: () => clock,
		});
		const fetchUri = vi.fn(async () => {
			throw new HubError({ kind: "unreachable", message: "x" });
		});
		const key = avatarKey(ADA, HASH, 64);
		await cache.load(key, fetchUri, avatarFailure);
		await cache.load(key, fetchUri, avatarFailure);
		expect(fetchUri).toHaveBeenCalledTimes(1);
		clock = 1001;
		await cache.load(key, fetchUri, avatarFailure);
		expect(fetchUri).toHaveBeenCalledTimes(2);
	});

	it("a decoder refusal reported by the view is remembered", async () => {
		const cache = createAvatarCache();
		const fetchUri = vi.fn(async () => "data:image/png;base64,broken");
		const key = avatarKey(ADA, HASH, 64);
		await cache.load(key, fetchUri, avatarFailure);
		cache.fail(key, "permanent");
		expect(await cache.load(key, fetchUri, avatarFailure)).toBeNull();
		expect(fetchUri).toHaveBeenCalledTimes(1);
	});

	it("R1-1: a photo larger than the whole budget evicts nothing and is not refetched", async () => {
		const cache = createAvatarCache({ maxBytes: 100 });
		for (const key of ["a", "b", "c"])
			await cache.load(key, async () => "x".repeat(30), permanent);
		const huge = vi.fn(async () => "y".repeat(101));
		expect(await cache.load("huge", huge, permanent)).toBeNull();
		expect(cache.stats()).toEqual({ entries: 4, bytes: 90 });
		expect(cache.peek("a")).toBe("x".repeat(30));
		expect(await cache.load("huge", huge, permanent)).toBeNull();
		expect(huge).toHaveBeenCalledTimes(1);
	});

	it("R1-3: a read refused for lack of slots proceeds once a slot frees", async () => {
		const cache = createAvatarCache({ maxEntries: 1 });
		let release: (uri: string) => void = () => undefined;
		const first = cache.load(
			"a",
			() => new Promise<string>((done) => (release = done)),
			permanent,
		);
		const second = cache.load("b", async () => "data:b", permanent);
		release("data:a");
		expect(await first).toBe("data:a");
		expect(await second).toBe("data:b");
	});

	it("R1-3: clear() settles queued reads with initials and never runs them", async () => {
		const cache = createAvatarCache({ maxEntries: 1 });
		void cache.load("a", () => new Promise<string>(() => undefined), permanent);
		const queued = vi.fn(async () => "data:b");
		const second = cache.load("b", queued, permanent);
		cache.clear();
		expect(await second).toBeNull();
		expect(queued).not.toHaveBeenCalled();
	});

	it("R1-4: a 429 waits the server's Retry-After, not the fixed cool-down", async () => {
		let clock = 0;
		const cache = createAvatarCache({
			transientCooldownMs: 60_000,
			now: () => clock,
		});
		const fetchUri = vi.fn(async () => {
			throw new HubError({
				kind: "rate_limited",
				message: "x",
				status: 429,
				retryAfterMs: 5000,
			});
		});
		const key = avatarKey(ADA, HASH, 64);
		await cache.load(key, fetchUri, avatarFailure);
		clock = 4999;
		await cache.load(key, fetchUri, avatarFailure);
		expect(fetchUri).toHaveBeenCalledTimes(1);
		clock = 5000;
		await cache.load(key, fetchUri, avatarFailure);
		expect(fetchUri).toHaveBeenCalledTimes(2);
	});

	it("Q1-1: a permanent failure at one size marks the other size for that hash", async () => {
		const cache = createAvatarCache();
		const missing = vi.fn(async () => {
			throw new HubError({ kind: "not_found", message: "x", status: 404 });
		});
		await cache.load(avatarKey(BEN, HASH, 64), missing, avatarFailure);
		expect(
			await cache.load(avatarKey(BEN, HASH, 256), missing, avatarFailure),
		).toBeNull();
		expect(missing).toHaveBeenCalledTimes(1);
		// A NEW hash is a new photo and is read.
		await cache.load(avatarKey(BEN, NEW_HASH, 256), missing, avatarFailure);
		expect(missing).toHaveBeenCalledTimes(2);
	});

	it("Q1-1: a transient failure, or a sibling already shown, is left alone", async () => {
		const cache = createAvatarCache();
		await cache.load(
			avatarKey(ADA, HASH, 64),
			async () => "data:64",
			permanent,
		);
		cache.fail(avatarKey(ADA, HASH, 256), "permanent");
		expect(cache.peek(avatarKey(ADA, HASH, 64))).toBe("data:64");
		const flaky = vi.fn(async () => {
			throw new HubError({ kind: "unreachable", message: "x" });
		});
		await cache.load(avatarKey(BEN, HASH, 64), flaky, avatarFailure);
		await cache.load(avatarKey(BEN, HASH, 256), flaky, avatarFailure);
		expect(flaky).toHaveBeenCalledTimes(2);
	});

	it("classifies failures: 404/refusal/malformed permanent, network/server transient", () => {
		const of = (kind: ConstructorParameters<typeof HubError>[0]["kind"]) =>
			avatarFailure(new HubError({ kind, message: "x" }));
		expect(of("not_found")).toBe("permanent");
		expect(of("refused")).toBe("permanent");
		expect(of("malformed")).toBe("permanent");
		expect(of("unreachable")).toBe("transient");
		expect(of("server")).toBe("transient");
		expect(of("rate_limited")).toBe("transient");
		expect(avatarFailure(new Error("bug"))).toBe("transient");
	});
});

describe("hub client avatarBytes", () => {
	const PNG = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
	]);

	it("reads the avatar route with the bearer, the hash and the size", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const client = createHubClient({
			accessToken: async () => "token-a",
			baseUrl: "https://hub.example",
			fetchImpl: (async (url: string, init: RequestInit) => {
				calls.push({ url, init });
				return new Response(PNG, {
					status: 200,
					headers: { "content-type": "image/png" },
				});
			}) as unknown as typeof fetch,
		});
		const answer = await client.avatarBytes(ADA, HASH, 64);
		expect(answer.mime).toBe("image/png");
		expect(answer.bytes).toEqual(PNG);
		expect(calls[0]?.url).toBe(
			`https://hub.example/v1/accounts/${ADA}/avatar?v=${HASH}&size=64`,
		);
		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer token-a");
		expect(headers.accept).toBe("image/png, image/jpeg");
		expect(calls[0]?.init.credentials).toBe("omit");
	});

	it("a 404 is not_found; bytes that are not PNG/JPEG are malformed", async () => {
		const answers = [
			() =>
				new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
			() =>
				new Response("<html>edge error</html>", {
					status: 200,
					headers: { "content-type": "image/png" },
				}),
		];
		const client = createHubClient({
			accessToken: async () => "token-a",
			fetchImpl: (async () =>
				(answers.shift() as () => Response)()) as unknown as typeof fetch,
		});
		await expect(client.avatarBytes(ADA, HASH, 256)).rejects.toMatchObject({
			kind: "not_found",
			status: 404,
		});
		await expect(client.avatarBytes(ADA, HASH, 256)).rejects.toMatchObject({
			kind: "malformed",
		});
	});

	it("R1-1: a body over the cap is malformed, by Content-Length or by length read", async () => {
		const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
		big.set(PNG);
		const answers = [
			() =>
				new Response(PNG, {
					status: 200,
					headers: { "content-length": String(AVATAR_MAX_BYTES + 1) },
				}),
			() => new Response(big, { status: 200 }),
		];
		const client = createHubClient({
			accessToken: async () => "token-a",
			fetchImpl: (async () =>
				(answers.shift() as () => Response)()) as unknown as typeof fetch,
		});
		await expect(client.avatarBytes(ADA, HASH, 64)).rejects.toMatchObject({
			kind: "malformed",
		});
		await expect(client.avatarBytes(ADA, HASH, 64)).rejects.toMatchObject({
			kind: "malformed",
		});
	});

	it("R1-2: a body that stalls after the headers times out instead of holding a slot", async () => {
		const client = createHubClient({
			accessToken: async () => "token-a",
			timeoutMs: 50,
			fetchImpl: (async () =>
				new Response(
					new ReadableStream({
						start: () => undefined,
					}),
					{ status: 200 },
				)) as unknown as typeof fetch,
		});
		await expect(client.avatarBytes(ADA, HASH, 64)).rejects.toMatchObject({
			kind: "unreachable",
		});
	});

	it("refreshes once on a 401, like every other hub read", async () => {
		const tokens = vi.fn(async (options?: { force?: boolean }) =>
			options?.force ? "token-b" : "token-a",
		);
		const seen: string[] = [];
		const answers = [
			() => new Response("{}", { status: 401 }),
			() => new Response(PNG, { status: 200 }),
		];
		const client = createHubClient({
			accessToken: tokens,
			fetchImpl: (async (_url: string, init: RequestInit) => {
				seen.push((init.headers as Record<string, string>).authorization ?? "");
				return (answers.shift() as () => Response)();
			}) as unknown as typeof fetch,
		});
		await client.avatarBytes(ADA, HASH, 64);
		expect(seen).toEqual(["Bearer token-a", "Bearer token-b"]);
	});
});
