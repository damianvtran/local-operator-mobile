import { describe, expect, it } from "vitest";

import {
	deliveryAccessibleName,
	deliveryStateFromDetails,
	isPartialDelivery,
	SEND_DELIVERY_LABEL,
	SEND_DELIVERY_NOTE,
	SEND_DELIVERY_WORD,
	sendDeliveryStateOf,
} from "@/features/session/delivery";

/**
 * The four delivery states, the edges, and the hedge.
 *
 * The coverage mirrors the desktop's own (local-operator-ui #719's model
 * tests): four states, absent, unknown, and a stated-but-unreadable shape —
 * plus one this surface adds, the hint's two homes (the spoken name and the
 * expansion note) agreeing, because the manager's requirement is that the
 * hint is in the accessible name AS WELL AS visible and a table these small
 * is where that can drift.
 */

const detailsWith = (delivery: unknown): Record<string, unknown> => ({
	delivery,
});

describe("deliveryStateFromDetails", () => {
	it.each([
		["delivered", "delivered"],
		["mailbox", "mailbox"],
		["unconfirmed", "unconfirmed"],
		["failed", "failed"],
	] as const)("reads %s from details.delivery.state", (state, expected) => {
		expect(deliveryStateFromDetails(detailsWith({ state }))).toBe(expected);
	});

	it("reads through the payload the core actually attaches", () => {
		/* The full shape `outcome.details()` produces (`peer_send.py`): extra
		 * keys must not disturb the read. */
		expect(
			deliveryStateFromDetails({
				delivery: {
					state: "mailbox",
					message_id: "peer-1a2b",
					wake: true,
					attempts: 3,
					cause: "no ack",
					route: "direct",
				},
			}),
		).toBe("mailbox");
	});

	it.each([
		["no details at all", undefined],
		["null details", null],
		["a bare string", "delivery failed"],
		["no delivery key", { output: "delivered (id peer-1)" }],
		["a null delivery", { delivery: null }],
		["a string delivery", { delivery: "mailbox" }],
		["no state", { delivery: { message_id: "peer-1" } }],
		["a non-string state", { delivery: { state: 7 } }],
	])("reads null for %s", (_label, details) => {
		expect(deliveryStateFromDetails(details)).toBeNull();
	});

	it("reads an unknown state as null — forward, never guessing", () => {
		/* A future core may add a fifth state. Reporting it as a delivery (or
		 * as `failed`) would both be claims this build cannot vouch for; the
		 * honest reading is the pre-field row. */
		expect(
			deliveryStateFromDetails(detailsWith({ state: "mystery" })),
		).toBeNull();
	});
});

describe("sendDeliveryStateOf — the row's gate, shared with the marker", () => {
	it("reads the field only for the send tool; a lookalike key reads null", () => {
		/* Review MINOR-1: the row renders the word only for `send`, and the
		 * state marker must affirm through the same gate — a lookalike
		 * `delivery` key on another tool grew a marker no row backed. */
		expect(
			sendDeliveryStateOf({
				tool_name: "bash",
				details: { delivery: { state: "failed" } },
			}),
		).toBeNull();
		expect(
			sendDeliveryStateOf({
				tool_name: "send",
				details: { delivery: { state: "failed" } },
			}),
		).toBe("failed");
		expect(sendDeliveryStateOf({ tool_name: "send", details: {} })).toBeNull();
	});

	it("gates case-insensitively, the read the row always made", () => {
		expect(
			sendDeliveryStateOf({
				tool_name: "SEND",
				details: { delivery: { state: "mailbox" } },
			}),
		).toBe("mailbox");
	});
});

describe("the words and the partial pair", () => {
	it("names each state's subject, never a bare verdict", () => {
		expect(SEND_DELIVERY_WORD.mailbox).toBe("wake unconfirmed");
		expect(SEND_DELIVERY_WORD.unconfirmed).toBe("delivery unconfirmed");
		expect(SEND_DELIVERY_WORD.failed).toBe("not delivered");
		expect(SEND_DELIVERY_WORD.delivered).toBeUndefined();
	});

	it("marks exactly the two amber states as partial", () => {
		expect(isPartialDelivery("mailbox")).toBe(true);
		expect(isPartialDelivery("unconfirmed")).toBe(true);
		expect(isPartialDelivery("delivered")).toBe(false);
		expect(isPartialDelivery("failed")).toBe(false);
		expect(isPartialDelivery(null)).toBe(false);
		expect(isPartialDelivery(undefined)).toBe(false);
	});

	it("gives delivered no note and no word — a success says nothing", () => {
		expect(SEND_DELIVERY_NOTE.delivered).toBeUndefined();
		expect(deliveryAccessibleName("delivered")).toBeNull();
		expect(deliveryAccessibleName(null)).toBeNull();
		expect(deliveryAccessibleName(undefined)).toBeNull();
	});
});

describe("the check-before-resending hedge", () => {
	/* The phrase is the manager's requirement verbatim; the two homes differ
	 * only in where the sentence starts, so the check folds case rather than
	 * quietly accepting a reworded hint. */
	it("is in the spoken name for both amber states", () => {
		for (const state of ["mailbox", "unconfirmed"] as const) {
			const name = deliveryAccessibleName(state);
			expect(name).not.toBeNull();
			expect(name?.toLowerCase()).toContain(
				"check the target's transcript before resending",
			);
		}
	});

	it("is visible in the expansion note for both amber states", () => {
		for (const state of ["mailbox", "unconfirmed"] as const) {
			expect((SEND_DELIVERY_NOTE[state] ?? "").toLowerCase()).toContain(
				"check the target's transcript before resending",
			);
		}
	});

	it("wraps the amber hedge into the drawn word's label, not a bare verdict", () => {
		/* The desktop's U3: a hedge only a sighted reader can reach is not a
		 * hedge, and a bare `delivery unconfirmed` is the reading that produces
		 * a duplicate. Both halves are pinned here so they cannot drift. */
		expect(SEND_DELIVERY_LABEL.unconfirmed).toContain("may still arrive");
		expect(SEND_DELIVERY_LABEL.mailbox).toContain("delivered");
	});

	it("announces only `not delivered` for failed — its word is the whole statement", () => {
		expect(deliveryAccessibleName("failed")).toBe("not delivered");
	});

	it("names the reader's action in the failed note, never a machine API", () => {
		/* The cause (`entry.error`) renders ABOVE the note in the expansion —
		 * the direction must match the layout (design round 1, D3). */
		expect(SEND_DELIVERY_NOTE.failed).toContain("Fix the cause named above");
	});
});
