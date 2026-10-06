#!/usr/bin/env node

/**
 * The canary run: capture the audit fixture, audit it, and assert both directions.
 *
 *   node e2e/run-canary.ts [--worktree <path>] [--out <dir>]
 *
 * Why this exists: **an instrument that cannot fail is worthless.** The fixture
 * page declares its own defects as `data-defect="U-xx"` attributes, so this
 * script can assert that the audit caught every declared one — and that the same
 * audit passes the clean path of the same page. Either half alone is a trap: an
 * audit that fails everything would pass the first assertion, and one that
 * passes everything would pass the second.
 *
 * Plain Node with no dependencies, so it runs anywhere the other tools do
 * (ADR 0003). Exit code 0 means the instrument is discriminating.
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	SUB_RULE_TEXT,
	U03_SUPPRESSION,
	U08_SUPPRESSION,
	U10_DECLARATION,
	U40_DEFERRAL,
} from "../tools/audit/checks.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKTREE = resolve(HERE, "..");

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

/** The manifest fields this script reads, as the capture harness writes them. */
interface CanaryManifest {
	meta: Record<string, unknown>;
	records: Array<{ screen: string; [key: string]: unknown }>;
}

/** One audit row, as the report writes it. */
interface AuditRow {
	check: string;
	verdict: string;
	screen?: string;
	state?: string;
	measured?: string | null;
	/** The finding's text: where a row is tied back to the element it caught. */
	detail?: string | null;
}

/** The audit report fields this script reads. */
interface AuditReport {
	cells: number;
	rows: AuditRow[];
	blocked?: number;
	verdict?: string;
}

const readReport = (path: string): AuditReport => {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	const bag =
		typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	const rows = Array.isArray(bag.rows) ? (bag.rows as AuditRow[]) : [];
	return { cells: typeof bag.cells === "number" ? bag.cells : 0, rows };
};

const readManifest = (path: string): CanaryManifest => {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	const bag =
		typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	const records = Array.isArray(bag.records)
		? (bag.records as Array<{ screen: string }>)
		: [];
	// `meta` is carried through verbatim: the audit reads `buildDir` (to serve the
	// build), `relay` (to proxy it) and `textScaleLive` off it, so replacing it
	// with an empty object makes the clean run unable to render anything at all.
	const meta =
		typeof bag.meta === "object" && bag.meta !== null
			? (bag.meta as Record<string, unknown>)
			: {};
	return { meta, records };
};

const worktree = flag("worktree", DEFAULT_WORKTREE);
/**
 * A mutation self-test hook: blind one rule and check this canary notices.
 *
 * `--blind U-04` silences a whole check, `--blind U-05:top` one independent rule
 * inside one. It is not a way to get a green run — a blinded run is not evidence
 * and `verify.ts` uses it only to prove the canary still fails when a rule dies.
 */
const blind = args.flatMap((arg, index) =>
	arg === "--blind" && args[index + 1] !== undefined
		? [args[index + 1] ?? ""]
		: [],
);
/**
 * A smaller device/theme/scale set for the mutation self-test, which runs this
 * script once per blinded rule and cannot afford the full matrix each time. The
 * landscape device stays in it because U-05's side rules only exist there.
 */
const fast = args.includes("--fast");
/**
 * Shared-capture modes, so the mutation self-test stops paying for the same
 * matrix seven times.
 *
 * The captured matrix is IDENTICAL for every blinded rule — only the audit's
 * `--blind` differs — yet each rule used to re-capture it: seven heavy 48-frame
 * captures where one suffices. That churn is what stepped swap 1.5 GiB in 150 s
 * and aborted three sweeps in the suite's opening phase.
 *
 * The audits themselves are NOT Chrome-free (`tools/audit/audit.ts` launches a
 * browser), so the mutation group's launch count goes from about twenty-one to
 * about fifteen; the saving is in the captures, not in the audits.
 *
 * `--capture-only` writes the matrix and prints its manifest path; `--manifest
 * <path>` audits a manifest captured earlier. Neither changes what is asserted:
 * the same cells, devices, themes, scales and fixtures are used, and the verdict
 * logic below is untouched.
 */
