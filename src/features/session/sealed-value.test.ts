import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type PrivateCipher, SealedValue } from "./sealed-value";

/** Real authenticated encryption, not an identity cipher: these negatives must
 * discriminate a missing/wrong AAD binding and corrupted ciphertext. Native
 * Expo crypto is a separate platform gate; Node does not prove the native bridge. */
async function fixture() {
	const key = await webcrypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
	const cipher: PrivateCipher = {
		async seal(plaintext, associatedData) {
			const iv = webcrypto.getRandomValues(new Uint8Array(12));
			const encrypted = await webcrypto.subtle.encrypt(
				{
					name: "AES-GCM",
					iv,
					additionalData: new TextEncoder().encode(associatedData),
				},
				key,
				new TextEncoder().encode(plaintext),
			);
			return Buffer.concat([iv, Buffer.from(encrypted)]).toString("base64");
		},
		async open(ciphertext, associatedData) {
			const data = Buffer.from(ciphertext, "base64");
			return new TextDecoder().decode(
				await webcrypto.subtle.decrypt(
					{
						name: "AES-GCM",
						iv: data.subarray(0, 12),
						additionalData: new TextEncoder().encode(associatedData),
					},
					key,
					data.subarray(12),
				),
			);
		},
	};
	return new SealedValue(cipher);
}

describe("sealed native private values", () => {
	it("stores no plaintext and randomizes repeated writes", async () => {
		const store = await fixture();
		const secret = "An unfinished sentence with private attached content";
		const first = await store.encode("owner-a/draft-a", secret);
		const second = await store.encode("owner-a/draft-a", secret);
		expect(first).not.toContain(secret);
		expect(first).not.toEqual(second);
		expect(await store.decode("owner-a/draft-a", first)).toBe(secret);
	});
	it("cannot move ciphertext between owners, backends or draft keys", async () => {
		const store = await fixture();
		const saved = await store.encode(
			"account-a/tenant-a/relay-a/draft-a",
			"private",
		);
		for (const context of [
			"account-b/tenant-a/relay-a/draft-a",
			"account-a/tenant-b/relay-a/draft-a",
			"account-a/tenant-a/relay-b/draft-a",
			"account-a/tenant-a/relay-a/draft-b",
		]) {
			await expect(store.decode(context, saved)).rejects.toThrow();
		}
	});
	it("refuses a different install key and any ciphertext modification", async () => {
		const store = await fixture();
		const saved = await store.encode("draft-a", "private");
		await expect((await fixture()).decode("draft-a", saved)).rejects.toThrow();
		const changed = JSON.parse(saved);
		const bytes = Buffer.from(changed.ciphertext, "base64");
		bytes[15] = (bytes[15] ?? 0) ^ 1;
		changed.ciphertext = bytes.toString("base64");
		await expect(
			store.decode("draft-a", JSON.stringify(changed)),
		).rejects.toThrow();
	});
	it.each([
		"plaintext legacy draft",
		'{"version":1,"value":"legacy"}',
		'{"version":2,"ciphertext":"unknown"}',
		"{interrupted",
	])("never migrates untrusted or incomplete bytes (%s)", async (saved) => {
		await expect((await fixture()).decode("draft-a", saved)).rejects.toThrow();
	});
});
