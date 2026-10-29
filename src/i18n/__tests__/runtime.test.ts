import { afterEach, describe, expect, it } from "vitest";

import {
	activeDirection,
	activeLocale,
	catalogueLocaleFor,
	directionFor,
	normalizeLocaleTag,
	preferredLocale,
	renderFor,
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
		/* `ur` and `es` are languages this build RECOGNIZES (direction knows Urdu;
		 * both are in `SUPPORTED_LOCALES`) but does not ship. The two questions must
		 * not collapse into one — and `fr`, which shipped with its own catalogue,
		 * answers with a catalogue rather than with English source. */
		expect(catalogueLocaleFor("ur")).toBeNull();
		expect(catalogueLocaleFor("es")).toBeNull();
		expect(catalogueLocaleFor("fr")).toBe("fr");
		expect(catalogueLocaleFor("fr-FR")).toBe("fr");
		expect(catalogueLocaleFor("en-US")).toBe("en");
		expect(SHIPPED_LOCALES).toEqual(["en", "fr"]);
	});
});

describe("the English floor", () => {
	it("renders English source for a preference with no shipped catalogue", () => {
		/* `es` is supported and pending, not shipped: the reader gets the English
		 * sentence, not a key and not an empty string. */
		setLocaleSource(() => "es");
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
		/* The same rule for a pending locale with no catalogue at all: English
		 * plural categories, because the TEXT is English. */
		setLocaleSource(() => "es");
		expect(t("mobile.schedules.count.wakes", { count: 21 })).toBe("21 wakes");
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

describe("a shipped translation", () => {
	it("renders the French catalogue for a French preference", () => {
		setLocaleSource(() => "fr");
		expect(activeLocale()).toBe("fr");
		/* The French catalogue's own line, U+202F before the question mark
		 * included — the typography is part of the translation, not a nicety
		 * applied later. */
		expect(t("mobile.home.greeting")).toBe(
			"Comment puis-je vous aider aujourd’hui\u202f?",
		);
		expect(t("mobile.schedules.count.wakes", { count: 2 })).toBe("2 réveils");
		/* A `fr-FR` relay tag resolves to the same catalogue as `fr`. */
		setLocaleSource(() => "fr-FR");
		expect(activeLocale()).toBe("fr");
	});

	it("formats a French plural with FRENCH categories", () => {
		setLocaleSource(() => "fr");
		/* The categories the French style guide fixes: `one` covers 0 and 1, `many`
		 * is the exact-multiple-of-10^6 case, `other` is everything else. English has
		 * no `many` arm, so a message formatted with English rules would render the
		 * `other` text for a million — this asserts the SOURCE locale is used, not
		 * the reader's. `#` renders through `String(n)` (see `messages.ts`), so the
		 * million has no grouping separator. */
		expect(t("mobile.schedules.count.wakes", { count: 0 })).toBe("0 réveil");
		expect(t("mobile.schedules.count.wakes", { count: 1 })).toBe("1 réveil");
		expect(t("mobile.schedules.count.wakes", { count: 2 })).toBe("2 réveils");
		expect(t("mobile.schedules.count.wakes", { count: 1_000_000 })).toBe(
			"1000000 de réveils",
		);
		/* A message with no plural still comes from the French catalogue. */
		expect(t("mobile.schedules.state.waiting")).toBe("en attente");
	});

	it("agrees each count with the number its French sentence is about", () => {
		setLocaleSource(() => "fr");
		/* TWO SENTENCES, ONE RULE. French noun agreement follows the number the
		 * sentence STARTS with, not the total after "sur": « 1 jalon sur 3 », not
		 * « 1 jalons sur 3 ». Both of these shipped ungrammatical at 1 and 0 —
		 * milestones.count had no plural machinery at all, and truncated pluralized
		 * nothing while printing the bare noun — so each now pluralizes the count it
		 * actually agrees with, with French `one`/`many`/`other` (0 and 1 are `one`
		 * in French CLDR, 10^6 is `many`). Every parameter survives the change. */
		expect(
			t("mobile.projects.milestones.count", { completed: 0, total: 3 }),
		).toBe("0 jalon sur 3");
		expect(
			t("mobile.projects.milestones.count", { completed: 1, total: 3 }),
		).toBe("1 jalon sur 3");
		expect(
			t("mobile.projects.milestones.count", { completed: 2, total: 3 }),
		).toBe("2 jalons sur 3");
		expect(
			t("mobile.projects.milestones.count", {
				completed: 1_000_000,
				total: 3,
			}),
		).toBe("1000000 de jalons sur 3");
		expect(
			t("mobile.schedules.truncated", {
				shown: 1,
				total: 3,
				family: "wakes",
			}),
		).toBe("Affichage de 1 conversation sur 3 avec des réveils.");
		expect(
			t("mobile.schedules.truncated", {
				shown: 2,
				total: 3,
				family: "monitors",
			}),
		).toBe("Affichage de 2 conversations sur 3 avec des surveillances.");
	});

	it("leaves the English source byte-identical for the same keys", () => {
		/* The per-locale work must not touch English. Compared through `renderFor`
		 *  with a null preference, so the assertion cannot drift with the active
		 *  locale of whatever test ran before it. */
		expect(
			renderFor(
				"mobile.projects.milestones.count",
				{ completed: 1, total: 3 },
				null,
			),
		).toBe("1 of 3 milestones");
		expect(
			renderFor(
				"mobile.projects.milestones.count",
				{ completed: 2, total: 3 },
				null,
			),
		).toBe("2 of 3 milestones");
		expect(
			renderFor(
				"mobile.schedules.truncated",
				{ shown: 1, total: 3, family: "wakes" },
				null,
			),
		).toBe("Showing 1 of 3 conversations with wakes.");
		expect(
			renderFor("mobile.schedules.count.monitors", { count: 2 }, null),
		).toBe("2 monitors");
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
		expect(directionFor("fr")).toBe("ltr");
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
