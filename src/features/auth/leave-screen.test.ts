import { describe, expect, it } from "vitest";
import { type LeavingRouter, leaveScreen } from "./leave-screen";

/**
 * A stub with React Navigation's stack semantics where they matter: GO_BACK on a
 * one-route stack is unhandled and changes nothing; replace swaps the top.
 */
function stack(...routes: string[]) {
	const history = [...routes];
	const router: LeavingRouter = {
		canGoBack: () => history.length > 1,
		back: () => {
			if (history.length > 1) history.pop();
		},
		replace: (href) => {
			history[history.length - 1] = href;
		},
	};
	return { router, top: () => history[history.length - 1], history };
}

describe("leaveScreen", () => {
	it("reproduces the 883 dead end: a bare back() on the guide alone on its stack goes nowhere", () => {
		const { router, top } = stack("custom");
		router.back();
		expect(top()).toBe("custom");
	});

	it("leaves the guide for Home when it is the root of the stack", () => {
		const { router, top, history } = stack("custom");
		expect(leaveScreen(router)).toBe("home");
		expect(top()).toBe("/");
		expect(history).toEqual(["/"]);
	});

	it("pops to the screen underneath when there is one", () => {
		const { router, top } = stack("tunnels", "own-tunnel");
		expect(leaveScreen(router)).toBe("pop");
		expect(top()).toBe("tunnels");
	});
});
