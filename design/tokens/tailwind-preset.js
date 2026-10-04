/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with `node design/tokens/build-preset.mjs` after changing
 * `design/tokens/tokens.json`. `node design/tokens/build-preset.mjs --check`
 * fails if this file is stale, which is what keeps the preset from becoming a
 * second, quietly divergent source of truth.
 *
 * Sources of truth: design/tokens/tokens.json (values, both themes) and
 * design/tokens/contrast-contract.mjs (the floors those values must clear).
 * Prose: docs/design/brand-kit.md (why) and docs/design/components.md (what).
 *
 * Framework-agnostic on purpose — the toolchain decision is not settled:
 *
 *   NativeWind (JS config)
 *     // tailwind.config.js
 *     module.exports = {
 *       presets: [require("./design/tokens/tailwind-preset.js")],
 *       content: ["./app" + "/**" + "/*.{ts,tsx}"],
 *     };
 *     // and paste `preset.cssVariables()` into global.css.
 *
 *   Uniwind (CSS only, no JS config)
 *     // global.css
 *     @import "tailwindcss";
 *     @import "uniwind";
 *     // paste preset.cssVariables() here
 *     // paste preset.themeBlock() here
 *
 * The colour utilities resolve to `var(--lo-*)`, which the theme provider
 * sets from the active palette. That indirection is the point: switching
 * theme is a variable swap, and no component knows it happened.
 *
 * @see docs/design/brand-kit.md § 2 for the palette mapping and why the
 *      default dark is localOperatorDark and the default light is
 *      localOperatorLight rather than the site's own ramp.
 */

const colors = {
	"canvas": "var(--lo-canvas)",
	"surface": "var(--lo-surface)",
	"elevated": "var(--lo-elevated)",
	"sunken": "var(--lo-sunken)",
	"message-surface": "var(--lo-message-surface)",
	"row-hover": "var(--lo-row-hover)",
	"row-selected": "var(--lo-row-selected)",
	"ink": "var(--lo-ink)",
	"ink-muted": "var(--lo-ink-muted)",
	"ink-dim": "var(--lo-ink-dim)",
	"ink-disabled": "var(--lo-ink-disabled)",
	"hairline": "var(--lo-hairline)",
	"hairline-strong": "var(--lo-hairline-strong)",
	"border-control": "var(--lo-border-control)",
	"panel-edge": "var(--lo-panel-edge)",
	"accent": "var(--lo-accent)",
	"accent-hover": "var(--lo-accent-hover)",
	"accent-active": "var(--lo-accent-active)",
	"accent-wash": "var(--lo-accent-wash)",
	"accent-muted": "var(--lo-accent-muted)",
	"accent-border": "var(--lo-accent-border)",
	"on-accent": "var(--lo-on-accent)",
	"accent-alt": "var(--lo-accent-alt)",
	"accent-alt-wash": "var(--lo-accent-alt-wash)",
	"success": "var(--lo-success)",
	"success-wash": "var(--lo-success-wash)",
	"success-border": "var(--lo-success-border)",
	"warning": "var(--lo-warning)",
	"warning-wash": "var(--lo-warning-wash)",
	"warning-border": "var(--lo-warning-border)",
	"danger": "var(--lo-danger)",
	"danger-wash": "var(--lo-danger-wash)",
	"danger-border": "var(--lo-danger-border)",
	"info": "var(--lo-info)",
	"info-wash": "var(--lo-info-wash)",
	"info-border": "var(--lo-info-border)",
	"diff-add": "var(--lo-diff-add)",
	"diff-add-surface": "var(--lo-diff-add-surface)",
	"diff-remove": "var(--lo-diff-remove)",
	"diff-remove-surface": "var(--lo-diff-remove-surface)",
	"diff-hunk": "var(--lo-diff-hunk)",
	"diff-hunk-surface": "var(--lo-diff-hunk-surface)",
	"diff-context": "var(--lo-diff-context)",
	"scrim": "var(--lo-scrim)",
	"shadow-color": "var(--lo-shadow-color)",
	"focus-ring-photo-inner": "var(--lo-focus-ring-photo-inner)",
	"focus-ring-photo-outer": "var(--lo-focus-ring-photo-outer)",
};

