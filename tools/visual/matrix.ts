/**
 * The capture matrix: which device / theme / text-scale / screen / state cells
 * exist, and what each one means.
 *
 * Kept as data so `--plan` can print the exact frame list before anything is
 * rendered. A capture run whose cells are computed inside the capture loop
 * cannot be reviewed before it costs twenty minutes.
 *
 * Device metrics are the numbers `Emulation.setDeviceMetricsOverride` is given,
 * never `--window-size`: on Chrome 152 the flag clamps the width at a 500px
 * floor and loses 87px of height, silently, so a frame's dimensions would be
 * assumed rather than set.
 */

/**
 * Safe-area insets per device class, in CSS pixels. `env(safe-area-inset-*)`
 * cannot be overridden through CDP, so the harness declares them as custom
 * properties and the audit measures content against *those*. They are the
 * documented values for each class, and they are stated here rather than
 * buried in the probe so a reviewer can argue with the number.
 *
 * `tier` selects how much of the matrix a run covers. `core` is the sample a
 * default run captures — the smallest phone, one typical phone and one tablet,
 * both orientations where they differ — and `full` adds every other size. The
 * operator's rule for this matrix is that phones come in many sizes and tablets
 * need both orientations, so the full list is the target and the core list is
 * the default; a run states which tier it ran, and a cell that was not captured
 * is reported BLOCKED rather than passed.
 */
export interface DeviceProfile {
	label: string;
	width: number;
	height: number;
	dpr: number;
	platform: "ios" | "android";
	insets: { top: number; bottom: number; left: number; right: number };
	kind: "phone" | "tablet" | "foldable";
	orientation: "portrait" | "landscape";
	tier: "core" | "full";
	note: string;
}

/** Tablet breakpoint: at or above this width the layout must earn the space. */
export const TABLET_MIN_WIDTH = 768;

