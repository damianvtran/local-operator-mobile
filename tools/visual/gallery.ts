/**
 * The matrix gallery: one HTML page showing every captured frame with its
 * numbers beside it.
 *
 * Why this exists rather than "look in the frames/ directory": a reviewer has to
 * compare cells — dark against light on the same screen, 100% against 200% on
 * the same row, first frame against settled. A directory of 200 PNGs makes that
 * impossible, and the numbers that matter (resolved theme, canvas colour,
 * whether the theme actually applied, whether the first frame differs from the
 * settled one) are not visible in a PNG at all.
 *
 * Everything is inlined: the page has no network dependency and opens from the
 * filesystem, because it gets attached to a pull request as an artifact.
 */

import { canvasComparable } from "./theme-tokens.ts";

/**
 * Escape text for HTML.
 *
 * The map is typed as a lookup with an explicit fallback rather than an index
 * into an object literal: under `noUncheckedIndexedAccess` a bare index is
 * `string | undefined`, and the result is interpolated into the page.
 */
const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

const escapeHtml = (value: unknown): string =>
	String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** A frame is "settled" if it is the plain (non-suffixed) or `-settled` shot. */
const isSettled = (file: string): boolean =>
	!/-f0\.png$|-f250\.png$/.test(file);

/** One record as the gallery reads it, from the manifest the capture wrote. */
interface GalleryRecord {
	name: string;
	screen: string;
	screenLabel?: string;
	state?: string;
	device?: string;
	deviceLabel?: string;
	theme?: string;
	scale?: string;
	cell?: string;
	resolvedTheme?: string | null;
	canvasColor?: string | null;
	expectedCanvas?: string | null;
	measurements?: { textNodeCount?: number; mountedElements?: number } | null;
	frames?: Array<{ file: string; sha: string; bytes: number }>;
	problems?: string[];
	viewport?: { width: number; height: number; dpr: number };
	themeApplied?: boolean | null;
	/**
	 * The theme check's per-record verdict: `canvasMatchesToken` is `true`/`false` when
	 * the canvas WAS compared, `null` when no token canvas was available to compare
	 * against. The tile below reads it for exactly that distinction.
	 */
	themeCheck?: { canvasMatchesToken?: boolean | null } | null;
	/** The cell's own state marker, so the gallery can show which cells were not captured. */
	ready?: boolean;
	readinessProblems?: string[];
}

interface GalleryManifest {
	records: GalleryRecord[];
	meta: Record<string, unknown>;
	themeProblems?: string[];
	readinessProblems?: string[];
	identicalStates?: string[];
}

