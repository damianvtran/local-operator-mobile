import { t } from "@/i18n";
import type { Message } from "./contract";

const refusalClasses = new Set([
	"manipulation",
	"personal_info",
	"abusive",
	"unsafe_content",
	"out_of_scope",
]);

/** The hub already authorized this HUMAN projection. Sender kind is not an ACL:
 * recipient owners can see entries on agent-origin messages, and sending-agent
 * owners can receive generic entries. Omission is never evidence of delivery.
 * Only recipient labels enter copy; endpoint IDs are stable identity, not text. */
export function deliveryAnnotations(message: Pick<Message, "delivery_states">) {
	return (message.delivery_states ?? []).flatMap((entry) => {
		if (entry.state === "delivered") return [];
		const recipient =
			entry.recipient_label.trim() ||
			t("mobile.team_bridge.delivery.recipient");
		if (entry.state === "held")
			return [
				{
					endpointId: entry.endpoint_id,
					label: t("mobile.team_bridge.delivery.held", { recipient }),
					help: undefined as string | undefined,
				},
			];
		if (entry.state !== "refused") return [];
		// Unknown optional classes remain generic, including when supplied by a
		// future caller: never render an enum/raw reason or infer a missing cause.
		const category =
			entry.refusal_class && refusalClasses.has(entry.refusal_class)
				? entry.refusal_class
				: "none";
		return [
			{
				endpointId: entry.endpoint_id,
				label: t("mobile.team_bridge.delivery.refused", {
					recipient,
					category,
				}),
				help: t("mobile.team_bridge.delivery.help"),
			},
		];
	});
}
