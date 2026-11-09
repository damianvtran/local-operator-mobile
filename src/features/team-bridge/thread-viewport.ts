/** Thread-owned positioning authority. Layout scrolls during admission are not
 * reader intent: native FlatList may emit them before the first content size.
 * Keep this separate from following so future explicit-target admission can
 * replace initial-tail ownership without changing the transcript or anchors.
 */
export function createThreadViewport(
	scrollToEnd: () => void,
	positioned: () => void,
) {
	let initial = true;
	let following = true;
	let height = 0;
	let content: number | null = null;
	let ready = false;
	let requested = false;
	let readerGesture = false;
	const finish = () => {
		initial = false;
		positioned();
	};
	const position = () => {
		if (!ready || height <= 0 || content === null) return;
		if (initial && content <= height) finish();
		else if (initial || following) {
			requested = true;
			scrollToEnd();
		}
	};
	return {
		// Drag/wheel/key intent, not layout-induced scroll events, relinquishes
		// following. Virtualized row measurement can otherwise strand the tail.
		userScroll() {
			if (!initial) {
				readerGesture = true;
				following = false;
			}
		},
		get pending() {
			return initial;
		},
		layout(viewportHeight: number) {
			height = viewportHeight;
			// Keyboard/header resize must not pull a history reader to the tail.
			position();
		},
		content(contentHeight: number, dataReady: boolean) {
			content = contentHeight;
			ready = dataReady;
			position();
		},
		scroll(y: number, viewportHeight: number, contentHeight: number) {
			const atTail = y + viewportHeight >= contentHeight - 44;
			if (initial) {
				// A request alone is not proof the native list moved. Only the
				// resulting tail geometry (or measured short content) admits it.
				if (
					requested &&
					Math.ceil(y + viewportHeight) >= Math.ceil(contentHeight)
				)
					finish();
				return;
			}
			if (readerGesture) {
				following = atTail;
				if (atTail) readerGesture = false;
			}
		},
	};
}
