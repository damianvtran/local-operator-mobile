import type { PrivateCipher } from "./sealed-value";

/** The platform implementation owns nonce generation and authentication tags.
 * Key material is a small SecureStore item, never the megabyte-sized draft. This
 * factory is native-only and lazy so a web/Node import cannot touch a keystore. */
export async function nativePrivateCipher(
	keyHex: string,
	installId: string,
): Promise<PrivateCipher> {
	const { AESEncryptionKey, AESSealedData, aesEncryptAsync, aesDecryptAsync } =
		await import("expo-crypto");
	const key = await AESEncryptionKey.import(keyHex, "hex");
	return {
		async seal(plaintext, associatedData) {
			const sealed = await aesEncryptAsync(
				new TextEncoder().encode(plaintext),
				key,
				{
					nonce: { length: 12 },
					additionalData: new TextEncoder().encode(
						JSON.stringify([installId, associatedData]),
					),
				},
			);
			return sealed.combined("base64");
		},
		async open(ciphertext, associatedData) {
			const plaintext = await aesDecryptAsync(
				AESSealedData.fromCombined(ciphertext),
				key,
				{
					additionalData: new TextEncoder().encode(
						JSON.stringify([installId, associatedData]),
					),
				},
			);
			return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
		},
	};
}
