import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
	pasteOfferVisible,
	probeClipboardImage,
	readClipboardImage,
} from "@/features/session/attach-rule";
import { composerCopy, pasteNothingLine } from "@/features/session/composer";

/**
 * Native image paste (TestFlight 578, item 7). A React Native field never hands a
 * pasted image to JS, so the composer offers the clipboard's image as a chip and
 * reads it through the attach sheet's own Paste path. These are the rules that
 * path rests on; the device read itself is `expo-clipboard`'s.
 */

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUg";

describe("reading the clipboard image onto the wire form", () => {
	it("turns the platform's data URL into the attachment the strip and send carry", async () => {
		const getImageAsync = vi.fn(async () => ({
			data: `data:image/png;base64,${PNG_B64}`,
		}));
		await expect(readClipboardImage({ getImageAsync })).resolves.toEqual({
			data_b64: PNG_B64,
			mime_type: "image/png",
		});
		// PNG, so a pasted screenshot is not quantised.
		expect(getImageAsync).toHaveBeenCalledWith({ format: "png" });
	});

	it("answers null — no attachment, the composer's pasteEmpty line — for an empty clipboard OR an iOS paste denial", async () => {
		/* `getImageAsync` resolves null for both; nothing distinguishes them, so the
		 * one null arm is all the caller can say. */
		await expect(
			readClipboardImage({ getImageAsync: async () => null }),
		).resolves.toBeNull();
	});

	it("lets a failed read THROW, so the composer says attachError instead of 'nothing there'", async () => {
		await expect(
			readClipboardImage({
				getImageAsync: async () => {
					throw new Error("pasteboard unavailable");
				},
			}),
		).rejects.toThrow("pasteboard unavailable");
	});
});

describe("probing for an image without reading it", () => {
	it("reports an image the clipboard advertises", async () => {
		await expect(
			probeClipboardImage({ hasImageAsync: async () => true }),
		).resolves.toBe(true);
	});

	it("treats no image, and a probe that fails, as no offer — never an error", async () => {
		await expect(
			probeClipboardImage({ hasImageAsync: async () => false }),
		).resolves.toBe(false);
		await expect(
			probeClipboardImage({
				hasImageAsync: async () => {
					throw new Error("denied");
				},
			}),
		).resolves.toBe(false);
	});
});

describe("when the paste chip shows", () => {
	const base = {
		kind: "native" as const,
		focused: true,
		hasImage: true,
		consumed: false,
	};

	it("shows on native while composing with an image on the clipboard", () => {
		expect(pasteOfferVisible(base)).toBe(true);
	});

	it("does not show without an image, unfocused, once taken, or on web (the paste event owns it)", () => {
		expect(pasteOfferVisible({ ...base, hasImage: false })).toBe(false);
		expect(pasteOfferVisible({ ...base, focused: false })).toBe(false);
		expect(pasteOfferVisible({ ...base, consumed: true })).toBe(false);
		expect(pasteOfferVisible({ ...base, kind: "web" })).toBe(false);
	});
});

describe("the chip is a door into the ONE attach path", () => {
	const COMPOSER = readFileSync(
		new URL("./components/composer.tsx", import.meta.url),
		"utf8",
	);
	const ATTACH = readFileSync(new URL("./attach.ts", import.meta.url), "utf8");

	it("runs the attach sheet's Paste source rather than a second clipboard read", () => {
		const chip = COMPOSER.slice(
			COMPOSER.indexOf("const pasteChip"),
			COMPOSER.indexOf("testID={CONTROL.composerPasteImage}"),
		);
		expect(chip).toContain('onAttach("paste", "offer")');
		expect(chip).not.toMatch(/getImageAsync|pasteImage\(/);
	});

	it("routes the native sheet read through the tested reader", () => {
		expect(ATTACH).toContain("return readClipboardImage(Clipboard);");
	});

	it("keeps the web paste EVENT listener (web builds paste the browser's file)", () => {
		expect(COMPOSER).toContain('node.addEventListener("paste", onPaste)');
	});
});

describe("what an empty paste says, per door (UX review round 1, U3)", () => {
	it("names the iOS denial on the chip, which is only offered while an image is there", () => {
		const line = pasteNothingLine("offer", "ios");
		expect(line).toBe(
			"Paste wasn’t allowed. Tap the paperclip, then Paste image, and choose “Allow Paste”.",
		);
		// Not the sheet's line: "Copy an image" sends the reader after an image
		// they already copied.
		expect(line).not.toBe(composerCopy().pasteEmpty);
	});

	it("keeps the outcome-only line for the sheet's Paste row and for Android", () => {
		// The sheet cannot tell an empty clipboard from a denial; Android has no
		// paste prompt, so a chip miss there is the image having gone.
		expect(pasteNothingLine("sheet", "ios")).toBe(composerCopy().pasteEmpty);
		expect(pasteNothingLine("offer", "android")).toBe(
			composerCopy().pasteEmpty,
		);
		expect(pasteNothingLine("sheet", "web")).toBe(composerCopy().pasteEmpty);
	});
});