const captureOnly = args.includes("--capture-only");
// The caller may name the throwaway profile, so a killed attempt can be reaped by
// the exact path it used rather than by a root that a fresh call re-mints empty.
const profileOverride = flag("profile", "");
const manifestOverride = flag("manifest", "");

/**
 * The rule names the mutation self-test blinds. `--manifest` and `--capture-only`
 * are the shared-capture pair; a mistyped rule name is an error here rather than a
 * silent PASS, because the audit exits 2 both for "defects were found" and for
 * "this blind matched nothing" — so without this check a typo produced
 * `defect-page exit: 2 (non-zero expected)` and a green canary.
 */
const KNOWN_BLINDS = new Set([
	"U-04",
	"U-05:top",
	// The top rule's dialog shape (content inside an aria-modal dialog raised
	// into the band): its own sub-rule since review round 4, so blinding it
	// misses exactly #dialog-band-control while blinding U-05:top misses exactly
	// the two fixtures its single top-edge wording catches — #full-bleed and
	// #translucent-bar, the latter re-declared from U-08 in #50. `verify.ts`
	// names both in its expected set.
	"U-05:top-dialog",
	"U-05:bottom",
	"U-05:left",
	"U-05:right",
	"U-07:x",
	"U-07:y",
	// U-08's escape branches: the overlaps a clip test walking every ancestor swallows. Both
	// are blindable so the mutation self-test can prove each is load-bearing — blinding one
	// must make the canary miss exactly that shape's fixture (review rounds 3 and 4).
	"U-08:escape-absolute",
	"U-08:escape-fixed",
	// The S5 redesign's rules (U-38…U-42). Each is blindable so the mutation
	// self-test proves it is the rule that fires: U-38 has two (the leak scan and
	// the table structure), U-40's two directions are separately load-bearing
	// (a missing cue and a false one), and U-41's rail and caret are independent.
	"U-38:leak",
	"U-38:rows",
	"U-39",
	"U-40:cue",
	"U-40:false",
	"U-41:rail",
	"U-41:caret",
	"U-42",
]);

// An empty `--manifest` is a caller bug, not "no override". Treating it as the
// latter is what let a failed shared capture silently fall back to capturing the
// matrix once per rule — the footprint this pair of modes exists to remove.
if (args.includes("--manifest") && manifestOverride === "") {
	console.error(
		"run-canary: --manifest needs a path (an empty value is not 'no override')",
	);
	process.exit(2);
}
// A bare or trailing `--blind` used to be dropped by the `flatMap` above, so the
// canary ran UNBLINDED and printed PASS — a typo reading as evidence. The value
// must exist, and this check sits with the other argument validation, before any
// code that could launch a browser.
for (let index = 0; index < args.length; index += 1) {
	if (args[index] === "--blind" && args[index + 1] === undefined) {
		console.error(
			"run-canary: --blind needs a rule name; known rules: " +
				[...KNOWN_BLINDS].join(", "),
		);
		process.exit(2);
	}
}
for (const spec of blind) {
	if (!KNOWN_BLINDS.has(spec)) {
		console.error(
			`run-canary: unknown --blind '${spec}'; known rules: ${[...KNOWN_BLINDS].join(", ")}`,
		);
		process.exit(2);
	}
}

// A unique output directory per run, and never a shared fixed name: two canaries
// — a developer's and CI's, or two shards — otherwise write one manifest and one
// report over each other mid-run, and each reads the other's numbers.
const scratchRoot = process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir();
// Only mint a scratch directory when the caller did not name one: the eager
// fallback created a temp directory on EVERY run, including the audit-only runs
// that write into the caller's `--out`, and leaked it.
const outFlag = flag("out", "");
const out =
	outFlag !== "" ? outFlag : mkdtempSync(join(scratchRoot, "canary-"));
const canaryDir = join(worktree, "e2e", "fixtures", "audit-canary");

/**
 * The design tokens gate the per-frame canvas comparison, and they are resolved
 * from the REPOSITORY — never from a path outside it.
 *
 * The earlier revision also looked in an agent's scratchpad, and that fallback
 * was load-bearing: with it removed the canary printed FAIL, so the PASS it had
 * been printing was not reproducible from the repository at all. A canary that
 * cannot find the tokens now exits non-zero with the reason, rather than
 * continuing with the comparison skipped.
 */
