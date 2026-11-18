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
 * Where the guard below sends focus that LANDS on an overlay's scrim on the web.
 *
 * `tabIndex={-1}` keeps the scrim out of the browser's own Tab sequence, but
 * react-native-web's modal focus trap does not use that sequence: when Tab wraps
 * past the last (or first) control, and when the overlay opens, it calls
 * `focus()` on each node in DOM order and keeps the first where focus STAYS —
 * and a `tabIndex={-1}` node accepts it. The scrim is first in DOM order, so
 * every wrap stopped there: an unmarked stop named "Close" that Enter would act
 * on (review round 1: R1 / D1 / Q1).
 *
 * The guard moves KEYBOARD focus off the scrim at once (`keyboard`: the last
 * input was a key, `keyboardInput`). Inside a trap walk that makes the trap's
 * check on the scrim fail, so the walk continues to the panel's FIRST control —
 * the drawer's Agents segment, the row menu's Close, a title-focusing sheet's
 * title — and that, not this function's answer, is where the reader lands
 * (review round 2, R2-1 / Q5). The answer is where focus goes when no walk
 * follows. Opened by touch, mouse, or with no input at all (a deep link to
 * /conversations, review round 2 Q6), the open-time focus stays on the ringless
 * scrim, so no ring appears on a surface the reader never touched a key in. A
 * title-focusing sheet always forwards to its title, whose open-time ring is
 * quiet anyway (`titleRingQuiet`).
 */
export const scrimFocusRedirect = (
	focusTitle: boolean,
	keyboard: boolean,
): "title" | "close" | null => {
	if (focusTitle) return "title";
	return keyboard ? "close" : null;
};

type FocusInTarget = Pick<
	HTMLElement,
	"addEventListener" | "removeEventListener"
>;

/**
 * Install the scrim guard: when the scrim ITSELF receives focus, focus
 * `redirect()`'s node instead (nothing when it answers null). Returns the
 * cleanup. Shared by `Sheet` and `ConversationsDrawer` so the behaviour that
 * `programmatic-focus.test.ts` drives through the library's own trap code is
 * the one both overlays run.
 *
 * WHY A LISTENER ON THE SCRIM AND NOT A RE-FOCUS: it fires only when the scrim
 * itself is focused, so a control still on screen (the persistent pane header
 * in split layout) is never robbed of focus by a blanket refocus.
 */
export const guardScrimFocus = (
	scrim: FocusInTarget,
	redirect: () => Pick<HTMLElement, "focus"> | null | undefined,
): (() => void) => {
	const onFocusIn = (event: Event) => {
		if (event.target !== scrim) return;
		redirect()?.focus({ preventScroll: true });
	};
	scrim.addEventListener("focusin", onFocusIn);
	return () => scrim.removeEventListener("focusin", onFocusIn);
};

/**
 * The last input's modality: a key, or a pointer (mouse, touch, pen). Starts
 * as pointer, so focus placed before any input — a deep link, a reload — is
 * code-only focus and stays quiet. Chrome's own `:focus-visible` treats "no
 * input yet" as keyboard, which put a ring on the drawer's first control on a
 * deep link (review round 2, Q6).
 */
export const createInputModality = () => {
	let keyboard = false;
	return {
		record: (input: "keyboard" | "pointer") => {
			keyboard = input === "keyboard";
		},
		keyboard: () => keyboard,
	};
};

let webModality: ReturnType<typeof createInputModality> | null = null;

/**
 * Whether the last input on the page was a key. Web only: the document-level
 * listeners are installed on first call, in the capture phase so a handler that
 * stops propagation cannot hide an input. Off the web there is no trap and no
 * caller, and this answers false.
 */
export const keyboardInput = (): boolean => {
	if (typeof document === "undefined") return false;
	if (!webModality) {
		const modality = createInputModality();
		document.addEventListener(
			"keydown",
			() => modality.record("keyboard"),
			true,
		);
		for (const type of ["pointerdown", "mousedown", "touchstart"]) {
			document.addEventListener(type, () => modality.record("pointer"), true);
		}
		webModality = modality;
	}
	return webModality.keyboard();
};

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
