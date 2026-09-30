import { describe, expect, it } from "vitest";

import { IDENTIFIERS, isKnownIdentifier, state } from "@/ui/a11y";

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("accessibility identifiers", () => {
	it("are unique across the whole namespace", () => {
		// These are the Maestro selectors (ADR 0003): a duplicate makes two flows
		// address the same element, and the failure looks like a flaky test rather
		// than a naming mistake.
		expect(new Set(IDENTIFIERS).size).toBe(IDENTIFIERS.length);
	});

	it("are kebab-case, so a selector is predictable from its name", () => {
		for (const id of IDENTIFIERS) {
			expect(id).toMatch(KEBAB);
		}
	});
});

/* Maestro's own `${VAR}` template syntax, inside plain strings: it is what the
 * flows contain, not a template literal that lost its backticks. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: Maestro template syntax
const TEMPLATE = "session-row-${ID}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: Maestro template syntax
const OTHER_TEMPLATE = "computer-row-${HOST}";

describe("isKnownIdentifier", () => {
	const statics = ["sessions-screen"];
	const families = ["session-row-"];

	it("accepts a static identifier and refuses a near miss", () => {
		expect(isKnownIdentifier("sessions-screen", families, statics)).toBe(true);
		expect(isKnownIdentifier("sessions-screens", families, statics)).toBe(
			false,
		);
	});

	it("resolves a template and a concrete instance through the family prefix", () => {
		expect(isKnownIdentifier(TEMPLATE, families, statics)).toBe(true);
		expect(
			isKnownIdentifier("session-row-6714def86197", families, statics),
		).toBe(true);
	});

	it("does not let the bare prefix, or another family, stand for a member", () => {
		expect(isKnownIdentifier("session-row-", families, statics)).toBe(false);
		expect(isKnownIdentifier(OTHER_TEMPLATE, families, statics)).toBe(false);
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
