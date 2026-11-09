import type { webcrypto as CryptoTypes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { nativePrivateCipher } from "./native-private-cipher";

/** Execute the production cipher adapter, not a replacement PrivateCipher.
 * Expo's AES surface is backed by Node WebCrypto here: async key import,
 * Uint8Array inputs, combined base64 output and authenticated additionalData
 * mirror the inspected SDK 57 JS/Swift contract. This is NOT native bridge proof. */
vi.mock("expo-crypto", async () => {
	const { webcrypto } = await import("node:crypto");
	class Data {
		constructor(readonly bytes: Uint8Array) {}
		static fromCombined(encoded: string) {
			return new Data(Buffer.from(encoded, "base64"));
		}
		async combined(format: string) {
			expect(format).toBe("base64");
			return Buffer.from(this.bytes).toString("base64");
		}
	}
	return {
		AESEncryptionKey: {
			import: async (encoded: string, format: string) => {
				expect(format).toBe("hex");
				return webcrypto.subtle.importKey(
					"raw",
					Buffer.from(encoded, "hex"),
					"AES-GCM",
					false,
					["encrypt", "decrypt"],
				);
			},
		},
		AESSealedData: Data,
		aesEncryptAsync: async (
			plaintext: Uint8Array,
			key: CryptoTypes.CryptoKey,
			options: { nonce: { length: number }; additionalData: Uint8Array },
		) => {
			expect(plaintext).toBeInstanceOf(Uint8Array);
			expect(options.nonce).toEqual({ length: 12 });
			const nonce = webcrypto.getRandomValues(new Uint8Array(12));
			const ciphertext = await webcrypto.subtle.encrypt(
				{ name: "AES-GCM", iv: nonce, additionalData: options.additionalData },
				key,
				plaintext,
			);
			return new Data(Buffer.concat([nonce, new Uint8Array(ciphertext)]));
		},
		aesDecryptAsync: async (
			sealed: Data,
			key: CryptoTypes.CryptoKey,
			options: { additionalData: Uint8Array },
		) =>
			new Uint8Array(
				await webcrypto.subtle.decrypt(
					{
						name: "AES-GCM",
						iv: sealed.bytes.slice(0, 12),
						additionalData: options.additionalData,
					},
					key,
					sealed.bytes.slice(12),
				),
			),
	};
});

describe("actual native private cipher adapter against the SDK-shaped port", () => {
	it("roundtrips long Unicode and a 341 KiB binary-sized base64 payload", async () => {
		const cipher = await nativePrivateCipher(
			"11".repeat(32),
			"synthetic-installation",
		);
		// Synthetic bytes exercise serialization size, not PNG decoding or a photo.
		const plaintext = JSON.stringify({
			text: "Draft 🧭 اردو 中文\n".repeat(100),
			image: Buffer.alloc(341 * 1024).toString("base64"),
		});
		const ciphertext = await cipher.seal(plaintext, "device/synthetic-record");
		expect(ciphertext).not.toContain("Draft");
		expect(await cipher.open(ciphertext, "device/synthetic-record")).toBe(
			plaintext,
		);
		await expect(
			cipher.open(ciphertext, "device/other-record"),
		).rejects.toThrow();
		const other = await nativePrivateCipher(
			"11".repeat(32),
			"different-installation",
		);
		await expect(
			other.open(ciphertext, "device/synthetic-record"),
		).rejects.toThrow();
	});
});
