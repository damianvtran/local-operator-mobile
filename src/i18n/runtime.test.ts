import { describe, expect, it } from "vitest";

import { createTranslator, formatMessage, resolveMessage } from "./runtime";

describe("mobile catalogue source and formatting locale", () => {
	it("bundles only the six English Home messages", () => {
		const t = createTranslator("en");
		expect(t("mobile.home.greeting")).toBe("What can I help you with today?");
		expect(t("mobile.home.connect")).toBe("Connect a computer");
		expect(createTranslator("ru")("mobile.home.starting")).toBe("Starting…");
	});

	it("uses English source AND plural rules for absent locale/namespace/key", () => {
		const english = { "fixture.jobs": "{count, plural, one {# job} other {# jobs}}" };
		for (const catalogues of [
			{ en: { fixture: english } },
			{ en: { fixture: english }, ru: {} },
			{ en: { fixture: english }, ru: { fixture: {} } },
		]) {
			expect(resolveMessage("ru", "fixture.jobs", catalogues).locale).toBe("en");
			for (const count of [0, 1, 21]) {
				expect(formatMessage("ru", "fixture.jobs", { count }, catalogues)).toBe(`${count} ${count === 1 ? "job" : "jobs"}`);
			}
		}
	});

	it("uses the locale which actually supplied a present message", () => {
		const catalogues = { en: { fixture: { "fixture.n": "{count, number}" } }, fr: { fixture: { "fixture.n": "{count, number}" } } };
		expect(formatMessage("fr", "fixture.n", { count: 1234.5 }, catalogues)).toBe(new Intl.NumberFormat("fr").format(1234.5));
	});

	it("does not activate backend Urdu/Chinese copy or RTL without a carried namespace", () => {
		for (const locale of ["ur", "zh-CN"]) {
			const message = resolveMessage(locale, "mobile.home.greeting");
			expect(message.locale).toBe("en");
			expect(message.direction).toBe("ltr");
			expect(message.source).toBe("What can I help you with today?");
		}
	});

	it("degrades a message absent even in English to its code", () => {
		expect(formatMessage("en", "fixture.missing", {}, {})).toBe("fixture.missing");
	});

	it("does not swallow missing parameters or malformed ICU as success", () => {
		const catalogues = { en: { fixture: { "fixture.jobs": "{count, plural, one {job} other {jobs}}" } } };
		expect(() => formatMessage("en", "fixture.jobs", {}, catalogues)).toThrow();
	});
});
