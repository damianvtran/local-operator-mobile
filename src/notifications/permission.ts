/**
 * The permission vocabulary, and the one sentence each state gets.
 *
 * The OS permission prompt is not a side effect of installing an app: ADR 0006
 * §5 requires it "in context, with the §2.4 copy already on screen", so the
 * ONLY surface that asks is the Settings section, from a control the reader
 * presses, and every state below is written to be true at the moment it
 * renders. Two rules shape the table:
 *
 * - **Never claim a capability the binary lacks.** A build without the
 *   notifications module (`unsupported`) or a platform that never delivers
 *   (`unsupported` on web — this app's alerts are an app-build capability, not
 *   a browser tab's) says exactly that instead of offering a toggle that does
 *   nothing.
 * - **Name the remedy, never "you will be notified".** ADR 0006 §2.4's rule:
 *   a state that cannot deliver says what WOULD change it (`denied` names
 *   system settings; `granted` names the push service this computer has to
 *   switch on). The design round owns the final wording — these strings are
 *   the PR's draft and live in one table so rewording is one edit.
 *
 * `unknown` exists because the read can fail honestly: expo-notifications can
 * answer a status this build does not know (a future iOS value), and the
 * difference between "the OS said no" and "we could not ask" is one a support
 * conversation depends on. Neither is allowed to borrow the other's sentence.
 */

/** What this device's notification state is, as the app may honestly render it. */
export type PushAvailability =
	| "unsupported"
	| "granted"
	| "denied"
	| "undetermined"
	| "unknown";

/**
 * The map from a platform status string to the app's vocabulary.
 *
 * `granted` and iOS's `provisional` are the two positive statuses (a
 * provisional authorization still delivers, quietly, to the notification
 * centre); `denied` and `undetermined` map to themselves; anything else — a
 * status a future OS added, or a read that answered nothing — is `unknown`,
 * never `denied` (a refusal we did not receive must not be claimed as one).
 */
export function availabilityFromStatus(status: unknown): PushAvailability {
	if (status === "granted" || status === "provisional") return "granted";
	if (status === "denied") return "denied";
	if (status === "undetermined") return "undetermined";
	return "unknown";
}

/** The sentence each state renders, in the Local Operator voice (no
 *  contractions — the app's refusal copy carries none). */
export const PUSH_COPY: Readonly<Record<PushAvailability, string>> = {
	unsupported: "This build does not include notifications.",
	granted:
		"Allowed. Background alerts are not switched on for this computer yet — nothing will arrive until they are.",
	denied:
		"Notifications are turned off for this app in system settings. Turn them back on there to receive alerts.",
	undetermined:
		"Ask your phone for permission. Alerts arrive once this computer's push service is switched on.",
	unknown: "Notifications could not be checked on this phone.",
};

/** Whether a state has a control to press. Only `undetermined` does: the
 *  prompt is an act a reader takes, never something a screen fires on mount. */
export const canRequestPermission = (state: PushAvailability): boolean =>
	state === "undetermined";

/** The one label the enable control wears. */
export const PUSH_ENABLE_LABEL = "Enable notifications";

/**
 * The web-target test hook's vocabulary — the `lo-notifications` query value a
 * capture cell may set.
 *
 * Same convention as `lo-relay` / `lo-conversation`
 * (`features/auth/connection-provider.tsx`, `features/deep-links/
 * use-deep-link-resolution.ts`): a URL can steer the harness's page and never
 * the installed app, and the hook is read only here, on web, by the Settings
 * section. Without it the permission states have no capturable rendering at
 * all — the web platform is always `unsupported` — and the design round would
 * be reviewing a surface it cannot see.
 */
export function availabilityFromHook(
	value: string | null,
): PushAvailability | null {
	if (value === null) return null;
	return value === "granted" ||
		value === "denied" ||
		value === "undetermined" ||
		value === "unsupported" ||
		value === "unknown"
		? value
		: null;
}
