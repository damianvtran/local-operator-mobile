/**
 * Text scale: the arithmetic, with no React and no platform in it.
 *
 * **Why this module exists.** The app's type is authored in `px`
 * (`design/tokens/tokens.json` → `theme.css`), and the browser's own text-size
 * setting and the harness's `--lo-text-scale` dimension both move the ROOT font
 * size. A `font-size: 16px` declaration ignores that completely, which is why
 * the audit harness reported `U-04 BLOCKED` on the web build: its 200 % frames
 * were pixel-identical to its 100 % frames (`tools/audit/checks.mjs` § u04Report
 * refuses to draw a large-text verdict from a dimension that is inert).
 *
 * The fix is not to re-author the scale in `rem` — `theme.css` is generated and
 * `theme:check` pins it byte-for-byte against `tokens.json`. The fix is that the
 * utilities already resolve through the token variables
 * (`.text-body{font-size:var(--text-body)}`, read out of the exported bundle),
 * so publishing SCALED values for those variables at runtime scales every
 * `text-*` utility in the app on both platforms — the same mechanism Uniwind
 * already uses to switch theme roles at runtime.
 *
 * What lives here is only the decision: what a preference means, and what
 * values the variables should take. The platform half (how the platform's own
 * scale is read, and how the variables are published) is
 * `src/ui/text-scale-provider.tsx`, because that half needs React Native and
 * this half must be unit-testable in Node — the store reads this module's types
 * and must not pull React Native in with them.
 */

import { TYPE_STEPS, type TypeStepName } from "./tokens.gen";

/**
 * The steps Settings offers. Deliberately the same three the audit harness
 * sweeps (`tools/visual/matrix.mjs` § SCALES), so "200 %" in the app and "200 %"
 * in a capture are the same number rather than two similar ones.
 */
export const TEXT_SCALE_PERCENTS = [100, 150, 200] as const;

export type TextScalePercent = (typeof TEXT_SCALE_PERCENTS)[number];

/**
 * `system` follows the device/browser; a percent is an explicit override.
 *
 * What the override DOES depends on the platform, and the two are different enough
 * that the comment used to be wrong on one of them:
 *
 *  - **web**: it REPLACES the browser's factor. An explicit preference emits `px`, so
 *    the reader who asks for 200 % gets 200 % even in a browser set to 200 % — not
 *    400 % (see `TextUnit`, which is where the unit decision and its measurements are).
 *  - **native**: it COMPOUNDS on the OS setting. React Native scales every `fontSize`
 *    by `PixelRatio.getFontScale()` itself and `allowFontScaling` is left on by design
 *    (`design/brand-kit.md` § 3.4), so a phone already at 200 % asking for 200 % renders
 *    4x. Turning that off to make the native rule match the web one would take the
 *    platform's own accessibility setting away from a reader, which is the worse trade.
 */
export type TextScalePreference = "system" | `${TextScalePercent}`;

/** The floor and ceiling a platform signal is clamped to before it is used.
 * A signal outside this range is a misreported value, not a request: below 0.8
 * type stops being readable and above 3 every layout truncates. */
export const TEXT_SCALE_BOUNDS = { min: 0.8, max: 3 } as const;

export function clampTextScale(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return Math.min(
		TEXT_SCALE_BOUNDS.max,
		Math.max(TEXT_SCALE_BOUNDS.min, scale),
	);
}

/** A stored or deep-linked preference, validated. Anything else reads as
 * `system`, because a corrupt preference must not pin the app at 200 %. */
export function parseTextScalePreference(value: unknown): TextScalePreference {
	if (value === "system") return "system";
	const percent = Number(value);
	return TEXT_SCALE_PERCENTS.includes(percent as TextScalePercent)
		? (String(percent) as TextScalePreference)
		: "system";
}

/**
 * The PREFERENCE's own factor: `1` when it defers to the platform, the chosen
 * percentage otherwise, clamped to `TEXT_SCALE_BOUNDS`.
 *
 * The platform's factor is deliberately NOT a parameter. It used to be, and the
 * provider passed a literal `1` in the place that looked like the platform's —
 * a signature that invites putting the platform's factor back here, which is exactly
 * the double application B1 was. The platform's factor is applied by the unit (see
 * `TextUnit`) and bounded where it is READ (`platformTextScale`).
 */
