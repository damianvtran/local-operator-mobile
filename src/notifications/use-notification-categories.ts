/**
 * Keeps the iOS notification categories (`categories.ts`) registered in the
 * reader's current language: once at mount, and again only when the resolved
 * language changes.
 *
 * WHY KEYED ON THE LANGUAGE FRAME. `t()` resolves at call time, but iOS keeps
 * the strings it was handed, so a language that arrives (or changes) after the
 * first registration would leave the stack summary in the old language until
 * the next launch. `useLocaleFrame()` is the one subscription to the resolved
 * language (`connection-provider.tsx`); its value is the effect's only
 * dependency, so an unrelated re-render never re-registers and a language
 * change re-registers exactly once.
 *
 * Its own hook, not folded into the tap router's mount effect: that effect owns
 * the response/received listeners and runs once; giving it a language
 * dependency would tear down and re-subscribe them on every language change.
 * Registration needs no permission and never prompts, so mounting it at app
 * start is safe before the first-run primer.
 */

import { useEffect } from "react";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import { ensureNotificationCategories } from "@/notifications/categories";
import { ensureAndroidTeamBridgePresentation } from "@/team-bridge/android-presentation";

export const useNotificationCategories = (): void => {
	const language = useLocaleFrame();
	useEffect(() => {
		// `language` is read only as the trigger: the copy is resolved inside
		// `ensureNotificationCategories` at run time.
		void language;
		void ensureNotificationCategories();
		// Android's counterpart (ADR 0010 S4): the Team Bridge channel name and
		// the native delegate's lock-screen/"me" copy, in the same language.
		void ensureAndroidTeamBridgePresentation();
	}, [language]);
};
