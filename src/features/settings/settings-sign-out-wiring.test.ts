import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Node cannot import the real Settings screen's native styling stack. Pin the
 * actual wiring here; independent real-path QA/UX must exercise the dialog and
 * rendered pending frame, not infer pixels from these source assertions. */
const source = readFileSync(new URL("./settings.tsx", import.meta.url), "utf8");
describe("Settings owns sign-out feedback", () => {
	it("guards repeat confirmations synchronously and settles pending state on every exit", () => {
		expect(source).toContain("if (signingOutRef.current) return;");
		expect(source.indexOf("signingOutRef.current = true;")).toBeLessThan(
			source.indexOf("await signOut()"),
		);
		expect(source).toMatch(
			/finally\s*\{\s*signingOutRef.current = false;\s*setSigningOut\(false\);/,
		);
	});
	it("shows localized pending feedback and disables the sign-out control", () => {
		const button = source.slice(
			source.indexOf(
				"{/* -------------------------------------------------- sign out, delete */",
			),
			source.indexOf('label="Delete my Radient account"'),
		);
		expect(button).toContain('t("mobile.computers.signing_out")');
		expect(button).toContain("loading={signingOut}");
		expect(button).toContain("disabled={signingOut}");
	});
});
