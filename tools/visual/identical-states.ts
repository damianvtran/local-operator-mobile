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

import {
	IDENTICAL_FRAME_COINCIDENCES,
	IDENTICAL_FRAME_EXEMPTIONS,
	type IdenticalFrameClass,
} from "./matrix.ts";

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
 *   * a partition that still holds two declared states → a REAL COLLAPSE — unless every
 *     cell in it is EVIDENTIAL and the group is contained in a class declared in
 *     `IDENTICAL_FRAME_COINCIDENCES` (matrix.ts): a device COMPOSES surfaces — at
 *     tablet-landscape the home docks the conversations panel and `/conversations`
 *     renders the home itself, so two cells that
 *     each reach their own root and marker can genuinely BE one rendered view (PR #34).
 *     An undeclared same-content partition still fails, and a declaration is inert the
 *     moment any cell in it stops being evidential — a state the app ignored cannot show
 *     its own marker, so a real collapse can never qualify.
 *   * every cell carrying its own content → the pixels agree and the app does not: a
 *     camera limit, which passes ONLY when the produced group is CONTAINED in a class
 *     declared in `IDENTICAL_FRAME_EXEMPTIONS` (matrix.ts) with the reason a reviewer
 *     needs. An undeclared group FAILS with the cells to declare, so a new collapse
 *     cannot exempt itself by being camera-shaped by accident.
 *
 * A group with any collapse in it is reported as a collapse and nothing else: one real
 * collapse is the finding, and reporting a coexisting camera limit beside it would only
 * dilute it. A declared coincidence is reported under its own heading and does not fail.
 */
/**
 * The declared class a produced group belongs to, or `undefined`.
 *
 * MATCHED BY CONTAINMENT, NEVER BY EQUALITY, and that is the whole reason the ledgers
 * carry a class instead of the `Record<string, string>` keyed on the sorted cell names
 * this replaced. A run produces whichever SUBSET of a class its device, scale and seed
 * render identically — the S5 class is a three-way collision at 200 % and a two-way one
 * at 135 % — so an exact key needs one literal per subset and reds the blocking gate on
 * a phenomenon a reviewer already approved. A key per subset is unbounded: every new
 * scale, device or seed that makes a different subset identical asks for another entry.
 *
 * Containment keeps the tooth: EVERY cell in the produced group must be named by the
 * entry, so a group containing any undeclared cell still matches nothing and is reported.
 * The most SPECIFIC match wins (fewest declared cells), so a broad class's reason is
 * never quoted for a narrower collision it happens to contain.
 *
 * TIES. Two entries of the SAME arity can both contain the produced set once a ledger holds
 * two classes of equal length. The FIRST in ledger order wins, because the comparison is `<`
 * and not `<=` — reproduced by driving two three-cell classes that both contain one pair:
 * swapping their order in the array swaps the reason quoted. That is deliberate, since
 * neither entry is more specific than the other and the ledger's own order is then the only
 * defensible tie-break — which makes the array a PRIORITY list wherever two classes are the
 * same size, and is why an entry added above another can change which reason a run quotes
 * without changing whether it passes.
 *
 * What is NOT order-dependent is the ordinary case: a narrower class beats a broader one
 * whichever way round the two appear (verified both ways), so a tie is only ever reached
 * between classes a reviewer deliberately declared at the same size.
 *
 * Exported for the tests that pin the class semantics: the rule is shared by the
 * exemptions and the coincidences, and a test reaching it through only one of them could
 * not show that it holds for both.
 */
export function matchDeclared(
	group: readonly FrameRecord[],
	ledger: readonly IdenticalFrameClass[],
): IdenticalFrameClass | undefined {
	const produced = [...new Set(group.map((record) => record.cell))];
	let best: IdenticalFrameClass | undefined;
	for (const entry of ledger) {
		if (!produced.every((cell) => entry.cells.includes(cell))) continue;
		if (best === undefined || entry.cells.length < best.cells.length)
			best = entry;
	}
	return best;
}

/**
 * The cells a produced group names, SORTED — for the message that asks for a declaration.
 *
 * It repeats `matchDeclared`'s first line ON PURPOSE rather than sharing it, and the reason is
 * that the two want different things from the same set. The matcher tests CONTAINMENT, for
 * which order is irrelevant — it keeps first-seen order and never sorts. The message is text a
 * person pastes into the ledger, so it must be sorted, or one collision would print a different
 * string depending on which record the capture happened to read first. Folding the two would
 * either sort inside the matcher (work the containment test does not need) or hand the message
 * an order-dependent string; a shared helper with a `sort` flag would cost more indirection
 * than the two lines it saves.
 */
function producedCells(records: readonly FrameRecord[]): string[] {
	return [...new Set(records.map((record) => record.cell))].sort();
}

export function findIdenticalFrames(records: FrameRecord[]): {
	collapses: string[];
	undeclared: string[];
	exemptions: string[];
	coincidences: string[];
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
	const coincidences: string[] = [];
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
			const message = `${partStates.join(" = ")} rendered identically (${shaDigest}) on ${where}, and their frames carry the same content`;
			/* ONE VIEW, TWO STATES. A same-content pair is normally the collapse this check
			 * exists for — the app ignored a state — but a composition can render two
			 * declared states in ONE view: at tablet-landscape the home docks the
			 * conversations panel and `/conversations` renders the home itself, so two
			 * cells that each reach their own root and marker legitimately produce the
			 * same bytes AND the same content (PR #34). That case is statable only by
			 * declaration: the entry must carry a reason, and every cell in the partition
			 * must be EVIDENTIAL — a state the app ignored cannot show its own marker, so
			 * a real collapse can never qualify. An undeclared same-content partition is
			 * still pushed as a collapse below. */
			const declared = matchDeclared(part, IDENTICAL_FRAME_COINCIDENCES);
			const allEvidential = part.every(
				(record) => record.declaredSkip === null && record.ready !== false,
			);
			if (declared !== undefined && allEvidential) {
				coincidences.push(
					`${message} — declared one view for both states: ${declared.reason}`,
				);
				continue;
			}
			collapses.push(message);
		}
		// One real collapse is the finding; a camera limit beside it would only dilute it.
		if (collapsed.length > 0) continue;
		const declared = matchDeclared(group, IDENTICAL_FRAME_EXEMPTIONS);
		if (declared === undefined) {
			// Its own list, because it is its own statement: the pixels agree and the app
			// does not, which is a camera limit only once somebody declares it as one. Printed
			// under its own header so the summary never says "same content" about a pair whose
			// line says the content differs (QA round 1).
			//
			// The message hands over the CLASS to declare — the cells this run made identical —
			// because the ledger states classes and the run produces subsets (see
			// `matchDeclared`). Reading it as "declare this exact set" is what produced the
			// per-subset literals this shape replaced, so the sentence says both halves: the
			// class this run produced, and that extending an existing entry's `cells` is the
			// answer when the phenomenon is one already declared.
			const cells = producedCells(group);
			undeclared.push(
				`${label} rendered identically (${shaDigest}) on ${where} although their renderings differ: ` +
					`if that is the viewport filling with chrome rather than a collapse, declare the class ` +
					`{ cells: [${cells.map((cell) => `'${cell}'`).join(", ")}] } in matrix.ts ` +
					"IDENTICAL_FRAME_EXEMPTIONS with the reason — or extend the `cells` of the entry " +
					"that already describes this phenomenon — because until it is declared, a " +
					"byte-identical pair of different states is not evidence",
			);
		} else {
			exemptions.push(
				`${label} rendered identically (${shaDigest}) on ${where} — declared, not a collapse: ${declared.reason}`,
			);
		}
	}
	return { collapses, undeclared, exemptions, coincidences };
}
