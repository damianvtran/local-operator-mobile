import { useCallback, useRef, useState } from "react";

import { beginRadientSignIn, type SignInState } from "./radient-sign-in";

/**
 * The sign-in state machine as a screen uses it.
 *
 * Held here rather than in either screen because two screens run it — `welcome`
 * starts it in place, and `sign-in` is the route a re-auth lands on — and two
 * copies of a five-state flow is two flows that disagree after the first fix.
 *
 * `start()` is idempotent while a flow is in flight: a double tap on a slow
 * device must not open two browser sheets, and the second sheet's code would
 * arrive with the first one's state and be rejected.
 */
export type RadientSignInController = {
	state: SignInState;
	start: () => Promise<void>;
	reset: () => void;
	/** True while the browser hand-off is in flight. */
	inFlight: boolean;
};

export function useRadientSignIn(deps: {
	onTokens: (tokens: { access: string; refresh: string | null }) => void;
}): RadientSignInController {
	const [state, setState] = useState<SignInState>({ kind: "idle" });
	const runningRef = useRef(false);
	const onTokensRef = useRef(deps.onTokens);
	onTokensRef.current = deps.onTokens;

	const start = useCallback(async () => {
		if (runningRef.current) return;
		runningRef.current = true;
		setState({ kind: "starting" });
		try {
			const result = await beginRadientSignIn({ onState: setState });
			if (result.ok) {
				onTokensRef.current({
					access: result.tokens.access,
					refresh: result.tokens.refresh,
				});
			}
		} finally {
			runningRef.current = false;
		}
	}, []);

	const reset = useCallback(() => setState({ kind: "idle" }), []);

	return {
		state,
		start,
		reset,
		inFlight:
			state.kind === "starting" ||
			state.kind === "waiting-for-browser" ||
			state.kind === "exchanging",
	};
}
