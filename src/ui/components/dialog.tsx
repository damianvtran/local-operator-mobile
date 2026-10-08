import {
	Modal,
	Pressable,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScopedVariables } from "uniwind";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { maxColumnWidth } from "@/ui/column";
import { Button } from "@/ui/components/button";
import { Heading } from "@/ui/components/heading";
import {
	ModalScopeContext,
	useModalStackEntry,
} from "@/ui/components/modal-stack-entry";
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
	/* THE KIT'S PROSE MEASURE APPLIES TO A DIALOG TOO. The surface is content-sized,
	 *  so on a tablet it grew to whatever its longest line wanted: measured at
	 *  tablet-landscape/100 % the delete confirm's sentence rendered on one line,
	 *  ~105 characters, 758 pt of an 834 pt surface — and at 135 % the surface grew
	 *  to nearly the whole landscape screen. `Screen` caps every prose column at the
	 *  same three widths for exactly this reason (§ 22: a line of prose does not run
	 *  1,200 px wide); a dialog body is prose, so it takes the same cap. `null`
	 *  means "no cap" — the phone in portrait — and is left alone. */
	const maxWidth = maxColumnWidth(useWindowDimensions());
	/* A dialog raised while another modal is up stands down rather than painting a
	 *  second full-viewport surface over it — `@/ui/modal-stack` carries the rule and
	 *  why it is the primitive's job rather than a caller's prop. */
	const { covered, hostDims, scope } = useModalStackEntry(visible);
	/* THE DIMMER'S LIFETIME IS ITS CONTENT'S, NOT ITS `visible` PROP (round 8, R34).
	 *  `animationType="fade"` keeps this Modal's children — this scrim among them —
	 *  mounted while it dismisses, so gating on `visible` stopped the dim the instant
	 *  the fade began and left the card fading over an undimmed page. Measured on
	 *  `3f6c1c5` on the real path: the standalone delete confirm's scrim read
	 *  `rgba(0,0,0,0)` while the card was still at opacity 0.58, where `26f3682` held
	 *  0.7 and faded with it. The predicate is about the STACK, not the prop: a modal
	 *  that is not covered and has no dimming ancestor IS the dimmer, and it paints
	 *  whenever its own Modal renders it — which yields exactly one dim per stack in
	 *  every frame, and keeps a Dialog raised inside a hosted Sheet from repainting a
	 *  second one while it fades (round 6, D11). */
	const drawsDim = !covered && !hostDims;

	return (
		<ModalScopeContext.Provider value={scope}>
			<Modal
				visible={visible && !covered}
				transparent
				animationType="fade"
				onRequestClose={onCancel}
				accessibilityViewIsModal
				testID={testID}
			>
				<ScopedVariables variables={variables}>
					<View className="flex-1 items-center justify-center px-6">
						{/* Same rule as `Sheet`: one dim per stack, and a hosted dialog's
						 *  scrim is the press layer with no dim of its own. */}
						<Pressable
							className="absolute inset-0"
							style={{
								backgroundColor: drawsDim ? scrimColour : "transparent",
							}}
							accessibilityRole={ROLE.button}
							accessibilityLabel="Cancel"
							testID={CONTROL.dialogScrim}
							onPress={onCancel}
						/>
						<View
							className={DIALOG_SURFACE_CLASS}
							style={{
								...shadow,
								...(maxWidth === null ? {} : { maxWidth }),
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
		</ModalScopeContext.Provider>
	);
};
