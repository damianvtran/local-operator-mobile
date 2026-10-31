import { describe, expect, it } from "vitest";

import { formatMessage, parseMessage } from "@/i18n";

/**
 * The parser/renderer contract, pinned case by case.
 *
 * These are the behaviours the catalogues rely on. A message that stops parsing,
 * a plural that stops selecting the right branch or a `#` that silently renders
 * the wrong number is a wrong sentence on a screen — which is why the subset is
 * asserted rather than assumed.
 */
describe("the ICU subset", () => {
	it("substitutes a plain placeholder", () => {
		const message = parseMessage("Delete {name}? The row goes.");
		expect(formatMessage(message, { name: "payments" }, "en")).toBe(
			"Delete payments? The row goes.",
		);
	});

	it("selects English plural branches, including zero", () => {
		const message = parseMessage(
			"{count, plural, one {# wake} other {# wakes}}",
		);
		expect(formatMessage(message, { count: 0 }, "en")).toBe("0 wakes");
		expect(formatMessage(message, { count: 1 }, "en")).toBe("1 wake");
		expect(formatMessage(message, { count: 2 }, "en")).toBe("2 wakes");
	});

	it("honours an explicit =N branch before the plural category", () => {
		const message = parseMessage(
			"{count, plural, =0 {none} one {# thing} other {# things}}",
		);
		expect(formatMessage(message, { count: 0 }, "en")).toBe("none");
		expect(formatMessage(message, { count: 1 }, "en")).toBe("1 thing");
	});

	it("selects a branch by name and falls back to other", () => {
		const message = parseMessage(
			"{family, select, wakes {wakes} other {monitors}}",
		);
		expect(formatMessage(message, { family: "wakes" }, "en")).toBe("wakes");
		expect(formatMessage(message, { family: "monitors" }, "en")).toBe(
			"monitors",
		);
		expect(formatMessage(message, { family: "anything" }, "en")).toBe(
			"monitors",
		);
	});

	it("keeps `#` bound to the innermost plural through a nested select", () => {
		const message = parseMessage(
			"{count, plural, one {# item, {kind, select, a {set A} other {set B}}} other {# items, {kind, select, a {set A} other {set B}}}}",
		);
		expect(formatMessage(message, { count: 1, kind: "a" }, "en")).toBe(
			"1 item, set A",
		);
		expect(formatMessage(message, { count: 3, kind: "b" }, "en")).toBe(
			"3 items, set B",
		);
	});

	it("treats `#` outside a plural as the literal character", () => {
		const message = parseMessage("Issue #12 is open");
		expect(formatMessage(message, {}, "en")).toBe("Issue #12 is open");
	});

	it("keeps apostrophes literal", () => {
		const message = parseMessage("That folder doesn't exist on this computer.");
		expect(formatMessage(message, {}, "en")).toBe(
			"That folder doesn't exist on this computer.",
		);
	});

	it.each(["it''s {x}", "'{x}' ok", "a '} b"])(
		"rejects ICU apostrophe quoting instead of rendering it differently: %s",
		(source) => {
			expect(() => parseMessage(source)).toThrow(/apostrophe quoting/);
		},
	);

	it("rejects `'#` only where `#` is a plural count", () => {
		expect(parseMessage("Item '#1").params.size).toBe(0);
		expect(() => parseMessage("{n, plural, other {'# left}}")).toThrow(
			/apostrophe quoting/,
		);
	});

	it("refuses a string where a plural count is required", () => {
		const message = parseMessage(
			"{count, plural, one {# wake} other {# wakes}}",
		);
		expect(() => formatMessage(message, { count: "1" }, "en")).toThrow(
			RangeError,
		);
		expect(formatMessage(message, { count: 1 }, "en")).toBe("1 wake");
	});

	it("renders the same parsed message for every call", () => {
		/* The cache is what makes a per-call lookup cheap; this pins that it is a
		 * cache of a PURE parse, not a cache of rendered output (which would carry
		 * one call's arguments into the next). */
		const source = "Hello {name}";
		expect(parseMessage(source)).toBe(parseMessage(source));
		expect(formatMessage(parseMessage(source), { name: "a" }, "en")).toBe(
			"Hello a",
		);
		expect(formatMessage(parseMessage(source), { name: "b" }, "en")).toBe(
			"Hello b",
		);
	});

	it("fails loudly on a malformed message", () => {
		expect(() => parseMessage("{count, plural, one {# wake}")).toThrow(
			RangeError,
		);
		expect(() => parseMessage("unclosed {placeholder")).toThrow(RangeError);
	});

	it("rejects argument formats this subset does not implement", () => {
		/* The limitation is stated in `messages.ts`; this is the proof that it is a
		 * refusal rather than a silent passthrough that would print `{n, number}`. */
		expect(() => parseMessage("{n, number}")).toThrow(RangeError);
		expect(() => parseMessage("{when, date}")).toThrow(RangeError);
	});

	it("fails on a missing argument instead of rendering undefined", () => {
		const message = parseMessage("Hello {name}");
		expect(() => formatMessage(message, {}, "en")).toThrow(RangeError);
	});

	it("fails on a non-numeric plural argument", () => {
		const message = parseMessage(
			"{count, plural, one {# wake} other {# wakes}}",
		);
		expect(() =>
			formatMessage(message, { count: "not a number" }, "en"),
		).toThrow(RangeError);
	});

	it("uses the locale passed in for plural rules", () => {
		/* Same message, two rule sets — this is why `runtime.ts` passes the SOURCE
		 * locale rather than the reader's preference when it falls back. */
		const message = parseMessage(
			"{count, plural, one {one} few {few} other {other}}",
		);
		expect(formatMessage(message, { count: 21 }, "ru")).toBe("one");
		expect(formatMessage(message, { count: 21 }, "en")).toBe("other");
	});
});
