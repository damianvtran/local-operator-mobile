import { describe, expect, it, vi } from "vitest";

import { HubError } from "@/team-bridge/client";

import {
	type AttachmentDraft,
	CHIP_CONTROL_OUTSET,
	chipControlRects,
	chipStateLabel,
	createAttachmentDraft,
	type Prepared,
	sendBlockedReason,
	sendFailureOf,
	stripSummary,
	syncDraft,
} from "./attachment-draft";

const prepared = (): Prepared => ({
	bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]),
	mime: "image/jpeg",
	width: 4,
	height: 3,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(
	overrides: Partial<Parameters<typeof createAttachmentDraft>[0]> = {},
) {
	let n = 0;
	const base = {
		maxCount: 4,
		prepare: vi.fn(async () => prepared()),
		upload: vi.fn(async () => {
			n += 1;
			return { id: `batt_${n}` };
		}),
		discard: vi.fn(async (_id: string) => undefined),
		onChange: vi.fn(),
	};
	const deps = { ...base, ...overrides };
	return { draft: createAttachmentDraft(deps), deps: base };
}

describe("composer attachment chips", () => {
	it("prepares, uploads and exposes ids in chip order", async () => {
		const { draft, deps } = setup();
		expect(draft.add(["a", "b"])).toBe(null);
		expect(draft.chips().map((c) => c.status)).toEqual([
			"preparing",
			"preparing",
		]);
		await flush();
		expect(draft.chips().map((c) => c.status)).toEqual(["ready", "ready"]);
		expect(draft.attachmentIds()).toEqual(["batt_1", "batt_2"]);
		expect(
			draft.chips()[0]?.preview?.startsWith("data:image/jpeg;base64,"),
		).toBe(true);
		expect(deps.upload).toHaveBeenCalledTimes(2);
		expect(draft.summary()).toBe("2 images attached");
	});

	it("refuses past the per-message limit with a sentence, keeping the rest", async () => {
		const { draft } = setup({ maxCount: 2 });
		expect(draft.add(["a", "b", "c"])).toBe(
			"You can attach up to 2 images per message.",
		);
		expect(draft.chips()).toHaveLength(2);
		expect(draft.remaining()).toBe(0);
	});

	it("a failed upload keeps the bounded bytes; retry re-uploads without re-preparing", async () => {
		const upload = vi
			.fn()
			.mockRejectedValueOnce(new Error("network"))
			.mockResolvedValueOnce({ id: "batt_9" });
		const { draft, deps } = setup({ upload });
		draft.add(["a"]);
		await flush();
		expect(draft.chips()[0]).toMatchObject({
			status: "failed",
			error: "This image did not upload.",
		});
		const key = draft.chips()[0]?.key ?? "";
		draft.retry(key);
		await flush();
		expect(deps.prepare).toHaveBeenCalledTimes(1);
		expect(draft.chips()[0]?.status).toBe("ready");
		expect(draft.attachmentIds()).toEqual(["batt_9"]);
	});

	it("a failed conversion says so and retry re-prepares", async () => {
		const prepare = vi
			.fn()
			.mockRejectedValueOnce(new Error("too large"))
			.mockResolvedValueOnce(prepared());
		const { draft } = setup({ prepare });
		draft.add(["a"]);
		await flush();
		expect(draft.chips()[0]?.error).toBe("This image could not be prepared.");
		draft.retry(draft.chips()[0]?.key ?? "");
		await flush();
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(draft.chips()[0]?.status).toBe("ready");
	});

	it("removing an uploaded chip deletes the staged image; removing mid-upload deletes on arrival", async () => {
		let finish: (v: { id: string }) => void = () => undefined;
		const upload = vi
			.fn()
			.mockResolvedValueOnce({ id: "batt_1" })
			.mockImplementationOnce(
				() => new Promise<{ id: string }>((r) => (finish = r)),
			);
		const { draft, deps } = setup({ upload });
		draft.add(["a"]);
		await flush();
		draft.remove(draft.chips()[0]?.key ?? "");
		expect(deps.discard).toHaveBeenCalledWith("batt_1");
		draft.add(["b"]);
		await flush();
		draft.remove(draft.chips()[0]?.key ?? "");
		expect(draft.chips()).toHaveLength(0);
		finish({ id: "batt_2" });
		await flush();
		expect(deps.discard).toHaveBeenCalledWith("batt_2");
		expect(draft.attachmentIds()).toEqual([]);
	});

	it("after a confirmed send the chips clear WITHOUT deleting the now-bound images", async () => {
		const { draft, deps } = setup();
		draft.add(["a"]);
		await flush();
		draft.clearSent();
		expect(draft.chips()).toEqual([]);
		expect(deps.discard).not.toHaveBeenCalled();
	});

	it("leaving with unsent images releases them", async () => {
		const { draft, deps } = setup();
		draft.add(["a", "b"]);
		await flush();
		draft.dispose();
		expect(deps.discard.mock.calls.map((c) => c[0])).toEqual([
			"batt_1",
			"batt_2",
		]);
	});

	it("R1-03: deterministic upload refusals are final; rate limits and transport stay retryable", async () => {
		for (const [error, retryable, text] of [
			[
				new HubError({ kind: "invalid", message: "x", status: 415 }),
				false,
				"Radient cannot accept this image. Remove it.",
			],
			[
				new HubError({ kind: "not_found", message: "x", status: 404 }),
				false,
				"This conversation is no longer available. Remove the image.",
			],
			[
				new HubError({ kind: "rate_limited", message: "x", status: 429 }),
				true,
				"Too many images at once. Try again shortly.",
			],
			[
				new HubError({ kind: "unreachable", message: "x" }),
				true,
				"This image did not upload.",
			],
		] as const) {
			const upload = vi.fn().mockRejectedValue(error);
			const { draft } = setup({ upload });
			draft.add(["a"]);
			await flush();
			expect(draft.chips()[0]).toMatchObject({
				status: "failed",
				retryable,
				error: text,
			});
			draft.retry(draft.chips()[0]?.key ?? "");
			await flush();
			expect(upload).toHaveBeenCalledTimes(retryable ? 2 : 1);
		}
	});

	it("R1-03: a send's attachment_not_found marks ready chips expired and final", async () => {
		const { draft } = setup();
		draft.add(["a"]);
		await flush();
		draft.markExpired();
		expect(draft.chips()[0]).toMatchObject({
			status: "failed",
			retryable: false,
			error: "This image expired before it was sent. Remove it.",
		});
	});

	it("R1-02: leaving during a send never deletes the ids that send is binding", async () => {
		const { draft, deps } = setup();
		draft.add(["a", "b"]);
		await flush();
		const settle = draft.beginSend(["batt_1"]);
		draft.dispose();
		expect(deps.discard.mock.calls.map((c) => c[0])).toEqual(["batt_2"]);
		settle();
	});

	it("R1-05: the picked source copy is released after convert, and on remove before convert", async () => {
		const releaseSource = vi.fn();
		const { draft } = setup({ releaseSource });
		draft.add(["picked-a"]);
		await flush();
		expect(releaseSource).toHaveBeenCalledWith("picked-a");
		let finish: (p: Prepared) => void = () => undefined;
		const slow = setup({
			releaseSource,
			prepare: vi.fn(() => new Promise<Prepared>((r) => (finish = r))),
		});
		slow.draft.add(["picked-b"]);
		slow.draft.remove(slow.draft.chips()[0]?.key ?? "");
		expect(releaseSource).toHaveBeenCalledWith("picked-b");
		finish(prepared());
		await flush();
		expect(releaseSource).toHaveBeenCalledTimes(2);
	});
});

