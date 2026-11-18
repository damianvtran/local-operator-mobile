import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The list surfaces' empty states and the Past search row render catalogue
 * keys, not English literals.
 *
 * `check-strings.ts` cannot see these: a literal inside a ternary in an
 * attribute expression (`headline={q ? "…" : "…"}`) and an object property
 * (`action={{ label: "…" }}`) are both outside its three rules, which is how
 * they shipped. So the wiring is pinned over the SOURCE, for the reason
 * `sidebar-footer.test.ts` records (the pane reaches `uniwind`, which Node
 * cannot import).
 */
const read = (path: string) =>
	readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const PANE = read("./conversations-pane.tsx");
const PAST = read("../past/past.tsx");

describe("list copy is keyed", () => {
	it.each([
		"Nothing matches that.",
		"Search covers the loaded sessions' names, ids and folders.",
		"Clear the search",
		"No computer is connected yet.",
		"This app drives the sessions on your own computer, so it needs one first.",
		'"Connect a computer"',
		"No sessions yet.",
		"Start one and it will appear here.",
		'label: "New chat"',
	])("the drawer's empty states carry no %s literal", (literal) => {
		expect(PANE).not.toContain(literal);
	});

	it.each([
		"Nothing matches that.",
		"No past conversations yet.",
		"so a shorter word may match.",
		"you can pick one up again.",
		"Clear the search",
		'"Back to sessions"',
		'label="Search past sessions"',
		'placeholder="Words or title"',
		'label="Search"',
	])("the Past screen carries no %s literal", (literal) => {
		expect(PAST).not.toContain(literal);
	});

	it("the Past search row shows one label and a field-height button", () => {
		expect(PAST).toContain('label={t("mobile.past.search_label")}');
		expect(PAST).toContain("labelHidden");
		expect(PAST).toContain("fillFloor");
	});
});
