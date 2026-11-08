import type { DiscoveredComputer } from "@/connection";
import type { SavedComputer } from "@/connection/saved-computers";
import { SavedComputers } from "@/connection/saved-computers";

/**
 * Which computer a cold start opens on its own, if any.
 *
 * Why it exists. A restored Radient sign-in used to land on the Computers picker on
 * every launch — even with one computer, even when the reader had used the same one
 * yesterday — because the cold start restored the ACCOUNT but never a ROUTE. The
 * operator's rule (startup restore, PR H): reopen the last computer used; else, with
 * exactly one usable computer, open that; else show the picker.
 *
 * What "last selected" means here. The saved-computers registry already records
 * `lastUsedAt` on every computer a route reached `live` on (`rememberLiveComputer`),
 * Radient and custom alike. That is the record this reads — a second "last picked"
 * key beside it would be a second answer to the same question, and the registry
 * deliberately does not count a pick that never answered as use: reopening a
 * computer that refused last time would only repeat the refusal at every launch.
 *
 * Constraints, and why:
 *
 * - **Usable only.** A computer is auto-opened only when discovery lists it NOW,
 *   serving Local Operator, with its route ready. A removed, revoked, suspended or
 *   other-account computer is absent from (or not ready in) the current account's
 *   discovery, so a stale last id falls through to the next rule rather than
 *   dialling a computer the picker would not offer.
 * - **Never a hidden computer.** `SavedComputers.mayAutoReconnect` is the registry's
 *   own rule for a connect without a tap; it is applied to the last entry, and every
 *   hidden tunnel id is filtered out of the single-computer rule too, because the
 *   store's hidden set may not be hydrated yet when the cold start gets here.
 * - **"Last" is the newest USABLE Radient computer.** The registry spans accounts
 *   (an entry keeps its `account` on purpose) and transports (forgetting an own
 *   tunnel clears its slot, not its entry), so the newest entry overall may be one
 *   this account cannot open. Taking it and only then checking it would skip the
 *   reader's real last computer and land on the picker; the candidates are
 *   therefore narrowed to this account's ready, listed tunnel ids first.
 * - **A saved own tunnel is not overridden.** Whenever the own-tunnel slot is
 *   saved, the caller dials it (a remembered password) or asks for its password,
 *   and does not reach this function — even if a Radient computer was used more
 *   recently (`ownTunnelPending`; deliberately conservative, the pre-existing
 *   behaviour). An own-tunnel entry whose slot was forgotten cannot be dialled, so
 *   it never counts as "last" here.
 * - **Pure.** Inputs are values so every branch is a test case; the provider only
 *   carries the answer out (`resumeComputerOnColdStart` below).
 */
export type ColdStartComputer =
	| { kind: "last"; computer: DiscoveredComputer }
	| { kind: "only"; computer: DiscoveredComputer }
	| { kind: "picker" };

/** Whether the cold start may open this computer without a tap. The same facts the
 *  picker paints as "route ready" on a Local Operator row. */
export function autoOpenable(computer: DiscoveredComputer): boolean {
	return computer.supportsLocalOperator && computer.status === "ready";
}

export function coldStartComputer(input: {
	/** The current account's discovery, already filtered by the store's hidden set. */
	computers: readonly DiscoveredComputer[];
	/** The saved-computers registry, hidden entries included. */
	saved: readonly SavedComputer[];
}): ColdStartComputer {
	const hidden = new Set(
		input.saved.flatMap((entry) =>
			entry.transport === "radient" && entry.hidden ? [entry.tunnelId] : [],
		),
	);
	const usable = input.computers.filter(
		(computer) => autoOpenable(computer) && !hidden.has(computer.tunnelId),
	);
	/* Most recent use among the usable wins; `list()` already sorts by use, but the
	 *  order is this function's contract, not the caller's. Hidden entries never
	 *  qualify, and `lastUsedAt > 0` excludes an entry the registry records as never
	 *  used (a Remove on a computer that was never connected writes `0`). */
	const usableIds = new Set(usable.map((computer) => computer.tunnelId));
	const last = input.saved
		.filter(
			(entry) =>
				entry.transport === "radient" &&
				SavedComputers.mayAutoReconnect(entry) &&
				entry.lastUsedAt > 0 &&
				usableIds.has(entry.tunnelId),
		)
		.reduce<SavedComputer | null>(
			(latest, entry) =>
				latest === null || entry.lastUsedAt > latest.lastUsedAt
					? entry
					: latest,
			null,
		);
	if (last !== null && last.transport === "radient") {
		const computer = usable.find(
			(candidate) => candidate.tunnelId === last.tunnelId,
		);
		if (computer) return { kind: "last", computer };
	}
	const [only] = usable;
	if (usable.length === 1 && only) return { kind: "only", computer: only };
	return { kind: "picker" };
}

/**
 * Carries the decision out on a cold start. Injectable for the same reason as
 * `carryOutRestore`: `connection-provider.tsx` does not load in every test host, and
 * the guards here are what keep the restore from fighting the paths around it.
 *
 * It does nothing — leaving the picker or the surface already chosen — when:
 * no Radient account was restored; a route already exists (the reader's own tunnel,
 * a `?lo-relay` override, the relay-served page's cookie); a refusal is showing (a
 * lapsed grant must stay on the screen that says so); a saved own-tunnel is waiting
 * for its password; or the cold start was interrupted (a sign-out, a tap). It runs
 * once per cold start, and a failed connect becomes the connection's own refusal
 * on Home, so a missing computer can never loop back into another attempt.
 */
export async function resumeComputerOnColdStart(deps: {
	signedIn: () => boolean;
	routed: () => boolean;
	refused: () => boolean;
	ownTunnelPending: () => boolean;
	computers: () => readonly DiscoveredComputer[];
	readSaved: () => Promise<SavedComputer[]>;
	select: (computer: DiscoveredComputer) => Promise<void>;
	isCancelled: () => boolean;
}): Promise<ColdStartComputer | null> {
	const blocked = () =>
		deps.isCancelled() ||
		!deps.signedIn() ||
		deps.routed() ||
		deps.refused() ||
		deps.ownTunnelPending();
	if (blocked()) return null;
	const saved = await deps.readSaved();
	/* Re-checked after the keystore read: a tap on a picker row or a sign-out may
	 *  have landed meanwhile, and the reader's own action always wins. */
	if (blocked()) return null;
	const decision = coldStartComputer({ computers: deps.computers(), saved });
	if (decision.kind !== "picker") await deps.select(decision.computer);
	return decision;
}
