import { describe, expect, it, vi } from "vitest";

import { HubError } from "@/team-bridge/client";

import { createAttachmentDraft, type Prepared } from "./attachment-draft";

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
