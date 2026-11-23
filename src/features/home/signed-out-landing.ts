/**
 * Where Home sends a cold start that has no route (welcome or tunnels), and
 * WHEN it may do so.
 *
 * WHY THIS EXISTS (PR #304, installed-app QA F2). Home is the stack's first
 * screen and stays mounted beneath anything pushed over it. A cold start out
 * of a Team Bridge notification tap pushes the thread on top within a second
 * (`subscribeTeamBridgeTaps` in the Team Bridge provider), and the cold start
 * settles a few seconds LATER. Home's redirect then fired from underneath, and
 * `router.replace` acts on the focused route: it replaced the thread the
 * reader tapped with `/welcome` (or `/tunnels`). Run 44247024803 shows it on
 * API 29/31/36: the hub log has the tapped thread's conversation and messages
 * reads, the final frame is the welcome surface. Team Bridge works without a
 * computer, so a Radient reader with no saved tunnel hits this in production.
 *
 * THE RULE. The redirect belongs to Home only while Home's screen is the
 * focused one (expo-router's `useIsFocused`). Not a pathname check: Home is
 * also mounted at `/new` and `/conversations`, where the redirect must keep
 * working. Back from the thread focuses Home again, and the redirect runs
 * then, as before.
 *
 * Plain function with no `react-native` import, so Node's vitest asserts it.
 */
export type SignedOutLandingInput = {
	/** Home's own screen is the focused route (`useIsFocused`). */
	focused: boolean;
	coldStartSettled: boolean;
	busy: boolean;
	routed: boolean;
	refusal: unknown;
	savedTunnel: unknown;
	phase: string;
	restoredAccount: boolean;
};

/** The landing to `replace` to, or `null` to stay. Every term but `focused`
 *  is a measured case recorded on Home's effect. */
export function signedOutLanding(
	input: SignedOutLandingInput,
): "/tunnels" | "/welcome" | null {
	if (!input.focused) return null;
	if (
		input.coldStartSettled &&
		!input.busy &&
		!input.routed &&
		input.refusal === null &&
		input.savedTunnel === null &&
		input.phase === "signed-out"
	) {
		return input.restoredAccount ? "/tunnels" : "/welcome";
	}
	return null;
}