const tokens = join(worktree, "design", "tokens", "tokens.json");
if (!existsSync(tokens)) {
	console.error(
		`canary: design tokens not found at ${tokens}.\n` +
			"The design kit ships them (design/tokens/tokens.json); without them the canvas-vs-token\n" +
			"comparison cannot run, and a canary that cannot run a check must not report PASS.",
	);
	process.exit(2);
}

const run = (label: string, command: string, commandArgs: string[]): number => {
	console.log(`\n=== ${label}`);
	const result = spawnSync(command, commandArgs, {
		stdio: "inherit",
		cwd: worktree,
	});
	return result.status ?? 2;
};

const npx = process.execPath;

console.log(`canary: ${canaryDir}`);
console.log(`tokens: ${tokens}`);
console.log(`out:    ${out}`);

/** The manifest this run audits: its own capture, or the one `--manifest` named. */
const manifestPath =
	manifestOverride === "" ? join(out, "manifest.json") : manifestOverride;

if (manifestOverride === "") {
	const captureStatus = run("capture the canary matrix", npx, [
		join(worktree, "tools", "visual", "capture.ts"),
		"--dir",
		canaryDir,
		"--out",
		out,
		"--cells",
		"path:/defects/defects,path:/clean/clean",
		// `iphone-15-landscape` is here for U-05's left/right rules: in portrait those
		// insets are 0, so the two side defects have no fixture input at all and a
		// blind to either sub-rule used to pass unnoticed.
		"--devices",
		fast
			? "iphone-15,iphone-15-landscape"
			: "iphone-se,iphone-15,iphone-15-landscape",
		// Both themes stay in the fast set: U-03's colour-only status is caught through
		// the palette, and a defect that only one theme's colours expose would go
		// missing in the mutation self-test for a reason that has nothing to do with
		// the rule being blinded.
		"--themes",
		"dark,light",
		"--scales",
		"100,200",
		"--consecutive",
		"--tokens",
		tokens,
		...(profileOverride !== "" ? ["--profile", profileOverride] : []),
		"--yes",
	]);
	if (captureStatus !== 0) {
		console.error(`\ncapture failed (${captureStatus}); the canary cannot run`);
		process.exit(captureStatus);
	}

	if (captureOnly) {
		// Hand the manifest path to the caller so it can audit it per rule.
		console.log(`manifest: ${join(out, "manifest.json")}`);
		process.exit(0);
	}
}

const tokenArgs = ["--tokens", tokens];
const defectsStatus = run(
	"audit the defect page (a non-zero exit is the expected result)",
	npx,
	[
		join(worktree, "tools", "audit", "audit.ts"),
		"--manifest",
		// The audited manifest is whichever this run is entitled to read: its own
		// capture, or the one `--manifest` handed it. Reading `out/manifest.json`
		// here looked correct only while every run captured its own.
		manifestPath,
		// The report directory, named explicitly: the audit otherwise roots its
		// report at the manifest's directory, which is this run's own `out` only
		// while the run also captured the manifest. Under `--manifest` those differ,
		// and the report is then read from a directory nothing wrote to.
		"--out",
		out,
		"--settle",
		"900",
		"--quiet",
		...blind.flatMap((spec) => ["--blind", spec]),
		...tokenArgs,
	],
);

// The clean path on its own, so a failure of the defect run cannot be excused by
// "the audit fails on everything".
// A manifest from `--manifest` was captured by an earlier invocation; otherwise
// this run captured its own.
const manifest = readManifest(manifestPath);
if (manifest.records.length === 0) {
	console.error(
		"\ncanary: the capture produced no frames, so neither direction can be asserted",
	);
	process.exit(1);
}
const cleanManifest = {
	meta: { ...manifest.meta },
	records: manifest.records.filter((record: { screen: string }) =>
		record.screen.includes("clean"),
	),
};
// The clean direction must be *non-vacuous*: a filter that matched nothing would
// produce `0 cells, 0 FAIL` and read as a pass, which is exactly the vacuity the
// reviewer demonstrated by making the filter match nothing.
if (cleanManifest.records.length === 0) {
	console.error(
		"\ncanary: no clean-page records were selected; the second direction would be vacuous",
	);
	process.exit(1);
}
const cleanManifestPath = join(out, "clean-manifest.json");
mkdirSync(dirname(cleanManifestPath), { recursive: true });
writeFileSync(cleanManifestPath, `${JSON.stringify(cleanManifest, null, 2)}\n`);
// Its own report directory: both runs are otherwise rooted at the manifest's
// directory, and the clean run would overwrite the defect run's report — which
// silently turned the first assertion into a comparison of one report with
// itself.
const cleanReportDir = join(out, "clean-report");
const cleanStatus = run("audit the clean page (must pass)", npx, [
	join(worktree, "tools", "audit", "audit.ts"),
	"--manifest",
	cleanManifestPath,
	"--out",
	cleanReportDir,
	"--settle",
	"900",
	"--quiet",
	...tokenArgs,
]);

