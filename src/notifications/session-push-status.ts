import { type NoParamKey, t } from "@/i18n";
import type { SessionPushRegistrationState } from "./session-push-registration-state";

/**
 * The Settings sentence for this phone's registration with the ROUTED computer
 * (`session-push-registration.ts`), or `null` when the section's other lines
 * already say everything true.
 *
 * WHY SOME STATES RENDER NOTHING. `idle` is "no live route yet" — the device
 * list beside it already says it is checking. `unsupported` and `permission`
 * are the permission sentence's facts (`permission.ts`), and a second sentence
 * restating them would read as two problems. Every other state is a fact only
 * this registration knows, and a reader whose computer never alerts needs it.
 *
 * WHY THE ROUTE KEY IS CHECKED HERE. The store holds the LAST attempt, which
 * may belong to the computer the reader just switched away from; rendering it
 * under another computer's Settings would be a true sentence about the wrong
 * machine. A pure module, so the mapping is tested without a renderer.
 */
const STATUS_KEY: Readonly<
	Record<SessionPushRegistrationState["status"], NoParamKey | null>
> = {
	idle: null,
	unsupported: null,
	permission: null,
	registering: "mobile.notifications.computer_registration.registering",
	registered: "mobile.notifications.computer_registration.registered",
	"no-token": "mobile.notifications.computer_registration.no_token",
	refused: "mobile.notifications.computer_registration.refused",
	"relay-missing": "mobile.notifications.computer_registration.relay_missing",
	failed: "mobile.notifications.computer_registration.failed",
};

export const sessionPushStatusKey = (
	state: SessionPushRegistrationState,
	routeKey: string | null,
): NoParamKey | null =>
	routeKey !== null && state.routeKey === routeKey
		? STATUS_KEY[state.status]
		: null;

/** The sentence, in the active locale, or `null` (see `sessionPushStatusKey`). */
export const sessionPushStatusCopy = (
	state: SessionPushRegistrationState,
	routeKey: string | null,
): string | null => {
	const key = sessionPushStatusKey(state, routeKey);
	return key === null ? null : t(key);
};
