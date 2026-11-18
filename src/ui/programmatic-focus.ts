/**
 * For a node that only CODE focuses — a sheet title focused on open so a screen
 * reader starts there, or an overlay's scrim that react-native-web's modal focus
 * trap lands on — never a node a keyboard reader tabs to.
 *
 * The browser draws its default focus ring on such a node as soon as it is
 * focused without a pointer (a hardware keyboard opened the overlay, or the page
 * has seen no pointer yet), and the ring then outlines a title or the whole
 * viewport's edge for no key the reader pressed. A node that is not a Tab stop
 * gains nothing from that ring; every control the reader CAN tab to keeps the
 * kit's focus-visible ring (docs/design/components.md § 1).
 *
 * `web:` only: native has no browser ring, and its accessibility focus is
 * untouched.
 */
export const PROGRAMMATIC_FOCUS_CLASS = "web:outline-none";

/**
 * Take a pointer-only control out of the WEB tab order and leave native alone.
 *
 * On Android `tabIndex` maps to the view's keyboard focusability, so passing it
 * unconditionally would change a native control; on the web it keeps a duplicate
 * of a labelled control (a scrim beside its Close button) from being a Tab stop.
 */
export const webPointerOnly = (platform: string): { tabIndex?: -1 } =>
	platform === "web" ? { tabIndex: -1 } : {};

/**
 * Where focus that LANDS on an overlay's scrim is sent on the web.
 *
 * `tabIndex={-1}` keeps the scrim out of the browser's own Tab sequence, but
 * react-native-web's modal focus trap does not use that sequence: when Tab wraps
 * past the last (or first) control it calls `focus()` on each node in DOM order
 * and keeps the first that accepts it — and a `tabIndex={-1}` node does. The
 * scrim is first in DOM order, so every wrap landed there: an invisible stop
 * named "Close" that Enter would act on (review round 1: R1 / D1 / Q1). A
 * listener on the scrim forwards that focus to a visible control instead — the
 * sheet's title when the sheet focuses its title on open, otherwise its Close
 * (the drawer forwards to its own Close, `CONTROL.sidebarClose`). A Shift+Tab
 * wrap still reaches the LAST control: the trap compares the re-landed node
 * with the one it left and walks from the end when they match.
 */
export const scrimFocusRedirect = (focusTitle: boolean): "title" | "close" =>
	focusTitle ? "title" : "close";

/**
 * Whether a title that the overlay focuses on open hides its browser ring.
 *
 * Only for that first, programmatic focus. Once the title has lost focus, a
 * return to it is the keyboard's — a Tab wrap forwarded from the scrim — and it
 * shows the ring like any other stop, so no keyboard path reaches an unmarked
 * node.
 */
export const titleRingQuiet = (blurredSinceOpen: boolean): boolean =>
	!blurredSinceOpen;
