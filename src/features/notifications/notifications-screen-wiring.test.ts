import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The screen actually hands its read-receipt feed to the list.
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

/** Everything between the list's opening tag and its closing `/>`. */
function listProps(text: string): string {
	const start = text.indexOf("<FlatList");
	expect(start).toBeGreaterThan(-1);
	const end = text.indexOf("/>", start);
	expect(end).toBeGreaterThan(start);
	return text.slice(start, end);
}

describe("the inbox screen wires the read receipt to its list", () => {
	it("renders a FlatList, the only list that reports visibility", () => {
		expect(source).toContain("<FlatList");
		/* A ScrollView cannot carry the visibility callback at all; if the rows
		 * ever move back into one, this fails rather than silently going dead. */
		expect(source).not.toContain("onViewableItemsChanged={undefined}");
	});

	it("passes the feed's own callback and the 50 % config to that list", () => {
		const props = listProps(source);
		expect(props).toContain("onViewableItemsChanged={viewability}");
		expect(props).toContain("viewabilityConfig={VIEWABILITY_CONFIG}");
	});

	it("feeds the tracker from the list's answer, not from a mount", () => {
		/* The callback the list receives must reach `receipts.render` — the call
		 * site round 1 never had. */
		const adapter = source.slice(
			source.indexOf("const viewability = useRef("),
			source.indexOf("const response = inbox.response;"),
		);
		expect(adapter).toContain("receipts.render(");
		expect(adapter).toContain('item.kind !== "row"');
	});

	it("gives the feed the presence facts it needs, including coverage", () => {
		const call = source.slice(
			source.indexOf("useReceiptFeed({"),
			source.indexOf("});", source.indexOf("useReceiptFeed({")),
		);
		expect(call).toContain("covered:");
		/* The focus fact is the ROUTE's, computed from the path: round 2 tracked it
		 *  with a transition effect and a cold arrival never fired it (QA Q5). */
		expect(call).toContain("focused,");
		expect(source).toContain('usePathname() === "/notifications"');
		/* ...and the detail derives the complement from the same source. */
		expect(
			readFileSync(
				new URL("./notification-detail.tsx", import.meta.url),
				"utf8",
			),
		).toContain('usePathname().startsWith("/notifications/")');
		expect(call).toContain("enabled:");
		/* `covered` must be derived, not hard-coded: round 1 shipped
		 * `setCovered(false)` beside a dialog over the same list. */
		expect(call).not.toContain("covered: false");
	});

	it("records a touch on the list's own surface", () => {
		/* The gesture is what makes a receipt evidence; it is recorded on the
		 *  list (a swipe between two rows still counts), not on each row. */
		expect(source).toContain('onTouchStart={() => noteInput("touch")}');
	});
});

describe("the pushed detail reads only on evidence", () => {
	const detail = readFileSync(
		new URL("./notification-detail.tsx", import.meta.url),
		"utf8",
	);

	it("does not mark the item read on mount", () => {
		/* Round 1 sent `patchNotifications({op:"read"})` as soon as the fetch
		 * resolved — no gesture, no foreground check — so merely opening an item
		 * cleared it (code review M2). The detail's read is the feed's now. */
		expect(detail).not.toContain('op: "read"');
		expect(detail).toContain("useReceiptFeed({");
		expect(detail).toContain("receipts.render(");
	});

	it("records the reader's own gesture on the detail's scroll region", () => {
		expect(detail).toContain('onTouchStart={() => noteInput("touch")}');
	});
});
