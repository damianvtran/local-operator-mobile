import { LARGE_TEXT_SCALE } from "@/ui/text-scale";

/** Build389 shared layout. Model/effort live in a permanent context strip,
 * never in a keyboard-inline receipt. Optional facts live in More, so no
 * measured-width ladder can temporarily paint all facts or evict effort. */
/* The discs sit one 4 pt step apart (`gap-1`), the smallest non-zero step of
 * `space.scale`. `gap-0.5`'s 2 pt was off the scale and failed U-42 on every
 * composer frame (2752 rows on main after #163); the 44 pt discs and their
 * touch floors are unchanged, only the seam between them moves by 2 pt. */
export const COMPOSER_CONTROLS_ROW = "min-h-11 flex-row items-center gap-x-1";

export const COMPOSER_ACTION_CLUSTER =
	"ms-auto shrink-0 flex-row items-center gap-1";

export const COMPOSER_DISC =
	"h-11 w-11 items-center justify-center rounded-full";

export const COMPOSER_META_ROW =
	"min-h-11 min-w-0 flex-row items-center gap-1 overflow-hidden";

/** The chip row's `gap-1`, in pt, for `composerChipPlan`'s arithmetic. */
export const COMPOSER_META_GAP_PT = 4;

/** The strip chip's glass capsule hugs its chip (design D1): the model slot is
 *  a `flex-1` column whose default `alignItems: stretch` would otherwise draw
 *  the capsule across the whole slot with the label at its left end. Set on
 *  the capsule, not the slot, so the SOLID chip keeps its full-slot target. */
export const COMPOSER_CHIP_CAPSULE_ALIGN = "flex-start" as const;

export const ATTACH_GLYPH_PT = 20;

export const MODEL_FLOOR_PT = 44;

/**
 * The home strip's folder chip: a folder glyph and the folder's own name, capped,
 * and the glyph alone at large text (design D2 / UX U4).
 *
 * WHY. Once the chip names the real folder instead of `~` (UX U1), a whole path
 * took up to the old 160 pt cap before anything else yielded, and at 320 pt /
 * 200 % the model chip was already down to `Cla…` — Opus 5 and Opus 4.8 then
 * read the same. The name is what tells two folders apart at a glance; the whole
 * path stays on the chip's spoken label and in the sheet. The glyph is what makes
 * a bare `~` or `app` read as a control rather than a stray character.
 */
export const FOLDER_CHIP_MAX_PT = 112;

/** The folder chip's visible text at this text scale: its name, or nothing (the
 *  glyph alone) past `LARGE_TEXT_SCALE`, where the strip's width belongs to the
 *  model's name. */
export const folderChipText = (name: string, scale: number): string =>
	scale > LARGE_TEXT_SCALE ? "" : name;

/**
 * The order the home strip's chips give up width: folder first, then effort,
 * then model (design D2). Flex weights, not a measured ladder: a chip's shrink
 * is weighted by its own width, so a factor of ten between neighbours makes the
 * earlier one give nearly all of the overflow before the next moves, and each
 * still stops at its 44 pt floor. On the card only `folder` and `model` are
 * read: effort is rigid there and leaves the row by `composerChipPlan`.
 */
export const HOME_STRIP_SHRINK = { folder: 100, effort: 10, model: 1 } as const;

/* WHY THE CARD HAS ONE SHRINKER AFTER THE FOLDER, AND NO SHRINK WEIGHTS.
 * Weighted pairs are right under CSS §9.7 (RN-web) but not on iOS: RN 0.86.3's
 * vendored Yoga freezes a floored item inside its first distribution pass and
 * still charges later items against the ORIGINAL free space (yoga#2006, fixed
 * upstream in 73bebc0, not vendored), which once put More, the queue and
 * keyboard-dismiss past the row's end (round-3 review R3-M1). The bug needs a
 * SECOND shrinker after a floored one, so effort and the queued count are
 * RIGID on the card and are admitted, shortened or dropped by the plan below. */

/** The card's chip zone: everything between attach and the mic/send cluster on
 *  the controls row (visual audit D5). `flex-1 min-w-0` between fixed-width
 *  siblings, so its width is set by the row and never by the chips inside it —
 *  which is what lets `composerChipPlan` read that width without feeding it.
 *  `overflow-hidden` is the last line of defence, not the layout: a chip that
 *  somehow out-measures the plan is cut at the zone's edge rather than painted
 *  over the send disc (U-08). */
export const COMPOSER_CHIP_ZONE =
	"min-w-0 flex-1 flex-row items-center gap-1 overflow-hidden";

/** The zone's trailing slot: More (or keyboard-dismiss) and, where the card
 *  carries it, the queued count ahead of it. Its auto margin is the ONLY thing
 *  in the zone that absorbs free width, so the slot holds the trailing edge
 *  whether or not effort is on the row and the chips still pack at the
 *  leading edge (TestFlight 578). Rigid: its members are never the ones cut. */
export const COMPOSER_CHIP_TRAILING =
	"ms-auto shrink-0 flex-row items-center gap-1";

