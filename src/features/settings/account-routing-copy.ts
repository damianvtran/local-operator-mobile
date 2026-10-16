/** Feature-scoped SOURCE fallback, not a native translation/audit framework.
 *
 * Native main has no qualified catalogue runtime. Keep finite, stable keys and
 * per-key translator context now; a future qualified renderer can replace this
 * seam without inventing a phone language preference. These are OUR chrome
 * keys, not a claim to consume core wire descriptors: account-routing-v1 sends
 * label/help/choice/error TEXT only. Those values must remain backend-owned.
 * No policy choices, defaults or routing decisions belong in this table.
 */
export const ACCOUNT_ROUTING_SOURCE_LOCALE = "en" as const;
export const ACCOUNT_ROUTING_COPY = {
	"mobile.account_routing.title": {
		source: "Account routing",
		context:
			"Section heading in computer settings; not a provider/model picker.",
		role: "heading",
	},
	"mobile.account_routing.scope": {
		source: "Changes apply only to this computer.",
		context:
			"Scope note below the selected computer; never imply a phone-global routing policy.",
		role: "help",
	},
	"mobile.account_routing.disconnected": {
		source: "Connect to a computer to change account routing.",
		context:
			"No usable selected-route client; do not call the relay outdated or claim an empty policy.",
		role: "status",
	},
	"mobile.account_routing.loading": {
		source: "Loading account routing…",
		context:
			"Read in flight; no policy choice is asserted before the backend answers.",
		role: "status",
	},
	"mobile.account_routing.save": {
		source: "Save policy",
		context:
			"Explicitly saves this temporary draft to the selected computer only.",
		role: "button",
	},
	"mobile.account_routing.saving": {
		source: "Saving…",
		context: "Write pending; never a saved confirmation.",
		role: "button",
	},
	"mobile.account_routing.saved": {
		source: "Saved on this computer.",
		context:
			"Only after a validated response confirms the requested value on the same route.",
		role: "status",
	},
	"mobile.account_routing.unsaved": {
		source: "Not saved yet.",
		context:
			"A selected draft differs from the backend value; changing radio alone does not persist.",
		role: "status",
	},
	"mobile.account_routing.retry": {
		source: "Try again",
		context:
			"Retry a failed read; not a blind automatic retry of an uncertain save.",
		role: "button",
	},
	"mobile.account_routing.reload": {
		source: "Reload policy",
		context:
			"After an uncertain or rejected save: GET the computer's committed policy and replace the draft; never repeat the write blindly.",
		role: "button",
	},
	"mobile.account_routing.unavailable": {
		source:
			"Account routing settings are unavailable on this relay. Update Local Operator on this computer.",
		context:
			"Confirmed missing relay route only; never use for an offline/unknown tunnel.",
		role: "status",
	},
	"mobile.account_routing.load_error": {
		source:
			"Could not load account routing. Check the connection and try again.",
		context:
			"Read failed for another reason, distinct from a confirmed old relay.",
		role: "status",
	},
	"mobile.account_routing.error": {
		source:
			"The change could not be confirmed. Check the connection and reload to read the current policy.",
		context:
			"Unknown save outcome or mismatched confirmation; do not assert not-saved or success.",
		role: "status",
	},
	"mobile.account_routing.rejected": {
		source:
			"The change was not saved. Check the value or this computer’s settings and try again.",
		context:
			"Definitive backend refusal; preserve any backend error text separately, not as a descriptor.",
		role: "status",
	},
} as const;

export type AccountRoutingCopyKey = keyof typeof ACCOUNT_ROUTING_COPY;
export function accountRoutingCopy(key: AccountRoutingCopyKey): string {
	// A missing technical key is a development error, not text to leak into a UI
	// or a reason to silently invent an untracked English literal at the call site.
	if (!Object.hasOwn(ACCOUNT_ROUTING_COPY, key)) {
		throw new RangeError(`Missing account-routing source key: ${key}`);
	}
	return ACCOUNT_ROUTING_COPY[key].source;
}
