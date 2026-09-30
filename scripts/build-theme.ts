/**
 * Generate the app's styling layer from the design kit's tokens.
 *
 *     node scripts/build-theme.ts           # write the generated files
 *     node scripts/build-theme.ts --check    # fail if they are stale
 *
 * Runs directly under Node's native type stripping (no build step, no `tsx`), so
 * the file is limited to ERASABLE syntax: no enums, namespaces or parameter
 * properties, and type-only imports say `import type`. `tsconfig.tools.json`
 * enforces both with `erasableSyntaxOnly` and `verbatimModuleSyntax`.
 *
 * Two artefacts, one source:
 *
 *   src/ui/theme.css     the Uniwind/Tailwind CSS entry — the colour roles, the
 *                        type ramp, the radii and the motion values, as CSS
 *                        custom properties. This is also the Metro transformer's
 *                        `cssEntryFile`, so it is what makes `bg-surface` /
 *                        `text-ink-muted` / `border-control` exist at all.
 *   src/ui/tokens.gen.ts the same values as TypeScript, for the few places a
 *                        value is needed in JavaScript rather than in a class
 *                        name, and for the node tests that pin the token contract.
 *
 * Why generate rather than hand-write: `design/tokens/tokens.json` is the single
 * source of truth (docs/design/brand-kit.md § 2), and a second hand-maintained
 * copy drifts silently — a colour changed in the tokens and not in the app ships
 * as a theme that half applies. `--check` turns that drift into a failing gate.
 *
 * THE ROLE NAMES ARE NOT INVENTED HERE. The flattened role set is read from
 * `design/tokens/tailwind-preset.js`, the framework-agnostic preset the design
 * stream ships, and this script FAILS if its own flattening disagrees with it;
 * otherwise the app could quietly disagree with the kit about what `surface`
 * means. Only the emission shape differs — the preset writes `--lo-<role>` plus a
 * `--color-<role>` indirection for NativeWind and the preview sheet, whereas
 * Uniwind's utilities resolve through `--color-<role>` directly, with the
 * theme-varying values swapped by an `@variant` block.
 *
 * Everything here composes plain strings and arrays. Nested template literals
 * that emit template literals are how a generator ends up silently emitting half
 * of itself, so the emitted output never contains a backtick.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);

/* ---- the boundary: what this script needs from the token file -------------
 *
 * `tokens.json` is data the design kit owns, so it is PARSED here rather than
 * typed by assertion. Each schema names only the fields the generator reads; a
 * token that stops carrying one fails with the path of the missing field instead
 * of emitting the string "undefined" into a stylesheet. Loose objects: the kit
 * adds `$note`/`$meta` siblings freely and those are not this script's business.
 */
/* A colour is EITHER theme-invariant (`value`) or themed (`light` + `dark`); the
 * transforms drop the kit's prose fields (`role`) and leave two shapes that TypeScript
 * can discriminate with `in`, rather than one loose object whose every field is
 * `unknown`. */
