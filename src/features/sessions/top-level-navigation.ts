/**
 * The stack model: every drawer pick is a REPLACE of the top-level screen, not
 * a push. The stack is always `[Home]` or `[Home, T]` (plus nested pages above
 * T), Home keeps its route key so its draft and scroll position survive, and
 * the swap happens under the closing panel with no slide.
 *
 * WHY A `RESET` AND NOT `router.replace`. `replace` only swaps the route on
 * top: from `[Home, Settings, Theme]` it would leave Theme's parent missing, or
 * produce `[Home, Settings, Projects]` — two top-level screens in one stack,
 * which is exactly the shape the model forbids. `dismissTo` + `push` animates
 * twice. One key-preserving RESET on the `(app)` stack is the single action that
 * says what the model means.
 *
 * WHY THE PAYLOAD SPREADS THE EXISTING STATE. React Navigation's BASE `RESET`
 * returns the payload as the new state only when it does not carry
 * `stale: false`; a bare `{ index, routes }` would drop `routeNames`, `key` and
 * `preloadedRoutes`, and a partial state is not a state. The stack router
 * rehydrates a missing route key, so a fresh destination may omit one; the
 * spread also keeps `routeNames` valid, which is what the router checks before
 * accepting the reset at all.
 */
import { router, useNavigationContainerRef } from "expo-router";
import { useCallback } from "react";

/** Home's route name inside the `(app)` group (`app/(app)/index.tsx`). */
export const HOME_ROUTE_NAME = "index";

/** The group route that owns the app stack (`app/(app)/_layout.tsx`). */
export const APP_GROUP_ROUTE_NAME = "(app)";

export type TopLevelTarget = {
	/** Expo Router's route name, e.g. `settings` or `session/[id]`. */
	name: string;
	/** Dynamic-segment values, carried to the route as its params. */
	params?: Record<string, string>;
};

export type StackRouteLike = {
	name: string;
	key?: string;
	params?: Record<string, unknown>;
};

/** The subset of the `(app)` stack state the reset reads and spreads. */
export type AppStackStateLike = {
	key?: string;
	index?: number;
	routeNames?: string[];
	type?: string;
	stale?: boolean;
	routes: StackRouteLike[];
};

/** The subset of the root navigation state that locates the `(app)` stack. */
export type RootStateLike = {
	routes: Array<{ name: string; state?: AppStackStateLike }>;
};

export type TopLevelResetAction = {
	type: "RESET";
	target: string;
	payload: AppStackStateLike & { index: number; routes: StackRouteLike[] };
};

/** A route for a session destination; `extra` carries owner metadata for a
 *  remote row exactly as `sessionLocation` puts it in the URL. */
export const sessionTarget = (
	sessionId: string,
	extra?: Record<string, string>,
): TopLevelTarget => ({
	name: "session/[id]",
	params: { id: sessionId, ...extra },
});

let keySeed = 0;
const routeKey = (name: string): string => {
	keySeed += 1;
	return `${name}-${keySeed}`;
};

const sameParams = (route: StackRouteLike, target: TopLevelTarget): boolean => {
	const wanted = Object.entries(target.params ?? {});
	return wanted.every(
		([key, value]) => String(route.params?.[key]) === String(value),
	);
};

const sameRoute = (route: StackRouteLike, target: TopLevelTarget): boolean =>
	route.name === target.name && sameParams(route, target);

/**
 * The routes a drawer pick produces.
 *
 * - Home keeps the existing route object (and therefore its key and mounted
 *   state) whenever it is already in the stack; a stack with no `index` route
 *   gets a fresh one inserted.
 * - Picking the screen already on top is a no-op — the SAME array is returned,
 *   which the hook reads as "only close the drawer".
 * - Every other pick drops everything above Home and puts the destination there.
 */
export const planTopLevelStack = (
	routes: readonly StackRouteLike[],
	target: TopLevelTarget,
): StackRouteLike[] => {
	const home = routes.find((route) => route.name === HOME_ROUTE_NAME);
	const base: StackRouteLike[] = home
		? [home]
		: [{ key: routeKey(HOME_ROUTE_NAME), name: HOME_ROUTE_NAME }];
	if (target.name === HOME_ROUTE_NAME) {
		// Already Home alone: nothing to reset, no key to churn.
		return routes.length === 1 && home ? (routes as StackRouteLike[]) : base;
	}
	const top = routes[routes.length - 1];
	const canonical = routes.length === 2 && routes[0]?.name === HOME_ROUTE_NAME;
	if (canonical && top && sameRoute(top, target)) {
		return routes as StackRouteLike[];
	}
	return [
		...base,
		{ key: routeKey(target.name), name: target.name, params: target.params },
	];
};

/** The `(app)` stack inside a root state, or null when it is not mounted yet. */
export const appStackOf = (
	rootState: RootStateLike | null | undefined,
): { key: string; state: AppStackStateLike } | null => {
	const app = rootState?.routes.find(
		(route) => route.name === APP_GROUP_ROUTE_NAME,
	);
	const state = app?.state;
	if (!state || typeof state.key !== "string" || !Array.isArray(state.routes))
		return null;
	return { key: state.key, state };
};

/**
 * The RESET action for a pick, or null when there is nothing to do (the target
 * is already showing, or the `(app)` stack is not mounted).
 */
export const topLevelResetFor = (
	rootState: RootStateLike | null | undefined,
	target: TopLevelTarget,
): TopLevelResetAction | null => {
	const app = appStackOf(rootState);
	if (!app) return null;
	const routes = planTopLevelStack(app.state.routes, target);
	if (routes === app.state.routes) return null;
	return {
		type: "RESET",
		target: app.key,
		payload: { ...app.state, index: Math.max(0, routes.length - 1), routes },
	};
};

/** A target's URL, used only by the cold-start fallback below. */
export const pathForTarget = (target: TopLevelTarget): string => {
	if (target.name === HOME_ROUTE_NAME) return "/";
	const visible = target.name.endsWith("/index")
		? target.name.slice(0, -"/index".length)
		: target.name;
	const path = visible.replace(/\[([^\]]+)\]/g, (_segment, key: string) =>
		encodeURIComponent(target.params?.[key] ?? ""),
	);
	return `/${path}`;
};

/**
 * The one way a top-level destination is opened: reset the `(app)` stack to
 * `[Home, target]` (or `[Home]`), key-preserving, with the drawer already
 * closing over the swap.
 *
 * A ref that is not ready — the cold-start deep link, before the container has
 * mounted — falls back to `router.navigate` with the target's URL, because a
 * reset needs a state to read.
 */
export const useOpenTopLevel = (): ((target: TopLevelTarget) => void) => {
	const navigationRef = useNavigationContainerRef();
	return useCallback(
		(target: TopLevelTarget) => {
			const root = navigationRef.isReady()
				? (navigationRef.getRootState() as RootStateLike | undefined)
				: undefined;
			if (!appStackOf(root)) {
				router.navigate(pathForTarget(target) as never);
				return;
			}
			const action = topLevelResetFor(root, target);
			if (action) navigationRef.dispatch(action as never);
		},
		[navigationRef],
	);
};
