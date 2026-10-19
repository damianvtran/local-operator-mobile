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
		/* U1/U8: the header showed the tags and exposed no control. The line is
		 *  the disclosure, gated by the tested capability AND the row's locality,
		 *  and it feeds the SAME sheet — no second write path. */
		expect(SESSION).toContain("const tagsAssignable =");
		expect(SESSION).toContain("canAssignSessionTags(capabilities)");
		expect(SESSION).toContain("isRemoteRow(listRow)");
		expect(SESSION).toContain("CONTROL.sessionHeaderTagsAction");
		expect(SESSION).toContain("<SessionTagsSheet");
		expect(SESSION).toContain("listRow?.tags ?? []");
	});

	it("keeps the control when the assignment is empty", () => {
		/* U8: gating the whole line on `tags.length > 0` left an untagged local
		 *  conversation with no visible route. The disclosure is present when it
		 *  is assignable OR there is something to read, and it opens the sheet
		 *  from the one tested gate. */
		expect(SESSION).toContain(
			"tagsAssignable || (listRow?.tags?.length ?? 0) > 0",
		);
		expect(SESSION).toContain(
			"onPress={tagsAssignable ? () => setTagsOpen(true) : undefined}",
		);
		expect(SESSION).not.toContain(
			"headerDetail={\n\t\t\t\t(listRow?.tags?.length ?? 0) > 0 ? (",
		);
	});
});

describe("the tag line component", () => {
	it("drops a read-only empty line but keeps the header's disclosure", () => {
		expect(LINE).toContain(
			"if (tags.length === 0 && onPress === undefined) return null;",
		);
		expect(LINE).toContain(
			'accessibilityLabel={tags.length > 0 ? tagAnnouncement(tags) : "Tags"}',
		);
		expect(LINE).toMatch(/>\s*Tags\s*<\/Text>/);
		expect(LINE).toContain(
			"<ChevronDown size={14} strokeWidth={2.5} color={chevronInk} aria-hidden />",
		);
	});

	it("fits through the tested function and announces every name", () => {
		expect(LINE).toContain("tagLineFor(tags, width, effectiveScale)");
		expect(LINE).toContain("tagAnnouncement(tags)");
	});

	it("gives the disclosure a real 44+ dp target box", () => {
		/* R2-3: a badge row is 22 dp; hitSlop is dropped by react-native-web, so
		 *  the target must be real geometry. */
		expect(LINE).toContain("tagLineTargetHeightDp(TOUCH_FLOOR)");
		expect(LINE).toContain('justifyContent: "flex-start"');
		expect(LINE).toContain("accessibilityRole={ROLE.button}");
	});
});

