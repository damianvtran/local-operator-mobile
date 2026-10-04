// The styling layer's entry, and it MUST be this import that brings it into the
// bundle: Tailwind only compiles the CSS the bundle actually pulls in. Uniwind
// reads the same file through metro.config.js's `cssEntryFile`; pointing that at a
// file nothing imports yields an export with every token variable and no utility
// class, which renders as an unstyled screen and reports success.
import "../src/ui/theme.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConnectionProvider } from "@/features/auth/connection-provider";
import { useDeepLinkResolution } from "@/features/deep-links/use-deep-link-resolution";
import { useNotificationTapRouting } from "@/notifications/use-notification-taps";
import { ThemeProvider, useTheme } from "@/ui/appearance";
import { ToastHost } from "@/ui/components";
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
						<View className="flex-1 bg-canvas">
							<ThemedStatusBar />
							<DeepLinkResolution />
							<NotificationTapRouting />
							<Stack screenOptions={{ headerShown: false }} />
							<ToastHost />
						</View>
					</TextScaleProvider>
				</ConnectionProvider>
			</ThemeProvider>
		</SafeAreaProvider>
	);
}

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
