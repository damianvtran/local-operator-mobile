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

	it("announces the row's tags from the pressable that owns the label", () => {
		/* The past row is one button; its tag line is inside it and cannot be a
		 *  second stop, so the tags are folded into the row's own label — the
		 *  same defect and fix as the conversations pane (D4/Q2). */
		expect(PAST).toContain("tagAnnouncement(item.tags ?? [])");
		expect(PAST).toContain("announce={false}");
	});

	it("offers no assignment path", () => {
		expect(PAST).not.toContain("SessionTagsSheet");
		expect(PAST).not.toContain("sessionTagsAction");
		expect(PAST).not.toContain("setSessionTags");
	});
});

describe("the session header", () => {
	it("renders the line from the list frame's row", () => {
		expect(SESSION).toContain("headerDetail={");
		expect(SESSION).toContain("sessionHeaderTagLineId(sessionId)");
		expect(SESSION).toContain("useListState((state) =>");
	});

	it("opens the same sheet through a disclosed control on a local row", () => {
		/* U1: the header showed the tags and exposed no control. The line is the
		 *  disclosure, gated by the tested capability AND the row's locality, and
		 *  it feeds the SAME sheet — no second write path. */
		expect(SESSION).toContain("canAssignSessionTags(capabilities)");
		expect(SESSION).toContain("isRemoteRow(listRow)");
		expect(SESSION).toContain("CONTROL.sessionHeaderTagsAction");
		expect(SESSION).toContain("<SessionTagsSheet");
		expect(SESSION).toContain("listRow?.tags ?? []");
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
		expect(SHEET).toContain("desiredTagWrite(base.tags, base.primary, tag.id)");
		expect(SHEET).toContain("clearedTags()");
	});

	it("sends the desired state through the one endpoint", () => {
		expect(SHEET).toContain("client.setSessionTags(");
		expect(SHEET).toContain("sessionId,");
		expect(SHEET).toContain("request.desired.tags");
		expect(SHEET).toContain("request.desired.primary");
	});

	it("settles on the read-back, defending the primary", () => {
		expect(SHEET).toContain("tags: answer.tags,");
		expect(SHEET).toContain(
			"primary: settledPrimary(answer.tags, answer.primary),",
		);
	});

	it("does not paint a read-back over a newer list frame", () => {
		/* J: a frame that landed while the write was in flight is the relay's
		 *  later answer; the older read-back must not overwrite it. */
		expect(SHEET).toContain(
			"startedAt.current.get(request) === frameSeq.current",
		);
	});

	it("reverts and says the write did not save when the relay refuses", () => {
		/* The revert is dropping the draft (falls back to the list row), and the
		 *  sentence leads with the outcome before the relay's own body. */
		expect(SHEET).toContain("onRefused:");
		expect(SHEET).toContain("setDraft(null);");
		expect(SHEET).toContain("That didn't save.");
		expect(SHEET).toContain("error.displayableMessage");
	});

	it("queues a press made while one write is unanswered instead of dropping it", () => {
		/* U2: the old rule returned early and silently lost the press. The queue
		 *  keeps every checkbox live and coalesces to the newest desired state. */
		expect(SHEET).toContain("new TagWriteQueue(");
		expect(SHEET).toContain("queue.push({ desired, key: tag.id })");
		expect(SHEET).not.toContain("if (pending !== null) return;");
		expect(SHEET).not.toContain("disabled={busy}");
	});

	it("merges assigned tags into the checkbox list", () => {
		/* K: a stale catalogue must not hide an assignment and make it
		 *  un-unselectable. */
		expect(SHEET).toContain(
			"catalogueWithAssigned(catalogue.tags, current.tags)",
		);
	});

	it("keys the catalogue read on the connection identity, not the relay function", () => {
		/* I: `relay` is rebuilt on incidental renders; re-running the effect on
		 *  its identity could clear the in-flight guard mid-press. */
		expect(SHEET).toContain("const connectionIdentity = useConnectionState(");
		expect(SHEET).toContain(
			"}, [visible, reloadKey, connectionIdentity, setDraft]);",
		);
	});

	it("pins the catalogue error's answer in the footer and Remove all in the body", () => {
		/* D1/D3: Try again is the answering control when the read failed; Remove
		 *  all is a destructive body action behind a confirm, never the footer's
		 *  strongest slot. */
		expect(SHEET).toContain('catalogue.kind === "error" ? (');
		expect(SHEET).toContain("CONTROL.sessionTagsRetry");
		expect(SHEET).toContain("<Dialog");
		expect(SHEET).toContain("sessionTagsRemoveAllDialog");
		expect(SHEET).toContain('title="Remove all tags?"');
		expect(SHEET).toContain(
			'catalogue.kind === "error" ? removeAllAction : null',
		);
		expect(SHEET).toContain(
			'catalogue.kind === "loading" ? null : removeAllAction',
		);
	});

	it("renders each catalogue tag as a checkbox with an ARIA checked state", () => {
		expect(SHEET).toContain("accessibilityRole={ROLE.checkbox}");
		expect(SHEET).toContain("sessionTagOptionId(tag.id)");
		expect(SHEET).toContain('checked ? "checked" : "unchecked"');
		/* Q1: react-native-web does not read `accessibilityState`, so the AX
		 *  tree said checked:false until `aria-checked` was written beside it. */
		expect(SHEET).toContain("accessibilityState={{ checked }}");
		expect(SHEET).toContain("aria-checked={checked}");
	});

	it("has no local tag store: its state is the list frame plus the write in flight", () => {
		expect(SHEET).not.toContain("zustand");
		expect(SHEET).not.toContain("@/state/list-store");
	});
});