const defects = readReport(join(out, "audit-report.json"));
const clean = readReport(join(cleanReportDir, "audit-report.json"));
const html = readFileSync(join(canaryDir, "index.html"), "utf8");

/**
 * The fixture's declared defects, each as `<marker>` → `<element id>`.
 *
 * A marker names the INDEPENDENT RULE, not the check (`U-05-top`, `U-07-x`), and
 * the assertion below is per defect rather than per check id. That distinction is
 * the whole finding this replaced: asserting per check let a check with two rules
 * keep passing with one of them dead, and let U-04 — which no element declared —
 * sit unasserted entirely.
 *
 * The element id is how a row is tied to the defect it caught: the probe's path
 * carries `#id`, so a FAIL row for `#clipped-x` names the horizontal rule and not
 * merely "U-07 somewhere".
 */
interface Defect {
	marker: string;
	/** The check the marker's rule belongs to (`U-05-top` → `U-05`). */
	check: string;
	/** The independent rule inside that check, when the marker names one. */
	rule: string | null;
	element: string;
}

const declaredDefects = (): Defect[] => {
	const out: Defect[] = [];
	// Every tag carrying a `data-defect`, with its own `id` read from the same tag.
	for (const tag of html.matchAll(
		/<[a-z0-9]+\b[^>]*data-defect="([^"]+)"[^>]*>/gi,
	)) {
		const marker = tag[1] ?? "";
		if (marker === "" || marker.endsWith("-exception")) continue;
		const element = /\bid="([^"]+)"/.exec(tag[0])?.[1];
		if (element === undefined) {
			console.error(
				`canary: the defect '${marker}' is declared on an element with no id, so nothing ` +
					"can tie a caught row back to it. Give the element an id.",
			);
			process.exit(2);
		}
		// A marker is `<check>` (`U-06`) or `<check>-<branch>` (`U-05-top`). The check
		// id is its first two dash-separated parts — not the first one, which is just
		// the `U` prefix.
		const parts = marker.split("-");
		const check = parts.slice(0, 2).join("-");
		out.push({
			marker,
			check,
			// The branch, as the `SUB_RULE_TEXT` key spells it: `U-05-top` → `U-05:top`.
			rule: parts.length > 2 ? `${check}:${parts.slice(2).join("-")}` : null,
			element,
		});
	}
	return out;
};
const declared = declaredDefects();
// A branch marker with no pattern in `SUB_RULE_TEXT` would fall back to a
// check-level match and be weaker than it looks; that is a gap in the fixture or
// in the table, and it is refused rather than downgraded.
const patternless = declared
	.filter(
		(defect) =>
			defect.rule !== null && SUB_RULE_TEXT[defect.rule] === undefined,
	)
	.map((defect) => defect.marker);
if (patternless.length > 0) {
	console.error(
		`canary: no sub-rule pattern for ${patternless.join(", ")}. Add it to SUB_RULE_TEXT in ` +
			"tools/audit/checks.ts, or the assertion silently weakens to the whole check.",
	);
	process.exit(2);
}

/**
 * Which declared defects the audit caught, named per DEFECT.
 *
 * A defect is caught when a FAIL row exists for its check *and* that row's text
 * names the defect's element. Matching on the check alone is what let a dead
 * sub-rule pass.
 */
const rowNames = (row: AuditRow): string =>
	`${row.measured ?? ""} ${row.detail ?? ""}`;
