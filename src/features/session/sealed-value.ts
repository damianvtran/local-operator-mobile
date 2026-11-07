/** Platform AES-GCM is supplied by the native adapter. This codec has no
 * filesystem or key access, so callers cannot accidentally persist its plaintext
 * input as a recovery fallback when encryption or authentication fails. */
export interface PrivateCipher {
	seal(plaintext: string, associatedData: string): Promise<string>;
	open(ciphertext: string, associatedData: string): Promise<string>;
}

export class SealedValue {
	constructor(private readonly cipher: PrivateCipher) {}

	async encode(context: string, plaintext: string): Promise<string> {
		return JSON.stringify({
			version: 1,
			ciphertext: await this.cipher.seal(plaintext, this.binding(context)),
		});
	}

	async decode(context: string, sealed: string): Promise<string> {
		const value: unknown = JSON.parse(sealed);
		if (
			typeof value !== "object" ||
			value === null ||
			!("version" in value) ||
			value.version !== 1 ||
			!("ciphertext" in value) ||
			typeof value.ciphertext !== "string" ||
			value.ciphertext.length === 0
		)
			throw new Error("private storage is not a supported encrypted record");
		return this.cipher.open(value.ciphertext, this.binding(context));
	}

	private binding(context: string): string {
		// Version, record family and exact storage key are authenticated, not just
		// filenames. Moving a valid ciphertext to another owner/key must fail.
		return JSON.stringify(["lo-mobile-private", 1, context]);
	}
}
