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
		expect(detail).toContain('op: "read"');
		expect(detail).toContain("detail.item.revision");
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
		expect(detail).toContain('detail.item.source === "notify"');
		expect(detail).toContain('op: "read"');
	});
});