export function resolveTextScale(preference: TextScalePreference): number {
	if (preference === "system") return 1;
	return clampTextScale(Number(preference) / 100);
}

/**
 * The variable declarations that scale the type scale.
 *
 * Three deliberate omissions:
 *
 *  - **`line-height` is not scaled.** The token's line height is unitless
 *    (`1.5`), so it already follows the font size. Scaling it too would square
 *    the ratio.
 *  - **`letter-spacing` is not scaled.** It is authored in `em`, so it follows
 *    the font size for the same reason, and turning it into `px` here would
 *    break that.
 *  - **Nothing outside the type scale is touched.** Spacing, radii and control
 *    heights stay put: this is a text setting, and growing a 44 pt button to
 *    88 pt is a different (and unrequested) change. The layouts are instead
 *    proved not to clip at 200 % — which is what `U-04` measures.
 */
/**
 * How much a given step grows.
 *
 * Display and chrome steps cap at `CHROME_SCALE_CAP`; everything a reader reads as
 * content scales in full. The rule is typographic rather than a concession: large
 * type needs less enlargement to become readable, and a 28 pt screen title at
 * 200 % is 56 pt — on a 320 pt phone that is a third of the screen spent on one
 * word, and it pushed the list itself off the display in a captured frame.
 *
 * The cap is NOT a way to make an audit pass: the harness's median text height is
 * body-dominated and still reports the full 2.00x, and every content step scales
 * exactly as the platform asked.
 */
/**
 * The scale above which a control that needs a fixed number of columns must stop
 * insisting on them.
 *
 * One number for the whole app, because two thresholds would put a header that has
 * stacked next to a segmented control that has not: both were measured breaking on
 * a 320 pt phone at 150 % and both were fine at 130 %.
 */
export const LARGE_TEXT_SCALE = 1.4;

const CHROME_SCALE_CAP = 1.5;

/**
 * The unit type is expressed in, and it is the whole mechanism on the web.
 *
 * `rem` means the browser's own root font size multiplies every size — which is
 * the web's platform font scale, and the thing a reader changes in their browser
 * settings. `px` there would freeze the type at whatever the app decided and make
 * the platform setting inert, which is exactly what the first audit measured:
 * `rootFontSize` 16 px, median text height identical at 100 %, 150 % and 200 %.
 * On native there is no root font size to multiply, and React Native applies
 * `PixelRatio.getFontScale()` to a `fontSize` itself — see `TextUnit` below, which is
 * the one place that decision is written down.
 *
 * **`native` is not a length; it names the CONSUMER, and it exists because the two
 * consumers disagree about what a value may be.** A CSS custom property must carry
 * its unit or the browser cannot use it; React Native's `fontSize` must NOT — it is
 * typed as a number, and a `"16px"` string does not degrade there, it is fatal:
 * `Error while updating property 'fontSize' of a view managed by: RCTText` /
 * `ClassCastException: String -> Double`, thrown while the property is applied, so
 * the app dies on the first frame that renders any `text-*` role. Web has no such
 * cast (CSS accepts the string), so a build can be crashing on every device frame
 * while every web frame the harness captured agrees with it. The decision belongs
 * here, in the one place the type-scale variables are cut, so no call site can
 * reintroduce the suffix on the way out — see `scaledTextVariables`.
 */
export type TextUnit = "px" | "rem" | "native";

/**
 * Which unit a target gets — and therefore which FORM its value must take.
 *
 * This is the decision the Android crash turned on, so it lives here rather than
 * as a ternary in the provider: the provider needs React Native to know its
 * platform, and this module is the half that has to stay unit-testable in Node, so
 * the target arrives as a `boolean` and the test states a target instead of
 * mocking a module. Answering `px` for a device is what put a `"16px"` string in
 * a `fontSize`; the shape rule and why it is fatal on one platform and silent on
 * the other is on `TextUnit`. The two web answers stay distinct for the reason
 * given there: `rem` lets the browser's own root font size do the multiplying
 * under the `system` preference, and an explicit preference emits `px` so it
 * REPLACES that factor instead of compounding with it.
 */
