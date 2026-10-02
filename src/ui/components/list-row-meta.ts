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
 * The direction of the loss is the whole point of the design round's D26 —
 * `anthropic/` names a vendor, `…claude-opus-5` names a model — so it is decided
 * as a string here and both platforms render the same characters, by
 * construction rather than by a flag one of them happens to honour. And the
 * string is a copy decision no flag can express even where the flag works: a head
 * ellipsis slides its window and yields `…hropic/claude-opus-5`, which still
 * carries most of the vendor. D26 asks for the PREFIX to be the part that goes.
 *
 * **The widths are estimates, and they err wide.** There is no cross-platform way
 * to measure a text's own content width, so the character budgets below are
 * `dp / (size x 0.6 em)`: the shipped mono face measures 0.575 em per character
 * (`anthropic/claude-opus-5`, 24 characters, is 165.61 dp at 12 px), so 0.6
 * under-counts the characters that fit and a painted string stays inside its
 * box. `numberOfLines={1}` and `ellipsizeMode="head"` stay on the element as the
 * mop-up for whatever the estimate gets wrong — and on iOS/Android the flag is
 * the direction the string already has.
 */

/** The advance width of one `text-mono-sm` character, in em. See above. */
const MONO_CHARACTER_EM = 0.6;

/** `gap-2` is 0.5 rem, and Tailwind's spacing unit follows the ROOT font size,
 *  so the gap between the fields grows with the reader's text size: 8 dp each
 *  way at 100 %. */
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
 * The shortest painted model label that still names a model: an ellipsis plus
 * six characters, `…opus-5`. Below that the field carries no information, so it
 * is dropped and the line carries the cwd alone — the narrowest configuration
 * D26 names, reached here by measuring rather than by a text-scale threshold.
 */
export const MODEL_MIN_CHARS = 7;

/** The ellipsis is ONE character (U+2026), so it costs exactly one slot. */
const ELLIPSIS = "…";

/** One character of `text-mono-sm`, in dp, at the reader's own text scale. */
export const charWidthDp = (scale: number): number =>
	TYPE_STEPS["mono-sm"].size * scale * MONO_CHARACTER_EM;

/** What the line should paint: `null` for a field the row has none of. */
export type MetaLine = {
	cwd: string | null;
	model: string | null;
};

/** The model's own name, with the provider prefix dropped: `anthropic/x` → `x`. */
const tokenOf = (id: string): string => {
	const slash = id.indexOf("/");
	return slash === -1 ? id : id.slice(slash + 1);
};

/**
 * The model label as painted.
 *
 * Whole when it fits. Otherwise the provider prefix goes FIRST — it is the one
 * part that is the same on every row of that provider, so it is the part that
 * costs the least to lose — and only if the model's own name still does not fit
 * is its head trimmed.
 */
const labelFor = (id: string, budgetDp: number, charDp: number): string => {
	const budget = Math.floor(budgetDp / charDp);
	if (budget <= 0) return "";
	if (id.length <= budget) return id;
	const token = tokenOf(id);
	/* The ellipsis takes the slot the provider prefix gave up, so the model's own
	 *  name survives whole whenever it can. */
	if (token.length + 1 <= budget) return `${ELLIPSIS}${token}`;
	return elided(token, budget);
};

/**
 * `text` as painted into a box `budget` CHARACTERS wide: whole when it fits,
 * otherwise its tail with a leading ellipsis. Nothing when even the ellipsis
 * does not fit — an empty field is more honest than a partial glyph.
 */
const elided = (text: string, budget: number): string => {
	if (text.length <= budget) return text;
	if (budget <= 1) return "";
	return `${ELLIPSIS}${text.slice(-(budget - 1))}`;
};

/** The tail of `text` that fits `budgetDp`, or `text` whole when it fits. */
const tailFor = (text: string, budgetDp: number, charDp: number): string =>
	elided(text, Math.floor(budgetDp / charDp));

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
	const charDp = charWidthDp(scale);

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
		const alone = labelFor(model, widthDp, charDp);
		return { cwd: null, model: alone.length >= MODEL_MIN_CHARS ? alone : null };
	}

	/* The model may take what is left of the line after the cwd's floor. */
	const room = widthDp - META_GAP_DP * scale - META_PATH_FLOOR_CHARS * charDp;
	const painted = room > 0 && model !== "" ? labelFor(model, room, charDp) : "";

	if (painted.length < MODEL_MIN_CHARS) {
		/* No legible prefix of the model survives, so the line carries the cwd
		 *  alone and the cwd gets the whole width rather than two fragments. */
		return { cwd: tailFor(cwd, widthDp, charDp), model: null };
	}

	return {
		cwd: tailFor(
			cwd,
			widthDp - META_GAP_DP * scale - painted.length * charDp,
			charDp,
		),
		model: painted,
	};
}
