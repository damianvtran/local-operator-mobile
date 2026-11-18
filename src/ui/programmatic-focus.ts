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
