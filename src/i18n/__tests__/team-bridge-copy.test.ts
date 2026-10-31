import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGUES, renderFor, SHIPPED_LOCALES } from "@/i18n";

/* Parameters belong to whole messages: neither an English unread suffix nor a
 * wire enum may be concatenated into a translated label. Real rendered frames
 * and independent linguistic audit still own line breaking and idiomatic copy. */
describe("Team Bridge copy", () => {
	it.each(SHIPPED_LOCALES)("covers the entire namespace in %s", (locale) => {
		const keys = Object.keys(CATALOGUES[locale]).filter((k) =>
			k.startsWith("mobile.team_bridge."),
		);
		expect(keys).toHaveLength(86);
		for (const key of keys)
			expect(
				CATALOGUES[locale][key as keyof (typeof CATALOGUES)[typeof locale]],
			).toBeTruthy();
	});
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
			expect(
				renderFor(
					"mobile.team_bridge.thread.placeholder",
					{ title: "Aida" },
					locale,
				),
			).toContain("Aida");
		},
	);
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
					"thread.placeholder",
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