export function textUnit(
	isWeb: boolean,
	preference: TextScalePreference,
): TextUnit {
	if (!isWeb) return "native";
	return preference === "system" ? "rem" : "px";
}

/** The px value of one root font size. `rem` is defined against the CSS default,
 *  so this is a constant rather than a reading. */
const REM_BASE_PX = 16;

/** One decimal is enough for a rendered size and keeps the emitted CSS short;
 *  `17 * 1.5` is `25.5`, not `25.499999`. */
const round = (px: number, unit: TextUnit) =>
	Math.round((px / (unit === "rem" ? REM_BASE_PX : 1)) * 1000) / 1000;

/** Steps that are chrome — a screen title, a badge, a machine label. */
const CHROME_STEPS: ReadonlySet<TypeStepName> = new Set<TypeStepName>([
	"display",
	"meta",
	"mono-label",
]);

/**
 * The value form a type-scale variable takes, and the reason `scaledTextVariables`
 * is not `Record<string, string>`.
 *
 * Structurally this is uniwind's own `CSSVariables`, which is what
 * `ScopedVariables` accepts and what its `createVarGetter` reads: a NUMBER passes
 * through untouched, any other value is returned as the string it is. So a CSS
 * target gets a length string (`16px`, `1rem`) and a device target gets a bare
 * number — and a `"16px"` string sent to a device target is not a bigger number,
 * it is a `ClassCastException` in `RCTText`. See `TextUnit`.
 */
export type TextScaleVariables = Record<string, string | number>;

export function scaledTextVariables(
	scale: number,
	/** The unit the platform's text scaling acts on, and the form the consumer
	 *  accepts. The caller decides — this module holds no platform at all — and the
	 *  CHOICE selects which mechanism applies the platform's factor AND whether the
	 *  emitted value carries a unit suffix (see `TextUnit` above). */
	unit: TextUnit = "rem",
): TextScaleVariables {
	const factor = clampTextScale(scale);
	const out: TextScaleVariables = {};
	for (const name of Object.keys(TYPE_STEPS) as TypeStepName[]) {
		const step = TYPE_STEPS[name];
		/* The cap bounds the PREFERENCE, never the platform.
		 *
		 * Capping the combined factor (what this did first) pins a chrome step at
		 * 1.5x no matter what the platform asked for, and on a chrome-heavy screen —
		 * Settings, whose diagnostics and section labels are `meta`/`mono-label` —
		 * those steps are most of the text. Measured on the harness's own cell: a
		 * median over all text of 24 px at 100 % and 33.59 px at 200 %, i.e. 1.40x,
		 * below the harness's 1.9x bar, so the dimension failed by name as INERT
		 * while every content role had in fact doubled. The typographic rule the cap
		 * exists for (a 28 pt screen title does not need to become 56) is a rule
		 * about the size the APP chose, so it applies to the preference; a reader
		 * whose browser or OS is at 200 % asked for 200 %, and the ramp is theirs.
		 *
		 * The step factor is the preference alone. The platform's factor is applied by
		 * the platform, exactly once — see `TextUnit` above, which is the one place
		 * that rule and its measurements live. */
		const stepFactor = CHROME_STEPS.has(name)
			? Math.min(factor, CHROME_SCALE_CAP)
			: factor;
		const size = round(step.size * stepFactor, unit);
		/* The suffix is appended ONLY for a CSS target, and that `unit !== "native"`
		 *  guard is the whole fix for the Android crash: `${size}px` is a valid custom
		 *  property and a fatal React Native style value at the same time, so the shape
		 *  has to be decided here rather than by a caller that appends the unit it was
		 *  handed. `native` emits the bare number the platform style wants, and the
		 *  platform's own factor is still applied by React Native's
		 *  `PixelRatio.getFontScale()` — exactly once, as before. */
		out[`--text-${name}`] = unit === "native" ? size : `${size}${unit}`;
	}
	return out;
}

/** The percentage a scale represents, for the Settings row and diagnostics. */
export function textScalePercent(scale: number): number {
	return Math.round(clampTextScale(scale) * 100);
}
