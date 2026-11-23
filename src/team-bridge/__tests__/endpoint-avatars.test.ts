import { describe, expect, it, vi } from "vitest";
import {
	avatarFailure,
	avatarKey,
	avatarVersion,
	createAvatarCache,
	ENDPOINT_PHOTO_FRESH_MS,
	endpointAvatarFailure,
	endpointAvatarKey,
	endpointAvatarVersion,
	endpointDisplayUri,
} from "@/team-bridge/avatars";
import { AVATAR_MAX_BYTES, createHubClient } from "@/team-bridge/client";
import { directoryMemberSchema } from "@/team-bridge/contract";
import { DIRECTORY_TTL_MS } from "@/team-bridge/store";

const HASH = "0123456789abcdef";
const ACCESS = ["unit", "photo"].join("-");
const OWNER = "acct_owner";
const ENDPOINT = "bep_agent";
const URL = `/v1/messaging/endpoints/${ENDPOINT}/avatar?v=${HASH}`;
const OWNER_URI = "data:image/png;base64,OWNER_SENTINEL";
const AGENT_URI = "data:image/png;base64,AGENT_SENTINEL";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const metadata = { hash: HASH, updated_at: "2026-11-01T00:00:00Z" };
const agent = (overrides: Record<string, unknown> = {}) => ({
	endpoint_id: ENDPOINT,
	name: "Nova",
	state: "active",
	avatar: metadata,
	avatar_url: URL,
	...overrides,
});
const member = (value: unknown) =>
	directoryMemberSchema.parse({
		account_id: OWNER,
		display_label: "Owner",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		profile: { avatar: { hash: HASH } },
		avatar_url: `/v1/accounts/${OWNER}/avatar?v=${HASH}`,
		agent: value,
	});

describe("endpoint avatar identity", () => {
	it("admits its own coherent metadata, with or without an advertised URL", () => {
		for (const value of [agent(), agent({ avatar_url: undefined })]) {
			expect(endpointAvatarVersion(member(value).agent)).toEqual({
				endpointId: ENDPOINT,
				hash: HASH,
			});
		}
	});
	it.each([
		["old endpoint", { avatar: undefined, avatar_url: undefined }],
		["URL without metadata", { avatar: undefined }],
		["bad hash", { avatar: { ...metadata, hash: "INVALID" } }],
		["bad timestamp", { avatar: { ...metadata, updated_at: "invalid" } }],
		["foreign origin", { avatar_url: `https://elsewhere.example${URL}` }],
		["owner route", { avatar_url: `/v1/accounts/${OWNER}/avatar?v=${HASH}` }],
		["wrong endpoint", { avatar_url: URL.replace(ENDPOINT, "bep_other") }],
		["wrong version", { avatar_url: URL.replace(HASH, "fedcba9876543210") }],
		["invalid-present URL", { avatar_url: null }],
		["path injection", { endpoint_id: "../other", avatar_url: undefined }],
	] as const)(
		"keeps the row but refuses %s without borrowing the owner",
		(_name, overrides) => {
			const row = member(agent(overrides));
			expect(row.agent?.name).toBe("Nova");
			expect(endpointAvatarVersion(row.agent)).toBeNull();
			expect(avatarVersion(row)).toEqual({ accountId: OWNER, hash: HASH });
		},
	);
	it("never conflates equal opaque account and endpoint identifiers", () => {
		expect(endpointAvatarKey(OWNER, HASH, 64)).not.toBe(
			avatarKey(OWNER, HASH, 64),
		);
	});
});

