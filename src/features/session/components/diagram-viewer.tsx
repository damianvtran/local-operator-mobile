import { X } from "lucide-react-native";
import {
	Modal,
	Pressable,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DiagramSvgView } from "@/features/session/components/diagram-svg-view";
import {
	DIAGRAM_FRAME_PAD,
	viewerScale,
} from "@/features/session/diagram-source";
import type { PreparedDiagram } from "@/features/session/diagram-svg";
import { t } from "@/i18n";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import {
	ModalScopeContext,
	useModalStackEntry,
} from "@/ui/components/modal-stack-entry";
import { HORIZONTAL_SCROLL_PROPS } from "@/ui/horizontal-scroll";
import { TOUCH_FLOOR } from "@/ui/layout";

/**
 * The full-screen diagram viewer, built on the pattern the Team Bridge image
 * viewer already ships (`team-bridge/attachment-views.tsx`, "design round 1, D2"):
 *
 *   - a full-screen `Modal` that joins the app's modal stack, so a sheet raised
 *     over it (or it over one) never paints two full surfaces;
 *   - zoom is a `ScrollView` with `maximumZoomScale` — native pinch-zoom on iOS;
 *     Android and web show the drawing at its viewer size. No gesture library
 *     and no new dependency, the same trade that viewer records;
 *   - pan: a vertical `ScrollView` around a horizontal one, so a diagram wider or
 *     taller than the window can be moved on every platform (iOS's zoomed pan is
 *     the outer view's own);
 *   - close: a 44 pt button and the system back gesture (`onRequestClose`).
 *
 * The drawing is vector, so it is redrawn at the viewer's scale (`viewerScale`:
 * as large as the window's width allows, up to 3x) rather than stretched from the
 * inline size. It paints from the same prepared tree, so it keeps the theme the
 * block was drawn with.
 */
export function DiagramViewer({
	prepared,
	onClose,
}: {
	prepared: PreparedDiagram;
	onClose: () => void;
}) {
	const { width, height } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const ink = useTokenColor("ink");
	const { covered, scope } = useModalStackEntry(true);
	const scale = viewerScale(prepared, width);
	const drawnWidth = prepared.width * scale;
	const drawnHeight = prepared.height * scale;
	return (
		<ModalScopeContext.Provider value={scope}>
			<Modal
				visible={!covered}
				transparent={false}
				animationType="fade"
				onRequestClose={onClose}
				accessibilityViewIsModal
				testID={SURFACE.diagramViewer}
			>
				{/* The dialog's accessible name, the `Sheet` pattern: RN's
				    AccessibilityRole has no dialog, so `role` + `aria-label`. */}
				<View
					role={ROLE.dialog}
					aria-label={t("mobile.session.diagram.viewer")}
					className="flex-1 bg-canvas"
				>
					<ScrollView
						maximumZoomScale={4}
						minimumZoomScale={1}
						centerContent
						showsVerticalScrollIndicator={false}
						contentContainerStyle={{
							minHeight: height,
							justifyContent: "center",
							paddingTop: insets.top + TOUCH_FLOOR + 16,
							paddingBottom: insets.bottom + 16,
						}}
					>
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={{
								minWidth: width,
								justifyContent: "center",
								paddingHorizontal: DIAGRAM_FRAME_PAD,
							}}
							{...HORIZONTAL_SCROLL_PROPS}
						>
							<View
								// The picture is out of the reading order; the figure's own
								// control carries its name and source.
								aria-hidden
								className="overflow-hidden rounded-sm border border-hairline bg-surface"
								style={{ padding: DIAGRAM_FRAME_PAD }}
							>
								<View style={{ width: drawnWidth, height: drawnHeight }}>
									<DiagramSvgView prepared={prepared} scale={scale} />
								</View>
							</View>
						</ScrollView>
					</ScrollView>
					<View
						pointerEvents="box-none"
						className="absolute start-0 end-0 flex-row px-4"
						style={{ top: insets.top + 8 }}
					>
						<Pressable
							accessibilityRole={ROLE.button}
							accessibilityLabel={t("mobile.session.diagram.close")}
							onPress={onClose}
							testID={CONTROL.diagramViewerClose}
							className="items-center justify-center rounded-full border border-border-control bg-elevated"
							style={{ width: TOUCH_FLOOR, height: TOUCH_FLOOR }}
						>
							<X color={ink} size={20} />
						</Pressable>
					</View>
				</View>
			</Modal>
		</ModalScopeContext.Provider>
	);
}
