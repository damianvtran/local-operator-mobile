/** Build389 shared layout. The folder and the run settings (model + effort)
 * are icon controls on the card's controls row (issue #325), never a
 * keyboard-inline receipt; optional facts live in More. */
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

/** The zone's `gap-1`, in pt, for `composerControlsPlan`'s arithmetic. */
export const COMPOSER_META_GAP_PT = 4;

export const ATTACH_GLYPH_PT = 20;

/** The card's control zone: everything between attach and the mic/send
 *  cluster on the controls row (visual audit D5) — the folder and run-settings
 *  icons and the trailing slot (issue #325). `flex-1 min-w-0` between
 *  fixed-width siblings, so its width is set by the row and never by the
 *  controls inside it — which is what lets `composerControlsPlan` read that
 *  width without feeding it. `overflow-hidden` is the last line of defence, not
 *  the layout: a member that somehow out-measures the plan is cut at the
 *  zone's edge rather than painted over the send disc (U-08). */
export const COMPOSER_CHIP_ZONE =
	"min-w-0 flex-1 flex-row items-center gap-1 overflow-hidden";

/** The zone's trailing slot: More (or keyboard-dismiss) and, where the card
 *  carries it, the queued count ahead of it. Its auto margin is the ONLY thing
 *  in the zone that absorbs free width, so the slot holds the trailing edge
 *  whichever icons are on the row and the icons still pack at the leading
 *  edge (TestFlight 578). Rigid: its members are never the ones cut. */
export const COMPOSER_CHIP_TRAILING =
	"ms-auto shrink-0 flex-row items-center gap-1";

/** A `text-mono-sm` glyph's advance, pt at 100 % (12 pt × the 0.6 em advance
 *  of the kit's mono face). An ESTIMATE on purpose: the plan needs to know
 *  whether the queued sentence fits BEFORE it has been laid out, and measuring
 *  it first is a frame in which it paints and is then shortened. Erring wide
 *  only shortens it a little early; erring narrow is what
 *  `COMPOSER_CHIP_ZONE`'s clip is for. */
export const CHIP_CHAR_PT = 7.2;

/** The queued count's horizontal padding (`px-1`) and its widest label, pt. */
export const QUEUED_CHIP_PAD_PT = 8;
export const QUEUED_CHIP_MAX_PT = 160;

/** The queued count's estimated width on the card: its floor, or its text at
 *  the scale, never past the cap the chip itself carries. A deliberate
 *  over-estimate (`CHIP_CHAR_PT`, a mono advance for proportional text), so
 *  the plan reserves at least what the chip paints. */
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

/** The failure notice's glyph (14 pt) plus the `gap-2` beside it: what the
 *  notice's sentence column loses from the extras' content width. */
export const NOTICE_GLYPH_COLUMN_PT = 14 + 8;

/** The `gap-x-3` between a notice sentence and its action, and between two
 *  actions sharing the leading row. */
export const NOTICE_ACTION_GAP_PT = 12;

/**
 * Where the failure notice's actions sit: trailing their sentences, or all
 * together on a row of their own ABOVE the sentences (QA #211 round 4 Q7).
 *
 * WHY. An action is only certain to be seen while it is on the FIRST row of the
 * extras scroller (UX #211 U4): at 320x568 / 200 % that scroller is 143 px tall.
 * Round 3 let an action that would squeeze its sentence under `sentenceMin`
 * wrap UNDER it, which is right for the sentence and wrong for the action: in
 * French "Réessayer" (129 px) landed 210 px below the fold, and in English
 * "Dismiss error" was cut by 14 px on its second row. So the decision is made
 * for the whole notice, from widths that do not depend on it: if ANY action
 * would leave its sentence less than the minimum, every action moves to one
 * trailing-aligned row at the top (the first action — Retry when an
 * instruction is retained, else the dismissal — leading it) and the sentences
 * take the full column below.
 *
 * `rows` is how many touch-floor rows the actions then occupy when they wrap
 * among themselves; `composerBudget` snaps the extras' cap to that many whole
 * rows, so none is ever half cut. Trailing actions report one row: the first
 * sentence's row, whose action box is its top `touchFloor`.
 *
 * `column <= 0` or an unmeasured action (`0`) is "not measured yet" and keeps
 * the trailing form, which is the common one, rather than flipping for a frame
 * on every phone that fits. Every input is intrinsic: the column comes from the
 * shell's content width and an action's width from its own label, so nothing
 * here is fed by the layout it decides (the #206 rule).
 */
export const noticeActionPlan = (input: {
	/** The sentence column's width, px: content width less the glyph column. */
	column: number;
	/** The scaled least width a sentence keeps beside an action. */
	sentenceMin: number;
	/** Measured action widths, in reading order; empty when there is none. */
	actions: readonly number[];
}): { lead: boolean; rows: number } => {
	const { column, sentenceMin, actions } = input;
	if (actions.length === 0) return { lead: false, rows: 0 };
	if (!(column > 0) || actions.some((width) => !(width > 0)))
		return { lead: false, rows: 1 };
	const lead = actions.some(
		(width) => column - NOTICE_ACTION_GAP_PT - width < sentenceMin,
	);
	if (!lead) return { lead: false, rows: 1 };
	/* Greedy line breaking, as flex-wrap does it: an action joins the row while
	 *  it and its gap still fit, and an action wider than the column is a row. */
	let rows = 1;
	let used = 0;
	for (const width of actions) {
		const next = used === 0 ? width : used + NOTICE_ACTION_GAP_PT + width;
		if (used > 0 && next > column) {
			rows += 1;
			used = width;
		} else used = next;
	}
	return { lead: true, rows };
};
