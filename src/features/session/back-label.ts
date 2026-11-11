import { t } from "@/i18n";

/**
 * Accessibility label of the back button on the video and agent-job screens.
 *
 * Why a helper and a second key: the old label spliced `fallback_name`
 * ("session") into "Back to {name}", which forces every locale to make one
 * noun phrase read right both as a user's own title and as a bare noun. An
 * unnamed parent now gets its own whole phrase (`back_to_session`), so a
 * translator can adapt article/case. English is byte-identical either way.
 *
 * An empty-string name counts as unnamed (the projection can carry "" before a
 * title is generated); `??` alone would have rendered "Back to ".
 */
export function backToParentLabel(
	conversationName: string | null | undefined,
	render: typeof t = t,
): string {
	return conversationName !== undefined &&
		conversationName !== null &&
		conversationName !== ""
		? render("mobile.session.back_to", { name: conversationName })
		: render("mobile.session.back_to_session");
}