/** A `text-mono-sm` glyph's advance, pt at 100 % (12 pt × the 0.6 em advance
 *  of the kit's mono face), and a quiet chip's horizontal padding. An ESTIMATE
 *  on purpose: the plan needs to know whether effort fits BEFORE either chip
 *  has been laid out, and measuring the chips first is a frame in which both
 *  paint and one is then removed. Erring wide only drops effort a little early;
 *  erring narrow is what `COMPOSER_CHIP_ZONE`'s clip is for. */
export const CHIP_CHAR_PT = 7.2;
export const CHIP_PAD_PT = 24;

/** A value chip's estimated width: its floor, or its label at the text scale. */
export const chipWidthEstimate = (chars: number, scale: number): number =>
	Math.max(
		MODEL_FLOOR_PT,
		Math.ceil(chars * CHIP_CHAR_PT * scale) + CHIP_PAD_PT,
	);

/** The queued count's horizontal padding (`px-1`) and its widest label, pt. */
export const QUEUED_CHIP_PAD_PT = 8;
export const QUEUED_CHIP_MAX_PT = 160;

/** The queued count's estimated width on the card: its floor, or its text at
 *  the scale, never past the cap the chip itself carries. The same deliberate
 *  over-estimate as `chipWidthEstimate` (a mono advance for proportional
 *  text), so the plan reserves at least what the chip paints. */
export const queuedChipWidthEstimate = (
	chars: number,
	scale: number,
	touchFloor: number,
): number =>
	Math.min(
		QUEUED_CHIP_MAX_PT,
		Math.max(
			touchFloor,
			Math.ceil(chars * CHIP_CHAR_PT * scale) + QUEUED_CHIP_PAD_PT,
		),
	);

/**
 * Which chips the card's controls row shows at a given zone width.
 *
 * The order is the operator's and the audit's (D5): EFFORT LEAVES FIRST, whole,
 * and only then is the model's name allowed to truncate; below one floor-wide
 * chip the model leaves too and More — which lists both — is all that remains.
 * The old strip shrank them together, which is how 320 pt read `claude-op…`
 * beside `Hi…`: two fragments where one whole name would have fitted.
 *
 * `width <= 0` is "not measured yet" and shows everything, because the common
 * case (a 390 pt phone) does fit and hiding chips for one frame would be a
 * flicker on every mount.
 *
 * THE QUEUED COUNT, where the host has no activity line to carry it (a tablet,
 * a narrow short-landscape split — review round 1, M1). It is the one member
 * of the zone that is NEVER dropped: nothing else on those layouts says a
 * message is waiting. It is charged before the chips, as its sentence
 * ("2 queued") while the model still fits beside it and as the bare count
 * once it would not — so the order of loss is effort, the sentence, the
 * model, and never the count or More.
 */
export const composerChipPlan = (input: {
	/** The chip zone's measured width, pt. */
	width: number;
	scale: number;
	modelChars: number;
	/** `null` when no effort chip is offered for the row at all. */
	effortChars: number | null;
	/** The home's folder chip leads the zone; it is charged at its floor,
	 *  because it yields to glyph-only before anything else gives way. */
	folder: boolean;
	/** Floor-sized trailing controls inside the zone (More / dismiss). */
	trailing: number;
	touchFloor: number;
	/** The queued count, when the card is where it shows: the lengths of its
	 *  sentence and of the bare number. Omitted or `null`: not on the card. */
	queued?: { labelChars: number; countChars: number } | null;
}): {
	model: boolean;
	effort: boolean;
	/** Present only when `queued` was asked for: the form that fits and the
	 *  width it was charged, which the chip takes as its own cap so an
	 *  under-estimate ellipsizes inside the zone instead of clipping More. */
	queued?: { form: "label" | "count"; width: number };
} => {
	const queue = input.queued ?? null;
	const queuedWidth = (chars: number) =>
		queuedChipWidthEstimate(chars, input.scale, input.touchFloor);
	if (!(input.width > 0))
		return {
			model: true,
			effort: input.effortChars !== null,
			...(queue
				? {
						queued: {
							form: "label" as const,
							width: queuedWidth(queue.labelChars),
						},
					}
				: {}),
		};
	const fixed =
		input.trailing * input.touchFloor + (input.folder ? MODEL_FLOOR_PT : 0);
	const children = input.trailing + (input.folder ? 1 : 0);
	/* `children` siblings before the model → that many gaps once it is shown. */
	const free = input.width - fixed - children * COMPOSER_META_GAP_PT;
	/* The queued count is one more sibling: its width and its own gap. */
	const beside = (width: number) => free - width - COMPOSER_META_GAP_PT;
	const queued =
		queue === null
			? null
			: beside(queuedWidth(queue.labelChars)) >= MODEL_FLOOR_PT
				? { form: "label" as const, width: queuedWidth(queue.labelChars) }
				: { form: "count" as const, width: queuedWidth(queue.countChars) };
	const forModel = queued === null ? free : beside(queued.width);
	const model = forModel >= MODEL_FLOOR_PT;
	const effort =
		model &&
		input.effortChars !== null &&
		forModel >=
			chipWidthEstimate(input.modelChars, input.scale) +
				COMPOSER_META_GAP_PT +
				chipWidthEstimate(input.effortChars, input.scale);
	return { model, effort, ...(queued ? { queued } : {}) };
};
