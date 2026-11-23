import {
	AccessibilityInfo,
	findNodeHandle,
	Platform,
	type View,
} from "react-native";

const SKIP_FOCUS = /^(INPUT|TEXTAREA|BODY)$/;

/** Keep a getter, never a native handle: virtualized rows can unmount while the
 * emoji keyboard is open. Restoring focus to a TextInput would reopen that
 * keyboard, so only the originating message/control is eligible. On web the
 * sheet already knows its launch element; save it BEFORE it takes focus. */
export function captureReactionFocus(origin?: () => View | null): () => void {
	const webOrigin = Platform.OS === "web" ? document.activeElement : null;
	return () => {
		const node = origin?.();
		if (Platform.OS === "web") {
			const target = (origin ? node : webOrigin) as HTMLElement | null;
			if (
				!target?.isConnected ||
				SKIP_FOCUS.test(target.tagName) ||
				target.isContentEditable
			)
				return;
			target.focus({ preventScroll: true });
			return;
		}
		if (!node) return;
		const handle = findNodeHandle(node);
		if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
	};
}
