import { describe, expect, it, vi } from "vitest";

import {
	ATTACHMENT_MAX_BYTES,
	attachmentCacheKey,
	attachmentCacheSize,
	attachmentLimits,
	attachmentView,
	base64ToBytes,
	boundPlan,
	boundToLimits,
	bytesToBase64,
	cachedAttachment,
	canSend,
	clearAttachmentCache,
	createViewerPager,
	fitWithin,
	GRID_GAP,
	gridCell,
	loadAttachment,
	pageAt,
	sendableAttachmentIds,
	singleImageBox,
	sniffAttachmentMime,
	viewablePosition,
} from "@/team-bridge/attachments";
import {
	messageSchema,
	statusSchema,
	uploadedAttachmentSchema,
} from "@/team-bridge/contract";

import { message, status } from "./fixtures";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = new TextEncoder().encode("GIF89a....");
const HTML = new TextEncoder().encode("<!doctype html>");

describe("attachments capability (status.attachments)", () => {
	it("absent block → no attach affordance; an older hub would 400 the ids", () => {
		expect(attachmentLimits(statusSchema.parse(status()).attachments)).toBe(
			null,
		);
	});
	it("enabled block → limits clamped to the contract's 4", () => {
		const parsed = statusSchema.parse({
			...status(),
			attachments: {
				enabled: true,
				max_count: 9,
				max_bytes: 5_242_880,
				max_pixels: 16_777_216,
				mime_types: ["image/png", "image/jpeg"],
			},
		});
		expect(attachmentLimits(parsed.attachments)).toEqual({ maxCount: 4 });
		expect(attachmentLimits({ enabled: true, max_count: 2 })).toEqual({
			maxCount: 2,
		});
	});
	it("disabled, malformed, or types this client cannot produce → none", () => {
		expect(attachmentLimits({ enabled: false })).toBe(null);
		expect(
			attachmentLimits({ enabled: true, mime_types: ["image/webp"] }),
		).toBe(null);
		// A malformed block degrades to absent instead of failing the status gate.
		const parsed = statusSchema.parse({ ...status(), attachments: "yes" });
		expect(parsed.attachments).toBeUndefined();
		expect(attachmentLimits(parsed.attachments)).toBe(null);
	});
});

describe("message descriptors (loose schema)", () => {
	it("parses attachments[] and keeps a text-only message unchanged", () => {
		const plain = messageSchema.parse(message(1, "a", "2026-10-21T10:00:00Z"));
		expect(plain.attachments).toBeUndefined();
		const withImages = messageSchema.parse({
			...message(2, "a", "2026-10-21T10:00:00Z"),
			body: "",
			attachments: [
				{
					id: "batt_1",
					mime: "image/png",
					size: 10,
					width: 4,
					height: 3,
					sha256: "x",
				},
				{ id: "batt_2", state: "expired" },
			],
		});
		expect(withImages.attachments?.map((a) => a?.id)).toEqual([
			"batt_1",
			"batt_2",
		]);
	});
	it("one unreadable descriptor is null (unavailable), never a failed page", () => {
		const parsed = messageSchema.parse({
			...message(2, "a", "2026-10-21T10:00:00Z"),
			attachments: [{ id: "" }, { id: "batt_ok" }],
		});
		expect(parsed.attachments).toEqual([null, { id: "batt_ok" }]);
		const notArray = messageSchema.parse({
			...message(3, "a", "2026-10-21T10:00:00Z"),
			attachments: "nope",
		});
		expect(notArray.attachments).toBeUndefined();
	});
	it("render state: absent/bound fetch; expired placeholder; anything else unavailable", () => {
		expect(attachmentView({ id: "a" })).toBe("image");
		expect(attachmentView({ id: "a", state: "bound" })).toBe("image");
		expect(attachmentView({ id: "a", state: "expired" })).toBe("expired");
		for (const state of ["deleted", "withheld", "staged", "future_state"])
			expect(attachmentView({ id: "a", state })).toBe("unavailable");
		expect(attachmentView(null)).toBe("unavailable");
	});
	it("upload answer requires a PNG/JPEG mime and a size", () => {
		expect(
			uploadedAttachmentSchema.parse({
				attachment: {
					id: "batt_1",
					mime: "image/jpeg",
					size: 100,
					width: 10,
					height: 10,
					sha256: "h",
					state: "staged",
					expires_at: "2026-10-24T00:00:00Z",
				},
			}).id,
		).toBe("batt_1");
		expect(() =>
			uploadedAttachmentSchema.parse({
				attachment: { id: "batt_1", mime: "image/gif", size: 1 },
			}),
		).toThrow();
	});
});

