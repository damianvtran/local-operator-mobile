import { describe, expect, it } from "vitest";
import { bridgeCardBodySchema } from "@/contracts";
import {
	bridgeBodyLine,
	bridgeBodyView,
	bridgeCardBodyServed,
} from "@/features/session/bridge-card-body";

/**
 * The inbound Team Bridge card body (local-operator #4238, design §4). These pin
 * the two rules that are easy to break by "helpful" code: a moderation outcome
 * is painted only when the relay states it, and an old relay is never asked.
 */
describe("bridgeCardBodyServed", () => {
	it("is on only for a positive version number", () => {
		expect(
			bridgeCardBodyServed({ features: { team_bridge_card_body: 1 } }),
		).toBe(true);
		expect(bridgeCardBodyServed({ features: {} })).toBe(false);
		expect(bridgeCardBodyServed({})).toBe(false);
		expect(bridgeCardBodyServed(null)).toBe(false);
		expect(
			bridgeCardBodyServed({ features: { team_bridge_card_body: 0 } }),
		).toBe(false);
		expect(
			bridgeCardBodyServed({ features: { team_bridge_card_body: "1" } }),
		).toBe(false);
	});
});

describe("bridgeBodyLine", () => {
	it("paints an admitted body as markdown", () => {
		expect(bridgeBodyLine({ state: "admitted", body: "**hi**" })).toEqual({
			kind: "body",
			markdown: "**hi**",
		});
	});

	it("reads an admitted item with no text as unavailable, not blank", () => {
		expect(bridgeBodyLine({ state: "admitted", body: "  " })).toEqual({
			kind: "state",
			state: "unavailable",
		});
		expect(bridgeBodyLine({ state: "admitted" })).toEqual({
			kind: "state",
			state: "unavailable",
		});
	});

	it.each([
		["pending", "pending"],
		["refused", "refused"],
		["not_admitted", "not_admitted"],
	] as const)("maps %s to its own sentence", (state, expected) => {
		expect(bridgeBodyLine({ state })).toEqual({
			kind: "state",
			state: expected,
		});
	});

	it("separates a moderation hold from a transient screening delay", () => {
		expect(
			bridgeBodyLine({ state: "held", hold: { class: "awaiting_review" } }),
		).toEqual({ kind: "state", state: "held" });
		expect(
			bridgeBodyLine({ state: "held", hold: { class: "transient" } }),
		).toEqual({ kind: "state", state: "held_transient" });
		// The relay said held; an unknown class is still held, never a guess
		// at something milder.
		expect(bridgeBodyLine({ state: "held" })).toEqual({
			kind: "state",
			state: "held",
		});
	});

	it("never shows a body the relay sent alongside a non-admitted state", () => {
		expect(bridgeBodyLine({ state: "refused", body: "secret text" })).toEqual({
			kind: "state",
			state: "refused",
		});
		expect(bridgeBodyLine({ state: "held", body: "secret text" })).toEqual({
			kind: "state",
			state: "held",
		});
	});

	it.each([
		["signed_out", "signed_out"],
		["other_account", "other_account"],
		["not_member", "not_member"],
		["offline", "offline"],
		["deleted", "deleted"],
		["hub_unsupported", "unavailable"],
		["something_new", "unavailable"],
	] as const)("maps unavailable/%s to %s", (reason, expected) => {
		expect(bridgeBodyLine({ state: "unavailable", reason })).toEqual({
			kind: "state",
			state: expected,
		});
	});

	it("reads an unknown state as unavailable, never as a moderation outcome", () => {
		expect(bridgeBodyLine({ state: "quarantined" })).toEqual({
			kind: "state",
			state: "unavailable",
		});
		// A reason on an unknown state names a sentence it owns, not an outcome.
		expect(bridgeBodyLine({ state: "quarantined", reason: "deleted" })).toEqual(
			{ kind: "state", state: "deleted" },
		);
	});
});

describe("bridgeBodyView", () => {
	it("reads a failed read as one unavailable line", () => {
		expect(bridgeBodyView(null)).toEqual({
			lines: [{ kind: "state", state: "unavailable" }],
			more: 0,
		});
	});

	it("keeps the relay's order and its more count", () => {
		expect(
			bridgeBodyView({
				v: 1,
				items: [{ state: "admitted", body: "one" }, { state: "refused" }],
				more: 3,
			}),
		).toEqual({
			lines: [
				{ kind: "body", markdown: "one" },
				{ kind: "state", state: "refused" },
			],
			more: 3,
		});
	});

	it("ignores a nonsensical more count", () => {
		expect(
			bridgeBodyView({ v: 1, items: [{ state: "pending" }], more: -2 }).more,
		).toBe(0);
	});
});

describe("bridgeCardBodySchema", () => {
	it("refuses an answer version this reader does not know (review M1)", () => {
		expect(
			bridgeCardBodySchema.safeParse({ v: 2, items: [], more: 0 }).success,
		).toBe(false);
	});

	it("parses the relay's answer and degrades a malformed item to unavailable", () => {
		const parsed = bridgeCardBodySchema.parse({
			v: 1,
			items: [
				{
					message_id: "bcmsg_1",
					conversation_id: "bcv_1",
					state: "admitted",
					body: "hello",
					source: "local",
				},
				"not an object",
				{ state: 7, hold: "bad" },
			],
			more: "x",
		});
		expect(parsed.more).toBe(0);
		expect(bridgeBodyView(parsed).lines).toEqual([
			{ kind: "body", markdown: "hello" },
			{ kind: "state", state: "unavailable" },
			{ kind: "state", state: "unavailable" },
		]);
	});
});

describe("additive card context", () => {
	it("preserves receipt time and thread marker with the screened body", () => {
		const card = { received_at: "2026-11-21T15:11:44Z", thread_reply: true };
		const answer = bridgeCardBodySchema.parse({
			v: 1,
			items: [{ state: "admitted", body: "screened" }],
			more: 0,
			card,
		});
		expect(bridgeBodyView(answer).card).toEqual(card);
	});
	it.each([
		undefined,
		null,
		"bad",
		{ received_at: "bad", thread_reply: "yes" },
	])("ignores absent or malformed decorative context: %j", (card) => {
		const answer = bridgeCardBodySchema.parse({
			v: 1,
			items: [{ state: "admitted", body: "screened" }],
			more: 0,
			card,
		});
		expect(bridgeBodyView(answer).lines).toEqual([
			{ kind: "body", markdown: "screened" },
		]);
		expect(answer.card?.received_at).toBeUndefined();
		expect(answer.card?.thread_reply).toBeUndefined();
	});
});
