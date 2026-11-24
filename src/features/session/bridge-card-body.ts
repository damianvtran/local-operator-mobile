/**
 * What an inbound Team Bridge card shows below its sender line, read from the
 * relay's card-body answer (local-operator #4238, design §4).
 *
 * WHY THIS EXISTS. A `team_bridge_message` row used to carry only the receipt
 * line: the body was never retained, so every surface said "unavailable". The
 * core now keeps admitted bodies in a separate display store and answers
 * `GET /api/sessions/{id}/bridge-cards/{entry_id}/body` with one item per
 * message. This module turns that answer into lines the row paints; it is pure
 * (no React) so vitest pins every arm in Node.
 *
 * THE RULES IT KEEPS (the core TUI design rounds, #4238):
 *
 *   - **Never infer a moderation outcome.** "Held" and "refused" are painted
 *     only when the relay says `held` / `refused`. An unknown `state` or
 *     `reason` reads as "unavailable", never as a guess.
 *   - **A transient hold is a delay, not a decision**: `hold.class ===
 *     "transient"` reads "Waiting for screening", never "moderation".
 *   - **No hold reason or category is ever shown**, even if a relay sent one.
 *   - **Nothing is cached.** The caller fetches on mount and keeps the answer in
 *     component state only, so a revoked or deleted message is gone on the
 *     next read.
 *   - **An old relay keeps today's row**: no `features.team_bridge_card_body`,
 *     no request and no body region at all.
 */

import type {
	BridgeCardBody,
	BridgeCardBodyItem,
	Capabilities,
} from "@/contracts";

/**
 * Whether this relay serves the card-body route. The flag bag's values are
 * version numbers, so a positive number is the claim (the `libraryEnabled` /
 * `avatarSizesServed` rule).
 */
export const bridgeCardBodyServed = (
	capabilities: Pick<Capabilities, "features"> | null | undefined,
): boolean => {
	const value = capabilities?.features?.team_bridge_card_body;
	return typeof value === "number" && value > 0;
};

/** One state sentence's catalogue key suffix under
 *  `mobile.team_bridge.card_body.*`. */
export type BridgeBodyState =
	| "pending"
	| "held"
	| "held_transient"
	| "refused"
	| "not_admitted"
	| "signed_out"
	| "other_account"
	| "not_member"
	| "offline"
	| "deleted"
	| "unavailable";

export type BridgeBodyLine =
	| { kind: "body"; markdown: string }
	| { kind: "state"; state: BridgeBodyState };

/** The card's body region: one line per item, plus the count of messages the
 *  relay did not itemise (`more`; it caps an answer at 20). */
export interface BridgeBodyView {
	card?: BridgeCardBody["card"];
	lines: BridgeBodyLine[];
	more: number;
}

/** Reasons that own a sentence. `hub_unsupported` and anything newer fall to
 *  the generic "unavailable" — the TUI's mapping, kept identical so a phone and
 *  a terminal never word one answer two ways. */
const REASONS: ReadonlySet<string> = new Set<BridgeBodyState>([
	"signed_out",
	"other_account",
	"not_member",
	"offline",
	"deleted",
]);

/** One item's line. Exported for the tests that pin each arm. */
export function bridgeBodyLine(item: BridgeCardBodyItem): BridgeBodyLine {
	switch (item.state) {
		case "admitted":
			// An admitted item with no body text has nothing to paint; saying
			// "unavailable" is honest, an empty region is not.
			return typeof item.body === "string" && item.body.trim() !== ""
				? { kind: "body", markdown: item.body }
				: { kind: "state", state: "unavailable" };
		case "pending":
			return { kind: "state", state: "pending" };
		case "held":
			return {
				kind: "state",
				state: item.hold?.class === "transient" ? "held_transient" : "held",
			};
		case "refused":
			return { kind: "state", state: "refused" };
		case "not_admitted":
			return { kind: "state", state: "not_admitted" };
		default: {
			const reason = item.reason;
			return {
				kind: "state",
				state:
					typeof reason === "string" && REASONS.has(reason)
						? (reason as BridgeBodyState)
						: "unavailable",
			};
		}
	}
}

/**
 * The region for one answer. `null` (the read failed: a dropped link, a 404
 * for a row the relay will not resolve) is one "unavailable" line — the relay
 * did not state an outcome, so none is painted. An answer with no items is the
 * same: there is nothing to show and no reason to invent one.
 */
export function bridgeBodyView(answer: BridgeCardBody | null): BridgeBodyView {
	if (answer === null || answer.items.length === 0) {
		return { lines: [{ kind: "state", state: "unavailable" }], more: 0 };
	}
	const more =
		Number.isFinite(answer.more) && answer.more > 0
			? Math.floor(answer.more)
			: 0;
	return {
		lines: answer.items.map(bridgeBodyLine),
		more,
		...(answer.card ? { card: answer.card } : {}),
	};
}
