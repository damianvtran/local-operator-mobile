/**
 * The transcript's image sources: what a mounted thumbnail paints from, and why
 * a second mount of the same image costs nothing.
 *
 * WHY THIS EXISTS (performance audit P1). `TranscriptImage` used to hold its
 * source in component state and nothing else. The transcript is a virtualised
 * list, so a row leaves and re-enters the window as the reader scrolls; every
 * re-entry reset the state to `loading`, refetched the full attachment,
 * re-encoded it and flashed the skeleton again. This module is the memory that
 * outlives the mount: a settled image is answered SYNCHRONOUSLY (`peek`), so
 * the first frame of a remount is the picture, and two mounts asking for the
 * same image at once share one request (`load`).
 *
 * WHAT IS IN A KEY, AND WHAT NEVER IS. A key is `<scope>|<entryId>|<index>`,
 * where `<scope>` is a small integer minted per LOADER FUNCTION. The loader
 * (`useSessionRuntime().loadImage`) is rebuilt exactly when its relay client or
 * its session changes, so its identity already separates one session's images
 * from another's — and one computer's from another's — without this module
 * ever seeing a session id, a host, a URL or a credential. Nothing that
 * authenticates a request can reach a key, a log line or a file name from here,
 * because none of it is passed in. The scope table is a `WeakMap`, so a retired
 * loader's scope id is unreachable rather than leaked.
 *
 * NO `react-native` IMPORT: the unit tests run in Node (`vitest.config.ts`),
 * and the cache's rules — bounded size, eviction order, in-flight sharing, what
 * a failure leaves behind — are exactly the part worth asserting.
 */

/** One settled image. `uri === null` is the relay's own "no such image": a
 *  previous generation's attachment, which is a normal answer for an old
 *  transcript and so is remembered like any other (asking again would only
 *  flash a skeleton before the same sentence). */
export type CachedImage = {
	/** A source `expo-image` opens — a cache file on native, a Blob object URL
	 *  on web — or `null` when the relay no longer has the bytes. */
	uri: string | null;
	/** Width over height, once a decode has reported it; `null` before. Kept
	 *  with the source so a remount reserves the FINAL frame, not the square
	 *  placeholder followed by a width change. */
	aspectRatio: number | null;
};

/** What a loader answers: a source, or `null` for "the relay no longer has it".
 *  A rejection is a transport failure and is deliberately not remembered. */
export type ImageLoader = (
	entryId: string,
	index: number,
) => Promise<string | null>;

export type ImageCache = {
	/** The settled image for this loader + entry + index, or `undefined` when
	 *  it has not settled. Counts as a use (see `capacity`). */
	peek: (
		loader: ImageLoader,
		entryId: string,
		index: number,
	) => CachedImage | undefined;
	/** Settle the image, calling the loader at most once per key however many
	 *  callers ask while it is in flight. */
	load: (
		loader: ImageLoader,
		entryId: string,
		index: number,
	) => Promise<CachedImage>;
	/** Settle an image from a source the CALLER already holds, without asking
	 *  the loader — for the reader's own just-sent attachment, whose bytes the
	 *  phone has before the relay can serve them (`seedPendingEchoImages`). A
	 *  key that is already settled is left alone: the relay's answer, once
	 *  there, is the truth and must not be overwritten by a local copy. */
	seed: (
		loader: ImageLoader,
		entryId: string,
		index: number,
		uri: string,
	) => void;
	/** Drop every settled entry whose source matches — for the auth boundary,
	 *  which must not leave the reader's own seeded `data:` images (whole files,
	 *  inline) in memory for whoever signs in next (`clearPendingEchoes`). */
	forgetWhere: (match: (uri: string) => boolean) => void;
	/** Record the decoded aspect ratio against an already-settled image. */
	noteAspectRatio: (
		loader: ImageLoader,
		entryId: string,
		index: number,
		aspectRatio: number,
	) => void;
	/** How many settled images are held. For tests. */
	size: () => number;
};

/**
 * How many settled images the cache holds before the least recently used one is
 * released.
 *
 * NOT A MEASURED DISTRIBUTION: nothing in the repo records how many images a
 * conversation carries, so this is a reasoned bound with its failure mode
 * stated. The relay's projection window and its default history page are 80
 * rows each (`HISTORY_LIMIT.default`, `relay/endpoints.ts`), and an image is a
 * reader's attachment or one generated artifact — a few per turn at the
 * outside — so 96 holds a whole window that carried an image on every row.
 *
 * Exceeding it is safe, only slower: an evicted image is fetched again the next
 * time it mounts. On native that "fetch" is a stat of the cache file
 * (`loadAttachments`), not a request. On web the evicted Blob URL is revoked;
 * a view still showing it keeps its decoded pixels, and its next mount
 * requests the bytes again. What a FETCHED entry costs is a string and a
 * number — the bytes live in the OS cache directory or the browser's blob
 * store — so for those the cap bounds object URLs on web, not JS memory. A
 * SEEDED entry (`seed`, the reader's just-sent attachment) is the exception:
 * its string is a `data:` URI holding the whole file, so it does cost heap
 * until it is evicted or `forgetWhere` drops it at the auth boundary.
 */
export const IMAGE_CACHE_CAPACITY = 96;

/**
 * A usable aspect ratio from a decode's reported size, or `null`.
 *
 * A decoder can report `0 × 0` (an SVG with no intrinsic size, a failed probe);
 * dividing through that would hand layout `NaN` or `Infinity` as a width.
 */
