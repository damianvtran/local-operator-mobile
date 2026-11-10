import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
	t: (key: string, params?: Record<string, unknown>) =>
		params === undefined ? key : `${key}:${JSON.stringify(params)}`,
}));

const {
	compactTitleChars,
	HEADER_AVATAR_PT,
	headerTitleChars,
	NO_TITLE_BUDGET,
} = await import("@/features/session/header");
const { headerSubtitle } = await import("@/features/session/health-copy");
const { middleTruncate } = await import("@/features/session/projection");

/**
 * The session header's title is cut by LAYOUT, once, at the tail (visual audit
 * D2). This file used to pin a character budget per viewport — 28 at 390 pt,
 * 62 stacked at 320 — and every one of those numbers was an estimate of
 * somebody else's layout. What is pinned now is that no such estimate exists:
 *
 *  1. the budget functions the session route still calls answer "no limit",
 *     so its `middleTruncate` is an identity for any name at any viewport;
 *  2. the control that draws the title asks the platform for a tail ellipsis
 *     and the right number of lines, and keeps the dot on the first line.
 *
 * The second half is asserted over the SOURCE, for the reason
 * `tags-wiring.test.ts` records: the component reaches `uniwind` through
 * `@/ui`, which Node cannot import. The rendered proof (does a 28-character
 * name fit a 230 pt box; where does the dot sit at 200 %) is the capture
 * rig's, and the PR says so.
 */
const HEALTH = readFileSync(
	new URL("./components/session-health.tsx", import.meta.url),
	"utf8",
);
const NAMES = [
	"Hello from the mock provider",
	"Index the vendor catalogue",
	"Refactor the relay client so that the reconnect path owns its own backoff",
	"x".repeat(400),
];
const VIEWPORTS = [
	{ width: 320, height: 568 },
	{ width: 390, height: 844 },
	{ width: 844, height: 390 },
	{ width: 1180, height: 820 },
];
const EXTRAS = { dot: true, menu: true, word: true, avatar: true };

describe("the header title has no character budget", () => {
	it("never truncates a name in JS, at any viewport, scale or chrome", () => {
		for (const viewport of VIEWPORTS)
			for (const scale of [1, 1.5, 2, 3])
				for (const native of [false, true])
					for (const name of NAMES) {
						expect(
							middleTruncate(
								name,
								headerTitleChars(viewport, EXTRAS, scale, native),
							),
						).toBe(name);
						expect(
							middleTruncate(
								name,
								compactTitleChars(viewport, scale, EXTRAS, native),
							),
						).toBe(name);
					}
	});

	it("answers 'no limit' rather than a large number that could still cut", () => {
		expect(NO_TITLE_BUDGET).toBe(Number.POSITIVE_INFINITY);
		expect(headerTitleChars({ width: 320, height: 568 })).toBe(NO_TITLE_BUDGET);
		expect(compactTitleChars({ width: 320, height: 568 }, 3)).toBe(
			NO_TITLE_BUDGET,
		);
	});

	it("still owns the agent picture's size", () => {
		expect(HEADER_AVATAR_PT).toBe(28);
	});
});

describe("the title control truncates by layout", () => {
	const title = HEALTH.slice(
		HEALTH.indexOf("<HealthDot health={health} lineBox={titleLineBox} />"),
	);

	it("draws one line inline and two when stacked, with a tail ellipsis", () => {
		expect(HEALTH).toContain("const titleLines = stacked ? 2 : 1;");
		const text = title.slice(0, title.indexOf("{title}"));
		expect(text).toContain("numberOfLines={titleLines}");
		expect(text).toContain('ellipsizeMode="tail"');
		// The name is drawn as given: no second truncation in the control.
		expect(HEALTH).not.toContain("middleTruncate");
	});

	it("keeps the dot beside the FIRST line when the name wraps", () => {
		// The dot is centred in a slot one title line tall, and the row is
		// top-aligned only where a second line can exist.
		expect(HEALTH).toContain("style={{ height: lineBox }}");
		expect(HEALTH).toContain(
			'lineBoxPt(compact ? "title" : "heading", effectiveScale)',
		);
		expect(HEALTH).toContain('stacked ? "items-start" : "items-center"');
	});
});

describe("the header subtitle shows no second clock", () => {
	it("says Working without the elapsed time the activity line already counts", () => {
		for (const elapsed of [null, "33s", "1m 36s"])
			expect(
				headerSubtitle({
					health: "live",
					working: true,
					waiting: false,
					elapsed,
				}),
			).toBe("relay.chrome.session.subtitle.working_plain");
	});

	it("keeps the other states' precedence", () => {
		expect(
			headerSubtitle({
				health: "live",
				working: true,
				waiting: true,
				elapsed: "5s",
			}),
		).toBe("relay.chrome.session.subtitle.waiting");
		expect(
			headerSubtitle({
				health: "live",
				working: false,
				waiting: false,
				elapsed: null,
			}),
		).toBe("relay.chrome.session.subtitle.idle");
	});
});
