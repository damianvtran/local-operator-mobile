import { TYPE_STEPS } from "@/ui/tokens.gen";

/**
 * The session row's metadata line: which of its two fields is painted, and how
 * much of each.
 *
 * **Why the painted string is decided here, and not by `ellipsizeMode`.** The
 * line used to ask the platform to elide each field from the HEAD
 * (`ellipsizeMode="head"`) and trust the answer. React Native honours that on
 * iOS and Android. `react-native-web@0.21.3` does not read the prop at all — it
 * appears nowhere in its `Text` prop filter and nowhere in its bundle — so the
 * web build, which is the build the capture harness and every design round
 * looks at, elided from the TAIL instead: the model read `anthropic/claude-opu…`
 * (the vendor, identical on every row of that provider) and the path
 * `~/workspace/clients/m…` (the head, identical on every row of that folder).
 * The direction is decided by WHAT THE FIELD IS, and the two fields decide
 * differently on purpose (D26, review round 5, and R-3, 2026-10-03):
 *
 *  - **The model keeps its TAIL** — the name after the slash. `anthropic/`
 *    names a vendor, `…claude-opus-5` names a model (D26: "the PREFIX is the
 *    part that goes").
 *  - **The working directory keeps its HEAD** — R-3 reversed D26's original
 *    choice for the path on a rendered frame: the row showed the title with its
 *    head intact (`Refactor the payment reconciliation worker an…`) beside a
 *    path keeping its tail (`…pelines/nightly-reconciliation`), TWO different
 *    truncation directions inside one row, and the head of a path (`~/work/…`)
 *    is the part a reader scans for. Both text fields of the row now elide the
 *    TAIL; only the model, an identifier rather than prose, keeps its name-end.
 *    The FIT stays D26's: same floor, same min, same order of yielding — this
 *    is the direction of the painted string only.
 *
 * **The same arithmetic has a second consumer** (`tailFit`): the conversations
 * pane's switcher paints a route label — an identifier whose PREFIX is the same
 * on every loopback session and whose port is the part that differs — so it
 * keeps its tail too, and the fit is the model's minus the provider-prefix
 * step. Which characters paint is a string decision for the same reason: the
 * web build must not leave it to a prop react-native-web does not read.
 *
 * **Widths are summed per glyph, and a glyph the face cannot draw is not free.**
 * There is no cross-platform way to measure a text's own content width, so the
 * budget below is arithmetic — but arithmetic over the GLYPHS, not over the
 * string's length: `textWidthDp` charges every glyph what the shipped face
 * actually advances it, and charges a glyph the face has no coverage for what the
 * fallback face will spend on it (see `FALLBACK_ADVANCE_EM`). A line that
 * under-counts its own width is a line the web build clamps against the painted
 * string's own direction; the estimate is floored to whole glyphs so the arithmetic
 * errs inside the box rather than outside it.
 *
 * `numberOfLines={1}` and each field's `ellipsizeMode` (path `tail`, model `head`)
 * stay on the elements as the mop-up, and on iOS/Android each flag is the direction
 * its string already has.
 */

/** The advance of every glyph the mono face COVERS, in em.
 *
 *  JetBrains Mono advances 600/1000 em, and the shipped face measures exactly
 *  that: `anthropic/claude-opus-5`, 23 characters, is 165.61 dp at a 12 px size —
 *  7.2 dp each, or 0.600 em. This is the measured advance and NOT a margin; what
 *  keeps a painted string inside its box is that the budget is floored to whole
 *  glyphs and that `numberOfLines`/`ellipsizeMode` catch anything the estimate
 *  still gets wrong. */
const MONO_ADVANCE_EM = 0.6;

/** What a glyph the face CANNOT draw costs instead.
 *
 *  JetBrains Mono has no CJK coverage — `文`, `日` and `あ` all resolve to gid 0
 *  — so those glyphs are drawn from a fallback face at a full-width advance that
 *  a 600/1000 em monospace cannot express. Counting them at the Latin advance
 *  under-states such a line by 1.67x, and an under-stated line is one the web
 *  build clamps from its tail. One em is the honest figure for a full-width
 *  glyph, and it errs wide rather than narrow. */
const FALLBACK_ADVANCE_EM = 1;

/** The scripts the shipped face has no coverage for, plus emoji, which is drawn
 *  from a colour font and is never one Latin advance wide. */
const WIDE_GLYPH =
	/[\u1100-\u115F\u2E80-\u303F\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE10-\uFE1F\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]|\p{Extended_Pictographic}/u;

/** `gap-2` in the shipped spacing layer, in dp.
 *
 *  `theme.css` registers `--spacing: 4px` and `metro.config.js` fixes native's
 *  rem at 16, so this unit is a flat 4 px and does NOT follow the reader's text
 *  size: `gap-2` is 8 dp at 100 % and at 200 %, on both platforms. Reserving
 *  `8 x scale` here over-reserved 8 dp at 200 % — one glyph of the model's room —
 *  which is enough to keep a model that should fit (review round 2, R2-2). */
