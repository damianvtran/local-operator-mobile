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
	/* Accessibility roles this slice renders. `button` is in the ARIA set and
	 *  is what a Pressable that acts as one must announce. */
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
	sessions: "sessions-screen",
	session: "session-screen",
	subagent: "subagent-screen",
	past: "past-sessions-screen",
	newSession: "new-session-screen",
	settings: "settings-screen",
	notFound: "not-found-screen",
	ownTunnel: "own-tunnel-screen",
} as const;

/**
 * The empty state each screen renders while its real content does not exist yet.
 * One per screen and named after it, so a flow asserting "this screen is honestly
 * empty" cannot be satisfied by another screen's empty state.
 */
export const EMPTY = {
	sessions: "sessions-empty",
	session: "session-empty",
	subagent: "subagent-empty",
	past: "past-empty",
	notFound: "not-found-empty",
} as const;

/**
 * Interactive controls: one identifier per control a flow has to reach, named
 * `<screen-or-surface>-<what it does>`.
 *
 * There is deliberately NO generic entry (`button`, `input`, `list-row`). The
 * interactive primitives (`Button`, `IconButton`, `Input`, `Textarea`, `Chip`,
 * `ListRow`, `Segmented`, `Banner`) and an empty state's action take `testID` as a
 * REQUIRED prop, so a screen with two buttons cannot fall back to two identical
 * `"button"` identifiers — Maestro's `id:` matching would then pick one
 * arbitrarily, and the failure reads as a flaky flow rather than a naming mistake.
 * A control gets its name here in the same change that renders it; a control whose
 * identity is data (a row, a per-computer status) uses the `<role>-<id>` shape and
 * is declared as a family in `IDENTIFIER_FAMILIES` below.
 *
 * ONE vocabulary is shared by the app and the flows. The names the Maestro flows
 * in `e2e/maestro/**` press are declared here under their own comment, and
 * `a11y.e2e.test.ts` walks `app/**`, `src/ui/**` and `src/features/**` to check
 * both directions: every declared identifier is rendered by something, and no
 * identifier is typed as a literal where a constant exists.
 */
