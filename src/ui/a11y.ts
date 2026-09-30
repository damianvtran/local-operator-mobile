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
	notFound: "not-found-screen",
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
	notFound: "not-found-empty",
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
/**
 * Non-interactive anchors: the surfaces a flow asserts are PRESENT on a screen.
 *
 * Separate from `CONTROL` because they take no gesture — a flow waits for them
 * (`assertVisible`) rather than tapping them — and separate from `EMPTY` because
 * they are rendered with content in them, not instead of it. The session view has
 * several of these and they are load-bearing: a transcript that never appeared and
 * a transcript that is empty are different failures, and only an identifier tells
 * them apart.
 */
export const SURFACE = {
	/** The measure-capped content column the transcript and composer share. */
	sessionColumn: "session-column",
	/** The header strip: conversation name, context and cost. */
	sessionContext: "session-context-strip",
	/** The whole-screen loading state, before the first projection arrives. */
	sessionLoading: "session-loading",
	/** The transcript's own empty state, which is NOT the screen's. */
	sessionTranscriptEmpty: "session-transcript-empty",
	/** The working line above the composer: what the turn is doing right now. */
	sessionWorkingLine: "session-working-line",
	/** The subagent view's breadcrumb back to its parent. */
	subagentCrumb: "subagent-detail-crumb",
	/** The subagent view's own failure, loading and content anchors. Its empty
	 *  state is `EMPTY.subagent`, which names the screen it belongs to. */
	subagentError: "subagent-detail-error",
	subagentLoading: "subagent-detail-loading",
	subagentPrompt: "subagent-detail-prompt",
	subagentTodos: "subagent-detail-todos",
	subagentTranscript: "subagent-detail-transcript",

	/* The session view's own surfaces. There is deliberately no rail anchor here:
	 * `session-panel-rail` was declared in the change that dropped the rail, and a
	 * declared-but-unrendered identifier is a selector no flow can ever hit — the
	 * rule this file states for families applies to surfaces too. It comes back in
	 * the change that renders the rail, which is the one that adopts #11's
	 * `capColumn={false}` + `paneSide="end"` opt-in. */
	sessionTranscript: "session-transcript",
	sessionComposer: "session-composer",
	/** The composer's alert slot: one of these is up at a time, and each says a
	 *  different thing — a notice is information, an error is a failure, and the
	 *  retained slot is an instruction whose delivery is UNKNOWN. */
	composerNotice: "composer-notice",
	composerError: "composer-error",
	composerRetained: "composer-retained",
	/** The delivery receipt, aria-hidden: a fact for the flows, not for a reader. */
	composerReceipt: "composer-receipt",
	/** Why the primary is off, in the reader's words: an unresolved instruction, or a
	 *  session that has ended. A dead control with no reason is a broken-looking
	 *  control (`U4`). */
	composerDisabledReason: "composer-disabled-reason",
	queuedMessageChip: "queued-message-chip",
	connectionBanner: "connection-banner",
	modelSheet: "model-sheet",
	effortSheet: "effort-sheet",
	slashSheet: "slash-sheet",
	todosPanel: "todos-panel",
	todosBody: "todos-panel-body",
	subagentsPanel: "subagents-panel",
	subagentsBody: "subagents-panel-body",
	/** A subagent row's running marker, inside its `subagent-chip-<job-id>` row. */
	subagentRunning: "subagent-status-running",
	/** The marker on the row that is still receiving text. */
	transcriptStreaming: "transcript-row-streaming",
	/** The pending card: the approval and ask share one shell, so the parts are
	 *  named once each rather than derived from whichever root is showing. */
	pendingCardBody: "pending-card-body",
	pendingCardDetail: "pending-card-detail",
	pendingCardDestructiveMarker: "pending-card-destructive-marker",
	pendingCardAnswer: "ask-card-answer",
	pendingCardError: "pending-card-error",

	/* The C1-C7 banner's own anchors. They are surfaces rather than controls
	 * because a flow asserts them; the banner's ACTION is a `CONTROL` entry, and
	 * which one is offered is the surface's decision to state. */
	connectionWaiting: "connection-error-waiting",
	connectionClearsByItself: "connection-error-clears-by-itself",
	connectionCertificateRejected: "connection-error-certificate-rejected",
	connectionHostUnresolved: "connection-error-host-unresolved",
	connectionComputerOffline: "connection-error-computer-offline",
	connectionMachineRemedy: "connection-error-machine-remedy",
	connectionRelayNotInstalled: "connection-error-relay-not-installed",
	connectionTunnelUnavailable: "connection-error-tunnel-unavailable",
} as const;

