/**
 * The audit checker: run the mechanical half of the design/UX rubric over a
 * captured state matrix, and write a report a review round can answer.
 *
 * It consumes a manifest from `tools/visual/capture.mjs`, re-drives the *same*
 * URLs in installed headless Chrome (so the check is over the real render, not
 * over a saved PNG), extracts geometry and the accessibility tree over CDP, and
 * emits one row per check × cell with the measured number and the frame it came
 * from.
 *
 *   node tools/audit/audit.ts --manifest <frames>/manifest.json [--out <dir>]
 *
 * EXIT CODES, because a CI step reads the number and not the prose:
 *
 *   0  every check PASSed (or the only non-PASS rows are EXCEPTIONs the rubric
 *      grants explicitly, e.g. a 24 pt control in a dense list)
 *   1  at least one FAIL
 *   2  the run itself was refused (no manifest, no records, bad arguments)
 *   3  no FAIL, but at least one BLOCKED — the audit could not tell
 *
 * 3 is deliberately not 0. "We could not tell" is what a build whose text does
 * not scale produces, and reading it as a pass is the defect the review round
 * found: the scaffold genuinely could not scale text to 200% and the run exited
 * 0. `--allow-blocked` restores 0 for local exploration and is never used in CI.
 *
 * COVERAGE, stated rather than implied: this tool machine-checks the rubric's
 * mechanical half — U-01…U-10 — and nothing else. U-11…U-17 are machine-defined
 * in the rubric and NOT implemented here; §4-§7 are manual by the rubric's own
 * text; §9's R1-R6 assertions are not implemented. See `COVERAGE` below, which
 * is printed in the report so a reader never has to infer it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bool, csv, num, parseArgs, str } from "../lib/args.ts";
import type { CdpPage } from "../lib/cdp.ts";
import { sleep } from "../lib/cdp.ts";
import { launchChrome } from "../lib/chrome.ts";
import { serveDir } from "../lib/static-server.ts";
import { PRE_PAINT_PROBE } from "../visual/matrix.ts";
import { runChecks } from "./checks.ts";
import { floorsFromTokens } from "./color.ts";
import { EXTRACT_PROBE, flattenAxTree } from "./probe.ts";

/**
 * The checks the runner implements, in rubric order.
 *
 * This is the *machine-checked* half and nothing more. The rubric's §3 table runs
 * to U-17; stating that here, and in every report, is what stops a green run
 * from being read as coverage of a rubric this tool does not implement.
 */
export const ALL_CHECKS = [
	"U-01",
	"U-02",
	"U-03",
	"U-04",
	"U-05",
	"U-06",
	"U-07",
	"U-08",
	"U-09",
	"U-10",
];

/** The rubric ids this tool does NOT machine-check, and who owns them. */
export const COVERAGE = {
	machineChecked: ALL_CHECKS,
	/** §3 ids the rubric defines as machine checks and this tool does not implement. */
	unimplemented: ["U-11", "U-12", "U-13", "U-14", "U-15", "U-16", "U-17"],
	/** §4-§7: manual by the rubric's own text. */
	manualOnly: ["§4 copy", "§5 flow", "§6 per-screen", "§7 scoring"],
	/** §9's R1-R6 assertions over the markdown/JSON pair. */
	uncheckedAssertions: ["R1", "R2", "R3", "R4", "R5", "R6"],
} as const;

/**
 * The semantic colours a state-only colour usage is measured against. Read from
 * the tokens so a palette change moves the check with it; the fallback set is
 * the palette this app shipped at the time of writing.
 */
/** The semantic palette a state-only colour usage is measured against. */
export interface SemanticPalette {
	danger: string | null;
	warning: string | null;
	success: string | null;
	info: string | null;
	/** The accent is theme-dependent in the design kit, so both values are measured. */
	accentLight: string | null;
	accentDark: string | null;
}

