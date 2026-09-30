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
	"S3-custom": { label: "Custom URL + password", path: "/custom" },
	S4: { label: "Sessions list", path: "/" },
	S5: { label: "Session", path: "/session/{sessionId}" },
	S6: { label: "Subagent", path: "/session/{sessionId}/agent/{jobId}" },
	S7: { label: "New session", path: "/new" },
	S8: { label: "Pending card", path: "/session/{sessionId}" },
	S9: { label: "Sheets", path: "/session/{sessionId}" },
	S10: { label: "Past sessions", path: "/past" },
	S11: { label: "Settings", path: "/settings" },
	S13: { label: "Refused / unreachable", path: "/tunnels" },
	S14: { label: "Demo mode", path: "/demo" },
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
	S2: "custom-route-screen",
	S3: "computers-screen",
	"S3-custom": "custom-route-screen",
	S4: "sessions-screen",
	S5: "session-screen",
	S6: "subagent-screen",
	S7: "new-session-screen",
	S8: "session-screen",
	S9: "session-screen",
	S10: "past-sessions-screen",
	S11: "settings-screen",
	S13: "computers-screen",
	S14: "welcome-screen",
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
 * empty state is a specific screen's `*-empty` marker, so seeing one on a cell
 * that asked for populated, streaming or error means the state was never reached.
 * `empty` is the one state where the marker is required rather than forbidden,
 * which is also what stops a check that only forbids from passing vacuously.
 */

export const READINESS_PROBE = `
(() => {
  const testIds = Array.from(document.querySelectorAll('[data-testid]'))
    .map((el) => el.getAttribute('data-testid'))
    .filter((id) => typeof id === 'string');
  const text = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 240) : '';
  return {
    path: location.pathname,
    testIds,
    text,
    elementCount: document.querySelectorAll('*').length,
  };
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
  const heights = textNodes.slice(0, 400).map((el) => el.getBoundingClientRect().height).filter((h) => h > 0);
  heights.sort((a, b) => a - b);
  const medianTextHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  return {
    reported: { theme: info.theme, scale: info.scale, reduceMotion: info.reduceMotion,
                themeSource: info.themeSource, insets: info.insets },
    canvasColor: canvas,
    rootBackground: rootStyle ? rootStyle.backgroundColor : null,
    rootFontSize: rootStyle ? rootStyle.fontSize : null,
    documentScrollWidth: root.scrollWidth,
    documentClientWidth: root.clientWidth,
    bodyScrollWidth: body ? body.scrollWidth : 0,
    textNodeCount: textNodes.length,
    medianTextHeight,
    route: location.pathname + location.search,
    title: document.title,
    // A blank render is the failure that looks like success: a screenshot of
    // nothing has a stable hash and zero console errors.
    mountedElements: document.querySelectorAll('body *').length,
  };
})();
`;