const caught = [
	...new Set(
		defects.rows
			.filter((r: AuditRow) => r.verdict === "FAIL")
			.map((r: AuditRow) => r.check),
	),
];

const caughtByElement = declared.filter((defect) => {
	// The rule's own words, from the table the audit's mutation hook also reads.
	// Requiring only the check id and the element was too weak: `#full-bleed` is a
	// full-width pinned bar, so the left-edge rule flags it too, and blinding the
	// top-edge rule left the element still named by a row of the same check.
	const pattern =
		defect.rule === null ? null : (SUB_RULE_TEXT[defect.rule] ?? null);
	return defects.rows.some(
		(row: AuditRow) =>
			row.verdict === "FAIL" &&
			row.check === defect.check &&
			(pattern === null || pattern.test(rowNames(row))) &&
			rowNames(row).includes(`#${defect.element}`),
	);
});
/**
 * Elements the fixture declares the audit must NOT report, as `data-not-defect`.
 *
 * The mirror of `data-defect`, and the direction the clean page cannot cover: the clean
 * page has no defect to miss, so it says nothing about a rule that has been narrowed
 * until it can no longer fire. These elements carry the SHAPE a rule must stay silent on —
 * a pair whose layout boxes overlap while their painted regions do not, a control whose
 * layout top reaches into the notch band while its painted top sits at the inset's edge —
 * so a rule that starts reporting them fails here.
 */
interface NotDefect {
	check: string;
	element: string;
	/**
	 * The suppression reason this element must be RECORDED with, resolved from the
	 * rule's own exported table (`U08_SUPPRESSION`, `U03_SUPPRESSION`,
	 * `U10_DECLARATION`) by the fixture's `data-not-defect-reason`. `null` for a
	 * shape the fixture declares SILENT (`data-not-defect-silent`): the rule must not
	 * reach it at all — no row, of any verdict, under its own check — and the
	 * assertion is that absence rather than a recording.
	 */
	reason: string | null;
	/** True for a `data-not-defect-silent` element: assert NO row, not a recording. */
	silent: boolean;
}

/**
 * The name a fixture declares to the reason string it must be recorded with, per
 * check.
 *
 * THE CHOICE IS FORCED (QA round 2, Q2-1's second half): every `data-not-defect`
 * entry must EITHER name the reason it is RECORDED with, via
 * `data-not-defect-reason`, OR declare `data-not-defect-silent` — a shape the rule
 * must not reach at all. A missing reason used to be the quiet default, which
 * downgraded the assertion from "recorded with this reason" to "no FAIL row names
 * it": deleting `data-not-defect-reason="meter-series"` left the canary green,
 * because `unrecordedSuppressions` skips an entry with no reason. Neither
 * attribute, or both, is now an error.
 *
 * The strings come from the rules' own exported tables, so a reworded reason fails
 * here instead of leaving the canary asserting a sentence the audit no longer
 * writes. An unknown name is refused rather than downgraded.
 */
const NOT_DEFECT_REASON_NAMES: Record<string, Record<string, string>> = {
	"U-08": {
		"painted-disjoint": U08_SUPPRESSION.DISJOINT,
		"modal-layer": U08_SUPPRESSION.MODAL_LAYER,
		"modal-surface": U08_SUPPRESSION.MODAL_SURFACE,
	},
	"U-03": {
		"control-fill": U03_SUPPRESSION.CONTROL_FILL,
		"meter-series": U03_SUPPRESSION.METER_SERIES,
	},
	"U-10": {
		"text-entry-value": U10_DECLARATION.TEXT_ENTRY_VALUE,
	},
	// The code block's own cue is a separate decision (design pass §6.2): U-40
	// must REPORT the overflowing non-table scroller as a declared deferral,
	// never pass it silently, and this entry is what asserts the recording.
	"U-40": {
		"code-block-deferral": U40_DEFERRAL.SCOPE,
	},
};

/**
 * The fixture's opt-out for a `data-not-defect` shape the rule must not reach AT ALL.
 *
 * A module-level constant so the parser does not rebuild it per tag (biome's
 * `useTopLevelRegex`).
 */
const NOT_DEFECT_SILENT = /\bdata-not-defect-silent\b/;

