import { mapStatus } from "@/connection/discovery";

/**
 * The catalogue key for Radient's own tunnel-status word, for the add-a-computer
 * wait panel ("Radient has the tunnel — {status}.").
 *
 * WHY THIS EXISTS. The wait hook carries the control plane's RAW word
 * (`DiscoveredComputer.rawStatus`) because the panel must not rewrite
 * `disabled` or `suspended` into something that reads as provisioned. Injecting
 * that word straight into the sentence left one English token in every locale.
 * This maps it to a translated label at render time instead, so the distinction
 * survives and the language does too.
 *
 * CONSTRAINTS.
 *  - Normalisation is `mapStatus`'s (the picker's own mapping, case-insensitive),
 *    plus a trim: the control plane's word is not guaranteed tidy and an
 *    untrimmed ` active` would otherwise read as "unknown".
 *  - Only the control plane's `active` is the word "active"; every other
 *    `ready` source would be a different claim, so `ready` maps to the existing
 *    `badge.active` key and nothing else does.
 *  - It returns a KEY, not text, so the caller's `t(key)` stays the single typed
 *    path and a locale change re-renders.
 *  - An absent or unrecognised word is `status.unknown`, never the raw English.
 */
export type TunnelStatusKey =
	| "mobile.computers.badge.active"
	| "mobile.computers.status.provisioning"
	| "mobile.computers.status.suspended"
	| "mobile.computers.status.disabled"
	| "mobile.computers.status.revoked"
	| "mobile.computers.status.unknown";

export function tunnelStatusKey(raw: string | undefined): TunnelStatusKey {
	switch (mapStatus(raw?.trim())) {
		case "ready":
			return "mobile.computers.badge.active";
		case "provisioning":
			return "mobile.computers.status.provisioning";
		case "suspended":
			return "mobile.computers.status.suspended";
		case "off":
			return "mobile.computers.status.disabled";
		case "gone":
			return "mobile.computers.status.revoked";
		case "unknown":
			return "mobile.computers.status.unknown";
	}
}
