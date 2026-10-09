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

/* The app's own identifier contract, IMPORTED rather than copied: an opener is a
 * press on a control the app declares, so the name it presses is the app's, and a
 * second spelling here would be a cell that fails the day the control is renamed
 * (`tools/lib/readiness.ts` imports the same module for the same reason). It is
 * plain TypeScript with no imports of its own, so the tooling can load it. */
import {
	CONTROL,
	findResultId,
	imagegenCancelId,
	projectMilestoneEditId,
	sessionRowId,
} from "../../src/ui/a11y.ts";
import type { Affordance } from "../lib/affordance.ts";

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
 * The `core` tier is 2268 cells: the whole declared cell list (63 cells) x 2 themes x
 * (3 phones x 4 scales + 2 tablets x 3 scales) — 63 x 2 x 18, the tier's 5 profiles —
 * and the CI job's capture step is bound at 40 minutes. Measured on the runner, that is
 * 2.24 s/cell: 403 cells in 903 s (run 37098393675, a plan of 403 cells then), so a core
 * run needs ~85 minutes. The `core` job's own bound is 115 (see `.github/workflows/e2e.yml`,
 * `web-audit-core`), which is above the 6804 s deadline its plan derives for itself. The
 * job's first real
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
 *     measures (200% over 100%), PLUS the boundary step between them — see
 *     `CI_SCALES` below for why the boundary earns the third slot and 150% does
 *     not. 150% stays in `core`, which sweeps every scale.
 *
 * That is 63 cells x 2 themes x (2 profiles x 3 scales) = 756 cells, ~28 minutes at
 * the measured rate: inside the step bound (raised with it, see `CI_SCALES`) with
 * the same headroom it always carried. `core` and `full` are unchanged and stay the
 * local and dispatched samples, so the full 2268-cell `core` matrix and the
 * 8316-cell `full` matrix remain runnable — nothing is only reachable through CI.
 */
export const CI_DEVICES: string[] = ["iphone-se", "tablet-landscape"];

/** The scale ids the CI tier runs: the 100% floor, the BOUNDARY step, and the 200%
 * ceiling.
 *
 * WHY THE BOUNDARY IS HERE RATHER THAN A MID-POINT. This axis carried 100 and 200 —
 * which BRACKET the band the footer's layout breaks in (1.35 to 1.4), and an axis that
 * brackets a failure cannot see it. That defect reached review once, so its prior on
 * this surface is high, and it is not worth waiting for the nightly to find the next
 * one. `135` is that boundary: 1.3529411765, the largest standard iOS Dynamic Type
 * step, and the value the web build derives from a 22 px root. A mid-point inside a
 * range that now behaves continuously (there is no threshold left to sit between)
 * earns less per push than the boundary itself does. The nightly `core` tier still
 * sweeps every scale, so nothing is lost by composing the two sets differently.
 *
 * WHAT IT COSTS, because it is NOT free and the two are one decision. Three scales on
 * both CI profiles is 756 cells, +50 % over the two-scale 504, so the per-push capture
 * and audit bounds in `.github/workflows/e2e.yml` were raised with it — most recently to
 * capture 40 / audit 20 / job 80. That is this slice's ten cells (nine lifecycle surfaces
 * and the pane's long-press menu) on top of the base the branch was cut from, plus the
 * four cells upstream landed while it was open, plus the find slice's four: the cell list
 * is 63 and the sample is 756, both re-derived from this head's own `--plan` rather than
 * scaled — still inside the 40-minute capture bound (756 x 3 s = 37.8 min). A bound that fires every run stops being a signal, so
 * this list and that bound have to move together: reverting the bounds without
 * reverting this list makes the job red, and reverting this list without the bounds
 * wastes the budget it was sized for. */
export const CI_SCALES: string[] = ["100", "135", "200"];

export const THEMES = ["dark", "light"];

