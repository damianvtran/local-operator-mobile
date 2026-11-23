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
		/* The sheet expands the row whose `ask_id` equals `initialOpenAsk`, so the
		 * detail must hand it the BARE ask id. It used to hand the item's own
		 * composite id (`ask:<session>:<ask_id>`), which no row matches and which
		 * opened the card's own ask collapsed (Ben, 2026-11-23). The invariant is
		 * asserted behaviourally in notifications-model.test.ts; here it is the
		 * wiring that can silently regress. */
		expect(detail).toContain("openAskIdFor(state.detail)");
		expect(detail).not.toContain("state.detail.item.id");
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

/**
 * The empty inbox fills the screen below its filter (issue #321).
 *
 * Static for the reason the top of this file gives. The defect was layout, not
 * logic: the Unread empty's wrapper had no `flex-1`, so on iOS the
 * `EmptyState` (itself `flex-1 … justify-center`) was offered zero height and
 * its centred block spilled UP over the Unread/All control, with the receipt
 * crammed straight under it. The All empty had no filter at all, so a reader
 * who tapped "Show all notifications" had no way back to Unread but Back. The
 * rendered proof is the web capture; this pins the facts that caused it.
 *
 * The region SCROLLS, and the empty state inside it keeps its content height:
 * at 200 % text on a 320 pt phone a fixed `flex-1` region was shorter than the
 * empty state, which shrank and spilled over the filter the same way (web
 * capture, iphone-se 200 %), while the receipt ran off the bottom unreachable.
 */
const EMPTY_BRANCH_START = "if (response !== null && inboxEmpty(response))";
const EMPTY_BRANCH_END = "/* The populated case is the FlatList below.";
const GROWING_WRAPPER =
	/<ScrollView\b[^>]*\bclassName="(?:[^"]* )?flex-1(?: [^"]*)?"/;
const GROWING_CONTENT =
	/<ScrollView\b[^>]*\bcontentContainerClassName="(?:[^"]* )?grow(?: [^"]*)?"/;
const SCROLLING_PROP = /^\s*scrolling$/gm;
const EMPTY_SCROLL_REF = /<ScrollView\b[^>]*\bref=\{emptyScrollRef\}/;
const TOP_ON_TAB_CHANGE =
	/const setEmptyFilter = \(next: InboxFilter\) => \{\s*emptyScrollRef\.current\?\.scrollTo\(\{ y: 0, animated: false \}\);\s*inbox\.setFilter\(next\);/;
const EMPTY_TAB_CONTROLS = /setEmptyFilter\b/g;
const FILTER_TAG = /<SegmentedFilter\b/g;

function emptyBranch(): string {
	const start = source.indexOf(EMPTY_BRANCH_START);
	const end = source.indexOf(EMPTY_BRANCH_END, start);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
}

describe("the empty inbox's layout (#321)", () => {
	it("gives the empty state a growing wrapper, so it centres instead of collapsing", () => {
		const branch = emptyBranch();
		const wrapper = GROWING_WRAPPER.exec(branch);
		expect(wrapper).not.toBeNull();
		/* The wrapper opens BEFORE either empty state, so both are inside it. */
		expect(wrapper?.index ?? -1).toBeLessThan(
			branch.indexOf("testID={EMPTY.notifications}"),
		);
		expect(wrapper?.index ?? -1).toBeLessThan(
			branch.indexOf("testID={EMPTY.notificationsAll}"),
		);
	});

	it("scrolls when the screen is shorter than the empty state", () => {
		const branch = emptyBranch();
		/* The content grows to the viewport (so the state centres) but is never
		 *  smaller than its children (so a short screen scrolls to them). */
		expect(GROWING_CONTENT.test(branch)).toBe(true);
		/* Both sentences opt out of `flex-1`'s zero basis. */
		expect(branch.match(SCROLLING_PROP)?.length).toBe(2);
	});

	it("opens each tab at the top, not at the other tab's scroll offset (design D1)", () => {
		/* One region serves both tabs. "Show all notifications" pressed after
		 *  scrolling down at 320 pt / 200 % landed the All tab mid-sentence, with
		 *  the Unread/All control above the viewport. Both of the region's tab
		 *  controls (the filter and "Show all") scroll it to its top first; not a
		 *  remount, which would also cut the segmented indicator's slide. */
		const branch = emptyBranch();
		expect(EMPTY_SCROLL_REF.test(branch)).toBe(true);
		expect(TOP_ON_TAB_CHANGE.test(source)).toBe(true);
		expect(branch.match(EMPTY_TAB_CONTROLS)?.length).toBe(2);
		expect(branch).not.toContain("inbox.setFilter");
	});

	it("keeps the Unread/All filter on BOTH empty tabs", () => {
		const branch = emptyBranch();
		/* One filter, rendered before the tab decides which sentence to show. */
		expect(branch.match(FILTER_TAG)?.length).toBe(1);
		expect(branch.indexOf("<SegmentedFilter")).toBeLessThan(
			branch.indexOf('inbox.filter === "unread"'),
		);
	});
});

/**
 * The dismiss receipt is a pinned, inset footer (#321).
 *
 * The screen is `scroll={false}`, so `Screen` adds no horizontal gutter and
 * pays no bottom inset (`bottomInset` defaults to "child"): the receipt ran
 * edge to edge, and once the empty state grows it would sit in the home
 * indicator band. The footer that holds it pays both, and only while it holds
 * something, so an idle list still scrolls under the indicator as before.
 */
const RECEIPT_IN_GUTTER =
	/<View\b[^>]*\bclassName="[^"]*\bpx-4\b[^"]*"\s*>\s*<DismissReceipt dismissAll=\{dismissAll\} \/>/;
const FOOTER_PAYS_INSET =
	/paddingBottom:\s*footerShowing \? insets\.bottom : 0/;

describe("the dismiss receipt's footer (#321)", () => {
	it("insets the receipt by the screen's gutter", () => {
		expect(RECEIPT_IN_GUTTER.test(source)).toBe(true);
	});

	it("pays the bottom safe-area inset while the footer holds anything", () => {
		expect(source).toContain("const insets = useSafeAreaInsets();");
		expect(source).toContain(
			"const footerShowing = selecting || receiptShowing;",
		);
		expect(FOOTER_PAYS_INSET.test(source)).toBe(true);
	});
});
