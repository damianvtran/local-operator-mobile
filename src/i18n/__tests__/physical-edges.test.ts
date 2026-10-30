import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE PHYSICAL-EDGE GUARD: a new `pl-*`/`left-0`/`marginRight` in a screen fails
 * this test until somebody either converts it to its logical pair or records why
 * it has to stay physical.
 *
 * WHY IT EXISTS. Converting the app to start/end edges is a one-off sweep, and a
 * one-off sweep decays: the next row somebody adds will use `pl-2` because that
 * is what the row above it said six months ago, and the single Urdu session in
 * the product will silently keep one control on the wrong edge. The direction
 * itself is resolved in one place (`src/i18n/direction.ts` + `src/ui/direction.tsx`)
 * and the layout is expressed in logical utilities, so the ONE remaining way to
 * break an RTL layout is to state a physical edge — which is exactly what this
 * scan can see.
 *
 * WHAT IS ALLOWLISTED, AND WHY THAT IS NOT A LOOPHOLE. A few physical edges are
 * CORRECT and must stay physical:
 *
 *   - **Safe-area insets.** `insets.left`/`insets.right` describe physical device
 *     edges (a notch, a rounded corner). Converting them to start/end would ask
 *     the notch to move with the language.
 *   - **Fades and scrims painted against a physical viewport edge**, where the
 *     gradient is drawn in physical coordinates and its position has to agree
 *     with it.
 *   - **One documented holdout**: the conversations drawer, whose slide is a
 *     physical `translateX` — flipping its anchor without flipping the animation
 *     would slide it in from the wrong off-screen side. It is listed with its
 *     reason and flagged in `docs/i18n.md` as the follow-up that needs an RTL
 *     design round, not silently exempted here.
 *
 * The allowlist is per file AND per token AND carries a reason, so adding an
 * entry is a visible sentence in a diff rather than a blanket exemption.
 *
 * WHAT IT DELIBERATELY DOES NOT SEE: comment lines (a comment that says
 * "paddingLeft" is prose, and this repo's comments discuss the geometry they
 * replaced), numeric inset expressions other than the `0` shorthand
 * (`right: RAIL_EDGE_PT` was caught when the sweep ran and is converted now), and
 * anything outside `src/**` and `app/**`.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Sources the app renders from. `scripts/`, `tools/` and `e2e/` are not in here:
 *  they never lay a screen out. */
const SOURCE_ROOTS = ["src", "app"];

/** Physical flexbox/style spellings, each with the logical pair it should become.
 *
 *  The utility patterns are anchored on a word boundary on the left so `gap-x-2`
 *  or the word "explain" cannot match, and they only ever fire on a class token:
 *  the property patterns are the React Native style spellings, where the name IS
 *  the edge. */
