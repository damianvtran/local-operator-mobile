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
 *   node tools/audit/audit.mjs --manifest <frames>/manifest.json [--out <dir>]
 *
 * Exit code is 0 only when no check FAILs. `BLOCKED` rows are not failures —
 * they are checks a state could not answer, and they are counted separately so
 * "we could not tell" can never be read as "it passed".
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bool, csv, num, parseArgs, str } from "../lib/args.mjs";
import { launchChrome } from "../lib/chrome.mjs";
import { serveDir } from "../lib/static-server.mjs";
import { sleep } from "../lib/cdp.mjs";
import { PRE_PAINT_PROBE } from "../visual/matrix.mjs";
import { EXTRACT_PROBE, flattenAxTree } from "./probe.mjs";
import { runChecks } from "./checks.mjs";
import { floorsFromTokens } from "./color.mjs";

/** The checks the runner knows, in rubric order. */
export const ALL_CHECKS = ["U-01", "U-02", "U-03", "U-04", "U-05", "U-06", "U-07", "U-08", "U-09", "U-10"];

/**
 * The semantic colours a state-only colour usage is measured against. Read from
 * the tokens so a palette change moves the check with it; the fallback set is
 * the palette this app shipped at the time of writing.
 */
function semanticFromTokens(tokens) {
	const pick = (path) => {
		let node = tokens;
		for (const key of path.split(".")) node = node?.[key];
		return typeof node === "string" ? node : typeof node?.value === "string" ? node.value : null;
	};
	const out = {};
	for (const name of ["danger", "warning", "success", "info"]) {
		const value = tokens?.color?.semantic?.[name];
		out[name] = typeof value === "string" ? value : (value?.light ?? null);
	}
	out.accent = pick("color.accent.accent");
	return out;
}

/** The query string the capture used, so the audit renders the same cell. */
function cellQuery(record) {
	const query = new URLSearchParams({
		"lo-theme": record.theme,
		"lo-text-scale": String(record.scale === "100" ? 1 : record.scale === "150" ? 1.5 : 2),
	});
	const insets = record.insets ?? {};
	for (const side of ["top", "bottom", "left", "right"]) {
		if (insets[side] !== undefined) query.set(`lo-inset-${side}`, String(insets[side]));
	}
	return query.toString();
}

async function auditCell(page, record, { origin, settleMs }) {
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
	try {
		await page.send("Emulation.setSafeAreaInsetsOverride", {
			insets: { top: record.insets?.top ?? 0, bottom: record.insets?.bottom ?? 0, left: record.insets?.left ?? 0, right: record.insets?.right ?? 0 },
		});
	} catch {
		// Without the override the page reports 0 insets; the check will say the
		// state could not answer rather than passing it.
	}
	await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRE_PAINT_PROBE });
	const url = `${origin}${record.path}?${cellQuery(record)}`;
	await page.send("Page.navigate", { url });
	await sleep(settleMs);
	const geometry = await page.evaluate(EXTRACT_PROBE);
	const ax = flattenAxTree((await page.send("Accessibility.getFullAXTree")).nodes ?? []);
	return {
		...geometry,
		ax,
		platform: record.device?.startsWith("android") ? "android" : "ios",
		screen: record.screen,
		state: record.state,
		device: record.device,
		theme: record.theme,
		scale: record.scale,
		frame: record.frames?.find((f) => !/-f0\.png$|-f250\.png$/.test(f.file))?.file ?? record.frames?.[0]?.file ?? null,
		requestedUrl: url,
	};
}