/** Where a palette came from, and whether any of it loaded at all. */
export interface PaletteProvenance {
	path: string | null;
	loaded: boolean;
	/** Why it is missing, when it is: the sentence the report carries. */
	reason: string | null;
	/** How many semantic keys resolved to a colour. */
	entries: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/**
 * Read the semantic palette out of the design tokens.
 *
 * A palette that did not load yields an EMPTY set, and an empty set makes a
 * colour check unable to find a suspect — it reports PASS on a page that uses
 * colour alone to carry state. That is why the caller gets provenance too: "no
 * palette" must fail the check rather than pass it. Measured before this rule:
 * the canary's own defect page reported `U-03 PASS` on all 16 cells with no
 * tokens loaded.
 */
export function semanticFromTokens(tokens: unknown): SemanticPalette {
	const out: SemanticPalette = {
		danger: null,
		warning: null,
		success: null,
		info: null,
		accentLight: null,
		accentDark: null,
	};
	const root = asRecord(tokens);
	if (root === undefined) return out;
	const color = asRecord(root.color);
	if (color === undefined) return out;
	const semantic = asRecord(color.semantic);
	for (const name of ["danger", "warning", "success", "info"] as const) {
		const value = semantic?.[name];
		if (typeof value === "string") out[name] = value;
		else {
			const nested = asRecord(value);
			out[name] = typeof nested?.light === "string" ? nested.light : null;
		}
	}
	const accent = asRecord(color.accent);
	const accentValue = accent?.accent;
	if (typeof accentValue === "string") {
		out.accentLight = accentValue;
	} else {
		const pair = asRecord(accentValue);
		out.accentLight = typeof pair?.light === "string" ? pair.light : null;
		out.accentDark = typeof pair?.dark === "string" ? pair.dark : null;
	}
	return out;
}

/** The provenance of a palette: what loaded, from where, and why not. */
export function paletteProvenance(
	tokensPath: string | null,
	palette: SemanticPalette,
): PaletteProvenance {
	const entries = Object.values(palette).filter(
		(value) => typeof value === "string",
	).length;
	if (tokensPath === null) {
		return {
			path: null,
			loaded: false,
			reason: "no --tokens path and no repoRoot in the manifest",
			entries,
		};
	}
	if (!existsSync(tokensPath)) {
		return {
			path: tokensPath,
			loaded: false,
			reason: `${tokensPath} does not exist`,
			entries,
		};
	}
	if (entries === 0) {
		return {
			path: tokensPath,
			loaded: false,
			reason: `${tokensPath} carries no semantic colours`,
			entries,
		};
	}
	return { path: tokensPath, loaded: true, reason: null, entries };
}

/** One captured cell, as the audit reads it out of the manifest. */
interface AuditRecord {
	screen: string;
	screenLabel?: string;
	state: string;
	device: string;
	theme: string;
	scale: string;
	path: string;
	viewport: { width: number; height: number; dpr: number };
	insets?: { top: number; bottom: number; left: number; right: number };
	frames?: Array<{ file: string }>;
}

/** The query string the capture used, so the audit renders the same cell. */
function cellQuery(record: AuditRecord): string {
	const query = new URLSearchParams({
		"lo-theme": record.theme,
		"lo-text-scale": String(
			record.scale === "100" ? 1 : record.scale === "150" ? 1.5 : 2,
		),
	});
	const insets = record.insets ?? {};
	for (const side of ["top", "bottom", "left", "right"]) {
		if (insets[side] !== undefined)
			query.set(`lo-inset-${side}`, String(insets[side]));
	}
	return query.toString();
}

async function auditCell(
	page: CdpPage,
	record: AuditRecord,
	{ origin, settleMs }: { origin: string; settleMs: number },
) {
	const device = record.viewport;
	await page.send("Emulation.setDeviceMetricsOverride", {
		width: device.width,
		height: device.height,
		deviceScaleFactor: device.dpr,
		mobile: true,
	});
	await page.send("Emulation.setEmulatedMedia", {
		features: [
			{ name: "prefers-color-scheme", value: record.theme },
			{ name: "prefers-reduced-motion", value: "no-preference" },
		],
	});
	// The real insets, so the app's own env() resolves them (see
	// tools/visual/capture.mjs § applySafeAreaInsets).
	let insetsOverride: { applied: boolean; reason: string | null } = {
		applied: false,
		reason: null,
	};
	try {
		await page.send("Emulation.setSafeAreaInsetsOverride", {
			insets: {
				top: record.insets?.top ?? 0,
				bottom: record.insets?.bottom ?? 0,
				left: record.insets?.left ?? 0,
				right: record.insets?.right ?? 0,
			},
		});
		insetsOverride = { applied: true, reason: null };
	} catch (error) {
		// Without the override the page reports 0 insets, so the check says the
		// state could not answer rather than passing it — and it carries the
		// *reason* here, because "the app declares no unsafe edges" and "CDP
		// refused the override" are different findings that read the same.
		insetsOverride = {
			applied: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	await page.send("Page.addScriptToEvaluateOnNewDocument", {
		source: PRE_PAINT_PROBE,
	});
	const url = `${origin}${record.path}?${cellQuery(record)}`;
	await page.send("Page.navigate", { url });
	await sleep(settleMs);
	const geometry = asRecord(await page.evaluate(EXTRACT_PROBE)) ?? {};
	const axTree = await page.send("Accessibility.getFullAXTree");
	const ax = flattenAxTree(Array.isArray(axTree.nodes) ? axTree.nodes : []);
	return {
		...geometry,
		ax,
		platform: record.device?.startsWith("android") ? "android" : "ios",
		screen: record.screen,
		state: record.state,
		device: record.device,
		theme: record.theme,
		scale: record.scale,
		frame:
			record.frames?.find((f) => !/-f0\.png$|-f250\.png$/.test(f.file))?.file ??
			record.frames?.[0]?.file ??
			null,
		requestedUrl: url,
		insetsOverride,
	};
}

export interface AuditOptions {
	manifest: string;
	out: string | undefined;
	checks: string[];
	tokens: string | undefined;
	settleMs: number;
	quiet: boolean;
	/** A Chrome profile directory to use; the default is a fresh temporary one. */
	profile?: string | undefined;
}

/** Refused-audit: the exit code 2 path, thrown so the CLI and the API agree. */
export class AuditRefused extends Error {}

export async function runAudit(options: AuditOptions) {
	const manifestPath = options.manifest;
	const rawManifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
	const manifest = asRecord(rawManifest);
	if (manifest === undefined)
		throw new AuditRefused(`${manifestPath} is not a manifest object`);
	const meta = asRecord(manifest.meta) ?? {};
	const outDir = options.out ?? resolve(manifestPath, "..");
	const tokensPath =
		options.tokens ??
		(typeof meta.repoRoot === "string"
			? resolve(meta.repoRoot, "design/tokens/tokens.json")
			: null);
	const tokens: unknown =
		tokensPath !== null && existsSync(tokensPath)
			? JSON.parse(readFileSync(tokensPath, "utf8"))
			: null;
	const floors = floorsFromTokens(tokens);
	const semantic = semanticFromTokens(tokens);
	const palette = paletteProvenance(tokensPath, semantic);
	const checks = options.checks.length ? options.checks : ALL_CHECKS;

	const allRecords = Array.isArray(manifest.records) ? manifest.records : [];
	// An audit of nothing is not a pass. A capture that produced no frames — a
	// filter that matched nothing, a crashed run, a manifest written before the
	// loop — must be refused here, because `0 cells, 0 rows, 0 FAIL` reads as a
	// clean build in a PR comment and in CI.
	if (allRecords.length === 0) {
		throw new AuditRefused(
			`${manifestPath} lists no records: there is nothing to audit, which is not a pass`,
		);
	}
	const records = allRecords
		.map((entry) => asRecord(entry))
		.filter(
			(entry): entry is Record<string, unknown> =>
				entry !== undefined && typeof entry.path === "string",
		) as unknown as AuditRecord[];
	if (records.length === 0) {
		throw new AuditRefused(
			`${manifestPath} has ${allRecords.length} records and none with a path: nothing to audit`,
		);
	}
	if (typeof meta.buildDir !== "string")
		throw new AuditRefused(
			`${manifestPath} has no meta.buildDir: cannot serve the build`,
		);
	const server = await serveDir(meta.buildDir, {
		proxy: typeof meta.relay === "string" ? meta.relay : undefined,
	});
	const chrome = await launchChrome({ profile: options.profile });

	const rows = [];
	let index = 0;
	try {
		const page = await chrome.page();
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		await page.send("Accessibility.enable");
		for (const record of records) {
			index += 1;
			const state = await auditCell(page, record, {
				origin: server.url,
				settleMs: options.settleMs,
			});
			const produced = runChecks(state, {
				floors,
				semantic,
				checks,
				scaleIsLive: meta.textScaleLive === true,
				// The palette's absence is a *failed check*, not a silent skip: with no
				// colours to match, a colour-only status node cannot be found, and a
				// PASS there is a reading the instrument did not earn.
				paletteMissingReason: palette.loaded
					? null
					: `${palette.reason ?? "no palette"}`,
			});
			for (const row of produced) {
				rows.push({
					...row,
					screen: record.screen,
					screenLabel: record.screenLabel,
					state: record.state,
					device: record.device,
					theme: record.theme,
					scale: record.scale,
					frame: state.frame,
					url: state.requestedUrl,
				});
			}
			if (!options.quiet && index % 10 === 0) {
				console.log(`  ${index}/${records.length} cells audited`);
			}
		}
	} finally {
		const reaped = await chrome.close();
		await server.close();
		if (reaped.survivors !== 0) {
			console.error(
				`WARNING: ${reaped.survivors} Chrome process(es) survived the sweep of ${reaped.profile}. ` +
					"A leaked browser keeps retrying the keychain on the operator's screen.",
			);
		}
	}

	const summary = new Map<
		string,
		{ pass: number; fail: number; exception: number; blocked: number }
	>();
	for (const row of rows) {
		const entry = summary.get(row.check) ?? {
			pass: 0,
			fail: 0,
			exception: 0,
			blocked: 0,
		};
		const verdict = String(row.verdict).toLowerCase();
		if (
			verdict === "pass" ||
			verdict === "fail" ||
			verdict === "exception" ||
			verdict === "blocked"
		)
			entry[verdict] += 1;
		summary.set(row.check, entry);
	}
	const failures = rows.filter((r) => r.verdict === "FAIL");
	const blocked = rows.filter((r) => r.verdict === "BLOCKED");
	// Only the BLOCKED rows that could not answer something they should have. A
	// check that does not apply to a cell (U-04 on a 100% frame) is expected and
	// does not make a run incomplete; one that could not measure (no palette, no
	// control in the frame) does.
	const gaps = blocked.filter((r) => r.blockedKind === "unmeasurable");
	const report: AuditReport = {
		generatedAt: new Date().toISOString(),
		buildDir: meta.buildDir,
		relay: typeof meta.relay === "string" ? meta.relay : null,
		scenario: typeof meta.scenario === "string" ? meta.scenario : null,
		checks,
		cells: records.length,
		// Which palette and theme each cell was measured against, so a reading can
		// be audited rather than trusted.
		palette,
		measuredAgainst: {
			tokens: palette.path,
			themes: [...new Set(records.map((r) => r.theme))],
		},
		coverage: COVERAGE,
		rows,
		summary: Object.fromEntries([...summary.entries()].sort()),
		failures: failures.length,
		blocked: blocked.length,
		unmeasurable: gaps.length,
		verdict:
			failures.length > 0 ? "FAIL" : gaps.length > 0 ? "INCOMPLETE" : "PASS",
	};
	mkdirSync(outDir, { recursive: true });
	writeFileSync(
		join(outDir, "audit-report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	writeFileSync(join(outDir, "audit-report.md"), renderMarkdown(report));
	return report;
}

/** The markdown report: one row per finding, plus the per-check totals. */

/** What `renderMarkdown` reads; named so the shape is checkable. */
export interface AuditReport {
	generatedAt: string;
	buildDir: string;
	relay: string | null;
	scenario: string | null;
	checks: string[];
	cells: number;
	palette: PaletteProvenance;
	coverage: typeof COVERAGE;
	measuredAgainst: { tokens: string | null; themes: string[] };
	rows: Array<
		Record<string, string | null | undefined> & {
			verdict: string;
			check: string;
			blockedKind?: string;
		}
	>;
	summary: Record<
		string,
		{ pass: number; fail: number; exception: number; blocked: number }
	>;
	failures: number;
	blocked: number;
	verdict: string;
}

export function renderMarkdown(report: AuditReport) {
	const lines = [
		`# Accessibility audit — ${report.generatedAt}`,
		"",
		`- build: \`${report.buildDir}\``,
		`- relay: \`${report.relay ?? "—"}\` · scenario \`${report.scenario ?? "—"}\``,
		`- cells audited: ${report.cells} · checks: ${report.checks.join(", ")}`,
		`- palette: \`${report.palette.path ?? "—"}\` · loaded: ${report.palette.loaded} · entries: ${report.palette.entries}` +
			(report.palette.reason ? ` · (${report.palette.reason})` : ""),
		`- **verdict: ${report.verdict}** — ${report.failures} FAIL, ${report.blocked} BLOCKED ` +
			`(${report.unmeasurable} of them unmeasurable, the rest not-applicable)`,
		"",
		"This tool machine-checks the rubric's mechanical half and nothing else:",
		`- machine-checked: **${report.coverage.machineChecked.join(", ")}**`,
		`- machine-defined in the rubric but NOT implemented here: **${report.coverage.unimplemented.join(", ")}**`,
		`- manual by the rubric's own text: ${report.coverage.manualOnly.join(", ")}`,
		`- §9 assertions not checked here: ${report.coverage.uncheckedAssertions.join(", ")}`,
		"",
		"Check ids are the rubric's own (`docs/ux/audit-rubric.md` §3). `BLOCKED` means the state could not answer the question — it is not a pass, and a run whose only non-PASS rows are BLOCKED exits 3.",
		"",
		"## Totals",
		"",
		"| check | pass | fail | exception | blocked |",
		"|---|---|---|---|---|",
	];
	for (const [check, entry] of Object.entries(report.summary)) {
		lines.push(
			`| ${check} | ${entry.pass} | ${entry.fail} | ${entry.exception} | ${entry.blocked} |`,
		);
	}
	const interesting = report.rows.filter((r) => r.verdict !== "PASS");
	lines.push(
		"",
		`## Rows (${interesting.length} non-PASS of ${report.rows.length})`,
		"",
	);
	if (interesting.length === 0) {
		lines.push(
			"Every check passed on every cell. See `audit-report.json` for the measurements.",
		);
	} else {
		lines.push(
			"| check | screen | state | device | theme | scale | verdict | measured | detail | frame |",
			"|---|---|---|---|---|---|---|---|---|---|",
		);
		for (const row of interesting) {
			lines.push(
				`| ${row.check} | ${row.screen} | ${row.state} | ${row.device} | ${row.theme} | ${row.scale} | **${row.verdict}** | ` +
					`${row.measured ?? ""} | ${String(row.detail ?? "").replace(/\|/g, "\\|")} | ${String(row.frame ?? "")} |`,
			);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

/* -------------------------------------------------------------------- CLI -- */

const isMain =
	process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
	const { flags } = parseArgs(process.argv.slice(2));
	const manifest = str(flags, "manifest", undefined);
	if (bool(flags, "help") || !manifest) {
		console.log(
			[
				"usage: node tools/audit/audit.mjs --manifest <frames>/manifest.json [options]",
				"",
				"  --manifest <path>   the capture harness's manifest.json",
				"  --out <dir>         where the report goes (default: beside the manifest)",
				`  --checks <ids>      comma list, default the reported half of the rubric: ${ALL_CHECKS.join(",")}`,
				`                      NOT checked here: ${COVERAGE.unimplemented.join(",")} (machine-defined in the`,
				"                      rubric, unimplemented by this tool); §4-§7 are manual; R1-R6 unchecked.",
				"  --allow-blocked     exit 0 even when a check could not measure (local only, never CI)",
				"  --tokens <path>     tokens.json for the floors (default <repo>/design/tokens/tokens.json)",
				"  --settle <ms>       boot budget per cell (default 1200)",
				"  --quiet             no progress lines",
				"",
				"exit: 0 all clear · 1 FAIL · 2 refused to run · 3 no FAIL but a check could not measure",
			].join("\n"),
		);
		process.exit(manifest ? 0 : 2);
	}
	let report: AuditReport;
	try {
		report = await runAudit({
			manifest,
			out: str(flags, "out", undefined),
			checks: csv(flags, "checks"),
			tokens: str(flags, "tokens", undefined),
			settleMs: num(flags, "settle", 1200),
			quiet: bool(flags, "quiet"),
			profile: str(flags, "profile", undefined),
		});
	} catch (error) {
		if (error instanceof AuditRefused) {
			console.error(`audit refused: ${error.message}`);
			process.exit(2);
		}
		throw error;
	}
	console.log(
		`audit: ${report.cells} cells, ${report.rows.length} check rows, ${report.failures} FAIL, ` +
			`${report.blocked} BLOCKED (${report.unmeasurable} unmeasurable) · ` +
			`palette ${report.palette.loaded ? "loaded" : "MISSING"}`,
	);
	if (report.failures > 0) process.exit(1);
	// A run with a gap is not a pass: the scaffold's un-scalable text produced a
	// BLOCKED-only report that exited 0 before this rule existed. A check that
	// does not apply to a cell (U-04 outside the 200% frames) is not a gap.
	if (report.unmeasurable > 0 && !bool(flags, "allow-blocked")) process.exit(3);
	process.exit(0);
}
