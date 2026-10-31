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

import {
	type ComponentProps,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
} from "react";
import { Platform, View } from "react-native";

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
		const previous = {
			dir: root.getAttribute("dir"),
			lang: root.getAttribute("lang"),
		};
		root.setAttribute("dir", direction);
		root.setAttribute("lang", activeLocale());
		/* Put back what the document had: this effect re-runs on every direction
		 * change and a test or story mounts the provider more than once, so an
		 * unmount that left `dir="rtl"` behind would lay the NEXT tree out
		 * right-to-left. */
		return () => {
			for (const [name, value] of Object.entries(previous)) {
				if (value === null) root.removeAttribute(name);
				else root.setAttribute(name, value);
			}
		};
	}, [direction]);

	return (
		<DirectionContext.Provider value={direction}>
			{children}
		</DirectionContext.Provider>
	);
};

/**
 * A `View` that carries the active direction on BOTH channels. Used for the app
 * root and for each modal root (`Sheet`, `Dialog`), so there is one definition of
 * "this subtree is laid out in the active direction".
 *
 * WHY TWO CHANNELS. The `direction` style is what Yoga reads on native and what
 * CSS-class utilities (`ps-*`, `border-s`, `ms-auto`) resolve against on web. It
 * does NOT reach react-native-web's own style objects: RNW resolves `start`/`end`/
 * `marginStart`/`paddingEnd`... in an INLINE `style` from its locale context,
 * which only a `dir`/`lang` PROP on a View sets (neither a `direction` style nor
 * `<html dir>` does). So `style={{ end: 0 }}` stayed on the physical right in an
 * RTL session until the prop was added. `dir` is inert on native.
 */
export const DirectionView = ({
	style,
	...rest
}: ComponentProps<typeof View>) => {
	const direction = useDirection();
	/* `dir` is not in React Native's `ViewProps` typings (it is a react-native-web
	 * prop, and a no-op prop on native), so it is attached through a typed spread
	 * rather than a cast on the element. */
	const web: object = { dir: direction };
	return <View {...rest} {...web} style={[{ direction }, style]} />;
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
 *     its whole line (a command, a code listing). The alignment is per platform
 *     because "left" does not mean the same thing on both:
 *       web    `left` is physical, and inside an RTL document that is the edge a
 *              left-to-right block belongs on.
 *       native React Native SWAPS `left`/`right` itself whenever the paragraph's
 *              layout direction is RTL (iOS `RCTAttributedTextUtils.mm`, the
 *              `layoutDirection == RightToLeft` branch), so `left` under the Urdu
 *              root lands on the physical RIGHT. `auto` is Natural alignment, which
 *              on iOS follows the paragraph's `writingDirection: "ltr"` to the
 *              left edge.
 *              ANDROID IS NOT ESTABLISHED. `<Text>` goes through
 *              `TextLayoutManager.getTextAlignment`, and Android ignores
 *              `writingDirection` there, so `auto` will probably put a command or
 *              code block on the physical right under an RTL layout. This is a
 *              reasoned reading of RN source, not a measured frame: it needs an
 *              Android RTL frame, which the Urdu change must take before it ships.
 *   - `LTR_WRITING` states only the direction, for a value that must still sit
 *     against the sentence's trailing edge (a diagnostic value column).
 */
export const LTR_TEXT = {
	writingDirection: "ltr",
	textAlign: Platform.OS === "web" ? "left" : "auto",
} as const;

export const LTR_WRITING = { writingDirection: "ltr" } as const;

/**
 * Trailing-edge text alignment, as a class: ONE definition for every column that
 * has to sit against the end of its line (a clock, a percentage, a value column).
 *
 * WHY TWO UTILITIES. The platforms disagree about what `textAlign: "right"` means
 * under a right-to-left layout, so no single class is right on both:
 *
 *   - **web**: `text-align: end` follows the element's computed `direction`, which
 *     is exactly the behaviour wanted, and `right` would be physical (wrong in RTL).
 *   - **native**: React Native has no `end`. Its text layer maps only
 *     `auto|start -> Natural`, `left`, `center`, `right`, `justify`, and logs
 *     "Unsupported TextAlignment value" for anything else, falling back to
 *     Natural, i.e. the LEADING edge (`ReactCommon/react/renderer/attributedstring/
 *     conversions.h`, `fromRawValue(... TextAlignment&)`). So `text-end` silently
 *     left-aligns a column in ENGLISH. `right`, however, is already the trailing
 *     edge once the layout is RTL, because RN swaps `left`/`right` itself when the
 *     paragraph's layout direction is RTL (iOS `RCTAttributedTextUtils.mm`
 *     `textAttributes.layoutDirection == RightToLeft` branch; Android
 *     `TextAttributeProps.getTextAlignment` and `TextLayoutManager.getTextAlignment`).
 *     `text-right` is therefore correct on native in both directions.
 *
 * Uniwind's `web:` / `native:` variants pick the utility per platform at compile
 * time, so no `Platform.OS` branch is needed. Both utilities appear as LITERALS in
 * this file on purpose: Tailwind generates a class only for a token it can read in
 * source, and a class assembled at runtime would compile to nothing.
 */
export const TEXT_END_CLASS = "web:text-end native:text-right";
