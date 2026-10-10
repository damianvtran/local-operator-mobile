import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A settled receipt never live-paints.
 *
 * The canonical vocabulary (harness-lane freeze, 2026-10-09) allows a terminal
 * `stage: "completed"` on a settled record — the adapter reads it to the
 * done-arm (`imagegen.test.ts`) — and this is the card's half of that read:
 * the shimmer word, the progress frame and the log tail exist only under
 * `liveTone`, which must name the two LIVE phases and nothing else. A `done`
 * that joined the guard (or a second, unguarded spelling of a live element)
 * would paint a bar and a log tail over bytes that are already there — a
 * progress claim the feed did not make, at the render seam.
 *
 * Asserted over the SOURCE, because there is no render seam to read: the card
 * reaches `uniwind` through `@/ui/appearance`, which the Node test environment
 * cannot import (the same constraint as `model-sheet.test.ts`). The guard is
 * read out of the source rather than hardcoded, so a rename keeps passing
 * while `done` joining the set — the failure this exists for — fails by name.
 * Comments are stripped before any match (see `stripComments`): the reviewer
 * demonstrated that a stale commented guard above a `done`-joined one kept the
 * suite green, which is exactly the masking this test must not have (review
 * round 1, F2).
 */

/** The residual leading-`*` filter, top-level for the lint's reason. */
const LEADING_STAR = /^\s*\*/;

/**
 * Comments out of a source file before anything is matched against it.
 *
 * The pattern adopted from `src/ui/a11y.e2e.test.ts`: without it this test's
 * first match can be a COMMENT — a stale `// const liveTone = running ||
 * cancelling` left above a `done`-joined guard read as the guard and kept the
 * suite green (review round 1, F2, demonstrated on this very guard), and a
 * comment merely mentioning `<LogTail>` reddened the element counts, the
 * opposite false reading.
 *
 * Quote-aware on purpose (the a11y module's recorded reason): a naive
 * `/\/\/.*$/` also truncates `https://…` inside a string and HIDES the real
 * code after it — the direction that matters. The residual hole is the same
 * one, recorded rather than hidden: a mention inside a string still counts.
 */
const stripComments = (text: string): string => {
	let out = "";
	let quote: string | null = null;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i] ?? "";
		const next = text[i + 1] ?? "";
		if (quote !== null) {
			out += ch;
			if (ch === "\\") {
				out += next;
				i += 1;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			out += "\n";
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
				i += 1;
			}
			i += 1;
			continue;
		}
		out += ch;
	}
	return out
		.split("\n")
		.filter((line) => !LEADING_STAR.test(line))
		.join("\n");
};

/** The card's source, comments STRIPPED — every match below measures the live
 *  code, never a comment standing in for it. */
const SOURCE = stripComments(
	readFileSync(
		fileURLToPath(new URL("./imagegen-card.tsx", import.meta.url)),
		"utf8",
	),
);

/** The expression every live-only element sits under (top-level literal: the
 *  module is read once, and the lint's rule keeps it off the hot path). */
const LIVE_GUARD = /const liveTone = ([^;]+);/;

/** The generating body's gate, and the cancel control's (top-level literals:
 *  the lint's rule keeps regex construction off the hot path). */
const BODY_GATE = /const generatingBody = ([^;]+);/;
const CANCEL_GATE =
	/const showCancel =\s*view\.cancelable && !cancelRequested && onCancelTurn !== undefined;/;

const liveGuard = (): string => {
	const match = SOURCE.match(LIVE_GUARD);
	expect(match, "the card must declare its live guard").not.toBeNull();
	return match?.[1] ?? "";
};

/** The one live block: from its guard to the done arm that follows it. */
const liveBlock = (): string => {
	const start = SOURCE.indexOf("{liveTone ? (");
	const end = SOURCE.indexOf('{phase === "done" ?');
	expect(
		start,
		"the live block must be emitted under `liveTone`",
	).toBeGreaterThan(-1);
	expect(end, "the done arm must follow the live block").toBeGreaterThan(start);
	return SOURCE.slice(start, end);
};