export const CONTROL = {
	// Welcome and Sessions: the two shell routes that render an action.
	sessionsNew: "sessions-new",
	notFoundHome: "not-found-home",

	// The back affordance each pushed screen puts in its header. Named per screen
	// because two screens are on the navigation stack at once during a transition.
	sessionBack: "session-back",
	subagentBack: "subagent-back",

	// Settings: the theme override, the one setting that needs no connection.

	// Overlays. Only one sheet, one dialog and one toast can be up at a time (the
	// z ladder allows no more), so their parts are unambiguous without a
	// discriminator; the surface itself is named by whichever screen opens it.
	sheetClose: "sheet-close",
	sheetScrim: "sheet-scrim",
	dialogConfirm: "dialog-confirm",
	dialogCancel: "dialog-cancel",
	dialogScrim: "dialog-scrim",
	toast: "toast",

	/* --- added by the wave-2 screen slice (D1): the auth, tunnel and list
	 * controls it renders. Additive — main's names above are untouched, because the
	 * Maestro flows in `e2e/maestro/**` reference the ones below. --- */
	sessionsPastInHeader: "sessions-past-in-header",
	sessionsComputersInHeader: "sessions-computers-in-header",
	sessionsPast: "sessions-past",
	signInStart: "sign-in-start",

	// The identifiers `e2e/maestro/flows/**` presses. They are the contract with
	// the native flow set: a rename here without a rename there is a flow that
	// silently stops reaching its control.
	welcomeConnect: "welcome-connect",
	welcomeCustomUrl: "welcome-custom-url",
	/** The two paths on the computer screen: Radient (recommended) and the
	 *  reader's own tunnel. Distinct identifiers because a flow that walks the
	 *  self-hosted path must not be able to pass by pressing the Radient one. */
	radientPath: "tunnel-path-radient",
	ownTunnelPath: "tunnel-path-own",
	ownTunnelPathAction: "tunnel-path-own-action",
	ownTunnelTest: "own-tunnel-test",
	settingsTunnelEdit: "settings-tunnel-edit",
	settingsTunnelTest: "settings-tunnel-test",
	settingsTunnelRemove: "settings-tunnel-remove",
	customUrlField: "custom-url-field",
	customPasswordField: "custom-password-field",
	customConnect: "custom-connect",
	customInsecureOptIn: "custom-insecure-opt-in",
	/** The list's two header controls: the computer switcher and Settings. */
	computersButton: "computers-button",
	settingsButton: "settings-button",
	sessionSearchButton: "session-search-button",
	sessionSearchField: "session-search-field",
	/** Set on the chosen computer row, so "which one is active" is asserted as a
	 *  state rather than inferred from a colour. */
	computerSelectedMarker: "computer-selected-marker",

	settingsSignOut: "settings-sign-out",
	settingsThemeDark: "settings-theme-dark",
	settingsThemeLight: "settings-theme-light",
	settingsThemeSystem: "settings-theme-system",
	settingsTextScale100: "settings-text-scale-100",
	settingsTextScale150: "settings-text-scale-150",
	settingsTextScale200: "settings-text-scale-200",
	settingsTextScaleSystem: "settings-text-scale-system",
	settingsDeleteAccount: "settings-delete-account",

	/* --- the controls this slice's screens render, named one at a time: two
	 * controls on one screen must not share an identifier (Maestro's `id:` matching
	 * would pick arbitrarily), and `e2e/maestro/**` addresses the flow vocabulary
	 * declared above. --- */
	setupUseThisComputer: "setup-use-this-computer",
	newSessionCreate: "new-session-create",
	computersRetryAction: "computers-retry-action",
	settingsThemeGroup: "settings-theme-group",
	computersBanner: "computers-banner",
	sessionsClearSearchAction: "sessions-clear-search-action",
	sessionsConnectAction: "sessions-connect-action",
	sessionsNewAction: "sessions-new-action",
	pastSearchClear: "past-search-clear",
	splitPaneStart: "split-pane-start",
	splitPaneEnd: "split-pane-end",
	splitBody: "split-body",
	sessionsDetailColumn: "sessions-detail-column",
	/* --- the list, past-list and new-session controls the flows address. --- */
	newSessionCwd: "new-session-cwd",
	newSessionModel: "new-session-model",
	newSessionModelDefault: "new-session-model-default",
	newSessionPrompt: "new-session-prompt",
	newSessionStart: "new-session-start",
	sessionsSplit: "sessions-split",
	sessionsFooter: "sessions-footer",
	sessionsNoRoute: "sessions-no-route",

	computersUseThisComputer: "computers-use-this-computer",
	computersStartAgain: "computers-start-again",
	computersBack: "computers-back",
	computersRefresh: "computers-refresh",
	ownTunnelBack: "own-tunnel-back",
	setupCreateTunnel: "setup-create-tunnel",
	setupTunnelId: "setup-tunnel-id",
	signInTryAgain: "sign-in-try-again",
	signInUseAddress: "sign-in-use-address",
	signInTryAnyway: "sign-in-try-anyway",
	signInBack: "sign-in-back",
	newSessionBack: "new-session-back",
	newSessionHomeChip: "new-session-home-chip",
	newSessionPathChip: "new-session-path-chip",
	pastBack: "past-back",
	pastSearchField: "past-search-field",
	pastSearch: "past-search",
	pastRetry: "past-retry",
	pastBackToSessions: "past-back-to-sessions",
	sessionsDegradedBanner: "sessions-degraded-banner",
	sessionsComputers: "sessions-computers",
	sessionOpenCurrent: "session-open-current",
	sessionOpenPrevious: "session-open-previous",
	settingsTunnelCancel: "settings-tunnel-cancel",
	settingsBack: "settings-back",
	settingsUseComputer: "settings-use-computer",
	settingsRefresh: "settings-refresh",
	settingsAddComputer: "settings-add-computer",
	settingsTextScaleGroup: "settings-text-scale-group",
	settingsRetryLastAction: "settings-retry-last-action",
	refusalSignIn: "refusal-sign-in",
	refusalRetry: "refusal-retry",
	refusalAnotherAddress: "refusal-another-address",
	/* --- the controls this slice's screens render, named one by one. A screen with
	 * two controls cannot share an identifier: Maestro's `id:` matching would pick one
	 * arbitrarily and the failure would read as a flaky flow. --- */

	/* --- the session view (stream D2), adopted into the shared vocabulary.
	 *
	 * Named and declared here so one file owns the contract: these are the names the
	 * session view's screens, composer, cards and panels render, and the names its
	 * Maestro flows select. Without them in the one vocabulary the two halves of the
	 * check in `a11y.e2e.test.ts` have nothing to agree about. --- */
	composerSend: "composer-send",
	composerStop: "composer-stop",
	composerAttach: "composer-attach",
	composerResume: "composer-resume",
	composerInput: "composer-input",
	composerRetry: "composer-retry",
	composerModelChip: "composer-model-chip",
	composerEffortChip: "composer-effort-chip",
	slashFilter: "slash-filter",
	pendingApprove: "pending-approve",
	pendingDeny: "pending-deny",
	pendingRemember: "pending-remember",
	pendingAskSubmit: "pending-ask-submit",
	todosDisclosure: "todos-disclosure",
	subagentsDisclosure: "subagents-disclosure",
	/** The session header's subagents lever, which OPENS the roster panel.
	 *  Deliberately not `subagentsDisclosure`: that one is the panel's own header
	 *  toggle and collapses what this one opened, so the two are different
	 *  controls on different surfaces and a flow reaching for one must not be able
	 *  to land on the other. */
	sessionSubagents: "session-subagents-chip",
	connectionRetry: "connection-retry",
	connectionSignIn: "connection-sign-in",
	connectionConsole: "connection-console",
	codeBlockCopy: "code-block-copy",
} as const;