describe("send failure copy (R2-01)", () => {
	const notFound = (code: string) =>
		new HubError({ kind: "not_found", message: "x", status: 404, code });
	it("only attachment_not_found with images attached is 'expired'", () => {
		expect(sendFailureOf(notFound("attachment_not_found"), ["batt_1"])).toBe(
			"expired",
		);
	});
	it("conversation_not_found is NOT an expired image, even with images attached", () => {
		expect(sendFailureOf(notFound("conversation_not_found"), ["batt_1"])).toBe(
			"generic",
		);
		expect(sendFailureOf(notFound("not_a_member"), ["batt_1"])).toBe("generic");
	});
	it("a text-only send or a non-hub error stays generic", () => {
		expect(sendFailureOf(notFound("attachment_not_found"), [])).toBe("generic");
		expect(sendFailureOf(new Error("network"), ["batt_1"])).toBe("generic");
	});
});

describe("thread-screen draft sync (R1-06 capability withdrawal)", () => {
	const fake = () => {
		const draft = { dispose: vi.fn() } as unknown as AttachmentDraft & {
			dispose: ReturnType<typeof vi.fn>;
		};
		return draft;
	};
	it("creates one draft per conversation while the capability is advertised", () => {
		const create = vi.fn(() => fake());
		const held = syncDraft(null, { maxCount: 4 }, "c1", create);
		expect(held?.conversationId).toBe("c1");
		expect(syncDraft(held, { maxCount: 4 }, "c1", create)).toBe(held);
		expect(create).toHaveBeenCalledTimes(1);
	});
	it("capability withdrawn: disposes the held draft (staged ids released) and holds nothing", () => {
		const draft = fake();
		const held = syncDraft(null, { maxCount: 4 }, "c1", () => draft);
		expect(syncDraft(held, null, "c1", () => fake())).toBe(null);
		expect(draft.dispose).toHaveBeenCalledTimes(1);
	});
	it("withdrawal end-to-end: a real draft's uploaded ids are DELETEd and none remain to send", async () => {
		const { draft, deps } = setup();
		draft.add(["a", "b"]);
		await flush();
		expect(draft.attachmentIds()).toEqual(["batt_1", "batt_2"]);
		const held = syncDraft(null, { maxCount: 4 }, "c1", () => draft);
		expect(syncDraft(held, null, "c1", () => draft)).toBe(null);
		expect(deps.discard.mock.calls.map((c) => c[0])).toEqual([
			"batt_1",
			"batt_2",
		]);
		expect(draft.attachmentIds()).toEqual([]);
	});
	it("switching conversation disposes the old draft and creates a new one", () => {
		const first = fake();
		const second = fake();
		const held = syncDraft(null, { maxCount: 4 }, "c1", () => first);
		const next = syncDraft(held, { maxCount: 4 }, "c2", () => second);
		expect(first.dispose).toHaveBeenCalledTimes(1);
		expect(next?.draft).toBe(second);
	});
});