describe("endpoint photo retention (hash-pinned, TestFlight 1157 fan-out)", () => {
	it("displays a verified photo for the freshness window only, then revalidates conditionally", async () => {
		let clock = 0;
		const cache = createAvatarCache({ now: () => clock });
		const human = avatarKey(OWNER, HASH, 64);
		const key = endpointAvatarKey(OWNER, HASH, 64);
		await cache.load(human, async () => OWNER_URI, avatarFailure);
		const etag = `"${HASH}-64"`;
		const http = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(PNG, { headers: { etag } }))
			.mockResolvedValueOnce(new Response(null, { status: 304 }));
		const hub = createHubClient({
			accessToken: async () => ACCESS,
			fetchImpl: http,
		});
		const read = vi.fn((validator?: string) =>
			hub
				.revalidateEndpointAvatar(OWNER, HASH, 64, {
					etag: validator ?? null,
					native: true,
				})
				.then((photo) => photo && { uri: AGENT_URI, etag: photo.etag }),
		);
		const first = cache.loadEndpoint(key, read, avatarFailure);
		const twin = cache.loadEndpoint(key, read, avatarFailure);
		expect(await first).toBe(AGENT_URI);
		expect(await twin).toBe(AGENT_URI);
		expect(read).toHaveBeenCalledTimes(1);
		// The account-photo peek never reveals endpoint bytes.
		expect(cache.peek(key)).toBeNull();
		// U5/D4: a row re-entering inside the window repaints with no new read.
		clock = ENDPOINT_PHOTO_FRESH_MS - 1;
		expect(cache.peekEndpoint(key)).toBe(AGENT_URI);
		expect(await cache.loadEndpoint(key, read, avatarFailure)).toBe(AGENT_URI);
		expect(read).toHaveBeenCalledTimes(1);
		// Past it the bytes are only a validator: no display until a new read.
		clock = ENDPOINT_PHOTO_FRESH_MS;
		expect(cache.peekEndpoint(key)).toBeNull();
		expect(await cache.loadEndpoint(key, read, avatarFailure)).toBe(AGENT_URI);
		expect(read).toHaveBeenCalledTimes(2);
		const second = http.mock.calls[1]?.[1];
		expect(second?.cache).toBe("no-store");
		expect(new Headers(second?.headers).get("if-none-match")).toBe(etag);
		expect(new Headers(second?.headers).get("cache-control")).toBe("no-cache");
		// Same opaque id and hash, different namespace: never the owner's bytes.
		expect(cache.peek(human)).toBe(OWNER_URI);
		// The 304 renewed the authorization for another window.
		clock += ENDPOINT_PHOTO_FRESH_MS - 1;
		expect(cache.peekEndpoint(key)).toBe(AGENT_URI);
		// Account change: nothing verified for the old account is displayable.
		cache.clear();
		expect(cache.peek(key)).toBeNull();
		expect(cache.peekEndpoint(key)).toBeNull();
	});
	it("trusts a photo read no longer than the directory row that advertised it", () => {
		expect(ENDPOINT_PHOTO_FRESH_MS).toBe(DIRECTORY_TTL_MS);
	});
	it("web forces a fresh GET without CORS-forbidden headers or unsolicited 304", async () => {
		const http = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(null, { status: 304 }));
		const hub = createHubClient({
			accessToken: async () => ACCESS,
			fetchImpl: http,
		});
		await expect(
			hub.revalidateEndpointAvatar(ENDPOINT, HASH, 64, {
				etag: '"opaque"',
				native: false,
			}),
		).rejects.toMatchObject({ status: 304 });
		const request = http.mock.calls[0]?.[1];
		expect(request?.cache).toBe("no-store");
		const headers = new Headers(request?.headers);
		expect(headers.has("if-none-match")).toBe(false);
		expect(headers.has("cache-control")).toBe(false);
	});
	it("shares permanent endpoint failures across sizes, never with the owner's key", async () => {
		const cache = createAvatarCache();
		const human = avatarKey(OWNER, HASH, 64);
		await cache.load(human, async () => OWNER_URI, avatarFailure);
		cache.fail(endpointAvatarKey(OWNER, HASH, 64), "permanent");
		const read = vi.fn(async () => AGENT_URI);
		expect(
			await cache.loadEndpoint(
				endpointAvatarKey(OWNER, HASH, 256),
				read,
				avatarFailure,
			),
		).toBeNull();
		expect(read).not.toHaveBeenCalled();
		expect(cache.peek(human)).toBe(OWNER_URI);
	});
	it("retires active and queued endpoint reads without landing a URI", async () => {
		const cache = createAvatarCache({ maxEntries: 1 });
		let finish!: (value: string) => void;
		const first = cache.loadEndpoint(
			endpointAvatarKey(ENDPOINT, HASH, 64),
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
			avatarFailure,
		);
		await Promise.resolve();
		const read = vi.fn(async () => AGENT_URI);
		const queued = cache.loadEndpoint(
			endpointAvatarKey("bep_other", HASH, 64),
			read,
			avatarFailure,
		);
		const before = cache.epoch;
		cache.clear();
		finish(AGENT_URI);
		expect(await first).toBeNull();
		expect(await queued).toBeNull();
		expect(cache.epoch).toBe(before + 1);
		expect(read).not.toHaveBeenCalled();
		expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
	});
	it("rejects a non-endpoint key before reading, without breaking an account named endpoint", async () => {
		const cache = createAvatarCache();
		const read = vi.fn(async () => AGENT_URI);
		const human = avatarKey("endpoint", HASH, 64);
		expect(await cache.loadEndpoint(human, read, avatarFailure)).toBeNull();
		expect(read).not.toHaveBeenCalled();
		await cache.load(human, async () => OWNER_URI, avatarFailure);
		expect(cache.peek(human)).toBe(OWNER_URI);
	});
});

