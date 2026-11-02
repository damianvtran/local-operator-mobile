import { Info } from "lucide-react-native";
import { Text, View } from "react-native";
import { t } from "@/i18n";
import type { Message } from "@/team-bridge/contract";
import { deliveryAnnotations } from "@/team-bridge/delivery-states";
import { teamBridgeDeliveryHelpId, teamBridgeDeliveryId } from "@/ui/a11y";
import { IconButton } from "@/ui/components/icon-button";

/** Quiet metadata in the message's existing body column. It is neither an alert
 * nor a retry action; do not announce delivered/absent recipients or compete
 * with the message. Native Text wraps at large sizes and in RTL layouts. */
export function MessageDelivery({
	message,
	onHelp,
}: {
	message: Message;
	onHelp: (opener: string) => void;
}) {
	const annotations = deliveryAnnotations(message);
	if (!annotations.length) return null;
	return (
		<View className="mt-1 gap-1">
			{annotations.map((annotation) => (
				<Text
					key={annotation.endpointId}
					testID={teamBridgeDeliveryId(message.id, annotation.endpointId)}
					className="text-meta text-ink-muted"
					accessibilityHint={annotation.help}
				>
					{annotation.label}
				</Text>
			))}
			<IconButton
				accessibilityLabel={t("mobile.team_bridge.delivery.help_action")}
				testID={teamBridgeDeliveryHelpId(message.id)}
				onPress={() => onHelp(teamBridgeDeliveryHelpId(message.id))}
				icon={(props) => <Info {...props} />}
			/>
		</View>
	);
}
