import {
	Modal,
	Pressable,
	ScrollView,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScopedVariables } from "uniwind";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
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
/** The root's own breathing room above and below the surface, in pt (the `px-6` rhythm). */
const DIALOG_EDGE = 24;

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
	const windowDims = useWindowDimensions();
	const windowHeight = windowDims.height;
	const maxWidth = maxColumnWidth(windowDims);
	/* A dialog raised while another modal is up stands down rather than painting a
	 *  second full-viewport surface over it — `@/ui/modal-stack` carries the rule and
	 *  why it is the primitive's job rather than a caller's prop. */
	const { covered, dims: drawsDim, scope } = useModalStackEntry(visible);

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
						{/* THE SAFE-AREA BANDS ARE PADDING ON A WRAPPER, NOT A MARGIN ON THE SURFACE.
						 *  The inset is a device fact (59 pt on a landscape phone), not a spacing
						 *  decision, and U-42 reads a padding equal to the declared inset as the
						 *  inset but a MARGIN of the same size as an off-scale step — 32 FAILs on
						 *  the landscape delete/milestone confirms. So the inset lives on a
						 *  full-width carrier whose only job is to keep the surface out of the
						 *  bands, and the surface keeps nothing but its own token spacing. The
						 *  carrier sits INSIDE the root, so `px-6` (the phone's own margin) is not
						 *  overridden and the scrim — `absolute inset-0` on the root — still dims
						 *  the bands. Plain RN styles: identical on web, iOS and Android. */}
						{/* `box-none`: the carrier spans the whole width so it can hold the
						 *  padding, but it is NOT a press target. As a hit-testable box it sat
						 *  above the scrim and swallowed a tap beside the dialog (the old margin
						 *  was not hit-testable, so that tap used to reach the scrim and
						 *  dismiss). `box-none` hands the strip back to the scrim and keeps only
						 *  the surface itself interactive. */}
						<View
							pointerEvents="box-none"
							className="w-full items-center"
							style={{ paddingLeft: insets.left, paddingRight: insets.right }}
						>
							<View
								className={DIALOG_SURFACE_CLASS}
								style={{
									...shadow,
									...(maxWidth === null ? {} : { maxWidth }),
									// BOUNDED: a long body must not push Cancel/Confirm off a short
									// landscape screen (a 161-char body at 200 % text on 667x375 was
									// unmeasured and the surface had no fallback). The surface may take
									// the window less the vertical insets and the root's own margin; the
									// body scrolls INSIDE it and the actions stay pinned beneath it.
									maxHeight: Math.max(
										160,
										windowHeight - insets.top - insets.bottom - 2 * DIALOG_EDGE,
									),
								}}
							>
								<Heading level={2} className="text-title text-ink">
									{title}
								</Heading>
								<ScrollView
									style={{ flexShrink: 1 }}
									testID={SURFACE.dialogBody}
								>
									<Text className="mt-2 text-body-sm text-ink-muted">
										{body}
									</Text>
								</ScrollView>
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
					</View>
				</ScopedVariables>
			</Modal>
		</ModalScopeContext.Provider>
	);
};