describe("fixed hub endpoint image route", () => {
	it.each([64, 256] as const)(
		"reads the %ipx variant with bearer and no cookies or owner route",
		async (size) => {
			const read = vi.fn(async () => new Response(PNG));
			const hub = createHubClient({
				accessToken: async () => ACCESS,
				fetchImpl: read as unknown as typeof fetch,
				baseUrl: "https://hub.example",
			});
			const image = await hub.endpointAvatarBytes(ENDPOINT, HASH, size);
			expect(image.mime).toBe("image/png");
			expect(image.bytes).toEqual(PNG);
			const [url, init] = read.mock.calls[0] as unknown as [
				string,
				RequestInit,
			];
			const parsed = new globalThis.URL(url);
			expect(parsed.origin + parsed.pathname).toBe(
				`https://hub.example/v1/messaging/endpoints/${ENDPOINT}/avatar`,
			);
			expect(parsed.searchParams.get("v")).toBe(HASH);
			expect(parsed.searchParams.get("size")).toBe(String(size));
			expect([...parsed.searchParams.keys()].sort()).toEqual(["size", "v"]);
			expect(init.credentials).toBe("omit");
			const headers = init.headers as Record<string, string>;
			expect(headers.authorization).toBe(["Bearer", ACCESS].join(" "));
			expect(headers.accept).toBe("image/png, image/jpeg");
		},
	);
	it.each([
		["../other", HASH, 64],
		[ENDPOINT, "INVALID", 64],
		[ENDPOINT, HASH, 128],
	] as const)(
		"rejects invalid identity or size before authentication (%s/%s/%s)",
		async (id, hash, size) => {
			const token = vi.fn(async () => ACCESS);
			const read = vi.fn();
			const hub = createHubClient({
				accessToken: token,
				fetchImpl: read as typeof fetch,
			});
			await expect(
				hub.endpointAvatarBytes(id, hash, size as 64),
			).rejects.toMatchObject({ kind: "malformed" });
			expect(token).not.toHaveBeenCalled();
			expect(read).not.toHaveBeenCalled();
		},
	);
	it("does not accept HTML as an image even with a misleading Content-Type", async () => {
		const hub = createHubClient({
			accessToken: async () => ACCESS,
			fetchImpl: vi.fn(
				async () =>
					new Response("<html>not a photo</html>", {
						headers: { "content-type": "image/png" },
					}),
			) as unknown as typeof fetch,
		});
		await expect(
			hub.endpointAvatarBytes(ENDPOINT, HASH, 64),
		).rejects.toMatchObject({ kind: "malformed" });
	});
});

describe("render-time identity guard (not a native effect replay)", () => {
	it("refuses the previous result immediately for every identity boundary", () => {
		const cache = {};
		const key = endpointAvatarKey(ENDPOINT, HASH, 64);
		const held = { cache, key, epoch: 1, uri: AGENT_URI };
		expect(endpointDisplayUri(held, cache, 1, key)).toBe(AGENT_URI);
		for (const changed of [
			null,
			endpointAvatarKey("bep_other", HASH, 64),
			endpointAvatarKey(ENDPOINT, "fedcba9876543210", 64),
			endpointAvatarKey(ENDPOINT, HASH, 256),
			avatarKey(OWNER, HASH, 64),
		])
			expect(endpointDisplayUri(held, cache, 1, changed)).toBeNull();
		expect(endpointDisplayUri(held, {}, 1, key)).toBeNull();
		expect(endpointDisplayUri(held, cache, 2, key)).toBeNull();
	});
});