export const CONTROL = {
	// Welcome and Sessions: the two shell routes that render an action.
	welcomeContinue: "welcome-continue",
	sessionsNew: "sessions-new",
	sessionsSettings: "sessions-settings",
	notFoundHome: "not-found-home",

	// The back affordance each pushed screen puts in its header. Named per screen
	// because two screens are on the navigation stack at once during a transition.
	sessionBack: "session-back",
	subagentBack: "subagent-back",

	/** The session header's panel lever: the one control that opens the subagents
	 *  sheet on a compact screen, where no rail exists. */
	sessionSubagents: "session-subagents-chip",

	/* The composer's controls. Each is its own entry rather than a derived name:
	 * a flow taps exactly one of them, and "the composer's Nth button" is not a
	 * thing a selector can say. */
	/** The code block's copy affordance, inside a transcript row. */
	codeBlockCopy: "code-block-copy",
	composerSend: "composer-send",
	composerStop: "composer-stop",
	composerRetry: "composer-retry",
	composerAttach: "composer-attach",
	composerResume: "composer-resume",
	composerInput: "composer-input",
	composerModelChip: "composer-model-chip",
	composerEffortChip: "composer-effort-chip",

	/* The sheets the composer opens. */
	slashFilter: "slash-filter",

	/* The pending card's controls, and the panel headers (a disclosure IS a
	 * control: it is the thing the reader taps). */
	pendingApprove: "pending-card-approve",
	pendingDeny: "pending-card-deny",
	pendingRemember: "pending-card-remember",
	pendingAskSubmit: "ask-submit",
	todosDisclosure: "todos-panel-header",
	subagentsDisclosure: "subagents-panel-header",

	/** The banner's action, whichever the surface offers: the SAME control slot,
	 *  named once so a flow asserting "the banner offers a remedy" does not have
	 *  to know which remedy today's failure produced. */
	connectionRetry: "connection-error-retry-prominent",
	connectionSignIn: "connection-error-sign-in",
	connectionConsole: "connection-error-console-link",

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
	...Object.values(SURFACE),
];

/**
 * Families of parameterised identifiers, declared as their literal prefix
 * (`"session-row-"` for `session-row-<id>`). Empty until a screen renders one: the
 * shell has no list rows or per-computer rows yet, and a family is added in the
 * same change as the control that carries it.
 */
export const FAMILY = {
	/** One row of a session's transcript: `transcript-row-<row-id>`. */
	transcriptRow: "transcript-row-",
	/** One image inside a row: `transcript-image-<entry-id>-<index>`. */
	transcriptImage: "transcript-image-",
	/** One model in the model sheet: `model-option-<model-id>`. */
	modelOption: "model-option-",
	/** One rung of the effort ladder: `effort-rung-<rung>`. */
	effortRung: "effort-rung-",
	/** One command in the slash sheet: `slash-command-<name>`. */
	slashCommand: "slash-command-",
	/** One attached image in the composer: `composer-attachment-<index>`. */
	composerAttachment: "composer-attachment-",
	/** One row of the subagents panel: `subagent-chip-<job-id>`. */
	subagentChip: "subagent-chip-",
	/** One row of the todos panel: `todos-row-<index>`. */
	todosRow: "todos-row-",
	/** One question of a multi-question ask: `ask-question-<n>-of-<total>`. */
	askQuestion: "ask-question-",
	/** One answer option: `ask-option-<index>`. */
	askOption: "ask-option-",
} as const;

/**
 * Families of parameterised identifiers, declared as their literal prefix
 * (`"transcript-row-"` for `transcript-row-<id>`). A family is added in the same
 * change as the control that carries it, and the builders below are how a
 * component spells one WITHOUT a template: a `testID` whose value is a template
 * is read as a literal by the identifier check (`a11y.e2e.test.ts`), so the prefix
 * would drift from this file the moment nobody looked.
 */
export const IDENTIFIER_FAMILIES: readonly string[] = Object.values(FAMILY);

/* The builders. Pure, import-free, and the only place these prefixes are used. */
export const transcriptRowID = (rowId: string): string =>
	`${FAMILY.transcriptRow}${rowId}`;
export const transcriptImageID = (entryId: string, index: number): string =>
	`${FAMILY.transcriptImage}${entryId}-${index}`;
export const modelOptionID = (modelId: string): string =>
	`${FAMILY.modelOption}${modelId}`;
export const effortRungID = (rung: string): string =>
	`${FAMILY.effortRung}${rung}`;
export const slashCommandID = (name: string): string =>
	`${FAMILY.slashCommand}${name}`;
export const composerAttachmentID = (index: number): string =>
	`${FAMILY.composerAttachment}${index}`;
export const subagentChipID = (jobId: string): string =>
	`${FAMILY.subagentChip}${jobId}`;
export const todosRowID = (index: number): string =>
	`${FAMILY.todosRow}${index}`;
export const askQuestionID = (index: number, total: number): string =>
	`${FAMILY.askQuestion}${index}-of-${total}`;
export const askOptionID = (index: number): string =>
	`${FAMILY.askOption}${index}`;

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
