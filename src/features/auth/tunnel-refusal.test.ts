import { describe, expect, it } from "vitest";
import { TunnelSessionError } from "@/connection/tunnel-session";
import { refusalFromError, tunnelSessionRelayError } from "./refusal";

const view = (
	failure: ConstructorParameters<typeof TunnelSessionError>[0],
	status?: number,
) => {
	const error = tunnelSessionRelayError(
		new TunnelSessionError(
			failure,
			"UNSAFE callback?code=PRIVATE&state=PRIVATE",
			status,
		),
	);
	return refusalFromError({
		error,
		surface: error.surface,
		detail: error.detail ?? null,
		retryAfterMs: null,
		subject: "Fixture computer",
	});
};
describe("tunnel ownership and app-side failure remedies", () => {
	it.each(["contract", "rejected"] as const)(
		"keeps %s errors in the app, with redacted support data",
		(failure) => {
			const refusal = view(failure);
			expect(refusal?.kind).toBe("diagnostic");
			expect(refusal?.remedy).toBeNull();
			expect(refusal?.detail).toBe(`TunnelSessionError · ${failure}`);
			expect(JSON.stringify(refusal)).not.toContain("PRIVATE");
			expect(JSON.stringify(refusal)).not.toContain("lop login");
		},
	);
	it.each([
		["billing", 402, "billing"],
		["disabled", 403, "enable"],
		["harness", 404, "Local Operator"],
	] as const)(
		"gives %s a concrete console setting, never a machine login command",
		(failure, status, instruction) => {
			const refusal = view(failure, status);
			expect(refusal?.kind).toBe("console");
			expect(refusal?.detail?.toLowerCase()).toContain(
				instruction.toLowerCase(),
			);
			expect(refusal?.remedy).toBeNull();
		},
	);
	it("does not invent device approval or direct an unavailable owner-scoped record to the console", () => {
		expect(view("account", 404)?.kind).toBe("account-mismatch");
		expect(view("account", 404)?.remedy).toBeNull();
		expect(view("oauth", 401)?.kind).toBe("sign-in");
	});
});