const META_GAP_DP = 8;

/**
 * How much of the line the working directory is GUARANTEED, in characters.
 *
 * Ten characters of `text-mono-sm` is a folder name — `~/workspace` is eleven —
 * which is the shortest fragment that still names where the session is. It is
 * expressed in characters rather than dp because that is the unit the reader
 * reads in: the same 72 dp holds half as many of them at 200 %.
 */
export const META_PATH_FLOOR_CHARS = 10;

/**
 * How short a painted model label may become before it stops naming anything: an
 * ellipsis plus six characters, `…opus-5`.
 *
 * It applies to a label that had to be ELIDED. A name that fits its box whole is
 * painted whatever its length — `o3` and `gpt-4` are complete names, and a
 * length gate over the painted label dropped them at every width and scale
 * (review round 2, R2-1).
 */
export const MODEL_MIN_CHARS = 7;

/** The ellipsis is ONE code point (U+2026), so it costs exactly one glyph. */
const ELLIPSIS = "…";

/** One glyph of `text-mono-sm`, in dp, at the reader's own text scale. */
export const charWidthDp = (scale: number): number =>
	TYPE_STEPS["mono-sm"].size * scale * MONO_ADVANCE_EM;

/**
 * The dp the cwd is GUARANTEED on the meta line: the floor above, in the units the
 * flex box needs.
 *
 * Exported so the boilerplate the row puts on the field and the budget this module
 * fits its string into are the SAME number: two definitions of the floor is how a
 * painted string and its box drift apart.
 */
export const metaPathFloorDp = (scale: number): number =>
	META_PATH_FLOOR_CHARS * charWidthDp(scale);

/** One glyph, in dp: the Latin advance, or the fallback's for a wide script. */
const glyphDp = (glyph: string, scale: number): number =>
	charWidthDp(scale) *
	(WIDE_GLYPH.test(glyph) ? FALLBACK_ADVANCE_EM / MONO_ADVANCE_EM : 1);

/** `text` in dp — the sum of its glyphs, not its length. */
export const textWidthDp = (text: string, scale: number): number =>
	[...text].reduce((dp, glyph) => dp + glyphDp(glyph, scale), 0);

/** What the line should paint: `null` for a field the row has none of. */
export type MetaLine = {
	cwd: string | null;
	model: string | null;
};

/** A field's candidate string, and whether it had to lose anything to fit. */
type Painted = { text: string; elided: boolean };

/** The model's own name, with the provider prefix dropped: `anthropic/x` → `x`. */
const tokenOf = (id: string): string => {
	const slash = id.indexOf("/");
	return slash === -1 ? id : id.slice(slash + 1);
};

const fitsWhole = (text: string, budgetDp: number, scale: number): boolean =>
	textWidthDp(text, scale) <= budgetDp;

/**
 * The longest TAIL of `text` that fits `budgetDp` once the ellipsis is counted,
 * by CODE POINT — the MODEL's direction (see `labelFor`).
 *
 * By code point and not by `slice`: a UTF-16 slice can cut a surrogate pair in
 * half, and the lone surrogate it leaves behind paints as U+FFFD — measured on
 * `~/a🙂b/c`, which lost the emoji to `…\ude42b/c` at a 40 dp budget (review
 * round 2, R2-4).
 */
const tailFitting = (text: string, budgetDp: number, scale: number): string => {
	const room = budgetDp - charWidthDp(scale);
	if (room <= 0) return "";
	const glyphs = [...text];
	let spent = 0;
	let taken = 0;
	for (let index = glyphs.length - 1; index >= 0; index -= 1) {
		const width = glyphDp(glyphs[index] ?? "", scale);
		if (spent + width > room) break;
		spent += width;
		taken += 1;
	}
	return taken === 0 ? "" : glyphs.slice(glyphs.length - taken).join("");
};

/**
 * The longest HEAD of `text` that fits `budgetDp` once the ellipsis is counted,
 * by code point — the PATH's direction (R-3: a path is read from its start).
 *
 * The same glyph arithmetic as `tailFitting`, walked from the other end; kept as
 * two functions rather than one with a direction flag because the two call sites
 * have different reasons, and a shared `reverse`-style helper would make the
 * next reader re-derive which end each field keeps.
 */
const headFitting = (text: string, budgetDp: number, scale: number): string => {
	const room = budgetDp - charWidthDp(scale);
	if (room <= 0) return "";
	const glyphs = [...text];
	let spent = 0;
	let taken = 0;
	for (let index = 0; index < glyphs.length; index += 1) {
		const width = glyphDp(glyphs[index] ?? "", scale);
		if (spent + width > room) break;
		spent += width;
		taken += 1;
	}
	return taken === 0 ? "" : glyphs.slice(0, taken).join("");
};

