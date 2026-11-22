import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The WIRING of `$skill` across the session screen, the composer and the home.
 * The rules live in `skill-state.ts` / `use-skills.ts` / `skill-send.ts` with
 * their own tests; this pins the half no pure test can see — that one value
 * licenses the tray, the fetch and the flag, that the field reports its caret to
 * the hook and the tray sits above the field, and that the home composer stays
 * out. Asserted over the SOURCE (the components reach `uniwind`, which the Node
 * host cannot import), as `tags-wiring.test.ts` does.
 */
const source = (relative: string): string =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const SESSION = source("../../../../app/(app)/session/[id].tsx");
const COMPOSER = source("../components/composer.tsx");
const HOME = source("../../home/home.tsx");

const ONE_LICENCE =
	/const skillsAvailable = capabilities\.skill_invocation\?\.available === true;/;
const FLAG_FROM_LICENCE = /expandSkills: skillsAvailable,/;
const HOOK_FROM_LICENCE = /available: skillsAvailable,/;
const FIELD_USES_HOOK = /onDraftChange=\{skills\.onChangeText\}/;
const SELECTION_PASSTHROUGH =
	/onSelectionChange=\{skills\?\.onSelectionChange\}\s*selection=\{skills\?\.selection\}/;
const TRAY_RENDERED = /<SkillTray\s+rows=\{skills\.rows\}/;

describe("the session screen", () => {
	it("derives the licence ONCE, from the already remote-stripped capabilities", () => {
		expect(SESSION).toMatch(ONE_LICENCE);
		expect(SESSION).toMatch(FLAG_FROM_LICENCE);
		expect(SESSION).toMatch(HOOK_FROM_LICENCE);
	});
	it("routes the field's edits through the hook, which forwards to the draft", () => {
		expect(SESSION).toMatch(FIELD_USES_HOOK);
	});
});

describe("the composer", () => {
	it("hands the field's caret reports and the one-shot selection to the hook", () => {
		expect(COMPOSER).toMatch(SELECTION_PASSTHROUGH);
	});
	it("renders the tray in the card, above the field", () => {
		expect(COMPOSER).toMatch(TRAY_RENDERED);
		expect(COMPOSER.indexOf("<SkillTray")).toBeLessThan(
			COMPOSER.indexOf("const main = ("),
		);
	});
});

describe("the home composer", () => {
	it("stays out: a new chat has no session id to ask the catalogue about", () => {
		expect(HOME).not.toContain("useSkills");
		expect(HOME).toContain("`$skill` autocomplete asks");
	});
});
