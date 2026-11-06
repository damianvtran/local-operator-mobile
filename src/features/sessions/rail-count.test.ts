import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { inboxBadgeCount } from "./session-projection";

/**
 * The sidebar footer's destinations and the inbox count, asserted over the
 * SOURCE (the pane reaches `uniwind` through `@/ui`, which the Node test host
 * cannot import — the same reason every pane test here is static).
 *
 * WHAT CHANGED, AND WHY THE OLD INVARIANTS ARE GONE. The footer used to be five
 * full-width centred buttons (328 pt of an 874 pt panel, TestFlight 365 D-B1),
 * and the Notifications button carried its count beside a centred label — which
 * needed an invisible mirror pill and a measured placement (D19–D23) to keep the
 * label on the centre line. The 2026-11-04 decision record (§3) replaced those
 * rows with ONE strip of equal icon-over-label slots, and the count sits on the
 * Inbox ICON's corner, out of flow. Out of flow, it cannot push the label off
 * centre, so the mirror and the placement have nothing left to solve.
 *
 * The rules that remain: one count component, capped with the app's one label;
 * the count never moves the label; and at large text the strip becomes one
 * "More" row whose sheet lists every destination — never a silently dropped one.
 */
const PANE = new URL("./conversations-pane.tsx", import.meta.url);
const source = readFileSync(PANE, "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");
const COUNT_ON_ICON = /<RailCount count=\{item\.count\} \/>/;

const footer = () => {
	const start = source.indexOf("const footer = (");
	const end = source.indexOf("\treturn (", start);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
};

describe("the sidebar's destinations (record §3)", () => {
	it("is one strip of equal slots, not a column of full-width buttons", () => {
		const block = flat(footer());
		expect(block).toContain("destinations.map((item) =>");
		expect(block).toContain(
			'className="min-w-0 flex-1 items-center justify-center gap-0.5"',
		);
		expect(block).not.toContain("<Button");
	});

	it("puts the inbox count on the icon, out of flow, so the label stays centred", () => {
		const block = flat(footer());
		expect(block).toMatch(COUNT_ON_ICON);
		expect(block).toContain('className="absolute"');
	});

	it("collapses to ONE More row at large text, whose sheet lists the same destinations", () => {
		const block = flat(footer());
		expect(block).toContain("{largeText ? (");
		expect(block).toContain("testID={CONTROL.sidebarMore}");
		const all = flat(source);
		expect(all).toContain("testID={CONTROL.sidebarDestinationsSheet}");
		// The sheet maps the SAME list the strip does, so nothing is dropped.
		expect(all.match(/destinations\.map\(\(item\) =>/g)?.length).toBe(2);
	});

	it("keeps the workspace row and Settings as the footer's second row", () => {
		const block = flat(footer());
		expect(block).toContain("<DrawerComputerRow");
		expect(block).toContain("testID={CONTROL.settingsButton}");
		// ONE switcher in the panel (D-B2): the header's is gone.
		expect(flat(source)).not.toContain("testID={CONTROL.sidebarSwitcher}");
	});

	it("caps the numeral with the app's one label", () => {
		const component = source.slice(
			source.indexOf("const RailCount = ("),
			source.indexOf("export const ConversationsPane = ("),
		);
		expect(component).toContain("label={countLabel(count)}");
	});
});

describe("the count the rail asks for", () => {
	it("is unread plus waiting, or nothing when the relay is silent", () => {
		expect(
			inboxBadgeCount({
				unread_count: 2,
				waiting_unread_count: 3,
			} as unknown as Parameters<typeof inboxBadgeCount>[0]),
		).toBe(5);
		// No block at all, and a block the relay could not read, are both "unknown":
		// no numeral rather than a zero the reader would trust.
		expect(inboxBadgeCount(null)).toBeNull();
		expect(
			inboxBadgeCount({} as unknown as Parameters<typeof inboxBadgeCount>[0]),
		).toBeNull();
	});
});
