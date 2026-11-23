/**
 * Close a sheet, THEN open a system picker — on iOS, only once the sheet's
 * native dismissal has finished.
 *
 * **Why ("Photo Library / Files doesn't open", TestFlight 1157 and the
 * 2026-11-15 report).** `expo-image-picker` and `expo-file-system` present their
 * pickers with `appContext.utilities.currentViewController().present(…)`.
 * That helper walks the presented chain but STOPS at a controller that
 * `isBeingDismissed` (expo-modules-core `Utilities.swift`), so a launch during a
 * sheet's dismissal presents either onto the dismissing sheet (and is taken
 * down with it) or onto a presenter that is still mid-transition (UIKit refuses
 * it). Either way no picker appears, no delegate callback fires, and the
 * JavaScript promise never settles — the reader sees nothing happen and the
 * owner's `attaching` latch keeps Attach disabled. A React Native `Modal` (every
 * `Sheet`) is exactly such a controller while it animates out, so the launch
 * waits for the Modal's own `onDismiss`, which React Native fires from the
 * native `dismissViewController` completion (`RCTModalHostViewComponentView.mm`)
 * — the first moment a presentation is safe.
 *
 * **A fallback, started only once the Modal has been told to hide (#248).**
 * Native delivery of `onDismiss` was never proven on a device, and on iOS 26 a
 * reader saw the sheet close and no picker appear. So `hidden()` — the Sheet's
 * `onHidden`, called from the commit that stops holding the Modal shown, AFTER
 * its exit animation — arms `DISMISS_FALLBACK_MS`; whichever of the timer and
 * `onDismiss` runs first launches, and the other finds nothing pending. This is
 * not the old 500 ms timer: that one started at the row PRESS and raced the
 * exit animation, its JS finish callback and re-render, all stretched by a busy
 * JS thread (TestFlight 1157). This one cannot start before the JS side has
 * committed the hide, and it runs on that same JS thread, so a busy JS thread
 * only makes it later. What it still races is the UI thread mounting that
 * commit and running the dismissal, which is not animated (`animationType=
 * "none"`, so `dismissViewControllerAnimated:NO`) — see the constant.
 *
 * **What an early fallback costs.** If the timer wins before UIKit has begun
 * the dismissal, the picker's presentation is refused (or taken down with the
 * sheet): no picker, and a promise that never settles. That would strand the
 * owner's `attaching` latch — Attach, Paste and Clear disabled — so the owners
 * release a FALLBACK-launched pick through `createAttachLatch`
 * (`attach-latch.ts`). What JavaScript
 * cannot undo: `expo-file-system` keeps its picking context, so a later
 * **Files** pick is refused for the rest of that app run, shown as the
 * existing attach error line (visible, not silent). A lost `onDismiss` with no
 * fallback strands nothing, because the latch is set only BY the launch.
 *
 * **Measurable in a release build.** Each waiting choice records which path
 * launched it, how long after the hide commit, and whether `onDismiss` came
 * late after a fallback, in a bounded in-memory trail that Settings → Copy
 * diagnostics includes (`attachHandoffDiagnostics`). No content, no names:
 * a path word and milliseconds. Plain closes, the web and Android record
 * nothing, so the trail is exactly the sample `DISMISS_FALLBACK_MS` needs.
 *
 * **The caller must close the sheet with `exitInstantly` (TestFlight 1333).**
 * `onDismiss` means "the controller is gone" only when the Modal is given ONE
 * `visible` edge. An animated close hands it `false`, then `true` again for the
 * exit (`useModalExit` sets `exiting` in an effect), and iOS fires `onDismiss`
 * from that first, momentary dismissal while it presents the sheet again — the
 * picker launched onto the returning sheet and was taken down with it. A row
 * that calls `choose` therefore sets its owner's hand-off flag in the same
 * update as the close (`Sheet`'s `exitInstantly` has the native-source detail).
 *
 * **Android and web launch immediately.** Android's pickers are separate
 * activities started for a result, not controllers presented over the dialog,
 * and the web chooser is the browser's own; neither has the dismissal race, and
 * Android's `Modal` has no `onDismiss` to wait for.
 *
 * A plain module (no `react-native` import) so both sheets that launch pickers
 * — the composer's attach sheet and Team Bridge's — share one tested rule.
 * Split from local-operator-mobile PR #278 without its camera work.
 */
