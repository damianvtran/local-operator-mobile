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
import { ThemeProvider, useTheme } from "@/ui/appearance";
import { ToastHost } from "@/ui/components";

/**
 * The root layout: providers in, chrome on.
 *
 * Three providers, in the order they have to be nested:
 *
 *   1. `SafeAreaProvider` — everything below reads insets, and a screen that
 *      reads them without it silently gets zeros (content under the notch).
 *   2. `ThemeProvider` — applies the stored preference to the styling system
 *      before anything styles itself.
 *   3. `ToastHost` — one message slot above every route, so a confirmation
 *      survives navigation.
 *
 * The connection provider belongs here too — it is what will decide whether the
 * app opens on `(auth)/welcome` or `(app)/index` — and lands with the connection
 * store. Until then the app opens on the session list, which is honest: there is
 * no route yet to decide between.
 */
export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<ThemeProvider>
				<View className="flex-1 bg-canvas">
					<ThemedStatusBar />
					<Stack screenOptions={{ headerShown: false }} />
					<ToastHost />
				</View>
			</ThemeProvider>
		</SafeAreaProvider>
	);
}

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