describe("send rule and generic text", () => {
	it("image-only is sendable; nothing is not; any chip in flight blocks send", () => {
		expect(canSend("", [{ status: "ready" }])).toBe(true);
		expect(canSend("  ", [])).toBe(false);
		expect(canSend("hi", [])).toBe(true);
		expect(canSend("hi", [{ status: "uploading" }])).toBe(false);
		expect(canSend("hi", [{ status: "failed" }])).toBe(false);
	});
});

describe("capability withdrawal (R1-06)", () => {
	it("a send carries no ids once the capability is gone or before the conversation exists", () => {
		expect(sendableAttachmentIds({ maxCount: 4 }, "c1", ["batt_1"])).toEqual([
			"batt_1",
		]);
		expect(sendableAttachmentIds(null, "c1", ["batt_1"])).toEqual([]);
		expect(sendableAttachmentIds({ maxCount: 4 }, null, ["batt_1"])).toEqual(
			[],
		);
	});
});

describe("bytes", () => {
	it("sniffs PNG/JPEG by content only", () => {
		expect(sniffAttachmentMime(PNG)).toBe("image/png");
		expect(sniffAttachmentMime(JPEG)).toBe("image/jpeg");
		expect(sniffAttachmentMime(GIF)).toBe(null);
		expect(sniffAttachmentMime(HTML)).toBe(null);
		expect(sniffAttachmentMime(new Uint8Array())).toBe(null);
	});
	it("base64 round-trips every remainder and matches Node's encoder", () => {
		for (let n = 0; n < 40; n += 1) {
			const bytes = Uint8Array.from(
				{ length: n },
				(_, i) => (i * 37 + n) & 255,
			);
			const encoded = bytesToBase64(bytes);
			expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
			expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes));
		}
		expect(
			Array.from(base64ToBytes("data:image/png;base64,iVBORw0KGgo=")),
		).toEqual(Array.from(PNG.subarray(0, 8)));
		expect(() => base64ToBytes("not*base64")).toThrow();
	});
	it("encodes a 1 MiB image without blowing the stack", () => {
		const big = new Uint8Array(ATTACHMENT_MAX_BYTES).fill(7);
		expect(bytesToBase64(big).length).toBe(Math.ceil(big.length / 3) * 4);
	});
});

describe("bounding (1024 edge / 1 MiB)", () => {
	it("fits within the edge, never upscales, keeps aspect", () => {
		expect(fitWithin(4032, 3024, 1024)).toEqual({ width: 1024, height: 768 });
		expect(fitWithin(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 });
		expect(fitWithin(300, 200, 1024)).toEqual({ width: 300, height: 200 });
		expect(fitWithin(20000, 1, 1024)).toEqual({ width: 1024, height: 1 });
	});
	it("PNG sources try PNG first, everything ends in JPEG", () => {
		expect(boundPlan(true)[0]?.format).toBe("png");
		expect(boundPlan(false).every((s) => s.format === "jpeg")).toBe(true);
		expect(boundPlan(false).at(-1)).toMatchObject({ edge: 512 });
	});
	it("walks the ladder until the render fits", async () => {
		const sizes = [2_000_000, 1_500_000, 900_000];
		const render = vi.fn(async (_step: { width: number; height: number }) => {
			const bytes = new Uint8Array(sizes.shift() ?? 10);
			bytes.set(JPEG);
			return bytesToBase64(bytes);
		});
		const out = await boundToLimits(
			{ width: 4000, height: 3000, isPng: false },
			render,
		);
		expect(render).toHaveBeenCalledTimes(3);
		expect(render.mock.calls[0]?.[0]).toMatchObject({
			width: 1024,
			height: 768,
			format: "jpeg",
		});
		expect(out).toMatchObject({ mime: "image/jpeg", width: 768, height: 576 });
		expect(out.bytes.length).toBe(900_000);
	});
	it("refuses when nothing fits, or when the encoder emits a non-image", async () => {
		const huge = async () => {
			const bytes = new Uint8Array(ATTACHMENT_MAX_BYTES + 1);
			bytes.set(JPEG);
			return bytesToBase64(bytes);
		};
		await expect(
			boundToLimits({ width: 10, height: 10, isPng: false }, huge),
		).rejects.toThrow("too large");
		await expect(
			boundToLimits({ width: 10, height: 10, isPng: false }, async () =>
				bytesToBase64(GIF),
			),
		).rejects.toThrow("could not be converted");
	});
});

