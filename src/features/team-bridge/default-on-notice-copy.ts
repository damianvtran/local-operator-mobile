import { ENGLISH_CONTEXT, ENGLISH_MESSAGES, t } from "@/i18n";

/** Keep the existing feature key contract while rendering through the app's
 * locale runtime. Served consent is deliberately excluded: its versioned text
 * must remain verbatim, not be replaced by a client-side translation. */
const NOTICE_KEYS = [
	"mobile.team_bridge.default_on.title",
	"mobile.team_bridge.default_on.body",
	"mobile.team_bridge.default_on.turn_off",
	"mobile.team_bridge.default_on.read_more",
	"mobile.team_bridge.default_on.hide",
	"mobile.team_bridge.default_on.dismiss",
	"mobile.team_bridge.default_on.dismiss_label",
	"mobile.team_bridge.default_on.dismiss_hint",
	"mobile.team_bridge.default_on.turn_off_error",
] as const;
export type DefaultOnNoticeCopyKey = (typeof NOTICE_KEYS)[number];
/** Metadata is derived from the catalogue, never a parallel English fallback. */
export const DEFAULT_ON_NOTICE_COPY = Object.fromEntries(
	NOTICE_KEYS.map((key) => [
		key,
		{
			source: ENGLISH_MESSAGES[key],
			context: ENGLISH_CONTEXT[key].note,
		},
	]),
);
export function defaultOnNoticeCopy(key: DefaultOnNoticeCopyKey): string {
	return t(key);
}
