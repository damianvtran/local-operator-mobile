import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	footerControl,
	pageWalkFailed,
	pageWalkStarted,
} from "./notifications-model";

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
		/* The label is keyed now; the wiring this asserts is that the detail's button
		 * still comes from the key whose English source is the sentence. */
		expect(detail).toContain(
			"mobile.notifications.detail.answer_in_conversation",
		);
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
/** Top-level, per the repo's lint rule: a regex literal in a test body is a
 *  allocation per run. */
const MERGES_PAGE =
	/setReceived\(\{\s*generation,\s*answer: mergePage\(held, answer\),?\s*\}\)/;
const FAILS_THE_WALK = /setPageWalk\(\s*pageWalkFailed\(/;

const hook = readFileSync(
	new URL("./use-notifications.ts", import.meta.url),
	"utf8",
);

describe("the failed-page state — behavioural, not source text (round 5, m5/m6)", () => {
	it("clears the failure when a page-one answer lands", () => {
		/* The transitions ARE the rule: a refresh or filter switch starts the walk
		 * again, and the failure that belonged to the old one goes with it. */
		const failed = pageWalkFailed("Couldn't load the next page.");
		expect(failed.error).not.toBeNull();
		expect(pageWalkStarted().error).toBeNull();
	});

	it("shows exactly ONE footer control in every state", () => {
		expect(
			footerControl({ loadingMore: true, hasCursor: true, error: null }),
		).toBe("spinner");
		expect(
			footerControl({ loadingMore: false, hasCursor: true, error: "boom" }),
		).toBe("retry");
		expect(
			footerControl({ loadingMore: false, hasCursor: true, error: null }),
		).toBe("loadMore");
		expect(
			footerControl({ loadingMore: false, hasCursor: false, error: null }),
		).toBe("none");
		/* A spinner outranks a stale error: the request in flight is the newer fact. */
		expect(
			footerControl({ loadingMore: true, hasCursor: true, error: "boom" }),
		).toBe("spinner");
	});

	it("has the hook route the page through `mergePage` and the walk through the pair", () => {
		/* The one rule a renderer-free test cannot reach: the hook's own call. Assert
		 * the call sites, so deleting either one fails here (m6). */
		/* Formatting-tolerant: the call is what must survive, not its line breaks. */
		expect(MERGES_PAGE.test(hook)).toBe(true);
		expect(hook).toContain("setPageWalk(pageWalkStarted())");
		expect(FAILS_THE_WALK.test(hook)).toBe(true);
	});

	it("bounds the awaited detail read below a page read", () => {
		const detail = readFileSync(
			new URL("./notification-detail.tsx", import.meta.url),
			"utf8",
		);
		const wait = Number(
			/READ_CONFIRM_TIMEOUT_MS = ([0-9_]+)/.exec(detail)?.[1]?.replace("_", ""),
		);
		expect(wait).toBeGreaterThan(0);
		expect(wait).toBeLessThan(8_000);
		/* And it is actually passed to the sequence, not merely defined. */
		expect(detail).toContain("{ timeoutMs: READ_CONFIRM_TIMEOUT_MS }");
	});
});

/**
 * The list re-reads when it is returned to (QA round 7 O2; the audit scout).
 *
 * Static for the reason the top of this file gives — no renderer here — and
 * paired with the behavioural halves in `inbox-writes.test.ts` (the signal) and
 * `state/__tests__/stores.test.ts` (the badge's freshness rule). The real
 * open → read → Back and dismiss-all → Back paths are the web capture's.
 */
const FOCUS_EFFECT = /useFocusEffect\(\s*useCallback\(/;
const FIRST_FOCUS_SKIPPED =
	/if \(!focusedOnce\.current\) \{\s*focusedOnce\.current = true;\s*return;\s*\}\s*reload\(\{ silent: true \}\);/;
const SUBSCRIBES_TO_WRITES =
	/useEffect\(\s*\(\) => onInboxWrite\(\(\) => reload\(\{ silent: true \}\)\),\s*\[reload\],?\s*\)/;

describe("the inbox list re-reads on return", () => {
	it("re-reads silently on every focus after the first", () => {
		expect(FOCUS_EFFECT.test(source)).toBe(true);
		expect(FIRST_FOCUS_SKIPPED.test(source)).toBe(true);
	});

	it("re-reads when a write made on the detail settles", () => {
		const detail = readFileSync(
			new URL("./notification-detail.tsx", import.meta.url),
			"utf8",
		);
		expect(SUBSCRIBES_TO_WRITES.test(source)).toBe(true);
		/* Both of the detail's writes announce: the explicit read, and every
		 * dismiss-all (and Undo) through the hook's `onSettled`. */
		expect(detail.match(/noteInboxWrite\(\)/g)?.length).toBe(2);
	});

	it("hands the badge the counts the inbox is showing", () => {
		expect(source).toContain("listStore.getState().applyInboxCounts(");
	});

	it("lets the newest ticket clear the skeleton, silent or not", () => {
		expect(hook).toContain(
			"if (ticket === ticketRef.current) setLoading(false);",
		);
	});
});
