/**
 * Accessibility identifiers, roles, and states — as constants, in one place.
 *
 * Two reasons this is a module rather than literals in each component.
 *
 * First, the identifiers ARE the E2E selectors (docs/adr/0003-e2e-and-audit-harness.md
 * § "Accessibility and large text"): Maestro pilots the app through the platform's
 * accessibility tree, so a control without an identifier cannot be tested at all.
 * Keeping them in one file makes a missing one visible in review, and makes a
 * rename a compile error rather than a silently-failing test.
 *
 * Second, a duplicated literal is a rename waiting to break: `"sessions-screen"`
 * spelled in two files is one file away from a suite that quietly tests nothing.
 *
 * Naming: `<area>-<thing>`, kebab-case, stable forever — these names are
 * referenced by test flows, not by the UI copy. Renaming one is a contract change
 * that the flow check (`a11y.e2e.test.ts`) turns into a failing test.
 */

/** The values React Native accepts for `accessibilityRole`. */
export const ROLE = {
	button: "button",
	link: "link",
	header: "header",
	text: "text",
	image: "image",
	imagebutton: "imagebutton",
	alert: "alert",
	tab: "tab",
	tablist: "tablist",
	radiogroup: "radiogroup",
	radio: "radio",
	switch: "switch",
	checkbox: "checkbox",
	progressbar: "progressbar",
	summary: "summary",
	none: "none",
} as const;

export type A11yRole = (typeof ROLE)[keyof typeof ROLE];

/**
 * Identify a screen root. Every screen carries one so a flow can assert it
 * arrived rather than inferring it from copy that the next design pass may
 * rewrite.
 */
export const SCREEN = {
	welcome: "welcome-screen",
	signIn: "sign-in-screen",
	computers: "computers-screen",
	customRoute: "custom-route-screen",
	sessions: "sessions-screen",
	session: "session-screen",
	subagent: "subagent-screen",
	past: "past-sessions-screen",
	newSession: "new-session-screen",
	settings: "settings-screen",
} as const;

/**
 * The empty state each screen renders while its real content does not exist yet.
 * One per screen and named after it, so a flow asserting "this screen is honestly
 * empty" cannot be satisfied by another screen's empty state.
 */
export const EMPTY = {
	welcome: "welcome-empty",
	signIn: "sign-in-empty",
	computers: "computers-empty",
	customRoute: "custom-empty",
	sessions: "sessions-empty",
	session: "session-empty",
	subagent: "subagent-empty",
	past: "past-empty",
	newSession: "new-session-empty",
	settingsConnection: "settings-connection-empty",
} as const;

/**
 * Interactive controls: one identifier per control a flow has to reach, named
 * `<screen-or-surface>-<what it does>`.
 *
 * There is deliberately NO generic entry (`button`, `input`, `list-row`). The
 * primitives take `testID` as a REQUIRED prop, so a screen with two buttons cannot
 * fall back to two identical `"button"` identifiers — Maestro's `id:` matching
 * would then pick one arbitrarily, and the failure reads as a flaky flow rather
 * than a naming mistake. A control that a later stream adds gets its name here in
 * the same change that renders it.
 */
export const CONTROL = {
	// Welcome and Sessions: the two shell routes that render an action.
	welcomeContinue: "welcome-continue",
	sessionsNew: "sessions-new",
	sessionsSettings: "sessions-settings",

	// The back affordance each pushed screen puts in its header. Named per screen
	// because two screens are on the navigation stack at once during a transition.
	sessionBack: "session-back",
	subagentBack: "subagent-back",

	// Settings: the theme override, the one setting that needs no connection.
	settingsTheme: "settings-theme",
	themeSystem: "appearance-theme-system",
	themeLight: "appearance-theme-light",
	themeDark: "appearance-theme-dark",

	// Overlays. Only one sheet, one dialog and one toast can be up at a time (the
	// z ladder allows no more), so their parts are unambiguous without a
	// discriminator; the surface itself is named by whichever screen opens it.
	sheetClose: "sheet-close",
	sheetScrim: "sheet-scrim",
	dialogConfirm: "dialog-confirm",
	dialogCancel: "dialog-cancel",
	dialogScrim: "dialog-scrim",
	toast: "toast",
} as const;

/**
 * Every static identifier the app can render, flat, as a Node script reads it.
 *
 * This file is the single source of truth for the identifier contract, and it is
 * plain TypeScript with NO imports on purpose: `node src/ui/a11y.ts` can load it
 * through type stripping without React Native, the path alias or a bundler. The
 * end-to-end flows (`e2e/maestro/**`) are YAML that must follow these names, never
 * the reverse, and the check that they do lives in `a11y.e2e.test.ts`.
 */
export const IDENTIFIERS: readonly string[] = [
	...Object.values(SCREEN),
	...Object.values(EMPTY),
	...Object.values(CONTROL),
];

/**
 * Families of parameterised identifiers, declared as their literal prefix
 * (`"session-row-"` for `session-row-<id>`). Empty until a screen renders one: the
 * shell has no list rows or per-computer rows yet, and a family is added in the
 * same change as the control that carries it.
 */
export const IDENTIFIER_FAMILIES: readonly string[] = [];

/**
 * Whether a selector names something the app can render: a static identifier, or
 * a member of a declared family. A flow writes a family member either as a
 * template (`session-row-${SESSION_ID}`) or as a concrete instance
 * (`session-row-6714def86197`); both resolve through the literal text before the
 * first `${`.
 */
export const isKnownIdentifier = (
	selector: string,
	families: readonly string[] = IDENTIFIER_FAMILIES,
	statics: readonly string[] = IDENTIFIERS,
): boolean => {
	if (statics.includes(selector)) return true;
	const literal = selector.split("${")[0] ?? selector;
	return families.some(
		(family) => literal.startsWith(family) && selector.length > family.length,
	);
};

/** Regions whose content changes on its own, and how it should be announced. */
export const LIVE_REGION = {
	/** Streaming text and status: announce the state change, never every token. */
	polite: "polite",
	/** An error the reader must know about now. */
	assertive: "assertive",
	none: "none",
} as const;

/**
 * Announce a busy/disabled state consistently.
 *
 * `disabled` here is the accessibility state, not the visual one: a control that
 * looks disabled but is not marked so is invisible to a screen reader, and the
 * design kit's rule that disabled changes colour rather than opacity
 * (docs/design/components.md § 0) makes the two easy to disconnect.
 */
export const state = (options: {
	disabled?: boolean;
	busy?: boolean;
	selected?: boolean;
	expanded?: boolean;
}): {
	disabled?: boolean;
	busy?: boolean;
	selected?: boolean;
	expanded?: boolean;
} => {
	const out: {
		disabled?: boolean;
		busy?: boolean;
		selected?: boolean;
		expanded?: boolean;
	} = {};
	if (options.disabled !== undefined) out.disabled = options.disabled;
	if (options.busy !== undefined) out.busy = options.busy;
	if (options.selected !== undefined) out.selected = options.selected;
	if (options.expanded !== undefined) out.expanded = options.expanded;
	return out;
};