/**
 * How long after the hide commit `onDismiss` may take before the picker
 * launches anyway.
 *
 * NOT MEASURED ON A DEVICE: no lane here can run iOS. The trail below
 * (Settings → Copy diagnostics, release builds included) is the instrument;
 * the size is a maintainer decision pending that measurement. What bounds it
 * meanwhile: the dismissal it waits for is not animated (`animationType="none"`
 * on the Sheet's Modal maps to `dismissViewControllerAnimated:NO` in React
 * Native 0.86's `RCTModalHostViewComponentView.mm`), so the work is mounting
 * one prop change and one UIKit transaction — frames (8–17 ms each at
 * 120/60 Hz), not an animation. One second is about 60 frames at 60 Hz; it only
 * loses to a UI-thread stall longer than that.
 *
 * BOTH SIDES OF RESIZING IT. Larger: when `onDismiss` is lost, the picker
 * appears that much later. Smaller: more chance the timer beats the native
 * dismissal, whose cost is the paragraph "What an early fallback costs" above.
 *
 * INVARIANT: the timer starts no earlier than the commit that hides the Modal
 * (`useModalExit`'s `onHidden`), so it never races the exit animation, and the
 * pending launch is consumed by whichever path runs first, so the picker opens
 * at most once per choice.
 */
export const DISMISS_FALLBACK_MS = 1_000;

type HandoffTrace = {
	/** `late-onDismiss`: the callback arrived after the fallback had launched,
	 *  which tells a late `onDismiss` from a lost one. */
	via: "onDismiss" | "fallback" | "late-onDismiss";
	afterHiddenMs: number | null;
};

/** How many traces Copy diagnostics carries: the newest, enough for the
 *  n ≥ 10 sample the constant is waiting on. */
const TRAIL_LIMIT = 20;
const trail: string[] = [];

/** The newest handoff traces as one line for Copy diagnostics, or `null`. */
export const attachHandoffDiagnostics = (): string | null =>
	trail.length === 0 ? null : trail.join(", ");

/* Release builds keep the bounded trail; dev builds also log it. */
const recordTrace = (event: HandoffTrace) => {
	const ms = event.afterHiddenMs === null ? "?" : `${event.afterHiddenMs}`;
	trail.push(
		`${event.via === "late-onDismiss" ? "late onDismiss" : event.via} ${ms}ms`,
	);
	if (trail.length > TRAIL_LIMIT) trail.splice(0, trail.length - TRAIL_LIMIT);
	if (typeof __DEV__ !== "undefined" && __DEV__)
		console.info("[attach-handoff]", event);
};

/* Set only while a handoff is calling its launch, which starts the owner's
 * pick synchronously (an async function runs to its first `await` at once):
 * the owner's latch reads it to know whether this pick came from the
 * fallback, the one launch that can strand (`attach-latch.ts`). */
let launchingVia: "onDismiss" | "fallback" | undefined;

/** True only inside a launch the dismiss FALLBACK made. */
export const launchingFromFallback = (): boolean => launchingVia === "fallback";

export function createAttachmentSheetHandoff(trace = recordTrace) {
	let pending: (() => void) | undefined;
	let chosen = false;
	let fallback: ReturnType<typeof setTimeout> | undefined;
	let hiddenAt: number | undefined;
	/** The fallback launched; an `onDismiss` after it is traced as late. */
	let fellBack = false;
	const disarm = () => {
		if (fallback !== undefined) clearTimeout(fallback);
		fallback = undefined;
	};
	const cancel = () => {
		disarm();
		pending = undefined;
		chosen = false;
		hiddenAt = undefined;
		fellBack = false;
	};
	const since = () => (hiddenAt === undefined ? null : Date.now() - hiddenAt);
	const launchPending = (via: "onDismiss" | "fallback", launch: () => void) => {
		disarm();
		// Consuming a selection is NOT reopening the sheet: queued row events
		// after onDismiss must not launch a second, different picker.
		pending = undefined;
		trace({ via, afterHiddenMs: since() });
		fellBack = via === "fallback";
		launchingVia = via;
		try {
			launch();
		} finally {
			launchingVia = undefined;
		}
	};
	const dismissed = () => {
		if (pending !== undefined) launchPending("onDismiss", pending);
		else if (fellBack) trace({ via: "late-onDismiss", afterHiddenMs: since() });
		hiddenAt = undefined;
		fellBack = false;
	};
	const hidden = () => {
		// Only an iOS choice waits; with nothing pending there is nothing to owe.
		if (pending === undefined || fallback !== undefined) return;
		hiddenAt = Date.now();
		const launch = pending;
		fallback = setTimeout(
			() => launchPending("fallback", launch),
			DISMISS_FALLBACK_MS,
		);
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
		hidden,
		cancel,
	};
}

export type AttachmentSheetHandoff = ReturnType<
	typeof createAttachmentSheetHandoff
>;
