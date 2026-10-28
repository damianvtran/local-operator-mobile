import { afterEach, describe, expect, it } from "vitest";

import {
	activeDirection,
	activeLocale,
	catalogueLocaleFor,
	directionFor,
	normalizeLocaleTag,
	preferredLocale,
	resetLocaleSource,
	SHIPPED_LOCALES,
	setLocaleSource,
	t,
} from "@/i18n";

/** A rendered value that still looks like a key is a missing translation. */
const KEY_SHAPE = /^mobile\./;

afterEach(() => {
	resetLocaleSource();
});

describe("the locale source", () => {
	it("is English before any config frame, so a cold start renders source", () => {
		expect(preferredLocale()).toBeNull();
		expect(activeLocale()).toBe("en");
		expect(t("mobile.home.greeting")).toBe("What can I help you with today?");
	});

	it("reads the relay's resolved tag through the registered source", () => {
		setLocaleSource(() => "en-GB");
		expect(preferredLocale()).toBe("en-GB");
		expect(activeLocale()).toBe("en");
	});

	it("normalizes the shapes a relay or an alias may send", () => {
		expect(normalizeLocaleTag("en_us")).toBe("en-US");
		expect(normalizeLocaleTag("EN")).toBe("en");
		expect(normalizeLocaleTag(" ur_pk ")).toBe("ur-PK");
		expect(normalizeLocaleTag("zh_hans")).toBe("zh-Hans");
		expect(normalizeLocaleTag("")).toBeNull();
		expect(normalizeLocaleTag("123")).toBeNull();
		expect(normalizeLocaleTag(null)).toBeNull();
		expect(normalizeLocaleTag(undefined)).toBeNull();
	});

	it("keeps recognition separate from shipping", () => {
		/* `ur` is a language this build RECOGNIZES (direction knows it) but does not
		 * ship. The two questions must not collapse into one. */
		expect(catalogueLocaleFor("ur")).toBeNull();
		expect(catalogueLocaleFor("fr")).toBeNull();
		expect(catalogueLocaleFor("en-US")).toBe("en");
		expect(SHIPPED_LOCALES).toEqual(["en"]);
	});
});

describe("the English floor", () => {
	it("renders English source for a preference with no shipped catalogue", () => {
		setLocaleSource(() => "fr");
		expect(activeLocale()).toBe("en");
		expect(t("mobile.home.greeting")).toBe("What can I help you with today?");
		expect(t("mobile.schedules.count.wakes", { count: 2 })).toBe("2 wakes");
	});

	it("formats an English fallback with ENGLISH plural rules", () => {
		/* The discriminating case the programme names: Russian would select `one`
		 * for 21 and render "21 wake". A fallback must read "21 wakes". */
		setLocaleSource(() => "ru");
		expect(t("mobile.schedules.count.wakes", { count: 21 })).toBe("21 wakes");
		expect(t("mobile.projects.sessions.count", { count: 1 })).toBe("1 session");
	});

	it("never renders a key name or an empty string for a real key", () => {
		for (const rendered of [
			t("mobile.home.greeting"),
			t("mobile.projects.stale_badge"),
			t("mobile.schedules.empty.title"),
			t("mobile.account_routing.save"),
		]) {
			expect(rendered).not.toMatch(KEY_SHAPE);
			expect(rendered.trim().length).toBeGreaterThan(0);
		}
	});
});

describe("direction", () => {
	it("is rtl for Urdu in every spelling the relay may send", () => {
		expect(directionFor("ur")).toBe("rtl");
		expect(directionFor("ur-PK")).toBe("rtl");
		expect(directionFor("ur_IN")).toBe("rtl");
		expect(directionFor("UR")).toBe("rtl");
	});

	it("is ltr for every shipped locale and for an absent tag", () => {
		expect(directionFor("en")).toBe("ltr");
		expect(directionFor("en-GB")).toBe("ltr");
		expect(directionFor(null)).toBe("ltr");
		expect(directionFor("")).toBe("ltr");
		/* Recognized but not claimed: Arabic, Hebrew and Persian have no catalogue,
		 * font or layout contract in this build. */
		expect(directionFor("ar")).toBe("ltr");
		expect(directionFor("he")).toBe("ltr");
	});

	it("follows the ACTIVE catalogue, so an unsupported Urdu preference stays ltr", () => {
		/* Urdu is recognized for direction but is not shipped, so the copy is
		 * English and English must not be laid out right-to-left. The resolver
		 * still answers `rtl` for the tag itself — the day `ur` ships, this flips
		 * without a call-site change. */
		expect(activeDirection()).toBe("ltr");
		setLocaleSource(() => "ur");
		expect(directionFor("ur")).toBe("rtl");
		expect(activeDirection()).toBe("ltr");
	});
});
