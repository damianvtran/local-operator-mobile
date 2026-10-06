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
	/* A polite live region. Spelled through the `role` prop, not `accessibilityRole`:
	 *  React Native's `AccessibilityRole` union has no `status` (its ARIA-shaped `Role`
	 *  type does), and react-native-web passes an unmapped role straight through to
	 *  the DOM. The composer's dictation states are announced from one, never only
	 *  shown (design §2.5 / round 1 D3). */
	status: "status",
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
	/** `/` is the composer home (the ADR 0006 § 6 default destination). The
	 *  sessions list keeps `sessions` — it still renders as the conversations
	 *  panel's route/root, so the harness's S4 relabel does not orphan it. */
	home: "home-screen",
	subagent: "subagent-screen",
	past: "past-sessions-screen",
	/** The projects list (S16) and its pushed detail. Two roots, because the detail
	 *  is a route of its own — the app pushes it — rather than a panel inside the
	 *  list, and a capture must be able to tell which of the two drew. */
	projects: "projects-screen",
	projectDetail: "project-detail-screen",
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
	/** The projects list with nothing in it. Its own id, so "this screen is
	 *  honestly empty" cannot be satisfied by another screen's empty state. */
	projects: "projects-empty",
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
	// Welcome: the shell route that renders an action.
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
	/** The computer switcher (the home header's name, and the panel's own row —
	 *  two controls, two ids: `computersButton` here and `sidebarSwitcher`). */
	computersButton: "computers-button",
	settingsButton: "settings-button",
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
	/* --- the list, past-list and new-session controls the flows address. --- */
	newSessionCwd: "new-session-cwd",
	newSessionModel: "new-session-model",
	newSessionModelDefault: "new-session-model-default",
	newSessionPrompt: "new-session-prompt",
	newSessionStart: "new-session-start",
	sessionsSplit: "sessions-split",
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
	sessionOpenCurrent: "session-open-current",
	sessionOpenPrevious: "session-open-previous",
	/* --- the queued-ask surfaces (E2, design §4/§5.0). The sheet's controls are
	 *  named one at a time like every other surface's.
	 *
	 *  No `asksOpen` yet: its only renderer was the old list screen this branch
	 *  deleted, and the panel's outstanding-ask indicator is the ask lane's to
	 *  wire (`spec-home-sidebar.md` §10 — "`SURFACE.sidebar` is where an
	 *  outstanding-ask count belongs (E2) … Not this PR"). Dropped rather than
	 *  kept as a rendererless selector, because the enumerating check in
	 *  `a11y.e2e.test.ts` refuses an identifier no route or primitive paints;
	 *  E2 re-declares it WITH its renderer when the indicator lands. --- */
	askRespond: "ask-respond",
	askDecline: "ask-decline",
	askDismiss: "ask-dismiss",
	askOpenConversation: "ask-open-conversation",
	settingsTunnelCancel: "settings-tunnel-cancel",
	settingsBack: "settings-back",
	settingsUseComputer: "settings-use-computer",
	settingsRefresh: "settings-refresh",
	settingsAddComputer: "settings-add-computer",
	settingsTextScaleGroup: "settings-text-scale-group",
	settingsRetryLastAction: "settings-retry-last-action",
	settingsNotificationsEnable: "settings-notifications-enable",
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
	composerMic: "composer-mic",
	/** The recording bar's own cancel: DISCARDS the take and sends no request,
	 *  unlike the mic, which stops and transcribes. Two outcomes, two controls. */
	composerDictationCancel: "composer-dictation-cancel",
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

	/* --- the composer home and the conversations panel (the Part 2 slice).
	 *
	 * Named here in the same change that renders them. Two deliberate pairs of
	 * near-neighbours, each split for the same reason — two controls can be on
	 * screen at once (the panel is an overlay over the home), and a shared id
	 * makes Maestro's `id:` matching pick arbitrarily:
	 *  - `computersButton` is the HOME header's switcher (the landing's, where a
	 *    flow meets it first); `sidebarSwitcher` is the panel's own row.
	 *  - `sidebarClose` is the panel's visible close. The scrim and Android back
	 *    close the panel too but carry no id: neither is a control a flow should
	 *    press by name while the panel's own close is present. --- */

	/** The home header's sidebar affordance: opens the conversations panel. */
	homeSidebar: "home-sidebar",
	/** The home composer's folder chip: the session's target folder. */
	homeTargetFolder: "home-target-folder",
	/** The home's offline action "Connect a computer", in the suggestions' slot. */
	homeConnect: "home-connect",
	/** The home's folders-read failure line and its remedy (review M2): the
	 *  sentence `/new` uses for the same failure, with the retry the home lacked. */
	homeFoldersBanner: "home-folders-banner",
	homeFoldersRetry: "home-folders-retry",
	sidebarSwitcher: "sidebar-switcher",
	sidebarNewChat: "sidebar-new-chat",
	sidebarSearch: "sidebar-search",
	sidebarSearchField: "sidebar-search-field",
	sidebarClose: "sidebar-close",
	sidebarPast: "sidebar-past",
	sidebarComputers: "sidebar-computers",
	/** The footer's third route (S16's entry point): `docs/ux/flows.md` draws the
	 *  projects surface as a peer of `past` off the conversations panel, so it
	 *  lives in the same footer rather than behind a settings row. */
	sidebarProjects: "sidebar-projects",
	/** The projects list's own controls (S16). Read-only in this build: the list
	 *  and the pushed detail have a retry and a back, and NO mutation control —
	 *  a row pushes, it does not create, edit or delete. */
	projectsBack: "projects-back",
	projectsRetry: "projects-retry",
	projectDetailBack: "project-detail-back",
	projectDetailRetry: "project-detail-retry",
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
	projectsLoading: "projects-loading",
	/** The list's unknown-status section. Its own id because the state it proves
	 *  is the ABSENCE of a status from `PROJECT_STATUS_ORDER` — a section that
	 *  only exists because a newer relay invented a status this build does not
	 *  know, and which must be visible rather than silently dropped. */
	projectsUnknownStatus: "projects-unknown-status",
	projectDetailLoading: "project-detail-loading",
	/** The composed detail's linked-session list — the region a flow asserts
	 *  rather than a control it presses, the same shape as `sidebarList`. */
	projectLinks: "project-links",
	/** The daemon's own refusal sentence on a project read, in an `Alert`.
	 *  Deliberately NOT a `RefusalSurface`: that component's taxonomy is the
	 *  CONNECTION's (`src/relay/errors.ts` `ErrorSurface`), and a `404
	 *  project_not_found` is a definitive answer from a reachable relay rather
	 *  than a connection that could not be made. Copy that claimed "that project
	 *  is not answering" for a project the daemon says does not exist would send
	 *  the reader to check a machine that is working. */
	projectRefusal: "project-refusal",
	/** The same refusal on the pushed DETAIL — a second id rather than the list's,
	 *  because the marker table may MAP a state onto a declared id but must not
	 *  name one id twice (`src/ui/a11y.test.ts`): two states claiming one frame is
	 *  how "the refusal is on screen" stops meaning which surface it is on. */
	projectDetailRefusal: "project-detail-refusal",
	sessionTranscript: "session-transcript",
	sessionComposer: "session-composer",
	sessionColumn: "session-column",
	sessionContext: "session-context",
	sessionLoading: "session-loading",
	sessionTranscriptEmpty: "session-transcript-empty",
	sessionWorkingLine: "session-working-line",
	/* --- the markdown table (design pass `fix/hero-tables-strips` §1.4–§1.6).
	 *  The wrapper, its scrolling viewport and the fade are what U-38/U-40
	 *  address by name; the two row ids and the cell id are what let U-38 count
	 *  a table's rows and U-39 measure each cell's tokens. These are surfaces,
	 *  not markers: they are present in every frame that draws a table, which is
	 *  exactly what makes them anchorable. --- */
	mdTable: "md-table",
	mdTableScroll: "md-table-scroll",
	mdTableScrollCue: "md-table-scroll-cue",
	mdTableHead: "md-table-head",
	mdTableRow: "md-table-row",
	mdTableCell: "md-table-cell",
	composerNotice: "composer-notice",
	composerDictationTimer: "composer-dictation-timer",
	composerDictationStatus: "composer-dictation-status",
	/** The composer-spanning recording bar, and the level meter inside it. */
	composerDictationBar: "composer-dictation-bar",
	composerDictationMeter: "composer-dictation-meter",
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
	pendingCard: "pending-card",
	pendingCardBody: "pending-card-body",
	pendingCardDetail: "pending-card-detail",
	pendingCardDestructiveMarker: "pending-card-destructive-marker",
	pendingCardAnswer: "pending-card-answer",
	pendingCardError: "pending-card-error",
	askCard: "ask-card",
	/* --- the queued-ask surfaces: the minimized bar, the sheet's states, and the
	 *  two transcript cards a settled ask leaves behind. --- */
	askBar: "ask-bar",
	asksSheet: "asks-sheet",
	asksSheetBody: "asks-sheet-body",
	asksSheetLoading: "asks-sheet-loading",
	asksSheetEmpty: "asks-sheet-empty",
	asksSheetError: "asks-sheet-error",
	askResponseCard: "ask-response-card",
	askTimeoutCard: "ask-timeout-card",
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
	/** The detail route's status badge. Named here in the same change that renders
	 *  it: the badge used to carry a literal, and the running state it used to
	 *  switch to is `subagentRunning` below. */
	subagentStatus: "subagent-detail-status",

	/* The three surfaces whose components carry a DEFAULT identifier rather than
	 * taking one from a caller: a literal default is a second spelling of an id the
	 * flows select, which is exactly what the contract exists to prevent. */
	connectionPill: "connection-pill",
	refusalSurface: "connection-refusal",
	signInPanel: "sign-in-panel",

	/* --- the composer home (ADR 0006 § 6) and the conversations panel. The
	 * splash's pieces each carry an id because the design round captures them
	 * separately and a state marker must be present in ONLY the state it names
	 * (`homeStarting` IS the sending marker — see STATE_MARKER.home). --- */
	homeComposer: "home-composer",
	homeSplash: "home-splash",
	homeGreeting: "home-greeting",
	homeSuggestions: "home-suggestions",
	homeTip: "home-tip",
	homeStarting: "home-starting",
	sidebar: "conversations-sidebar",
	/** The deep-link failure's one honest sentence (ADR 0006 § 6.6): the
	 *  `/conversations` route reads it from a `notice` param and hands it to the
	 *  pane, which renders it under the panel's header — that route is the
	 *  deep-link-to-nothing destination's landing. */
	sidebarNotice: "sidebar-notice",
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
	"turn-bar-",
	"completion-anchor-",
	"transcript-image-",
	"model-option-",
	"effort-rung-",
	"slash-command-",
	"composer-attachment-",
	"subagent-chip-",
	"todos-row-",
	"ask-question-",
	"ask-option-",
	/* The queued-ask surfaces' parameterised identifiers (E2): one row per ask,
	 *  one count chip per session row, one field per question. */
	"ask-row-",
	"asks-badge-",
	"ask-field-",
	/* The projects listing's own row family (S16): one row per project, keyed by
	 *  the project's id, so a flow reaches a row without counting rows. */
	"project-row-",
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
	/** The conversations panel's list and its sections. `session-section-active`
	 *  and `session-section-previous` retired WITH the list's move into the panel:
	 *  the panel's vocabulary is the desktop's (Pinned · Running · Today · This
	 *  week · Older), and the two spellings cannot both be true of one list.
	 *  `e2e/maestro/**` and this contract moved together — a rename here without
	 *  the flows is a flow that silently stops reaching its control. */
	sidebarList: "conversations-list",
	sidebarSectionPinned: "sidebar-section-pinned",
	sidebarSectionRunning: "sidebar-section-running",
	sidebarSectionToday: "sidebar-section-today",
	sidebarSectionWeek: "sidebar-section-week",
	sidebarSectionOlder: "sidebar-section-older",
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
	/** Notifications: the permission state and the honest machine line
	 *  (ADR 0006 §2.4, §5). The marker is the section's own region id so the
	 *  capture can assert the section rendered. */
	settingsNotifications: "settings-section-notifications",

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
 * The id the app renders when a surface is in a NAMED state, keyed
 * `<subject>` → `<state>` → id.
 *
 * Why this lives here rather than in the audit harness: deciding whether a captured
 * frame is EVIDENCE for the state it declares means knowing which id the app leaves
 * behind in that state, and a table of those names kept in `tools/` is a second
 * vocabulary beside the app's. The harness IMPORTS this table (`stateMarkerFor` and
 * `markerMatches` below are its only readers, in `tools/lib/readiness.ts` and the
 * mock relay's own verify) and keeps the cell vocabulary — `S5` is the matrix's
 * language, never the app's.
 *
 * **The key is `(subject, state)`, not the state alone.** Two screens can be in a
 * state of the same name — `populated` on the list and `populated` on the session —
 * and a flat table cannot tell them apart, which is how a marker for one screen
 * satisfies a cell on another. The subjects are the app's own screens and surfaces
 * (`sessions`, `past`, `computers`, `session`, `composer`; the harness's
 * `SCREEN_MARKER_SUBJECT` maps each cell onto one of them).
 *
 * Two rules for an entry, and both are load-bearing:
 *
 *  - a marker must be present in ONLY the state it names. A screen root, a
 *    container or a header control is on screen in every state, so declaring one
 *    makes the affirmative check vacuous. Every value below was read out of the
 *    rendered DOM of the state it names AND of its neighbours.
 *  - a value that ends in `-` is a FAMILY PREFIX: it is satisfied by any id that
 *    starts with it (`session-row-` is "the list has at least one row", which is
 *    exactly the claim `populated` makes).
 *
 * A state with NO entry is a DECLARED GAP, not a name to invent: the app paints
 * nothing that affirms it, and the harness reports the cell as not measurable by name
 * rather than accepting a frame that could not say.
 *
 * `session.loading` and `session.empty` are declared, and neither id is spelled the way
 * a reader would guess (QA round 6, Q1). A CONNECTED session that has not answered yet
 * paints the skeleton (`session-loading`) and one that has answered with no rows paints
 * the transcript's own empty state (`session-transcript-empty`) — `EMPTY.session`
 * (`session-empty`) is the NOT-connected branch and is never what a relay-backed cell
 * shows. So the cell's marker is the id a connected frame really carries, which is the
 * whole point of the table being the app's: `S5/empty` declaring `session-empty` would
 * have blamed the app's DOM for a name the harness picked.
 *
 * **`session/empty` is the weakest claim in this table, and that is recorded rather
 * than implied** (review round 7, R7-3): a REFUSED session also renders an empty
 * transcript, so a frame the relay refused carries `session-transcript-empty` too —
 * measured on this branch, where an unauthenticated capture of `S5/error` carried
 * exactly that id. The cell is therefore satisfied by a frame that is empty for the
 * wrong reason. Strengthening it needs a SECOND, connection-scoped id that only a
 * connected-empty session paints — which is a session-view change, not a table entry:
 * the table can only name one id per state, and the two states share this one.
 *
 * `composer-*` makes nothing measurable today: no harness cell maps to a `composer`
 * subject (`SCREEN_MARKER_SUBJECT` maps S5/S8/S9 to `session`). It is declared because
 * the composer's state has to be named somewhere and this file is where ids live; the
 * session-level rendering of the one that DOES have a cell is `session/queued`.
 *
 * `session/idle` and `session/ended` are the same case one subject over: both are real
 * states of the screen and both are rendered, and NO cell in PR #25's matrix declares
 * either, so neither makes anything measurable today (checked against its
 * `PENDING_CELLS` list: the session cells are loading, populated, populated-long,
 * scroll, empty, streaming, aborted, queued, pending-approval, pending-ask, rich-rows,
 * subagents, degraded, error). They stay declared because a missing state name is how
 * the next cell acquires a second dialect.
 */
