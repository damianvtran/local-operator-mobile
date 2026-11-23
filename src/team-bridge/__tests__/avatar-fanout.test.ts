import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { inAvatarViewport } from "@/features/team-bridge/avatar-viewport";
import {
	createAvatarCache,
	ENDPOINT_PHOTO_FRESH_MS,
	endpointAvatarFailure,
	endpointAvatarKey,
	PHOTO_REQUESTS_PER_WINDOW,
} from "@/team-bridge/avatars";
import { createHubClient } from "@/team-bridge/client";

const HASH = "1111111111111111";
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BUCKET = 120;

it("rapid traversal of 120 rows leaves room for foreground reads in the same HTTP bucket", async () => {
	let reads = 0;
	let avatarReads = 0;
	let clock = 0;
	const server = createServer((request, response) => {
		if (++reads > BUCKET) {
			response.writeHead(429, { "Retry-After": "60" }).end();
			return;
		}
		if (request.url?.includes("/avatar?")) {
			avatarReads += 1;
			response.end(PNG);
			return;
		}
		response.end(
			JSON.stringify({ result: { members: [], unavailable_count: 0 } }),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("No loopback port");
	const hub = createHubClient({
		baseUrl: `http://127.0.0.1:${address.port}`,
		accessToken: async () => "synthetic-test-bearer",
	});
	const cache = createAvatarCache({ now: () => clock });
	const pending: Promise<string | null>[] = [];
	try {
		// Traverse every band inside one bucket window. Let requests already
		// admitted settle between bands, but withdraw queued work as we leave.
		for (let start = 0; start < 120; start += 15) {
			const band = new AbortController();
			for (let index = start; index < start + 15; index += 1) {
				const endpoint = `bep_${index}`;
				pending.push(
					cache.loadEndpoint(
						endpointAvatarKey(endpoint, HASH, 64),
						() =>
							hub
								.endpointAvatarBytes(endpoint, HASH, 64)
								.then(() => "data:image/png;base64,fixture"),
						endpointAvatarFailure,
						{ signal: band.signal },
					),
				);
			}
			// Start the available slots; let that band leave before the queued
			// work can run. Pending jobs must still settle on aborted admission.
			band.abort();
			await Promise.all(pending.slice(start));
		}
		await expect(hub.directory("ten_synthetic")).resolves.toMatchObject({
			members: [],
		});
		expect(avatarReads).toBe(30);
		expect(reads).toBe(31);
		const afterClose = reads;
		clock += 60_001;
		await Promise.all(pending);
		expect(reads).toBe(afterClose);
	} finally {
		cache.clear();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

/*
 * U5/D4: the share is metered in requests the client actually sent. A valid
 * bearer spends one request per photo, so a 120-agent walk gets twice the
 * photos round 2 allowed; a bearer that 401s on every first try spends two,
 * and the cap still holds at half the bucket. Either way the foreground read
 * that follows is answered, and rows seen again inside the freshness window
 * cost nothing.
 */
it.each([
	// 59, not 60: a read is admitted only with room for its possible retry.
	["valid bearer", false, 59, 59],
	["every first try refused (401 + refresh)", true, 30, 60],
])(
	"metered photo share, %s (refuse first: %s): %i photos, %i requests, foreground answered",
	async (_name, refuseFirst, photos, photoRequests) => {
		let reads = 0;
		let photoHttp = 0;
		let clock = 0;
		const server = createServer((request, response) => {
			if (++reads > BUCKET) {
				response.writeHead(429, { "Retry-After": "60" }).end();
				return;
			}
			if (request.url?.includes("/avatar?")) {
				photoHttp += 1;
				if (refuseFirst && request.headers.authorization !== "Bearer fresh") {
					response.writeHead(401).end("{}");
					return;
				}
				// The endpoint route requires a declared image type.
				response.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
				return;
			}
			response.end(
				JSON.stringify({ result: { members: [], unavailable_count: 0 } }),
			);
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No loopback port");
		const hub = createHubClient({
			baseUrl: `http://127.0.0.1:${address.port}`,
			// The connection layer hands the stale bearer back unless forced.
			accessToken: async (options) => (options?.force ? "fresh" : "stale"),
		});
		const cache = createAvatarCache({ now: () => clock });
		const shown = new Set<number>();
		const photo = (index: number) => {
			const endpoint = `bep_${index}`;
			return cache
				.loadEndpoint(
					endpointAvatarKey(endpoint, HASH, 64),
					(etag, onRequest) =>
						hub
							.revalidateEndpointAvatar(endpoint, HASH, 64, {
								etag: etag ?? null,
								native: false,
								onRequest,
							})
							.then(() => "data:image/png;base64,fixture"),
					endpointAvatarFailure,
					{ row: true, metered: true },
				)
				.then((uri) => {
					if (uri) shown.add(index);
					return uri;
				});
		};
		try {
			const pending = Array.from({ length: 120 }, (_, index) => photo(index));
			await vi.waitFor(() => expect(shown.size).toBe(photos), {
				timeout: 3_000,
			});
			// Settled: nothing more goes out inside the window.
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(photoHttp).toBe(photoRequests);
			expect(photoHttp).toBeLessThanOrEqual(PHOTO_REQUESTS_PER_WINDOW);
			await expect(hub.directory("ten_synthetic")).resolves.toMatchObject({
				members: [],
			});
			expect(reads).toBe(photoRequests + 1);
			// Re-entering rows inside the freshness window spend no request.
			clock += ENDPOINT_PHOTO_FRESH_MS - 1;
			const before = reads;
			// Newer row work goes first, so re-enter exactly the rows shown.
			for (const index of [...shown])
				await expect(photo(index)).resolves.toBe(
					"data:image/png;base64,fixture",
				);
			expect(reads).toBe(before);
			cache.clear();
			await Promise.all(pending);
		} finally {
			cache.clear();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	},
);

it("does not dispatch departed rows, and gives a foreground photo the next free slot", async () => {
	const cache = createAvatarCache({ maxInFlight: 1 });
	const photo = (id: string) => endpointAvatarKey(`bep_${id}`, HASH, 64);
	let release!: (value: string) => void;
	const first = cache.loadEndpoint(
		photo("first"),
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
		endpointAvatarFailure,
	);
	const away = new AbortController();
	const readAway = vi.fn(async () => "departed");
	const departed = cache.loadEndpoint(
		photo("departed"),
		readAway,
		endpointAvatarFailure,
		{ signal: away.signal, row: true },
	);
	const order: string[] = [];
	const queued = cache.loadEndpoint(
		photo("queued"),
		async () => {
			order.push("row");
			return "row";
		},
		endpointAvatarFailure,
		{ row: true },
	);
	const card = cache.loadEndpoint(
		photo("card"),
		async () => {
			order.push("card");
			return "card";
		},
		endpointAvatarFailure,
	);
	away.abort();
	release("settled");
	await expect(departed).resolves.toBeNull();
	await Promise.all([first, card, queued]);
	expect(readAway).not.toHaveBeenCalled();
	expect(order).toEqual(["card", "row"]);
});

it("uses the actual clipping viewport, not the whole window", () => {
	const viewport = { y: 220, width: 360, height: 340 };
	expect(inAvatarViewport({ y: 50, width: 48, height: 48 }, viewport)).toBe(
		false,
	);
	expect(inAvatarViewport({ y: 216, width: 48, height: 48 }, viewport)).toBe(
		true,
	);
	expect(inAvatarViewport({ y: 250, width: 0, height: 0 }, viewport)).toBe(
		false,
	);
});
