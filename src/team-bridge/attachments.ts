/**
 * Team Bridge image attachments: the pure rules every surface shares.
 *
 * WHY A PURE MODULE. The unit suite runs in Node with no React Native host
 * (`vitest.config.ts`), so every decision worth asserting lives here: the
 * capability gate, the client-side bound plan, the byte checks on a fetched
 * image, the per-descriptor render state, the composer's send rule and the
 * in-memory image cache. The native work (picker, clipboard, re-encode) sits in
 * `src/features/team-bridge/attachment-source.ts` and only feeds this.
 *
 * THE SECURITY SHAPE, stated once:
 *
 * - The phone never builds an image URL anyone else could open. Bytes come only
 *   from the bearer-authenticated hub route for one message
 *   (`client.attachmentBytes`), and are shown from an in-memory `data:` URI.
 * - Nothing here writes an image to shared storage. The cache below is a
 *   bounded in-process map, cleared on account reset/sign-out
 *   (`store.actions.reset`). `expo-image` is told `cachePolicy="none"` so it
 *   adds no disk copy of its own.
 * - Fail closed: a descriptor in a state this build does not know, a response
 *   whose type or magic bytes are not PNG/JPEG, or an absent capability all
 *   resolve to "do not fetch / do not offer", never to a best guess.
 * - No id, size, hash, filename or byte ever reaches a log from this module.
 */

import type {
	AttachmentDescriptor,
	AttachmentsCapability,
	Message,
} from "@/team-bridge/contract";

/*
 * The client-side bound (manager decision D3): every image is converted to
 * PNG/JPEG and fitted to a 1024 px long edge and 1 MiB BEFORE upload, so the
 * hub's own caps (5 MiB, 16 MP, 8192 px/edge) are headroom and never the normal
 * path. The same numbers the desktop's `boundImageForWire` uses, so an image
 * sent from either client lands the same size for every reader.
 */
export const ATTACHMENT_MAX_EDGE = 1024;
export const ATTACHMENT_MAX_BYTES = 1024 * 1024;
/** Hard per-message ceiling in the contract; a server may advertise fewer. */
export const ATTACHMENT_MAX_COUNT = 4;

/**
 * The re-encode ladder tried in order until one fits `ATTACHMENT_MAX_BYTES`.
 * PNG first only for a PNG source (screenshots keep sharp text when they fit);
 * then JPEG at falling quality, then smaller edges. Ending at 512 px / 0.5 makes
 * failure practically unreachable for a real photo, and a result that still
 * does not fit is refused visibly rather than uploaded oversize.
 */
export interface BoundStep {
	edge: number;
	format: "png" | "jpeg";
	quality: number;
}
export function boundPlan(sourceIsPng: boolean): BoundStep[] {
	const jpeg: BoundStep[] = [
		{ edge: ATTACHMENT_MAX_EDGE, format: "jpeg", quality: 0.85 },
		{ edge: ATTACHMENT_MAX_EDGE, format: "jpeg", quality: 0.7 },
		{ edge: 768, format: "jpeg", quality: 0.7 },
		{ edge: 512, format: "jpeg", quality: 0.5 },
	];
	return sourceIsPng
		? [{ edge: ATTACHMENT_MAX_EDGE, format: "png", quality: 1 }, ...jpeg]
		: jpeg;
}

/** The target size for one step: never upscaled, aspect preserved, ≥1 px. */
export function fitWithin(
	width: number,
	height: number,
	edge: number,
): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (!(longest > edge)) return { width, height };
	const scale = edge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/**
 * What the composer may offer, from the hub's `status.attachments`.
 *
 * `null` = no attach affordance at all. An older hub refuses an unknown
 * `attachment_ids` field with 400, so offering a picker it cannot honour would
 * only move the failure to the send button. `max_count` is clamped to the
 * contract's 4 even if a server advertises more, and a server may lower it.
 */
export interface AttachmentLimits {
	maxCount: number;
}
export function attachmentLimits(
	capability: AttachmentsCapability | null | undefined,
): AttachmentLimits | null {
	if (!capability?.enabled) return null;
	const types = capability.mime_types;
	// A server that names its types but takes neither PNG nor JPEG cannot take
	// what this client produces.
	if (types && !types.includes("image/png") && !types.includes("image/jpeg"))
		return null;
	const advertised = capability.max_count ?? ATTACHMENT_MAX_COUNT;
	const maxCount = Math.min(ATTACHMENT_MAX_COUNT, advertised);
	return maxCount > 0 ? { maxCount } : null;
}

/**
 * How one descriptor on a message renders.
 *
 * - `image`: bound and readable (`state` absent or `bound`): fetch with the
 *   bearer and show it.
 * - `expired`: the retention sweeper purged the bytes; show "Image expired".
 * - `unavailable`: any other state (including one a future server adds), or a
 *   descriptor this build could not parse (`null`). Never fetched.
 */