describe("in-memory image cache", () => {
	it("dedupes concurrent loads and serves later reads from memory", async () => {
		clearAttachmentCache();
		const load = vi.fn(async () => "data:image/png;base64,AA==");
		const key = attachmentCacheKey("t", "c", "m", "a");
		const [a, b] = await Promise.all([
			loadAttachment(key, load),
			loadAttachment(key, load),
		]);
		expect(a).toBe(b);
		expect(load).toHaveBeenCalledTimes(1);
		expect(cachedAttachment(key)).toBe(a);
	});
	it("is bounded and evicts the oldest", async () => {
		clearAttachmentCache();
		for (let i = 0; i < 30; i += 1)
			await loadAttachment(`k${i}`, async () => `v${i}`);
		expect(attachmentCacheSize()).toBe(24);
		expect(cachedAttachment("k0")).toBeUndefined();
		expect(cachedAttachment("k29")).toBe("v29");
	});
	it("clear (sign-out) empties it, and a load in flight across a clear is not stored", async () => {
		clearAttachmentCache();
		let release: (v: string) => void = () => undefined;
		const pending = loadAttachment(
			"late",
			() => new Promise<string>((r) => (release = r)),
		);
		clearAttachmentCache();
		release("data:x");
		await pending;
		expect(cachedAttachment("late")).toBeUndefined();
		expect(attachmentCacheSize()).toBe(0);
	});
});

describe("message image layout (design D3, D5)", () => {
	it("one image keeps its aspect inside 240 pt; unknown dimensions are 4:3", () => {
		expect(singleImageBox(1024, 768)).toEqual({ width: 240, height: 180 });
		expect(singleImageBox(768, 1024)).toEqual({ width: 180, height: 240 });
		expect(singleImageBox(100, 50)).toEqual({ width: 100, height: 50 });
		expect(singleImageBox(undefined, undefined)).toEqual({
			width: 240,
			height: 180,
		});
		expect(singleImageBox(4000, 10)).toEqual({ width: 240, height: 48 });
	});
	it("two or more images are square cells in two columns: four is a 2×2 block no taller than wide", () => {
		expect(gridCell(1, 330)).toBe(null);
		// R3-03: no width yet → no cells (measure first, never draw 48 pt cells).
		expect(gridCell(4, 0)).toBe(null);
		const cell = gridCell(4, 330);
		expect(cell).toEqual({ width: 158, height: 158 });
		const blockWidth = (cell?.width ?? 0) * 2 + GRID_GAP;
		const blockHeight = (cell?.height ?? 0) * 2 + GRID_GAP;
		expect(blockHeight).toBeLessThanOrEqual(blockWidth);
		// Wide tablet columns are capped.
		expect(gridCell(2, 900)).toEqual({ width: 158, height: 158 });
	});
});

describe("viewer pager (R3-01)", () => {
	it("derives the page from a scroll offset, clamped, and waits for a width", () => {
		expect(pageAt(0, 390, 4)).toBe(0);
		expect(pageAt(390, 390, 4)).toBe(1);
		expect(pageAt(400, 390, 4)).toBe(1);
		expect(pageAt(585, 390, 4)).toBe(2);
		expect(pageAt(9999, 390, 4)).toBe(3);
		expect(pageAt(-50, 390, 4)).toBe(0);
		expect(pageAt(390, 0, 4)).toBe(null);
		expect(pageAt(0, 390, 0)).toBe(null);
	});
});

describe("one numbering for thread and viewer (R3-04)", () => {
	it("counts only viewable images, so 'Image 2 of 3' opens page 2 of 3", () => {
		const list = [
			{ id: "gone", state: "expired" },
			{ id: "a" },
			null,
			{ id: "b", state: "bound" },
			{ id: "c" },
		];
		expect(viewablePosition(list, "a")).toEqual({ index: 0, count: 3 });
		expect(viewablePosition(list, "b")).toEqual({ index: 1, count: 3 });
		expect(viewablePosition(list, "gone")).toBe(null);
	});
});