/**
 * Surfaces a flow asserts rather than presses.
 *
 * A `CONTROL` is something a reader acts on; a `SURFACE` is something a flow must
 * see EXIST — the transcript region, the composer's receipt, the one banner that
 * says which connection state the app is in. Keeping them apart is what stops the
 * vocabulary from filling with names nobody can press, and it lets the flows assert
 * a state ("the certificate was rejected") without inventing a control for it.
 */
export const SURFACE = {
	sessionTranscript: "session-transcript",
	sessionComposer: "session-composer",
	sessionColumn: "session-column",
	sessionContext: "session-context",
	sessionLoading: "session-loading",
	sessionTranscriptEmpty: "session-transcript-empty",
	sessionWorkingLine: "session-working-line",
	composerNotice: "composer-notice",
	composerError: "composer-error",
	composerRetained: "composer-retained",
	composerReceipt: "composer-receipt",
	composerDisabledReason: "composer-disabled-reason",
	queuedMessageChip: "queued-message-chip",
	connectionBanner: "connection-banner",
	connectionWaiting: "connection-waiting",
	connectionClearsByItself: "connection-clears-by-itself",
	connectionCertificateRejected: "connection-certificate-rejected",
	connectionHostUnresolved: "connection-host-unresolved",
	connectionComputerOffline: "connection-computer-offline",
	connectionMachineRemedy: "connection-machine-remedy",
	connectionRelayNotInstalled: "connection-relay-not-installed",
	connectionTunnelUnavailable: "connection-tunnel-unavailable",
	modelSheet: "model-sheet",
	effortSheet: "effort-sheet",
	slashSheet: "slash-sheet",
	todosPanel: "todos-panel",
	todosBody: "todos-body",
	subagentsPanel: "subagents-panel",
	subagentsBody: "subagents-body",
	subagentRunning: "subagent-running",
	pendingCardBody: "pending-card-body",
	pendingCardDetail: "pending-card-detail",
	pendingCardDestructiveMarker: "pending-card-destructive-marker",
	pendingCardAnswer: "pending-card-answer",
	pendingCardError: "pending-card-error",
	transcriptStreaming: "transcript-streaming",

	/* --- the subagent detail route (stream D2), adopted with the session view's
	 * vocabulary above. The drill-down flow asserts these by name
	 * (`e2e/maestro/flows/06-subagent-drilldown.yaml`), so without them in the one
	 * contract the flow's steps would have nothing to be checked against. --- */
	subagentCrumb: "subagent-detail-crumb",
	subagentError: "subagent-detail-error",
	subagentLoading: "subagent-detail-loading",
	subagentPrompt: "subagent-detail-prompt",
	subagentTodos: "subagent-detail-todos",
	subagentTranscript: "subagent-detail-transcript",

	/* The three surfaces whose components carry a DEFAULT identifier rather than
	/* taking one from a caller: a literal default is a second spelling of an id the
	/* flows select, which is exactly what the contract exists to prevent. */
	connectionPill: "connection-pill",
	refusalSurface: "connection-refusal",
	signInPanel: "sign-in-panel",
} as const;

