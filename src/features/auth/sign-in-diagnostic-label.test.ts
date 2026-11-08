import { describe, expect, it } from "vitest";
import { signInDiagnosticLabel } from "./sign-in-diagnostic-label";

describe("consumer-facing sign-in stages", () => {
	it("uses readable catalogue labels rather than transport identifiers", () => {
		expect(signInDiagnosticLabel("waiting-for-browser")).toBe(
			"Waiting for your browser",
		);
		expect(signInDiagnosticLabel("persisting")).toBe("Saving your sign-in");
		expect(signInDiagnosticLabel("signed-in")).toBe("Signed in");
		expect(signInDiagnosticLabel("unknown-private-value")).toBe(
			"Sign-in failed",
		);
	});
});
