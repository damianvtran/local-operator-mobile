import { Platform, Pressable } from "react-native";

import { CONTROL } from "@/ui/a11y";

/**
 * A PROOF-BUNDLE-ONLY control that puts a small PNG on the clipboard, so the
 * native chrome proof can drive the composer's REPEATED image paste (PR #216,
 * TestFlight 753: "I still can't paste more than one image").
 *
 * **Why an in-app hook.** The simulator's pasteboard cannot be given an image
 * from the host: `xcrun simctl pbcopy` is text-only and `simctl addmedia` adds
 * to Photos, not the clipboard. Writing the image from inside the app also
 * keeps iOS's "Allow Paste" prompt out of the run, since a pasteboard item the
 * app wrote itself reads without one. Tapped by
 * `e2e/maestro/chrome-proof/session-paste.yaml`; the paste itself then runs
 * through the composer's real chip (`composer-paste-image`) and attach path.
 *
 * **Off unless the bundle was built for a proof**: the same inlined
 * `EXPO_PUBLIC_CONNECT_PHASE_NODE === "1"` gate as `ConnectPhaseNode`, which
 * only the unsigned/ad-hoc simulator build in `.github/workflows/ios.yml` sets.
 *
 * It sits at the left edge a third of the way down — above the software
 * keyboard on every proof phone, so a tap with the keyboard up lands on it —
 * and is nearly transparent rather than `opacity: 0`, because UIKit drops a
 * fully transparent view from the accessibility tree Maestro reads.
 */
export function ClipboardSeedNode() {
	if (
		process.env.EXPO_PUBLIC_CONNECT_PHASE_NODE !== "1" ||
		Platform.OS === "web"
	)
		return null;
	return (
		<Pressable
			testID={CONTROL.diagnosticSeedClipboardImage}
			accessibilityLabel="diagnostic: seed clipboard image"
			onPress={() => {
				void import("expo-clipboard")
					.then((Clipboard) => Clipboard.setImageAsync(SEED_PNG))
					.catch(() => undefined);
			}}
			style={{
				position: "absolute",
				left: 0,
				top: "33%",
				width: 44,
				height: 44,
				opacity: 0.02,
			}}
		/>
	);
}

/** An 8×8 opaque PNG (one colour), base64 without a MIME prefix, as
 *  `setImageAsync` takes it. Small enough that the attach path needs no resize. */
const SEED_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO44KCAFTEMLQkA3ntMAZQ6QMoAAAAASUVORK5CYII=";
