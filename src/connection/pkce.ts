/* Hoisted: `base64Url` runs on every PKCE pair and on every UUID minted. */
const BASE64_PLUS = /\+/g;
const BASE64_SLASH = /\//g;
const BASE64_PADDING = /=+$/;
/** The console's `code_challenge` rule: exactly 43 base64url characters. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The control plane's `code_verifier` rule (`session.go:131`). */
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * PKCE (RFC 7636) and the randomness behind it.
 *
 * The verifier length and encoding match the desktop client's
 * (`local_operator/providers/oauth/pkce.py`: 96 random bytes → base64url), and
 * the two gates that check it are strict — the console requires
 * `code_challenge` to match `^[A-Za-z0-9_-]{43}$` and the control plane requires
 * `code_verifier` to match `^[A-Za-z0-9._~-]{43,128}$`
 * (`radient-ml:internal/tunnels/session.go:131`). So the verifier is generated to
 * that alphabet and the challenge is exactly 43 base64url characters, not
 * "whatever the platform's encoder produced".
 *
 * Randomness comes from `expo-crypto` on a device and from WebCrypto in Node.
 * Both are injectable, because a test that needs a deterministic verifier must
 * not have to stub a global.
 */

/** The verifier's random input, in bytes. Above the RFC's 32-byte minimum by a
 *  wide margin, which is the desktop client's choice and is free. */
export const VERIFIER_BYTES = 96;

/** The `code_verifier` alphabet (`session.go:131`). */
const VERIFIER_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-";

export interface CryptoDeps {
	/** Cryptographically secure bytes. Defaults to WebCrypto, then to
	 *  `expo-crypto`. */
	randomBytes?: (count: number) => Uint8Array;
	/** SHA-256 of the UTF-8 bytes of `input`. Defaults to WebCrypto, then to
	 *  `expo-crypto`. */
	sha256?: (input: Uint8Array) => Promise<Uint8Array>;
}

export class CryptoUnavailableError extends Error {
	override readonly name = "CryptoUnavailableError";
}

function webCrypto(): Crypto | undefined {
	const candidate = (globalThis as { crypto?: Crypto }).crypto;
	return candidate && typeof candidate.getRandomValues === "function"
		? candidate
		: undefined;
}

/** The subset of `expo-crypto` this module uses. Declared explicitly rather than
 *  inferred, because the module is imported lazily and a self-referential
 *  `ReturnType<typeof …>` on its own loader is not a type TypeScript accepts. */
interface ExpoCryptoModule {
	getRandomBytes?: (count: number) => Uint8Array;
	getRandomBytesAsync?: (count: number) => Promise<Uint8Array>;
	digestStringAsync?: (
		algorithm: string,
		data: string,
		options?: { encoding?: string },
	) => Promise<string>;
	CryptoDigestAlgorithm?: { SHA256?: string };
	CryptoEncoding?: { BASE64?: string; HEX?: string };
}

async function expoCryptoModule(): Promise<ExpoCryptoModule> {
	return (await import("expo-crypto")) as unknown as ExpoCryptoModule;
}

async function defaultRandomBytes(count: number): Promise<Uint8Array> {
	const web = webCrypto();
	if (web) {
		const buffer = new Uint8Array(count);
		web.getRandomValues(buffer);
		return buffer;
	}
	const module = await expoCryptoModule();
	if (module.getRandomBytesAsync)
		return await module.getRandomBytesAsync(count);
	if (module.getRandomBytes) return module.getRandomBytes(count);
	throw new CryptoUnavailableError(
		"no source of random bytes on this runtime; PKCE cannot be generated safely",
	);
}

async function defaultSha256(input: Uint8Array): Promise<Uint8Array> {
	const web = webCrypto();
	if (web?.subtle) {
		return new Uint8Array(
			await web.subtle.digest("SHA-256", input as unknown as ArrayBuffer),
		);
	}
	const module = await expoCryptoModule();
	if (!module.digestStringAsync) {
		throw new CryptoUnavailableError(
			"no SHA-256 on this runtime; PKCE cannot be generated safely",
		);
	}
	/* expo-crypto only digests strings, and the verifier is ASCII by construction,
	 * so the round trip through text is lossless here. */
	const hex = await module.digestStringAsync(
		module.CryptoDigestAlgorithm?.SHA256 ?? "SHA-256",
		new TextDecoder().decode(input),
		{ encoding: module.CryptoEncoding?.HEX ?? "hex" },
	);
	return hexToBytes(hex);
}

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.trim();
	const out = new Uint8Array(clean.length / 2);
	for (let index = 0; index < out.length; index += 1) {
		out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
	}
	return out;
}