export async function runAudit(options) {
	const manifestPath = options.manifest;
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const outDir = options.out ?? resolve(manifestPath, "..");
	const tokensPath = options.tokens ?? resolve(manifest.meta?.repoRoot ?? ".", "design/tokens/tokens.json");
	const tokens = existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, "utf8")) : null;
	const floors = floorsFromTokens(tokens);
	const semantic = semanticFromTokens(tokens);
	const checks = options.checks.length ? options.checks : ALL_CHECKS;

	const records = manifest.records.filter((r) => r.path);
	const server = await serveDir(manifest.meta.buildDir);
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
			const state = await auditCell(page, record, { origin: server.url, settleMs: options.settleMs });
			const produced = runChecks(state, { floors, semantic, checks, scaleIsLive: manifest.meta?.textScaleLive === true });
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
				`WARNING: ${reaped.survivors} Chrome process(es) survived the sweep of ${reaped.profile}. `
				+ "A leaked browser keeps retrying the keychain on the operator's screen.",
			);
		}
	}

	const summary = new Map();
	for (const row of rows) {
		const entry = summary.get(row.check) ?? { pass: 0, fail: 0, exception: 0, blocked: 0 };
		entry[row.verdict.toLowerCase()] += 1;
		summary.set(row.check, entry);
	}
	const failures = rows.filter((r) => r.verdict === "FAIL");
	const report = {
		generatedAt: new Date().toISOString(),
		buildDir: manifest.meta.buildDir,
		relay: manifest.meta.relay ?? null,
		scenario: manifest.meta.scenario ?? null,
		checks,
		cells: records.length,
		rows,
		summary: Object.fromEntries([...summary.entries()].sort()),
		failures: failures.length,
	};
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, "audit-report.json"), `${JSON.stringify(report, null, 2)}\n`);
	writeFileSync(join(outDir, "audit-report.md"), renderMarkdown(report));
	return report;
}

/** The markdown report: one row per finding, plus the per-check totals. */
export function renderMarkdown(report) {
	const lines = [
		`# Accessibility audit — ${report.generatedAt}`,
		"",
		`- build: \`${report.buildDir}\``,
		`- relay: \`${report.relay ?? "—"}\` · scenario \`${report.scenario ?? "—"}\``,
		`- cells audited: ${report.cells} · checks: ${report.checks.join(", ")}`,
		`- **verdict: ${report.failures === 0 ? "no FAIL rows" : `${report.failures} FAIL rows`}**`,
		"",
		"Check ids are the rubric's own (`docs/ux/audit-rubric.md` §3). `BLOCKED` means the state could not answer the question — it is not a pass.",
		"",
		"## Totals",
		"",
		"| check | pass | fail | exception | blocked |",
		"|---|---|---|---|---|",
	];
	for (const [check, entry] of Object.entries(report.summary)) {
		lines.push(`| ${check} | ${entry.pass} | ${entry.fail} | ${entry.exception} | ${entry.blocked} |`);
	}
	const interesting = report.rows.filter((r) => r.verdict !== "PASS");
	lines.push("", `## Rows (${interesting.length} non-PASS of ${report.rows.length})`, "");
	if (interesting.length === 0) {
		lines.push("Every check passed on every cell. See `audit-report.json` for the measurements.");
	} else {
		lines.push("| check | screen | state | device | theme | scale | verdict | measured | detail | frame |", "|---|---|---|---|---|---|---|---|---|---|");
		for (const row of interesting) {
			lines.push(
				`| ${row.check} | ${row.screen} | ${row.state} | ${row.device} | ${row.theme} | ${row.scale} | **${row.verdict}** | `
				+ `${row.measured ?? ""} | ${(row.detail ?? "").replace(/\|/g, "\\|")} | ${row.frame ?? ""} |`,
			);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

/* -------------------------------------------------------------------- CLI -- */

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
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
				"  --checks <ids>      comma list, default the whole rubric: " + ALL_CHECKS.join(","),
				"  --tokens <path>     tokens.json for the floors (default <repo>/design/tokens/tokens.json)",
				"  --settle <ms>       boot budget per cell (default 1200)",
				"  --quiet             no progress lines",
			].join("\n"),
		);
		process.exit(manifest ? 0 : 2);
	}
	const report = await runAudit({
		manifest,
		out: str(flags, "out", undefined),
		checks: csv(flags, "checks"),
		tokens: str(flags, "tokens", undefined),
		settleMs: num(flags, "settle", 1200),
		quiet: bool(flags, "quiet"),
	});
	console.log(
		`audit: ${report.cells} cells, ${report.rows.length} check rows, ${report.failures} FAIL`,
	);
	process.exit(report.failures === 0 ? 0 : 1);
}