const colourToken = z.union([
	z
		.looseObject({ value: z.string() })
		.transform((token) => ({ value: token.value })),
	z
		.looseObject({ light: z.string(), dark: z.string() })
		.transform((token) => ({ light: token.light, dark: token.dark })),
]);
const typeStep = z.looseObject({
	size: z.number(),
	lineHeight: z.number(),
	weight: z.number(),
	letterSpacing: z.number(),
	face: z.string(),
});
const control = z.looseObject({
	height: z.number(),
	width: z.number().optional(),
	paddingX: z.number().optional(),
	minTouch: z.number().optional(),
	icon: z.number().optional(),
	gap: z.number().optional(),
	type: z.string().optional(),
});
const elevation = z.looseObject({
	light: z.string(),
	dark: z.string(),
	androidElevation: z.number(),
});
const face = z.looseObject({ family: z.string(), fallback: z.string() });
const tokenFile = z.looseObject({
	color: z.record(z.string(), z.unknown()),
	type: z.looseObject({
		steps: z.record(z.string(), z.unknown()),
		faces: z.record(z.string(), z.unknown()),
	}),
	radius: z.record(z.string(), z.unknown()),
	size: z.looseObject({
		controls: z.record(z.string(), z.unknown()),
		touchTarget: z.looseObject({
			ios: z.number(),
			android: z.number(),
			minimum: z.number(),
			minimumVisualWithSlop: z.number(),
		}),
		list: z.looseObject({
			rowMinHeight: z.number(),
			rowTwoLineHeight: z.number(),
			rowPaddingX: z.number(),
			rowPaddingY: z.number(),
			separatorInset: z.number(),
		}),
	}),
	elevation: z.record(z.string(), z.unknown()),
	z: z.record(z.string(), z.unknown()),
	motion: z.looseObject({
		duration: z.record(z.string(), z.unknown()),
		easing: z.record(z.string(), z.unknown()),
		reducedMotion: z.looseObject({ floor: z.string() }),
	}),
	space: z.looseObject({
		gutters: z.looseObject({
			phone: z.number(),
			"phone-large": z.number(),
			tablet: z.number(),
		}),
		screen: z.looseObject({
			headerHeight: z.number(),
			composerMinHeight: z.number(),
		}),
		maxContentWidth: z.looseObject({
			tabletPortrait: z.number(),
			tabletLandscape: z.number(),
			landscapePhone: z.number(),
		}),
	}),
});

/** Parse one entry of a record whose keys the kit mixes with `$`-prefixed notes.
 * A `$` key is documentation and is skipped; anything else must match `schema`. */
const entries = <T>(
	record: Record<string, unknown>,
	schema: z.ZodType<T>,
	where: string,
): Array<[string, T]> =>
	Object.entries(record)
		.filter(([name]) => !name.startsWith("$"))
		.map(([name, raw]) => {
			const parsed = schema.safeParse(raw);
			if (!parsed.success) {
				throw new Error(
					`tokens.json ${where}.${name}: ${parsed.error.message}`,
				);
			}
			return [name, parsed.data];
		});

const tokens = tokenFile.parse(
	JSON.parse(readFileSync(new URL("design/tokens/tokens.json", root), "utf8")),
);
const preset = z
	.looseObject({ colors: z.record(z.string(), z.unknown()) })
	.parse(
		require(fileURLToPath(new URL("design/tokens/tailwind-preset.js", root))),
	);

const check = process.argv.includes("--check");
const BANNER = "GENERATED by scripts/build-theme.ts — do not edit by hand.";

/* ---- colour roles ------------------------------------------------------- */

type Colour = z.output<typeof colourToken>;

/** Flatten the token file's colour groups into one namespace, the same way the
 * preset does: `surface.surface` is the role `surface`, `line.border-control` is
 * `border-control`. A `value` token is theme-invariant; anything else carries a
 * `light` and a `dark` (tokens.json `$meta.themeContract`). */
const colours: Record<string, Colour> = {};
for (const [group, body] of Object.entries(tokens.color)) {
	if (group.startsWith("$")) continue;
	const members = z.record(z.string(), z.unknown()).safeParse(body);
	if (!members.success) continue;
	for (const [name, token] of entries(members.data, colourToken, group)) {
		colours[name] = token;
	}
}

const presetRoles = Object.keys(preset.colors).sort();
const ourRoles = Object.keys(colours).sort();
if (presetRoles.join(",") !== ourRoles.join(",")) {
	const onlyPreset = presetRoles.filter((r) => !ourRoles.includes(r));
	const onlyOurs = ourRoles.filter((r) => !presetRoles.includes(r));
	console.error(
		"design/tokens/tailwind-preset.js and this script disagree about the colour roles.\n" +
			"  only in the preset: " +
			(onlyPreset.join(", ") || "(none)") +
			"\n  only here:         " +
			(onlyOurs.join(", ") || "(none)") +
			"\nRe-run `node design/tokens/build-preset.mjs`; if the preset is current, this script's flattening is wrong.",
	);
	process.exit(1);
}

type ThemeName = "light" | "dark";

