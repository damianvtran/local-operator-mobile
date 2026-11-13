/**
 * What a pre-connection screen's Back does: pop when there is a screen to pop
 * to, otherwise go Home.
 *
 * `router.back()` on its own is a GO_BACK, and React Navigation drops a GO_BACK
 * that no navigator can handle — in production silently. A screen that is the
 * root of the whole tree therefore had a Back that did nothing, and the
 * platform gesture had nothing to do either: the reader's only way out was to
 * kill the app (TestFlight 883, Ola, on the own-tunnel guide). A screen becomes
 * the root through any reset of the stack, not only the account-keyed remount
 * that stranded him (`team-bridge/provider.tsx`), so the Back owns its own exit.
 *
 * Home, not a screen chosen here: Home's landing effect already decides where a
 * reader without a route belongs — Computers for a restored Radient account,
 * Welcome otherwise (`home.tsx`) — and a connected reader stays on Home. Replace,
 * not push, so the screen being left is not underneath to come back to.
 *
 * React-free on purpose, so the Node suite can drive it with a stub router.
 */
export interface LeavingRouter {
	canGoBack: () => boolean;
	back: () => void;
	replace: (href: "/") => void;
}

export function leaveScreen(router: LeavingRouter): "pop" | "home" {
	if (router.canGoBack()) {
		router.back();
		return "pop";
	}
	router.replace("/");
	return "home";
}
