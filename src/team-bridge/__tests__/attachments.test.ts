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
	fitWithin,
	loadAttachment,
	sendableAttachmentIds,
	sniffAttachmentMime,
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