describe("the tags sheet", () => {
	it("derives the whole desired state through the tested function", () => {
		expect(SHEET).toContain("desiredTagWrite(base.tags, base.primary, tag.id)");
		expect(SHEET).toContain("clearedTags()");
	});

	it("sends the desired state through the one endpoint, to its own subject", () => {
		expect(SHEET).toContain("client.setSessionTags(");
		expect(SHEET).toContain("request.sessionId,");
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

	it("does not paint a read-back over a newer press", () => {
		/* R2-2: the first answer used to uncheck the second, queued press until
		 *  its own write settled. A newer queued press or a draft that no longer
		 *  matches the request both stand the paint down. */
		expect(SHEET).toContain("queueRef.current?.hasQueued() ?? false");
		expect(SHEET).toContain(
			"draftMatchesDesired(draftRef.current, request.desired)",
		);
	});

	it("scopes queued writes to the subject they were pressed for", () => {
		/* R2-1: one mounted sheet, a queue that outlives `visible=false`, and a
		 *  `sessionId` that becomes "" on close. The request carries its subject,
		 *  an old answer may not paint onto the next one, and a close/subject
		 *  change cancels what is still queued. */
		expect(SHEET).toContain("queue.push({ sessionId, desired, key: tag.id })");
		expect(SHEET).toContain("request.sessionId !== subjectRef.current");
		expect(SHEET).toContain("queue.reset();");
	});

	it("reverts and says the write did not save when the relay refuses", () => {
		/* The revert is dropping the draft (falls back to the list row), and the
		 *  sentence leads with the outcome before the relay's own body. */
		expect(SHEET).toContain("onRefused:");
		expect(SHEET).toContain("setDraft(null);");
		expect(SHEET).toContain("That didn't save.");
		expect(SHEET).toContain("error.displayableMessage");
		/* U10: the sentence is a live region, so a failed toggle is announced
		 *  rather than only painted. */
		expect(SHEET).toContain('accessibilityRole="alert"');
		expect(SHEET).toContain('accessibilityLiveRegion="assertive"');
	});

	it("queues a press made while one write is unanswered instead of dropping it", () => {
		/* U2: the old rule returned early and silently lost the press. The queue
		 *  keeps every checkbox live and coalesces to the newest desired state. */
		expect(SHEET).toContain("new TagWriteQueue(");
		expect(SHEET).toContain("queue.push({ sessionId, desired, key: tag.id })");
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

	it("pins each state's answering control and renders Remove all exactly once", () => {
		/* D1/D3 + round 3 + UX round 2 (U9): Try again answers a failed read;
		 *  every ready catalogue with an assignment pins Remove all in the
		 *  footer, so the full control box is reachable at 200 % on a 320 pt
		 *  phone instead of being sliced at the body's edge. */
		expect(SHEET).toContain('catalogue.kind === "error" ? (');
		expect(SHEET).toContain("CONTROL.sessionTagsRetry");
		expect(SHEET).toContain("<Dialog");
		expect(SHEET).toContain("sessionTagsRemoveAllDialog");
		expect(SHEET).toContain('title="Remove all tags?"');
		expect(SHEET).toContain(
			'catalogue.kind === "error" ? removeAllAction : null',
		);
		/* Exactly one render per state: the footer owns every ready state, and
		 *  the error branch owns the above-alert one. The body no longer renders
		 *  it at all — that placement is what U9 measured as clipped. A `loading`
		 *  fallthrough used to emit a SECOND control beside the alert. */
		expect(SHEET).not.toContain(
			'catalogue.kind === "ready" && !emptyCatalogue',
		);
		expect(SHEET).not.toContain(
			'catalogue.kind === "loading" ? null : removeAllAction',
		);
		/* One `removeAllAction` element: the footer reference and the error-state
		 *  reference are the only renders, and the removed body branch proves the
		 *  sheet never paints it twice in one state. */
		expect(SHEET.split("? removeAllAction : null")).toHaveLength(2);
		expect(SHEET).toContain(": removeAllPinned ? (");
	});

	it("keys the pinned action on the raw catalogue, not the merged options", () => {
		/* `catalogueWithAssigned` merges the row's own tag into `options`, so the
		 *  captured empty-catalogue state (a tagged row against an empty registry)
		 *  has one checkbox and `options.length === 0` is FALSE. Keying the footer
		 *  on it would leave that frame unfixed. */
		expect(SHEET).toContain(
			'catalogue.kind === "ready" && catalogue.tags.length === 0',
		);
		expect(SHEET).toContain(
			'(!nothingSelected || pending === "*" || removeAllQueued)',
		);
		expect(SHEET).toContain(
			'catalogue.kind === "ready" &&\n\t\t(!nothingSelected',
		);
		/* The body's own pb-6 is a no-footer gutter; with the pinned footer it
		 *  made the content overflow by a hair and the cut-edge fade covered the
		 *  explanation's last line at 200 % SE (round 3). U9 moves the populated
		 *  state onto the same branch. */
		expect(SHEET).toContain(
			'catalogue.kind === "error" || removeAllPinned ? "" : "pb-6"',
		);
	});

	it("keeps an assigned tag selectable when the registry is empty", () => {
		/* K, again at the render branch: the empty state keys on the OPTIONS
		 *  the list actually offers, not on the raw catalogue, so an assigned
		 *  tag from an empty registry still reaches a checkbox. The raw-empty
		 *  case renders the same honest sentence above that list instead of
		 *  short-circuiting it. */
		expect(SHEET).toContain(") : options.length === 0 ? (");
		expect(SHEET).not.toContain(") : catalogue.tags.length === 0 ? (");
		expect(SHEET).toContain("catalogue.tags.length === 0 ? (");
		/* Both empty-registry branches now name no action in the sentence: the
		 *  pinned footer IS the action, and the longer copy was cut at 200 % SE. */
		expect(SHEET.split('next="Created on desktop."')).toHaveLength(3);
	});

	it("renders each catalogue tag as a checkbox with an ARIA checked state", () => {
		expect(SHEET).toContain("accessibilityRole={ROLE.checkbox}");
		expect(SHEET).toContain("sessionTagOptionId(tag.id)");
		/* U11: the state is carried by `checked`, not repeated in the name. */
		expect(SHEET).toContain("accessibilityLabel={tag.name}");
		expect(SHEET).not.toContain(', ${checked ? "checked" : "unchecked"}');
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
