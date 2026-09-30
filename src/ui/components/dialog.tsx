import { Modal, Pressable, Text, View } from "react-native";

import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { useShadow } from "@/ui/elevation";
import { DIALOG_SURFACE_CLASS } from "@/ui/variants";

/**
 * A centred confirmation — the EXCEPTION on a phone, not the rule
 * (docs/design/components.md § 9). Use it only for a destructive confirmation
 * that must be answered before anything else, where a bottom sheet's
 * swipeability would undercut the weight of the decision. Everything else is a
 * Sheet.
 *
 * The destructive action is never the default and never first: the reversibility
 * rule from § 2 — where two actions are plausible, the reversible one is
 * primary — is what decides the order here.
 */
export type DialogProps = {
	visible: boolean;
	title: string;
	body: string;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	/** `danger` paints the confirm action with the danger binding. */
	destructive?: boolean;
	busy?: boolean;
	testID?: string;
};

export const Dialog = ({
	visible,
	title,
	body,
	confirmLabel,
	onConfirm,
	onCancel,
	destructive = false,
	busy = false,
	testID,
}: DialogProps) => {
	const shadow = useShadow("overlay");
	const scrimColour = useTokenColor("scrim");

	return (
		<Modal
			visible={visible}
			transparent
			animationType="fade"
			onRequestClose={onCancel}
			accessibilityViewIsModal
			testID={testID}
		>
			<View className="flex-1 items-center justify-center px-6">
				<Pressable
					className="absolute inset-0"
					style={{ backgroundColor: scrimColour }}
					accessibilityRole={ROLE.button}
					accessibilityLabel="Cancel"
					testID={CONTROL.dialogScrim}
					onPress={onCancel}
				/>
				<View className={DIALOG_SURFACE_CLASS} style={{ ...shadow }}>
					<Text className="text-title text-ink" accessibilityRole={ROLE.header}>
						{title}
					</Text>
					<Text className="mt-2 text-body-sm text-ink-muted">{body}</Text>
					<View className="mt-4 flex-row justify-end gap-2">
						<Button
							label="Cancel"
							variant="quiet"
							testID={CONTROL.dialogCancel}
							onPress={onCancel}
						/>
						<Button
							label={confirmLabel}
							variant={destructive ? "danger" : "primary"}
							loading={busy}
							testID={CONTROL.dialogConfirm}
							onPress={onConfirm}
						/>
					</View>
				</View>
			</View>
		</Modal>
	);
};
