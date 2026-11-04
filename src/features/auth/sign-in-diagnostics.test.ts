import { describe, expect, it } from "vitest";
import {
	appendSignInDiagnostic,
	type SignInDiagnostic,
	signInErrorClass,
} from "./sign-in-diagnostics";

describe("redacted sign-in diagnostics", () => {
	it("bounds the trail and refuses arbitrary stages and error names/messages", () => {
		let trail: SignInDiagnostic[] = [];
		for (let i = 0; i < 30; i++)
			trail = appendSignInDiagnostic(trail, "exchanging");
		expect(trail).toHaveLength(12);
		const error = new Error(
			"https://example.invalid/callback?code=PRIVATE&state=PRIVATE",
		);
		error.name = error.message;
		trail = appendSignInDiagnostic(
			trail,
			error.message,
			signInErrorClass(error),
		);
		expect(trail.at(-1)).toEqual({ stage: "failed", errorClass: "Error" });
		expect(JSON.stringify(trail)).not.toContain("PRIVATE");
	});
});