const roles = Object.keys(colours);
const isInvariant = (role: string): boolean => {
	const colour = colours[role];
	return colour !== undefined && "value" in colour;
};
const invariant = roles.filter(isInvariant);
const varying = roles.filter((role) => !isInvariant(role));
const THEMES: readonly ThemeName[] = ["light", "dark"];
const valueFor = (role: string, theme: ThemeName): string => {
	const colour = colours[role];
	if (colour === undefined) throw new Error(`Unknown colour role "${role}"`);
	return "value" in colour ? colour.value : colour[theme];
};

/** `surface` -> `--color-surface`, the property Uniwind's utilities read. */
const cssColour = (role: string): string => "--color-" + role;

/* ---- the scales --------------------------------------------------------- */

const typeSteps = Object.fromEntries(
	entries(tokens.type.steps, typeStep, "type.steps"),
);
// `radius` mixes numbers with a `$note` and an `assignment` table; only the
// numbers are radii.
const radii = Object.fromEntries(
	Object.entries(tokens.radius).filter(
		(pair): pair is [string, number] =>
			!pair[0].startsWith("$") && typeof pair[1] === "number",
	),
);
const durations = Object.fromEntries(
	entries(tokens.motion.duration, z.number(), "motion.duration"),
);
const easings = Object.fromEntries(
	entries(tokens.motion.easing, z.string(), "motion.easing"),
);
const controls = Object.fromEntries(
	entries(tokens.size.controls, control, "size.controls"),
);

/** A unitless letter-spacing token is emitted as `0`, never `0em`. */
const tracking = (value: number): string => (value === 0 ? "0" : value + "em");

/* ---- the styling layer -------------------------------------------------- */

/**
 * The styling layer: ONE file, and it is both things at once.
 *
 * It is the Metro transformer's `cssEntryFile` AND the module the app imports
 * (src/ui/theme.ts). Both roles have to be the same document, which is not
 * obvious and is worth stating: the `@import`/`@source` directives only take
 * effect when Tailwind compiles the file, and Tailwind only compiles the file the
 * BUNDLE brings in. Splitting them — the token declarations in the imported
 * module, the directives in the transformer entry — produced a stylesheet with
 * every variable and NOT ONE utility class, because the file the bundle imported
 * was never compiled. The symptom is a screen that renders unpositioned and
 * unstyled with no error anywhere.
 */
