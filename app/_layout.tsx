// The styling layer's entry, and it MUST be this import that brings it into the
// bundle: Tailwind only compiles the CSS the bundle actually pulls in. Uniwind
// reads the same file through metro.config.js's `cssEntryFile`; pointing that at a
// file nothing imports yields an export with every token variable and no utility
// class, which renders as an unstyled screen and reports success.
import "../src/ui/theme.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ComputerSwitcherProvider } from "@/features/auth/computer-switcher-sheet";
import {
	ConnectionProvider,
	useLocaleFrame,
} from "@/features/auth/connection-provider";
import { useSavedComputersHydration } from "@/features/auth/use-saved-computers-hydration";
import { useDeepLinkResolution } from "@/features/deep-links/use-deep-link-resolution";
import { activeDirection, activeLocale } from "@/i18n";
import { useNotificationTapRouting } from "@/notifications/use-notification-taps";
import { TeamBridgeProvider } from "@/team-bridge/provider";
import { ThemeProvider, useTheme } from "@/ui/appearance";
import { ToastHost } from "@/ui/components";
import { DirectionProvider, DirectionView } from "@/ui/direction";
import { TextScaleProvider } from "@/ui/text-scale-provider";

/**
 * The root layout: providers in, chrome on.
 *
 * Four providers, in the order they have to be nested:
 *
 *   1. `SafeAreaProvider` — everything below reads insets, and a screen that
 *      reads them without it silently gets zeros (content under the notch).
 *   2. `ThemeProvider` — applies the stored preference to the styling system
 *      before anything styles itself.
 *   3. `ConnectionProvider` — owns the one live route and the list stream. Above
 *      the router on purpose: the stream has to outlive every screen, and a
 *      provider inside a route would be torn down by navigation.
 *   4. `TextScaleProvider` — publishes the scaled type-scale variables, so the
 *      reader's text size is applied before any screen renders text.
 *
 * `ToastHost` sits last, above every route, so a confirmation survives the
 * navigation that follows it (signing out navigates; the message must not).
 */
export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<ThemeProvider>
				<ConnectionProvider>
					<TextScaleProvider>
						<DirectionRoot>
							<TeamBridgeProvider>
								<ThemedStatusBar />
								<SavedComputersHydration />
								<DeepLinkResolution />
								<NotificationTapRouting />
								{/* The ONE computer switcher sheet, above every route so any screen
								 *  can open it with `useComputerSwitcher().open()` and two screens
								 *  can never show two lists. Inside the providers it reads (the
								 *  connection, the text scale) and below the router's context. */}
								<ComputerSwitcherProvider>
									<Stack screenOptions={{ headerShown: false }} />
								</ComputerSwitcherProvider>
								<ToastHost />
							</TeamBridgeProvider>
						</DirectionRoot>
					</TextScaleProvider>
				</ConnectionProvider>
			</ThemeProvider>
		</SafeAreaProvider>
	);
}

/**
 * The DIRECTION root: the one view every surface inherits its layout direction
 * from, and the one place the config frame is subscribed for it.
 *
 * WHY HERE AND NOT A PROVIDER THAT SUBSCRIBES ITSELF. The direction has a single
 * source already — the relay's resolved language, read through
 * `setLocaleSource`/`activeDirection` — and a second subscription would be a
 * second answer to the same question. So this component subscribes to the frame
 * exactly as Home's composer does (a language change has to REPAINT, not merely
 * re-resolve, or the layout would stay behind the copy) and hands the result
 * down. `activeDirection()` is read at render rather than stored in state for the
 * same reason the copy readers are: the store already holds it.
 *
 * WHY `direction` ON A YOGA ROOT AND NOT `I18nManager.forceRTL`: forceRTL needs
 * an app restart and the language arrives live. `direction` applies to this
 * subtree immediately on native, and on the web `DirectionProvider` also writes
 * `dir`/`lang` onto the document element so portalled modals and an exported
 * build inherit it. Nothing changes for a left-to-right locale: `ltr` is what
 * this view already resolved to by default, and the logical utilities in the
 * screens resolve to the same physical edges they did before.
 *
 * Privately declared for the same reason as `ThemedStatusBar`: a route file's
 * export surface belongs to the router.
 */
const DirectionRoot = ({ children }: { children: ReactNode }) => {
	/* Called for the SUBSCRIPTION only: a language frame re-renders this component,
	 * and `activeDirection()` below then reads the same store live. A lookup that
	 * cheap needs no memo (and a memo would need a lint waiver for the trigger). */
	useLocaleFrame();
	const direction = activeDirection();
	/* The rendered locale, not the raw preference: an unshipped tag renders
	 * English source, and `lang` describes what is on screen. Read from the same
	 * subscription, so the document tag moves with the copy. */
	const locale = activeLocale();
	return (
		<DirectionProvider direction={direction} locale={locale}>
			{/* `DirectionView` puts the direction on both channels (style + `dir` prop);
			 *  why both is documented there. */}
			<DirectionView className="flex-1 bg-canvas">{children}</DirectionView>
		</DirectionProvider>
	);
};

/**
 * The deep-link resolver, mounted once above the router so it outlives every
 * screen: a destination that arrives while the app is on any surface is
 * consumed when the connection reaches `live`, and the bounded-wait failure
 * path fires wherever the reader happens to be (ADR 0006 §6.4). Renders
 * nothing.
 *
 * Privately declared for the same reason as `ThemedStatusBar`: a route file's
 * export surface belongs to the router.
 */
const DeepLinkResolution = () => {
	useDeepLinkResolution();
	return null;
};

/**
 * Removed computers, loaded once at the root so no screen shows one after a cold
 * start (see the hook). Renders nothing; private for the same reason as
 * `ThemedStatusBar`.
 */
const SavedComputersHydration = () => {
	useSavedComputersHydration();
	return null;
};

/**
 * The notification tap router, mounted beside the deep-link resolver for the
 * same reason: a response that arrives while any screen is up (or before any
 * screen exists) becomes a pending destination, and the resolver lands it. On
 * a web build and on a binary without the notifications module this is a no-op
 * (see `notifications/native.ts`); it renders nothing.
 */
const NotificationTapRouting = () => {
	useNotificationTapRouting();
	return null;
};

/**
 * The status bar follows the THEME, not the OS. With a manual override in
 * Settings the two disagree, and a light bar over a light canvas is unreadable.
 *
 * Privately declared rather than exported: a route file's export surface belongs
 * to the router, and a second export here would read as a route.
 */
const ThemedStatusBar = () => {
	const { isDark } = useTheme();
	return <StatusBar style={isDark ? "light" : "dark"} />;
};
