import { Stack } from "expo-router";

import { STACK_SCREEN_OPTIONS } from "@/ui/stack-options";

/**
 * The connected group. The stack is where the transcript's push transitions live,
 * and where a future deep link resolves: `localoperator://s/<id>` opens
 * `session/[id]` (docs/ux/flows.md § 11).
 */
export default function AppLayout() {
	return <Stack screenOptions={STACK_SCREEN_OPTIONS} />;
}
