import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SCALES, textScaleFactor } from "../visual/matrix";
import {
	admitRecordScales,
	admitRecordWorlds,
	auditCellUrl,
	cellUrl,
	runAudit,
} from "./audit";

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

	/* RESTORED AFTER #124 DELETED IT, verbatim from that PR's parent (`26730aa~1`).
	 * The `&` test above only proves the JOIN character is right for one parameter;
	 * this one proves the cell's own parameters SURVIVE the join and stay readable,
	 * which is the rest of D4: two cell parameters beside one the audit adds, each
	 * addressable by name. #124 rewrote this file for the text-scale table and the
	 * deleted case rode out with the edit — a regression guard that was quietly
	 * retired by a refactor, which is exactly the hole it existed to plug. */
	it("keeps the cell's own parameters readable, not swallowed by the audit's", () => {
		const url = new URL(
			cellUrl(
				"http://127.0.0.1:1",
				"/session/abc?lo-draft=d&lo-dictation=recording",
				"lo-theme=dark",
			),
		);
		expect(url.searchParams.get("lo-dictation")).toBe("recording");
		expect(url.searchParams.get("lo-draft")).toBe("d");
		expect(url.searchParams.get("lo-theme")).toBe("dark");
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

/**
 * THE FACTOR THE MANIFEST RECORDED, not only the id it names.
 *
 * A record carries a scale ID, and the audit resolves that ID against `matrix.ts`'s LIVE
 * `SCALES`. The capture also writes the table it read into `meta.scaleProfile`, so the two
 * can be compared — and they HAVE disagreed: `135` was declared at 1.35 and is 1.3529411765
 * (the exact iOS `xxxLarge` step) today. A manifest captured on either side of that edit
 * names the same id at two different sizes, and re-driving it against today's table renders
 * a page the capture never saw while every row still carries the cell's name.
 */
describe("admitRecordScales", () => {
	const record = (scale: string) => ({
		cell: `S8/populated-long`,
		path: "/session/x",
		scale,
	});

	it("refuses a record whose recorded factor is not the table's, naming both", () => {
		expect(() =>
			admitRecordScales([record("135")], {
				scaleProfile: [{ id: "135", factor: 1.35 }],
			}),
		).toThrow(
			'S8/populated-long records scale "135" at factor 1.35, but this head\'s scale table declares 1.3529411765',
		);
	});

	it("admits a record whose recorded factor matches (negative control)", () => {
		expect(() =>
			admitRecordScales([record("135")], {
				scaleProfile: [
					{ id: "100", factor: 1 },
					{ id: "135", factor: 1.3529411765 },
				],
			}),
		).not.toThrow();
	});

	it("admits a manifest that recorded no table at all", () => {
		/* An artifact written before the field existed carries nothing to compare, and
		 * refusing it would retire every older capture for a disagreement it cannot have.
		 * What it cannot do is claim a factor it never recorded. */
		expect(() => admitRecordScales([record("135")], {})).not.toThrow();
	});

	it("still refuses an id the table does not declare", () => {
		expect(() => admitRecordScales([record("175")], {})).toThrow(
			"which the capture's scale table never defines",
		);
	});
});

/**
 * The same refusal through the entry point CI runs: the disagreement must stop the audit
 * before a browser starts, so no row can be produced under the cell's name.
 */
describe("runAudit scale admission against a stale table", () => {
	it("refuses a manifest whose recorded factor disagrees with the table", async () => {
		const dir = mkdtempSync(join(tmpdir(), "audit-scale-stale-"));
		const manifest = join(dir, "manifest.json");
		writeFileSync(
			manifest,
			JSON.stringify({
				meta: {
					buildDir: join(dir, "build"),
					scaleProfile: [{ id: "150", factor: 1.4 }],
				},
				records: [
					{
						screen: "S8",
						state: "approval",
						device: "iphone-15",
						theme: "dark",
						scale: "150",
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
				'records scale "150" at factor 1.4, but this head\'s scale table declares 1.5',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);
});

/**
 * THE WORLD A RECORD PINS MUST DECLARE THAT CELL.
 *
 * A cell's state is a property of a relay world as much as of a URL: `S8/populated-long`
 * renders a 65-character name in `long-names` and nowhere else, `S5/populated-long` renders
 * the 520-row transcript in `long-transcript`. Measured on this head: those two cells pin
 * those two worlds, and their captured frames show exactly that (the 65-character title
 * clipped to two lines over the approval card; the 25-character name over the long
 * transcript). A manifest whose pin names a world that does not declare the cell — an older
 * head, a hand edit, a `--scenario` pin — makes the re-drive render a page the cell never
 * named while every row still carries the cell's name, and no frame afterwards can tell.
 */
describe("admitRecordWorlds", () => {
	const record = (cell: string, pinnedScenario: string | null) => ({
		cell,
		path: "/session/x",
		pinnedScenario,
	});

	const meta = {
		cellWorlds: {
			"S8/populated-long": ["long-names"],
			"S5/populated-long": ["long-transcript", "long-names"],
		},
	};

	it("refuses a pin that names a world which does not declare the cell", () => {
		expect(() =>
			admitRecordWorlds([record("S8/populated-long", "long-transcript")], meta),
		).toThrow(
			'S8/populated-long pins the relay world "long-transcript", which does not declare it — the worlds that do are long-names',
		);
	});

	it("admits a pin the registry really declares (negative control)", () => {
		// `S5/populated-long` is declared by TWO worlds; either is a truthful pin.
		expect(() =>
			admitRecordWorlds([record("S5/populated-long", "long-transcript")], meta),
		).not.toThrow();
		expect(() =>
			admitRecordWorlds([record("S5/populated-long", "long-names")], meta),
		).not.toThrow();
	});

	it("admits a record that pins no world, and a manifest that recorded none", () => {
		// An ad-hoc `path:` page declares no world; an older artifact carries no map.
		expect(() =>
			admitRecordWorlds([record("S8/populated-long", null)], meta),
		).not.toThrow();
		expect(() =>
			admitRecordWorlds([record("S8/populated-long", "long-transcript")], {}),
		).not.toThrow();
	});
});
