import { type NoParamKey, t } from "@/i18n";

/**
 * The permission vocabulary, and the one sentence each state gets.
 *
 * The OS permission prompt is not a side effect of installing an app: ADR 0006
 * §5 requires it "in context, with the §2.4 copy already on screen", so it is
 * raised only from a control the reader presses, on one of TWO surfaces: the
 * first-run primer sheet (`permission-primer.ts` — offered on Home once a
 * computer is live, at most twice, never after `denied`; added at the
 * operator's request on 2026-11-14 because a Settings-only prompt left most
 * users without notifications) and, always, the Settings section, which stays
 * the fallback and the remedy path. Every state below is written to be true at
 * the moment it renders. Two rules shape the table:
 *
 * - **Never claim a capability the binary lacks.** A build without the
 *   notifications module (`unsupported`) or a platform that never delivers
 *   (`unsupported` on web — this app's alerts are an app-build capability, not
 *   a browser tab's) says exactly that instead of offering a toggle that does
 *   nothing.
 * - **Name the remedy, never "you will be notified".** ADR 0006 §2.4's rule:
 *   a state that cannot deliver says what WOULD change it (`denied` names
 *   system settings; `granted` and the rest name the push service this
 *   computer has to switch on), and every state that could be read as "alerts
 *   are on" also names what works today — alerts run only while the app is
 *   open, the workaround ADR 0006 §2.4's draft carries. The design round owns
 *   the final wording — these strings are the PR's draft and live in one table
 *   so rewording is one edit.
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

/** The catalogue key each state renders (`mobile.notifications.permission.*`,
 *  in the Local Operator voice — no contractions).
 *
 *  WHAT IS TRUE NOW, and what the sentences say. Team Bridge push is built end
 *  to end: the app registers this phone with Radient's hub, and the hub fans
 *  out over APNs/FCM (since 2026-10-27). Whether a message actually arrives
 *  still depends on Radient's push credentials being configured, which the app
 *  cannot see, so the copy says "when Radient's push delivery is available"
 *  rather than promising delivery. Computer (relay) background alerts are a
 *  separate, still-unbuilt path (ADR 0006 S7), so every state that reads as
 *  "on" keeps saying those work only while the app is open. A key map rather
 *  than a frozen string table so a locale change re-renders the copy
 *  (`src/i18n/runtime.ts`). */
const PUSH_COPY_KEY: Readonly<Record<PushAvailability, NoParamKey>> = {
	unsupported: "mobile.notifications.permission.unsupported",
	granted: "mobile.notifications.permission.granted",
	denied: "mobile.notifications.permission.denied",
	undetermined: "mobile.notifications.permission.undetermined",
	unknown: "mobile.notifications.permission.unknown",
};

/** The sentence one state renders, in the active locale. */
export const pushCopy = (state: PushAvailability): string =>
	t(PUSH_COPY_KEY[state]);

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
