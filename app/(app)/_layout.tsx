import { Stack } from "expo-router";

/**
 * The connected group. The stack is where the transcript's push transitions live,
 * and where a future deep link resolves: `localoperator://s/<id>` opens
 * `session/[id]` (docs/ux/flows.md § 11).
 */
export default function AppLayout() {
	return <Stack screenOptions={{ headerShown: false }} />;
}
