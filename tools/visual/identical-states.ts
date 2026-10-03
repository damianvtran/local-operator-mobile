/**
 * The identical-frame partition, kept pure so it can be tested.
 *
 * It lives in its own module rather than in `capture.ts` because the rule is PURE — records
 * in, findings out — while the file that runs it pulls in the whole harness: the CDP client,
 * the browser launcher, the argv parser. `capture.ts` is importable, verified: an `import`
 * returns `runCapture` and does not execute the CLI. So the reason is the blast radius of a
 * test that must load all of that to reach eight assertions, not a technical barrier — and the
 * undeclared-pair branch is a BLOCKING outcome, exactly the kind of path that needs a test
 * rather than a reviewer's word.
 */

import { IDENTICAL_FRAME_EXEMPTIONS } from "./matrix.ts";

/**
 * One captured cell, as much of it as the partition reads.
 *
 * Structural rather than imported: the capture's `CaptureRecord` satisfies it, and a
 * narrow shape keeps the fixtures honest about what the rule actually looks at.
 */
export interface FrameRecord {
	/** `screen/state` — the pair a collapse is reported between. */
	screen: string;
	state: string;
	cell: string;
	device: string;
	/** `null` unless the app declares no marker for this cell's state. */
	declaredSkip: unknown | null;
	/**
	 * Whether the frame AFFIRMS the state it declares, as the readiness guard decided it.
	 * `false` means the app rendered its fallback screen, so the frame is not evidence for
	 * that state — see the not-evidence rule below.
	 */
	ready?: boolean | null;
	/** What the cell is SHOWING, read without the viewport — see `CONTENT_PROBE`. */
	contentDigest: string;
	frames: Array<{ sha: string }>;
}

/**
 * Cells that declare different states but produced the same bytes.
 *
 * The check is deliberately cross-cell rather than per-cell: two *themes* of one
 * cell being identical is already caught by the twin check, while two *states*
 * of one screen being identical is the separate, harder-to-notice failure — the
 * app ignored the state and rendered one screen for all of them.
 *
 * Compared on the settled frame, which is the one a reviewer looks at.
 *
 * BYTES ALONE ARE NOT THE VERDICT, and this is the distinction that matters. A frame is
 * a viewport, and a viewport can be filled by chrome: at 320 px with 200 % text two cells
 * whose content differs in every row are byte-identical because the rows are below the
 * fold. So a byte-identical group is partitioned by what each cell is SHOWING
 * (`contentDigest`, read by `CONTENT_PROBE` without the viewport) and the two outcomes are
 * kept apart:
 *
 *   * a partition that still holds two declared states → a REAL COLLAPSE. It fails, with
 *     the same shape of message as before.
 *   * every cell carrying its own content → the pixels agree and the app does not: a
 *     camera limit, which passes ONLY when the pair is declared in
 *     `IDENTICAL_FRAME_EXEMPTIONS` (matrix.ts) with the reason a reviewer needs. An
 *     undeclared pair FAILS with the key to declare, so a new collapse cannot exempt
 *     itself by being camera-shaped by accident.
 *
 * A group with any collapse in it is reported as a collapse and nothing else: one real
 * collapse is the finding, and reporting a coexisting camera limit beside it would only
 * dilute it.
 */
function exemptionKey(records: readonly FrameRecord[]): string {
	return [...new Set(records.map((record) => record.cell))].sort().join("|");
}

export function findIdenticalFrames(records: FrameRecord[]): {
	collapses: string[];
	undeclared: string[];
	exemptions: string[];
} {
	const bySha = new Map<string, FrameRecord[]>();
	for (const record of records) {
		const frame = record.frames[record.frames.length - 1];
		if (frame === undefined) continue;
		const key = `${frame.sha}`;
		bySha.set(key, [...(bySha.get(key) ?? []), record]);
	}
	const collapses: string[] = [];
	const undeclared: string[] = [];
	const exemptions: string[] = [];
	for (const [shaDigest, group] of bySha) {
		const states = new Set(
			group.map((record) => `${record.screen}/${record.state}`),
		);
		if (states.size < 2) continue;
		// A DECLARED SKIP is not evidence for the state it names, so a group made ONLY of
		// skipped cells rendering one image is the known gap, not a finding: the 29 skips
		// on this head are one placeholder screen between them, and reporting that as
		// "different states, one image" three times is noise a reviewer has to re-derive.
		//
		// The check keeps every tooth that matters: one EVIDENTIAL cell is enough to
		// report the group, so a measured cell that collapses onto a skipped one — or two
		// measured cells that collapse onto each other — is still caught.
		// A frame that does not AFFIRM the state it declares is not evidence for it, and the
		// declared skips are only half of that set: a cell that never reached its state
		// (`ready: false`, reported as NOT MEASURABLE with the reason) rendered the app's
		// fallback screen, and comparing fallback screens across cells reports "two states,
		// one image" for a frame that was never that state's image. Measured on the ci tier:
		// `S5/error` reaches its mid-stream 401 only when the fault lands before the frame,
		// and in the runs where it did not, its frame collided with `S5/populated`'s.
		//
		// The check keeps every tooth that matters: one EVIDENTIAL cell is enough to report
		// the group, so a ready cell that collapses onto an unready one — or two ready cells
		// that collapse onto each other — is still caught.
		if (
			!group.some(
				(record) => record.declaredSkip === null && record.ready !== false,
			)
		)
			continue;
		const where = group[0]?.device ?? "?";
		const label = [...states].sort().join(" = ");
		// Partition by what each cell is SHOWING. Two cells in one partition rendered the
		// same bytes AND the same content: that is a collapse, whichever viewport they were
		// captured at.
		const byContent = new Map<string, FrameRecord[]>();
		for (const record of group) {
			byContent.set(record.contentDigest, [
				...(byContent.get(record.contentDigest) ?? []),
				record,
			]);
		}
		const partitions = [...byContent.values()];
		const collapsed = partitions.filter(
			(part) =>
				new Set(part.map((record) => `${record.screen}/${record.state}`)).size >
				1,
		);
		for (const part of collapsed) {
			const partStates = [
				...new Set(part.map((record) => `${record.screen}/${record.state}`)),
			].sort();
			collapses.push(
				`${partStates.join(" = ")} rendered identically (${shaDigest}) on ${where}, and their frames carry the same content`,
			);
		}
		// One real collapse is the finding; a camera limit beside it would only dilute it.
		if (collapsed.length > 0) continue;
		const key = exemptionKey(group);
		const reason = IDENTICAL_FRAME_EXEMPTIONS[key];
		if (reason === undefined) {
			// Its own list, because it is its own statement: the pixels agree and the app
			// does not, which is a camera limit only once somebody declares it as one. Printed
			// under its own header so the summary never says "same content" about a pair whose
			// line says the content differs (QA round 1).
			undeclared.push(
				`${label} rendered identically (${shaDigest}) on ${where} although their renderings differ: ` +
					`if that is the viewport filling with chrome rather than a collapse, declare '${key}' ` +
					"in matrix.ts IDENTICAL_FRAME_EXEMPTIONS with the reason — until it is declared, a " +
					"byte-identical pair of different states is not evidence",
			);
		} else {
			exemptions.push(
				`${label} rendered identically (${shaDigest}) on ${where} — declared, not a collapse: ${reason}`,
			);
		}
	}
	return { collapses, undeclared, exemptions };
}