const declaredNotDefects = (): NotDefect[] => {
	const out: NotDefect[] = [];
	for (const tag of html.matchAll(
		/<[a-z0-9]+\b[^>]*data-not-defect="([^"]+)"[^>]*>/gi,
	)) {
		const check = tag[1] ?? "";
		const element = /\bid="([^"]+)"/.exec(tag[0])?.[1];
		if (check === "" || element === undefined) {
			console.error(
				"canary: a data-not-defect declaration needs a check id and an element id; " +
					"without them nothing can assert that the audit stayed silent about it.",
			);
			process.exit(2);
		}
		const name = /\bdata-not-defect-reason="([^"]+)"/.exec(tag[0])?.[1];
		const silent = NOT_DEFECT_SILENT.test(tag[0]);
		if (name !== undefined && silent) {
			console.error(
				`canary: #${element} declares both data-not-defect-reason and data-not-defect-silent; they say different things and cannot both be true.`,
			);
			process.exit(2);
		}
		if (name === undefined && !silent) {
			console.error(
				`canary: #${element} declares data-not-defect="${check}" with neither data-not-defect-reason nor data-not-defect-silent. Name the reason it is recorded with (from NOT_DEFECT_REASON_NAMES and the matching table in tools/audit/checks.ts), or mark it silent — otherwise the assertion weakens to "some row exists" and a deleted reason goes unnoticed (QA round 2).`,
			);
			process.exit(2);
		}
		let reason: string | null = null;
		if (name !== undefined) {
			reason = NOT_DEFECT_REASON_NAMES[check]?.[name] ?? null;
			if (reason === null) {
				console.error(
					`canary: #${element} declares data-not-defect="${check}" with unknown reason '${name}'; add it to NOT_DEFECT_REASON_NAMES here and to the matching table in tools/audit/checks.ts (U08_SUPPRESSION / U03_SUPPRESSION / U10_DECLARATION) rather than letting the assertion weaken to "some row exists".`,
				);
				process.exit(2);
			}
		}
		out.push({ check, element, reason, silent });
	}
	return out;
};
const notDefects = declaredNotDefects();

/** Declared-exempt elements that a FAIL row named anyway. */
const firedOnNotDefect = notDefects
	.filter((entry) =>
		defects.rows.some(
			(row: AuditRow) =>
				row.verdict === "FAIL" &&
				row.check === entry.check &&
				rowNames(row).includes(`#${entry.element}`),
		),
	)
	.map((entry) => `${entry.check} (#${entry.element})`);
/**
 * A declared exception must be RECORDED, not merely absent, and recorded with the
 * reason the fixture declared — each entry names its own, because two different
 * branches can set aside two different shapes, and a blanket "some EXCEPTION row
 * exists" would accept either for the other. `NOT_DEFECT_REASON_NAMES` resolves the
 * fixture's name through each rule's own exported table (imported), so a rename
 * cannot leave this asserting a stale string.
 *
 * The contract covers U-03's two branches and U-10's one as well as U-08's
 * (review round 3, R3-1): a shape that quietly stopped reaching its branch would
 * satisfy "no FAIL row" while proving nothing about the rule, so the
 * reason-tagged EXCEPTION row is required as well: the assertion is that the rule
 * still SAW the element and said why it set it aside. A SILENT entry
 * (`data-not-defect-silent`) is skipped here, because its contract is the
 * opposite one — the rule must not reach it at all — and that absence is asserted
 * by `silentButReported` below together with `firedOnNotDefect`.
 */
const unrecordedSuppressions: string[] = [];
for (const entry of notDefects) {
	const reason = entry.reason;
	if (reason === null) continue;
	const recorded = defects.rows.some(
		(row: AuditRow) =>
			row.verdict === "EXCEPTION" &&
			rowNames(row).includes(`#${entry.element}`) &&
			(row.measured ?? "").includes(reason),
	);
	if (!recorded)
		unrecordedSuppressions.push(`${entry.check} (#${entry.element})`);
}

/**
 * A `data-not-defect-silent` shape must produce NO row under its own check — of any
 * verdict, not merely no FAIL. `firedOnNotDefect` already covers the FAIL case; this
 * is the recording half, so a silent shape the rule STARTS reaching (a suppression, an
 * EXCEPTION) cannot pass by looking like the shape it used to be.
 */