/* `as const satisfies` rather than a wide annotation: the app's own reads
 * (`STATE_MARKER.session.populated` in `state-markers.tsx`) then cannot be
 * `undefined`, which is what `noUncheckedIndexedAccess` reports for a table declared
 * `Record<string, …>`. The harness still looks a cell's subject up by an arbitrary
 * string, so `stateMarkerFor` is the one place that widens it. */
export const STATE_MARKER = {
	/* The old `sessions` subject retired with the list's move into the panel: its
	 * three entries (`EMPTY.sessions`, `"session-row-"`, the degraded banner) are
	 * now the `sidebar` subject's, and keeping both spellings of the same id would
	 * trip the marker table's own uniqueness rule (`a11y.test.ts`: an id named
	 * twice makes two states claim one frame). `sessionRowId` and the
	 * `session-row-` family are unchanged — one list, one family. */
	past: {
		empty: EMPTY.past,
		populated: "past-row-",
	},
	/* The projects list and its pushed detail (S16). `populated` is the row family
	 *  (`projectRowId`), which is what "the list drew rows" means. `refused` is the
	 *  daemon's own refusal sentence — the state the mock relay drives with a real
	 *  404 — and `unknown-status` is the trailing section a status this build does
	 *  not know lands in; the cell exists so "an unrecognised status is not dropped"
	 *  is measured rather than asserted. */
	projects: {
		loading: SURFACE.projectsLoading,
		empty: EMPTY.projects,
		populated: "project-row-",
		refused: SURFACE.projectRefusal,
		"unknown-status": SURFACE.projectsUnknownStatus,
	},
	/* The pushed detail's own subject. The KEY is the id PREFIX, not a camelCase
	 *  spelling of it: `tools/mock-relay/verify.ts` requires every subject the
	 *  harness maps to be one the app declares ids for — i.e. some declared id must
	 *  start with `<subject>-` — and this surface's ids are `project-detail-*`. A
	 *  subject that answered `projectDetail` would pass the table lookup and fail
	 *  that check, which is exactly the drift it exists to catch. */
	"project-detail": {
		loading: SURFACE.projectDetailLoading,
		populated: SURFACE.projectLinks,
		refused: SURFACE.projectDetailRefusal,
	},
	computers: {
		/** The refusal surface, which the set-up path does not render: the one
		 *  state of this screen the relay can drive — the computer LIST comes from
		 *  Radient's account API (`src/connection/discovery.ts`), which the mock
		 *  relay does not serve, so the other cells are declared gaps. */
		error: SURFACE.refusalSurface,
	},
	session: {
		idle: "session-idle",
		loading: SURFACE.sessionLoading,
		populated: "session-populated",
		empty: SURFACE.sessionTranscriptEmpty,
		streaming: "session-streaming",
		ended: "session-ended",
		aborted: "session-aborted",
		error: "session-error",
		degraded: "session-degraded",
		queued: "session-queued",
		"rich-rows": "session-rich-rows",
		/* A transcript that carries a markdown table — the rows U-38's check
		 * exists for. Derived from the same parser the renderer uses
		 * (`hasTableBlock`), so the marker can never affirm a table the reader
		 * would not be looking at. */
		tables: "session-tables",
		/* The `send` tool's settled delivery states, in the transcript (the
		 * desktop tool row's four-state arm mirrored — local-operator-ui #719).
		 * The cell `S5/send-delivery` affirms it: at least one row carries a
		 * `details.delivery.state`. */
		"send-delivery": "session-send-delivery",
		"pending-approval": "session-pending-approval",
		"pending-ask": "session-pending-ask",
		subagents: "session-subagents",
		/* The composer's voice mic. Present in ONLY this state: the composer renders
		 * the control iff `capabilities.stt.available` AND the build can record
		 * (`stt/capability.ts`), so a session frame either carries `composer-mic` or
		 * does not — which is exactly the claim the cell `S5/voice` makes. The id is
		 * CONTROL's own (a control a flow may also press), named here rather than
		 * re-declared: the marker table MAPS a state onto a declared id, which is
		 * the one way this table is allowed to reuse one. */
		voice: CONTROL.composerMic,
	},
	composer: {
		idle: "composer-idle",
		steering: "composer-steering",
		sending: "composer-sending",
		ended: "composer-ended",
	},
	/* The composer home (`/`). `idle` and `draft` differ only by the composer's
	 * content, so the marker SWAPS between them — one id present in both states
	 * would make the affirmative check vacuous. `sending` aliases the `Starting…`
	 * line's surface id: that line IS the state. */
	home: {
		idle: "home-idle",
		draft: "home-draft",
		sending: SURFACE.homeStarting,
		offline: "home-offline",
	},
	/* The conversations panel, subject `sidebar`. `populated` keeps the ONE row
	 * family (`STATE_MARKER.sessions.populated` is the same prefix — one list,
	 * one family, so `sessionRowId` serves both subjects). */
	sidebar: {
		open: SURFACE.sidebar,
		loading: "sidebar-loading",
		empty: EMPTY.sessions,
		populated: "session-row-",
		"empty-search": "sidebar-empty-search",
		degraded: CONTROL.sessionsDegradedBanner,
		stale: "sidebar-stale",
	},
	/* The queued-ask surfaces (E2). `bar` is the one state a session screen
	 *  carries while anything is outstanding — the marker must NOT paint in an
	 *  empty queue, so it lives on the bar itself, which renders nothing at zero.
	 *  The sheet's states are the read's states (loading / empty / error) and its
	 *  populated state is the row family; `timed-out` is its own row family so the
	 *  audit's `timed-out-mixed` cell can prove the state from the DOM. */
	asks: {
		bar: SURFACE.askBar,
		loading: SURFACE.asksSheetLoading,
		empty: SURFACE.asksSheetEmpty,
		error: SURFACE.asksSheetError,
		populated: "ask-row-",
		"timed-out": "ask-row-timed-out-",
	},
} as const satisfies Record<string, Record<string, string>>;