export const DEVICES: Record<string, DeviceProfile> = {
	// --- Phones, portrait: the sizes a real fleet has, smallest first. ---
	"iphone-se": {
		label: "iPhone SE (320x568)",
		width: 320,
		height: 568,
		dpr: 2,
		platform: "ios",
		insets: { top: 20, bottom: 0, left: 0, right: 0 },
		kind: "phone",
		orientation: "portrait",
		tier: "core",
		note: "The 320pt floor: no notch, no home indicator, the narrowest phone the app must survive.",
	},
	"iphone-se2": {
		label: "iPhone SE 2/3 (375x667)",
		width: 375,
		height: 667,
		dpr: 2,
		platform: "ios",
		insets: { top: 20, bottom: 0, left: 0, right: 0 },
		kind: "phone",
		orientation: "portrait",
		tier: "full",
		note: "The common small iPhone: a rounded 375pt width still with a home button.",
	},
	"android-compact": {
		label: "Android small (360x640)",
		width: 360,
		height: 640,
		dpr: 3,
		platform: "android",
		insets: { top: 24, bottom: 0, left: 0, right: 0 },
		kind: "phone",
		orientation: "portrait",
		tier: "full",
		note: "A 3x Android at the 48dp touch floor, on the shortest screen in use.",
	},
	"android-small": {
		label: "Android 360x780",
		width: 360,
		height: 780,
		dpr: 3,
		platform: "android",
		insets: { top: 24, bottom: 0, left: 0, right: 0 },
		kind: "phone",
		orientation: "portrait",
		tier: "full",
		note: "The tall 3x Android: the same width as the compact with 140px more height.",
	},
	"iphone-15": {
		label: "iPhone 15 (390x844)",
		width: 390,
		height: 844,
		dpr: 3,
		platform: "ios",
		insets: { top: 59, bottom: 34, left: 0, right: 0 },
		kind: "phone",
		orientation: "portrait",
		tier: "core",
		note: "The default capture device: Dynamic Island, home indicator, 3x.",
	},
	"android-large": {
		label: "Android large (412x915)",
		width: 412,
		height: 915,
		dpr: 2.6,
		platform: "android",
		insets: { top: 24, bottom: 16, left: 0, right: 0 },
		kind: "phone",
		orientation: "portrait",
		tier: "full",
		note: "A 2.6x Android: the widest phone before the tablet breakpoint.",
	},
	"iphone-max": {
		label: "iPhone Pro Max (430x932)",
		width: 430,
		height: 932,
		dpr: 3,
		platform: "ios",
		insets: { top: 59, bottom: 34, left: 0, right: 0 },
		kind: "phone",
		orientation: "portrait",
		tier: "full",
		note: "The large-phone case: wider rows, longer labels before they wrap.",
	},
	// --- Foldables: the cover screen is narrower than any classic phone. ---
	"fold-cover": {
		label: "Foldable cover (280x653)",
		width: 280,
		height: 653,
		dpr: 2.6,
		platform: "android",
		insets: { top: 24, bottom: 16, left: 0, right: 0 },
		kind: "foldable",
		orientation: "portrait",
		tier: "full",
		note: "Narrower than the 320pt floor: the case where a two-column row or a long label cannot fit at all.",
	},
	"fold-open": {
		label: "Foldable unfolded (673x841)",
		width: 673,
		height: 841,
		dpr: 2.6,
		platform: "android",
		insets: { top: 24, bottom: 16, left: 0, right: 0 },
		kind: "foldable",
		orientation: "portrait",
		tier: "full",
		note: "Just under the tablet breakpoint: the phone layout must still hold.",
	},
	// --- Phones, landscape: the notch moves to a side, the keyboard eats height. ---
	"iphone-15-landscape": {
		label: "iPhone 15 landscape (844x390)",
		width: 844,
		height: 390,
		dpr: 3,
		platform: "ios",
		insets: { top: 0, bottom: 21, left: 59, right: 59 },
		kind: "phone",
		orientation: "landscape",
		tier: "core",
		note: "Landscape insets move to left/right; the composer sits above a keyboard that takes half the height.",
	},
	"android-large-landscape": {
		label: "Android large landscape (915x412)",
		width: 915,
		height: 412,
		dpr: 2.6,
		platform: "android",
		insets: { top: 0, bottom: 16, left: 24, right: 24 },
		kind: "phone",
		orientation: "landscape",
		tier: "full",
		note: "The Android landscape case, wider than the iPhone's and with a shallower bottom inset.",
	},
	// --- Tablets: both orientations, both platforms. ---
	"tablet-768": {
		label: "Tablet portrait (768x1024)",
		width: 768,
		height: 1024,
		dpr: 2,
		platform: "ios",
		insets: { top: 24, bottom: 20, left: 0, right: 0 },
		kind: "tablet",
		orientation: "portrait",
		tier: "full",
		note: "The smallest iPad in portrait: exactly at the breakpoint, so the two-pane decision is visible here first.",
	},
	"tablet-768-landscape": {
		label: "Tablet landscape (1024x768)",
		width: 1024,
		height: 768,
		dpr: 2,
		platform: "ios",
		insets: { top: 20, bottom: 20, left: 0, right: 0 },
		kind: "tablet",
		orientation: "landscape",
		tier: "full",
		note: "The same device rotated: a wide, short viewport where vertical space is the scarce one.",
	},
	tablet: {
		label: "Tablet 834x1112",
		width: 834,
		height: 1112,
		dpr: 2,
		platform: "ios",
		insets: { top: 24, bottom: 20, left: 0, right: 0 },
		kind: "tablet",
		orientation: "portrait",
		tier: "core",
		note: "iPad Air portrait: the split view and the two-column layout.",
	},
	"tablet-landscape": {
		label: "Tablet landscape (1112x834)",
		width: 1112,
		height: 834,
		dpr: 2,
		platform: "ios",
		insets: { top: 20, bottom: 20, left: 0, right: 0 },
		kind: "tablet",
		orientation: "landscape",
		tier: "core",
		note: "iPad Air rotated: the layout that must use the extra width deliberately.",
	},
	"tablet-pro": {
		label: "Tablet Pro portrait (1024x1366)",
		width: 1024,
		height: 1366,
		dpr: 2,
		platform: "ios",
		insets: { top: 24, bottom: 20, left: 0, right: 0 },
		kind: "tablet",
		orientation: "portrait",
		tier: "full",
		note: "The largest iPad in portrait: the layout with the most room to waste.",
	},
	"tablet-pro-landscape": {
		label: "Tablet Pro landscape (1366x1024)",
		width: 1366,
		height: 1024,
		dpr: 2,
		platform: "ios",
		insets: { top: 20, bottom: 20, left: 0, right: 0 },
		kind: "tablet",
		orientation: "landscape",
		tier: "full",
		note: "1366px wide: a phone layout stretched across this is a finding, not a pass.",
	},
	"android-tablet": {
		label: "Android tablet portrait (800x1280)",
		width: 800,
		height: 1280,
		dpr: 1.5,
		platform: "android",
		insets: { top: 24, bottom: 16, left: 0, right: 0 },
		kind: "tablet",
		orientation: "portrait",
		tier: "full",
		note: "A 1.5x Android tablet: the density where a 48dp target is 72 device pixels.",
	},
	"android-tablet-landscape": {
		label: "Android tablet landscape (1280x800)",
		width: 1280,
		height: 800,
		dpr: 1.5,
		platform: "android",
		insets: { top: 16, bottom: 16, left: 24, right: 24 },
		kind: "tablet",
		orientation: "landscape",
		tier: "full",
		note: "The Android tablet rotated.",
	},
};

/** Device names in the core tier — the default sample a run captures. */
export const CORE_DEVICES: string[] = Object.entries(DEVICES)
	.filter(([, device]) => device.tier === "core")
	.map(([name]) => name);

/** Every device name, in declaration order (smallest to largest). */
export const ALL_DEVICES: string[] = Object.keys(DEVICES);

/**
 * Which of the declared profiles a run's device list covers, and which it does not.
 *
 * WHY A RUN HAS TO SAY THIS ITSELF. The per-push CI job captures `--tier ci`, which is 2 of
 * the 19 profiles declared above, and a green `Web target` job READ as "the app is fine"
 * when it asserted something far narrower. The sample is declared HERE, beside the device
 * table it is a subset of; this helper is how a RUN states the bound it actually took, so a
 * reader of a green run cannot mistake the sample for the whole matrix. It reads
 * `ALL_DEVICES` rather than a second list of its own, so it cannot drift from the table the
 * plan is built from.
 *
 * `captured` is filtered to the declared order (so the two lists line up with the table in
 * `docs/e2e/README.md`), and any name the matrix does not declare is kept at the end: the
 * statement is about what ran, whatever it was.
 */