export type AttachmentView = "image" | "expired" | "unavailable";
export function attachmentView(
	descriptor: AttachmentDescriptor | null,
): AttachmentView {
	if (descriptor === null) return "unavailable";
	if (descriptor.state === undefined || descriptor.state === "bound")
		return "image";
	if (descriptor.state === "expired") return "expired";
	return "unavailable";
}

/** The attachments a message carries, `[]` for a text-only or older message. */
export const messageAttachments = (
	message: Pick<Message, "attachments">,
): Array<AttachmentDescriptor | null> => message.attachments ?? [];

/**
 * The ids a send may carry: none unless the hub CURRENTLY advertises the
 * capability and the conversation exists. The strip renders under the same
 * condition, so a send can never carry an image the reader cannot see (a
 * withdrawn capability would otherwise send ids an older hub answers 400).
 */
export function sendableAttachmentIds(
	limits: AttachmentLimits | null,
	conversationId: string | null,
	ids: readonly string[],
): string[] {
	return limits && conversationId ? [...ids] : [];
}

/**
 * The composer's send rule: text, or at least one uploaded image, and nothing
 * still in flight. An image-only send carries `body: ""`, which the hub accepts
 * only when `attachment_ids` is non-empty.
 */
export function canSend(
	text: string,
	chips: ReadonlyArray<{ status: ChipStatus }>,
): boolean {
	if (chips.some((chip) => chip.status !== "ready")) return false;
	return text.trim().length > 0 || chips.length > 0;
}

export type ChipStatus = "preparing" | "uploading" | "ready" | "failed";

/* -------------------------------------------------------------- bytes */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** PNG/JPEG by content, or `null`. The declared type is never trusted alone. */
export function sniffAttachmentMime(
	bytes: Uint8Array,
): "image/png" | "image/jpeg" | null {
	const starts = (magic: number[]) =>
		bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
	if (starts(PNG_MAGIC)) return "image/png";
	if (starts(JPEG_MAGIC)) return "image/jpeg";
	return null;
}

const ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DECODE = (() => {
	const table = new Int16Array(128).fill(-1);
	for (let i = 0; i < ALPHABET.length; i += 1)
		table[ALPHABET.charCodeAt(i)] = i;
	return table;
})();

/*
 * A local base64 codec rather than `btoa`/`atob`: those are absent from some
 * Hermes builds (`src/connection/pkce.ts` carries the same fallback), and the
 * spread form `String.fromCharCode(...bytes)` overflows the call stack on a
 * 1 MiB image. Pure and allocation-light, and a Node test covers it exactly.
 */
export function bytesToBase64(bytes: Uint8Array): string {
	// `charAt` and `?? 0` instead of indexed access with `!`: out-of-range reads
	// cannot happen inside these bounds, and this keeps the codec assertion-free.
	const at = (index: number): number => bytes[index] ?? 0;
	const char = (value: number): string => ALPHABET.charAt(value & 63);
	let out = "";
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = (at(i) << 16) | (at(i + 1) << 8) | at(i + 2);
		out += char(n >> 18) + char(n >> 12) + char(n >> 6) + char(n);
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = at(i) << 16;
		out += `${char(n >> 18)}${char(n >> 12)}==`;
	} else if (rest === 2) {
		const n = (at(i) << 16) | (at(i + 1) << 8);
		out += `${char(n >> 18)}${char(n >> 12)}${char(n >> 6)}=`;
	}
	return out;
}

/** Decode standard base64 (whitespace and a `data:` prefix tolerated). */
export function base64ToBytes(input: string): Uint8Array {
	const comma = input.startsWith("data:") ? input.indexOf(",") : -1;
	const text = (comma >= 0 ? input.slice(comma + 1) : input).replace(
		/[\s=]+/g,
		"",
	);
	const out = new Uint8Array(Math.floor((text.length * 3) / 4));
	let buffer = 0;
	let bits = 0;
	let o = 0;
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		const value = code < 128 ? (DECODE[code] ?? -1) : -1;
		if (value < 0) throw new Error("invalid base64");
		buffer = (buffer << 6) | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o] = (buffer >> bits) & 0xff;
			o += 1;
		}
	}
	return out.subarray(0, o);
}

export const dataUri = (mime: string, bytes: Uint8Array): string =>
	`data:${mime};base64,${bytesToBase64(bytes)}`;

/* --------------------------------------------------- in-memory image cache */

/*
 * Bounded so a long scroll cannot hold an unbounded number of decoded images:
 * 24 × ≤1 MiB (≈1.33 MiB as base64) keeps the worst case near 32 MB. Insertion
 * order is the eviction order (a Map iterates oldest first), refreshed on read.
 * Process memory only: nothing survives an app restart, and `clear` runs on
 * sign-out/account change so the next account never sees the last one's images.
 */
const CACHE_LIMIT = 24;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let cacheEpoch = 0;

export const attachmentCacheKey = (
	tenantId: string,
	conversationId: string,
	messageId: string,
	attachmentId: string,
): string => `${tenantId}/${conversationId}/${messageId}/${attachmentId}`;