const css = (): string => {
	const out: string[] = [];
	out.push("/* " + BANNER);
	out.push(" *");
	out.push(
		" * The app's styling layer, generated from design/tokens/tokens.json.",
	);
	out.push(
		" * Prose: docs/design/brand-kit.md (why) and docs/design/components.md (what).",
	);
	out.push(" *");
	out.push(
		" * Rebuild with `pnpm theme:build`; `pnpm theme:check` fails when it is stale.",
	);
	out.push(" */");
	out.push("");
	out.push(
		"/* The toolchain: Tailwind compiles this file, and `uniwind` is the",
	);
	out.push(
		" * React Native compatibility layer that makes the utilities mean something",
	);
	out.push(" * on a device. */");
	out.push("@import 'tailwindcss';");
	out.push("@import 'uniwind';");
	out.push("");
	out.push("/*");
	out.push(" * The scan roots.");
	out.push(" *");
	out.push(
		" * Tailwind scans for class names starting at this file's own directory, so",
	);
	out.push(
		" * without these the routes in app/ would compile to nothing — and an unstyled",
	);
	out.push(" * screen throws no error, it just renders wrong.");
	out.push(" */");
	out.push("@source '../../app/**/*.{ts,tsx}';");
	out.push("@source '../**/*.{ts,tsx}';");
	out.push("");
	out.push("@theme {");
	out.push("\t/* ---- colour roles ----");
	out.push("\t *");
	out.push(
		"\t * Registered here with the LIGHT value so every utility exists at build",
	);
	out.push(
		"\t * time; the values that actually apply are swapped per theme in the",
	);
	out.push(
		"\t * @layer theme block below. A utility the kit does not define does not",
	);
	out.push(
		"\t * exist, which is the point: `bg-canvas` is a role, `bg-[#f2ede3]` is a bug.",
	);
	out.push("\t */");
	for (const role of roles) {
		out.push("\t" + cssColour(role) + ": " + valueFor(role, "light") + ";");
	}
	out.push("");
	out.push(
		"\t/* ---- type ramp: size, line height, weight and tracking per step ---- */",
	);
	for (const [name, step] of Object.entries(typeSteps)) {
		out.push("\t--text-" + name + ": " + step.size + "px;");
		out.push("\t--text-" + name + "--line-height: " + step.lineHeight + ";");
		out.push("\t--text-" + name + "--font-weight: " + step.weight + ";");
		out.push(
			"\t--text-" +
				name +
				"--letter-spacing: " +
				tracking(step.letterSpacing) +
				";",
		);
	}
	out.push("");
	out.push(
		"\t/* ---- radii: assigned by what the object is, never by taste ---- */",
	);
	for (const [name, value] of Object.entries(radii)) {
		out.push("\t--radius-" + name + ": " + value + "px;");
	}
	out.push("");
	out.push(
		"\t/* ---- motion: the durations and easings the system is allowed ---- */",
	);
	for (const [name, value] of Object.entries(durations)) {
		out.push("\t--duration-" + name + ": " + value + "ms;");
	}
	for (const [name, value] of Object.entries(easings)) {
		out.push("\t--ease-" + name + ": " + value + ";");
	}
	out.push("");
	out.push(
		"\t/* ---- touch geometry, for the few places a height is not a class ---- */",
	);
	for (const [name, control] of Object.entries(controls)) {
		out.push("\t--control-" + name + "-height: " + control.height + "px;");
	}
	out.push("");
	out.push(
		"\t/* Static, so JavaScript can read them where a value is needed outside a",
	);
	out.push(
		"	 * class name (an icon's colour, the status bar, a native module). */",
	);
	out.push(
		"\t--touch-target-minimum: " + tokens.size.touchTarget.minimum + "px;",
	);
	out.push("\t--list-row-min-height: " + tokens.size.list.rowMinHeight + "px;");
	out.push(
		"\t--list-row-height-two-line: " +
			tokens.size.list.rowTwoLineHeight +
			"px;",
	);
	out.push("");
	out.push(
		"\t/* ---- faces: the kit's three, with their documented fallbacks ---- */",
	);
	for (const [name, typeface] of entries(
		tokens.type.faces,
		face,
		"type.faces",
	)) {
		out.push(
			"\t--font-" +
				name +
				": '" +
				typeface.family +
				"', " +
				typeface.fallback +
				";",
		);
	}
	out.push("}");
	out.push("");
	out.push("/*");
	out.push(" * The theme swap.");
	out.push(" *");
	out.push(
		" * Uniwind resolves `dark:` variants and theme variables from the active",
	);
	out.push(
		" * theme, which the theme provider sets through Uniwind.setTheme() — light,",
	);
	out.push(
		" * dark, or system (system follows the OS and re-resolves on change). The",
	);
	out.push(
		" * role names are identically spelt in both blocks on purpose: a role missing",
	);
	out.push(
		" * from one theme is a colour that silently keeps the other theme's value.",
	);
	out.push(" */");
	out.push("@layer theme {");
	out.push("\t:root {");
	for (const theme of THEMES) {
		out.push(
			"\t\t/* " +
				(theme === "light" ? "Light: the kit's default." : "Dark.") +
				" */",
		);
		out.push("\t\t@variant " + theme + " {");
		for (const role of varying) {
			out.push("\t\t\t" + cssColour(role) + ": " + valueFor(role, theme) + ";");
		}
		out.push("\t\t}");
	}
	out.push("\t}");
	out.push("}");
	out.push("");
	return out.join("\n");
};

const REDUCED_MOTION_MS = /(\d+)\s*ms/;

/* ---- src/ui/tokens.gen.ts ----------------------------------------------- */