export function deviceCoverage(captured: readonly string[]): {
	declared: string[];
	captured: string[];
	notCaptured: string[];
} {
	const declared = [...ALL_DEVICES];
	const asked = new Set(captured);
	return {
		declared,
		captured: [
			...declared.filter((name) => asked.has(name)),
			...captured.filter((name) => !declared.includes(name)),
		],
		notCaptured: declared.filter((name) => !asked.has(name)),
	};
}

/**
 * The run's own one-line statement of what its device sample covers, and — always — what it
 * leaves out. Kept beside `deviceCoverage` so the sentence and the counts cannot disagree:
 * the `captured` branch is reachable only when `notCaptured` is empty.
 */
export function describeDeviceCoverage(coverage: {
	declared: string[];
	captured: string[];
	notCaptured: string[];
}): string {
	// A run that captured nothing has no names to put in the brackets, and `captured ()` reads
	// as a broken sentence rather than as the finding it is — the list is only listed when
	// there is at least one entry in it.
	const named =
		coverage.captured.length > 0 ? ` (${coverage.captured.join(", ")})` : "";
	if (coverage.notCaptured.length === 0) {
		return `device coverage: all ${coverage.declared.length} declared profiles captured${named}`;
	}
	return (
		`device coverage: ${coverage.captured.length} of ${coverage.declared.length} declared profiles captured${named}; ` +
		`${coverage.notCaptured.length} NOT captured (${coverage.notCaptured.join(", ")})`
	);
}

/**
 * The CI tier: the bounded sample the per-push capture job takes.
 *
 * WHY A THIRD TIER, AND WHY IT IS HERE RATHER THAN A `--devices` LIST IN YAML.
 * The `core` tier is 1092 cells: the whole declared cell list (42 cells) x 2 themes x
 * (3 phones x 3 scales + 2 tablets x 2 scales) — 42 x 2 x 13, the tier's 5 profiles —
 * and the CI job's capture step is bound at 20 minutes. Measured on the runner, that is
 * 2.24 s/cell: 403 cells in 903 s (run 37098393675, a plan of 403 cells then), so a core
 * run needs ~41 minutes. The job's first real
 * run of this path
 * was therefore cut off by the harness's own 900 s deadline with 585 cells
 * unvisited, and reported them as cells with no frame.
 *
 * The three ways out of that are all forbidden by the job's purpose: `--no-strict`
 * makes it green while measuring 41% of the plan; deleting cells removes the states
 * a finding could be made about; and raising the bound to ~40 minutes spends the
 * pipeline's scarcest resource on a check that runs on every push. So the sample
 * shrinks instead, and it is declared HERE — beside the device and scale tables it
 * is a subset of — so a reviewer can argue with the sample rather than with a YAML
 * range, and so the plan, the manifest and the docs all read the same one list.
 *
 * WHAT IT KEEPS. The cell axis is NOT sampled: the CI tier captures every cell the
 * relay's registry declares, because a state that is not captured is a state no
 * review round can report on. Only the device, theme and scale axes shrink, and
 * each keeps exactly what its check needs:
 *
 *   * `iphone-se` (320x568) and `tablet-landscape` (1112x834) are the two width
 *     EXTREMES the full matrix spans, on the two sides of `TABLET_MIN_WIDTH`: the
 *     narrowest viewport the app must survive, and the widest one the layout has to
 *     earn. A defect at 320 or at 1112 is what this sample is looking for.
 *   * both themes, because the theme-reached-the-render check compares a cell's
 *     dark and light frames — one theme cannot make it.
 *   * the 100% floor and the 200% ceiling, which is the pair the text-scale guard
 *     measures (200% over 100%). 150% is the phone-typical intermediate case and is
 *     left to `core`.
 *
 * That is 42 cells x 2 themes x (2 profiles x 2 scales) = 336 cells, ~12 minutes at
 * the measured rate: inside the step bound with most of it spare. `core` and
 * `full` are unchanged and stay the local and dispatched samples, so the full
 * 1092-cell `core` matrix and the 3948-cell `full` matrix remain runnable — nothing
 * is only reachable through CI.
 */
export const CI_DEVICES: string[] = ["iphone-se", "tablet-landscape"];

/** The scale ids the CI tier runs: the 100% floor and the 200% ceiling. */
export const CI_SCALES: string[] = ["100", "200"];

export const THEMES = ["dark", "light"];

/** Text scales as a multiplier of the app's default. 1 = the OS default. */
export const SCALES = [
	{ id: "100", factor: 1 },
	{ id: "150", factor: 1.5 },
	{ id: "200", factor: 2 },
];

/**
 * Screens, by the audit rubric's ids (`docs/ux/audit-rubric.md` §1), each with
 * the Expo Router path that renders it. Group segments — `(auth)`, `(app)` —
 * are not part of a URL, so the path here is the route as the web export
 * serves it, not as the file is laid out.
 */
