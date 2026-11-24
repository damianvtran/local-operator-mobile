import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { screenReaderSignalUsable } from "@/ui/screen-reader-signal";

/**
 * Whether VoiceOver or TalkBack is running, live.
 *
 * The composer's scroll compaction is off while one is (a dock that changes
 * shape under a swipe-through is a moving target for the screen reader's focus).
 * `false` until the platform answers: a reader with the service on gets the full
 * card for that first frame, which is the safe shape, never the pill.
 */
export function useScreenReaderEnabled(): boolean {
	const [enabled, setEnabled] = useState(false);
	useEffect(() => {
		if (!screenReaderSignalUsable(Platform.OS)) return;
		let live = true;
		AccessibilityInfo.isScreenReaderEnabled()
			.then((value) => {
				if (live) setEnabled(value);
			})
			.catch(() => {});
		const subscription = AccessibilityInfo.addEventListener(
			"screenReaderChanged",
			setEnabled,
		);
		return () => {
			live = false;
			subscription.remove();
		};
	}, []);
	return enabled;
}