/** base64url with no padding, as RFC 7636 requires. */
export function base64Url(bytes: Uint8Array): string {
	const base64 =
		typeof btoa === "function"
			? btoa(String.fromCharCode(...bytes))
			: (
					globalThis as unknown as {
						Buffer: {
							from(input: Uint8Array): { toString(encoding: string): string };
						};
					}
				).Buffer.from(bytes).toString("base64");
	return base64
		.replace(BASE64_PLUS, "-")
		.replace(BASE64_SLASH, "_")
		.replace(BASE64_PADDING, "");
}

/** Maps random bytes onto the verifier's alphabet, uniformly enough for a
 *  96-byte secret. Rejection sampling keeps the distribution flat: a plain
 *  modulo would bias the first few characters, and this is a credential. */
function randomString(bytes: Uint8Array, alphabet: string): string {
	const limit = Math.floor(256 / alphabet.length) * alphabet.length;
	let out = "";
	for (const byte of bytes) {
		if (byte >= limit) continue;
		out += alphabet[byte % alphabet.length];
	}
	return out;
}

export interface PkcePair {
	verifier: string;
	challenge: string;
	method: "S256";
}

/**
 * Generates a PKCE pair.
 *
 * The verifier's alphabet and length are checked before it is returned, because
 * the console and the control plane both reject a malformed one and the failure
 * would otherwise surface as an opaque `invalid_request` in a browser sheet.
 */
export async function createPkcePair(deps: CryptoDeps = {}): Promise<PkcePair> {
	const randomBytes = deps.randomBytes;
	const bytes = randomBytes
		? randomBytes(VERIFIER_BYTES)
		: await defaultRandomBytes(VERIFIER_BYTES);
	/* Oversample when rejection sampling drops bytes, so the verifier always has
	 * enough material to exceed the 43-character minimum. */
	let verifier = randomString(bytes, VERIFIER_ALPHABET);
	let guard = 0;
	while (verifier.length < 43 && guard < 8) {
		guard += 1;
		const extra = randomBytes
			? randomBytes(VERIFIER_BYTES)
			: await defaultRandomBytes(VERIFIER_BYTES);
		verifier += randomString(extra, VERIFIER_ALPHABET);
	}
	verifier = verifier.slice(0, 128);
	if (!VERIFIER_PATTERN.test(verifier)) {
		throw new CryptoUnavailableError(
			"generated a code_verifier outside the accepted alphabet",
		);
	}
	const digest = deps.sha256
		? await deps.sha256(new TextEncoder().encode(verifier))
		: await defaultSha256(new TextEncoder().encode(verifier));
	const challenge = base64Url(digest);
	if (!CHALLENGE_PATTERN.test(challenge)) {
		throw new CryptoUnavailableError(
			"generated a code_challenge the console will refuse",
		);
	}
	return { verifier, challenge, method: "S256" };
}

/** A URL-safe random state value. The console requires non-empty and ≤ 1024
 *  (`session.go:131`). */
export async function randomState(
	deps: CryptoDeps = {},
	bytes = 32,
): Promise<string> {
	const material = deps.randomBytes
		? deps.randomBytes(bytes)
		: await defaultRandomBytes(bytes);
	return base64Url(material);
}

/** A UUID for a command id, from the platform's own generator where it exists. */
export function randomUuid(deps: CryptoDeps = {}): string {
	const web = webCrypto() as
		| (Crypto & { randomUUID?: () => string })
		| undefined;
	if (web?.randomUUID) return web.randomUUID();
	if (deps.randomBytes) {
		const bytes = deps.randomBytes(16);
		/* RFC 4122 version 4, so the value is a UUID the relay's validator accepts
		 * rather than merely random hex. */
		bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
		bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
		const hex = Array.from(bytes, (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
	throw new CryptoUnavailableError(
		"no UUID generator on this runtime; a command id cannot be created safely",
	);
}