/**
 * Families of parameterised identifiers, declared as their literal prefix
 * (`"session-row-"` for `session-row-<id>`).
 *
 * A family is added in the same change as the control that carries it, and the
 * session view's ten arrived with its vocabulary above — so this list is no longer
 * the shell's two or three, and a name that appears here without a builder or a
 * renderer is the drift the families exist to prevent.
 */
export const IDENTIFIER_FAMILIES: readonly string[] = [
	/* The wave-2 slice's parameterised identifiers: one row per session or
	 * computer, one copy action per command block. Declared in the same change as
	 * the controls that carry them, which is what this list's own note asks for. */
	"session-row-",
	"past-row-",
	"computer-row-",
	"computer-row-status-",
	"computer-row-reachability-",
	"tunnel-copy-",
	"session-empty-",
	"command-",
	/* The session view's own parameterised identifiers, adopted with its block above. */
	"transcript-row-",
	"transcript-image-",
	"model-option-",
	"effort-rung-",
	"slash-command-",
	"composer-attachment-",
	"subagent-chip-",
	"todos-row-",
	"ask-question-",
	"ask-option-",
];

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

/**` asserts, and every
 * one of them is a place the flows and this file must agree.
 */
export const REGION = {
	sessionsList: "session-list",
	sessionSectionActive: "session-section-active",
	sessionSectionPrevious: "session-section-previous",
	/** Marks a search hit that matched the conversation's BODY rather than its
	 *  title: `docs/relay/contract.md` §3.3, and the reason a result can be a
	 *  legitimate match with a title that does not contain the query. */
	searchBodyMatch: "search-result-body-match-marker",

	computersList: "computers-list",

	/** The system-browser hand-off, asserted instead of the browser itself:
	 *  Maestro cannot drive a system browser (`docs/adr/0003` §"What the harness
	 *  is not"), so the flow asserts the app HANDED OFF rather than that the user
	 *  signed in. */
	signInHandoff: "sign-in-browser-handoff",
	welcomeHeadline: "welcome-headline",

	settingsConnection: "settings-section-connection",
	settingsAppearance: "settings-section-appearance",
	settingsDiagnostics: "settings-section-diagnostics",

	/** The refusal surfaces (`docs/ux/flows.md` § 9, C5/C6/C7). Each id names a
	 *  CAUSE the flow asserts by name, so a control or a sentence that goes missing
	 *  is caught rather than diffed by eye — and so a surface cannot quietly start
	 *  offering "sign in again" for a machine-side problem. */
	connectionErrorComputerOffline: "connection-error-computer-offline",
	connectionErrorMachineRemedy: "connection-error-machine-remedy",
	connectionErrorTunnelUnavailable: "connection-error-tunnel-unavailable",
	connectionErrorConsoleLink: "connection-error-console-link",
	connectionErrorSignIn: "connection-error-sign-in",
	connectionErrorWaiting: "connection-error-waiting",
	connectionErrorClearsByItself: "connection-error-clears-by-itself",
	connectionErrorRelayNotInstalled: "connection-error-relay-not-installed",
	connectionErrorCertificate: "connection-error-certificate",
	connectionErrorHostUnresolved: "connection-error-host-unresolved",
	connectionErrorRetryProminent: "connection-error-retry-prominent",
} as const;

