import { Platform } from "react-native";

/**
 * Which platform a user-facing sentence may name a Settings path for.
 *
 * It lives in `lib/` because two screens read it — the own-tunnel setup screen
 * and the saved-tunnel editor under Settings — and a second copy of this ladder
 * is how the two would end up sending a reader to different menus. `web` is a
 * real answer, not a fallback: a browser tab has no OS local-network permission
 * to grant, so copy for it must not name a phone menu.
 */
export type SentencePlatform = "ios" | "android" | "web";

/** Narrow `Platform.OS` (a string) to the platforms a sentence can address. */
export const sentencePlatform = (): SentencePlatform => {
	if (Platform.OS === "ios") return "ios";
	if (Platform.OS === "android") return "android";
	return "web";
};
