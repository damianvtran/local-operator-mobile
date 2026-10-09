import type { CheckpointEntry, CheckpointManifest } from "@/contracts";

/**
 * The checkpoint rail's pure half: what a manifest means for the rail, where
 * each tick sits, and which of the two forms it draws in.
 *
 * Extracted from the component for the reason `find.ts` gives one directory
 * over: the decisions that are only eyeballed in a frame drift silently when
 * the surface around them changes, so the placement arithmetic and the state
 * set are exercised directly in Node (`checkpoint-rail.test.ts`) while the
 * component stays a renderer.
 *
 * THE TICKS COME FROM THE MANIFEST, NOT THE FRAMES. The phone's projection is
 * a bounded tail window, so a rail folded from the rows a phone happens to
 * hold would silently mark only the tail of the conversation — the whole
 * reason the route exists. Every mark below is derived from
 * `GET /api/sessions/{id}/checkpoints`, which the journal answers whole.
 *
 * WHAT THE MANIFEST CAN SAY, and what the rail must keep apart (the core
 * lane's consumption brief, design D1/D2/D9):
 *
 *  - `ready` with no ticks is a conversation with nothing written yet —
 *    genuinely empty. The rail renders nothing and claims nothing.
 *  - `building` means a scan is in flight and `checkpoints` carries the
 *    previous scan where one exists: the rail keeps painting what it has and
 *    the caller POLLS. A cold cache's first answer IS `building`, so "nothing
 *    yet" must not freeze — it is a loading state, not an answer.
 *  - `error` means the last refresh failed: a journal that fails to read must
 *    never render as "no checkpoints", so this state draws a failure mark
 *    instead of an empty rail. The distinction the states keep is between the
 *    rail SAYING there is nothing and the rail SAYING it could not look —
 *    nothing on the wire ("we hold no manifest") is the one case that draws
 *    nothing, because there is no claim to make either way (an older relay
 *    answers the route's 404, and the rail is pure decoration that must
 *    degrade to it silently).
 */

/**
 * The rail's drawing vocabulary, one word per thing the manifest can say.
 *
 * `open` is the live unsettled tail and draws as an in-progress DOT, never a
 * tick; `plain` is a completion whose marker carried no outcome word — it must
 * not borrow `complete`'s tick, because the tick would claim a verdict the
 * wire did not send (`desktop_sessions.py:699-721`).
 */
export type RailVocabulary =
	| "user"
	| "plain"
	| "complete"
	| "error"
	| "interrupted"
	| "open";

/**
 * A mark's drawn size class. A GLYPH is the full vocabulary mark (~11 pt, big
 * enough for the ✓ / ! / ⊘ / ● shapes to read); a COMPACT mark is the thin
 * dash the rail falls back to when the local rhythm cannot hold glyphs —
 * seq-proportional placement compresses long conversations, and two glyphs
 * 4 pt apart are a blob, while two 2.5 pt dashes 4 pt apart are a legible
 * ladder (the desktop rail's own density look). Outcome colour lives on the
 * glyphs only: a semantic-coloured bare dash is a colour-only status the UI
 * audit rightly refuses (U-03), so the compact form carries no semantic ink.
 */
export type RailForm = "glyph" | "compact";

/** One placed tick: its identity, the word it draws, and where. */
export interface RailMark {
	/** The journal entry id — a real user row or closing answer row. */
	id: string;
	vocabulary: RailVocabulary;
	/** The mark's centre as a fraction [0..1] of the manifest's seq range. */
	fraction: number;
}

/** A mark with its resolved drawing facts for a track of a given height. */
export interface PositionedRailMark {
	mark: RailMark;
	/** Centre y in points, from the track's top edge. */
	yPt: number;
	form: RailForm;
}

/**
 * The rail's whole renderable state — the state set the capture cells declare
 * (S5/rail, S5/rail-deep, S5/rail-building, S5/rail-error). The `ready`+[]
 * state draws no rail and is pinned by the unit and e2e suites instead — a
 * cell for it would be the empty-shaped frame S5/empty already proves, and
 * its marker deliberately stays out of the `-empty` suffix (see `rail-empty`
 * in `src/ui/a11y.ts`: the readiness sweep reads that suffix as a screen
 * empty wherever a `path:` cell can see it).
 *
 * `waiting` and `unavailable` BOTH render nothing, and they are still two
 * states because they are different facts: `waiting` has not heard from the
 * relay yet, `unavailable` heard a failure it holds no manifest for (an older
 * relay's 404, a dropped route). Neither is "no checkpoints" — that claim
 * belongs to `empty` alone.
 */
export type RailState =
	/** No answer yet; the first read is in flight. */
	| { kind: "waiting" }
	/** The read failed and there is no manifest to paint; nothing is claimed. */
	| { kind: "unavailable" }
	/** `ready` with no ticks: a conversation with nothing written yet. */
	| { kind: "empty" }
	/** Ticks to paint; `building` adds the liveness mark and keeps the poll on. */
	| { kind: "marks"; marks: RailMark[]; building: boolean }
	/** The relay said the read failed. Never an empty rail — see the header. */
	| { kind: "error"; marks: RailMark[] };

/** The word one checkpoint draws. */
export const checkpointVocabulary = (
	entry: CheckpointEntry,
): RailVocabulary => {
	if (entry.kind === "user") return "user";
	switch (entry.outcome) {
		case "complete":
			return "complete";
		case "error":
			return "error";
		case "interrupted":
			return "interrupted";
		case "open":
			return "open";
		default:
			// `null` — the completion marker carried no kind. NOT `complete`:
			// rendering the ✓ here would claim a verdict nobody wrote.
			return "plain";
	}
};

