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
 */
export const DEVICES = {
	"iphone-se": {
		label: "iPhone SE",
		width: 320,
		height: 568,
		dpr: 2,
		platform: "ios",
		insets: { top: 20, bottom: 0, left: 0, right: 0 },
		note: "The 320pt floor: no notch, no home indicator, the narrowest phone the app must survive.",
	},
	"iphone-15": {
		label: "iPhone 15",
		width: 390,
		height: 844,
		dpr: 3,
		platform: "ios",
		insets: { top: 59, bottom: 34, left: 0, right: 0 },
		note: "The default capture device: Dynamic Island, home indicator, 3x.",
	},
	"iphone-max": {
		label: "iPhone Pro Max",
		width: 430,
		height: 932,
		dpr: 3,
		platform: "ios",
		insets: { top: 59, bottom: 34, left: 0, right: 0 },
		note: "The large-phone case: wider rows, longer labels before they wrap.",
	},
	"android-small": {
		label: "Android 360x780",
		width: 360,
		height: 780,
		dpr: 3,
		platform: "android",
		insets: { top: 24, bottom: 0, left: 0, right: 0 },
		note: "The 48dp touch floor applies here, not 44.",
	},
	tablet: {
		label: "Tablet 834x1112",
		width: 834,
		height: 1112,
		dpr: 2,
		platform: "ios",
		insets: { top: 24, bottom: 20, left: 0, right: 0 },
		note: "iPad-portrait-ish: the split view and the two-column layout.",
	},
};

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
export const SCREENS = {
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

/** Read the resolved theme/scale and the app's own canvas colour, per frame. */
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
