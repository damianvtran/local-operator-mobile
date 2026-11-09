import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PROJECT_STATUS_ORDER } from "@/contracts";
import { type CatalogueKey, renderFor } from "@/i18n";

/* Exercise the catalog and its call sites together: a translated key that the
 * sheet never reads leaves accessible labels and placeholders in English. */
describe("project creation copy", () => {
	it("renders the source labels and every status", () => {
		const messages: Record<string, string> = {
			"mobile.projects.create.title": "New project",
			"mobile.projects.create.submit": "Create",
			"mobile.projects.create.name": "Name",
			"mobile.projects.create.name_placeholder": "my-project",
			"mobile.projects.create.description": "Description",
			"mobile.projects.create.description_placeholder":
				"What this project is for",
			"mobile.projects.create.status": "Status",
			"mobile.projects.create.tags": "Tags",
			"mobile.projects.create.tags_placeholder": "ios, q4",
			"mobile.projects.create.tags_help": "Separate with commas or spaces.",
			"mobile.projects.status.planning": "planning",
			"mobile.projects.status.active": "active",
			"mobile.projects.status.qa": "qa",
			"mobile.projects.status.validation": "validation",
			"mobile.projects.status.paused": "paused",
			"mobile.projects.status.done": "done",
			"mobile.projects.status.archived": "archived",
		};
		for (const [key, value] of Object.entries(messages)) {
			expect(renderFor(key as CatalogueKey, {}, "en")).toBe(value);
		}
	});

	it("uses catalogued copy for sheet props and status chips", () => {
		const source = readFileSync(
			new URL("../project-create.tsx", import.meta.url),
			"utf8",
		);
		for (const prop of ["title", "label", "placeholder"]) {
			expect(source).not.toMatch(
				new RegExp(
					`${prop}="(?:New project|Create|Name|my-project|Description|What this project is for|Tags|ios, q4)"`,
				),
			);
		}
		for (const key of [
			"title",
			"submit",
			"name",
			"name_placeholder",
			"description",
			"description_placeholder",
			"status",
			"tags",
			"tags_placeholder",
			"tags_help",
		]) {
			expect(source).toContain(`t("mobile.projects.create.${key}")`);
		}
		const mappingsMatch = (text: string) =>
			PROJECT_STATUS_ORDER.every((status) =>
				text.includes(`${status}: "mobile.projects.status.${status}"`),
			);
		expect(mappingsMatch(source)).toBe(true);
		/* A swapped code-to-label mapping must fail even if both keys remain. */
		const swapped = source
			.replace(
				'planning: "mobile.projects.status.planning"',
				'planning: "mobile.projects.status.active"',
			)
			.replace(
				'active: "mobile.projects.status.active"',
				'active: "mobile.projects.status.planning"',
			);
		expect(mappingsMatch(swapped)).toBe(false);
		expect(source).toContain(
			'labelTypography={activeLocale() === "ur" ? "prose" : "mono"}',
		);
		expect(source).toContain("label={t(STATUS_LABEL_KEYS[option])}");
		expect(source).toContain("testID={projectCreateStatusId(option)}");
		expect(source).toContain("setStatus(option)");
		expect(source).toContain("status,");
	});
});