/**
 * The states a screen AFFIRMS, in the `<subject>-<state>` shape the design audit
 * reads.
 *
 * The identifier groups above answer "can a flow reach this element". A state marker
 * answers a different question the visual audit asks cell by cell: a cell declares
 * `<screen>/<state>`, and the frame is only EVIDENCE for that state if the app leaves
 * an affirmative marker behind saying so (`docs/e2e/README.md`, and
 * `tools/lib/readiness.ts`'s `requiredStateMarker`). A rule that could only say what a
 * page is *not* was satisfied by a page that was nothing in particular — measured — so
 * the marker has to be positive and named.
 *
 * One marker per state, `<subject>` being the screen's own testid subject (`session`,
 * `composer`): `STATE_MARKER.sessionPendingApproval` → `session-pending-approval`. The whole
 * point of declaring them HERE is that the harness imports this file rather than
 * re-deriving the names, so there is one vocabulary and not two — the failure mode
 * `a11y.e2e.test.ts` exists to prevent, one layer down.
 *
 * Two of the session view's states are already declared as surfaces — `session-loading`
 * (`SURFACE.sessionLoading`) and `session-empty` (`EMPTY.session`) — so they are NOT
 * repeated here: two constants for one id is the duplicate a `IDENTIFIERS` set cannot
 * carry, and the states that were missing are the ones below.
 */
export const STATE_MARKER = {
	/* The session view's own states, all of them derivable from what the runtime
	 * reports (`src/features/session/state-marker.ts`). */
	sessionIdle: "session-idle",
	sessionPopulated: "session-populated",
	sessionStreaming: "session-streaming",
	sessionEnded: "session-ended",
	sessionError: "session-error",
	sessionPendingApproval: "session-pending-approval",
	sessionPendingAsk: "session-pending-ask",
	sessionSubagents: "session-subagents",

	/* The composer's own states. Its ALERT slots are already surfaces
	 * (`composer-notice`, `composer-error`, `composer-retained`); these are the primary
	 * control's, which is the one control that morphs (`composer.ts` § composerControls). */
	composerIdle: "composer-idle",
	composerSteering: "composer-steering",
	composerSending: "composer-sending",
	composerEnded: "composer-ended",
} as const;

/**
 * Every static identifier the app can render, flat, as a Node script reads it.
 *
 * This file is the single source of truth for the identifier contract, and it is
 * plain TypeScript with NO imports on purpose: `node src/ui/a11y.ts` can load it
 * through type stripping without React Native, the path alias or a bundler. The
 * end-to-end flows (`e2e/maestro/**`) are YAML that must follow these names, never
 * the reverse, and the check that they do lives in `a11y.e2e.test.ts`.
 *
 * `REGION` is in the set because a region a flow WAITS ON is a selector exactly as a
 * control it presses is: the flows assert `session-section-active`, the refusal
 * surfaces and `settings-section-*` by name, and leaving them out let a flow name an
 * id this contract could not see — the flow check then read a surface assertion as an
 * unknown selector. Declared last because `Object.values` needs the binding
 * initialised, and each one is rendered (`a11y.e2e.test.ts` proves it), so the set
 * stays honest rather than aspirational.
 *
 * `STATE_MARKER` joins them for the same reason `REGION` did: a state marker is a
 * `data-testid` in the DOM that the audit selects by name, so it is a selector in
 * every way that matters, and leaving it out would let the harness and the flows name
 * a marker this contract could not see.
 */