const silentButReported: string[] = [];
for (const entry of notDefects) {
	if (!entry.silent) continue;
	const reported = defects.rows.some(
		(row: AuditRow) =>
			row.check === entry.check && rowNames(row).includes(`#${entry.element}`),
	);
	if (reported) silentButReported.push(`${entry.check} (#${entry.element})`);
}

/**
 * A defect is caught either by a row that NAMES its element, or — for the two
 * rules that report without an element id at all — by the check itself.
 *
 * THE FALLBACK IS AN EXPLICIT ALLOWLIST, NOT `marker === check` (QA round 2,
 * Q2-1). `marker === check` only says the marker names a whole check rather than a
 * sub-rule; it says nothing about whether the rule CAN name the element it caught.
 * A fixture whose marker names its own check therefore rode the fallback:
 * `#three-dot-a` (marker `U-03`) was "caught" at check level by any OTHER U-03
 * FAIL row, so it proved nothing about the colour-only series floor. Measured
 * (QA's repro, with the floor widened back to `>= 3`): `#three-dot-a` became an
 * EXCEPTION and the canary still printed `CANARY: PASS`, `missed: none`.
 *
 * Each entry is a DEFECT (`<check>#<element>`), not a whole check, so a new
 * declared defect can never inherit the exemption — it has to be listed, and the
 * check it names must actually carry a FAIL row.
 *
 *   - `U-06#too-wide`: the overflow rule reports the document's scroll width, so
 *     its row names no element.
 *   - `U-09#unnamed-icon`: the rule reads the accessibility tree, and its node
 *     carries no DOM id.
 *
 * A check whose rows DO name elements (U-03, U-08, U-10, …) is deliberately
 * absent: every declared defect of those checks has to be caught by a FAIL row
 * that names its element, or the fixture is not load-bearing — the whole point of
 * Q2-1.
 */
const CHECK_LEVEL_DEFECTS = new Set(["U-06#too-wide", "U-09#unnamed-icon"]);

// A listed defect the fixture no longer declares would silently stop being
// asserted, so the list must name things the page still carries.
const orphanedCheckLevel = [...CHECK_LEVEL_DEFECTS].filter(
	(key) => !declared.some((d) => `${d.check}#${d.element}` === key),
);
if (orphanedCheckLevel.length > 0) {
	console.error(
		`canary: CHECK_LEVEL_DEFECTS names ${orphanedCheckLevel.join(", ")}, which the fixture no longer declares; remove the stale entry rather than leaving an exemption that hides a deleted fixture.`,
	);
	process.exit(2);
}

const checkLevel = declared.filter(
	(defect) =>
		defect.marker === defect.check &&
		CHECK_LEVEL_DEFECTS.has(`${defect.check}#${defect.element}`) &&
		caught.includes(defect.check),
);
const caughtDefects = [...new Set([...caughtByElement, ...checkLevel])];
const caughtByCheckOnly = checkLevel.filter(
	(d) => !caughtByElement.includes(d),
);
const missedDefects = declared
	.filter((defect) => !caughtDefects.includes(defect))
	.map((defect) => `${defect.marker} (#${defect.element})`);
const cleanFails = clean.rows.filter((r: AuditRow) => r.verdict === "FAIL");
const exceptions = defects.rows.filter(
	(r: AuditRow) => r.verdict === "EXCEPTION",
);