export const SCREENS: Record<string, { label: string; path: string }> = {
	S1: { label: "Sign in", path: "/sign-in" },
	"S1-welcome": { label: "Welcome (first run)", path: "/welcome" },
	S2: { label: "Set up a computer", path: "/tunnels" },
	S3: { label: "Computers", path: "/tunnels" },
	"S3-custom": { label: "Own tunnel + password", path: "/own-tunnel" },
	S4: { label: "Home (new chat)", path: "/" },
	S5: { label: "Session", path: "/session/{sessionId}" },
	S6: { label: "Subagent", path: "/session/{sessionId}/agent/{jobId}" },
	S7: { label: "New session", path: "/new" },
	S8: { label: "Pending card", path: "/session/{sessionId}" },
	S9: { label: "Sheets", path: "/session/{sessionId}" },
	S10: { label: "Past sessions", path: "/past" },
	S11: { label: "Settings", path: "/settings" },
	S13: { label: "Refused / unreachable", path: "/tunnels" },
	S14: { label: "Demo mode", path: "/demo" },
	S15: { label: "Conversations panel", path: "/conversations" },
	/* The projects read path (rubric §1). Two entries for one surface because the
	 * DETAIL is a route of its own — the app pushes it — so a capture has to be
	 * able to ask for either. `{projectKey}` resolves to the captured row (`
	 * tools/visual/capture.ts`, `resolvePath`), which is the row the mock relay's
	 * key-scoped route answers for. */
	S16: { label: "Projects", path: "/projects" },
	"S16-detail": { label: "Project detail", path: "/projects/{projectKey}" },
};

/**
 * The readiness probe. Injected before any app script runs, it does three
 * things that must happen **before first paint**, because a theme applied after
 * first paint once produced two byte-identical "dark" and "light" captures —
 * which is a defect class this line exists to catch, not to reproduce:
 *
 *  1. resolves the requested theme/scale/reduce-motion from the query string,
 *     falls back to the OS preference, and stamps them on the document,
 *  2. publishes the safe-area insets the device profile declares, so a layout
 *     that respects them can be captured on a browser that has no notch,
 *  3. records the resolved values on `window.__loCapture` for the harness to
 *     read back, so what it *reports* is what the page actually resolved rather
 *     than what the harness asked for.
 */
export const PRE_PAINT_PROBE = `
(() => {
  // A document-start script runs before <html> exists, when
  // document.documentElement is still null. That is not a cosmetic detail:
  // assigning to it threw, the whole probe died, and every frame then reported
  // 'theme: null' - three plausible-looking screenshots built on a silent
  // failure. Creating an element to assign to is worse: appending a second
  // <html> to the document confuses the parser and the page renders blank.
  // So the values are resolved immediately and the DOM writes are deferred to
  // the first animation frame, which the browser runs *before* the first paint.
  const params = new URLSearchParams(location.search);
  const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = params.get('lo-theme') || (preferDark ? 'dark' : 'light');
  const scale = Number(params.get('lo-text-scale') || '1');
  const reduceMotion = params.get('lo-reduce-motion') === '1'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const insets = {
    top: params.get('lo-inset-top') || '0',
    bottom: params.get('lo-inset-bottom') || '0',
    left: params.get('lo-inset-left') || '0',
    right: params.get('lo-inset-right') || '0',
  };
  // Published straight away, because the measurement reads this object and must
  // be able to report what the page *resolved* even if the DOM write below has
  // not happened yet.
  window.__loCapture = { theme, scale, reduceMotion, insets, themeSource: params.get('lo-theme') ? 'query' : 'os' };
  const paint = () => {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.loTheme = theme;
    root.dataset.loTextScale = String(scale);
    root.dataset.loReduceMotion = reduceMotion ? 'on' : 'off';
    root.style.colorScheme = theme;
    root.style.setProperty('--lo-text-scale', String(scale));
    // A root font-size is the only scale signal a plain web build can act on
    // without an app-side hook; an app that uses rem picks it up, one that uses
    // px does not — which is exactly what the harness measures and reports.
    root.style.fontSize = (16 * scale) + 'px';
    for (const [name, value] of Object.entries(insets)) {
      root.style.setProperty('--lo-inset-' + name, value + 'px');
    }
  };
  paint();
  if (!document.documentElement) requestAnimationFrame(paint);
})();
`;

/**
 * The screen-root test identifiers the app declares (`src/ui/a11y.ts`, `SCREEN`).
 *
 * The harness reads these to prove the app reached the screen a cell names. The
 * measurement that matters: before this check existed, five different `S4` states
 * produced ONE byte-identical image — the app rendered the unauthenticated screen
 * in every cell and the audit still reported 408 PASS rows. A capture that cannot
 * tell those apart is not evidence, so a cell whose screen root is missing is a
 * FAILED cell, not a blank frame.
 */
export const SCREEN_ROOTS: Record<string, string> = {
	S1: "sign-in-screen",
	"S1-welcome": "welcome-screen",
	// One screen, three states: `/tunnels` renders `computers-screen` while it is
	// setting a computer up, listing them, or refusing. The three cells differ by
	// their STATE marker, not by their root.
	S2: "computers-screen",
	S3: "computers-screen",
	"S3-custom": "own-tunnel-screen",
	// S4 is the composer home; the sessions list's cells re-homed to S15 with the
	// list itself, and the /conversations route carries `sessions-screen` (the
	// panel's route/root, kept per the contract). Re-pointing S4 re-labelled four
	// measured cells (S4/empty, S4/populated, S4/populated-long, S4/narrow ->
	// S15/*) and added S4/idle; the diff is flagged for the plan lane in the PR.
	S4: "home-screen",
	S5: "session-screen",
	S6: "subagent-screen",
	S7: "new-session-screen",
	S8: "session-screen",
	S9: "session-screen",
	S10: "past-sessions-screen",
	S11: "settings-screen",
	S13: "computers-screen",
	S14: "welcome-screen",
	S15: "sessions-screen",
	S16: "projects-screen",
	"S16-detail": "project-detail-screen",
};