export function renderGallery(manifest: GalleryManifest): string {
	const { records, meta } = manifest;
	const problems = records.flatMap((r: GalleryRecord) =>
		(r.problems ?? []).map((p: string) => ({ name: r.name, p })),
	);
	const byScreen = new Map<string, GalleryRecord[]>();
	for (const record of records) {
		const list = byScreen.get(record.screen) ?? [];
		list.push(record);
		byScreen.set(record.screen, list);
	}

	const style = `
		:root { color-scheme: light dark; }
		body { margin: 0; padding: 24px; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; background: #f2ede3; color: #211e18; }
		h1 { font-size: 20px; margin: 0 0 4px; }
		h2 { font-size: 15px; margin: 28px 0 8px; border-bottom: 1px solid #dad5cb; padding-bottom: 4px; }
		.summary { display: flex; flex-wrap: wrap; gap: 16px; margin: 12px 0 20px; font-variant-numeric: tabular-nums; }
		.summary div { background: #f7f5ee; border: 1px solid #dad5cb; border-radius: 6px; padding: 8px 12px; }
		.summary b { display: block; font-size: 18px; }
		.fail { background: #f7e7e4; border-color: #96544c; }
		.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
		figure { margin: 0; background: #f7f5ee; border: 1px solid #dad5cb; border-radius: 6px; padding: 8px; }
		figure.bad { border-color: #b23a31; border-width: 2px; }
		img { display: block; width: 100%; image-rendering: -webkit-optimize-contrast; background:
			repeating-conic-gradient(#e5dfd2 0% 25%, #f2ede3 0% 50%) 50% / 12px 12px; }
		figcaption { margin-top: 6px; font-size: 11px; }
		code { font-family: ui-monospace, monospace; font-size: 11px; }
		table { border-collapse: collapse; margin: 8px 0 20px; font-variant-numeric: tabular-nums; }
		th, td { text-align: left; padding: 3px 10px 3px 0; border-bottom: 1px solid #e5dfd2; }
		.warn { color: #8a5800; }
		.badtext { color: #b23a31; font-weight: 600; }
		.frames { display: flex; gap: 8px; }
		.frames img { width: 50%; }
	`;

	const figures = [...byScreen.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([screen, list]) => {
			const cells = list
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((record) => {
					const shots = record.frames ?? [];
					const settled = shots.find((s) => isSettled(s.file)) ?? shots[0];
					const earlier = shots.filter((s) => s !== settled);
					const bad = (record.problems ?? []).length > 0;
					return `<figure class="${bad ? "bad" : ""}">
	<img src="frames/${encodeURIComponent(settled?.file ?? "")}" alt="${escapeHtml(record.name)}" loading="lazy">
	${earlier.length ? `<div class="frames">${earlier.map((s) => `<img src="frames/${encodeURIComponent(s.file)}" alt="${escapeHtml(s.file)}" loading="lazy">`).join("")}</div>` : ""}
	<figcaption>
		<code>${escapeHtml(record.name)}</code><br>
		${escapeHtml(record.deviceLabel)} ${record.viewport?.width}×${record.viewport?.height} @${record.viewport?.dpr}x<br>
		theme <b>${escapeHtml(record.resolvedTheme ?? "?")}</b> · canvas <code>${escapeHtml(record.canvasColor ?? "?")}</code>
		${record.expectedCanvas ? ` (expected <code>${escapeHtml(record.expectedCanvas)}</code>)` : ""}<br>
		scale ${escapeHtml(record.scale)} · text nodes ${record.measurements?.textNodeCount ?? "?"} · mounted ${record.measurements?.mountedElements ?? "?"}
		${earlier.length ? `<br><span class="${earlier.some((s) => s.sha !== (settled?.sha ?? "")) ? "warn" : ""}">first frame differs: ${earlier.some((s) => s.sha !== (settled?.sha ?? "")) ? "yes" : "no"}</span>` : ""}
		${record.problems?.length ? `<br><span class="badtext">${record.problems.map(escape).join("<br>")}</span>` : ""}
	</figcaption>
</figure>`;
				})
				.join("\n");
			return `<h2>${escapeHtml(screen)} — ${escapeHtml(list[0]?.screenLabel ?? "")}</h2>\n<div class="grid">${cells}</div>`;
		})
		.join("\n");

	const themeTable = `
<table>
<tr><th>cell prefix</th><th>theme</th><th>resolved</th><th>canvas</th><th>expected</th><th>PNG sha</th></tr>
${records
	.map(
		(r) =>
			`<tr><td><code>${escapeHtml(r.name.replace(/__(dark|light)__/, "__…__"))}</code></td><td>${escapeHtml(r.theme)}</td><td>${escapeHtml(r.resolvedTheme ?? "?")}</td><td><code>${escapeHtml(r.canvasColor ?? "?")}</code></td><td><code>${escapeHtml(r.expectedCanvas ?? "—")}</code></td><td><code>${escapeHtml(r.frames?.find((f) => isSettled(f.file))?.sha ?? "")}</code></td></tr>`,
	)
	.join("\n")}
</table>`;

	/**
	 * The device bound, on the ARTIFACT rather than only in the stdout a reviewer may never
	 * have seen. This is the capture's own sentence — which of the declared profiles it
	 * covered and which it did not — so a green tile over 2 of 19 profiles cannot read as a
	 * whole-matrix result on the page a reviewer opens instead of the run. It is rendered
	 * only when the manifest carries it: a manifest written before the field existed makes
	 * no claim rather than a wrong one.
	 */
	const coverageNote =
		typeof meta.deviceCoverageNote === "string" ? meta.deviceCoverageNote : "";
	const coverage =
		typeof meta.deviceCoverage === "object" && meta.deviceCoverage !== null
			? (meta.deviceCoverage as { notCaptured?: unknown })
			: null;
	const coveragePartial =
		Array.isArray(coverage?.notCaptured) && coverage.notCaptured.length > 0;

	/**
	 * The theme tile, which must not read "0 theme mismatches" over a matrix whose canvas
	 * half never ran.
	 *
	 * `themeApplied` is `false` only for a REAL mismatch; a frame whose canvas was never
	 * compared against a token leaves it `null`, so counting `false` alone printed a clean
	 * tile for a check that measured nothing — absence read as a pass, on the artifact a
	 * reviewer opens instead of the stdout. The records carry the distinction
	 * (`canvasMatchesToken`: `true`/`false` compared, `null` not), so the tile names the
	 * half that did not run and how much of the matrix it covered, and it derives the
	 * themes it lacked with the SAME predicate the capture uses rather than a second one.
	 */
	const themeMismatches = records.filter(
		(r) => r.themeApplied === false,
	).length;
	const canvasUncompared = records.filter(
		(r) => (r.themeCheck?.canvasMatchesToken ?? null) === null,
	).length;
	const perThemeTokens =
		typeof meta.themeTokens === "object" && meta.themeTokens !== null
			? (meta.themeTokens as Record<string, { canvas?: string | null }>)
			: null;
	const themesWithoutCanvas = ["dark", "light"].filter(
		(theme) => !canvasComparable(perThemeTokens?.[theme]?.canvas ?? null),
	);
	/**
	 * Why the half could not run, in the manifest's own terms — the three states
	 * `meta.themeTokens` distinguishes: unreadable (`null`), nothing named or found
	 * (`{}`), or a table that is missing a theme. A tile that counted frames and said no
	 * more would leave a reader to guess which, and the guess is what this tile is for.
	 */
	const canvasLack =
		perThemeTokens === null
			? "the capture could not read a token file"
			: Object.keys(perThemeTokens).length === 0
				? "the capture had no token file"
				: themesWithoutCanvas.length > 0
					? `the tokens carry no canvas for ${themesWithoutCanvas.join(" / ")}`
					: "the manifest records no canvas comparison for them";
	const themeTile =
		canvasUncompared === 0
			? `<div><b>${themeMismatches}</b> theme mismatches</div>`
			: `<div><b>${themeMismatches}</b> theme mismatches <span class="warn">(the canvas-vs-token half did not run for ${canvasUncompared} of ${records.length} cell(s) — ${canvasLack}; the run needs a canvas per theme from \`--tokens\`)</span></div>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Local Operator mobile — capture matrix</title>
<style>${style}</style>
</head>
<body>
<h1>Capture matrix</h1>
<p><code>${escapeHtml(meta.buildDir)}</code> · relay <code>${escapeHtml(meta.relay ?? "—")}</code> · scenario <code>${escapeHtml(meta.scenario ?? "—")}</code> · ${escapeHtml(meta.capturedAt)}</p>
<div class="summary">
	<div><b>${records.length}</b> cells</div>
	<div><b>${records.reduce((n, r) => n + (r.frames?.length ?? 0), 0)}</b> frames</div>
	${coverageNote ? `<div class="${coveragePartial ? "warn" : ""}">${escapeHtml(coverageNote)}</div>` : ""}
	<div class="${problems.length ? "fail" : ""}"><b>${problems.length}</b> problems</div>
	<div><b>${escapeHtml(meta.textScaleVerdict ?? "scale: not measured")}</b> text scale</div>
	${themeTile}
</div>
${problems.length ? `<h2>Problems</h2><table><tr><th>cell</th><th>problem</th></tr>${problems.map((p) => `<tr><td><code>${escapeHtml(p.name)}</code></td><td class="badtext">${escapeHtml(p.p)}</td></tr>`).join("")}</table>` : ""}
<h2>Theme resolution, per cell</h2>
${themeTable}
${figures}
</body>
</html>
`;
}
