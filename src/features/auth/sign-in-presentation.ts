import type { SignInState } from "./radient-sign-in";

/** Account admission can outlive an edge 401. It is not permission for a newly
 * mounted re-auth screen to navigate: only that screen's own attempt may do so.
 * Preserve progress through the effect/router handoff, including the render in
 * which the provider finishes discovery and returns to idle. */
export function signInPresentation(input: {
	initiated: boolean;
	restoredAccount: boolean;
	busy: boolean;
	/** Whether a route exists when the attempt completes: the sign-in opened the
	 *  reader's computer (`openUsualComputer`), so the screen leaves for Home. */
	routed: boolean;
	state: SignInState;
}): { navigate: boolean; destination: "/" | "/tunnels"; state: SignInState } {
	const completed =
		input.initiated && input.restoredAccount && input.state.kind === "idle";
	return {
		navigate: completed && !input.busy,
		/* Home is the new-conversation composer; Computers is the picker. */
		destination: input.routed ? "/" : "/tunnels",
		state: completed ? { kind: "exchanging" } : input.state,
	};
}
