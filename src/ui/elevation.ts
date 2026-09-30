import { useTheme } from "@/ui/appearance";
import {
	parseCssShadow,
	type ResolvedShadow,
	type ShadowToken,
} from "@/ui/shadow";
import { ELEVATIONS } from "@/ui/tokens.gen";

/**
 * The shadow hooks. The parsing lives in `shadow.ts`, which is pure; this module
 * is the part that needs a theme and therefore React.
 */

/** Resolve a shadow token for the active theme. */
export const useShadow = (
	name: keyof typeof ELEVATIONS,
): ResolvedShadow | null => {
	const { theme } = useTheme();
	const token = ELEVATIONS[name] as ShadowToken;
	return parseCssShadow(token[theme], token.androidElevation);
};
