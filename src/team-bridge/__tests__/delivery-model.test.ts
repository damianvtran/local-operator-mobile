import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetLocaleSource, setLocaleSource } from "@/i18n/locale";
import { messageSchema } from "../contract";
import { deliveryAnnotations } from "../delivery-states";
import { deliveryFixtureHistory, message, SELF } from "./fixtures";

const recipient = {
	endpoint_id: "fixture-endpoint",
	recipient_label: "Nova",
	recipient_owner_label: "Synthetic owner",
};
const project = (entries: unknown) =>
	deliveryAnnotations(
		messageSchema.parse({
			...message(1, SELF, "2026-11-02T09:00:00Z"),
			delivery_states: entries,
		}),
	);
beforeEach(() => setLocaleSource(() => "en"));
afterEach(() => resetLocaleSource());

describe("quiet authorized delivery annotations", () => {
	it("has no UI model for absent, empty or delivered-only projections", () => {
		expect(
			deliveryAnnotations(message(1, SELF, "2026-11-02T09:00:00Z")),
		).toEqual([]);
		expect(project([])).toEqual([]);
		expect(project([{ ...recipient, state: "delivered" }])).toEqual([]);
	});
	it("uses identical generic waiting for all hold classes without cause leakage", () => {
		for (const hold_class of [
			undefined,
			"screening_unavailable",
			"awaiting_review",
			"delivery_pending",
			"future_hold",
		]) {
			expect(project([{ ...recipient, state: "held", hold_class }])).toEqual([
				{
					endpointId: recipient.endpoint_id,
					label: "Nova: Waiting for delivery.",
					help: undefined,
				},
			]);
		}
	});
	it("localizes only the five supplied refusal classes with the same generic help", () => {
		for (const [refusal_class, label] of Object.entries({
			manipulation: "Manipulation",
			personal_info: "Personal information",
			abusive: "Abusive content",
			unsafe_content: "Unsafe content",
			out_of_scope: "Out of scope",
		})) {
			const row = project([
				{ ...recipient, state: "refused", refusal_class },
			])[0];
			expect(row?.label).toBe(`Nova: Not delivered. (${label})`);
			expect(row?.help).toBe(
				"Each recipient’s agent checks messages before accepting them. If a message is not accepted, you can rephrase it and send a new message.",
			);
		}
	});
	it("keeps absent and future refusal classes generic without raw enum echo", () => {
		for (const refusal_class of [undefined, "synthetic_future_private_class"]) {
			expect(
				project([{ ...recipient, state: "refused", refusal_class }])[0]?.label,
			).toBe("Nova: Not delivered.");
		}
	});
	it("uses a localized blank-label fallback, never endpoint or owner identity", () => {
		const row = project([
			{ ...recipient, recipient_label: "   ", state: "held" },
		])[0];
		expect(row?.label).toBe("Agent: Waiting for delivery.");
		expect(row?.label.includes(recipient.endpoint_id)).toBe(false);
		expect(row?.label.includes(recipient.recipient_owner_label)).toBe(false);
	});
	it("preserves server order and distinct endpoint identities even for duplicate labels", () => {
		const rows = project([
			{ ...recipient, state: "held" },
			{ ...recipient, endpoint_id: "fixture-other", state: "refused" },
		]);
		expect(rows.map((row) => row.endpointId)).toEqual([
			"fixture-endpoint",
			"fixture-other",
		]);
		expect(rows.map((row) => row.label)).toEqual([
			"Nova: Waiting for delivery.",
			"Nova: Not delivered.",
		]);
	});
	it("does not discard human-owner annotations merely because origin is agent", () => {
		for (const variant of ["delivery-agent-owner", "delivery-sending-agent"]) {
			const history = deliveryFixtureHistory(variant, "fixture-conversation");
			expect(history?.[0]?.sender.kind).toBe("agent");
			const rows = deliveryAnnotations(
				history?.[0] ?? message(1, SELF, "2026-11-02T09:00:00Z"),
			);
			expect(rows).toHaveLength(2);
			expect(rows[1]?.label.includes("Unsafe content")).toBe(
				variant === "delivery-agent-owner",
			);
		}
	});
	it("omits invalid entries and unsafe extras without taking down body or siblings", () => {
		const input = message(1, SELF, "2026-11-02T09:00:00Z");
		const parsed = messageSchema.parse({
			...input,
			delivery_states: [
				{ ...recipient, state: "held", raw_reason: "synthetic private reason" },
				{ ...recipient, endpoint_id: "other", state: "future_state" },
			],
		});
		expect(parsed.body).toBe(input.body);
		expect(deliveryAnnotations(parsed)).toHaveLength(1);
		expect(
			JSON.stringify(deliveryAnnotations(parsed)).includes("private reason"),
		).toBe(false);
	});
	it("serves only known synthetic fixture variants, leaving ordinary history unchanged", () => {
		expect(
			deliveryFixtureHistory("unknown", "fixture-conversation"),
		).toBeUndefined();
		for (const variant of ["delivery-legacy", "delivery-delivered"]) {
			const history = deliveryFixtureHistory(variant, "fixture-conversation");
			expect(history).toHaveLength(2);
			expect(
				deliveryAnnotations(
					history?.[0] ?? message(1, SELF, "2026-11-02T09:00:00Z"),
				),
			).toEqual([]);
		}
	});
});
