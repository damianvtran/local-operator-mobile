import { Children, createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLocaleSource, setLocaleSource } from "@/i18n/locale";
import { message, SELF } from "@/team-bridge/__tests__/fixtures";
import { messageSchema } from "@/team-bridge/contract";
import { teamBridgeDeliveryHelpId, teamBridgeDeliveryId } from "@/ui/a11y";
import { IconButton } from "@/ui/components/icon-button";
import { MessageDelivery } from "./message-delivery";

// The DOM host is not a native appearance provider. Stub ONLY the shared
// primitive's rendering; activation below invokes the real component binding.
// The Node SSR host has no native SVG/Flow loader. Stub only the icon
// boundary; the actual annotation component and its action binding still run.
vi.mock("lucide-react-native", () => ({ Info: () => null }));

vi.mock("@/ui/components/icon-button", () => ({
	IconButton: (props: { accessibilityLabel: string; testID: string }) =>
		createElement("button", {
			type: "button",
			"aria-label": props.accessibilityLabel,
			"data-testid": props.testID,
		}),
}));

const entry = {
	endpoint_id: "fixture-endpoint",
	recipient_label: "Nova",
	recipient_owner_label: "Private owner label",
};
const render = (delivery_states?: unknown) =>
	renderToStaticMarkup(
		createElement(MessageDelivery, {
			message: messageSchema.parse({
				...message(1, SELF, "2026-11-02T09:00:00Z"),
				delivery_states,
			}),
			onHelp: () => {},
		}),
	);
beforeEach(() => setLocaleSource(() => "en"));
afterEach(() => resetLocaleSource());

describe("quiet message delivery component", () => {
	it("renders no extra DOM for absent, empty and delivered-only projections", () => {
		expect(render()).toBe("");
		expect(render([])).toBe("");
		expect(render([{ ...entry, state: "delivered" }])).toBe("");
	});
	it("renders generic waiting with stable recipient identity but no cause or alert", () => {
		const html = render([
			{ ...entry, state: "held", hold_class: "screening_unavailable" },
		]);
		expect(html).toContain("Nova: Waiting for delivery.");
		expect(html).toContain(teamBridgeDeliveryId("bcm_1", entry.endpoint_id));
		expect(html.includes("screening_unavailable")).toBe(false);
		expect(html.includes(entry.recipient_owner_label)).toBe(false);
		expect(html.includes('role="alert"')).toBe(false);
	});
	it("renders multiple wrapping metadata lines without a retry button or visible owner identity", () => {
		const html = render([
			{ ...entry, state: "held" },
			{
				...entry,
				endpoint_id: "fixture-other",
				state: "refused",
				refusal_class: "abusive",
			},
		]);
		expect(html).toContain("Nova: Waiting for delivery.");
		expect(html).toContain("Nova: Not delivered. (Abusive content)");
		expect(html).toContain(teamBridgeDeliveryId("bcm_1", "fixture-other"));
		expect(html.match(/<button/g) ?? []).toHaveLength(1);
		expect(html).toContain("About message delivery");
		expect(html.includes("Retry")).toBe(false);
		expect(html.includes(entry.recipient_owner_label)).toBe(false);
	});
	it("keeps endpoint test identity independent of display-label changes", () => {
		const first = render([{ ...entry, state: "held" }]);
		const renamed = render([
			{ ...entry, recipient_label: "Renamed agent", state: "held" },
		]);
		const id = teamBridgeDeliveryId("bcm_1", entry.endpoint_id);
		expect(first).toContain(id);
		expect(renamed).toContain(id);
		expect(renamed).toContain("Renamed agent: Waiting for delivery.");
	});
	it("binds the actual single info action to its message opener callback", () => {
		const onHelp = vi.fn();
		const parsed = messageSchema.parse({
			...message(1, SELF, "2026-11-02T09:00:00Z"),
			delivery_states: [{ ...entry, state: "held" }],
		});
		const tree = MessageDelivery({ message: parsed, onHelp });
		if (!tree) throw new Error("annotation group absent");
		const action = Children.toArray(tree.props.children).find(
			(child) => isValidElement(child) && child.type === IconButton,
		);
		if (
			!isValidElement<{ onPress: () => void; accessibilityLabel: string }>(
				action,
			)
		)
			throw new Error("info action absent");
		expect(action.props.accessibilityLabel).toBe("About message delivery");
		action.props.onPress();
		expect(onHelp).toHaveBeenCalledExactlyOnceWith(
			teamBridgeDeliveryHelpId(parsed.id),
		);
	});
});