/** The marker the app declares for `<subject>/<state>`, or `null` for a gap. */
export const stateMarkerFor = (subject: string, state: string): string | null =>
	(STATE_MARKER as Record<string, Record<string, string> | undefined>)[
		subject
	]?.[state] ?? null;

/**
 * Whether an id satisfies a marker: an exact match, or — for a family prefix
 * (one that ends in `-`) — an id that starts with it AND is longer than the prefix
 * itself. The length clause is the whole check: `"session-row-"` starts with
 * `"session-row-"`, so without it the family's own declaration would satisfy the
 * rule and an empty list would pass as a populated one. It is the same rule
 * `isKnownIdentifier` applies to a family member above.
 */
export const markerMatches = (
	marker: string,
	ids: readonly string[],
): boolean =>
	marker.endsWith("-")
		? ids.some((id) => id.startsWith(marker) && id.length > marker.length)
		: ids.includes(marker);

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
 * control it presses is: the flows assert the panel's `sidebar-section-*` regions, the
 * refusal surfaces and `settings-section-*` by name, and leaving them out let a flow name an
 * id this contract could not see — the flow check then read a surface assertion as an
 * unknown selector. Declared last because `Object.values` needs the binding
 * initialised, and each one is rendered (`a11y.e2e.test.ts` proves it), so the set
 * stays honest rather than aspirational.
 *
 * `STATE_MARKER` joins them for the same reason `REGION` did: a state marker is a
 * `data-testid` in the DOM that the audit selects by name, so it is a selector in
 * every way that matters, and leaving it out would let the harness and the flows name
 * a marker this contract could not see.
 *
 * It joins as a SET because the marker table is a MAPPING, not a second declaration:
 * `session/empty` is `SURFACE.sessionTranscriptEmpty`, an id `SURFACE` already
 * declares, and the table exists precisely to say which declared id a state leaves
 * behind. The rule this list serves — an id is declared once (`a11y.test.ts`) — is
 * about the groups, and deduping here is what lets a state name another group's id
 * without looking like a collision.
 */
