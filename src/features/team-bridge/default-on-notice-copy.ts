/** Feature-scoped SOURCE copy for the default-on Team Bridge notice.
 *
 * Same seam as `features/settings/account-routing-copy.ts`: native main has no
 * qualified catalogue runtime and the app offers no phone language preference,
 * so English is the only shipped locale. Stable keys plus per-key translator
 * context are what a later catalogue needs; no text lives at a call site.
 *
 * The CONSENT TEXT is deliberately not in this table. It is served by the hub
 * (`GET /v1/messaging/status` `consent.text`), versioned, and shown verbatim —
 * translating or paraphrasing it here would put words in the person's mouth
 * that no consent version covers.
 */
export const DEFAULT_ON_NOTICE_SOURCE_LOCALE = "en" as const;
export const DEFAULT_ON_NOTICE_COPY = {
	"mobile.team_bridge.default_on.title": {
		source: "Team Bridge is on for you",
		context:
			"Heading of a one-time, dismissible banner at the top of the Team Bridge tab. States a fact about the person's account; not a question and not an invitation to enable anything.",
		role: "heading",
	},
	"mobile.team_bridge.default_on.body": {
		source:
			"Your organization’s agents can message your chief of staff. You can turn this off at any time.",
		context:
			"One sentence under the heading. “Chief of staff” is the product term for the person's own agent. Do not imply the person did anything to enable it.",
		role: "body",
	},
	"mobile.team_bridge.default_on.turn_off": {
		source: "Turn off",
		context:
			"Button. One tap opts the person out of agent messages for this organization. Not “Disable”, which sounds like an admin action.",
		role: "button",
	},
	"mobile.team_bridge.default_on.read_more": {
		source: "Read what this means",
		context:
			"Button that reveals the full served consent text inline, in place; it does not navigate and does not open a dialog.",
		role: "button",
	},
	"mobile.team_bridge.default_on.hide": {
		source: "Hide details",
		context: "Same button once the consent text is showing; collapses it.",
		role: "button",
	},
	"mobile.team_bridge.default_on.dismiss": {
		source: "Dismiss",
		context:
			"Button. Closes the banner for good on this device, leaving Team Bridge on. Not “OK”, which would read as acceptance.",
		role: "button",
	},
	"mobile.team_bridge.default_on.dismiss_label": {
		source: "Dismiss Team Bridge notice",
		context:
			"Screen-reader name for the short Dismiss button; identifies the notice being closed, not the Team Bridge setting.",
		role: "label",
	},
	"mobile.team_bridge.default_on.dismiss_hint": {
		source: "Keeps Team Bridge on and does not show this notice again",
		context:
			"Screen-reader hint for Dismiss only; makes explicit that dismissing is not turning off.",
		role: "hint",
	},
	"mobile.team_bridge.default_on.turn_off_error": {
		source:
			"Team Bridge was not turned off. Check the connection and try again.",
		context:
			"Shown under the buttons when the turn-off request failed; the setting is unchanged, so never say it is off.",
		role: "alert",
	},
} as const;

export type DefaultOnNoticeCopyKey = keyof typeof DEFAULT_ON_NOTICE_COPY;
export function defaultOnNoticeCopy(key: DefaultOnNoticeCopyKey): string {
	// A missing technical key is a development error, not text to leak into a UI.
	if (!Object.hasOwn(DEFAULT_ON_NOTICE_COPY, key)) {
		throw new RangeError(`Missing default-on notice source key: ${key}`);
	}
	return DEFAULT_ON_NOTICE_COPY[key].source;
}
