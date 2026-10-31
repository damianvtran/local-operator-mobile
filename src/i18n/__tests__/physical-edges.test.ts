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
 *  the edge.
 *
 *  A utility's value is `\d`, `px`, or an arbitrary `[..]` value (`pr-[3px]`,
 *  `left-[4px]`): a pattern that only knew the numeric scale let `pl-px` and
 *  `pr-[3px]` through. `label` replaces the matched text as the allowlist token
 *  where the match is a whole expression rather than a name. */
const PATTERNS: {
	name: string;
	pattern: RegExp;
	instead: string;
	label?: string;
}[] = [
	{
		name: "pl/pr utility",
		pattern: /(?<![\w-])-?p[lr]-(?:\d|px\b|\[)/g,
		instead: "ps-* / pe-* (padding-inline-start/end)",
	},
	{
		name: "ml/mr utility",
		pattern: /(?<![\w-])-?m[lr]-(?:\d|px\b|auto\b|\[)/g,
		instead: "ms-* / me-* (margin-inline-start/end)",
	},
	{
		name: "scroll-ml/pl utility",
		pattern: /(?<![\w-])-?scroll-[mp][lr]-/g,
		instead: "scroll-ms-* / scroll-me-* / scroll-ps-* / scroll-pe-*",
	},
	{
		name: "left/right utility",
		pattern: /(?<![\w-])-?(?:left|right)-(?:\d|px\b|full\b|auto\b|\[)/g,
		instead: "start-* / end-*",
	},
	{
		name: "inset-x utility",
		pattern: /(?<![\w-])-?inset-x-/g,
		instead:
			"start-* + end-* (inset-x is symmetric, so it only stays when both edges are meant)",
	},
	{
		name: "space-x utility",
		pattern: /(?<![\w-])-?space-x-/g,
		instead: "gap-x-* on a flex parent (space-x is a physical left margin)",
	},
	{
		name: "text-left/text-right",
		/* `native:text-right` is half of TEXT_END_CLASS and is correct on its own. */
		pattern: /(?<!native:)(?<![\w-])text-(?:left|right)\b/g,
		instead: "TEXT_END_CLASS (src/ui/direction.tsx) / text-start",
	},
	{
		name: "bare text-end",
		/* `web:text-end` is the sanctioned spelling, so the `:` lookbehind lets the
		 * variant through. A bare `text-end` compiles to `textAlign: "end"` on native,
		 * which React Native does not accept (it logs and falls back to the LEADING
		 * edge), so it left-aligns a right-aligned column in English. */
		pattern: /(?<![\w:-])text-end\b/g,
		instead:
			"TEXT_END_CLASS (src/ui/direction.tsx): `text-end` is unsupported on native and regresses LTR",
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
		name: "rounded corner utility",
		pattern: /(?<![\w-])rounded-[tb][lr](?:-\w+)?\b/g,
		instead: "rounded-ss / rounded-se / rounded-es / rounded-ee",
	},
	{
		name: "float utility",
		pattern:
			/(?<![\w-])float-(?:left|right)\b|\bfloat:\s*["'](?:left|right)["']/g,
		instead: "float-start / float-end",
	},
	{
		name: "flex-row-reverse",
		pattern: /row-reverse/g,
		instead:
			"nothing physical: row-reverse follows the layout direction (Yoga/CSS flip it under RTL), so it is correct only where reading-order reversal is what is meant",
	},
	{
		name: "translate-x / translateX / scaleX",
		pattern: /(?<![\w-])-?(?:translate|scale)-x-|\b(?:translateX|scaleX)\b/g,
		instead:
			"a direction-aware offset (negate it when rtl), or a documented physical-axis effect",
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
		/* Not `["']` immediately after the colon: a ternary (`rtl ? "left" : "right"`)
		 * is still a physical alignment, and the composer clock was exactly that. */
		pattern: /\btextAlign:[^,}\n]*?["'](?:left|right|end)["']/g,
		label: "textAlign literal",
		instead:
			"TEXT_END_CLASS / LTR_TEXT (src/ui/direction.tsx), or a per-platform value: native RN swaps left/right itself under RTL, web does not, and `end` is unsupported on native",
	},
	{
		name: "inset style prop",
		/* A NUMBER (`left: 8`, `right: -4`), a CONSTANT (`right: RAIL_EDGE_PT`) or a
		 * device inset (`left: insets.left`): the values a style object gives an
		 * absolutely positioned edge, each as physical as `left: 0`. The value is
		 * constrained on purpose: a bare `left: <anything>` also matches parameter
		 * names and result fields (`left: ProjectionOwner`, `{ left: number }`), which
		 * are not edges. A COMPUTED value (`left: x + 1`, `left: rtl ? a : b`) is not
		 * seen, and is the documented limit of a line scan. The token is the property
		 * name, which is what an allowlist entry should name. */
		pattern: /\b(?:left|right)(?=:\s*(?:-?\d|[A-Z][A-Z0-9_]+\b|insets\.))/g,
		instead: "start: / end:",
	},
];

/** Physical edges that are CORRECT where they are. Keyed by file and token, each
 *  with the reason it must stay and the exact COUNT it may occur: a second
 *  `border-r` or `paddingLeft` in an allowlisted file is a new physical edge nobody
 *  justified, so it fails like any other. A new file must justify its own entry. */
const ALLOWLIST: {
	file: string;
	token: string;
	/** EXACTLY how many occurrences of the token the file may hold. */
	count: number;
	reason: string;
}[] = [
	/* Safe-area insets, on every surface that pads for one. `insets.left` and
	 * `insets.right` are PHYSICAL: they describe a notch or a rounded corner on a
	 * specific side of the device. Converting them to start/end would ask the notch
	 * to move with the language. */
	{
		file: "src/ui/components/screen.tsx",
		token: "paddingLeft",
		count: 1,
		reason: "safe-area inset: a physical edge, not a reading edge",
	},
	{
		file: "src/ui/components/screen.tsx",
		token: "paddingRight",
		count: 1,
		reason: "safe-area inset: the other side of the same pair",
	},
	{
		file: "src/ui/components/sheet.tsx",
		reason: "safe-area inset on the sheet surface",
		token: "paddingLeft",
		count: 1,
	},
	{
		file: "src/ui/components/sheet.tsx",
		reason: "safe-area inset on the sheet surface",
		token: "paddingRight",
		count: 1,
	},
	{
		file: "src/ui/components/dialog.tsx",
		reason: "safe-area inset on a portalled dialog surface",
		token: "paddingLeft",
		count: 1,
	},
	{
		file: "src/ui/components/dialog.tsx",
		reason: "safe-area inset on a portalled dialog surface",
		token: "paddingRight",
		count: 1,
	},
	{
		file: "src/ui/components/toast.tsx",
		reason: "safe-area inset on the toast host",
		token: "paddingLeft",
		count: 1,
	},
	{
		file: "src/ui/components/toast.tsx",
		reason: "safe-area inset on the toast host",
		token: "paddingRight",
		count: 1,
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
		count: 1,
	},
	{
		file: "src/features/sessions/conversations-drawer.tsx",
		reason: "holdout: the panel's facing edge while the anchor stays physical",
		token: "border-r",
		count: 1,
	},
	{
		file: "src/features/sessions/conversations-drawer.tsx",
		reason:
			"holdout: the safe-area inset is spent out of the panel's physical anchor, which does not flip yet",
		token: "paddingLeft",
		count: 1,
	},
	/* Mixed-content isolation itself: the ONE definition of "this text keeps its
	 * own direction". RN's `textAlign` type has no start/end, so the pair
	 * `writingDirection: "ltr"` + `textAlign: "left"` is the only way to state it. */
	{
		file: "src/ui/direction.tsx",
		reason:
			"the LTR_TEXT constant: RN's textAlign has no start/end, so a physical value is how mixed content states its own direction",
		token: "textAlign literal",
		count: 1,
	},
	/* Per-platform text alignment, written as a ternary on `Platform.OS`: web
	 * `right` is physical (so an RTL document needs `left`) while native `right`
	 * is already trailing (RN swaps it under RTL). See the comment at the site. */
	{
		file: "src/features/session/components/composer.tsx",
		token: "textAlign literal",
		count: 1,
		reason:
			"the dictation clock's per-platform trailing alignment: web needs the physical flip, native must not have it",
	},
	/* Physical-axis motion. A shimmer segment sweeping across a track is a
	 * decoration on a physical axis; its mirror in RTL is a design decision, not a
	 * conversion. The drawer's translateX is the documented holdout above. */
	{
		file: "src/features/session/components/imagegen-card.tsx",
		token: "translateX",
		count: 1,
		reason:
			"the indeterminate sweep's physical-axis animation (documented in the component)",
	},
	{
		file: "src/features/sessions/conversations-drawer.tsx",
		token: "translateX",
		count: 1,
		reason:
			"holdout: the drawer's slide is physical and must flip together with its anchor",
	},
	/* Device edges. `insets.left`/`insets.right` are physical by definition. */
	{
		file: "src/ui/components/sheet.tsx",
		token: "left",
		count: 1,
		reason:
			"the body fade spans the sheet between the device's safe-area insets",
	},
	{
		file: "src/ui/components/sheet.tsx",
		token: "right",
		count: 1,
		reason: "the other safe-area inset of the same pair",
	},
	{
		file: "src/ui/components/toast.tsx",
		token: "inset-x-",
		count: 1,
		reason:
			"symmetric: both edges get the same 16 pt, so the pair cannot be on the wrong side",
	},
];

const isTest = (path: string) =>
	/\.(?:test|spec)\.(?:ts|tsx)$/.test(path) || path.includes(`__tests__${"/"}`);

const walk = (folder: string): string[] =>
	readdirSync(folder).flatMap((name) => {
		const path = join(folder, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

/**
 * The source with every comment blanked to spaces (newlines kept, so line numbers
 * still point at the real line).
 *
 * WHY A SCANNER AND NOT A LINE-PREFIX TEST. The first guard skipped any line that
 * STARTED with `//`, `*`, `/*` or `{/*`, which also skipped the code after a
 * comment closed: `{/* x *\/} <View className="pl-2" />` and `/* x *\/
 * className="pr-3"` both passed. A comment is a span, not a line, so this walks
 * the text once and tracks whether it is inside one.
 *
 * STRINGS ARE TRACKED ONLY SO THEIR CONTENTS CAN NOT OPEN A COMMENT (`"http://x"`,
 * a glob like `"src/**\/*.ts"`); their text stays visible to the scan, because a
 * class list IS a string. The deliberate failure mode is fail-closed: an
 * apostrophe in JSX text opens a "string" that closes at the end of the line, which
 * can only leave a real comment unstripped (a false finding), never hide code.
 */
const stripComments = (source: string): string => {
	let out = "";
	let i = 0;
	let quote: string | null = null;
	while (i < source.length) {
		const ch = source[i] as string;
		const next = source[i + 1];
		if (quote) {
			out += ch;
			if (ch === "\\" && next !== undefined) {
				out += next;
				i += 2;
				continue;
			}
			/* `'` and `"` end at the line break (an unterminated one is JSX prose);
			 * a template literal may span lines. */
			if (ch === quote || (ch === "\n" && quote !== "`")) quote = null;
			i += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			const close = source.indexOf("*/", i + 2);
			const end = close === -1 ? source.length : close + 2;
			out += source.slice(i, end).replace(/[^\n]/g, " ");
			i = end;
			continue;
		}
		if (ch === "/" && next === "/") {
			const eol = source.indexOf("\n", i);
			const end = eol === -1 ? source.length : eol;
			out += " ".repeat(end - i);
			i = end;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") quote = ch;
		out += ch;
		i += 1;
	}
	return out;
};

type Finding = { file: string; line: number; token: string; instead: string };

const scanSource = (file: string, source: string): Finding[] => {
	const findings: Finding[] = [];
	stripComments(source)
		.split("\n")
		.forEach((line, index) => {
			for (const { pattern, instead, label } of PATTERNS) {
				pattern.lastIndex = 0;
				for (const match of line.matchAll(pattern)) {
					findings.push({
						file,
						line: index + 1,
						token: label ?? match[0],
						instead,
					});
				}
			}
		});
	return findings;
};

const scan = (): Finding[] => {
	const findings: Finding[] = [];
	for (const root of SOURCE_ROOTS) {
		for (const path of walk(join(ROOT, root))) {
			if (!/\.(?:ts|tsx)$/.test(path) || isTest(path)) continue;
			findings.push(
				...scanSource(path.slice(ROOT.length), readFileSync(path, "utf8")),
			);
		}
	}
	return findings;
};

/** How many times each file+token occurs, so the allowlist can state an exact count. */
const counts = (findings: Finding[]) => {
	const map = new Map<string, number>();
	for (const f of findings) {
		const key = `${f.file}|${f.token}`;
		map.set(key, (map.get(key) ?? 0) + 1);
	}
	return map;
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

	it("has no unexplained physical edge in src/ or app, and no more occurrences than each allowlist entry states", () => {
		const allowed = new Map(
			ALLOWLIST.map((entry) => [`${entry.file}|${entry.token}`, entry.count]),
		);
		const seen = new Map<string, number>();
		const violations = scan().filter((finding) => {
			const key = `${finding.file}|${finding.token}`;
			const used = (seen.get(key) ?? 0) + 1;
			seen.set(key, used);
			/* Per OCCURRENCE: the first `count` hits are the justified ones, anything
			 * beyond is a new edge. */
			return used > (allowed.get(key) ?? 0);
		});
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

	it("keeps every allowlist entry attached to exactly the live findings it counts", () => {
		/* An allowlist entry that no longer matches anything is a stale exemption:
		 * the code moved on, and the reason now describes nothing. A count that is
		 * higher than the live number is the same rot at smaller scale (a removed
		 * edge leaves a slot that a NEW one silently fills). */
		const live = counts(scan());
		const drift = ALLOWLIST.flatMap((entry) => {
			const found = live.get(`${entry.file}|${entry.token}`) ?? 0;
			return found === entry.count
				? []
				: [
						`${entry.file} ${entry.token}: allowlisted ${entry.count}, found ${found}`,
					];
		});
		expect(drift).toEqual([]);
	});
});

describe("physical-edge guard: the scanner itself", () => {
	/* Each pattern below is one the first version of the guard let through, and
	 * each case would have to be true for the guard to be worth having: a pattern
	 * that cannot fail is decoration. */
	const tokens = (source: string) =>
		scanSource("probe.tsx", source).map((f) => f.token);

	it.each([
		["pl-px", '<View className="pl-px" />'],
		["pr-[", '<View className="pr-[3px]" />'],
		["-mr-px", '<View className="-mr-px" />'],
		["ml-[", '<View className="ml-[4px]" />'],
		["left-px", '<View className="absolute left-px" />'],
		["left-[", '<View className="absolute left-[4px]" />'],
		["rounded-tl-lg", '<View className="rounded-tl-lg" />'],
		["rounded-br", '<View className="rounded-br" />'],
		["scroll-ml-", '<View className="scroll-ml-2" />'],
		["space-x-", '<View className="flex-row space-x-2" />'],
		["inset-x-", '<View className="absolute inset-x-2" />'],
		["row-reverse", '<View className="flex-row-reverse" />'],
		["float-left", '<View className="float-left" />'],
		["text-end", '<Text className="text-end" />'],
		["translateX", "const a = { transform: [{ translateX: 4 }] };"],
		["left", "const a = { position: 'absolute', left: 8 };"],
		["right", "const a = { right: RAIL_EDGE_PT };"],
		["left", "const a = { left: insets.left };"],
		["textAlign literal", 'const a = { textAlign: rtl ? "left" : "right" };'],
		["textAlign literal", 'const a = { textAlign: "end" };'],
	])("catches %s", (token, source) => {
		expect(tokens(source)).toContain(token);
	});

	it("does not flag the sanctioned spellings or non-edges", () => {
		expect(
			tokens('<Text className="web:text-end native:text-right" />'),
		).toEqual([]);
		expect(
			tokens("const f = (left: Owner | null, right: Owner) => left;"),
		).toEqual([]);
		expect(tokens("type B = { left: number; right: number };")).toEqual([]);
		expect(tokens('<View className="ps-2 pe-px ms-auto gap-x-2" />')).toEqual(
			[],
		);
	});

	it("cannot be bypassed by code that follows a comment on the same line", () => {
		/* The first guard skipped any line that STARTED with a comment marker. */
		expect(tokens('{/* x */} <View className="pl-2" />')).toEqual(["pl-2"]);
		expect(tokens('/* x */ className="pr-3" />;')).toEqual(["pr-3"]);
		expect(tokens('<View className="pl-2" /> {/* trailing */}')).toEqual([
			"pl-2",
		]);
	});

	it("ignores a comment's own text, in every comment form", () => {
		expect(tokens("// pl-2 and marginLeft in a line comment")).toEqual([]);
		expect(tokens("/* pr-3 in a block comment */")).toEqual([]);
		expect(tokens("/**\n * paddingRight over\n * several lines\n */")).toEqual(
			[],
		);
		expect(tokens("{/* pl-2 in a JSX comment */}")).toEqual([]);
		expect(tokens("const a = 1; // trailing marginLeft")).toEqual([]);
	});

	it("keeps real line numbers across a multi-line comment", () => {
		const found = scanSource(
			"probe.tsx",
			'/*\n * one\n * two\n */\n<View className="pl-2" />',
		);
		expect(found.map((f) => f.line)).toEqual([5]);
	});

	it("is not opened by comment markers inside strings", () => {
		/* A URL's `//` or a glob's `/*` must not swallow the code after it. */
		expect(tokens('const u = "http://x"; const c = "pl-2";')).toEqual(["pl-2"]);
		expect(tokens('const g = "src/**/*.ts"; const c = "pr-3";')).toEqual([
			"pr-3",
		]);
	});
});
