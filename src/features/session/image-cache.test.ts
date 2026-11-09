import { describe, expect, it, vi } from "vitest";

import {
	aspectRatioOf,
	createImageCache,
	IMAGE_CACHE_CAPACITY,
	IMAGE_FRAME_HEIGHT_PT,
	imageFrameSize,
} from "@/features/session/image-cache";

/**
 * The transcript image cache's rules (performance audit P1).
 *
 * The defect was a refetch and a skeleton flash on EVERY mount of a row: the
 * transcript is virtualised, so a row re-enters the window whenever the reader
 * scrolls back to it. What has to hold is therefore stated in terms of mounts:
 * a second mount answers synchronously and makes no request, two mounts in
 * flight share one request, and a failure is not turned into a permanent
 * answer. "Mount" here is `peek` then `load`, which is exactly what
 * `TranscriptImage` does (its initial state, then its effect).
 */

/** A loader that counts its calls and answers per key. */
const countingLoader = (
	answer: (entryId: string, index: number) => Promise<string | null> = async (
		entryId,
		index,
	) => `file:///cache/${entryId}-${index}.png`,
) => vi.fn(answer);

describe("a remount does not refetch", () => {
	it("answers a settled image synchronously, with no second request", async () => {
		const cache = createImageCache();
		const load = countingLoader();

		// First mount: nothing known, so the frame shows the skeleton and loads.
		expect(cache.peek(load, "entry-1", 0)).toBeUndefined();
		const first = await cache.load(load, "entry-1", 0);
		expect(first.uri).toBe("file:///cache/entry-1-0.png");
		expect(load).toHaveBeenCalledTimes(1);

		// The row leaves the window and comes back: the initial state is the
		// picture (`peek` is synchronous), and the effect's `load` is a hit.
		const remount = cache.peek(load, "entry-1", 0);
		expect(remount).toBe(first);
		await expect(cache.load(load, "entry-1", 0)).resolves.toBe(first);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("shares one request between mounts that overlap", async () => {
		const cache = createImageCache();
		let settle: (uri: string) => void = () => {};
		const load = countingLoader(
			() =>
				new Promise<string | null>((resolve) => {
					settle = resolve;
				}),
		);

		const a = cache.load(load, "entry-1", 0);
		const b = cache.load(load, "entry-1", 0);
		expect(load).toHaveBeenCalledTimes(1);
		settle("blob:one");
		expect(await a).toBe(await b);
	});

	it("remembers the relay's `no such image`, which will not change", async () => {
		const cache = createImageCache();
		const load = countingLoader(async () => null);
		await cache.load(load, "old-entry", 0);
		expect(cache.peek(load, "old-entry", 0)).toEqual({
			uri: null,
			aspectRatio: null,
		});
		await cache.load(load, "old-entry", 0);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("does NOT remember a transport failure: the next mount retries", async () => {
		const cache = createImageCache();
		let reachable = false;
		const load = countingLoader(async () => {
			if (!reachable) throw new Error("tunnel dropped");
			return "blob:back";
		});

		await expect(cache.load(load, "entry-1", 0)).rejects.toThrow(
			"tunnel dropped",
		);
		expect(cache.peek(load, "entry-1", 0)).toBeUndefined();
		expect(cache.size()).toBe(0);

		reachable = true;
		await expect(cache.load(load, "entry-1", 0)).resolves.toEqual({
			uri: "blob:back",
			aspectRatio: null,
		});
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe("the cache's scope is the loader, and nothing else", () => {
	it("keeps two loaders' images apart for the same entry and index", async () => {
		/* Two sessions (or two computers) can mint the same row id — a tool row
		 * is `tc-<call id>` — and each has its own loader. One must never paint
		 * the other's image. */
		const cache = createImageCache();
		const sessionA = countingLoader(async () => "blob:a");
		const sessionB = countingLoader(async () => "blob:b");
		await cache.load(sessionA, "tc-call_1", 0);
		expect(cache.peek(sessionB, "tc-call_1", 0)).toBeUndefined();
		await cache.load(sessionB, "tc-call_1", 0);
		expect(cache.peek(sessionA, "tc-call_1", 0)?.uri).toBe("blob:a");
		expect(cache.peek(sessionB, "tc-call_1", 0)?.uri).toBe("blob:b");
	});

	it("keeps an entry's images apart by index", async () => {
		const cache = createImageCache();
		const load = countingLoader();
		await cache.load(load, "entry-1", 0);
		await cache.load(load, "entry-1", 1);
		expect(cache.peek(load, "entry-1", 1)?.uri).toBe(
			"file:///cache/entry-1-1.png",
		);
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe("the cache is bounded", () => {
	it("evicts the least recently USED image and releases its source", async () => {
		const released: string[] = [];
		const cache = createImageCache({
			capacity: 2,
			release: (uri) => released.push(uri),
		});
		const load = countingLoader(async (entryId) => `blob:${entryId}`);
		await cache.load(load, "a", 0);
		await cache.load(load, "b", 0);
		// A remount of `a` is a use, so `b` is now the oldest.
		cache.peek(load, "a", 0);
		await cache.load(load, "c", 0);

		expect(cache.size()).toBe(2);
		expect(released).toEqual(["blob:b"]);
		expect(cache.peek(load, "a", 0)?.uri).toBe("blob:a");
		expect(cache.peek(load, "b", 0)).toBeUndefined();
	});

	it("never asks to release a source that was never there", async () => {
		const release = vi.fn();
		const cache = createImageCache({ capacity: 1, release });
		const load = countingLoader(async () => null);
		await cache.load(load, "gone-1", 0);
		await cache.load(load, "gone-2", 0);
		expect(release).not.toHaveBeenCalled();
	});

	it("defaults to a cap above one relay window of rows", () => {
		// The bound the cap is argued from: `HISTORY_LIMIT.default` (80).
		expect(IMAGE_CACHE_CAPACITY).toBeGreaterThan(80);
	});
});

describe("the frame's size", () => {
	it("is the relay's 160 pt tall, square until the ratio is known", () => {
		expect(IMAGE_FRAME_HEIGHT_PT).toBe(160);
		expect(imageFrameSize(null)).toEqual({ width: 160, height: 160 });
	});

	it("keeps the height and takes its width from the image's ratio", () => {
		expect(imageFrameSize(16 / 9)).toEqual({ width: 284, height: 160 });
		expect(imageFrameSize(9 / 16)).toEqual({ width: 90, height: 160 });
	});

	it("refuses a size a decoder could not measure", () => {
		expect(aspectRatioOf(1200, 800)).toBe(1.5);
		expect(aspectRatioOf(0, 0)).toBeNull();
		expect(aspectRatioOf(100, 0)).toBeNull();
		expect(aspectRatioOf(Number.NaN, 10)).toBeNull();
	});

	it("remembers the ratio with the source, so a remount reserves the final frame", async () => {
		const cache = createImageCache();
		const load = countingLoader();
		const first = await cache.load(load, "entry-1", 0);
		cache.noteAspectRatio(load, "entry-1", 0, 1.5);
		const remount = cache.peek(load, "entry-1", 0);
		expect(remount).toEqual({ uri: first.uri, aspectRatio: 1.5 });
		// A new object: a mounted view compares its state by identity.
		expect(remount).not.toBe(first);
		expect(imageFrameSize(remount?.aspectRatio ?? null).width).toBe(240);
	});

	it("ignores a ratio for an image it does not hold", () => {
		const cache = createImageCache();
		const load = countingLoader();
		cache.noteAspectRatio(load, "never-loaded", 0, 2);
		expect(cache.size()).toBe(0);
	});
});