const PATTERNS: { name: string; pattern: RegExp; instead: string }[] = [
	{
		name: "pl/pr utility",
		pattern: /(?<![\w-])-?p[lr]-\d/g,
		instead: "ps-* / pe-* (padding-inline-start/end)",
	},
	{
		name: "ml/mr utility",
		pattern: /(?<![\w-])-?m[lr]-\d|(?<![\w-])m[lr]-auto/g,
		instead: "ms-* / me-* (margin-inline-start/end)",
	},
	{
		name: "left/right utility",
		pattern: /(?<![\w-])-?(?:left|right)-\d/g,
		instead: "start-* / end-*",
	},
	{
		name: "text-left/text-right",
		pattern: /(?<![\w-])text-(?:left|right)\b/g,
		instead: "text-start / text-end",
	},
	{
		name: "border-l/border-r",
		pattern: /(?<![\w-])border-[lr](?:-\d+)?\b/g,
		instead: "border-s / border-e",
	},
	{
		name: "rounded-l/rounded-r",
		pattern: /(?<![\w-])rounded-[lr](?:[tb])?(?:-\w+)?\b/g,
		instead: "rounded-s* / rounded-e*",
	},
	{
		name: "margin/padding style prop",
		pattern: /\b(?:margin|padding)(?:Left|Right)\b/g,
		instead: "marginStart/End, paddingStart/End",
	},
	{
		name: "border style prop",
		pattern: /\bborder(?:Left|Right)(?:Width|Color)\b/g,
		instead: "borderStartWidth/EndWidth, borderStartColor/EndColor",
	},
	{
		name: "corner-radius style prop",
		pattern: /\bborder(?:Top|Bottom)(?:Left|Right)Radius\b/g,
		instead: "borderStartStartRadius / borderStartEndRadius",
	},
	{
		name: "textAlign literal",
		pattern: /\btextAlign:\s*["'](?:left|right)["']/g,
		instead:
			'a direction-dependent value, or a text-start/text-end class ("left"/"right" are the only values RN types accept)',
	},
	{
		name: "inset shorthand",
		pattern: /\b(?:left|right):\s*0\b/g,
		instead: "start: / end:",
	},
];

/** Physical edges that are CORRECT where they are. Keyed by file and token, each
 *  with the reason it must stay; a new file must justify its own entry. */
const ALLOWLIST: { file: string; token: string; reason: string }[] = [
	/* Safe-area insets, on every surface that pads for one. `insets.left` and
	 * `insets.right` are PHYSICAL: they describe a notch or a rounded corner on a
	 * specific side of the device. Converting them to start/end would ask the notch
	 * to move with the language. */
	{
		file: "src/ui/components/screen.tsx",
		token: "paddingLeft",
		reason: "safe-area inset: a physical edge, not a reading edge",
	},
	{
		file: "src/ui/components/screen.tsx",
		token: "paddingRight",
		reason: "safe-area inset: the other side of the same pair",
	},
	{
		file: "src/ui/components/sheet.tsx",
		reason: "safe-area inset on the sheet surface",
		token: "paddingLeft",
	},
	{
		file: "src/ui/components/sheet.tsx",
		reason: "safe-area inset on the sheet surface",
		token: "paddingRight",
	},
	{
		file: "src/ui/components/dialog.tsx",
		reason: "safe-area inset on a portalled dialog surface",
		token: "paddingLeft",
	},
	{
		file: "src/ui/components/dialog.tsx",
		reason: "safe-area inset on a portalled dialog surface",
		token: "paddingRight",
	},
	{
		file: "src/ui/components/toast.tsx",
		reason: "safe-area inset on the toast host",
		token: "paddingLeft",
	},
	{
		file: "src/ui/components/toast.tsx",
		reason: "safe-area inset on the toast host",
		token: "paddingRight",
	},
	/* THE ONE DOCUMENTED HOLDOUT. See `docs/i18n.md` "Urdu and right-to-left":
	 * the drawer's slide is a physical `translateX`, so flipping the anchor
	 * without flipping the animation would slide it in from the wrong off-screen
	 * side. It stays physical until an RTL design round owns that change; the
	 * entries exist so the guard keeps watching the rest of the file. */
	{
		file: "src/features/sessions/conversations-drawer.tsx",
		reason:
			"holdout: the drawer is anchored to the physical left edge and its slide is a physical translateX",
		token: "left-0",
	},
	{
		file: "src/features/sessions/conversations-drawer.tsx",
		reason: "holdout: the panel's facing edge while the anchor stays physical",
		token: "border-r",
	},
	{
		file: "src/features/sessions/conversations-drawer.tsx",
		reason:
			"holdout: the safe-area inset is spent out of the panel's physical anchor, which does not flip yet",
		token: "paddingLeft",
	},
	/* Mixed-content isolation itself: the ONE definition of "this text keeps its
	 * own direction". RN's `textAlign` type has no start/end, so the pair
	 * `writingDirection: "ltr"` + `textAlign: "left"` is the only way to state it. */
	{
		file: "src/ui/direction.tsx",
		reason:
			"the LTR_TEXT constant: RN's textAlign has no start/end, so a physical value is how mixed content states its own direction",
		token: 'textAlign: "left"',
	},
];

const isTest = (path: string) =>
	/\.(?:test|spec)\.(?:ts|tsx)$/.test(path) || path.includes(`__tests__${"/"}`);

const walk = (folder: string): string[] =>
	readdirSync(folder).flatMap((name) => {
		const path = join(folder, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

/** A line that is a comment (or a comment continuation) is prose, not geometry. */
const isComment = (line: string) => {
	const trimmed = line.trimStart();
	return (
		trimmed.startsWith("//") ||
		trimmed.startsWith("*") ||
		trimmed.startsWith("/*") ||
		trimmed.startsWith("{/*")
	);
};

type Finding = { file: string; line: number; token: string; instead: string };

const scan = (): Finding[] => {
	const findings: Finding[] = [];
	for (const root of SOURCE_ROOTS) {
		for (const path of walk(join(ROOT, root))) {
			if (!/\.(?:ts|tsx)$/.test(path) || isTest(path)) continue;
			const file = path.slice(ROOT.length);
			const lines = readFileSync(path, "utf8").split("\n");
			lines.forEach((line, index) => {
				if (isComment(line)) return;
				for (const { pattern, instead } of PATTERNS) {
					pattern.lastIndex = 0;
					for (const match of line.matchAll(pattern)) {
						findings.push({
							file,
							line: index + 1,
							token: match[0],
							instead,
						});
					}
				}
			});
		}
	}
	return findings;
};

describe("physical-edge guard", () => {
	it("scans a tree it can actually see (the guard must be able to fail)", () => {
		/* A guard that walks an empty list passes forever. This pins the size of
		 * the sweep to something a real tree produces, so a broken ROOT (or a moved
		 * directory) fails here instead of silently reporting a clean repo. */
		let files = 0;
		for (const root of SOURCE_ROOTS) {
			files += walk(join(ROOT, root)).filter(
				(path) =>
					/\.(?:ts|tsx)$/.test(path) && !isTest(path.slice(ROOT.length)),
			).length;
		}
		expect(files).toBeGreaterThan(100);
	});

	it("has no unexplained physical edge in src/ or app/", () => {
		const allowed = new Set(
			ALLOWLIST.map((entry) => `${entry.file}|${entry.token}`),
		);
		const violations = scan().filter(
			(finding) => !allowed.has(`${finding.file}|${finding.token}`),
		);
		/* The message is the whole point: it names the file, the line, the token and
		 * the logical pair, so a contributor can fix it without reading this file. */
		const message = violations
			.map(
				(v) =>
					`${v.file}:${v.line} uses the physical edge \`${v.token}\` — use ${v.instead}, or add an allowlist entry with a reason`,
			)
			.join("\n");
		expect(message).toBe("");
	});

	it("keeps every allowlist entry attached to a live finding", () => {
		/* An allowlist entry that no longer matches anything is a stale exemption:
		 * the code moved on, and the reason now describes nothing. That is how an
		 * exemption list rots into a list nobody dares remove. */
		const live = new Set(scan().map((f) => `${f.file}|${f.token}`));
		const stale = ALLOWLIST.map(
			(entry) => `${entry.file}|${entry.token}`,
		).filter((key) => !live.has(key));
		expect(stale).toEqual([]);
	});
});
