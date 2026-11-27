import { Stack } from "expo-router";

import {
	TOP_LEVEL_ROUTE_NAMES,
	TOP_LEVEL_SCREEN_OPTIONS,
} from "@/features/sessions/top-level-routes";
import { STACK_SCREEN_OPTIONS } from "@/ui/stack-options";

/**
 * The connected group. The stack is where the transcript's push transitions live,
 * and where a future deep link resolves: `localoperator://s/<id>` opens
 * `session/[id]` (docs/ux/flows.md § 11).
 *
 * Top-level routes are declared PER ROUTE, deliberately: on them a rightward
 * swipe means "open the drawer", so the native pop gesture is off, and a drawer
 * pick replaces the route under the closing panel, so it has no slide. The
 * shared `STACK_SCREEN_OPTIONS` stays untouched for nested routes (native
 * swipe-back) and for the root and `(auth)` stacks (`@/ui/stack-options`).
 */
export default function AppLayout() {
	return (
		<Stack screenOptions={STACK_SCREEN_OPTIONS}>
			{TOP_LEVEL_ROUTE_NAMES.map((name) => (
				<Stack.Screen
					key={name}
					name={name}
					options={TOP_LEVEL_SCREEN_OPTIONS}
				/>
			))}
		</Stack>
	);
}
