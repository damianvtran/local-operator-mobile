import { describe, expect, it } from "vitest";
import { initialsOf } from "@/ui/components/avatar";
import { settingsAccountInitialsSource } from "./account-title";

/* What Settings' account avatar paints: `initialsOf` over the source this
 * module picks. Composed exactly as `settings.tsx` composes it, so the
 * assertion is on the two letters a user sees, not on an intermediate. */
const avatarInitials = (label: string) =>
	initialsOf(settingsAccountInitialsSource(label));

describe("Settings' account avatar takes its initials from the person, not the mail provider (PR #262 D1)", () => {
	it("reads only an email's local part", () => {
		/* On fe52e380 these were QE, FE and DG: the domain supplied the second letter. */
		expect(avatarInitials("qa@example.invalid")).toBe("QA");
		expect(avatarInitials("first.last@example.com")).toBe("FL");
		expect(avatarInitials("damian@gominerva.com")).toBe("DA");
	});

	it("leaves a display name, and an address with no local part, as they were", () => {
		expect(avatarInitials("Damian Tran")).toBe("DT");
		expect(avatarInitials("Damian")).toBe("DA");
		expect(settingsAccountInitialsSource("@example.com")).toBe("@example.com");
	});
});
