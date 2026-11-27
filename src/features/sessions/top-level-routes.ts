/**
 * The one source of truth for a `(app)` route's class: top-level or nested.
 *
 * The navigation model makes the class a property of the route, never of how a
 * reader arrived: a route is top-level exactly when the drawer can open it
 * (`docs/design/navigation-gestures.md`). The class decides the stack's screen
 * options (top-level routes have no native pop gesture and no slide), and it is
 * asserted against the route files themselves — a new screen under `app/(app)`
 * that is not declared here fails the ledger test rather than silently
 * inheriting the nested class.
 *
 * Deliberately a plain module: the ledger test reads `app/(app)` from Node, and
 * the layout imports the same table, so the file list and the options cannot
 * disagree.
 */

export type RouteClass = "top-level" | "nested";

/** The drawer's destinations and Home. Kept in the model's stated order. */
export const TOP_LEVEL_ROUTE_NAMES = [
	"index",
	"conversations",
	"session/[id]",
	"settings",
	"past",
	"projects",
	"schedules",
	"library",
	"notifications/index",
	"team-bridge",
	"team-bridge/[tenantId]/[conversationId]",
	"community",
] as const;

/** Everything else under `(app)`: reached from inside a top-level screen. */
export const NESTED_ROUTE_NAMES = [
	"community/[communityId]",
	"community/[communityId]/browse",
	"community/[communityId]/c/[conversationId]",
	"community/[communityId]/requests",
	"library/[id]",
	"new",
	"notifications/[id]",
	"projects/[key]",
	"session/[id]/agent/[jobId]",
	"session/[id]/video",
	"team-bridge/[tenantId]/[conversationId]/thread/[rootId]",
	"theme",
] as const;

export type KnownRouteName =
	| (typeof TOP_LEVEL_ROUTE_NAMES)[number]
	| (typeof NESTED_ROUTE_NAMES)[number];

const ROUTE_CLASSES: Readonly<Record<KnownRouteName, RouteClass>> =
	Object.fromEntries([
		...TOP_LEVEL_ROUTE_NAMES.map((name) => [name, "top-level"] as const),
		...NESTED_ROUTE_NAMES.map((name) => [name, "nested"] as const),
	]) as Record<KnownRouteName, RouteClass>;

/** `null` means the route is not declared — a ledger-test failure, and the
 *  reason the layout can never derive a class from a stale default. */
export const routeClassOf = (name: string): RouteClass | null =>
	(name in ROUTE_CLASSES ? ROUTE_CLASSES[name as KnownRouteName] : null) ??
	null;

/**
 * Top-level screens carry no native pop gesture (a swipe there means "open the
 * drawer", not "go back") and no slide: a drawer pick replaces the top-level
 * route under the closing panel, so the drawer's exit is the only motion.
 *
 * Per route in `app/(app)/_layout.tsx`, NOT in `STACK_SCREEN_OPTIONS`: the
 * root stack and `(auth)` keep the native back behaviour untouched.
 */
export const TOP_LEVEL_SCREEN_OPTIONS = {
	gestureEnabled: false,
	animation: "none",
} as const;

/** The options a route declares, or `undefined` for nested routes (which keep
 *  the app's shared `STACK_SCREEN_OPTIONS`). */
export const screenOptionsForRoute = (name: string) =>
	routeClassOf(name) === "top-level" ? TOP_LEVEL_SCREEN_OPTIONS : undefined;