export function cachedAttachment(key: string): string | undefined {
	const hit = cache.get(key);
	if (hit !== undefined) {
		cache.delete(key);
		cache.set(key, hit);
	}
	return hit;
}

/**
 * Load once per key: concurrent rows asking for the same image share one
 * request. A load that finishes after `clearAttachmentCache` (an account
 * change) is returned to its caller but NOT stored, so it cannot repopulate the
 * next account's cache.
 */
export function loadAttachment(
	key: string,
	load: () => Promise<string>,
): Promise<string> {
	const hit = cachedAttachment(key);
	if (hit !== undefined) return Promise.resolve(hit);
	const pending = inflight.get(key);
	if (pending) return pending;
	const epoch = cacheEpoch;
	const next = load()
		.then((uri) => {
			if (epoch === cacheEpoch) {
				cache.set(key, uri);
				while (cache.size > CACHE_LIMIT) {
					const oldest = cache.keys().next().value;
					if (oldest === undefined) break;
					cache.delete(oldest);
				}
			}
			return uri;
		})
		.finally(() => {
			if (inflight.get(key) === next) inflight.delete(key);
		});
	inflight.set(key, next);
	return next;
}

export function clearAttachmentCache(): void {
	cacheEpoch += 1;
	cache.clear();
	inflight.clear();
}

export const attachmentCacheSize = (): number => cache.size;

/* ------------------------------------------------------------ bounding */

/**
 * Fit one image to the wire bound by walking `boundPlan` until a render fits.
 *
 * `render` is the platform re-encode (expo-image-manipulator on device), injected
 * so the ladder itself is a Node test. It returns base64 of a PNG/JPEG at the
 * given size and quality. The result is checked here, not trusted: the bytes
 * must sniff as PNG/JPEG and weigh at most `ATTACHMENT_MAX_BYTES`. Throws when
 * the last step still does not fit, so the chip shows a failure the reader can
 * see instead of an upload the hub would refuse.
 *
 * ALWAYS re-encodes, even when the source already fits: a re-encode drops
 * EXIF/GPS metadata from a camera photo, and the reader did not choose to share
 * where a picture was taken.
 */
export async function boundToLimits(
	source: { width: number; height: number; isPng: boolean },
	render: (step: {
		width: number;
		height: number;
		format: "png" | "jpeg";
		quality: number;
	}) => Promise<string>,
): Promise<{
	bytes: Uint8Array;
	mime: "image/png" | "image/jpeg";
	width: number;
	height: number;
}> {
	for (const step of boundPlan(source.isPng)) {
		const size = fitWithin(source.width, source.height, step.edge);
		const bytes = base64ToBytes(await render({ ...size, ...step }));
		const mime = sniffAttachmentMime(bytes);
		if (mime === null) throw new Error("the image could not be converted");
		if (bytes.length <= ATTACHMENT_MAX_BYTES) return { bytes, mime, ...size };
	}
	throw new Error("the image is too large to send");
}

/* ------------------------------------------------------------- layout */

/*
 * Message image layout (design round 1, D3 and D5).
 *
 * One image keeps its aspect inside a 240 pt box: a lone screenshot or photo
 * reads as itself. Two or more go into a two-column grid of square cells, so
 * four images are a 2×2 block no taller than it is wide, the Slack/Discord
 * shape, instead of a stack a screen and a half tall. Three is a 2+1 grid
 * (the third cell sits under the first). The column width is measured by the
 * caller; the cap keeps a tablet column from producing 500 pt cells.
 *
 * Every state of an image (loading, loaded, failed, expired, unavailable)
 * uses the SAME box, so a failed load or a purge never reflows the thread
 * under the reader.
 */
export const SINGLE_IMAGE_EDGE = 240;
export const GRID_GAP = 4;
const GRID_MAX_WIDTH = 320;
const MIN_EDGE = 48;

export interface Box {
	width: number;
	height: number;
}

/** A lone image's box from its descriptor (4:3 when dimensions are unknown). */
export function singleImageBox(
	width: number | undefined,
	height: number | undefined,
): Box {
	if (!(width && height && width > 0 && height > 0))
		return { width: SINGLE_IMAGE_EDGE, height: SINGLE_IMAGE_EDGE * 0.75 };
	const scale = Math.min(1, SINGLE_IMAGE_EDGE / Math.max(width, height));
	return {
		width: Math.max(MIN_EDGE, Math.round(width * scale)),
		height: Math.max(MIN_EDGE, Math.round(height * scale)),
	};
}

/** Square grid cells for 2+ images, sized from the available column width. */
export function gridCell(count: number, columnWidth: number): Box | null {
	if (count < 2) return null;
	const width = Math.min(GRID_MAX_WIDTH, Math.max(0, columnWidth));
	const edge = Math.max(MIN_EDGE, Math.floor((width - GRID_GAP) / 2));
	return { width: edge, height: edge };
}