/**
 * Cells whose state the app cannot render yet, and the work each one waits on.
 *
 * A DECLARED SKIP is not a silent hole and not a pass: it is the named, owned
 * dependency that keeps "we could not measure this" from being reported as "this
 * cell is broken". It is honoured by the capture harness ONLY while the app declares
 * no marker for the cell's state (`markerGapReason`) — the moment the app declares a
 * marker, the claim is ignored and a frame that does not show it is a real failure.
 * So a marker that stops rendering can never hide behind an entry here, and an entry
 * here cannot outlive the app's gap by making a working cell look unmeasured.
 *
 * Keep every entry to a ticket or a named owner plus the fact that is missing; a bare
 * "TO DO" is the thing this table exists to avoid.
 */
export const PENDING_CELLS: Record<string, string> = {
	/* The 21 session-view cells, INERT ON THIS HEAD, and left in place on purpose.
	 * They were added while `app/(app)/session/[id].tsx` was a placeholder that drew
	 * `session-empty` in every state; PR #12 landed the real session view, so the app now
	 * declares `session-populated` and the rest, and a skip is honoured only while the app
	 * declares NO marker for the cell's state. Every one of these is therefore REFUSED —
	 * which is the direction that matters: a session state that stops rendering comes back
	 * as a `marker` issue and is reported NOT MEASURABLE by name, never quietly skipped.
	 * What remains is their owner text, which describes the head they were written for and
	 * is never printed, because the skip is never taken. They are kept rather than deleted
	 * because `verify.ts`'s "no screen whose empty marker the app declares is left
	 * unexplained" check reads this table's SCREENS, and removing them there is a change to
	 * that check's premise (the app no longer omits the session subjects) rather than to
	 * this registry. */
	...Object.fromEntries(
		[
			"S5/loading",
			"S5/populated",
			"S5/populated-long",
			"S5/scroll",
			"S5/empty",
			"S5/streaming",
			"S5/aborted",
			"S5/queued",
			"S5/pending-approval",
			"S5/pending-ask",
			"S5/rich-rows",
			"S5/subagents",
			"S5/degraded",
			"S5/error",
			"S6/populated",
			"S6/populated-long",
			"S8/approval",
			"S8/ask",
			"S8/ask-multi",
			"S8/populated-long",
			"S9/populated",
		].map((cell) => [
			cell,
			"PR #12 (feat/screens-session) — app/(app)/session/[id].tsx is a placeholder",
		]),
	),
	/* The computers cells: the list is Radient's account API, not the relay. */
	...Object.fromEntries(
		["S2/empty", "S3/empty", "S3/populated", "S13/loading", "S13/degraded"].map(
			(cell) => [
				cell,
				"app — computer discovery reads Radient's account API (src/connection/discovery.ts /v1/tunnels), " +
					"which the mock relay does not serve; the refusal state is the only one the relay can drive",
			],
		),
	),
	/* The list states the app renders without an identifier of their own. */
	"S15/ended":
		"app (src/ui/a11y.ts STATE_MARKER) — ListRow's `ended` receipt changes copy and colour but carries no identifier",
	"S15/degraded-row":
		"app (src/ui/a11y.ts STATE_MARKER) — ListRow's `degraded` receipt renders 'not answering' but carries no identifier",
	/* The scrolled transcript, and it is here rather than only in the PR because this
	 * table is where a coverage gap is supposed to live. `S5/scroll` was
	 * `S5/populated-long` under a second name — both were pinned from `long-transcript`'s
	 * single projection — so the duplicate DECLARATION went and the relay no longer
	 * declares the cell; the entry is inert for the same reason the session-view block
	 * above is, since a skip is honoured only while the app declares no marker. What it
	 * records is the state that is still unmeasured: a scroll POSITION is a viewport
	 * interaction and not something the wire can declare, so nothing in the harness can
	 * drive one, and the next person to add a wire action or an app-side id has the
	 * owner text to read. */
	"S5/scroll":
		"harness (tools/visual/capture.ts) — driving a scroll position needs a wire action or an app-side id; until then no cell evidences a scrolled transcript",
};

/**
 * Byte-identical frames that are a LIMIT OF THE COMPARISON, not a collapse.
 *
 * The identical-frame check compares settled PNG bytes, which is exactly the right test
 * for "two declared states produced one image" and the wrong test for "two declared states
 * produced one image OF THE CHROME". At 320 px with 200 % text the session's header,
 * progress and panel rows fill the whole viewport, so two cells whose transcripts differ
 * in every row are byte-identical while the app is rendering both states correctly.
 *
 * So a byte-identical group is not failed on the bytes alone any more: the harness reads
 * what each cell is SHOWING without the viewport (`CONTENT_PROBE` — the screen reader's
 * view: its rendered text and its accessibility labels), and
 *
 *   * same bytes AND same content  → a real collapse: reported and failed, as before;
 *   * same bytes, DIFFERENT content → a DECLARED exemption or nothing. It passes as a
 *     limitation only when the pair is named here, with the reason a reviewer needs
 *     (which viewport, and which content differs); an undeclared pair is still a
 *     FAILURE, so a new collapse cannot quietly exempt itself.
 *
 * The key is the group's distinct cell names, sorted, joined with `|`. Keep this table
 * EMPTY unless a pair is genuinely a camera limit, and let the reason name the viewport
 * it was measured on: the exemption is a statement about the frame, not about the app.
 */