export const IDENTIFIERS: readonly string[] = [
	...Object.values(SCREEN),
	...Object.values(EMPTY),
	...Object.values(CONTROL),
	...Object.values(SURFACE),
	...Object.values(REGION),
	...Object.values(STATE_MARKER),
];

/** A row's identifier, derived from the id it carries so a flow can address one
 *  row without the screen inventing a second naming scheme. */
export const sessionRowId = (sessionId: string): string =>
	`session-row-${sessionId}`;

/**
 * The two facts a computer row states separately, on purpose.
 *
 * `status` is what the control plane thinks (the tunnel is provisioned) and
 * `reachability` is what the phone measured (the host answered). `active` means
 * the cloud route exists, never that the machine is awake, so a screen that
 * shows one as the other is the defect the split exists to prevent.
 */
/**
 * The copy action for one command block, named by the step's label.
 *
 * A function rather than a fixed list because the steps are data
 * (`features/auth/tunnel-commands.ts`): adding a provider is adding a row, and
 * an identifier per row keeps "copy the Cloudflare command" assertable without
 * counting blocks on the screen.
 */
/** The row identifier for one past session, so the prefix lives in the contract
 *  rather than in a template literal at the call site (the e2e check reads this
 *  file for every name a flow may use). */
export const pastRowId = (sessionId: string): string => `past-row-${sessionId}`;

/** The copy action for one command block, by the step's label — declared here so the
 *  builder lives with the vocabulary rather than being spelled at the call site
 *  (`command-block.tsx` had `` `command-${label}` `` inline, a second copy of an
 *  identifier the flows select). */
export const commandCopyId = (label: string): string =>
	`command-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export const tunnelCommandCopyId = (label: string): string =>
	`tunnel-copy-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export const computerRowIds = (
	hostname: string,
): { row: string; status: string; reachability: string } => ({
	row: `computer-row-${hostname}`,
	status: `computer-row-status-${hostname}`,
	reachability: `computer-row-reachability-${hostname}`,
});

/* --- the session view's builders (stream D2), adopted with its vocabulary above.
 *
 * Each one is here for the reason `sessionRowId` is: a `testID` whose value is a
 * template is read as a literal by the identifier check, so a prefix spelled at the
 * call site would drift from `IDENTIFIER_FAMILIES` the moment nobody looked. The
 * row ids are data (a projection's entry id, a job id), which is why they cannot be
 * a fixed list.
 */

/** One transcript row. The row's own id is the projection's entry id. */
export const transcriptRowId = (rowId: string): string =>
	`transcript-row-${rowId}`;

/** One image inside a transcript row, disambiguated by its index within the row. */
export const transcriptImageId = (entryId: string, index: number): string =>
	`transcript-image-${entryId}-${index}`;

/** One model in the model sheet. */
export const modelOptionId = (modelId: string): string =>
	`model-option-${modelId}`;

/** One rung of the effort ladder. */
export const effortRungId = (rung: string): string => `effort-rung-${rung}`;

/** One command in the slash sheet. */
export const slashCommandId = (name: string): string => `slash-command-${name}`;

/** One attached image in the composer, by its position. */
export const composerAttachmentId = (index: number): string =>
	`composer-attachment-${index}`;

/** One row of the subagents panel, keyed by the job it reports on. */
export const subagentChipId = (jobId: string): string =>
	`subagent-chip-${jobId}`;

/** One row of the todos panel, by its position in the list. */
export const todosRowId = (index: number): string => `todos-row-${index}`;

/** One question of a multi-question ask: `ask-question-<n>-of-<total>`. */
export const askQuestionId = (index: number, total: number): string =>
	`ask-question-${index}-of-${total}`;

/** One answer option of an ask, by its position among the offered options. */
export const askOptionId = (index: number): string => `ask-option-${index}`;
