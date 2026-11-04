import { describe, expect, it } from "vitest";
import { installStageBDraftProof } from "../stage-b-draft-bootstrap";
import {
	STAGE_B_BUNDLE,
	type StageBProofConfig,
} from "../stage-b-draft-transport";

const config: StageBProofConfig = {
	flavor: "stage-b-draft-proof",
	bundleId: STAGE_B_BUNDLE,
	sourceSha: "a".repeat(40),
	nonce: "b".repeat(32),
	fixtureOrigin: "http://127.0.0.1:12345",
};

describe("Stage B synchronous transport installation", () => {
	it("patches fetch before returning the deferred seed initializer, without network I/O", () => {
		const original = globalThis.fetch;
		let requests = 0;
		const nativeFetch: typeof fetch = async () => {
			requests++;
			throw new Error("unexpected seed I/O");
		};
		globalThis.fetch = nativeFetch;
		try {
			const initialize = installStageBDraftProof(config);
			expect(globalThis.fetch).not.toBe(nativeFetch);
			expect(typeof initialize).toBe("function");
			expect(requests).toBe(0);
		} finally {
			globalThis.fetch = original;
		}
	});
});
