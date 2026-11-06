import { describe, expect, it } from "vitest";
import {
	type StageBCandidateIdentity,
	stageBCandidateSource,
	stageBShouldConsumeCandidate,
	verifyStageBCandidate,
} from "./stage-b-candidate.ts";

const expected = {
	sourceSha: "a".repeat(40),
	bundleId: "com.localoperator.mobile.stageb",
	flavor: "stage-b-draft-proof",
};
const good: StageBCandidateIdentity = {
	...expected,
	nonce: "0123456789abcdef0123456789abcdef",
};
describe("a prebuilt candidate is used only when its identity is proven", () => {
	it("accepts a candidate from the same frozen head", () => {
		expect(verifyStageBCandidate(good, expected).ok).toBe(true);
	});
	it("refuses a candidate built from another source", () => {
		const result = verifyStageBCandidate(
			{ ...good, sourceSha: "b".repeat(40) },
			expected,
		);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("source SHA mismatch");
	});
	it("refuses a candidate with another bundle id or flavor", () => {
		expect(
			verifyStageBCandidate(
				{ ...good, bundleId: "com.example.other" },
				expected,
			).reason,
		).toContain("bundle id mismatch");
		expect(
			verifyStageBCandidate({ ...good, flavor: "stage-b-setup" }, expected)
				.reason,
		).toContain("flavor mismatch");
	});
	it("refuses an unreadable candidate or a nonce of the wrong shape", () => {
		expect(verifyStageBCandidate(null, expected).reason).toContain(
			"no readable candidate identity",
		);
		expect(
			verifyStageBCandidate({ ...good, nonce: "not-a-nonce" }, expected).reason,
		).toContain("fixture's shape");
	});
	it("consumes by default and only the literal 'false' turns it off", () => {
		// The native lane's question is whether the frozen source behaves, not
		// whether it can be built twice — so reuse is the default and the flag is
		// an off-switch. Anything else (including unset) tries and falls back.
		expect(stageBShouldConsumeCandidate(undefined).consume).toBe(true);
		expect(stageBShouldConsumeCandidate("true").consume).toBe(true);
		expect(stageBShouldConsumeCandidate("").consume).toBe(true);
		const off = stageBShouldConsumeCandidate("false");
		expect(off.consume).toBe(false);
		expect(off.reason).toContain("STAGE_B_CONSUME_CANDIDATE=false");
	});
	it("records which half of the receipt was paid for, and the refusal falls back to building", () => {
		expect(stageBCandidateSource(true)).toBe("prebuilt");
		expect(stageBCandidateSource(false)).toBe("built");
		// A refused candidate is never consumed: the attempt builds.
		const refused = verifyStageBCandidate(
			{ ...good, sourceSha: "c".repeat(40) },
			expected,
		);
		expect(stageBCandidateSource(refused.ok)).toBe("built");
	});
});