const borderRadius = {
	"xs": "2px",
	"sm": "6px",
	"md": "10px",
	"lg": "14px",
	"frame": "16px",
	"full": "9999px",
};

const minHeight = {
	"sm": "32px",
	"md": "44px",
	"lg": "50px",
	"icon": "44px",
	"fab": "56px",
};

const fontSize = {
	"display": ["28px", { lineHeight: "1.2", fontWeight: "600", letterSpacing: "-0.02em" }],
	"title": ["20px", { lineHeight: "1.3", fontWeight: "600", letterSpacing: "-0.012em" }],
	"heading": ["17px", { lineHeight: "1.35", fontWeight: "600", letterSpacing: "-0.006em" }],
	"body-lg": ["17px", { lineHeight: "1.5", fontWeight: "400", letterSpacing: "0" }],
	"body": ["16px", { lineHeight: "1.5", fontWeight: "400", letterSpacing: "0" }],
	"body-sm": ["14px", { lineHeight: "1.45", fontWeight: "400", letterSpacing: "0" }],
	"meta": ["12px", { lineHeight: "1.4", fontWeight: "500", letterSpacing: "0" }],
	"label": ["15px", { lineHeight: "1.2", fontWeight: "600", letterSpacing: "-0.005em" }],
	"mono": ["13px", { lineHeight: "1.5", fontWeight: "400", letterSpacing: "0" }],
	"mono-sm": ["12px", { lineHeight: "1.45", fontWeight: "400", letterSpacing: "0" }],
	"mono-code": ["13px", { lineHeight: "1.6", fontWeight: "400", letterSpacing: "0" }],
	"mono-label": ["11px", { lineHeight: "1.2", fontWeight: "600", letterSpacing: "0.06em" }],
};

const duration = {
	"instant": "80ms",
	"fast": "120ms",
	"base": "180ms",
	"slow": "240ms",
	"reveal": "320ms",
	"draw": "480ms",
	"close": "400ms",
	"beat": "700ms",
};

const transitionTimingFunction = {
	"out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
	"out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
	"in-out": "cubic-bezier(0.65, 0, 0.35, 1)",
	"linear": "linear",
};

/* A role-based colour layer only. Spacing, radii, type and motion extend
 * Tailwind's defaults rather than replacing them: the system's rule is that
 * a component names a ROLE for colour and uses the platform's own scale for
 * everything else, and a preset that replaced the spacing scale would make
 * `p-4` mean something different here than in any other Tailwind app. */
const preset = {
	theme: {
		extend: {
			colors,
			fontSize,
			borderRadius,
			minHeight,
			transitionDuration: duration,
			transitionTimingFunction,
		},
	},
};

module.exports = preset;
module.exports.colors = colors;
module.exports.fontSize = fontSize;

/* The two strings the CSS-only path needs. Kept as source rather than as a
 * generated .css file so there is exactly one artefact to keep in sync. */
