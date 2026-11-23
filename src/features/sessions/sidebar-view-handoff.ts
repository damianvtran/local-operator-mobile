import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { createAttachmentSheetHandoff } from "@/features/session/attach-handoff";

/**
 * Close the View options sheet, then leave the drawer for Settings — and on iOS
 * only once the sheet's own native dismissal has finished.
 *
 * **Why ("More sidebar settings" opened a dead Settings page, 2026-11-22).**
 * The sheet is a `Sheet` — a React Native `Modal` — rendered INSIDE the
 * conversations drawer's own `Modal` (`conversations-drawer.tsx`). Its footer
 * ran `setOpen(false)`; `onNavigate?.()`; `router.push("/settings?section=
 * sidebar")` in one tick, so the sheet's dismissal, the drawer's dismissal and
 * the push all began together. Two nested native dismissals overlapped and iOS
 * left one controller presented over Settings: the page was dead, and its
 * accessibility tree was empty, so nothing could be read or touched either.
 *
 * **The rule is the attach sheet's** (`attach-handoff.ts`, #328/#354). A sheet
 * that hands off closes in one commit (`Sheet`'s `exitInstantly`, so iOS gets
 * ONE `visible` edge and `onDismiss` means the controller is gone), queues the
 * next step on the hand-off, and runs it from `onDismiss` — here, close the
 * drawer and then push. `onHidden` arms the same 1 s fallback for an
 * `onDismiss` that never arrives, so a lost callback costs a late Settings
 * screen rather than an inert one.
 *
 * **Not iOS launches at once**, exactly as before: Android's `Modal` has no
 * `onDismiss` to wait for, and the web has no presented-controller chain.
 *
 * A sibling module rather than a hook inside `sidebar-view-sheet.tsx` so the
 * native-host emulation (`sidebar-view-handoff.test.tsx`) mounts the SAME
 * wiring without that file's `uniwind`/`SidebarViewControls` chain.
 *
 * The hand-off is created with a NO-OP trace: `attachHandoffDiagnostics` and
 * the device sample `DISMISS_FALLBACK_MS` waits on are the ATTACH path's, and
 * a drawer close must not appear in Copy diagnostics as one.
 */
export type SidebarViewSheetHandoff = {
	open: boolean;
	/** The opener. A fresh open is the only place a spent hand-off is reset. */
	openSheet: () => void;
	/** A plain close (scrim, back): no hand-off, so the exit animation stays. */
	closeSheet: () => void;
	/**
	 * The footer link. Closes through the hand-off and runs `leave` once the
	 * sheet's native dismissal has finished (at once off iOS).
	 */
	moreSettings: (leave: () => void) => void;
	/** True only for the close a hand-off chose, and only on iOS. */
	exitInstantly: boolean;
	onDismiss: () => void;
	onHidden: () => void;
};

export const useSidebarViewHandoff = (): SidebarViewSheetHandoff => {
	const handoff = useRef(createAttachmentSheetHandoff(() => undefined)).current;
	const [open, setOpen] = useState(false);
	/* Set in the SAME update as the hand-off close, so the Sheet reads
	 *  `exitInstantly` on the commit that hides its Modal. A close without a
	 *  choice (scrim, back) must keep its exit, so this is never a plain
	 *  `true` while the sheet is closing. */
	const [handingOff, setHandingOff] = useState(false);

	/* Unmount (the drawer going away) cancels a queued step: a dismissal
	 *  arriving afterwards must not push Settings for a reader who left. */
	useEffect(() => () => handoff.cancel(), [handoff]);

	return {
		open,
		openSheet: () => {
			// A reopen is the hand-off's only re-admission point — the previous
			// open's latch must not survive it (`attach-handoff.ts`).
			handoff.cancel();
			setHandingOff(false);
			setOpen(true);
		},
		closeSheet: () => setOpen(false),
		moreSettings: (leave) => {
			setHandingOff(true);
			setOpen(false);
			handoff.choose(leave, Platform.OS);
		},
		exitInstantly: handingOff && Platform.OS === "ios",
		onDismiss: handoff.dismissed,
		onHidden: handoff.hidden,
	};
};