/**
 * The manifest's ticks as marks, in one pass.
 *
 * Fractions are taken against the marks' OWN seq range: the first tick sits at
 * the track's top, the last at its bottom, and the space between is the
 * conversation's own spacing (`seq` is the journal row ordinal, so a turn that
 * said more occupies more of the rail). A single tick has no range to place
 * against and sits at the centre — the answer that reads as "one checkpoint",
 * where top or bottom would read as "the start" or "the end".
 *
 * Input order is the manifest's (oldest first) and is kept: the route's own
 * suite pins the order, and re-sorting here would paper over a wire change
 * instead of failing the strip test that reads it.
 */
export const railMarks = (
	checkpoints: readonly CheckpointEntry[],
): RailMark[] => {
	if (checkpoints.length === 0) return [];
	let min = Infinity;
	let max = -Infinity;
	for (const entry of checkpoints) {
		if (entry.seq < min) min = entry.seq;
		if (entry.seq > max) max = entry.seq;
	}
	const span = max - min;
	return checkpoints.map((entry) => ({
		id: entry.id,
		vocabulary: checkpointVocabulary(entry),
		fraction: span <= 0 ? 0.5 : (entry.seq - min) / span,
	}));
};

/**
 * What a manifest (or its absence) means for the rail.
 *
 * The three rules the states encode, each with its own cell:
 *
 *  - `building`/`stale` paint the previous scan (possibly none) plus the
 *    liveness mark, and the caller polls (`use-checkpoints.ts`). `stale` is
 *    grouped with `building` deliberately: the wire reserves it for a manifest
 *    served out of date on purpose, and out-of-date reads like in-flight to
 *    every consumer (the desktop rail's own grouping).
 *  - `ready` with ink is marks; `ready` with none is `empty` — the two are
 *    different answers and the rail must not let one render as the other.
 *  - `error` keeps whatever ticks the previous scan left and draws the failure
 *    mark over them. `unsupported` (a peer conversation — unreachable on this
 *    route, which 404s unknown sessions first) reads like `unavailable`:
 *    nothing can be said, so nothing is.
 */
export const railState = (
	manifest: CheckpointManifest | null,
	readFailed: boolean,
): RailState => {
	if (manifest === null) {
		return readFailed ? { kind: "unavailable" } : { kind: "waiting" };
	}
	const marks = railMarks(manifest.checkpoints);
	switch (manifest.index.state) {
		case "error":
			return { kind: "error", marks };
		case "building":
		case "stale":
			return { kind: "marks", marks, building: true };
		case "unsupported":
			return { kind: "unavailable" };
		default: {
			// `ready`
			return marks.length === 0
				? { kind: "empty" }
				: { kind: "marks", marks, building: false };
		}
	}
};

/** The vertical gutter a mark keeps from the track's edges, in points: half a
 *  glyph plus air, so the first and last marks are never clipped. */
export const RAIL_INSET_PT = 10;

/** The centre-to-centre clearance below which a glyph cannot hold its shape —
 *  the glyph size plus a hair. Between neighbours this is what decides
 *  `RailForm`; anywhere else on a rail is compact. */
export const GLYPH_CLEARANCE_PT = 12;

/**
 * Place the marks on a track `trackPt` tall and pick each one's form.
 *
 * SEQ-PROPORTIONAL, full stop: `y = inset + fraction * (track - 2 * inset)`.
 * No clamping, no de-overlap nudging — positions stay faithful to the
 * conversation, and density resolves through the FORM decision instead: a
 * mark whose nearest neighbour is closer than `GLYPH_CLEARANCE_PT` draws
 * compact, so a dense stretch becomes the thin ladder and never a pile of
 * overlapping glyphs. Marks that sit sub-pixel apart simply draw over each
 * other as a solid run — which is what "very many turns here" looks like, and
 * is honest; nudging them apart would move a tick to a seq it does not own.
 */
export const layoutRailMarks = (
	marks: readonly RailMark[],
	trackPt: number,
): PositionedRailMark[] => {
	const usable = Math.max(0, trackPt - 2 * RAIL_INSET_PT);
	const ys = marks.map((mark) => RAIL_INSET_PT + mark.fraction * usable);
	return marks.map((mark, index) => {
		const y = ys[index] ?? RAIL_INSET_PT;
		const above = index > 0 ? y - (ys[index - 1] ?? y) : Infinity;
		const below =
			index < marks.length - 1 ? (ys[index + 1] ?? y) - y : Infinity;
		const clearance = Math.min(above, below);
		return {
			mark,
			yPt: y,
			form: clearance >= GLYPH_CLEARANCE_PT ? "glyph" : "compact",
		};
	});
};

/**
 * Whether any mark is for a row this device does NOT hold — the rail's
 * beyond-the-window claim, and the one fact a frame of the rail cannot
 * otherwise assert (`S5/rail-deep`'s marker reads exactly this).
 *
 * `loadedIds` is the ids of the entries the transcript actually carries; a
 * mark outside it is a turn the window cannot show, which is what makes the
 * whole-conversation claim real rather than rhetorical.
 */
export const marksBeyondWindow = (
	marks: readonly RailMark[],
	loadedIds: ReadonlySet<string>,
): boolean => marks.some((mark) => !loadedIds.has(mark.id));
