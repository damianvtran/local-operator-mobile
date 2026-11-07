import { describe, expect, it, vi } from "vitest";
import {
	consumePickerAsset,
	isOwnedPickerCacheFile,
	PickerPrivacy,
} from "./picker-privacy";

const cache = "file:///sandbox/Library/Caches/";
describe("native picker cache ownership", () => {
	it("owns only exact direct children of this install's ImagePicker cache", () => {
		expect(isOwnedPickerCacheFile(`${cache}ImagePicker/photo.jpg`, cache)).toBe(
			true,
		);
		expect(
			isOwnedPickerCacheFile(`${cache}ImagePicker/photo%20one.jpg`, cache),
		).toBe(true);
	});
	it.each([
		"ph://photo-original",
		"content://photos/original",
		"https://example.invalid/photo.jpg",
		"file:///sandbox/Documents/user.jpg",
		`${cache}ImagePicker-other/photo.jpg`,
		`${cache}ImagePicker/nested/photo.jpg`,
		`${cache}ImagePicker/../user.jpg`,
		`${cache}ImagePicker/%2e%2e/user.jpg`,
		`${cache}ImagePicker/extra%2Fphoto.jpg`,
		`${cache}ImagePicker/extra%5cphoto.jpg`,
		`${cache}ImagePicker/photo.jpg?x=1`,
		`${cache}ImagePicker/photo.jpg#x`,
		`${cache}ImagePicker/%00.jpg`,
		`${cache}ImagePicker/%zz.jpg`,
	])("refuses unowned or ambiguous URI %s", (uri) => {
		expect(isOwnedPickerCacheFile(uri, cache)).toBe(false);
	});
	it("awaits deletion before returning captured image bytes and preserves source MIME rules", async () => {
		let release = () => {};
		const remove = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		let returned = false;
		const result = consumePickerAsset(
			{
				uri: `${cache}ImagePicker/copy.jpg`,
				base64: "/9j/test",
				mimeType: "image/png",
			},
			remove,
		).then((value) => {
			returned = true;
			return value;
		});
		await Promise.resolve();
		expect(returned).toBe(false);
		release();
		expect(await result).toEqual({
			data_b64: "/9j/test",
			mime_type: "image/jpeg",
		});
		expect(remove).toHaveBeenCalledOnce();
	});
	it("cleans invalid image bytes and refuses success after deletion failure", async () => {
		const remove = vi.fn(async () => {});
		await expect(
			consumePickerAsset(
				{ uri: `${cache}ImagePicker/copy.jpg`, base64: "" },
				remove,
			),
		).rejects.toThrow("could not be read");
		expect(remove).toHaveBeenCalledOnce();
		await expect(
			consumePickerAsset(
				{ uri: `${cache}ImagePicker/copy.jpg`, base64: "/9j/test" },
				async () => {
					throw new Error("deletion denied");
				},
			),
		).rejects.toThrow("deletion denied");
	});
	it("drains an interrupted picker and refuses its late selection across owner withdrawal", async () => {
		const privacy = new PickerPrivacy();
		let release = () => {};
		const cleanup = vi.fn();
		const selected = privacy.run(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			cleanup();
			return "old image";
		});
		privacy.withdraw();
		let drained = false;
		const draining = privacy.drain().then(() => {
			drained = true;
		});
		await Promise.resolve();
		expect(drained).toBe(false);
		await expect(privacy.run(async () => "new image")).rejects.toThrow(
			"could not be read",
		);
		release();
		await expect(selected).rejects.toThrow("could not be read");
		await draining;
		expect(cleanup).toHaveBeenCalledOnce();
		privacy.reopen();
		expect(await privacy.run(async () => "new owner's image")).toBe(
			"new owner's image",
		);
	});
});
