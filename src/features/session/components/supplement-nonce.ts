import { getRandomBytes } from "expo-crypto";

/**
 * A per-frame nonce, within `NONCE_MAX_CHARS` (`contract.py`): 32 hex characters
 * of CSPRNG output, minted per MOUNT — the component keeps it in a ref — so two
 * frames on one screen have two nonces and one frame's messages can never move
 * another's state.
 *
 * WHY THIS IS ITS OWN MODULE rather than a function in `supplements.ts`: the
 * mapping module is pure and unit-tested under Node (`vitest.config.ts`'s own
 * rule — anything a test touches must load without a native host), and
 * `expo-crypto`'s native entry does not load there (`__DEV__` is undefined;
 * `install-id.test.ts` mocks the package for exactly this reason). Keeping the
 * CSPRNG import in a module that only the two frame hosts import leaves the
 * mapping module testable and the mock unnecessary everywhere else.
 */
export function mintNonce(): string {
	const bytes = getRandomBytes(16);
	let out = "";
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
	return out;
}
