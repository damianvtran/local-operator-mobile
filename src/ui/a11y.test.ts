import { describe, expect, it } from "vitest";

import {
	CONTROL,
	EMPTY,
	IDENTIFIERS,
	isKnownIdentifier,
	REGION,
	SCREEN,
	STATE_MARKER,
	SURFACE,
	state,
} from "@/ui/a11y";

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The groups that DECLARE an id, as opposed to the marker table, which maps a state
 *  to one (`STATE_MARKER`'s own note). */
const DECLARED = [
	...Object.values(SCREEN),
	...Object.values(EMPTY),
	...Object.values(CONTROL),
	...Object.values(SURFACE),
	...Object.values(REGION),
];

const MARKER_IDS = Object.values(STATE_MARKER).flatMap((states) =>
	Object.values(states),
);

describe("accessibility identifiers", () => {
	it("are unique across the declaring groups", () => {
		// These are the Maestro selectors (ADR 0003): a duplicate makes two flows
		// address the same element, and the failure looks like a flaky test rather
		// than a naming mistake.
		expect(new Set(DECLARED).size).toBe(DECLARED.length);
	});

	it("keeps every state marker on a declared id or a new one of its own", () => {
		// The marker table MAY name an id another group declares (`session/empty` is
		// `SURFACE.sessionTranscriptEmpty`): that is the mapping working. What it must not
		// do is name an id twice, or one no selector list carries.
		expect(new Set(MARKER_IDS).size).toBe(MARKER_IDS.length);
		for (const id of MARKER_IDS) {
			expect(IDENTIFIERS).toContain(id);
		}
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
