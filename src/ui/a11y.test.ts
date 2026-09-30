import { describe, expect, it } from "vitest";

import { CONTROL, LIVE_REGION, ROLE, SCREEN, state } from "@/ui/a11y";

describe("accessibility identifiers", () => {
	it("are unique across every namespace", () => {
		// These are the Maestro selectors (ADR 0003): a duplicate makes two flows
		// address the same element, and the failure looks like a flaky test rather
		// than a naming mistake.
		const all = [...Object.values(SCREEN), ...Object.values(CONTROL)];
		expect(new Set(all).size).toBe(all.length);
	});

	it("are kebab-case, so a selector is predictable from its name", () => {
		for (const id of [...Object.values(SCREEN), ...Object.values(CONTROL)]) {
			expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
	});

	it("gives every screen its own identifier", () => {
		expect(Object.values(SCREEN).length).toBe(
			new Set(Object.values(SCREEN)).size,
		);
		expect(SCREEN.sessions).toBe("sessions-screen");
	});
});

describe("state()", () => {
	it("omits what the caller did not state, rather than sending undefined", () => {
		// React Native treats an explicitly-undefined accessibility state as a value
		// on some platforms, which is how a control starts announcing "selected".
		expect(state({ disabled: true })).toEqual({ disabled: true });
		expect(state({ busy: false })).toEqual({ busy: false });
		expect(Object.keys(state({}))).toHaveLength(0);
	});
});

describe("roles and live regions", () => {
	it("uses the platform's own role names", () => {
		expect(ROLE.button).toBe("button");
		expect(ROLE.radiogroup).toBe("radiogroup");
	});

	it("announces streaming politely, never assertively", () => {
		expect(LIVE_REGION.polite).toBe("polite");
		expect(LIVE_REGION.assertive).toBe("assertive");
	});
});
