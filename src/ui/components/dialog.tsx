import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScopedVariables } from "uniwind";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { Heading } from "@/ui/components/heading";
import { useShadow } from "@/ui/elevation";
import { useTextScale } from "@/ui/text-scale-provider";
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
	/* The side bands. A centred dialog normally touches neither screen edge, but the
	 *  surface is as wide as its content allows and on a landscape phone that is the
	 *  whole viewport: measured at iphone-15-landscape (insets 59/59, resolved by the
	 *  capture rig) it spans x = 24…820 of 844, so the title paints at x = 41 and the
	 *  confirm action's right edge reaches x = 800 — both inside the band. */
	const insets = useSafeAreaInsets();
	/* The scaled type variables, republished INSIDE the modal — the same defect the
	 *  sheet carries the fix for, and the reason it is here rather than assumed. A
	 *  React Native `Modal` renders through its own root (on the web,
	 *  react-native-web portals it to a fresh node under `document.body`), which sits
	 *  outside the element `TextScaleProvider` writes the scaled variables onto. So
	 *  the dialog's own type kept the 100 % sizes while everything around it scaled —
	 *  MEASURED on the capture that added the delete confirm's cell: at a 200 %
	 *  setting the dialog still rendered its 15 px and 20 px roles at 15 and 20, and
	 *  the cell was correctly reported as unmeasurable for large text. */
	const { variables } = useTextScale();

	return (
		<Modal
			visible={visible}
			transparent
			animationType="fade"
			onRequestClose={onCancel}
			accessibilityViewIsModal
			testID={testID}
		>
			<ScopedVariables variables={variables}>
				<View className="flex-1 items-center justify-center px-6">
					<Pressable
						className="absolute inset-0"
						style={{ backgroundColor: scrimColour }}
						accessibilityRole={ROLE.button}
						accessibilityLabel="Cancel"
						testID={CONTROL.dialogScrim}
						onPress={onCancel}
					/>
					<View
						className={DIALOG_SURFACE_CLASS}
						style={{
							...shadow,
							/* A MARGIN on the surface, not padding on the modal's root. `px-6` on the
							 *  root is the phone's own margin, and an inline `paddingLeft` would
							 *  OVERRIDE it rather than add to it; padding the root would also move the
							 *  scrim, which is `absolute inset-0` on that same box, and leave the
							 *  band it no longer covers undimmed. The margin is outside the dialog, so
							 *  both the surface and the band keep the meaning they had. */
							marginLeft: insets.left,
							marginRight: insets.right,
						}}
					>
						<Heading level={2} className="text-title text-ink">
							{title}
						</Heading>
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
			</ScopedVariables>
		</Modal>
	);
};
