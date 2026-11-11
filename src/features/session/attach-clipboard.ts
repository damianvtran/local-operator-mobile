import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
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
 * `composing` is the field's focus OR an open card with a draft or an
 * attachment (the composer decides). It used to be focus alone, and that hid
 * the chip after the first paste: the controls row was under the keyboard, so
 * the reader put the keyboard away to reach it, which blurred the field and
 * took the offer with it (TestFlight 753: "I still can't paste more than one
 * image").
 *
 * WHEN IT PROBES, and why only then:
 * - when composing starts — that is when a paste is useful;
 * - when the app comes back to the foreground while composing — the usual way an
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
	composing: boolean,
): { visible: boolean } => {
	const kind = Platform.OS === "web" ? "web" : "native";
	const [hasImage, setHasImage] = useState(false);

	useEffect(() => {
		if (kind === "web" || !composing) {
			setHasImage(false);
			return;
		}
		/* Availability is not consumption: iOS may not notify this mounted field
		 * when another app replaces an image. Keep the door available after a read,
		 * including a denied read, so retry never depends on blur or remount. */
		let live = true;
		const probe = () => {
			void probeClipboardImage(Clipboard).then((has) => {
				if (live) setHasImage(has);
			});
		};
		probe();
		const appState = AppState.addEventListener("change", (next) => {
			if (next !== "active") return;
			probe();
		});
		const clipboard = Clipboard.addClipboardListener((event) => {
			if (!live) return;
			setHasImage(event.contentTypes.includes(Clipboard.ContentType.IMAGE));
		});
		return () => {
			live = false;
			appState.remove();
			clipboard.remove();
		};
	}, [composing, kind]);

	return {
		visible: pasteOfferVisible({
			kind,
			focused: composing,
			hasImage,
			consumed: false,
		}),
	};
};
