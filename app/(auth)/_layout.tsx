import { Stack } from "expo-router";

import { STACK_SCREEN_OPTIONS } from "@/ui/stack-options";

/**
 * The pre-connection group. A stack of its own so the auth screens can fade
 * between each other while the app group keeps its own transitions.
 */
export default function AuthLayout() {
	return (
		<Stack screenOptions={{ ...STACK_SCREEN_OPTIONS, animation: "fade" }} />
	);
}