module.exports.cssVariables = () => `
/* Light: the document default. */
:root {
	--lo-canvas: #f2ede3;
	--lo-surface: #f7f5ee;
	--lo-elevated: #fefdfa;
	--lo-sunken: #ece6d8;
	--lo-message-surface: #fcfbf7;
	--lo-row-hover: #edece7;
	--lo-row-selected: #ebe7d8;
	--lo-ink: #211e18;
	--lo-ink-muted: #4e4940;
	--lo-ink-dim: #656056;
	--lo-ink-disabled: #9a9488;
	--lo-hairline: #dad5cb;
	--lo-hairline-strong: #c9c3b6;
	--lo-border-control: #857f70;
	--lo-panel-edge: #dad5cb;
	--lo-accent: #137742;
	--lo-accent-hover: #116036;
	--lo-accent-active: #0c4b2a;
	--lo-accent-wash: #e7f1e8;
	--lo-accent-muted: #cfe5d4;
	--lo-accent-border: #47795b;
	--lo-on-accent: #f6faf8;
	--lo-accent-alt: #6c5f9a;
	--lo-accent-alt-wash: #f0edf8;
	--lo-success: #19764a;
	--lo-success-wash: #e6f1ea;
	--lo-success-border: #3e6b4e;
	--lo-warning: #8a5800;
	--lo-warning-wash: #f5ecd9;
	--lo-warning-border: #7a5a1e;
	--lo-danger: #b23a31;
	--lo-danger-wash: #f7e7e4;
	--lo-danger-border: #96544c;
	--lo-info: #2368a8;
	--lo-info-wash: #e9ebef;
	--lo-info-border: #486893;
	--lo-diff-add: #19764a;
	--lo-diff-add-surface: #e6f1ea;
	--lo-diff-remove: #b23a31;
	--lo-diff-remove-surface: #f7e7e4;
	--lo-diff-hunk: #2368a8;
	--lo-diff-hunk-surface: #e9ebef;
	--lo-diff-context: #656056;
	--lo-scrim: #0b0a08b3;
	--lo-shadow-color: #0b0a08;
	--lo-focus-ring-photo-inner: #fffefb;
	--lo-focus-ring-photo-outer: #14110c;
}

/* Dark: applied by the theme provider on an ancestor, never by a media
   query alone — the app has an explicit in-app setting, and a user who chose
   light on a dark phone must keep their choice. */
.theme-dark {
	--lo-canvas: #22201c;
	--lo-surface: #2b2721;
	--lo-elevated: #322d22;
	--lo-sunken: #1d1b19;
	--lo-message-surface: #2e2a21;
	--lo-row-hover: #302d29;
	--lo-row-selected: #372f24;
	--lo-ink: #f1eee6;
	--lo-ink-muted: #c2bcaf;
	--lo-ink-dim: #a6a091;
	--lo-ink-disabled: #5f5a4e;
	--lo-hairline: #403b2c;
	--lo-hairline-strong: #4d4633;
	--lo-border-control: #837c6d;
	--lo-panel-edge: #857b69;
	--lo-accent: #38c96a;
	--lo-accent-hover: #5ad584;
	--lo-accent-active: #2bb25c;
	--lo-accent-wash: #16281d;
	--lo-accent-muted: #1d3a28;
	--lo-accent-border: #4a8160;
	--lo-on-accent: #16130e;
	--lo-accent-alt: #b0a7f7;
	--lo-accent-alt-wash: #242233;
	--lo-success: #57c785;
	--lo-success-wash: #16281d;
	--lo-success-border: #4f8465;
	--lo-warning: #e0b04b;
	--lo-warning-wash: #2a2213;
	--lo-warning-border: #8c773c;
	--lo-danger: #ef8078;
	--lo-danger-wash: #2e1b18;
	--lo-danger-border: #ac675d;
	--lo-info: #86b3f2;
	--lo-info-wash: #192332;
	--lo-info-border: #5a7ba8;
	--lo-diff-add: #57c785;
	--lo-diff-add-surface: #23352a;
	--lo-diff-remove: #ef8078;
	--lo-diff-remove-surface: #432a26;
	--lo-diff-hunk: #86b3f2;
	--lo-diff-hunk-surface: #22303f;
	--lo-diff-context: #a6a091;
}
`;
module.exports.themeBlock = () => `
@theme {
	--color-canvas: var(--lo-canvas);
	--color-surface: var(--lo-surface);
	--color-elevated: var(--lo-elevated);
	--color-sunken: var(--lo-sunken);
	--color-message-surface: var(--lo-message-surface);
	--color-row-hover: var(--lo-row-hover);
	--color-row-selected: var(--lo-row-selected);
	--color-ink: var(--lo-ink);
	--color-ink-muted: var(--lo-ink-muted);
	--color-ink-dim: var(--lo-ink-dim);
	--color-ink-disabled: var(--lo-ink-disabled);
	--color-hairline: var(--lo-hairline);
	--color-hairline-strong: var(--lo-hairline-strong);
	--color-border-control: var(--lo-border-control);
	--color-panel-edge: var(--lo-panel-edge);
	--color-accent: var(--lo-accent);
	--color-accent-hover: var(--lo-accent-hover);
	--color-accent-active: var(--lo-accent-active);
	--color-accent-wash: var(--lo-accent-wash);
	--color-accent-muted: var(--lo-accent-muted);
	--color-accent-border: var(--lo-accent-border);
	--color-on-accent: var(--lo-on-accent);
	--color-accent-alt: var(--lo-accent-alt);
	--color-accent-alt-wash: var(--lo-accent-alt-wash);
	--color-success: var(--lo-success);
	--color-success-wash: var(--lo-success-wash);
	--color-success-border: var(--lo-success-border);
	--color-warning: var(--lo-warning);
	--color-warning-wash: var(--lo-warning-wash);
	--color-warning-border: var(--lo-warning-border);
	--color-danger: var(--lo-danger);
	--color-danger-wash: var(--lo-danger-wash);
	--color-danger-border: var(--lo-danger-border);
	--color-info: var(--lo-info);
	--color-info-wash: var(--lo-info-wash);
	--color-info-border: var(--lo-info-border);
	--color-diff-add: var(--lo-diff-add);
	--color-diff-add-surface: var(--lo-diff-add-surface);
	--color-diff-remove: var(--lo-diff-remove);
	--color-diff-remove-surface: var(--lo-diff-remove-surface);
	--color-diff-hunk: var(--lo-diff-hunk);
	--color-diff-hunk-surface: var(--lo-diff-hunk-surface);
	--color-diff-context: var(--lo-diff-context);
	--color-scrim: var(--lo-scrim);
	--color-shadow-color: var(--lo-shadow-color);
	--color-focus-ring-photo-inner: var(--lo-focus-ring-photo-inner);
	--color-focus-ring-photo-outer: var(--lo-focus-ring-photo-outer);

	/* ---- type: size / line-height, one utility per step ---- */
	--text-display: 28px;
	--text-display--line-height: 1.2;
	--text-display--font-weight: 600;
	--text-display--letter-spacing: -0.02em;
	--text-title: 20px;
	--text-title--line-height: 1.3;
	--text-title--font-weight: 600;
	--text-title--letter-spacing: -0.012em;
	--text-heading: 17px;
	--text-heading--line-height: 1.35;
	--text-heading--font-weight: 600;
	--text-heading--letter-spacing: -0.006em;
	--text-body-lg: 17px;
	--text-body-lg--line-height: 1.5;
	--text-body-lg--font-weight: 400;
	--text-body-lg--letter-spacing: 0;
	--text-body: 16px;
	--text-body--line-height: 1.5;
	--text-body--font-weight: 400;
	--text-body--letter-spacing: 0;
	--text-body-sm: 14px;
	--text-body-sm--line-height: 1.45;
	--text-body-sm--font-weight: 400;
	--text-body-sm--letter-spacing: 0;
	--text-meta: 12px;
	--text-meta--line-height: 1.4;
	--text-meta--font-weight: 500;
	--text-meta--letter-spacing: 0;
	--text-label: 15px;
	--text-label--line-height: 1.2;
	--text-label--font-weight: 600;
	--text-label--letter-spacing: -0.005em;
	--text-mono: 13px;
	--text-mono--line-height: 1.5;
	--text-mono--font-weight: 400;
	--text-mono--letter-spacing: 0;
	--text-mono-sm: 12px;
	--text-mono-sm--line-height: 1.45;
	--text-mono-sm--font-weight: 400;
	--text-mono-sm--letter-spacing: 0;
	--text-mono-code: 13px;
	--text-mono-code--line-height: 1.6;
	--text-mono-code--font-weight: 400;
	--text-mono-code--letter-spacing: 0;
	--text-mono-label: 11px;
	--text-mono-label--line-height: 1.2;
	--text-mono-label--font-weight: 600;
	--text-mono-label--letter-spacing: 0.06em;

	/* ---- radii: assigned by what the object is, never by taste ---- */
	--radius-xs: 2px;
	--radius-sm: 6px;
	--radius-md: 10px;
	--radius-lg: 14px;
	--radius-frame: 16px;
	--radius-full: 9999px;
	/* ---- touch geometry: the heights a control may declare ---- */
	--control-sm-height: 32px;
	--control-md-height: 44px;
	--control-lg-height: 50px;
	--control-icon-height: 44px;
	--control-fab-height: 56px;

	/* ---- motion: the durations and easings the system is allowed ---- */
	--duration-instant: 80ms;
	--duration-fast: 120ms;
	--duration-base: 180ms;
	--duration-slow: 240ms;
	--duration-reveal: 320ms;
	--duration-draw: 480ms;
	--duration-close: 400ms;
	--duration-beat: 700ms;
	--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
	--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
	--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
	--ease-linear: linear;
}
`;
