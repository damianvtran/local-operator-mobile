import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The screen owns no automatic read path.
 *
 * WHY A SOURCE INVARIANT RATHER THAN A DOM RENDER. The blocker this round
 * (code review B1, QA Q1) was not a logic error — the tracker was correct and
 * unit-tested — it was that nothing ATTACHED the feed: `onViewable` was defined,
 * `receipts.render` had exactly one call site inside it, and no list prop ever
 * received it. A `*.test.ts` of the tracker cannot see that; this repository has
 * no React test renderer and no jsdom, so a component test would need a new
 * dependency and a build seam the app does not have.
 *
 * So the wiring is asserted where it lives, in two places that must both hold:
 *
 *   1. the feed's callbacks are passed to the list as props
 *      (`onViewableItemsChanged`, `viewabilityConfig`), and
 *   2. the list is the platform's viewability-aware one (`FlatList`), because a
 *      plain `ScrollView` has no such props — which is exactly how round 1
 *      "had" a callback nobody could pass.
 *
 * The behaviour of the feed itself is covered by `use-receipt-feed.test.ts`
 * (one receipt with a gesture, none without). Between the two, the class of
 * defect that shipped — a callback defined and never attached — fails a test.
 *
 * This is a static check, and it is honest about being one: it proves the props
 * are wired, not that a browser paints the rows at 50 % visibility. The latter
 * is the QA lane's real-path pass.
 */

const SCREEN = new URL("./notifications.tsx", import.meta.url);
const source = readFileSync(SCREEN, "utf8");
/** The read/refresh sequence's own home, asserted where the rule now lives. */
const model = readFileSync(
	new URL("./notifications-model.ts", import.meta.url),
	"utf8",
);

describe("the inbox screen has no automatic read feed", () => {
	it("keeps the list free of seen requests and visibility callbacks", () => {
		expect(source).toContain("<FlatList");
		expect(source).not.toContain("onViewableItemsChanged");
		expect(source).not.toContain("markNotificationsSeen");
		expect(source).not.toContain("useReceiptFeed");
		expect(source).not.toContain("receipts.render");
		expect(source).not.toContain("noteInput");
	});

	it("keeps the detail's read as a loaded, revision-bound PATCH", () => {
		const detail = readFileSync(
			new URL("./notification-detail.tsx", import.meta.url),
			"utf8",
		);
		expect(detail).toContain("readLoadedDetail");
		expect(detail).toContain('op: "read"');
		/* The revision the write names is the one the DETAIL carried — the helper
		 * takes `detail` and names `detail.item.revision`, so the rule lives there
		 * and the screen cannot invent a token (QA round 3, Q8 moved the sequence,
		 * never the binding). */
		expect(model).toContain("detail.item.revision");
		expect(detail).not.toContain("useReceiptFeed");
		expect(detail).not.toContain("markNotificationsSeen");
	});
});

describe("the detail keeps read-only ask context separate from answering", () => {
	it("uses the existing session ask sheet rather than a second answer form", () => {
		const detail = readFileSync(
			new URL("./notification-detail.tsx", import.meta.url),
			"utf8",
		);
		expect(detail).toContain("AsksSheet");
		expect(detail).toContain("Answer in conversation");
	});
});

describe("the screen separates an unknown capability from a refused one", () => {
	it("keeps the skeleton until a frame has actually reported capabilities", () => {
		/* Before the first list frame the capability bag is empty. Treating that
		 * absence as "this relay has no inbox" painted the unsupported sentence
		 * over the loading state — caught by the S18/loading capture, whose held
		 * API never delivers a frame. */
		expect(source).toContain("frameCount > 0");
		expect(source).toContain("const unsupported = !enabled && frameCount > 0");
	});
});

describe("the detail's explicit read", () => {
	it("is sent for an update, and never for an ask", () => {
		/* An ask is answered, not read: its read mark would claim the reader
		 * finished with a question they have not answered, and Waiting on you does
		 * not consult read state anyway (QA round 2, Q4's second half). */
		const detail = readFileSync(
			new URL("./notification-detail.tsx", import.meta.url),
			"utf8",
		);
		/* The guard moved with the sequence: `readLoadedDetail` is the one place
		 * that decides whether an item is read at all, so the ask rule is asserted
		 * THERE (and behaviourally in notifications-model.test.ts) while the screen
		 * is asserted to route every read through it. */
		expect(model).toContain('detail.item.source !== "notify"');
		expect(detail).toContain("readLoadedDetail");
	});
});

/** The hook owns the request lifecycle; the screen only paints it. */
const hook = readFileSync(
	new URL("./use-notifications.ts", import.meta.url),
	"utf8",
);

describe("the failed-page state (review round 4, m1/m2/m3)", () => {
	it("renders a stated failure with ONE retry control", () => {
		expect(source).toContain("inbox.loadMoreError");
		expect(source).toContain("SURFACE.inboxLoadMoreFailed");
		expect(source).toContain("CONTROL.inboxLoadMoreRetry");
		/* While the sentence is up the "Load more" button is suppressed: the gate
		 * below is the conditional that does it, and two controls that re-issue the
		 * same cursor would be the same verb twice. */
		expect(source).toContain("inbox.loadMoreError === null");
	});

	it("clears the failure when a page-one answer lands", () => {
		/* The error belongs to the cursor walk it happened in; a refresh or a
		 * filter switch must not leave it (and its cursor) beside fresh rows. */
		const load = hook.slice(hook.indexOf("const load = useCallback"));
		const body = load.slice(0, load.indexOf("const loadMore"));
		expect(body).toContain("setLoadMoreError(null)");
	});

	it("bounds the awaited detail read below a page read", () => {
		const detail = readFileSync(
			new URL("./notification-detail.tsx", import.meta.url),
			"utf8",
		);
		expect(detail).toContain("READ_CONFIRM_TIMEOUT_MS");
		const wait = Number(
			/READ_CONFIRM_TIMEOUT_MS = ([0-9_]+)/.exec(detail)?.[1]?.replace("_", ""),
		);
		expect(wait).toBeGreaterThan(0);
		expect(wait).toBeLessThan(8_000);
	});
});
