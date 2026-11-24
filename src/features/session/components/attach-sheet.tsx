import {
	Camera,
	ClipboardPaste,
	FolderOpen,
	Images,
	type LucideIcon,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	ActivityIndicator,
	Linking,
	Platform,
	Pressable,
	Text,
	View,
} from "react-native";

import { prepareCamera } from "@/features/session/attach";
import {
	type AttachSource,
	attachActions,
	type CameraReadiness,
} from "@/features/session/attach-rule";
import { t } from "@/i18n";
import { attachOptionId, CONTROL, ROLE, SURFACE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Banner, Sheet } from "@/ui/components";
import { TOUCH_FLOOR } from "@/ui/layout";
import { CONTROL_DISABLED_INK } from "@/ui/variants";

/**
 * The composer's add-image menu: one bottom sheet of icon-led rows behind the
 * composer's attach (paperclip) button.
 *
 * **Why one ＋ and a menu, not a camera button in the composer.** The collapsed
 * dock is one 44 pt row — attach · field · trailing — and the expanded card's
 * controls row already carries attach, model, effort, folder, mic, stop and send
 * (`composer.tsx`, "the dock rests as the two-row card"). A permanent camera
 * button would take field width from every message to serve an occasional one,
 * and at 320 pt / 200 % text that row has no width to give. iMessage, WhatsApp,
 * Telegram and the ChatGPT app all solve the same constraint the same way: one
 * add control, and the sources (photos, camera, files) behind it. The sheet
 * stays this app's bottom sheet (`Sheet`) rather than a popover because a
 * bottom-anchored list is under the thumb that pressed ＋, and the kit has no
 * anchored popover primitive (docs/design/components.md § 8).
 *
 * **Icons.** Each row leads with the glyph the platform's own UI uses for that
 * source — photo stack, camera, folder, clipboard — so the row is recognised
 * before it is read, and the label repeats it for everyone the glyph is not
 * enough for. The glyph is decorative (`aria-hidden`): the row's accessible name
 * is its label alone.
 *
 * **The camera row asks first, here.** A press on Camera runs `prepareCamera`
 * while the sheet is still open: the OS consent prompt (first time only) appears
 * over it, and a refusal the OS will not re-ask becomes a notice in this sheet
 * with Open Settings — the one place a reader can turn it back on — rather than
 * a sheet that closes on a press that did nothing. Every other row, and a camera
 * that is ready, hands its source to `onChoose`, which closes the sheet and
 * launches the picker through the composer's iOS dismissal handoff.
 */

/** The decorative glyph per source; a record so a new source fails typecheck
 *  until it has one. */
const SOURCE_GLYPH: Record<AttachSource, LucideIcon> = {
	library: Images,
	camera: Camera,
	files: FolderOpen,
	paste: ClipboardPaste,
};

/** Glyph size: the kit's 20 pt control glyph (the composer's own ＋ and mic),
 *  inside a 36 pt tile so the four rows share one leading edge and rhythm. */
const ROW_GLYPH_PT = 20;
const ROW_TILE_PT = 36;

export type AttachSheetProps = {
	visible: boolean;
	onClose: () => void;
	/** The Modal's dismissal, forwarded to the composer's picker handoff. */
	onDismiss: () => void;
	/** Forwarded to `Sheet`: the commit that let the native Modal go, where the
	 *  handoff arms its fallback for an `onDismiss` that never comes (#328).
	 *  With this sheet's instant iOS hand-off close that is the close commit. */
	onHidden?: () => void;
	/** A source the reader chose and that is ready to open. */
	onChoose: (source: AttachSource) => void;
	/** Test seam for the camera's readiness check; the product passes nothing. */
	checkCamera?: () => Promise<CameraReadiness>;
	/**
	 * The rows this host can actually read, in the sheet's own order. Team
	 * Bridge renders this same sheet (round 1, U5/D1: one add control, one look
	 * across the app) but its upload pipeline bounds images from a URI with known
	 * dimensions, which the document picker does not give — so it leaves out
	 * Files rather than showing a row that cannot work. Omitted = every row.
	 */
	sources?: readonly AttachSource[];
	/** The sheet's and rows' test IDs, so a host keeps the IDs its existing
	 *  automation and audits already address. */
	testID?: string;
	optionId?: (source: AttachSource) => string;
	/** The sheet's heading; each host keeps the title it already shipped. */
	title: string;
};

/** The camera notice's sentence. Only `denied` (the OS will never ask again)
 *  carries Open Settings; `refused` is a plain statement because the next press
 *  on Take Photo re-prompts. */
const noticeMessage = (notice: Exclude<CameraReadiness, "ready">): string => {
	switch (notice) {
		case "denied":
			return t("mobile.composer_input.attach.camera_denied");
		case "refused":
			return t("mobile.composer_input.attach.camera_refused");
		case "unavailable":
			return t("mobile.composer_input.attach.camera_unavailable");
		case "failed":
			// The composer's own camera error line: the same fact, one sentence.
			return t("mobile.composer_input.attach.camera_error");
	}
};