export const IDENTICAL_FRAME_EXEMPTIONS: Record<string, string> = {
	"S16/populated|S16/unknown-status":
		"below-the-fold at iphone-se / 200 %: the 320 px column at 200 % text is filled by the " +
		"list's own header (`Projects`) and its first two sections, and the one thing that " +
		"distinguishes the two cells — the UNKNOWN STATUS section, which is the feature this " +
		"cell exists to prove — is placed LAST by `groupProjectsByStatus` (a status this build " +
		"does not know sorts after every known one) and starts below the viewport, so the PNG " +
		"is the same chrome. The content differs (each cell reaches its own marker, " +
		"`projects-populated` / `projects-unknown-status`), which is what makes this a limit " +
		"of the camera rather than a collapse; at 100 % the swapped row is still above the " +
		"fold and the two frames differ, and so does the whole pair at tablet-landscape, so " +
		"the states are distinguishable everywhere except the narrowest column at the " +
		"largest text.",
	"S5/populated-long|S5/rich-rows|S5/subagents":
		"below-the-fold at iphone-se / 200 %: the 320 px column at 200 % text is filled by the " +
		"session header (`Refactor… client`, the context/task/subagent panel rows), and the rows " +
		"that distinguish these three cells — the 520-row transcript, the code-block/diff/table " +
		"rows, and the subagent roster's own rows — start below the viewport, so the PNG is all " +
		"chrome. The content differs at every device and scale (each cell reaches its own " +
		"marker), which is what makes this a limit of the camera rather than a collapse. THE " +
		"GROUP IS THREE NAMES ON ONE ENTRY on purpose: it was declared as " +
		"`S5/populated-long|S5/rich-rows`, and a third cell joining it when the capture first " +
		"completed a whole tier — until then the stalls left cells missing and the comparison " +
		"could not form the group — is evidence that the phenomenon is the one this entry " +
		"describes, so it extends the statement rather than opening a second entry for the " +
		"same thing.",
};

/**
 * Byte-identical frames whose cells are ONE VIEW at that device BY COMPOSITION.
 *
 * The remedy for "two cells, one image, same content" has been to REMOVE the duplicate
 * declaration (S4/narrow, S9/populated, S2/error in their commits) — but that remedy
 * fits one STATE wearing two names. This table is the other case the same test cannot
 * tell apart: two DIFFERENT states that a device renders in ONE composed view, where
 * both claims are true at once and neither name is a duplicate where they differ.
 *
 * At tablet-landscape, `/conversations` renders the same `Home` with the panel open
 * (`app/(app)/conversations.tsx` renders `<Home forcePanelOpen>`), and the panel is
 * DOCKED there, so `S4/idle` and `S15/empty` produce the same bytes AND the same
 * content — each cell still reaches its own root and marker inside that one view
 * (`home-idle` and `sessions-empty` are both in both frames, which the byte-identity
 * itself proves). At iphone-se the drawer overlays the home and the frames differ, so
 * both declarations are needed: S4/idle is the home's own cell and S15/empty is the
 * panel's empty state and the `/conversations` route's capture.
 *
 * A pair is consulted ONLY when every cell in the partition is EVIDENTIAL (ready, not
 * skipped), so a partition in which any state's own marker is missing can never declare
 * itself out of a collapse; an undeclared same-content partition still FAILS, exactly
 * as it did before this table existed.
 */
export const IDENTICAL_FRAME_COINCIDENCES: Record<string, string> = {
	"S15/empty|S4/idle":
		"one view, two states at tablet-landscape: `/conversations` renders the same home " +
		"with the panel open, and the panel is docked at this device, so the route and the " +
		"home compose into ONE rendering — the same bytes AND the same content are both " +
		"correct, and each cell still reaches its own root and marker in it (`home-idle` " +
		"for S4, `sessions-empty` for S15 — present in both frames, which the byte-identity " +
		"proves). Not a camera limit: the content really agrees, because the composition " +
		"really is one view. The pair differs at iphone-se (the drawer overlays the home), " +
		"which is why neither declaration can be removed — S4/idle is the home's own cell " +
		"and S15/empty is the panel's empty state and the /conversations route's capture. " +
		"Measured on the ci run at 0b414a4: four pairs, one per theme × scale " +
		"(dark 07d9c40e1083 / d7ca9bcec45e; light 1623786f6c06 / f2ee0ac17b8f).",
};

/** Read the resolved theme/scale and the app's own canvas colour, per frame. */
/**
 * The readiness probe: after a cell settles, what did the app actually render?
 *
 * Read back from the page, so a mismatch between "what the cell asked for" and
 * "what the app is showing" is measurable rather than assumed.
 */
