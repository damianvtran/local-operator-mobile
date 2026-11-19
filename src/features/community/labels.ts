/**
 * The words the community screens render for protocol values, in one place.
 *
 * WHY HERE AND NOT IN THE CLIENT. `CommunityError` carries a `kind`, never
 * server prose: the server's messages are English, unlocalized and (for a
 * refusal) deliberately terse. Each screen renders a cause from the catalogue
 * instead, and both the composer and the read surfaces call these functions so
 * the same failure is never worded two ways.
 */
import type { CommunityError } from "@/community/client";
import type { CommunityRole, RefusalCategory } from "@/community/contract";
import { type AttemptState, expiryLeft } from "@/community/model";
import { t } from "@/i18n";

/** RFC canon labels ("Unsafe or illegal content", …); only the sender sees them. */
export function categoryLabel(category: RefusalCategory): string {
	switch (category) {
		case "unsafe_or_illegal":
			return t("mobile.community.category.unsafe_or_illegal");
		case "harassment_or_abuse":
			return t("mobile.community.category.harassment_or_abuse");
		case "spam_or_promotion":
			return t("mobile.community.category.spam_or_promotion");
		case "private_information":
			return t("mobile.community.category.private_information");
	}
}

/** Canon badges; a plain member gets none. */
export function roleLabel(role: CommunityRole | undefined): string | null {
	switch (role) {
		case "staff":
			return t("mobile.community.role.staff");
		case "moderator":
			return t("mobile.community.role.moderator");
		case "community_admin":
			return t("mobile.community.role.community_admin");
		default:
			return null;
	}
}

/**
 * A failed read or a non-message action, as one sentence.
 *
 * `mode` picks the catch-all. An ACTION's ("Something went wrong. Nothing was
 * changed.") reassures that a write did not half-happen; on a failed READ that
 * sentence answers a question nobody asked, so a read says what did not load
 * and what to do (design review round 1, D7).
 */
export function errorSentence(
	error: CommunityError | null,
	mode: "action" | "read" = "action",
): string {
	switch (error?.kind) {
		case "sign_in":
			return t("mobile.community.error.sign_in");
		case "auth_unavailable":
			return t("mobile.community.error.auth_unavailable");
		case "not_found":
			return t("mobile.community.error.not_found");
		case "unreachable":
			return t("mobile.community.error.unreachable");
		case "rate_limited":
			return t("mobile.community.error.rate_limited");
		default:
			return mode === "read"
				? t("mobile.community.error.load_failed")
				: t("mobile.community.error.generic");
	}
}

/**
 * The composer's outcome for a settled attempt: a headline and, where the
 * state has one, a second sentence (kept separate rather than concatenated, so
 * each locale owns its own sentence order). `now` drives the limit countdown;
 * the caller re-renders on a timer while one is shown.
 */
export function attemptSentences(
	state: AttemptState,
	now: number,
): { headline: string; detail: string | null } {
	switch (state.kind) {
		case "checking":
			return {
				headline: t("mobile.community.composer.checking"),
				detail: null,
			};
		case "refused":
			return {
				headline: t("mobile.community.composer.refused", {
					category: categoryLabel(state.category),
				}),
				detail: t("mobile.community.composer.refused_detail", {
					reference: state.reference,
				}),
			};
		case "limited": {
			const seconds = Math.ceil((state.retryAt - now) / 1000);
			return {
				headline: t("mobile.community.composer.limited"),
				detail:
					seconds > 0
						? t("mobile.community.composer.limited_wait", { seconds })
						: null,
			};
		}
		case "unavailable":
			return {
				headline: t("mobile.community.composer.unavailable"),
				detail: null,
			};
		case "images_unavailable":
			return {
				headline: t("mobile.community.composer.images_unavailable"),
				detail: null,
			};
		case "guidelines":
			return {
				headline: t("mobile.community.composer.guidelines"),
				detail: null,
			};
		case "forbidden":
			return {
				headline: state.reference
					? t("mobile.community.composer.restricted", {
							reference: state.reference,
						})
					: t("mobile.community.composer.forbidden"),
				detail: null,
			};
		case "failed":
			return { headline: t("mobile.community.composer.failed"), detail: null };
		case "invalid":
			return {
				headline: t("mobile.community.composer.invalid"),
				detail: null,
			};
		case "cancelled":
			return {
				headline: t("mobile.community.composer.cancelled"),
				detail: null,
			};
	}
}

/**
 * "Expires in 7 days" / "expires in 5 h" for a DM request or an approval stub:
 * hours up to 48, whole days beyond (design review round 1, D6).
 */
export function expirySentence(
	kind: "request" | "approval",
	expiresAt: string,
	now: number,
): string {
	const left = expiryLeft(expiresAt, now);
	if (kind === "request")
		return left.unit === "days"
			? t("mobile.community.requests.expires_days", { days: left.count })
			: t("mobile.community.requests.expires", { hours: left.count });
	return left.unit === "days"
		? t("mobile.community.approvals.expires_days", { days: left.count })
		: t("mobile.community.approvals.expires", { hours: left.count });
}
