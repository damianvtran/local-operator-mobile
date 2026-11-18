import type { SubagentStatus } from "@/contracts";
import { t } from "@/i18n";
import type { SemanticTone } from "@/ui/variants";

/**
 * The subagent detail screen's status badge: a word AND a tone, because colour
 * alone would be an audit failure (`U-03`).
 *
 * Pure and Node-loadable so a test reads the decision without rendering.
 *
 * `missing` is the screen's "the fetch settled with nothing" flag. Before it, a
 * `null` detail fell back to `loading` whatever the fetch had said, so a child
 * the computer no longer had read "This subagent is no longer available." under
 * a `loading` badge (visual audit D6, 2026-10-11). The badge states the same fact
 * as the body (P-9): `loading` only while the request is in flight, `unavailable`
 * once it has answered with nothing. A loaded detail always wins, so a stale flag
 * from an earlier child cannot hide a live status.
 */
export const subagentBadge = (
	detail: { status: SubagentStatus } | null,
	missing: boolean,
): { label: string; tone: SemanticTone } => {
	const status = detail?.status ?? (missing ? "unavailable" : "loading");
	return {
		label: t("mobile.session.subagent.status", { status }),
		tone:
			status === "failed"
				? "danger"
				: status === "completed"
					? "success"
					: status === "running" || status === "queued"
						? "info"
						: "neutral",
	};
};