/**
 * The positive marker each declared state must show, and the markers it must not.
 *
 * The readiness guard used to check a route and a screen root, and nothing else —
 * so a cell declaring `S8/approval` passed while the app rendered the neutral
 * "not connected yet" screen, with the relay having served it no requests at all.
 * A screen root says which screen drew; these say which STATE it drew.
 *
 * The rule is negative for every state that is not honestly empty: an honest
 * empty state is a specific screen's `*-empty` marker, so seeing THE CELL'S OWN
 * SURFACE's one on a cell that asked for populated, streaming or error means the
 * state was never reached. The marker read is the surface's own
 * (`STATE_MARKER.<subject>.empty`): a device composes surfaces — the home docks
 * the conversations panel at tablet-landscape — and the panel's empty state
 * drawn beside the home is not the home's miss (`tools/lib/readiness.ts`). An
 * ad-hoc `path:` page declares no surface, so every `*-empty` is read for it.
 * `empty` is the one state where the marker is required rather than forbidden,
 * which is also what stops a check that only forbids from passing vacuously.
 */

export const READINESS_PROBE = `
(() => {
  const all = Array.from(document.querySelectorAll('[data-testid]'));
  const testIds = all
    .map((el) => el.getAttribute('data-testid'))
    .filter((id) => typeof id === 'string');
  // WHICH list a rule reads. The probe reports both, and the two are NOT interchangeable:
  //  * \`testIds\` is PRESENCE, and it is what a STATE MARKER is judged on. A marker is a
  //    machine-readable assertion about what a screen is showing, and the app's derived
  //    markers are zero-size \`View\`s by design, so a non-zero box cannot be a condition
  //    on one — measured, requiring it made \`populated\`, \`streaming\`, \`error\` and seven
  //    more declared states unmeasurable on a head that renders every one of them.
  //  * \`visibleTestIds\` is RENDERED, and it is what a screen ROOT is judged on: the root
  //    IS the screen, so a \`display:none\` node, a \`visibility:hidden\` one or a zero-area
  //    box really would mean nothing drew. "Visible" here means, precisely: the element
  //    and its ancestors are not display:none or visibility:hidden (getComputedStyle),
  //    and its bounding rect has non-zero width and height. Opacity is NOT part of it —
  //    a translucent-but-present control is still a control the transcript renders.
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const parentStyle = getComputedStyle(node);
      if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const visibleTestIds = all
    .filter((el) => visible(el))
    .map((el) => el.getAttribute('data-testid'))
    .filter((id) => typeof id === 'string');
  const text = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 240) : '';
  return {
    path: location.pathname,
    testIds,
    visibleTestIds,
    text,
    elementCount: document.querySelectorAll('*').length,
  };
})();
`;

/**
 * What a cell is SHOWING, read in the way a viewport cannot truncate.
 *
 * The identical-frame check compares PNG bytes, which is the right test for "two states
 * produced one image" and the wrong test for "two states produced one image of the
 * CHROME". At 320 px with 200 % text the session's header and panels fill the whole
 * frame, so `S5/populated-long` and `S5/rich-rows` — whose transcripts differ in every
 * row — measure byte-identical while the app is rendering two different states perfectly
 * well. This probe is the second opinion: the SCREEN READER's view of the cell (its
 * rendered text, leaf by leaf, plus every accessibility label), which is what a phone
 * would read out and what "are these the same state?" actually means. It is not a
 * substitute for the pixel check — it is what decides whether a byte-identical pair is a
 * COLLAPSE, a declared one-view coincidence (`IDENTICAL_FRAME_COINCIDENCES`), or a limit
 * of the camera — and `IDENTICAL_FRAME_EXEMPTIONS` is where a limitation has to be
 * declared before it can be believed.
 */
export const CONTENT_PROBE = `
(() => {
  const norm = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const roots = document.querySelectorAll('[data-testid$="-screen"]');
  const scope = roots.length > 0 ? roots[0] : document.body;
  if (!scope) return { text: '', labels: '' };
  const texts = [];
  const labels = [];
  for (const el of scope.querySelectorAll('*')) {
    if (el.children.length === 0) {
      const text = norm(el.textContent);
      if (text) texts.push(text);
    }
    const label = norm(el.getAttribute('aria-label'));
    if (label) labels.push(label);
  }
  return { text: texts.join('\\u001f'), labels: labels.join('\\u001f') };
})();
`;

