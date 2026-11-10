import { describe, expect, it } from "vitest";
import {
	describeSecureStorageRefusal,
	isSecureStorageRefusal,
	SecureStorageStepError,
	secureStorageStep,
} from "./secure-storage-refusal";
import { StartupAuthorizationLifecycle } from "./startup-authorization";

/**
 * The sanitised keystore cause (PR #216 evidence): which step refused and the
 * platform code survive; the platform's message — which can quote a key or a
 * provider's text — never does.
 */

/* The shapes expo-secure-store produces: iOS `KeyChainException` becomes
 * `code: "ERR_KEY_CHAIN"` with the OSStatus in its reason; Android has its own
 * `ERR_*` codes. The secret-looking word is the redaction probe. */
const keychain = () =>
	Object.assign(
		new Error(
			"Calling the 'setValueWithKeyAsync' function has failed\n→ Caused by: hunter2-token (OSStatus -34018)",
		),
		{ code: "ERR_KEY_CHAIN" },
	);

describe("describeSecureStorageRefusal", () => {
	it("keeps the Expo code and the quoted OSStatus, and drops the message", () => {
		const refusal = describeSecureStorageRefusal(keychain(), "write");
		expect(refusal).toEqual({
			step: "write",
			kind: "Error",
			code: "ERR_KEY_CHAIN -34018",
		});
		expect(JSON.stringify(refusal)).not.toContain("hunter2");
	});

	it("refuses a code that is not identifier- or number-shaped", () => {
		const error = Object.assign(new Error("no status here"), {
			code: "token=abc123 secret",
		});
		expect(describeSecureStorageRefusal(error, "read").code).toBeNull();
		expect(
			describeSecureStorageRefusal(
				Object.assign(new Error("x"), { code: -25300 }),
				"read",
			).code,
		).toBe("-25300");
	});

	it("reduces a non-Error rejection to its type, never its text", () => {
		expect(describeSecureStorageRefusal("hunter2", "clear")).toEqual({
			step: "clear",
			kind: "string",
			code: null,
		});
	});

	it("takes the step from a tagged rejection over the fallback, also inside an AggregateError", async () => {
		const tagged = await secureStorageStep("read", async () => {
			throw keychain();
		}).catch((error: unknown) => error);
		expect(tagged).toBeInstanceOf(SecureStorageStepError);
		// The message is unchanged so `rejects.toThrow(<message>)` keeps reading it.
		expect((tagged as Error).message).toContain("setValueWithKeyAsync");
		expect(describeSecureStorageRefusal(tagged, "clear").step).toBe("read");
		const aggregate = new AggregateError([new Error("plain"), tagged], "both");
		expect(describeSecureStorageRefusal(aggregate, "clear")).toMatchObject({
			step: "read",
			code: "ERR_KEY_CHAIN -34018",
		});
	});

	it("only accepts records it could have built", () => {
		expect(
			isSecureStorageRefusal({ step: "clear", kind: "Error", code: null }),
		).toBe(true);
		expect(isSecureStorageRefusal(keychain())).toBe(false);
		expect(isSecureStorageRefusal({ step: "delete", kind: "Error" })).toBe(
			false,
		);
	});
});

describe("retire() tags each keystore step", () => {
	const lifecycle = (write: () => Promise<void>) =>
		new StartupAuthorizationLifecycle(
			{ read: async () => ({ version: 1, state: "revoked" }), write },
			async () => "generation-1",
		);

	it("a refused tombstone write is the write step", async () => {
		const owner = lifecycle(async () => {
			throw keychain();
		});
		const reason = await owner.retire().catch((error: unknown) => error);
		expect(describeSecureStorageRefusal(reason, "clear")).toEqual({
			step: "write",
			kind: "Error",
			code: "ERR_KEY_CHAIN -34018",
		});
	});

	it("a refused purge is the clear step", async () => {
		const owner = lifecycle(async () => {});
		owner.registerCleanup(async () => {
			throw keychain();
		});
		const reason = await owner.retire().catch((error: unknown) => error);
		expect(describeSecureStorageRefusal(reason, "write").step).toBe("clear");
	});
});
