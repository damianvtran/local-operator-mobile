/**
 * Text direction, published once to every component that has to CHOOSE an edge.
 *
 * WHY A CONTEXT AND NOT `I18nManager`. `I18nManager.forceRTL` is the textbook way
 * to mirror a React Native app, and it cannot be used here: it only takes effect
 * after the app RESTARTS, while this app's language arrives LIVE from the relay's
 * config frame (`setLocaleSource(() => configStore.getState().language)` in
 * `connection-provider.tsx`). A reader whose computer switches to Urdu would have
 * to kill and reopen the app before anything moved — so the language would change
 * and the layout would not. Instead the direction rides a Yoga/`direction` style
 * on the root view (native) and the document element (web), both of which apply
 * immediately, and this module is what carries the resolved answer to components
 * that cannot express "start"/"end" in a class name.
 *
 * WHAT THE CONTEXT IS FOR, EXACTLY. Logical utilities (`ps-4`, `ms-auto`,
 * `start-0`, `border-s`) already flip from the layout direction with no help from
 * JavaScript, so most components never call `useDirection`. Three cases cannot:
 *
 *   1. **Native modals.** A React Native `Modal` renders through its own root, so
 *      it does not inherit the root view's direction style; `Sheet` and `Dialog`
 *      read this context and re-apply it on their own surface.
 *   2. **Glyphs that must mirror.** An icon NAMED "left" is a reading-direction
 *      affordance, not a picture of an object — see `back-icon.tsx`.
 *   3. **Mixed content** that has to keep its own direction inside translated
 *      prose — see `LTR_TEXT` below.
 *
 * WHAT IT IS DELIBERATELY NOT. A subscription of its own: the value comes from
 * `activeDirection()` at render time, and the surface that renders the root
 * subscribes to the config frame so a language change repaints. A second
 * subscription here would be a second source of truth for the same fact.
 */

import { createContext, type ReactNode, useContext, useEffect } from "react";
import { Platform } from "react-native";

import { activeLocale, type TextDirection } from "@/i18n";

/** Default `ltr`: a component rendered outside the provider (a test, a story)
 *  must behave exactly as the app does before any config frame arrives. */
const DirectionContext = createContext<TextDirection>("ltr");

/** The direction the active catalogue is laid out in. */
export const useDirection = (): TextDirection => useContext(DirectionContext);

/** Convenience for the two-way choices (`edge: rtl ? "start" : "end"`). */
export const useIsRTL = (): boolean => useContext(DirectionContext) === "rtl";

/**
 * Publishes the direction, and puts it on the web document.
 *
 * THE DOCUMENT ELEMENT IS THE WEB HALF, and it is load-bearing rather than
 * bookkeeping: react-native-web portals `Modal` content to a node under
 * `document.body`, OUTSIDE the app's root view, so a `direction` style on the
 * root would leave every sheet and dialog laid out left-to-right in an RTL
 * session. `dir` on `<html>` is inherited by those portals, and it is also what
 * makes an exported build checkable from the outside (a capture can assert
 * `document.documentElement.dir` instead of inferring direction from a pixel).
 * `lang` is written in the same breath because `dir` without the matching
 * language tag leaves a screen reader announcing Urdu copy in English — and
 * `public/index.html` ships the Expo CLI's `%LANG_ISO_CODE%` placeholder, which
 * an export resolves to a single build-time value that cannot follow the frame.
 */
export const DirectionProvider = ({
	direction,
	children,
}: {
	direction: TextDirection;
	children: ReactNode;
}) => {
	useEffect(() => {
		if (Platform.OS !== "web" || typeof document === "undefined") return;
		const root = document.documentElement;
		root.setAttribute("dir", direction);
		root.setAttribute("lang", activeLocale());
	}, [direction]);

	return (
		<DirectionContext.Provider value={direction}>
			{children}
		</DirectionContext.Provider>
	);
};

/**
 * Mixed content that must keep ITS OWN direction inside translated prose.
 *
 * Commands, paths, hostnames, code and model identifiers are left-to-right by
 * their own grammar whatever the sentence around them is; a bidi algorithm given
 * no hint will reorder the punctuation of `curl -fsS http://…` inside an Urdu
 * paragraph. The isolation belongs at the component that renders the value (never
 * a control character in the catalogue, which a translator can neither see nor
 * preserve), and these two constants are the whole mechanism:
 *
 *   - `LTR_TEXT` states the direction AND the alignment, for a block that owns
 *     its whole line (a command, a code listing). `textAlign: "left"` is written
 *     physically on purpose: React Native's `textAlign` has no `start`/`end`, and
 *     `writingDirection: "ltr"` is what makes "left" mean left on every platform
 *     (Android derives a paragraph's RTL-ness from that attribute, so the pair is
 *     self-consistent rather than fighting itself).
 *   - `LTR_WRITING` states only the direction, for a value that must still sit
 *     against the sentence's trailing edge (a diagnostic value column).
 */
export const LTR_TEXT = {
	writingDirection: "ltr",
	textAlign: "left",
} as const;

export const LTR_WRITING = { writingDirection: "ltr" } as const;
