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
 * referenced by test flows, not by the UI copy.
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

/** Interactive controls. One identifier per control a flow has to reach. */
export const CONTROL = {
	// The shell's own controls.
	themeLight: "appearance-theme-light",
	themeDark: "appearance-theme-dark",
	themeSystem: "appearance-theme-system",

	// Primitives, addressed generically where a screen will name its own use.
	button: "button",
	iconButton: "icon-button",
	input: "input",
	textarea: "textarea",
	chip: "chip",
	listRow: "list-row",
	segmented: "segmented",
	segmentedOption: "segmented-option",
	sheetClose: "sheet-close",
	dialogConfirm: "dialog-confirm",
	dialogCancel: "dialog-cancel",
	toast: "toast",

	// Route stubs the later streams fill in; declared here so the names are
	// agreed before two screens invent two spellings.
	sessionsNew: "sessions-new",
	sessionsPast: "sessions-past",
	sessionsSettings: "sessions-settings",
	welcomeContinue: "welcome-continue",
	signInStart: "sign-in-start",
	customRouteSave: "custom-route-save",
	retry: "retry",
} as const;

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
