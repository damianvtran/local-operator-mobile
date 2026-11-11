import { Info } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { t } from "@/i18n";
import type { Message } from "@/team-bridge/contract";
import { deliveryAnnotations } from "@/team-bridge/delivery-states";
import {
	ROLE,
	teamBridgeDeliveryHelpId,
	teamBridgeDeliveryId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

/** Quiet metadata in the message's existing body column. It is neither an alert
 * nor a retry action; do not announce delivered/absent recipients or compete
 * with the message. Native Text wraps at large sizes and in RTL layouts.
 *
 * INLINE COMPACT INFO CONTROL: instead of a standalone 44×44 pt block-level
 * `<IconButton>` row underneath every held/refused message, the info affordance
 * sits inline beside the annotation stack on one compact row with a `TOUCH_FLOOR`
 * hit box on the trailing info button. */
export function MessageDelivery({
	message,
	onHelp,
}: {
	message: Message;
	onHelp: (opener: string) => void;
}) {
	const annotations = deliveryAnnotations(message);
	const iconColor = useTokenColor("ink-dim");
	if (!annotations.length) return null;
	const openerId = teamBridgeDeliveryHelpId(message.id);
	return (
		<View className="mt-1 flex-row items-center gap-1.5">
			<View className="min-w-0 shrink gap-0.5">
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
			</View>
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={t("mobile.team_bridge.delivery.help_action")}
				testID={openerId}
				onPress={() => onHelp(openerId)}
				hitSlop={8}
				style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
				className="-my-2.5 items-center justify-center rounded-sm"
			>
				{({ pressed }) => (
					<View
						className={cx(
							"h-6 w-6 items-center justify-center rounded-full",
							pressed ? "bg-row-hover" : "bg-transparent",
						)}
					>
						<Info size={14} color={iconColor} aria-hidden />
					</View>
				)}
			</Pressable>
		</View>
	);
}
