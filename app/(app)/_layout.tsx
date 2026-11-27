import { Stack } from "expo-router";
import { PageSwipeHost } from "@/features/sessions/page-swipe-host";
import {
	TOP_LEVEL_ROUTE_NAMES,
	TOP_LEVEL_SCREEN_OPTIONS,
} from "@/features/sessions/top-level-routes";
import { NESTED_STACK_SCREEN_OPTIONS } from "@/ui/stack-options";

/**
 * The connected group. The stack is where the transcript's push transitions live,
 * and where a deep link resolves: `localoperator://s/<id>` opens `session/[id]`
 * (docs/ux/flows.md § 11).
 *
 * Top-level routes are declared PER ROUTE, deliberately: on them a rightward
 * swipe means "open the drawer", so the native pop gesture is off, and a drawer
 * pick replaces the route under the closing panel, so it has no slide. Nested
 * routes take `NESTED_STACK_SCREEN_OPTIONS`, which on iOS 26 is the full-width
 * native pop (E2, `@/ui/stack-options`).
 *
 * Every screen is wrapped by `PageSwipeHost` through the stack's `screenLayout`,
 * so the page pan belongs to ONE screen at a time and every claim inside it
 * (`DrawerSwipeClaim`) blocks that screen's own gesture. The host disables
 * itself on nested routes — their rightward swipe is the stack's, and Android
 * has no in-content version of it.
 */
export default function AppLayout() {
	return (
		<Stack
			screenOptions={NESTED_STACK_SCREEN_OPTIONS}
			screenLayout={({ route, children }) => (
				<PageSwipeHost routeName={route.name}>{children}</PageSwipeHost>
			)}
		>
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