describe("viewer pager events, as react-native-web delivers them (R3-01)", () => {
	const rig = (initialIndex: number, count = 4) => {
		let index = initialIndex;
		const scrolls: number[] = [];
		const seen: number[] = [];
		const pager = createViewerPager({
			initialIndex,
			count,
			scrollTo: (x) => scrolls.push(x),
			currentIndex: () => index,
			setIndex: (n) => {
				index = n;
				seen.push(n);
			},
		});
		return { pager, scrolls, seen, index: () => index };
	};
	it("opens on initialIndex by scrolling after the first real layout (web ignores contentOffset)", () => {
		const r = rig(1);
		r.pager.onLayout(0); // a zero-width layout is ignored
		expect(r.scrolls).toEqual([]);
		r.pager.onLayout(390);
		expect(r.scrolls).toEqual([390]);
		r.pager.onLayout(844); // rotation: no second jump
		expect(r.scrolls).toEqual([390]);
		expect(r.index()).toBe(1);
	});
	it("a swipe moves the counter from onScroll alone (no end events on web)", () => {
		const r = rig(1);
		r.pager.onLayout(390);
		r.pager.onScroll(390, 390);
		expect(r.index()).toBe(1);
		r.pager.onScroll(600, 390);
		expect(r.index()).toBe(2);
		r.pager.onScroll(1170, 390);
		expect(r.index()).toBe(3);
		// A 0 width (no size yet) falls back to the laid-out width.
		r.pager.onScroll(0, 0);
		expect(r.index()).toBe(0);
	});
	/*
	 * R4-01: a button's ANIMATED scroll ticks through intermediate offsets that
	 * still round to the old page. The counter must go straight to the target
	 * and stay there (the reviewer's repro was 2 → 1 → 2).
	 */
	it("Next: intermediate ticks never step the counter back", () => {
		const r = rig(1);
		r.pager.onLayout(390);
		r.pager.onScroll(390, 390);
		r.pager.step(1);
		for (const x of [398, 470, 560, 620, 700, 780]) r.pager.onScroll(x, 390);
		expect(r.seen).toEqual([2]);
		expect(r.scrolls.at(-1)).toBe(780);
	});
	it("Previous: the same, in the other direction", () => {
		const r = rig(2);
		r.pager.onLayout(390);
		r.pager.onScroll(780, 390);
		r.pager.step(-1);
		for (const x of [772, 700, 600, 500, 400, 390]) r.pager.onScroll(x, 390);
		expect(r.seen).toEqual([1]);
	});
	it("a rapid double Next moves two pages, not one", () => {
		const r = rig(0);
		r.pager.onLayout(390);
		r.pager.onScroll(0, 390);
		r.pager.step(1);
		r.pager.onScroll(60, 390);
		r.pager.step(1); // pressed again mid-animation
		for (const x of [120, 300, 500, 700, 780]) r.pager.onScroll(x, 390);
		expect(r.seen).toEqual([1, 2]);
		expect(r.index()).toBe(2);
		expect(r.scrolls.slice(-2)).toEqual([390, 780]);
	});
	it("a swipe start drops the pending target, so the reader's drag is followed", () => {
		const r = rig(0);
		r.pager.onLayout(390);
		r.pager.onScroll(0, 390);
		r.pager.step(1);
		r.pager.onScroll(100, 390);
		r.pager.onUserScroll(); // reader grabs it and drags back
		r.pager.onScroll(20, 390);
		expect(r.index()).toBe(0);
	});
	it("a tick off the button's path (an interrupting scroll) also releases it", () => {
		const r = rig(1);
		r.pager.onLayout(390);
		r.pager.onScroll(390, 390);
		r.pager.step(1); // 390 → 780
		r.pager.onScroll(1170, 390); // beyond the target: someone else scrolled
		expect(r.index()).toBe(3);
	});
	it("Next at the last page is a no-op with nothing left pending", () => {
		const r = rig(3);
		r.pager.onLayout(390);
		r.pager.onScroll(1170, 390);
		r.pager.step(1);
		expect(r.seen).toEqual([]);
		r.pager.onScroll(800, 390); // a later swipe is followed normally
		expect(r.index()).toBe(2);
	});
});
