import { Stack } from "expo-router";

/**
 * The pre-connection group. A stack of its own so the auth screens can fade
 * between each other while the app group keeps its own transitions.
 */
export default function AuthLayout() {
	return <Stack screenOptions={{ headerShown: false, animation: "fade" }} />;
}