export const AttachSheet = ({
	visible,
	onClose,
	onDismiss,
	onHidden,
	onChoose,
	checkCamera = prepareCamera,
	sources,
	testID = SURFACE.attachSheet,
	optionId = attachOptionId,
	title,
}: AttachSheetProps) => {
	const glyphInk = useTokenColor("ink-muted");
	const disabledGlyphInk = useTokenColor("ink-dim");
	const pressedGround = useTokenColor("row-hover");
	const [cameraNotice, setCameraNotice] = useState<Exclude<
		CameraReadiness,
		"ready"
	> | null>(null);
	const [checking, setChecking] = useState(false);
	/* The open the camera check belongs to. A reader can close the sheet while the
	 *  OS prompt is still up; the answer must not then open the camera, or a notice,
	 *  for a sheet nobody is looking at. */
	/* The epoch moves on EVERY way the reader leaves the pending check, not only
	 *  on a reopen (PR #278 round 1, U4): the sheet opening, the sheet closing
	 *  (`visible` false), and the reader picking another row. Otherwise a late
	 *  `ready` from a slow status read could open the camera over a sheet the
	 *  reader left, or right after the Files/Library picker already launched. */
	const openEpoch = useRef(0);
	/* Set in the SAME update as the choice that closes the sheet, so on iOS the
	 *  sheet closes with no exit animation and its native `onDismiss` — the
	 *  owner's picker handoff — fires only once the controller is gone. An
	 *  animated close fired it from a momentary dismissal mid-exit and the picker
	 *  was taken down with the returning sheet (TestFlight 1333; `Sheet`'s
	 *  `exitInstantly` has the native-source detail). A close without a choice
	 *  (scrim, Close) keeps the exit. */
	const [handingOff, setHandingOff] = useState(false);
	useEffect(() => {
		openEpoch.current += 1;
		if (!visible) return;
		// A fresh open starts clean: the reader may have changed the setting in
		// Settings since the notice was shown, and the next press re-reads it.
		setCameraNotice(null);
		setChecking(false);
		setHandingOff(false);
	}, [visible]);

	/* iOS VoiceOver ignores `accessibilityLiveRegion` (Android/web only), so the
	 *  Banner's polite live region says nothing there and the press on Take
	 *  Photo seems to do nothing (U2). Post the notice's words on iOS, the same
	 *  split `HealthAnnouncer` in session-health.tsx uses. */
	useEffect(() => {
		if (cameraNotice === null || Platform.OS !== "ios") return;
		AccessibilityInfo.announceForAccessibility(noticeMessage(cameraNotice));
	}, [cameraNotice]);

	const choose = (source: AttachSource) => {
		openEpoch.current += 1;
		setHandingOff(true);
		onChoose(source);
	};

	const chooseCamera = () => {
		if (checking) return;
		const epoch = openEpoch.current;
		setChecking(true);
		setCameraNotice(null);
		void checkCamera().then((readiness) => {
			if (epoch !== openEpoch.current) return;
			setChecking(false);
			if (readiness === "ready") choose("camera");
			else setCameraNotice(readiness);
		});
	};

	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			onDismiss={onDismiss}
			onHidden={onHidden}
			exitInstantly={handingOff && Platform.OS === "ios"}
			title={title}
			testID={testID}
		>
			<View className="gap-1 py-1">
				{cameraNotice !== null ? (
					<View className="mb-2">
						<Banner
							tone="warning"
							message={noticeMessage(cameraNotice)}
							action={
								cameraNotice === "denied"
									? {
											label: t("mobile.composer_input.attach.open_settings"),
											onPress: () =>
												void Linking.openSettings().catch(() => undefined),
											testID: CONTROL.attachCameraSettings,
										}
									: undefined
							}
							testID={SURFACE.attachCameraNotice}
						/>
					</View>
				) : null}
				{attachActions(Platform.OS === "web" ? "web" : "native")
					.filter((action) => sources?.includes(action.source) ?? true)
					.map((action) => {
						const Glyph = SOURCE_GLYPH[action.source];
						const busy = action.source === "camera" && checking;
						/* No camera on this device (the iOS simulator): the notice
						 *  says so, and the row stays disabled for the rest of this
						 *  open instead of re-offering a press that cannot work. A
						 *  check that THREW is `failed` and stays live (U3). Dimmed
						 *  with the kit's disabled ink so it does not look tappable
						 *  (D1/U3; `CONTROL_DISABLED_INK`). */
						const disabled =
							action.source === "camera" && cameraNotice === "unavailable";
						return (
							<Pressable
								key={action.source}
								accessibilityRole={ROLE.button}
								accessibilityLabel={action.label}
								accessibilityState={state({ busy, disabled })}
								disabled={disabled}
								onPress={() =>
									action.source === "camera"
										? chooseCamera()
										: choose(action.source)
								}
								testID={optionId(action.source)}
								className="rounded-md"
								style={({ pressed }) =>
									pressed ? { backgroundColor: pressedGround } : undefined
								}
							>
								<View
									className="flex-row items-center gap-3 px-2"
									style={{ minHeight: TOUCH_FLOOR + 8 }}
								>
									<View
										className="items-center justify-center rounded-full bg-sunken"
										style={{ width: ROW_TILE_PT, height: ROW_TILE_PT }}
										aria-hidden
									>
										{busy ? (
											<ActivityIndicator size="small" color={glyphInk} />
										) : (
											<Glyph
												size={ROW_GLYPH_PT}
												color={disabled ? disabledGlyphInk : glyphInk}
												aria-hidden
											/>
										)}
									</View>
									<Text
										className={`min-w-0 flex-1 text-body ${
											disabled ? CONTROL_DISABLED_INK : "text-ink"
										}`}
									>
										{action.label}
									</Text>
								</View>
							</Pressable>
						);
					})}
			</View>
		</Sheet>
	);
};
