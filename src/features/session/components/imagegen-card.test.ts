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
 */
const SOURCE = readFileSync(
	fileURLToPath(new URL("./imagegen-card.tsx", import.meta.url)),
	"utf8",
);

/** The expression every live-only element sits under, as the source writes it. */
/** The expression every live-only element sits under (top-level literal: the
 *  module is read once, and the lint's rule keeps it off the hot path). */
const LIVE_GUARD = /const liveTone = ([^;]+);/;

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
