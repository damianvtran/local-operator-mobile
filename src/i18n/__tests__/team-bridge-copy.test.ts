import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGUES, renderFor, SHIPPED_LOCALES } from "@/i18n";

/* Parameters belong to whole messages: neither an English unread suffix nor a
 * wire enum may be concatenated into a translated label. Real rendered frames
 * and independent linguistic audit still own line breaking and idiomatic copy. */
describe("Team Bridge copy", () => {
	// Keep the added surface explicit: cardinality alone cannot catch a renamed or
	// substituted key, and every shipped locale must own this same message set.
	it.each(SHIPPED_LOCALES)(
		"owns the attachment key contract in %s",
		(locale) => {
			expect(
				Object.keys(CATALOGUES[locale])
					.filter((key) => key.startsWith("mobile.team_bridge.attachment."))
					.sort(),
			).toEqual([
				"mobile.team_bridge.attachment.add",
				"mobile.team_bridge.attachment.attached_summary",
				"mobile.team_bridge.attachment.cannot_send",
				"mobile.team_bridge.attachment.chip_label",
				"mobile.team_bridge.attachment.close",
				"mobile.team_bridge.attachment.conversation_gone",
				"mobile.team_bridge.attachment.expired",
				"mobile.team_bridge.attachment.expired_unsent",
				"mobile.team_bridge.attachment.failed",
				"mobile.team_bridge.attachment.image",
				"mobile.team_bridge.attachment.image_position",
				"mobile.team_bridge.attachment.library",
				"mobile.team_bridge.attachment.limit",
				"mobile.team_bridge.attachment.load_error",
				"mobile.team_bridge.attachment.loading_label",
				"mobile.team_bridge.attachment.next",
				"mobile.team_bridge.attachment.open_hint",
				"mobile.team_bridge.attachment.paste",
				"mobile.team_bridge.attachment.paste_empty",
				"mobile.team_bridge.attachment.position",
				"mobile.team_bridge.attachment.prepare_error",
				"mobile.team_bridge.attachment.preparing",
				"mobile.team_bridge.attachment.previous",
				"mobile.team_bridge.attachment.quota",
				"mobile.team_bridge.attachment.rate_error",
				"mobile.team_bridge.attachment.read_error",
				"mobile.team_bridge.attachment.ready",
				"mobile.team_bridge.attachment.refused",
				"mobile.team_bridge.attachment.remove_blocked",
				"mobile.team_bridge.attachment.remove_image",
				"mobile.team_bridge.attachment.retry",
				"mobile.team_bridge.attachment.retry_blocked",
				"mobile.team_bridge.attachment.retry_image",
				"mobile.team_bridge.attachment.retry_summary",
				"mobile.team_bridge.attachment.unavailable",
				"mobile.team_bridge.attachment.unsendable_summary",
				"mobile.team_bridge.attachment.unsupported_content",
				"mobile.team_bridge.attachment.upload_error",
				"mobile.team_bridge.attachment.uploading",
				"mobile.team_bridge.attachment.uploading_summary",
				"mobile.team_bridge.attachment.viewer",
				"mobile.team_bridge.attachment.wait_uploads",
			]);
		},
	);
	it.each(SHIPPED_LOCALES)(
		"owns the default_on key contract in %s",
		(locale) => {
			expect(
				Object.keys(CATALOGUES[locale])
					.filter((key) => key.startsWith("mobile.team_bridge.default_on."))
					.sort(),
			).toEqual([
				"mobile.team_bridge.default_on.body",
				"mobile.team_bridge.default_on.dismiss",
				"mobile.team_bridge.default_on.dismiss_hint",
				"mobile.team_bridge.default_on.dismiss_label",
				"mobile.team_bridge.default_on.hide",
				"mobile.team_bridge.default_on.read_more",
				"mobile.team_bridge.default_on.title",
				"mobile.team_bridge.default_on.turn_off",
				"mobile.team_bridge.default_on.turn_off_error",
			]);
		},
	);

	it.each(SHIPPED_LOCALES)("covers the entire namespace in %s", (locale) => {
		const keys = Object.keys(CATALOGUES[locale]).filter((k) =>
			k.startsWith("mobile.team_bridge."),
		);
		// Exact merged attachment + consent + established key union; +2:
		// `thread.jump_newest` and `thread.anchor_missing` (feat/bridge-last-target's
		// anchored open).
		expect(keys).toHaveLength(159);
		expect(keys.sort()).toEqual(
			Object.keys(CATALOGUES.en)
				.filter((key) => key.startsWith("mobile.team_bridge."))
				.sort(),
		);
		for (const key of keys)
			expect(
				CATALOGUES[locale][key as keyof (typeof CATALOGUES)[typeof locale]],
			).toBeTruthy();
	});
	// HTTP codes are protocol identifiers, not quantities or untranslated wire
	// enums. Exercise the newly keyed refusal alongside the strict count above
	// so adding a message cannot leave this namespace guard on its old cardinality.
	it.each(SHIPPED_LOCALES)(
		"formats the fallback HTTP status without leaking placeholders in %s",
		(locale) => {
			const refusal = renderFor(
				"mobile.team_bridge.error.http_status",
				{ status: 503 },
				locale,
			);
			expect(refusal).toContain("Radient");
			expect(refusal).toContain("HTTP 503");
			expect(refusal).not.toContain("{");
			expect(refusal).not.toContain("undefined");
			expect(refusal).not.toContain("plural");
		},
	);
	it.each(SHIPPED_LOCALES)(
		"renders unread counts, names and protocol selects in %s",
		(locale) => {
			for (const count of [0, 1, 2, 5, 21]) {
				const nav = renderFor(
					"mobile.team_bridge.navigation.entry",
					{ count },
					locale,
				);
				expect(nav).toContain("Team Bridge");
				expect(nav).not.toMatch(/\{count|plural|undefined/);
				const label = renderFor(
					"mobile.team_bridge.list.organization_label",
					{ name: "Atlas", count, readOnly: "yes" },
					locale,
				);
				expect(label).toContain("Atlas");
				expect(label).not.toMatch(/\{name|select|undefined/);
			}
			for (const mode of ["all", "mention", "mute"]) {
				const status = renderFor(
					"mobile.team_bridge.thread.notify_current",
					{ mode },
					locale,
				);
				expect(status).not.toMatch(/\{|undefined/);
				expect(status.length).toBeGreaterThan(3);
			}
		},
	);
	/* I1/I2: source-semantic regressions, not proof the longer Urdu labels fit.
	 * Whole-message ICU variants retain their placeholders and exact-zero case. */
	it("uses the agreed Vietnamese software-agent term", () => {
		const text = renderFor(
			"mobile.team_bridge.gate.plan_description",
			{},
			"vi",
		);
		expect(text.match(/tác nhân/g)).toHaveLength(2);
		expect(text).not.toContain("tác tử");
	});
	it("makes every Urdu unread label explicitly about messages", () => {
		for (const count of [1, 2]) {
			const expected =
				count === 1 ? "نا پڑھا گیا پیغام" : "نا پڑھے گئے پیغامات";
			expect(renderFor("mobile.team_bridge.unread", { count }, "ur")).toContain(
				expected,
			);
			expect(
				renderFor("mobile.team_bridge.navigation.entry", { count }, "ur"),
			).toContain(expected);
			expect(
				renderFor(
					"mobile.team_bridge.list.organization_label",
					{ name: "Atlas", readOnly: "yes", count },
					"ur",
				),
			).toContain(expected);
		}
		expect(
			renderFor("mobile.team_bridge.navigation.entry", { count: 0 }, "ur"),
		).toBe("Team Bridge");
		expect(
			renderFor(
				"mobile.team_bridge.list.organization_label",
				{ name: "Atlas", readOnly: "no", count: 0 },
				"ur",
			),
		).toBe("Atlas");
	});
	it("distinguishes singular, few and many unread messages in Russian", () => {
		expect(renderFor("mobile.team_bridge.unread", { count: 1 }, "ru")).toBe(
			"1 непрочитанное",
		);
		expect(renderFor("mobile.team_bridge.unread", { count: 2 }, "ru")).toBe(
			"2 непрочитанных",
		);
		expect(renderFor("mobile.team_bridge.unread", { count: 5 }, "ru")).toBe(
			"5 непрочитанных",
		);
	});
	it("keeps zero-count navigation unadorned and omits zero unread organization suffix", () => {
		expect(
			renderFor("mobile.team_bridge.navigation.entry", { count: 0 }, "en"),
		).toBe("Team Bridge");
		expect(
			renderFor(
				"mobile.team_bridge.list.organization_label",
				{ name: "Atlas", readOnly: "no", count: 0 },
				"en",
			),
		).toBe("Atlas");
	});
	it("wires scanner-blind row, composer and preference copy through the runtime", () => {
		for (const [file, keys] of [
			["navigation", ["navigation.entry", "navigation.caption"]],
			[
				"list-screen",
				[
					"list.organization_label",
					"list.organization_selected",
					"unread",
					"list.person_unavailable",
				],
			],
			[
				"thread-screen",
				[
					// The composer's placeholder is the field's label since TestFlight
					// 773 (the title names the channel; a one-line placeholder must
					// not wrap), so the label key is what the composer must wire.
					"thread.message",
					"thread.notify_current",
					"thread.archived",
					"thread.readonly",
					"thread.send_error",
				],
			],
		] as const) {
			const source = readFileSync(
				new URL(`../../features/team-bridge/${file}.tsx`, import.meta.url),
				"utf8",
			);
			for (const key of keys)
				expect(source).toMatch(
					new RegExp(
						`t\\(\\s*"mobile\\.team_bridge\\.${key.replaceAll(".", "\\.")}"`,
					),
				);
		}
	});
});