/** Text scales as a multiplier of the app's default. 1 = the OS default. */
export const SCALES = [
	{ id: "100", factor: 1 },
	/* THE IN-BETWEEN STEP, and it is here because an axis that BRACKETS a failure
	 *  cannot see it. The footer's column-versus-pair boundary used to sit at
	 *  `LARGE_TEXT_SCALE` (1.4), which left a band — 1.35 up to 1.4 — INSIDE the
	 *  layout branch it was supposed to protect: the pair only broke above 1.4, so
	 *  every scale in that band wrapped a label (design review round 2, D6). No cell could
	 *  show it, because the nearest captured scales were 100 and 150 and both sit
	 *  outside it. The factor is the exact iOS `xxxLarge` Dynamic Type step rather
	 *  than a round 1.35: it is a setting a real user has, and it is on the failing
	 *  side of the boundary the round measured (the browser's own 22 px default,
	 *  1.375, is the other in-band value and behaves the same way). The footer fix
	 *  removes the threshold entirely, so what this axis step now protects is the
	 *  ABSENCE of a threshold — see `conversations-pane.tsx`. */
	{ id: "135", factor: 1.3529411765 },
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
  // A DRAFT a cell wants on screen ('lo-draft'). The composer reads its draft from
  // the device store — localStorage on the web target, keyed per session — so the
  // seed has to land before the app's first read, and it has to spell the key the app
  // builds itself ('lo-mobile-draft:' + sessionId, src/features/session/device-storage.ts).
  // It exists because a draft is the one composer state no relay scenario can produce:
  // it is the reader's own unfinished sentence, stored on the device, and the visual
  // round needs a filled field to review states against (the STT recording bar was
  // reviewed over one). Absent, the field stays empty — nothing else about a cell changes.
  const seededDraft = params.get('lo-draft');
  if (seededDraft !== null) {
    const segments = location.pathname.split('/');
    const sessionId = segments[1] === 'session' ? (segments[2] || '') : '';
    try {
      localStorage.setItem('lo-mobile-draft:' + sessionId, seededDraft);
    } catch {
      // A storage-denied profile renders an empty field; the cell still captures.
    }
  }
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
 * The actions a cell takes before it settles — the harness's own press.
 *
 * A cell is a state, and until this table existed a state had to be reachable by
 * URL alone: the harness navigates and waits, it does not open a panel. So every
 * state BEHIND A CONTROL had no cell, which is a whole class of surface a design
 * or QA round is asked to sign off with no frame behind it — `S9/populated` was
 * withdrawn as a cell for exactly that reason.
 *
 * WHAT AN ENTRY MAY DO is deliberately two things (`tools/lib/affordance.ts`):
 * press a control by its declared id, and put text into a field. Both are things
 * a READER does; neither is a hook the app has to carry for the harness. The
 * states they reach are reached through the app's own code and the relay's own
 * wire — a refusal cell gets the relay's sentence because the app really asked
 * and was really refused, and a busy cell is busy because the relay really has
 * not answered.
 *
 * RECORDED, NOT RE-DERIVED. The capture writes the actions it applied into the
 * manifest and the audit REPLAYS them from that record, the same rule the seed
 * follows: a re-drive that re-derived the list from this table would be measuring
 * whatever this table says today rather than what the frame was taken of.
 *
 * ONE ENTRY PER CELL, and the cell name is the key: a cell whose opener moved is
 * a cell that fails, loudly, with the missing id in the sentence.
 */
/**
 * Controls a reader must be able to press WITHOUT scrolling first.
 *
 * WHY THIS LIST EXISTS. The guard in `lib/affordance.ts` scrolls an off-screen
 * control into view before pressing it, because that is what a reader does — but
 * then `ok` alone would turn "the reader could not see this control" into a pass,
 * which is exactly the class the projects lifecycle's round-1 design finding was
 * about (the create sheet's `Create` and its refusal both below the fold at every
 * scale on both phones, the refusal painting in 11 of 28 combinations). Relying on
 * U-05/U-08 to catch that after the fact is what let an automated capture pass a
 * screen a human had to find by eye. So a control can be DECLARED here, and a
 * press that needed a scroll then fails the cell by name, with the control's
 * resting box in the sentence.
 *
 * WHAT BELONGS ON IT: the control that ANSWERS a surface — the submit of a form, a
 * confirm's action — never a control the reader navigates with (a row, a header
 * action, a list item). Those are reachable by scrolling on any scrolling screen,
 * which is why the guard presses them and why they are not declared.
 *
 * The answer carries the pre-scroll box, so the sentence reads as evidence rather
 * than as a complaint: `x=17 y=812` is where the reader would have had to look.
 */
export const UNSCROLLED_CONTROLS: readonly string[] = [
	CONTROL.projectCreateSubmit,
	CONTROL.projectMilestoneSubmit,
	CONTROL.projectMilestoneRemove,
];

/**
 * The cells reach a state by PRESSING controls, declared per cell here and
 * replayed by the audit's re-drive.
 *
 * `S15/menu-open` is the one cell in this matrix reached by HOLDING a control: the
 * conversations pane's row menu is a long-press surface, `onLongPress` fires on a
 * timer while the finger is down, and no click can produce it. It is the cell that
 * makes round 3's BLOCKER observable — the menu is a `Sheet` rendered inside the
 * drawer's own `Modal`, so a drawer that stands down for it unmounts the press
 * that opened it.
 *
 * 1200 ms, and the duration is MEASURED rather than chosen: React Native's own
 * `delayLongPress` is 500 ms, but a held press delivered to a just-booted page
 * does not always reach the responder system in time — at 600 ms the menu opened
 * on three of four cells and the cold-boot cell instead took the release as a TAP
 * and navigated to the session (the cell then failed its own marker, which is how
 * the gap was found rather than shipped). At 1200 ms all four open it.
 */
export const CELL_OPENERS: Record<string, Affordance[]> = {
	/* --- the pane's long-press menu (S15) --- */
	"S15/menu-open": [
		{
			hold: {
				testID: sessionRowId("6714def86197"),
				ms: 1200,
			},
		},
	],
	/* --- the create sheet, over the listing (S16) --- */
	"S16/create": [{ click: CONTROL.projectsNew }],
	/* The same sheet with a reader's own values in it: what the form looks like
	 *  filled, which is the state a design round judges the spacing and the
	 *  wrapping against. The description is deliberately a sentence rather than a
	 *  word — the field is the one that has to hold prose. */
	"S16/create-filled": [
		{ click: CONTROL.projectsNew },
		{
			type: {
				testID: CONTROL.projectCreateName,
				text: "vendor-sso-cutover",
			},
		},
		{
			type: {
				testID: CONTROL.projectCreateDescription,
				text: "Move the last three services off the vendor's SSO before the contract lapses.",
			},
		},
	],
	/* A name the seeded store ALREADY holds, submitted: the store answers its own
	 *  `409 project_name_exists` and the sheet renders that sentence. Nothing in
	 *  the harness writes the refusal — the mock is the store, and the sentence is
	 *  the one the app prints from the answer. */
	"S16/create-refused": [
		{ click: CONTROL.projectsNew },
		{ type: { testID: CONTROL.projectCreateName, text: "payments-migration" } },
		{ click: CONTROL.projectCreateSubmit },
	],
	/* The same submit against a relay that never answers (`projects-write-busy`). */
	"S16/create-busy": [
		{ click: CONTROL.projectsNew },
		{ type: { testID: CONTROL.projectCreateName, text: "vendor-sso-cutover" } },
		{ click: CONTROL.projectCreateSubmit },
	],

	/* --- the milestone editor and the two confirms (S16 detail) --- */
	"S16-detail/milestone-editor": [{ click: CONTROL.projectAddMilestone }],
	/* The slash refusal, WHILE IT IS TYPED: the guard is the phone's, because the
	 *  route that removes a milestone carries its name in the path. Nothing is
	 *  submitted, so the explanation is what the frame is about. */
	"S16-detail/slash": [
		{ click: CONTROL.projectAddMilestone },
		{ type: { testID: CONTROL.projectMilestoneName, text: "ship/v2" } },
	],
	/* Removal lives inside the editor of an EXISTING milestone, behind its own
	 *  confirm — two presses, which is the point: the first opens the editor, the
	 *  second asks. */
	"S16-detail/milestone-remove": [
		{ click: projectMilestoneEditId("beta cut") },
		{ click: CONTROL.projectMilestoneRemove },
	],
	/* A milestone write the relay never answers, pressed from the EDITOR rather
	 *  than from a row toggle, and for an evidence reason worth stating: the sheet
	 *  is an overlay, so the in-flight state is on screen at every scale, while a
	 *  row toggle's own row sits below the fold on a 320 pt phone at 200 %. The
	 *  screen-level `project-milestone-busy` marker is the same either way — this
	 *  is about what the FRAME can show, not about what the app does. */
	"S16-detail/busy": [
		{ click: projectMilestoneEditId("beta cut") },
		{ click: CONTROL.projectMilestoneSubmit },
	],
	/* The project delete's confirm: the first tap sends NOTHING (the deletion is
	 *  not undoable), so this frame is the question, not the answer. */
	"S16-detail/delete-confirm": [{ click: CONTROL.projectDelete }],

	/* The image-gen card's CANCEL-REQUESTED state, on the ad-hoc path cell the
	 *  `imagegen-progress` fixture drives. The press is the app's own Cancel —
	 *  the existing turn interrupt — against a relay whose scenario never
	 *  confirms it, so the frame shows the honest in-between state this lane
	 *  exists to get right: pressed and not yet settled, never optimistic
	 *  "cancelled". The target is the row the fixture's determinate card owns
	 *  (`tc-img-running-determinate`), which the tail view reaches. */
	"path:/session/{sessionId}/imagegen-cancel": [
		{ click: imagegenCancelId("tc-img-running-determinate") },
	],
	/* --- the in-conversation find, over the long conversation (see the cells
	 * on the `long-transcript` scenario). The lever and the field are the app's
	 * controls; the result press is a reader choosing a hit, addressed by the
	 * message it will land on. "conversion" matches exactly two user messages
	 * and nothing else (the soft tier's neighbourhood was probed: "euro" would
	 * also have caught "turn" in every closing answer, two edits away), and the
	 * ranking is oldest-first, so the press lands on `tc-conv-03-user` — inside
	 * a CONDENSED turn, which is what makes the cell exercise the expand-first
	 * walk (the sheet closes, the turn opens, the transcript scrolls, the wash
	 * lands, the bar is up). */
	"S5/find-results": [
		{ click: CONTROL.sessionFind },
		{ type: { testID: CONTROL.findField, text: "retry" } },
	],
	"S5/find-related": [
		{ click: CONTROL.sessionFind },
		{ type: { testID: CONTROL.findField, text: "ledgr" } },
	],
	"S5/find-empty": [
		{ click: CONTROL.sessionFind },
		{ type: { testID: CONTROL.findField, text: "zebra" } },
	],
	"S5/find-hit": [
		{ click: CONTROL.sessionFind },
		{ type: { testID: CONTROL.findField, text: "conversion" } },
		{ click: findResultId("tc-conv-03-user") },
	],
	/* The scope line's caveat (design D63-3), on the history-first world (`the
	 * `long-transcript-history` scenario`): the device holds ONE incomplete
	 * history page — 4 of the conversation's 26 docs — so the sheet's footer
	 * must say so. "euro" is a query the held page CAN answer (two related
	 * answers in the closing turns), which is the point: the caveat is not the
	 * empty state's excuse, it is the scope every answer on this device is read
	 * within. */
	"S5/find-caveat": [
		{ click: CONTROL.sessionFind },
		{ type: { testID: CONTROL.findField, text: "euro" } },
	],
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
 * An entry declares the CLASS — the cells that may coincide at some device, scale or
 * seed — and a produced group qualifies when it is CONTAINED in one. Keep this table
 * EMPTY unless a class is genuinely a camera limit, and let the reason name the viewport
 * it was measured on: the exemption is a statement about the frame, not about the app.
 *
 * WHY A CLASS AND NOT A KEY. These entries replaced a `Record<string, string>` whose key
 * was the colliding group's cell names sorted and joined with `|` — ONE EXACT SUBSET.
 * That shape cannot state what the entries mean. The same three cells collide as a
 * three-way group at 200 % and as a pair at 135 % (`S5/populated-long` = `S5/subagents`,
 * measured on the ci tier the day its axis gained the 135 % step), so the pair matched no
 * literal, the blocking gate red on a phenomenon a reviewer had already approved, and the
 * only remedy the shape allowed was one literal per subset — whack-a-mole across every
 * scale, device and seed that produces a different subset of the same cells. The class is
 * what a reviewer approves; the subset is what a run happens to produce.
 */
export interface IdenticalFrameClass {
	/** The cells that may coincide at SOME device, scale or seed — the class itself. */
	cells: string[];
	/** Why that coincidence is a limit of the comparison rather than a collapse. */
	reason: string;
}

export const IDENTICAL_FRAME_EXEMPTIONS: IdenticalFrameClass[] = [
	{
		cells: ["S16/populated", "S16/unknown-status"],
		reason:
			"below-the-fold at iphone-se / 200 %: the 320 px column at 200 % text is filled by the " +
			"list's own header (`Projects`) and its first two sections, and the one thing that " +
			"distinguishes the two cells — the UNKNOWN STATUS section, which is the feature this " +
			"cell exists to prove — is placed LAST by `groupProjectsByStatus` (a status this build " +
			"does not know sorts after every known one) and starts below the viewport, so the PNG " +
			"is the same chrome. The content differs (each cell reaches its own marker, " +
			"`projects-populated` / `projects-unknown-status`), which is what makes this a limit " +
			"of the camera rather than a collapse; at 100 % the swapped row is still above the " +
			"fold and the two frames differ, and so does both cells at tablet-landscape, so " +
			"the states are distinguishable everywhere except the narrowest column at the " +
			"largest text. The two cells are the whole class: no other pair involving either has " +
			"ever collided.",
	},
	{
		cells: [
			"S5/populated-long",
			"S5/rich-rows",
			"S5/subagents",
			"S5/tables",
			"S5/tables-end",
			"S5/tables-in-view",
			"S5/streaming-tables",
			"path:/session/{sessionId}?lo-scroll=top/condensed",
			"path:/session/{sessionId}?lo-scroll=top&lo-expand=tc-conv-00-user/expanded",
			"path:/session/6714def86197/warm",
			"S5/find-hit",
		],
		reason:
			"below-the-fold at iphone-se / 200 %: the 320 px column at 200 % text is filled by the " +
			"session header (`Refactor… client`, the context/task/subagent panel rows), and the rows " +
			"that distinguish these cells — the 520-row transcript, the code-block/diff/table " +
			"rows, the subagent roster's own rows, and the transcript's TOP (the message-plus-bar " +
			"rows the two `path:` cells pin the viewport to) — start below the viewport, so the PNG " +
			"is all chrome. The content differs for every subset the one-view coincidences on this " +
			"class's cells do not carry — each such cell reaches its own root or marker — which is " +
			"what makes this a limit of the camera rather than a collapse. The subsets the " +
			"coincidence entries carry — `S5/populated-long` against the `?lo-scroll=top/condensed` " +
			"cell at iphone-se / 200 % (content digests EQUAL: `3911696863f1487d` dark, " +
			"`0063b6b8723f5676` light — run 37529153608), `S5/tables` against `S5/tables-end` at " +
			"iphone-se / light / 200 %, and the warm-up cell against `S5/streaming-tables` where " +
			"both read the pre-stream chrome — are compositions declared there; the check consults " +
			"that " +
			"table for a same-content partition before this one, so this entry is only ever asked " +
			"for the subsets it can describe. " +
			"THE CLASS IS ONE ENTRY ACROSS EVERY NAME IT HAS GROWN, on purpose: it was declared " +
			"for `S5/populated-long` and `S5/rich-rows`, a third cell joined it when the capture " +
			"first completed a whole tier — until then the stalls left cells missing and the " +
			"comparison could not form the group — and the two `path:` cells joined it when the " +
			"long-transcript scenario grew a top and an open state of its own (measured on the ci " +
			"run of 37522263768, where the five rendered byte-identical at iphone-se and their " +
			"content digests differed for every subset except the `S5/populated-long` = " +
			"`?lo-scroll=top/condensed` pair the coincidence entries carry). The S5 redesign's " +
			"two table cells JOIN the class (measured 2026-10-06 on `fix/hero-tables-strips`): " +
			"at 200 % their wide table and the code rows above it are below the same fold, so " +
			"`S5/tables` at iphone-15/light/200 % and `S5/tables-end` at iphone-se/dark/200 % " +
			"share bytes with `S5/rich-rows` while the three cells' content digests all differ " +
			"(`rich-rows` 0f1e6030ab8f, `tables` 1bc50098bd2d). `S5/tables-in-view` " +
			"JOINS (review rounds 2–3): the pair it produces here is content-differs-frames-agree — " +
			"measured at iphone-se/dark/100 and tablet-landscape/dark/100 — where the assertion's " +
			"scroll re-renders the transcript's virtualization window without moving a drawn " +
			"pixel, which is this camera limit; wherever the assertion cannot move anything the " +
			"contents agree and the pair is the COINCIDENCE below. `S5/streaming-tables` " +
			"JOINS (review round 3): wherever its settled frame is the same chrome the warm-up " +
			"cell draws (its transcript below the fold) the bytes agree while its content digest " +
			"still carries the streaming rows — the same bytes with different content, which is " +
			"this camera limit. The WARM-UP " +
			"CELL JOINS " +
			"TOO, and it is the class's clearest case: it is the run's first navigation " +
			"(`path:/session/6714def86197/warm`, the cell that burns the cold start), it " +
			"renders the same idle world at the same 320 pt column, and at 200 % its " +
			"frame is the identical chrome — while it declares no state a frame could " +
			"deny (its capture record is the run's one recorded unready cell, by design). " +
			"A cell joining an existing entry is evidence that the phenomenon is the one that entry " +
			"describes, so it extends the statement rather than opening a second entry for the same " +
			"thing. Declaring the CLASS is what makes that hold at every scale: these cells collide " +
			"in whichever SUBSET a device, theme and scale produce — the widest subsets at 200 % on " +
			"the narrowest column, narrower subsets at 135 % and 100 % — and every subset not carried " +
			"by the coincidence entries is this phenomenon, not a finding of its own. " +
			"`S5/find-hit` JOINS (this slice's find landing, measured on its own capture): " +
			"its settled frame at iphone-se / 200 % is the same chrome the warm-up cell draws — " +
			"the find bar it adds to the column sits under the same fold — while its content " +
			"digest still carries the landed transcript, which is the same-bytes-different-" +
			"content shape this entry describes.",
	},
];

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
 * A class is consulted ONLY when every cell in the partition is EVIDENTIAL (ready, not
 * skipped), so a partition in which any state's own marker is missing can never declare
 * itself out of a collapse; an undeclared same-content partition still FAILS, exactly
 * as it did before this table existed. The entries use the same `IdenticalFrameClass`
 * shape and the same CONTAINMENT rule as the exemptions above — one class, whichever
 * subset a run produces — for the same reason: a composition can coincide for a subset
 * of its cells at one device and a superset at another, and a key per subset would red
 * on the phenomenon the class already states.
 */
export const IDENTICAL_FRAME_COINCIDENCES: IdenticalFrameClass[] = [
	{
		cells: ["S15/empty", "S4/idle"],
		reason:
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
	},
	{
		cells: [
			"S5/populated-long",
			"path:/session/{sessionId}?lo-scroll=top/condensed",
		],
		reason:
			"one view, two scroll positions at iphone-se / 200 %: at 320 px with 200 % text the " +
			"transcript's visible area is a sliver between the session header and its panels, and " +
			"the list's window sits at its TOP in both cells — the tail-following " +
			"`S5/populated-long` renders the same first rows as the anchored " +
			"`path:…condensed`, which is why the same bytes carry the same content and the " +
			"identical-state check reads one view. The readings agree on it: at dark/200 both " +
			"cells' `readiness.text` begins `Refactor… client … Reconcile last night's ledger " +
			"and tell me what slipped. ✓ completed · 38 steps …` and their content digests are " +
			"EQUAL (3911696863f1487d; 0063b6b8723f5676 at light/200 — run 37529153608). The " +
			"claims do not collide where the transcript has room: at 100 % and 135 % the two " +
			"cells render different bytes (dark/100 152d8908 vs 0bd818dc; light/100 922d64ec vs " +
			"3b9115da; dark/135 d8d3dafb vs e66aba68; light/135 c7a6c724 vs 4eece5e6), so " +
			"neither cell is a duplicate of the other and neither declaration can be removed. " +
			"Every cell still reaches the session screen with its relay-backed session, and at " +
			"this exact combo both carry the condensed turn bars as visible ids " +
			"(`session-screen`, `turn-bar-tc-conv-00-user` … in the visible set), which is what " +
			"keeps this a composition at that viewport rather than a collapse of either state.",
	},
	{
		cells: ["S5/tables", "S5/tables-end", "S5/tables-in-view"],
		reason:
			"one state, one scroll offset apart, at iphone-se / light / 200 %: the two cells are " +
			"the SAME transcript — `tables-end` is `tables` with the wide table scrolled to its " +
			"end by the `lo-md-scroll` viewer hook — and at 200 % on the 320 px column that table " +
			"sits below the viewport in BOTH frames, so the drawn bytes (9d2fd4f444d83737) and the " +
			"content digest are identical while each cell still reaches `session-tables` and " +
			"renders its own state. Wherever the table IS on screen the frames differ — every " +
			"100 % frame on both devices, and dark/200 on iphone-15 — which is what makes this a " +
			"camera limit written as a coincidence rather than two cells that collapsed: the " +
			"state really is the same content one interaction later, and the viewport is the " +
			"only thing that hides the difference. Measured 2026-10-06 on " +
			"`fix/hero-tables-strips`. `S5/tables-in-view` joins the class for the variants " +
			"where ITS assertion moves nothing — the same view AND the same content — measured " +
			"at 135 %/200 % on both phones, all four phone-200 pairs included; the 100 % pairs, " +
			"where the assertion does change the rendered content, are the camera-limit " +
			"exemption above.",
	},
	{
		cells: ["path:/session/6714def86197/warm", "S5/streaming-tables"],
		reason:
			"one view, two moments at the run's cold start: the warm-up cell is the run's first " +
			"navigation and the streaming cell's first recorded frame is the app before its " +
			"stream paints, so wherever both frames are the pre-stream chrome their bytes AND " +
			"their content readings agree — measured in the round-3 manifest as three instances " +
			"with equal content digests (frame shas 8ec3af99 and dce80132 both carrying " +
			"518394c9dde43c82; b1902fcc carrying f636734bed283eb7). The same bytes are correct " +
			"there: at that instant the app really is one view — the session screen ahead of the " +
			"stream — and each cell still reaches the run it declares. Once the stream paints " +
			"the frames differ (the transcript arrives), and where the frame is the pre-paint " +
			"blank while the streaming cell's CONTENT reading already carries the streamed rows, " +
			"the pair is the camera-limit exemption above, not this entry: the halves are " +
			"declared separately because they are different phenomena, and only a run in which " +
			"the warm-up cell is itself evidential can consult this entry at all.",
	},
];

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
    /*
     * WHERE THE PAGE IS SCROLLED TO at the moment the frame is taken — the number a
     * reviewer needs and no PNG can give (review round 3, D9).
     *
     * The guard restores every scroll it moved, so the claim "this frame is of the
     * resting page" is checkable only against these offsets: a frame of a displaced
     * page has a non-zero entry here, and a byte-stability argument cannot tell the
     * two apart because a displaced page is just as stable as a rested one. The
     * document and the body are read directly; every other scroller that is
     * actually displaced is listed by its own offset.
     */
    scroll: {
      document: root.scrollTop,
      body: body ? body.scrollTop : 0,
      displaced: [...document.querySelectorAll('body *')]
        .filter((el) => el.scrollTop !== 0 || el.scrollLeft !== 0)
        .slice(0, 8)
        .map((el) => ({ top: el.scrollTop, left: el.scrollLeft })),
    },
    // A blank render is the failure that looks like success: a screenshot of
    // nothing has a stable hash and zero console errors.
    mountedElements: document.querySelectorAll('body *').length,
  };
})();
`;