export const IDENTIFIERS: readonly string[] = [
	...new Set([
		...Object.values(SCREEN),
		...Object.values(EMPTY),
		...Object.values(CONTROL),
		...Object.values(SURFACE),
		...Object.values(REGION),
		...Object.values(STATE_MARKER).flatMap((states) => Object.values(states)),
	]),
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
/** The row identifier for one project, so the prefix lives in the contract and
 *  not at each call site (the `pastRowId` shape). */
export const projectRowId = (projectId: string): string =>
	`project-row-${projectId}`;

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

/** One condensed turn's summary bar. The key is the turn's OPENING row id
 *  (`turn-condensing.ts`), so a bar is addressable by the message that started
 *  the turn — the same identity the reader's expansion and the latch use. */
export const turnBarId = (turnKey: string): string => `turn-bar-${turnKey}`;

/** The completion attention's anchor row (ADR 0006 §3.1): the row a read
 *  receipt is ABOUT. It sits on a zero-size sibling at the row's bottom edge,
 *  because the ack gate's whole subject is "the END of this completion is on
 *  screen" — the anchor marks where the end is. */
export const completionAnchorId = (anchorId: string): string =>
	`completion-anchor-${anchorId}`;

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

/** One ask's row in the asks sheet, keyed by the ask's own id. */
export const askRowId = (askId: string): string => `ask-row-${askId}`;

/**
 * The anchor that marks one ask row as TIMED OUT — an EXTRA id on the row it
 * belongs to, on a zero-size sibling (the `transcript-streaming` shape), because
 * the row's own id must stay stable as an ask changes hands with time while the
 * audit's `timed-out-mixed` cell still needs the state to be provable from the
 * DOM. Same family as `askRowId` by construction (`ask-row-` prefix), so a flow
 * that addresses any row through the row family also reaches this one.
 */
export const timedOutAskRowId = (askId: string): string =>
	`ask-row-timed-out-${askId}`;

/** One session row's outstanding-ask count chip. */
export const asksBadgeId = (sessionId: string): string =>
	`asks-badge-${sessionId}`;

/** One question's field inside an ask's answer form, keyed by the QUESTION id so
 *  a flow can reach a question without counting controls. */
export const askFieldId = (questionId: string): string =>
	`ask-field-${questionId}`;

/** One row of the todos panel, by its position in the list. */
export const todosRowId = (index: number): string => `todos-row-${index}`;

/** One question of a multi-question ask: `ask-question-<n>-of-<total>`. */
export const askQuestionId = (index: number, total: number): string =>
	`ask-question-${index}-of-${total}`;

/** One answer option of an ask, by its position among the offered options. */
export const askOptionId = (index: number): string => `ask-option-${index}`;
