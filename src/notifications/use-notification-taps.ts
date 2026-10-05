/**
 * The tap router, mounted once above the router (like the deep-link resolver
 * beside it): a notification the reader taps becomes a pending destination, and
 * the resolver takes it from there — the same path a link takes, with the same
 * rank and the same once-only consumption (ADR 0006 §6.2-6.6).
 *
 * This is the wiring #35 left explicit ("the real trigger waits on S7, the code
 * path does not"): the router is live from this build on, so the day S7's first
 * push lands, the tap already has a route. Renders nothing.
 */

import { useEffect } from "react";

import { noteConversationPush } from "@/features/deep-links/pending";
import {
	ensureAndroidAlertChannel,
	subscribeNotificationTaps,
} from "@/notifications/native";

export const useNotificationTapRouting = (): void => {
	useEffect(() => {
		let cancelled = false;
		let unsubscribe: (() => void) | null = null;
		/* The Android channel is created at first run, before any delivery could
		 * name it (ADR 0006 §5's FCM requirement). Failure is silent by design —
		 * see `ensureAndroidAlertChannel`. */
		void ensureAndroidAlertChannel();
		void (async () => {
			const teardown = await subscribeNotificationTaps(noteConversationPush);
			if (cancelled) {
				teardown();
			} else {
				unsubscribe = teardown;
			}
		})();
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, []);
};
