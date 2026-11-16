/**
 * Close a sheet, THEN open a system picker — on iOS, only once the sheet's
 * native dismissal has finished.
 *
 * **Why (the leading hypothesis for "the attach button doesn't open my photos",
 * 2026-11-15).** `expo-image-picker` and `expo-file-system` present their
 * pickers with `currentViewController().present(…)` (`ImagePickerModule.swift`,
 * `presentPickerUI`, read at 57.0.20). UIKit silently refuses a presentation
 * from a view controller that is still being dismissed: no picker appears, no
 * delegate callback ever fires, and the JavaScript promise never settles — so
 * the reader sees nothing happen and the composer's `attaching` latch stays on.
 * A React Native `Modal` (every `Sheet`) is exactly such a controller while it
 * animates out. So the launch waits for the Modal's own `onDismiss`.
 *
 * **No timer fallback on iOS any more.** This used to launch anyway after
 * 500 ms if `onDismiss` had not arrived. That number was never measured against
 * the dismissal it raced (the sheet's exit animation plus the native dismiss,
 * both stretched by a busy JS thread), and when it won the race it produced the
 * very failure above. Without it, a lost `onDismiss` launches nothing — and
 * because the owner's busy state is only set BY the launch, nothing is stranded:
 * the reader presses Attach again, whose `cancel()` re-admits a fresh choice.
 *
 * **Android and web launch immediately.** Android's pickers are separate
 * activities started for a result, not controllers presented over the dialog,
 * and the web chooser is the browser's own; neither has the dismissal race, and
 * Android's `Modal` has no `onDismiss` to wait for.
 *
 * A plain module (no `react-native` import) so both sheets that launch pickers
 * — the composer's add-image sheet and Team Bridge's — share one tested rule.
 */
export function createAttachmentSheetHandoff() {
	let pending: (() => void) | undefined;
	let chosen = false;
	const cancel = () => {
		pending = undefined;
		chosen = false;
	};
	const dismissed = () => {
		const launch = pending;
		// Consuming a selection is NOT reopening the sheet: queued row events
		// after onDismiss must not launch a second, different picker.
		pending = undefined;
		launch?.();
	};
	return {
		choose: (launch: () => void, platform: string) => {
			// First iOS choice wins for this open, including the native dismissal
			// window. The opener's explicit cancel() is the only re-admission point.
			if (platform === "ios" && chosen) return;
			cancel();
			if (platform !== "ios") {
				launch();
				return;
			}
			chosen = true;
			pending = launch;
		},
		dismissed,
		cancel,
	};
}

export type AttachmentSheetHandoff = ReturnType<
	typeof createAttachmentSheetHandoff
>;
