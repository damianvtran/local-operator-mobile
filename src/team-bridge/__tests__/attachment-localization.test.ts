import { afterEach, describe, expect, it } from "vitest";
import {
	chipStateLabel,
	sendBlockedReason,
	stripSummary,
} from "@/features/team-bridge/attachment-draft";
import {
	CATALOGUES,
	renderFor,
	resetLocaleSource,
	SHIPPED_LOCALES,
	setLocaleSource,
} from "@/i18n";

afterEach(resetLocaleSource);
describe("attachment copy uses the current catalogue", () => {
	it.each(SHIPPED_LOCALES)(
		"localizes states, accessible status and plurals in %s",
		(locale) => {
			setLocaleSource(() => locale);
			expect(chipStateLabel({ status: "preparing", retryable: true })).toBe(
				CATALOGUES[locale]["mobile.team_bridge.attachment.preparing"],
			);
			expect(chipStateLabel({ status: "failed", retryable: false })).toBe(
				CATALOGUES[locale]["mobile.team_bridge.attachment.cannot_send"],
			);
			expect(
				sendBlockedReason([{ status: "uploading", retryable: true }]),
			).toBe(CATALOGUES[locale]["mobile.team_bridge.attachment.wait_uploads"]);
			for (const count of [1, 2]) {
				expect(
					stripSummary(
						Array.from({ length: count }, () => ({
							status: "ready" as const,
							retryable: true,
							error: null,
						})),
					),
				).toBe(
					renderFor(
						"mobile.team_bridge.attachment.attached_summary",
						{ count },
						locale,
					),
				);
				expect(
					stripSummary(
						Array.from({ length: count }, () => ({
							status: "failed" as const,
							retryable: true,
							error: null,
						})),
					),
				).toBe(
					renderFor(
						"mobile.team_bridge.attachment.retry_summary",
						{ count },
						locale,
					),
				);
			}
		},
	);
});
