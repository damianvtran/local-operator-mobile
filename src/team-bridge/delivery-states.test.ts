import { describe, expect, it } from "vitest";
import { messageSchema } from "./contract";

/** This is the HUMAN read projection, already authorized by the hub. Sender kind
 * is not an ACL: a recipient owner can see its own entry on an agent message.
 * Keep fixtures entirely synthetic and assert only the DTO's coarse vocabulary.
 * The first RED must reach an assertion through the existing schema, never a
 * missing annotation helper import. Rendering tests follow the witnessed RED. */
const message = (extra: Record<string, unknown> = {}) => ({
	id: "fixture-message",
	conversation_id: "fixture-conversation",
	seq: 1,
	sender: {
		account_id: "fixture-account",
		kind: "human",
		display_label: "Fixture sender",
	},
	body: "Synthetic fixture message.",
	origin: "human",
	created_at: "2026-11-02T00:00:00Z",
	...extra,
});
const recipient = {
	endpoint_id: "fixture-endpoint",
	recipient_label: "Fixture recipient",
	recipient_owner_label: "Fixture owner",
};

// Delivery states are currently an untyped additive field. Do not cast to a
// future type/export: the baseline loose schema must collect and run this file.
const states = (extra: Record<string, unknown>) =>
	messageSchema.parse(message(extra)).delivery_states;

describe("Team Bridge authorized delivery-state schema", () => {
	it("strips unsafe delivery-state extras while retaining the authorized coarse projection", () => {
		expect(messageSchema.safeParse(message()).success).toBe(true);
		const held = { ...recipient, state: "held", hold_class: "awaiting_review" };
		const refused = {
			...recipient,
			endpoint_id: "fixture-other-endpoint",
			state: "refused",
			refusal_class: "unsafe_content",
		};
		const unsafe = {
			score: 0.99,
			raw_reason: "synthetic private screening detail",
			prompt: "synthetic private screening input",
			body: "synthetic private screened body",
			screening_category: "synthetic internal category",
			decided_at: "2026-11-02T00:00:01Z",
		};
		expect(
			states({
				delivery_states: [
					{ ...held, ...unsafe },
					{ ...refused, ...unsafe },
				],
			}),
		).toEqual([held, refused]);
	});

	it("keeps legacy and unauthorized projections absent rather than inventing entries", () => {
		const parsed = messageSchema.parse(message());
		expect(Object.hasOwn(parsed, "delivery_states")).toBe(false);
		expect(states({ delivery_states: [] })).toEqual([]);
	});

	it("retains the delivered DTO without inventing a class", () => {
		const delivered = { ...recipient, state: "delivered" };
		expect(states({ delivery_states: [delivered] })).toEqual([delivered]);
	});

	it("accepts all three server-provided owner hold classes", () => {
		for (const hold_class of [
			"screening_unavailable",
			"awaiting_review",
			"delivery_pending",
		]) {
			const entry = { ...recipient, state: "held", hold_class };
			expect(states({ delivery_states: [entry] })).toEqual([entry]);
		}
	});

	it("accepts exactly the five known coarse refusal classes", () => {
		for (const refusal_class of [
			"manipulation",
			"personal_info",
			"abusive",
			"unsafe_content",
			"out_of_scope",
		]) {
			const entry = { ...recipient, state: "refused", refusal_class };
			expect(states({ delivery_states: [entry] })).toEqual([entry]);
		}
	});

	it("preserves recipient-owner projection even when the message originated from an agent", () => {
		const entries = [
			{ ...recipient, state: "held", hold_class: "screening_unavailable" },
			{
				...recipient,
				endpoint_id: "fixture-other-endpoint",
				state: "refused",
				refusal_class: "abusive",
			},
		];
		expect(
			states({
				origin: "agent",
				sender: {
					account_id: "fixture-agent-owner",
					kind: "agent",
					display_label: "Fixture agent",
				},
				delivery_states: entries,
			}),
		).toEqual(entries);
	});

	it("keeps sending-agent-owner generic entries generic without reconstructing disclosure", () => {
		const entries = [
			{ ...recipient, state: "held" },
			{ ...recipient, endpoint_id: "fixture-other-endpoint", state: "refused" },
		];
		expect(
			states({
				origin: "agent",
				sender: {
					account_id: "fixture-agent-owner",
					kind: "agent",
					display_label: "Fixture agent",
				},
				delivery_states: entries,
			}),
		).toEqual(entries);
	});

	it("does not infer missing hold or refusal classes for a human sender", () => {
		const entries = [
			{ ...recipient, state: "held" },
			{ ...recipient, endpoint_id: "fixture-other-endpoint", state: "refused" },
		];
		expect(states({ delivery_states: entries })).toEqual(entries);
	});

	it("drops future optional classes while retaining generic states and the message", () => {
		const held = { ...recipient, state: "held" };
		const refused = {
			...recipient,
			endpoint_id: "fixture-other-endpoint",
			state: "refused",
		};
		expect(
			states({
				delivery_states: [
					{ ...held, hold_class: "future_hold_class" },
					{ ...refused, refusal_class: "future_refusal_class" },
				],
			}),
		).toEqual([held, refused]);
	});

	it("omits an unknown required state without guessing or discarding valid siblings and body", () => {
		const valid = { ...recipient, state: "held" };
		const input = message({
			delivery_states: [
				valid,
				{
					...recipient,
					endpoint_id: "fixture-other-endpoint",
					state: "future_state",
				},
			],
		});
		const parsed = messageSchema.parse(input);
		expect(parsed.body).toBe(input.body);
		expect(parsed.id).toBe(input.id);
		expect(parsed.delivery_states).toEqual([valid]);
	});

	it("omits malformed entries while preserving the message and valid sibling projections", () => {
		const valid = { ...recipient, state: "held" };
		const other = {
			...recipient,
			endpoint_id: "fixture-other-endpoint",
			state: "refused",
		};
		const malformed: unknown[] = [
			null,
			42,
			{ ...other, endpoint_id: "" },
			{ ...other, endpoint_id: 42 },
			{ ...other, recipient_label: 42 },
			{ ...other, recipient_owner_label: null },
		];
		for (const field of Object.keys(other)) {
			const entry: Record<string, unknown> = { ...other };
			delete entry[field];
			malformed.push(entry);
		}
		for (const entry of malformed) {
			const input = message({ delivery_states: [valid, entry] });
			const parsed = messageSchema.parse(input);
			expect(parsed.body).toBe(input.body);
			expect(parsed.id).toBe(input.id);
			expect(parsed.delivery_states).toEqual([valid]);
		}
	});

	it("omits an invalid non-array projection rather than attesting an empty result", () => {
		// Optional annotation corruption must not turn valid message history into
		// an error screen, nor masquerade as an authorized empty projection.
		for (const delivery_states of [null, {}, "held", 42]) {
			const input = message({ delivery_states });
			const parsed = messageSchema.parse(input);
			expect(parsed.body).toBe(input.body);
			expect(parsed.id).toBe(input.id);
			expect(Object.hasOwn(parsed, "delivery_states")).toBe(false);
		}
	});
	it("retains only the coarse class coherent with its state", () => {
		for (const state of ["held", "refused", "delivered"]) {
			const input = {
				...recipient,
				state,
				hold_class: "awaiting_review",
				refusal_class: "abusive",
			};
			const expected = {
				...recipient,
				state,
				...(state === "held" ? { hold_class: "awaiting_review" } : {}),
				...(state === "refused" ? { refusal_class: "abusive" } : {}),
			};
			expect(states({ delivery_states: [input] })).toEqual([expected]);
		}
	});
});