const ts = (): string => {
	const out: string[] = [];
	const q = (value: string): string => JSON.stringify(value);
	out.push("/* " + BANNER);
	out.push(" *");
	out.push(" * The design kit's values as TypeScript, generated from");
	out.push(
		" * design/tokens/tokens.json. Pure data and pure functions only: this module",
	);
	out.push(
		" * must stay importable from a Node test, so it never touches React Native.",
	);
	out.push(" *");
	out.push(
		" * Reach for a className first. This exists for the three cases a class name",
	);
	out.push(
		" * cannot express — a value handed to a non-React-Native API (an SVG icon's",
	);
	out.push(
		" * colour prop, the status bar style), an arithmetic decision (a layout",
	);
	out.push(" * breakpoint), and the tests that pin the token contract.");
	out.push(" */");
	out.push("");
	out.push(
		"/** The two themes the app resolves to. `system` is a preference, not a theme. */",
	);
	out.push('export type ThemeName = "light" | "dark";');
	out.push("");
	out.push(
		"/** What the reader chose in settings. `system` follows the OS appearance. */",
	);
	out.push('export type ThemePreference = "light" | "dark" | "system";');
	out.push("");
	out.push("/** Every colour role, in the order the kit declares them. */");
	out.push("export const COLOR_ROLES = [");
	for (const role of roles) out.push("\t" + q(role) + ",");
	out.push("] as const;");
	out.push("");
	out.push("export type ColorRole = (typeof COLOR_ROLES)[number];");
	out.push("");
	out.push(
		"/** Roles whose value is the same in both themes ({ value } in the tokens). */",
	);
	out.push("export const THEME_INVARIANT_ROLES = [");
	for (const role of invariant) out.push("\t" + q(role) + ",");
	out.push("] as const;");
	out.push("");
	out.push("/**");
	out.push(
		" * The resolved palette per theme: every value is a lowercase hex or a",
	);
	out.push(
		" * semantic string, taken verbatim from the tokens (no transform, no casing).",
	);
	out.push(" */");
	out.push(
		"export const PALETTE: Record<ThemeName, Record<ColorRole, string>> = {",
	);
	for (const theme of THEMES) {
		out.push("\t" + theme + ": {");
		for (const role of roles) {
			out.push("\t\t" + q(role) + ": " + q(valueFor(role, theme)) + ",");
		}
		out.push("\t},");
	}
	out.push("};");
	out.push("");
	out.push(
		"/** Type steps. size is pt/sp, lineHeight a unitless multiplier. */",
	);
	out.push("export const TYPE_STEPS = {");
	for (const [name, step] of Object.entries(typeSteps)) {
		out.push(
			"\t" +
				q(name) +
				": { size: " +
				step.size +
				", lineHeight: " +
				step.lineHeight +
				", weight: " +
				step.weight +
				", letterSpacing: " +
				step.letterSpacing +
				", face: " +
				q(step.face) +
				" },",
		);
	}
	out.push("} as const;");
	out.push("");
	out.push("export type TypeStepName = keyof typeof TYPE_STEPS;");
	out.push("");
	out.push(
		"/** Corner radii, in pt. Assigned by what the object is, never by taste. */",
	);
	out.push("export const RADII = {");
	for (const [name, value] of Object.entries(radii)) {
		out.push("\t" + q(name) + ": " + value + ",");
	}
	out.push("} as const;");
	out.push("");
	out.push("/** The heights a control may declare. */");
	out.push("export const CONTROL_HEIGHTS = {");
	for (const [name, control] of Object.entries(controls)) {
		const parts: string[] = [];
		parts.push("height: " + control.height);
		if (control.width !== undefined) parts.push("width: " + control.width);
		if (control.paddingX !== undefined)
			parts.push("paddingX: " + control.paddingX);
		if (control.minTouch !== undefined)
			parts.push("minTouch: " + control.minTouch);
		if (control.icon !== undefined) parts.push("icon: " + control.icon);
		if (control.gap !== undefined) parts.push("gap: " + control.gap);
		if (control.type !== undefined) parts.push("type: " + q(control.type));
		out.push("\t" + q(name) + ": { " + parts.join(", ") + " },");
	}
	out.push("} as const;");
	out.push("");
	out.push("export const TOUCH_TARGET = {");
	out.push("\tios: " + tokens.size.touchTarget.ios + ",");
	out.push("\tandroid: " + tokens.size.touchTarget.android + ",");
	out.push(
		"\t/** The floor every interactive control here meets, on both platforms. */",
	);
	out.push("\tminimum: " + tokens.size.touchTarget.minimum + ",");
	out.push(
		"\t/** A visually smaller control may stay small only if its hit area is padded",
	);
	out.push("	 * out to `minimum` (slop). Hit areas may never overlap. */");
	out.push(
		"\tminimumVisualWithSlop: " +
			tokens.size.touchTarget.minimumVisualWithSlop +
			",",
	);
	out.push("} as const;");
	out.push("");
	out.push("export const LIST_GEOMETRY = {");
	out.push("\trowMinHeight: " + tokens.size.list.rowMinHeight + ",");
	out.push("\trowTwoLineHeight: " + tokens.size.list.rowTwoLineHeight + ",");
	out.push("\trowPaddingX: " + tokens.size.list.rowPaddingX + ",");
	out.push("\trowPaddingY: " + tokens.size.list.rowPaddingY + ",");
	out.push("\tseparatorInset: " + tokens.size.list.separatorInset + ",");
	out.push("} as const;");
	out.push("");
	out.push("export const DURATIONS = {");
	for (const [name, value] of Object.entries(durations)) {
		out.push("\t" + q(name) + ": " + value + ",");
	}
	out.push("} as const;");
	out.push("");
	out.push("export const EASINGS = {");
	for (const [name, value] of Object.entries(easings)) {
		out.push("\t" + q(name) + ": " + q(value) + ",");
	}
	out.push("} as const;");
	out.push("");
	out.push(
		"/** The two shadows in the system. In-flow content is never lifted by one:",
	);
	out.push(
		" * elevation there is a background step (canvas -> surface -> elevated). These",
	);
	out.push(
		" * belong to objects that leave the flow, and both platforms must be set or one",
	);
	out.push(" * of them gets nothing.");
	out.push(" */");
	out.push("export const ELEVATIONS = {");
	// `elevation` mixes the two shadow objects with plain-string notes (for example
	// `androidSurfaceTint`); only the objects are shadows, so the strings are
	// skipped here rather than failing the schema.
	const shadows = Object.fromEntries(
		Object.entries(tokens.elevation).filter(
			([, value]) => typeof value === "object" && value !== null,
		),
	);
	for (const [name, shadow] of entries(shadows, elevation, "elevation")) {
		out.push(
			"\t" +
				q(name) +
				": { light: " +
				q(shadow.light) +
				", dark: " +
				q(shadow.dark) +
				", androidElevation: " +
				shadow.androidElevation +
				" },",
		);
	}
	out.push("} as const;");
	out.push("");
	out.push(
		"/** The stacking ladder, named. A seventh level is a sign something is",
	);
	out.push(" * stacked that should be a route.");
	out.push(" */");
	out.push("export const Z_LEVELS = {");
	for (const [name, level] of entries(tokens.z, z.number(), "z")) {
		out.push("\t" + q(name) + ": " + level + ",");
	}
	out.push("} as const;");
	out.push("");
	/* The reduced-motion floor is prose in the token file ("durations clamp to
	 * 120ms …"); the number is read out of it rather than restated here, and a
	 * token that stops naming a number fails the build instead of emitting a
	 * constant with no value. */
	const capMatch = REDUCED_MOTION_MS.exec(tokens.motion.reducedMotion.floor);
	if (!capMatch) {
		console.error(
			"tokens.json § motion.reducedMotion.floor no longer names a ms value; " +
				"the reduced-motion cap cannot be generated from it.",
		);
		process.exit(1);
	}
	out.push(
		"/** The global duration cap under reduced motion. A cap, not zero: an",
	);
	out.push(
		" * instantaneous colour change loses the affordance that a press IS feedback. */",
	);
	out.push(
		"export const REDUCED_MOTION_DURATION_CAP_MS = " + capMatch[1] + ";",
	);
	out.push(
		"/** Screen metrics. A literal that appears twice drifts; these do not. */",
	);
	out.push("export const LAYOUT = {");
	out.push("\tgutter: " + tokens.space.gutters.phone + ",");
	out.push("\tgutterLarge: " + tokens.space.gutters["phone-large"] + ",");
	out.push("\tgutterTablet: " + tokens.space.gutters.tablet + ",");
	out.push("\theaderHeight: " + tokens.space.screen.headerHeight + ",");
	out.push(
		"\tcomposerMinHeight: " + tokens.space.screen.composerMinHeight + ",",
	);
	out.push(
		"\tcontentMaxWidthTablet: " +
			tokens.space.maxContentWidth.tabletPortrait +
			",",
	);
	out.push(
		"\tcontentMaxWidthTabletLandscape: " +
			tokens.space.maxContentWidth.tabletLandscape +
			",",
	);
	out.push(
		"\tcontentMaxWidthLandscapePhone: " +
			tokens.space.maxContentWidth.landscapePhone +
			",",
	);
	out.push(
		"\t/** Above this width the list and the detail sit side by side, and the",
	);
	out.push("	 * layout must collapse to one column at half of it. */");
	out.push("\ttabletBreakpoint: 700,");
	out.push("} as const;");
	out.push("");
	out.push("/** The CSS custom property a role resolves through. */");
	out.push(
		'export const cssColorVar = (role: ColorRole): string => "--color-" + role;',
	);
	out.push("");
	out.push(
		"/** Resolve a role in a concrete theme, without going through CSS. */",
	);
	out.push(
		"export const resolveColor = (role: ColorRole, theme: ThemeName): string =>",
	);
	out.push("\tPALETTE[theme][role];");
	out.push("");
	out.push("/**");
	out.push(
		" * Turn the reader's preference into the theme that actually renders.",
	);
	out.push(" *");
	out.push(
		" * `system` is not a third theme — it is the absence of an override, and the",
	);
	out.push(
		" * OS appearance supplies the answer. Keeping that resolution a pure function",
	);
	out.push(
		" * of two values is what makes it testable in Node, where neither React",
	);
	out.push(" * Native nor the OS is present.");
	out.push(" */");
	out.push("export const resolveTheme = (");
	out.push("\tpreference: ThemePreference,");
	out.push("\tsystemScheme: ThemeName | null | undefined,");
	out.push("): ThemeName => {");
	out.push(
		'\tif (preference === "light" || preference === "dark") return preference;',
	);
	out.push('\treturn systemScheme === "dark" ? "dark" : "light";');
	out.push("};");
	out.push("");
	return out.join("\n");
};

/* ---- write or check ----------------------------------------------------- */

const outputs: Array<[string, string]> = [
	["src/ui/theme.css", css()],
	["src/ui/tokens.gen.ts", ts()],
];

if (check) {
	const stale: string[] = [];
	for (const [rel, content] of outputs) {
		let current = "";
		try {
			current = readFileSync(new URL(rel, root), "utf8");
		} catch {
			stale.push(rel + " is missing");
			continue;
		}
		if (current !== content) stale.push(rel + " is stale");
	}
	if (stale.length) {
		console.error(
			stale.join(" and ") +
				" — run `pnpm theme:build` (the tokens changed without regenerating).",
		);
		process.exit(1);
	}
	console.log("the styling layer is current with design/tokens/tokens.json");
	process.exit(0);
}

for (const [rel, content] of outputs) {
	writeFileSync(new URL(rel, root), content);
}
console.log(
	"wrote src/ui/theme.css and src/ui/tokens.gen.ts — " +
		roles.length +
		" colour roles (" +
		varying.length +
		" theme-varying), " +
		Object.keys(typeSteps).length +
		" type steps, " +
		Object.keys(radii).length +
		" radii",
);