console.log("\n=== verdict");
console.log(
	`  declared by the fixture: ${declared.map((d) => d.marker).join(", ")}`,
);
console.log(`  caught by the audit:     ${caught.join(", ")}`);
console.log(
	`  must-not-report:         ${notDefects.map((d) => `${d.check} (#${d.element})`).join(", ") || "none"}`,
);
if (firedOnNotDefect.length > 0)
	console.log(`    - REPORTED ANYWAY:       ${firedOnNotDefect.join(", ")}`);
if (unrecordedSuppressions.length > 0)
	console.log(
		`    - NOT RECORDED AS SUPPRESSED: ${unrecordedSuppressions.join(", ")}`,
	);
if (silentButReported.length > 0)
	console.log(
		`    - REPORTED DESPITE data-not-defect-silent: ${silentButReported.join(", ")}`,
	);
console.log(
	`  caught per defect:       ${caughtDefects.map((d) => d.marker).join(", ") || "none"}`,
);
if (caughtByCheckOnly.length > 0) {
	// Named rather than folded in: these rules report document-wide or through the
	// accessibility tree, so their evidence is check-level, and a reader deciding
	// whether this canary covers them needs to know which ones those are.
	console.log(
		`  check-level only:        ${caughtByCheckOnly.map((d) => `${d.marker} (#${d.element})`).join(", ")} ` +
			"— the rule cannot name the element it caught",
	);
}
console.log(
	`  missed:                  ${missedDefects.length ? missedDefects.join(", ") : "none"}`,
);
console.log(
	`  recorded exceptions:     ${exceptions.length}${exceptions.length ? ` (${exceptions.map((e: AuditRow) => e.measured).join("; ")})` : ""}`,
);
console.log(`  clean-page FAIL rows:    ${cleanFails.length}`);
for (const fail of cleanFails)
	console.log(
		`    - ${fail.check} ${fail.screen}/${fail.state} ${fail.measured}`,
	);
console.log(
	`  defect-page exit: ${defectsStatus} (non-zero expected) · clean-page exit: ${cleanStatus} (zero expected)`,
);

const cleanCells = clean.cells ?? 0;
const cleanRows = clean.rows?.length ?? 0;
const defectRows = defects.rows?.length ?? 0;
console.log(`  defect-page cells/rows:  ${defects.cells}/${defectRows}`);
if (blind.length > 0) {
	console.log(
		`  BLINDED: ${blind.join(", ")} — this run is a mutation self-test, not evidence`,
	);
}
console.log(`  clean-page cells/rows:   ${cleanCells}/${cleanRows}`);
const vacuous =
	cleanCells === 0 ||
	cleanRows === 0 ||
	defectRows === 0 ||
	// The must-not-report direction is only worth anything while the fixture declares
	// one: deleting the declarations would otherwise silence it.
	notDefects.length === 0;
if (vacuous)
	console.log(
		"  VACUOUS: a direction produced no cells or no rows, so nothing was actually asserted",
	);
const ok =
	!vacuous &&
	missedDefects.length === 0 &&
	cleanFails.length === 0 &&
	firedOnNotDefect.length === 0 &&
	unrecordedSuppressions.length === 0 &&
	silentButReported.length === 0 &&
	defectsStatus !== 0 &&
	cleanStatus === 0;
console.log(
	ok
		? "\nCANARY: PASS — the audit catches every declared defect and passes the clean page"
		: "\nCANARY: FAIL — the instrument is not discriminating",
);
// Which of the five terms failed, in words. They come from different stages — the
// capture, the audit, the comparison — so "the instrument is not discriminating" alone
// cannot tell a blinding bug from a capture bug. At `d5b3960` the ledger was empty
// (`missed: none`) while the verdict was non-zero, and nobody could tell which of the
// other four terms had failed. A VACUOUS run is named in the canary's own words for the
// same reason: a direction that produced nothing must never read as a passing blank.
const failedTerms: string[] = [];
if (vacuous) failedTerms.push("vacuous");
if (missedDefects.length > 0) failedTerms.push("missed");
if (cleanFails.length > 0) failedTerms.push("cleanFails");
if (firedOnNotDefect.length > 0) failedTerms.push("firedOnNotDefect");
if (unrecordedSuppressions.length > 0)
	failedTerms.push("suppressionUnrecorded");
if (silentButReported.length > 0) failedTerms.push("silentNotReported");
if (defectsStatus === 0) failedTerms.push("defectsStatus");
if (cleanStatus !== 0) failedTerms.push("cleanStatus");
if (failedTerms.length > 0) {
	console.log(`  FAILED TERM(S): ${failedTerms.join(", ")}`);
}
console.log(
	`VERDICT ${JSON.stringify({
		ok,
		failedTerms,
		vacuous,
		missed: missedDefects,
		cleanFails: cleanFails.length,
		firedOnNotDefect,
		unrecordedSuppressions,
		silentButReported,
		defectsStatus,
		cleanStatus,
		cells: { defects: defects.cells ?? 0, clean: cleanCells },
		rows: { defects: defectRows, clean: cleanRows },
	})}`,
);
process.exit(ok ? 0 : 1);