export const MEASURE_PROBE = `
(() => {
  const info = window.__loCapture || {};
  const root = document.documentElement;
  const body = document.body;
  const appRoot = document.querySelector('#root') || document.querySelector('[data-testid="app-root"]') || body;
  const cs = (el) => el ? getComputedStyle(el) : null;
  const rootStyle = cs(root), bodyStyle = cs(body), appStyle = cs(appRoot);
  // The *computed* canvas: what actually renders, not what was requested.
  const bg = (style) => style && style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? style.backgroundColor : null;
  // A React Native web app paints its own surface on an inner root, leaving
  // body and html transparent — so stopping at the root locates a colour nobody
  // sees and makes the token comparison unanswerable. Walk down to the first
  // painted element instead, which is the surface the user is looking at.
  const paintedDescendant = (el) => {
    if (!el) return null;
    for (const node of el.querySelectorAll('div,main,section')) {
      const rect = node.getBoundingClientRect();
      if (rect.width < window.innerWidth * 0.9 || rect.height < window.innerHeight * 0.5) continue;
      const colour = bg(getComputedStyle(node));
      if (colour) return colour;
    }
    return null;
  };
  const canvas = bg(appStyle) || paintedDescendant(document.body) || bg(bodyStyle) || bg(rootStyle) || 'rgba(0, 0, 0, 0)';
  const textNodes = [...document.querySelectorAll('body *')].filter((el) => {
    if (!el.textContent || !el.textContent.trim()) return false;
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  // WHICH TEXT COUNTS AS A TYPE ROLE — the box test, and exactly what it does not catch.
  //
  // The test is a non-zero bounding box, the same one the median reading above has always
  // used: a node that is LAID OUT counts, whether or not it draws. That is deliberate for
  // two shapes this audit relies on — a node at opacity:0, and a node clipped inside a
  // zero-height container — so READINESS_PROBE's visible() is deliberately NOT the
  // predicate here: that test answers "did the app render this marker", while the audit
  // reads the app's clipped placeholder proxy on purpose (docs/ux/audit-rubric.md).
  //
  // visibility:hidden is the one shape excluded, because it is the one whose box a
  // reviewer's eye never sees and whose exclusion changes no reading on any tier. Only the
  // node's OWN computed value is read: visibility is inherited, so a visibility:visible
  // child of a hidden parent keeps its own value and must stay counted.
  //
  // WHAT A BOX TEST CANNOT CATCH — a class rather than a list. Text painting from a
  // ZERO-HEIGHT box is skipped, so a FROZEN role on such a carrier is never reported and
  // its pair reads live. Seen so far, including but not limited to: height:0 with
  // overflow:visible, line-height:0, display:contents, contain:size — over elements that
  // hold direct text. (Generated content and shadow-root text escape for a different
  // reason: not direct text, and never traversed.) The painted-carrier-text-scale fixture
  // asserts three of those shapes as a known miss, and docs/e2e/README.md states the class
  // with its measured incidence. The app has no such carrier today.
  const unpainted = (el) => el.getBoundingClientRect().height <= 0;
  const heights = textNodes.slice(0, 400).map((el) => el.getBoundingClientRect().height).filter((h) => h > 0);
  heights.sort((a, b) => a - b);
  const medianTextHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  // The size of every counted text node, grouped by size, so the scale guard can judge each
  // TYPE ROLE against its own 100% counterpart instead of one cell median.
  //
  // WHY THE MEDIAN ABOVE IS NO LONGER ENOUGH: a median over the whole cell moves when the
  // cell's COMPOSITION changes, not only when its scaling does. Giving a node its missing
  // type role — the correct fix — shifts the median's basis and can drag the ratio BELOW
  // the bar while every role scaled exactly 2x. The guard reads this histogram instead;
  // medianTextHeight stays because the report prints it, not because the guard trusts it.
  //
  // Reported as a measurement (a size in CSS px and a count), never a verdict -- the role
  // decision lives in tools/visual/capture.ts verifyTextScale.
  const roleSizes = new Map();
  for (const el of textNodes) {
    if (unpainted(el)) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden') continue;
    const size = Number.parseFloat(style.fontSize);
    if (!Number.isFinite(size) || size <= 0) continue;
    roleSizes.set(size, (roleSizes.get(size) || 0) + 1);
  }
  const rootFontSizePx = Number.parseFloat(rootStyle ? rootStyle.fontSize : '');
  return {
    reported: { theme: info.theme, scale: info.scale, reduceMotion: info.reduceMotion,
                themeSource: info.themeSource, insets: info.insets },
    // THE SCHEME THE RENDERER RESOLVED, read back from the same signal the app reads
    // (useColorScheme() -> matchMedia('(prefers-color-scheme: dark)')). This is NOT
    // reported.theme: the pre-paint probe resolves that from the lo-theme query FIRST,
    // so it says what the harness ASKED for. Emulation.setEmulatedMedia is a separate CDP
    // call, and a driver that passes the query without it renders the OS scheme while
    // themeSource still reads 'query' — a light cell silently captured as a dark twin.
    // Reading the resolved scheme is what lets the capture refuse that cell by name.
    resolvedColorScheme: typeof window.matchMedia === 'function'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : null,
    canvasColor: canvas,
    rootBackground: rootStyle ? rootStyle.backgroundColor : null,
    rootFontSize: rootStyle ? rootStyle.fontSize : null,
    documentScrollWidth: root.scrollWidth,
    documentClientWidth: root.clientWidth,
    bodyScrollWidth: body ? body.scrollWidth : 0,
    textNodeCount: textNodes.length,
    medianTextHeight,
    // Every distinct text size and how many nodes carried it. The guard turns these
    // into roles by dividing by rootFontSizePx; leaving the division to the guard
    // keeps this probe's output a reading rather than a judgement.
    textRoleSizes: [...roleSizes.entries()]
      .map(([px, count]) => ({ px, count }))
      .sort((a, b) => a.px - b.px),
    rootFontSizePx: Number.isFinite(rootFontSizePx) ? rootFontSizePx : null,
    route: location.pathname + location.search,
    title: document.title,
    // A blank render is the failure that looks like success: a screenshot of
    // nothing has a stable hash and zero console errors.
    mountedElements: document.querySelectorAll('body *').length,
  };
})();
`;
