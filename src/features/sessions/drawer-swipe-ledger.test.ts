/**
 * The source ledger for the page swipe: no horizontal `ScrollView`, and no
 * claimed surface, may ship without saying who owns its touch.
 *
 * WHY A LEDGER. Arbitration on a device is a relation between recognisers that
 * a Node test cannot drag; what it CAN prove is that every surface which owns a
 * sideways touch is declared. A new table, chip row or pager added without
 * `HORIZONTAL_SCROLL_PROPS` would silently become a drawer gesture on a phone,
 * and the failure would only show up under a finger.
 *
 * Sites that are not `ScrollView`s at all (the inline chart's scrub) are claims
 * by construction, so the ledger asserts the claim too. The two exemptions are
 * named with the evidence that covers them — the composer is claimed at its
 * call sites because its own file belongs to another change, and the full-screen
 * diagram viewer and image pager live in `Modal`s ABOVE the stack, where the
 * page pan never sees a touch.
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SRC = new URL("../../", import.meta.url);
const APP = new URL("../../../app/", import.meta.url);

const read = (url: URL) => readFileSync(url, "utf8");

/** `<ScrollViewX` is a different component, not this one. */
const SCROLLVIEW_SUFFIX = /[A-Za-z0-9_]/;
const CLAIM = /<DrawerSwipeClaim>/;
/** `<DrawerSwipeClaim>` directly wrapping a `<Composer>` (whitespace between). */
const CLAIMED_COMPOSER = /<DrawerSwipeClaim>\s*<Composer\b/;
/** The chart's claim must wrap the plot's own root view, not a neighbour. */
const CHART_CLAIM = /<DrawerSwipeClaim>\s*\n\s*<View\s*\n\s*ref=\{rootRef\}/;
const SCREEN_LAYOUT = /screenLayout=/;

/** Every `.tsx` under a directory, repo-relative. */
const tsxFiles = (root: URL): URL[] => {
	const out: URL[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const child = new URL(
			`${entry.name}${entry.isDirectory() ? "/" : ""}`,
			root,
		);
		if (entry.isDirectory()) out.push(...tsxFiles(child));
		else if (entry.name.endsWith(".tsx")) out.push(child);
	}
	return out;
};

/** The opening tags of every `<ScrollView` in a source, brace- and string-aware
 *  so a `=>` or a `>` inside an expression cannot end a tag early. */
const scrollTags = (source: string): string[] => {
	const tags: string[] = [];
	let from = 0;
	for (;;) {
		const at = source.indexOf("<ScrollView", from);
		if (at === -1) return tags;
		const open = at + "<ScrollView".length;
		if (SCROLLVIEW_SUFFIX.test(source[open] ?? "")) {
			from = open;
			continue;
		}
		let depth = 0;
		let quote: string | null = null;
		let end = open;
		for (; end < source.length; end++) {
			const ch = source[end];
			if (quote !== null) {
				if (ch === quote) quote = null;
				continue;
			}
			if (ch === '"' || ch === "'") {
				quote = ch;
				continue;
			}
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
			else if (ch === ">" && depth === 0) break;
		}
		tags.push(source.slice(at, end + 1));
		from = end + 1;
	}
};

const HORIZONTAL_PROP = /\bhorizontal\b/;
const isHorizontal = (tag: string) => HORIZONTAL_PROP.test(tag);

const rel = (root: URL, file: URL) =>
	decodeURIComponent(file.href.slice(root.href.length));

/**
 * Sites whose touch is owned without the scroller props, because the surface
 * is not the thing the page pan meets — the composer is wrapped at its two call
 * sites, and the modal-hosted viewers sit above the route stack entirely.
 */
const EXEMPT: Array<{
	file: string;
	reason: string;
	witness: Array<{ file: URL; pattern: RegExp }>;
}> = [
	{
		file: "features/session/components/composer.tsx",
		reason:
			"PR #389 owns composer.tsx; the claim wraps it from home.tsx and session/[id].tsx",
		witness: [
			{
				file: new URL("../../features/home/home.tsx", import.meta.url),
				pattern: CLAIMED_COMPOSER,
			},
			{
				file: new URL("../../../app/(app)/session/[id].tsx", import.meta.url),
				pattern: CLAIMED_COMPOSER,
			},
		],
	},
];

describe("the drawer swipe's source ledger", () => {
	const files = tsxFiles(SRC);
	const sites = files.flatMap((file) =>
		scrollTags(read(file))
			.filter(isHorizontal)
			.map((tag) => ({ file, tag })),
	);

	it("finds the transcript's, library's and attachments' scrollers", () => {
		const names = new Set(sites.map((site) => rel(SRC, site.file)));
		/* A ledger over an empty set passes silently; these are the sites the
		 *  navigation model names, so their absence means the scan broke. */
		for (const expected of [
			"features/session/components/markdown.tsx",
			"features/session/components/diagram-block.tsx",
			"features/session/components/inline-ui-preview.tsx",
			"features/library/library-screen.tsx",
			"features/team-bridge/attachment-views.tsx",
			"features/session/components/composer.tsx",
		]) {
			expect(names, expected).toContain(expected);
		}
	});

	it("every horizontal scroller carries the shared props or is a named exemption", () => {
		const bare = sites
			.filter(({ tag }) => !tag.includes("HORIZONTAL_SCROLL_PROPS"))
			.filter(({ file }) => {
				const name = rel(SRC, file);
				return !EXEMPT.some((entry) => entry.file === name);
			})
			.map(({ file }) => rel(SRC, file));
		expect(bare).toEqual([]);
	});

	it("every exemption is real and keeps its witness", () => {
		for (const entry of EXEMPT) {
			const source = read(new URL(entry.file, SRC));
			expect(
				scrollTags(source)
					.filter(isHorizontal)
					.map((tag) => tag.includes("HORIZONTAL_SCROLL_PROPS")),
				`${entry.file} no longer has an uncovered horizontal scroller`,
			).toContain(false);
			for (const witness of entry.witness) {
				expect(read(witness.file), `${entry.file}: ${entry.reason}`).toMatch(
					witness.pattern,
				);
			}
		}
	});

	it("the non-scroller that scrubs (the inline chart) is under a claim", () => {
		const chart = read(
			new URL(
				"../../features/session/components/inline-chart.tsx",
				import.meta.url,
			),
		);
		expect(chart).toMatch(CLAIM);
		/* And the claim wraps the PLOT, not a neighbour: the scrub handlers live
		 *  on the plot's own root view. */
		expect(chart).toMatch(CHART_CLAIM);
	});

	it("the page host is mounted for every (app) screen, once", () => {
		const layout = read(new URL("(app)/_layout.tsx", APP));
		expect(layout).toContain("<PageSwipeHost");
		expect(layout).toMatch(SCREEN_LAYOUT);
	});
});