export const aspectRatioOf = (width: number, height: number): number | null => {
	if (!(Number.isFinite(width) && Number.isFinite(height))) return null;
	if (width <= 0 || height <= 0) return null;
	return width / height;
};

/**
 * The relay's image height (`attachment-image.tsx` there: `h-40`), in points.
 *
 * The frame is this tall in EVERY state — loading, ready, unavailable — which
 * is the kit's rule that a late or failed image never moves the text below it
 * (`components.md` § 14). It was 64, a cropped square (visual audit D10).
 */
export const IMAGE_FRAME_HEIGHT_PT = 160;

/**
 * The frame an image reserves: fixed height, width from the picture's own
 * shape, so the picture is shown whole rather than cropped to a square.
 *
 * Before a decode has reported a size the frame is a square of the same height
 * — the relay's own loading frame (`w-40`) — so only the WIDTH can change when
 * the bytes land, never the height. The caller caps the width at its column
 * (`maxWidth: "100%"`) and paints with `contain`, so a panorama is letterboxed
 * inside the frame rather than pushed past the bubble; no numeric cap is
 * argued here because the column's width is layout's fact, not this module's.
 */
export const imageFrameSize = (
	aspectRatio: number | null,
): { width: number; height: number } => ({
	width:
		aspectRatio === null
			? IMAGE_FRAME_HEIGHT_PT
			: Math.max(1, Math.round(IMAGE_FRAME_HEIGHT_PT * aspectRatio)),
	height: IMAGE_FRAME_HEIGHT_PT,
});

export const createImageCache = (options?: {
	capacity?: number;
	/** Called with a source the cache has just dropped, so its owner can free
	 *  it (web: `URL.revokeObjectURL`). Never called for a `null` source. */
	release?: (uri: string) => void;
}): ImageCache => {
	const capacity = Math.max(1, options?.capacity ?? IMAGE_CACHE_CAPACITY);
	const release = options?.release;
	/* A `Map` iterates in insertion order, so re-inserting on use makes the
	 * first key the least recently used one — an LRU with no second structure. */
	const settled = new Map<string, CachedImage>();
	const inFlight = new Map<string, Promise<CachedImage>>();
	const scopes = new WeakMap<ImageLoader, number>();
	let nextScope = 1;

	const keyOf = (
		loader: ImageLoader,
		entryId: string,
		index: number,
	): string => {
		let scope = scopes.get(loader);
		if (scope === undefined) {
			scope = nextScope;
			nextScope += 1;
			scopes.set(loader, scope);
		}
		return `${scope}|${entryId}|${index}`;
	};

	const touch = (key: string): CachedImage | undefined => {
		const hit = settled.get(key);
		if (hit === undefined) return undefined;
		settled.delete(key);
		settled.set(key, hit);
		return hit;
	};

	const store = (key: string, image: CachedImage): void => {
		settled.delete(key);
		settled.set(key, image);
		while (settled.size > capacity) {
			const oldest = settled.keys().next();
			if (oldest.done) break;
			const dropped = settled.get(oldest.value);
			settled.delete(oldest.value);
			if (dropped?.uri != null) release?.(dropped.uri);
		}
	};

	return {
		peek: (loader, entryId, index) => touch(keyOf(loader, entryId, index)),
		load: (loader, entryId, index) => {
			const key = keyOf(loader, entryId, index);
			const hit = touch(key);
			if (hit !== undefined) return Promise.resolve(hit);
			const pending = inFlight.get(key);
			if (pending !== undefined) return pending;
			const request = loader(entryId, index)
				.then((uri) => {
					const image: CachedImage = { uri, aspectRatio: null };
					store(key, image);
					return image;
				})
				/* A REJECTION IS NOT REMEMBERED. It means the host was not
				 * reached (`loadAttachments` rethrows everything but the relay's
				 * own 404), which the next mount may well fix; caching it would
				 * turn a dropped tunnel into a permanently missing image. */
				.finally(() => {
					inFlight.delete(key);
				});
			inFlight.set(key, request);
			return request;
		},
		seed: (loader, entryId, index, uri) => {
			const key = keyOf(loader, entryId, index);
			if (settled.has(key)) return;
			store(key, { uri, aspectRatio: null });
		},
		forgetWhere: (match) => {
			for (const [key, image] of [...settled]) {
				if (image.uri == null || !match(image.uri)) continue;
				settled.delete(key);
				release?.(image.uri);
			}
		},
		noteAspectRatio: (loader, entryId, index, aspectRatio) => {
			const key = keyOf(loader, entryId, index);
			const hit = settled.get(key);
			if (hit === undefined || hit.aspectRatio === aspectRatio) return;
			/* A NEW object, not a mutation: a mounted view holds the old one in
			 * state and compares by identity. Not a "use" — recording a fact
			 * about an image must not reorder what gets evicted. */
			settled.set(key, { ...hit, aspectRatio });
		},
		size: () => settled.size,
	};
};

/**
 * The app's one transcript image cache.
 *
 * Module-level on purpose: its whole job is to outlive a row's mount. On web an
 * evicted source is a Blob object URL and is revoked here, since nothing else
 * holds it; on native the source is a file in the OS cache directory, which
 * the OS reclaims and the next open reuses (`loadAttachments`), so there is
 * nothing to free.
 */
export const transcriptImages = createImageCache({
	release: (uri) => {
		if (uri.startsWith("blob:") && typeof URL.revokeObjectURL === "function")
			URL.revokeObjectURL(uri);
	},
});
