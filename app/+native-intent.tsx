/**
 * The native intent hook (Expo Router's "Customizing links"): what happens to a
 * system URL before the router sees it.
 *
 * Two exported behaviours, and only these:
 *
 * - `localoperator://s/<id>` is rewritten to the app's own `/session/<id>`
 *   route (ADR 0006 §6.7 — the deep link "that must exist as code"), and the
 *   session id is recorded as the pending destination so the resolver can
 *   honour the cold-start precedence and the bounded-wait failure path (§6.2-4)
 *   rather than leaving the reader on a screen the connection cannot fill yet.
 * - everything else passes through unchanged.
 *
 * `redirectSystemPath` runs OUTSIDE app context — before any provider
 * mounts, with no auth and no connection — so it must be trivial, synchronous
 * and total: the rewrite is pure (`features/deep-links/intent.ts`), and every
 * failure path returns the original string rather than throwing, because a
 * throw here is a launch the user cannot diagnose. Destination decisions
 * (navigate / wait / fail) are NOT made here; see
 * `features/deep-links/use-deep-link-resolution.ts`.
 */

import { nativeIntentFor } from "@/features/deep-links/intent";
import { noteSessionLink } from "@/features/deep-links/pending";

export function redirectSystemPath({
	path,
}: {
	path: string;
	/** Present in Expo's call; unread here on purpose: the destination is
	 *  recorded on BOTH the cold-start and the while-running paths, and the
	 *  resolver — not this module — decides whether a route exists to consume
	 *  it. */
	initial: boolean;
}): string {
	try {
		if (typeof path !== "string") return path;
		const intent = nativeIntentFor(path);
		if (intent.sessionId !== null) noteSessionLink(intent.sessionId);
		return intent.path;
	} catch {
		return path;
	}
}
