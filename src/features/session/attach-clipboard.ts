import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

import {
	pasteOfferVisible,
	probeClipboardImage,
} from "@/features/session/attach-rule";

/**
 * The composer's "an image is on the clipboard" offer, as a hook.
 *
 * The rule is `pasteOfferVisible` (`attach-rule.ts`, where a test can drive it);
 * this file owns only what a pure module cannot: the probe's lifecycle.
 *
 * WHEN IT PROBES, and why only then:
 * - on focus — the reader is composing, which is when a paste is useful;
 * - when the app comes back to the foreground while focused — the usual way an
 *   image reaches the clipboard is a screenshot or a Copy in ANOTHER app, and
 *   iOS posts no in-app clipboard notification for that;
 * - on an in-app clipboard change (`addClipboardListener`).
 * It never polls: a timer reading the pasteboard while the reader types is the
 * pattern iOS 14+ flags with its "pasted from" banner, and `hasImageAsync` is
 * the one read that does not trip it (`hasImages`, no content access).
 *
 * The bytes are NOT read here. Pressing the chip goes through the composer's
 * own `onAttach("paste", "offer")` — the same read as the attach sheet's Paste
 * row — so the iOS 16+ paste prompt, its denial copy (`pasteNothingLine`), the read-failure
 * copy and the attachment strip are one implementation, not two.
 */
export const useClipboardImageOffer = (
	focused: boolean,
): { visible: boolean; consume: () => void } => {
	const kind = Platform.OS === "web" ? "web" : "native";
	const [hasImage, setHasImage] = useState(false);
	const [consumed, setConsumed] = useState(false);

	useEffect(() => {
		if (kind === "web" || !focused) {
			setHasImage(false);
			return;
		}
		/* A fresh focus is a fresh offer: the reader may have pasted this image,
		 * removed the attachment, and want it again. */
		setConsumed(false);
		let live = true;
		const probe = () => {
			void probeClipboardImage(Clipboard).then((has) => {
				if (live) setHasImage(has);
			});
		};
		probe();
		const appState = AppState.addEventListener("change", (next) => {
			if (next !== "active") return;
			setConsumed(false);
			probe();
		});
		const clipboard = Clipboard.addClipboardListener((event) => {
			if (!live) return;
			setConsumed(false);
			setHasImage(event.contentTypes.includes(Clipboard.ContentType.IMAGE));
		});
		return () => {
			live = false;
			appState.remove();
			clipboard.remove();
		};
	}, [focused, kind]);

	const consume = useCallback(() => setConsumed(true), []);
	return {
		visible: pasteOfferVisible({ kind, focused, hasImage, consumed }),
		consume,
	};
};