describe("photo authorization and refusal bounds", () => {
	it("times out token acquisition, wakes queued work, and prevents a late GET", async () => {
		vi.useFakeTimers();
		try {
			let finish!: (value: string) => void;
			const read = vi.fn();
			const hub = createHubClient({
				accessToken: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
				fetchImpl: read as typeof fetch,
				timeoutMs: 50,
			});
			const cache = createAvatarCache({ maxEntries: 1 });
			const pending = cache.loadEndpoint(
				endpointAvatarKey(ENDPOINT, HASH, 64),
				() => hub.endpointAvatarBytes(ENDPOINT, HASH, 64).then(() => AGENT_URI),
				avatarFailure,
			);
			const queued = cache.loadEndpoint(
				endpointAvatarKey("bep_other", HASH, 64),
				async () => AGENT_URI,
				avatarFailure,
			);
			await vi.advanceTimersByTimeAsync(50);
			expect(await pending).toBeNull();
			expect(await queued).toBe(AGENT_URI);
			finish(ACCESS);
			await vi.advanceTimersByTimeAsync(0);
			expect(read).not.toHaveBeenCalled();
			// The queued photo succeeded and is held (hash-pinned retention); the
			// timed-out one left nothing behind it could have been evicted for.
			expect(cache.stats()).toEqual({ entries: 1, bytes: AGENT_URI.length });
		} finally {
			vi.useRealTimers();
		}
	});
	it("cancels the first 401 and stops a late forced-refresh retry", async () => {
		vi.useFakeTimers();
		try {
			let finish!: (value: string) => void;
			const cancel = vi.fn();
			const response = new Response(
				new ReadableStream({ cancel }, { highWaterMark: 0 }),
				{ status: 401 },
			);
			const read = vi.fn(async () => response);
			const hub = createHubClient({
				accessToken: async (options) =>
					options?.force
						? new Promise<string>((resolve) => {
								finish = resolve;
							})
						: ACCESS,
				fetchImpl: read as unknown as typeof fetch,
				timeoutMs: 50,
			});
			const pending = expect(
				hub.endpointAvatarBytes(ENDPOINT, HASH, 64),
			).rejects.toMatchObject({ kind: "unreachable" });
			await vi.advanceTimersByTimeAsync(50);
			await pending;
			expect(cancel).toHaveBeenCalledOnce();
			finish(ACCESS);
			await vi.advanceTimersByTimeAsync(0);
			expect(read).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});
	it("disposes a response arriving after its operation has retired", async () => {
		vi.useFakeTimers();
		try {
			let finish!: (value: Response) => void;
			const cancel = vi.fn();
			const hub = createHubClient({
				accessToken: async () => ACCESS,
				fetchImpl: vi.fn(
					() =>
						new Promise<Response>((resolve) => {
							finish = resolve;
						}),
				) as unknown as typeof fetch,
				timeoutMs: 50,
			});
			const pending = expect(
				hub.endpointAvatarBytes(ENDPOINT, HASH, 64),
			).rejects.toMatchObject({ kind: "unreachable" });
			await vi.advanceTimersByTimeAsync(50);
			await pending;
			finish(
				new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })),
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(cancel).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});
	it.each([
		[404, "not_found"],
		[429, "rate_limited"],
		[503, "unavailable"],
	] as const)(
		"cancels a %i refusal without JSON/body reads and preserves retry headers",
		async (status, kind) => {
			const pull = vi.fn();
			const cancel = vi.fn();
			const response = new Response(
				new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
				{
					status,
					headers: {
						"content-length": String(AVATAR_MAX_BYTES * 10),
						"retry-after": "3",
					},
				},
			);
			const json = vi.spyOn(response, "json");
			const hub = createHubClient({
				accessToken: async () => ACCESS,
				fetchImpl: vi.fn(async () => response) as unknown as typeof fetch,
			});
			await expect(
				hub.endpointAvatarBytes(ENDPOINT, HASH, 64),
			).rejects.toMatchObject({ kind, status, retryAfterMs: 3000 });
			expect(json).not.toHaveBeenCalled();
			expect(pull).not.toHaveBeenCalled();
			expect(cancel).toHaveBeenCalledOnce();
		},
	);
	it("refreshes once on 401, never borrows an account route", async () => {
		const first = new Response("{}", { status: 401 });
		const second = new Response(PNG);
		const responses = [first, second];
		const read = vi.fn(async () => {
			const response = responses.shift();
			if (!response) throw new Error("Unexpected fixture request");
			return response;
		});
		const token = vi.fn(async (_options?: { force?: boolean }) => ACCESS);
		const hub = createHubClient({
			accessToken: token,
			fetchImpl: read as unknown as typeof fetch,
		});
		expect((await hub.endpointAvatarBytes(ENDPOINT, HASH, 64)).mime).toBe(
			"image/png",
		);
		expect(token.mock.calls).toEqual([[undefined], [{ force: true }]]);
		expect(first.bodyUsed).toBe(true);
		expect(read).toHaveBeenCalledTimes(2);
	});
	it.each([
		[404, 1],
		// 401 is retried once with a forced refresh before it is a refusal.
		[401, 2],
	])(
		"same-hash %i withdrawal withholds the URI and retries only after cooldown",
		async (status, refusals) => {
			let calls = 0;
			let clock = 0;
			const hub = createHubClient({
				accessToken: async () => ACCESS,
				fetchImpl: vi.fn(async () =>
					++calls === 1 || calls > 1 + refusals
						? new Response(PNG)
						: new Response("{}", { status }),
				) as unknown as typeof fetch,
			});
			const cache = createAvatarCache({ now: () => clock });
			const key = endpointAvatarKey(ENDPOINT, HASH, 64);
			const read = () =>
				hub.endpointAvatarBytes(ENDPOINT, HASH, 64).then(() => AGENT_URI);
			expect(await cache.loadEndpoint(key, read, endpointAvatarFailure)).toBe(
				AGENT_URI,
			);
			// Inside the window a verified photo is reused; once it lapses the
			// next read is the one that discovers the refusal.
			clock = ENDPOINT_PHOTO_FRESH_MS;
			expect(
				await cache.loadEndpoint(key, read, endpointAvatarFailure),
			).toBeNull();
			expect(cache.peek(key)).toBeNull();
			expect(cache.peekEndpoint(key)).toBeNull();
			expect(
				await cache.loadEndpoint(key, read, endpointAvatarFailure),
			).toBeNull();
			expect(calls).toBe(1 + refusals);
			clock += 60_001;
			expect(await cache.loadEndpoint(key, read, endpointAvatarFailure)).toBe(
				AGENT_URI,
			);
			expect(calls).toBe(2 + refusals);
		},
	);
	it("a refusal from any read of the key withdraws a still-fresh photo", async () => {
		const cache = createAvatarCache({ now: () => 0 });
		const key = endpointAvatarKey(ENDPOINT, HASH, 64);
		expect(
			await cache.loadEndpoint(
				key,
				async () => AGENT_URI,
				endpointAvatarFailure,
			),
		).toBe(AGENT_URI);
		expect(cache.peekEndpoint(key)).toBe(AGENT_URI);
		// e.g. the decoder refusing the bytes, or a card's read of the key.
		cache.fail(key, "transient");
		expect(cache.peekEndpoint(key)).toBeNull();
	});
	it.each([401, 403, 404])(
		"a %i on one size withdraws the other size's still-fresh photo (review R3-1)",
		async (status) => {
			let clock = 0;
			const cache = createAvatarCache({ now: () => clock });
			const row = endpointAvatarKey(ENDPOINT, HASH, 64);
			const card = endpointAvatarKey(ENDPOINT, HASH, 256);
			const hub = createHubClient({
				accessToken: async () => ACCESS,
				fetchImpl: vi.fn(
					async () => new Response("{}", { status }),
				) as unknown as typeof fetch,
			});
			let reads = 0;
			const ok = async () => {
				reads += 1;
				return AGENT_URI;
			};
			expect(await cache.loadEndpoint(row, ok, endpointAvatarFailure)).toBe(
				AGENT_URI,
			);
			clock = 1_000;
			expect(
				await cache.loadEndpoint(
					card,
					() =>
						hub
							.revalidateEndpointAvatar(ENDPOINT, HASH, 256, {
								etag: null,
								native: true,
							})
							.then(() => AGENT_URI),
					endpointAvatarFailure,
				),
			).toBeNull();
			clock = 2_000;
			// Still inside ENDPOINT_PHOTO_FRESH_MS of the 64 px 200, yet refused.
			expect(cache.peekEndpoint(row)).toBeNull();
			expect(await cache.loadEndpoint(row, ok, endpointAvatarFailure)).toBe(
				AGENT_URI,
			);
			expect(reads).toBe(2);
		},
	);
	it("a transient 5xx on one size leaves the other size's fresh photo shown", async () => {
		const cache = createAvatarCache({ now: () => 0 });
		const row = endpointAvatarKey(ENDPOINT, HASH, 64);
		const card = endpointAvatarKey(ENDPOINT, HASH, 256);
		const hub = createHubClient({
			accessToken: async () => ACCESS,
			fetchImpl: vi.fn(
				async () => new Response("{}", { status: 503 }),
			) as unknown as typeof fetch,
		});
		await cache.loadEndpoint(row, async () => AGENT_URI, endpointAvatarFailure);
		await cache.loadEndpoint(
			card,
			() =>
				hub
					.revalidateEndpointAvatar(ENDPOINT, HASH, 256, {
						etag: null,
						native: true,
					})
					.then(() => AGENT_URI),
			endpointAvatarFailure,
		);
		expect(cache.peekEndpoint(row)).toBe(AGENT_URI);
	});
	it("withholds the same photo on 429 and pauses queued reads until Retry-After", async () => {
		vi.useFakeTimers();
		const cache = createAvatarCache();
		const key = endpointAvatarKey(ENDPOINT, HASH, 64);
		const http = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(PNG, { headers: { etag: '"opaque"' } }),
			)
			.mockResolvedValueOnce(
				new Response(null, { status: 429, headers: { "retry-after": "2" } }),
			)
			.mockImplementation(async () => new Response(PNG));
		const hub = createHubClient({
			accessToken: async () => ACCESS,
			fetchImpl: http,
		});
		const check = (endpoint: string) => (etag?: string) =>
			hub
				.revalidateEndpointAvatar(endpoint, HASH, 64, {
					etag: etag ?? null,
					native: true,
				})
				.then((photo) => photo && { uri: AGENT_URI, etag: photo.etag });
		try {
			expect(
				await cache.loadEndpoint(key, check(ENDPOINT), endpointAvatarFailure),
			).toBe(AGENT_URI);
			// Past the freshness window, so the next load is a real read.
			await vi.advanceTimersByTimeAsync(ENDPOINT_PHOTO_FRESH_MS);
			expect(
				await cache.loadEndpoint(key, check(ENDPOINT), endpointAvatarFailure),
			).toBeNull();
			expect(
				await cache.loadEndpoint(key, check(ENDPOINT), endpointAvatarFailure),
			).toBeNull();
			const other = "bep_other";
			const queued = cache.loadEndpoint(
				endpointAvatarKey(other, HASH, 64),
				check(other),
				endpointAvatarFailure,
			);
			await vi.advanceTimersByTimeAsync(1_999);
			expect(http).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1);
			await expect(queued).resolves.toBe(AGENT_URI);
			expect(http).toHaveBeenCalledTimes(3);
		} finally {
			cache.clear();
			vi.useRealTimers();
		}
	});

	it("refuses oversized declared and streamed endpoint bodies, cancelling each", async () => {
		for (const declared of [true, false]) {
			const cancel = vi.fn();
			const response = new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							declared ? PNG : new Uint8Array(AVATAR_MAX_BYTES + 1),
						);
					},
					cancel,
				}),
				{
					headers: declared
						? { "content-length": String(AVATAR_MAX_BYTES + 1) }
						: {},
				},
			);
			const hub = createHubClient({
				accessToken: async () => ACCESS,
				fetchImpl: vi.fn(async () => response) as unknown as typeof fetch,
			});
			await expect(
				hub.endpointAvatarBytes(ENDPOINT, HASH, 64),
			).rejects.toMatchObject({ kind: "malformed" });
			expect(cancel).toHaveBeenCalledOnce();
		}
	});
	it("settles and cancels a stalled endpoint stream at the one deadline", async () => {
		vi.useFakeTimers();
		try {
			const cancel = vi.fn();
			const response = new Response(
				new ReadableStream({ cancel }, { highWaterMark: 0 }),
			);
			const hub = createHubClient({
				accessToken: async () => ACCESS,
				fetchImpl: vi.fn(async () => response) as unknown as typeof fetch,
				timeoutMs: 50,
			});
			const pending = expect(
				hub.endpointAvatarBytes(ENDPOINT, HASH, 64),
			).rejects.toMatchObject({ kind: "unreachable" });
			await vi.advanceTimersByTimeAsync(50);
			await pending;
			expect(cancel).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});
});
