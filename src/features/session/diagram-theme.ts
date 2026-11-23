import type { ColorRole } from "@/ui/tokens.gen";

/**
 * How Pele's colour variables read the app's theme.
 *
 * Pele draws every colour as `var(--pele-*, fallback)`. React Native has no CSS
 * cascade, so `diagram-svg.ts` substitutes the values below before the SVG
 * reaches a native view; this module only says WHICH theme role feeds WHICH
 * variable. The mapping is the desktop UI's (`pele-theme.ts` in
 * local-operator-ui), role for role, so a diagram reads the same on both
 * surfaces: nodes sit on `elevated`, edges and labels use the ink roles, and a
 * chart's series run through the accent and status colours in the order
 * accent, accent-alt, warning, danger, info, success (7 and 8 cycle).
 *
 * The right-hand side is the app's own colour ROLE, never a hex: a custom
 * palette or a theme change flows through the active theme entry and the diagram is
 * redrawn from the new values (Pele renders in well under a millisecond).
 */
export const PELE_COLOUR_ROLES = {
	"--pele-bg": "surface",
	"--pele-fg": "ink",
	"--pele-muted": "ink-muted",
	"--pele-line": "ink-muted",
	"--pele-surface": "elevated",
	"--pele-surface-alt": "sunken",
	"--pele-border": "border-control",
	"--pele-accent": "accent",
	"--pele-critical": "danger",
	"--pele-error": "danger",
	"--pele-series-1": "accent",
	"--pele-series-2": "accent-alt",
	"--pele-series-3": "warning",
	"--pele-series-4": "danger",
	"--pele-series-5": "info",
	"--pele-series-6": "success",
	"--pele-series-7": "accent",
	"--pele-series-8": "accent-alt",
} as const satisfies Record<string, ColorRole>;

export type PeleColourVariable = keyof typeof PELE_COLOUR_ROLES;

/** Label size in points. The transcript's reading size (`text-body-read`, 14),
 *  as the desktop uses, so a diagram label is the same size as the prose
 *  around it when the diagram fits at full scale. */
export const PELE_FONT_SIZE = 14;

/** Theme values keyed by Pele variable name, ready for `prepareDiagramSvg`. */
export const peleThemeVariables = (
	colour: (role: ColorRole) => string,
): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [name, role] of Object.entries(PELE_COLOUR_ROLES)) {
		out[name] = colour(role);
	}
	return out;
};
