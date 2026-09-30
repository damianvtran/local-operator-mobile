#!/usr/bin/env node
/**
 * Generate `tailwind-preset.js` from `tokens.json`.
 *
 *     node design/tokens/build-preset.mjs          # write the preset
 *     node design/tokens/build-preset.mjs --check   # fail if it is stale
 *
 * Why a generator rather than a hand-written preset. The preset is the one
 * artefact the whole app is styled through, so a hand-edited copy of
 * `tokens.json` is a second source of truth that drifts silently: a colour
 * changed in the tokens and not in the preset ships as a theme that half
 * applies. Regenerating is one command and `--check` makes drift a CI failure
 * rather than a review catch.
 *
 * The preset is deliberately FRAMEWORK-AGNOSTIC, because the toolchain choice
 * is not this stream's to make (see docs/design/brand-kit.md § 8):
 *
 *   - NativeWind reads it as `presets: [require("./design/tokens/tailwind-preset.js")]`
 *     in `tailwind.config.js`, and the `cssVariables()` string it exports is
 *     what that config writes into `global.css`.
 *   - Uniwind has no JS config at all; an app on Uniwind uses ONLY the
 *     `cssVariables()` output plus the `@theme` block, which is emitted here
 *     as `themeBlock()` alongside it.
 *
 * Both paths resolve the same role names to the same values, so a component
 * written against `bg-surface` / `text-ink-muted` / `border-control` is
 * portable between them.
 */

import { readFileSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const tokens = JSON.parse(readFileSync(new URL("./tokens.json", here), "utf8"));

const check = process.argv.includes("--check");

/* ---- flatten the colour roles into name -> { light, dark } ------------- */

/** Every colour token, flattened to a single namespace. A `value` token is
 * theme-invariant and emits one variable, not two. */
const colors = {};
for (const [group, body] of Object.entries(tokens.color)) {
	if (group.startsWith("$") || typeof body !== "object") continue;
	for (const [name, token] of Object.entries(body)) {
		if (name.startsWith("$")) continue;
		colors[name] = token.value !== undefined
			? { value: token.value }
			: { light: token.light, dark: token.dark };
	}
}

const radii = Object.fromEntries(
	Object.entries(tokens.radius).filter(
		([k, v]) => !k.startsWith("$") && k !== "assignment" && typeof v === "number",
	),
);

const variable = (name) => `--lo-${name}`;

/* ---- the emitted files ------------------------------------------------- */

const cssVariables = () => {
	const lines = [];
	const block = (selector, theme, note) => {
		lines.push(`${note}`);
		lines.push(`${selector} {`);
		for (const [name, token] of Object.entries(colors)) {
			/* A theme-invariant token is emitted once, in `:root`. The first
			 * version of this function also emitted it in the dark block AND
			 * resolved every OTHER token to its light value there, so the dark
			 * theme was an empty override: the preview captured a light sheet for
			 * both themes, and only the resolved-value diagnostic in capture.mjs
			 * showed it (the two files were byte-identical). */
			if (theme === "dark" && token.value !== undefined) continue;
			lines.push(`\t${variable(name)}: ${token.value ?? token[theme]};`);
		}
		lines.push("}");
	};
	/* Light is the document default and dark applies when an ancestor carries
	   the theme flag — the same contract the site kit uses, so a reader who
	   knows one knows the other. */
	block(":root", "light", "/* Light: the document default. */");
	lines.push("");
	block(
		".theme-dark",
		"dark",
		"/* Dark: applied by the theme provider on an ancestor, never by a media\n   query alone — the app has an explicit in-app setting, and a user who chose\n   light on a dark phone must keep their choice. */",
	);
	return lines.join("\n");
};

const themeBlock = () => {
	const lines = ["@theme {"];
	for (const name of Object.keys(colors))
		lines.push(`\t--color-${name}: var(${variable(name)});`);
	lines.push("");
	lines.push("\t/* ---- type: size / line-height, one utility per step ---- */");
	for (const [name, step] of Object.entries(tokens.type.steps)) {
		if (name.startsWith("$")) continue;
		lines.push(`\t--text-${name}: ${step.size}px;`);
		lines.push(`\t--text-${name}--line-height: ${step.lineHeight};`);
		lines.push(`\t--text-${name}--font-weight: ${step.weight};`);
		lines.push(
			`\t--text-${name}--letter-spacing: ${step.letterSpacing === 0 ? "0" : `${step.letterSpacing}em`};`,
		);
	}
	lines.push("");
	lines.push("\t/* ---- radii: assigned by what the object is, never by taste ---- */");
	for (const [name, value] of Object.entries(radii))
		lines.push(`\t--radius-${name}: ${value}px;`);
	lines.push("\t/* ---- touch geometry: the heights a control may declare ---- */");
	for (const [name, value] of Object.entries(tokens.size.controls))
		lines.push(`\t--control-${name}-height: ${value.height}px;`);
	lines.push("");
	lines.push("\t/* ---- motion: the durations and easings the system is allowed ---- */");
	for (const [name, value] of Object.entries(tokens.motion.duration))
		lines.push(`\t--duration-${name}: ${value}ms;`);
	for (const [name, value] of Object.entries(tokens.motion.easing))
		lines.push(`\t--ease-${name}: ${value};`);
	lines.push("}");
	return lines.join("\n");
};

const jsPreset = () => {
	const q = (s) => `"${s}"`;
	const lines = [];

	lines.push("/**");
	lines.push(" * GENERATED FILE — do not edit by hand.");
	lines.push(" *");
	lines.push(" * Regenerate with `node design/tokens/build-preset.mjs` after changing");
	lines.push(" * `design/tokens/tokens.json`. `node design/tokens/build-preset.mjs --check`");
	lines.push(" * fails if this file is stale, which is what keeps the preset from becoming a");
	lines.push(" * second, quietly divergent source of truth.");
	lines.push(" *");
	lines.push(" * Sources of truth: design/tokens/tokens.json (values, both themes) and");
	lines.push(" * design/tokens/contrast-contract.mjs (the floors those values must clear).");
	lines.push(" * Prose: docs/design/brand-kit.md (why) and docs/design/components.md (what).");
	lines.push(" *");
	lines.push(" * Framework-agnostic on purpose — the toolchain decision is not settled:");
	lines.push(" *");
	lines.push(" *   NativeWind (JS config)");
	lines.push(" *     // tailwind.config.js");
	lines.push(" *     module.exports = {");
	lines.push(' *       presets: [require("./design/tokens/tailwind-preset.js")],');
	lines.push(' *       content: ["./app" + "/**" + "/*.{ts,tsx}"],');
	lines.push(" *     };");
	lines.push(' *     // and paste `preset.cssVariables()` into global.css.');
	lines.push(" *");
	lines.push(" *   Uniwind (CSS only, no JS config)");
	lines.push(" *     // global.css");
	lines.push(' *     @import "tailwindcss";');
	lines.push(' *     @import "uniwind";');
	lines.push(" *     // paste preset.cssVariables() here");
	lines.push(" *     // paste preset.themeBlock() here");
	lines.push(" *");
	lines.push(" * The colour utilities resolve to `var(--lo-*)`, which the theme provider");
	lines.push(" * sets from the active palette. That indirection is the point: switching");
	lines.push(" * theme is a variable swap, and no component knows it happened.");
	lines.push(" *");
	lines.push(" * @see docs/design/brand-kit.md § 2 for the palette mapping and why the");
	lines.push(" *      default dark is localOperatorDark and the default light is");
	lines.push(" *      localOperatorLight rather than the site's own ramp.");
	lines.push(" */");
	lines.push("");
	lines.push("const colors = {");
	for (const name of Object.keys(colors)) lines.push(`\t${q(name)}: ${q(`var(${variable(name)})`)},`);
	lines.push("};");
	lines.push("");

	/* Radii and the control heights the app can express as a min-* utility.
	 * Tailwind's own spacing ramp IS this system's 4pt base (spacing-1 is 4px in
	 * both), so spacing is NOT restated here: restating a scale that already
	 * matches is how the two drift apart later. */
	lines.push("const borderRadius = {");
	for (const [k, v] of Object.entries(radii))
		lines.push(`\t${q(k)}: ${q(`${v}px`)},`);
	lines.push("};");
	lines.push("");
	lines.push("const minHeight = {");
	for (const [k, v] of Object.entries(tokens.size.controls))
		lines.push(`\t${q(k)}: ${q(`${v.height}px`)},`);
	lines.push("};");
	lines.push("");

	lines.push("const fontSize = {");
	for (const [name, step] of Object.entries(tokens.type.steps)) {
		if (name.startsWith("$")) continue;
		const ls = step.letterSpacing === 0 ? "0" : `${step.letterSpacing}em`;
		lines.push(
			`\t${q(name)}: [${q(`${step.size}px`)}, { lineHeight: ${q(String(step.lineHeight))}, fontWeight: ${q(String(step.weight))}, letterSpacing: ${q(ls)} }],`,
		);
	}
	lines.push("};");
	lines.push("");

	lines.push("const duration = {");
	for (const [name, value] of Object.entries(tokens.motion.duration))
		lines.push(`\t${q(name)}: ${q(`${value}ms`)},`);
	lines.push("};");
	lines.push("");
	lines.push("const transitionTimingFunction = {");
	for (const [name, value] of Object.entries(tokens.motion.easing))
		lines.push(`\t${q(name)}: ${q(value)},`);
	lines.push("};");
	lines.push("");

	lines.push("/* A role-based colour layer only. Spacing, radii, type and motion extend");
	lines.push(" * Tailwind's defaults rather than replacing them: the system's rule is that");
	lines.push(" * a component names a ROLE for colour and uses the platform's own scale for");
	lines.push(" * everything else, and a preset that replaced the spacing scale would make");
	lines.push(" * `p-4` mean something different here than in any other Tailwind app. */");
	lines.push("const preset = {");
	lines.push("\ttheme: {");
	lines.push("\t\textend: {");
	lines.push("\t\t\tcolors,");
	lines.push("\t\t\tfontSize,");
	lines.push("\t\t\tborderRadius,");
	lines.push("\t\t\tminHeight,");
	lines.push("\t\t\ttransitionDuration: duration,");
	lines.push("\t\t\ttransitionTimingFunction,");
	lines.push("\t\t},");
	lines.push("\t},");
	lines.push("};");
	lines.push("");
	lines.push("module.exports = preset;");
	lines.push("module.exports.colors = colors;");
	lines.push("module.exports.fontSize = fontSize;");
	lines.push("");
	lines.push("/* The two strings the CSS-only path needs. Kept as source rather than as a");
	lines.push(" * generated .css file so there is exactly one artefact to keep in sync. */");
	lines.push("module.exports.cssVariables = () => `");
	lines.push(cssVariables());
	lines.push("`;");
	lines.push("module.exports.themeBlock = () => `");
	lines.push(themeBlock());
	lines.push("`;");
	lines.push("");
	return lines.join("\n");
};

const output = jsPreset();
const target = new URL("./tailwind-preset.js", here);

/* The preview sheet is a plain HTML page, not a Tailwind build, so it needs the
 * role variables as CSS. Emitting them from the same generator is the point:
 * the preview is styled by the preset's own output, which means a token changed
 * in tokens.json shows up in the preview on the next build rather than drifting
 * out of it. It is generated and committed because the HTML links it. */
const cssTarget = new URL("../preview/tokens.generated.css", here);
const cssOutput = `/* GENERATED by design/tokens/build-preset.mjs — do not edit by hand.
 *
 * The role variables the preview sheet is styled with, emitted from
 * tokens.json. Regenerate with \`node design/tokens/build-preset.mjs\`.
 */

${cssVariables()}

/* Type, radii, control heights and motion, as custom properties, so the
 * preview renders the same scale the app will. */
.preview-scale {
${Object.entries(tokens.type.steps)
	.map(
		([name, step]) =>
			`\t--preview-text-${name}: ${step.size}px;\n\t--preview-text-${name}-lh: ${step.lineHeight};\n\t--preview-text-${name}-weight: ${step.weight};\n\t--preview-text-${name}-tracking: ${step.letterSpacing === 0 ? "0" : `${step.letterSpacing}em`};`,
	)
	.join("\n")}
${Object.entries(radii)
	.map(([name, value]) => `\t--preview-radius-${name}: ${value}px;`)
	.join("\n")}
${Object.entries(tokens.motion.duration)
	.map(([name, value]) => `\t--preview-duration-${name}: ${value}ms;`)
	.join("\n")}
${Object.entries(tokens.motion.easing)
	.map(([name, value]) => `\t--preview-ease-${name}: ${value};`)
	.join("\n")}
}
`;

if (check) {
	let current = "";
	try {
		current = readFileSync(target, "utf8");
	} catch {
		console.error(
			"tailwind-preset.js is missing — run `node design/tokens/build-preset.mjs`",
		);
		process.exit(1);
	}
	let cssCurrent = "";
	try {
		cssCurrent = readFileSync(cssTarget, "utf8");
	} catch {
		console.error(
			"preview/tokens.generated.css is missing — run `node design/tokens/build-preset.mjs`",
		);
		process.exit(1);
	}
	const stale = [];
	if (current !== output) stale.push("tailwind-preset.js");
	if (cssCurrent !== cssOutput) stale.push("preview/tokens.generated.css");
	if (stale.length) {
		console.error(
			`${stale.join(" and ")} ${stale.length > 1 ? "are" : "is"} stale — run \`node design/tokens/build-preset.mjs\``,
		);
		process.exit(1);
	}
	console.log("tailwind-preset.js and preview/tokens.generated.css are current.");
	process.exit(0);
}

writeFileSync(target, output);
writeFileSync(cssTarget, cssOutput);
console.log(
	`wrote tailwind-preset.js — ${Object.keys(colors).length} colour roles, ` +
		`${Object.keys(tokens.type.steps).length} type steps, ` +
		`${Object.keys(tokens.motion.duration).length} durations`,
);
