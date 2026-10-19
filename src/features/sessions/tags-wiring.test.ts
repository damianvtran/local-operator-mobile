import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The WIRING of conversation tags across the three surfaces and the sheet.
 *
 * The fitting rules and the desired-state arithmetic live in `tags.ts` with
 * their own tests. This file pins the half no pure test can see — that each
 * surface renders the shared line rather than a second, private copy, that a
 * remote or past row cannot reach an assignment control, and that the sheet
 * settles from the testable functions rather than re-deriving the rules.
 *
 * Asserted over the SOURCE, for the reason `asks-sheet.test.ts` records: the
 * components reach `uniwind` through `@/ui`, which the Node test environment
 * cannot import. Reads are name-following where the name is the point, so a
 * rename keeps passing while a divergence fails.
 */
const source = (relative: string): string =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const PANE = source("./conversations-pane.tsx");
const SHEET = source("./tags-sheet.tsx");
const LINE = source("./tag-line.tsx");
const PAST = source("../../features/past/past.tsx");
const SESSION = source("../../../app/(app)/session/[id].tsx");

describe("the conversations pane", () => {
	it("gates the Tags action on the tested capability, not a second comparison", () => {
		expect(PANE).toContain("const tagsAssignable = canAssignSessionTags(");
		expect(PANE).toMatch(/\{tagsAssignable \? \(/);
		expect(PANE).not.toMatch(/session_tags\?\.available ===/);
	});

	it("offers the action only from a local row's menu", () => {
		/* A remote row's long press opens the move sheet directly; only a local
		 *  row ever reaches `menuTarget`, which is the only place the action is
		 *  rendered. */
		expect(PANE).toContain(
			"remote ? setMoveTarget(session) : setMenuTarget(session)",
		);
	});

	it("renders a tag line on every row that has one, remote included", () => {
		/* The line is outside the local/remote branches: a future relay that
		 *  projects another device's tags renders them read-only here. */
		expect(PANE).toContain("<SessionTagLine");
		expect(PANE).toContain("sessionTagLineId(session.session_id)");
	});

	it("keeps the sheet's subject fresh from the list frames", () => {
		expect(PANE).toContain(
			"const fresh = sessions.find(\n\t\t\t(session) => session.session_id === tagTarget.session_id,\n\t\t);",
		);
		expect(PANE).toContain(
			"if (fresh !== undefined && fresh !== tagTarget) setTagTarget(fresh);",
		);
	});
});

describe("the past list", () => {
	it("paints the same read-only line", () => {
		expect(PAST).toContain("<SessionTagLine");
		expect(PAST).toContain("pastTagLineId(item.id)");
	});

	it("offers no assignment path", () => {
		expect(PAST).not.toContain("SessionTagsSheet");
		expect(PAST).not.toContain("sessionTagsAction");
		expect(PAST).not.toContain("setSessionTags");
	});
});

describe("the session header", () => {
	it("renders the read-only line from the list frame's row", () => {
		expect(SESSION).toContain("headerDetail={");
		expect(SESSION).toContain("sessionHeaderTagLineId(sessionId)");
		expect(SESSION).toContain("useListState((state) =>");
	});
});

describe("the tag line component", () => {
	it("is absent, not a blank line, when the row has no tags", () => {
		expect(LINE).toContain("if (tags.length === 0) return null;");
	});

	it("fits through the tested function and announces every name", () => {
		expect(LINE).toContain("tagLineFor(tags, width, effectiveScale)");
		expect(LINE).toContain("tagAnnouncement(tags)");
	});
});

describe("the tags sheet", () => {
	it("derives the whole desired state through the tested function", () => {
		expect(SHEET).toContain(
			"desiredTagWrite(current.tags, current.primary, tag.id)",
		);
		expect(SHEET).toContain("clearedTags()");
	});

	it("sends the desired state through the one endpoint", () => {
		expect(SHEET).toContain("client.setSessionTags(");
		expect(SHEET).toContain("sessionId,");
		expect(SHEET).toContain("desiredTags");
		expect(SHEET).toContain("desiredPrimary");
	});

	it("settles on the read-back, defending the primary", () => {
		expect(SHEET).toContain(
			"setDraft({\n\t\t\t\t\ttags: answer.tags,\n\t\t\t\t\tprimary: settledPrimary(answer.tags, answer.primary),\n\t\t\t\t});",
		);
	});

	it("reverts the toggle and shows the relay's own sentence on refusal", () => {
		/* The catch is the revert: dropping the draft falls back to the list
		 *  row, and `displayableMessage` is the `error` body rather than a
		 *  re-worded status. */
		expect(SHEET).toMatch(/catch \(error\) \{[\s\S]*?setDraft\(null\);/);
		expect(SHEET).toContain("error.displayableMessage");
	});

	it("holds one in-flight write at a time and disables every row meanwhile", () => {
		expect(SHEET).toContain("if (pending !== null) return;");
		expect(SHEET).toContain("accessibilityState={{ checked, disabled: busy }}");
	});

	it("renders each catalogue tag as a checkbox with an id and a checked label", () => {
		expect(SHEET).toContain("accessibilityRole={ROLE.checkbox}");
		expect(SHEET).toContain("sessionTagOptionId(tag.id)");
		expect(SHEET).toContain('checked ? "checked" : "unchecked"');
	});

	it("has no local tag store: its state is the list frame plus the write in flight", () => {
		expect(SHEET).not.toContain("zustand");
		expect(SHEET).not.toContain("@/state/list-store");
	});
});