describe("the card's live guard", () => {
	it("names the live phases and nothing else", () => {
		const guard = liveGuard();
		expect(guard).toContain('phase === "running"');
		expect(guard).toContain('phase === "cancelling"');
		/* The settled phases must never live-paint — this is the assertion a
		 * `done` (or any other settled value) joining the guard fails on. */
		expect(guard).not.toContain('"done"');
		expect(guard).not.toContain('"queued"');
		expect(guard).not.toContain('"failed"');
		expect(guard).not.toContain('"cancelled"');
	});

	it("gates every live-only element under the one guard, once each", () => {
		/* The three live-only elements — the shimmer word, the progress frame
		 * and the log tail — and the COUNT is the point: a second, unguarded
		 * spelling is the other way a settled receipt would live-paint. */
		expect((SOURCE.match(/\{liveTone \?/g) ?? []).length).toBe(1);
		expect((SOURCE.match(/<Shimmer active>/g) ?? []).length).toBe(1);
		expect((SOURCE.match(/<GeneratingFrame/g) ?? []).length).toBe(1);
		expect((SOURCE.match(/<LogTail/g) ?? []).length).toBe(1);
		const block = liveBlock();
		expect(block).toContain("<Shimmer active>");
		expect(block).toContain("<GeneratingFrame");
		expect(block).toContain("<LogTail");
	});

	it("paints the settled receipt through the done arm's own image path", () => {
		/* The other half of the manager's read: the settled record's artifact
		 * renders via `TranscriptImage` (the existing path), never the live
		 * frame — so the done arm must carry the image element. */
		const doneArm = SOURCE.slice(
			SOURCE.indexOf('{phase === "done" ?'),
			SOURCE.indexOf('{phase === "failed" ?'),
		);
		expect(doneArm).toContain("<TranscriptImage");
	});
});

describe("the generating body's gate (the F3 guard)", () => {
	/* The frame (whose track IS the bar) and the log tail are one body, behind
	 * ONE predicate: `generatingBody`. A hold that never generated must draw the
	 * word alone, so neither element may be reachable from `liveTone` alone. */
	it("derives the body from the live guard AND the generating fact", () => {
		const match = SOURCE.match(BODY_GATE);
		expect(match, "the card must declare its body gate").not.toBeNull();
		const gate = match?.[1] ?? "";
		expect(gate).toContain("liveTone");
		expect(gate).toContain("generating");
		// Negative control: the gate is not a bare re-spelling of the live guard.
		expect(gate.trim()).not.toBe("liveTone");
	});

	it("reads the fact through the shared predicate, from the WIRE phase", () => {
		expect(SOURCE).toContain("imageGenGenerating(view,");
		// The drawn phase carries the overlay; the fact must not be read from it.
		expect(SOURCE).not.toContain("imageGenGenerating(phase,");
	});

	it("puts the frame and the log tail behind the gate, and the word outside it", () => {
		const block = liveBlock();
		const frame = block.indexOf("<GeneratingFrame");
		const tail = block.indexOf("<LogTail");
		const gate = block.indexOf("generatingBody ?");
		expect(gate).toBeGreaterThan(-1);
		expect(frame).toBeGreaterThan(gate);
		expect(tail).toBeGreaterThan(block.indexOf("generatingBody &&"));
		// The gate appears once per element it covers — two, not zero, not three.
		expect((block.match(/generatingBody/g) ?? []).length).toBe(2);
		// The shimmer word is the hold's own content and renders before any gate.
		const word = block.indexOf("<Shimmer active>");
		expect(word).toBeGreaterThan(-1);
		expect(word).toBeLessThan(gate);
	});

	it("keeps ONE motion: the shimmer word plus the frame's single sweep", () => {
		// Exactly one indeterminate sweep element exists, inside the frame, and
		// only the fraction-less branch of it — no second loop beside the word.
		expect((SOURCE.match(/<IndeterminateTrack/g) ?? []).length).toBe(1);
		expect((SOURCE.match(/Animated\.loop\(/g) ?? []).length).toBe(1);
		expect((SOURCE.match(/<DeterminateTrack/g) ?? []).length).toBe(1);
	});

	it("keeps the cancel gate on the unsettled phases, queued included", () => {
		expect(SOURCE).toMatch(CANCEL_GATE);
	});
});