describe("quota refusal (QA Q1-02)", () => {
	it("409 attachment_quota_exceeded is final and names the 8-image limit", async () => {
		const upload = vi.fn().mockRejectedValue(
			new HubError({
				kind: "conflict",
				message: "x",
				status: 409,
				code: "attachment_quota_exceeded",
			}),
		);
		const { draft } = setup({ upload });
		draft.add(["a"]);
		await flush();
		expect(draft.chips()[0]).toMatchObject({
			status: "failed",
			retryable: false,
			error:
				"You have 8 images waiting to send. Send or remove some, then add this one again.",
		});
		draft.retry(draft.chips()[0]?.key ?? "");
		await flush();
		expect(upload).toHaveBeenCalledTimes(1);
	});
	it("another 409 stays a retryable generic failure", async () => {
		const upload = vi.fn().mockRejectedValue(
			new HubError({
				kind: "conflict",
				message: "x",
				status: 409,
				code: "other",
			}),
		);
		const { draft } = setup({ upload });
		draft.add(["a"]);
		await flush();
		expect(draft.chips()[0]).toMatchObject({ retryable: true });
	});
});

describe("visible chip state (design D1, D4)", () => {
	const chip = (
		status: DraftChipStatus,
		retryable = true,
		error: string | null = status === "failed"
			? "This image did not upload."
			: null,
	) => ({ status, retryable, error });
	type DraftChipStatus = "preparing" | "uploading" | "ready" | "failed";
	const QUOTA =
		"You have 8 images waiting to send. Send or remove some, then add this one again.";
	const REFUSED = "Radient cannot accept this image. Remove it.";
	it("ONE line: failures first, then progress (saying when Send returns), then the count (D9)", () => {
		expect(stripSummary([])).toBe("");
		expect(stripSummary([chip("ready"), chip("ready")])).toBe(
			"2 images attached",
		);
		expect(stripSummary([chip("ready"), chip("uploading")])).toBe(
			"Uploading 1 image… Send is available when it finishes.",
		);
		expect(stripSummary([chip("uploading"), chip("preparing")])).toBe(
			"Uploading 2 images… Send is available when they finish.",
		);
		expect(stripSummary([chip("failed"), chip("uploading")])).toBe(
			"1 image didn't upload. Retry or remove it.",
		);
		expect(stripSummary([chip("failed", false, REFUSED), chip("failed")])).toBe(
			"2 images didn't upload. Retry or remove them.",
		);
	});
	it("a final reason shared by every failed chip is shown verbatim (D8): quota, refusal, expiry", () => {
		expect(
			stripSummary([
				chip("failed", false, QUOTA),
				chip("failed", false, QUOTA),
			]),
		).toBe(QUOTA);
		expect(stripSummary([chip("failed", false, REFUSED)])).toBe(REFUSED);
		expect(
			stripSummary([
				chip(
					"failed",
					false,
					"This image expired before it was sent. Remove it.",
				),
			]),
		).toBe("This image expired before it was sent. Remove it.");
	});
	it("final failures with DIFFERENT reasons get a neutral, correct line (not 'didn't upload')", () => {
		expect(
			stripSummary([
				chip("failed", false, QUOTA),
				chip("failed", false, REFUSED),
			]),
		).toBe("2 images can't be sent. Remove them to send.");
	});
	it("each non-ready chip carries a visible word, not colour alone", () => {
		expect(chipStateLabel(chip("preparing"))).toBe("Preparing…");
		expect(chipStateLabel(chip("uploading"))).toBe("Uploading…");
		expect(chipStateLabel(chip("failed"))).toBe("Failed");
		expect(chipStateLabel(chip("failed", false))).toBe("Can't send");
		expect(chipStateLabel(chip("ready"))).toBe(null);
	});
	it("says why Send is off when images block it, and nothing otherwise", () => {
		expect(sendBlockedReason([chip("ready")])).toBe(null);
		expect(sendBlockedReason([])).toBe(null);
		expect(sendBlockedReason([chip("uploading")])).toBe(
			"Send is available when the images finish uploading.",
		);
		expect(sendBlockedReason([chip("failed")])).toBe(
			"Retry or remove the images that didn't upload to send.",
		);
		expect(sendBlockedReason([chip("failed"), chip("failed", false)])).toBe(
			"Remove the images that can't be sent to send this message.",
		);
	});
	it("the expired-at-send chips block Send with a reason (so 'Retry send' is never shown)", async () => {
		const { draft } = setup();
		draft.add(["a"]);
		await flush();
		draft.markExpired();
		expect(sendBlockedReason(draft.chips())).toBe(
			"Remove the images that can't be sent to send this message.",
		);
	});
});

describe("chip control targets (design D7/D12, code R3-02)", () => {
	const { remove, retry } = chipControlRects(64, 44);
	const overlap = (a: typeof remove, b: typeof remove) =>
		Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
		Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
	it("both are full 44 pt squares and do not overlap at all", () => {
		expect([remove.width, remove.height, retry.width, retry.height]).toEqual([
			44, 44, 44, 44,
		]);
		expect(overlap(remove, retry)).toBe(0);
	});
	it("stay inside the strip padding, so the ScrollView clips neither", () => {
		const o = CHIP_CONTROL_OUTSET;
		for (const r of [remove, retry]) {
			expect(r.x).toBeGreaterThanOrEqual(-o);
			expect(r.y).toBeGreaterThanOrEqual(-o);
			expect(r.x + r.width).toBeLessThanOrEqual(64 + o);
		}
		// Retry's lower edge may extend past the 64 pt thumbnail into the chip's
		// state-word row; the chip column is 64 + label height, never clipped.
		expect(retry.y + retry.height).toBeLessThanOrEqual(64 + 24);
	});
});