/** `text` as painted into `budgetDp`: whole when it fits, else its marked HEAD
 *  (the cwd's rule — see the module comment; the model has its own, `labelFor`). */
const elidedTo = (text: string, budgetDp: number, scale: number): Painted => {
	if (fitsWhole(text, budgetDp, scale)) return { text, elided: false };
	const head = headFitting(text, budgetDp, scale);
	return { text: head === "" ? "" : `${head}${ELLIPSIS}`, elided: true };
};

/**
 * `text` as painted for a surface that must keep its TAIL: whole when it fits,
 * else an ellipsis and the longest tail that does.
 *
 * The conversations pane's switcher is the consumer: a route label like
 * `127.0.0.1:51078` is an identifier, and the identifier rule is that the
 * prefix is the part that goes (D26) — the port is the only part that differs
 * per session, so it is the part that stays. The round recorded the direction
 * as arguable for a mixed host:port string and did not prescribe one; this is
 * the identifier reading, taken where the box runs out (the home header's
 * wider box still paints the same ladder whole).
 */
export const tailFit = (
	text: string,
	budgetDp: number,
	scale: number,
): string => {
	if (fitsWhole(text, budgetDp, scale)) return text;
	const tail = tailFitting(text, budgetDp, scale);
	return tail === "" ? ELLIPSIS : `${ELLIPSIS}${tail}`;
};

/**
 * The model label as painted.
 *
 * Whole when it fits. Otherwise the provider prefix goes FIRST — it is the one
 * part that is the same on every row of that provider, so it is the part that
 * costs the least to lose — and only if the model's own name still does not fit
 * is its head trimmed.
 */
const labelFor = (id: string, budgetDp: number, scale: number): Painted => {
	if (fitsWhole(id, budgetDp, scale)) return { text: id, elided: false };
	const token = tokenOf(id);
	if (fitsWhole(token, budgetDp - charWidthDp(scale), scale)) {
		return { text: `${ELLIPSIS}${token}`, elided: true };
	}
	const tail = tailFitting(token, budgetDp, scale);
	return { text: tail === "" ? "" : `${ELLIPSIS}${tail}`, elided: true };
};

/**
 * Whether a painted label is worth painting: always, unless it was elided down
 * below `MODEL_MIN_CHARS` — a name that fits is a name, however short it is.
 */
const legible = (painted: Painted): boolean =>
	!painted.elided || [...painted.text].length >= MODEL_MIN_CHARS;

/**
 * The line as it should be painted, given the width the layout actually gave it.
 *
 * `widthDp` is the measured width of the meta line itself (`onLayout`), which is
 * what makes this a measurement rather than a second copy of the flex rules: the
 * cwd's floor is the only constant, and the model takes what the floor leaves.
 * It agrees with the boxes the flex hands out because the cwd's basis IS the
 * floor with `flexGrow: 1` and the model's basis is its own content — so a
 * painted string short enough for the room the floor leaves is also short enough
 * for the box the flex gives it.
 */
export function metaLineFor({
	cwd = "",
	model = "",
	widthDp,
	scale,
}: {
	cwd?: string;
	model?: string;
	/** The meta line's measured width; 0 before the first layout. */
	widthDp: number;
	scale: number;
}): MetaLine {
	/* Before the first layout there is no width to fit against, so both fields are
	 *  painted whole. The common row needs no trim at all, which keeps the settled
	 *  frame identical to the first one; a row that does trim settles within a
	 *  frame rather than flashing a field that is about to appear. */
	if (widthDp <= 0) {
		return { cwd: cwd === "" ? null : cwd, model: model === "" ? null : model };
	}

	/* No cwd: the model has the line to itself. */
	if (cwd === "") {
		if (model === "") return { cwd: null, model: null };
		const alone = labelFor(model, widthDp, scale);
		return { cwd: null, model: legible(alone) ? alone.text : null };
	}

	/* The model may take what is left of the line after the cwd's floor. */
	const room = widthDp - META_GAP_DP - metaPathFloorDp(scale);
	const painted =
		model === "" || room <= 0
			? { text: "", elided: true }
			: labelFor(model, room, scale);

	if (!legible(painted)) {
		/* No legible prefix of the model survives, so the line carries the cwd
		 *  alone and the cwd gets the whole width rather than two fragments. */
		return { cwd: elidedTo(cwd, widthDp, scale).text, model: null };
	}

	return {
		cwd: elidedTo(
			cwd,
			widthDp - META_GAP_DP - textWidthDp(painted.text, scale),
			scale,
		).text,
		model: painted.text,
	};
}
