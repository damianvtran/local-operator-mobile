import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SOURCE CHECK on the ask-id chip's call sites.
 *
 * `ask-chip.ts` is tested on its own (`ask-chip.test.ts`); what those tests
 * cannot see is whether anything DRAWS what it says. The chip is only worth
 * having if three separate surfaces hand it the right facts — the prose draws it,
 * the sheet draws the same id at each card's foot, and the screen wires the one
 * thing that makes an id resolvable (this conversation's asks, plus the queue
 * read that names a withdrawn one). Nothing in the unit suite would notice the
 * screen forgetting the provider: every chip would quietly fall back to plain
 * mono, which is exactly the state this feature removes.
 */
const read = (path: string) =>
	readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const MARKDOWN = read("components/markdown.tsx");
const SHEET = read("components/asks-sheet.tsx");
const RESPONSE_ROW = read("components/ask-response-row.tsx");
const SCREEN = read("../../../app/(app)/session/[id].tsx");
const HOOK = read("use-asks-sheet.ts");

describe("the prose renderer", () => {
	it("splits inline spans through the id parser and draws a chip for each id", () => {
		expect(MARKDOWN).toContain("askIdSegments(span.text)");
		expect(MARKDOWN).toContain("<AskIdChip key={index} id={segment.id} />");
	});

	it("draws chips only where the surface says it can answer for one", () => {
		expect(MARKDOWN).toContain("const chips = askChipsDrawn();");
		expect(MARKDOWN).toContain("if (!chips || span.href !== undefined)");
	});
});

describe("the asks sheet", () => {
	it("draws the id with a 44 pt copy box on the open card", () => {
		expect(SHEET).toContain("<AskIdFoot askId={row.ask_id} />");
	});

	it("shows the id on every collapsed row and copies it on a hold", () => {
		expect(SHEET).toContain("{row.ask_id}");
		expect(SHEET).toContain("onLongPress={() => copyAskId(row.ask_id)}");
	});

	it("hands its reads back to the screen, which is where a withdrawn ask is named", () => {
		expect(SHEET).toContain("onRows?.(rows)");
	});
});

describe("the settled receipt", () => {
	it("draws the id the wire carried, and nothing when it carried none", () => {
		expect(RESPONSE_ROW).toContain('String(entry.details.ask_id ?? "")');
		expect(RESPONSE_ROW).toContain("<AskIdFoot askId={askId} />");
	});
});

describe("the session screen", () => {
	it("provides the host and the drawn flag around the transcript", () => {
		expect(SCREEN).toContain("<AskChipDrawnContext.Provider value>");
		expect(SCREEN).toContain("<AskChipHostContext.Provider value={chipHost}>");
	});

	it("resolves chips against this conversation, its receipts and the sheet's read", () => {
		expect(SCREEN).toContain("askChipFacts(");
		expect(SCREEN).toContain("settled: sheetAskRows,");
		expect(SCREEN).toContain("onRows={setSheetAskRows}");
	});

	it("opens the sheet ON the ask a chip names, only where the sheet can open", () => {
		expect(SCREEN).toContain(
			"asksAnswerable ? asksSheet.openAt : NO_ASK_CHIP_OPEN,",
		);
	});
});

describe("the sheet hook", () => {
	it("derives the expanded ask through the pure policy, so a pin only outlives a reader open", () => {
		/* The behaviour — a leftover pin ignored by a policy open — is asserted in
		 *  `asks-open-policy.test.ts`; this only checks the hook calls it (round 1,
		 *  m5: the derivation moved out of string-greppable inline JS). */
		expect(HOOK).toContain("initialOpenAskFor({");
		expect(HOOK).toContain("origin: controller.openOrigin(),");
	});

	it("forgets the pin on every way out the hook itself drives", () => {
		// open, close, readFailed, leave. Exits the controller runs alone are the
		//  origin gate's job (m4b).
		expect(HOOK.match(/setPinned\(null\);/g) ?? []).toHaveLength(4);
	});
});
