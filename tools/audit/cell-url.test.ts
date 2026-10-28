import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SCALES, textScaleFactor } from "../visual/matrix";
import { auditCellUrl, cellUrl, runAudit } from "./audit";

/**
 * The audit's URL join, pinned.
 *
 * Regression guard for design round 1, D4: a cell whose `path:` already carried a
 * query (`…?lo-dictation=recording`) was joined with an unconditional `?`, so the
 * cell's own parameter became `recording?lo-theme=dark&…` and `lo-dictation` never
 * applied — the audit measured the ordinary composer and reported the cell's name.
 */
describe("cellUrl", () => {
	it("uses `?` when the cell's path carries no query", () => {
		expect(cellUrl("http://127.0.0.1:1", "/session/abc", "lo-theme=dark")).toBe(
			"http://127.0.0.1:1/session/abc?lo-theme=dark",
		);
	});

	it("uses `&` when the cell's path already carries a query", () => {
		expect(
			cellUrl(
				"http://127.0.0.1:1",
				"/session/abc?lo-dictation=recording",
				"lo-theme=dark&lo-text-scale=2",
			),
		).toBe(
			"http://127.0.0.1:1/session/abc?lo-dictation=recording&lo-theme=dark&lo-text-scale=2",
		);
	});
});

/**
 * A regression test for the audit re-drive, not merely for the shared lookup:
 * every declared scale must reach the cell URL at the factor capture used. The
 * old 100/150/other ternary passed this test at 200 while rendering 135 at 200.
 */
describe("audit re-drive text scale", () => {
	// Driven by the table, not by a copied list: a scale added to `SCALES` is
	// covered here without anyone remembering to extend the test.
	it.each(SCALES.map((entry) => entry.id))(
		"uses the capture factor for scale %s",
		(scale) => {
			const record = {
				screen: "S4",
				state: "default",
				device: "iphone-15",
				theme: "dark",
				scale,
				path: "/",
				viewport: { width: 390, height: 844, dpr: 3 },
				insets: { top: 59, bottom: 34, left: 0, right: 0 },
				ready: false,
			};
			const url = auditCellUrl("http://127.0.0.1:1", record, null);
			const declared = SCALES.find((entry) => entry.id === scale)?.factor;
			expect(new URL(url).searchParams.get("lo-text-scale")).toBe(
				String(declared),
			);
		},
	);

	it("refuses an unknown scale instead of falling back to 200%", () => {
		expect(() => textScaleFactor("175")).toThrow("unknown text scale '175'");
		const record = {
			screen: "S4",
			state: "default",
			device: "iphone-15",
			theme: "dark",
			scale: "175",
			path: "/",
			viewport: { width: 390, height: 844, dpr: 3 },
			insets: { top: 59, bottom: 34, left: 0, right: 0 },
			ready: false,
		};
		expect(() => auditCellUrl("http://127.0.0.1:1", record, null)).toThrow(
			"unknown text scale '175'",
		);
	});
});

/**
 * The refusal, exercised through the entry point that actually runs in CI: a
 * manifest naming a scale the capture never used must stop the run before a
 * browser starts, rather than render some other size under the cell's name.
 */
describe("runAudit scale admission", () => {
	it("refuses a manifest whose record names an unknown scale", async () => {
		const dir = mkdtempSync(join(tmpdir(), "audit-scale-"));
		const manifest = join(dir, "manifest.json");
		writeFileSync(
			manifest,
			JSON.stringify({
				meta: { buildDir: join(dir, "build") },
				records: [
					{
						screen: "S8",
						state: "approval",
						device: "iphone-15",
						theme: "dark",
						scale: "175",
						path: "/session/x",
						viewport: { width: 390, height: 844, dpr: 3 },
						insets: { top: 59, bottom: 34, left: 0, right: 0 },
					},
				],
			}),
		);
		try {
			await expect(
				runAudit({
					manifest,
					out: dir,
					checks: [],
					tokens: undefined,
					settleMs: 0,
					cellTimeoutMs: 1000,
					blind: [],
					quiet: true,
				}),
			).rejects.toThrow(
				'records scale "175", which the capture\'s scale table never defines',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
		// A loaded machine runs this file's imports slowly; the refusal itself is
		// immediate, and the budget is the file's, not the assertion's.
	}, 30_000);
});
