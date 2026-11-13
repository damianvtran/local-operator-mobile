import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sansTextWidthDp } from "@/ui/components/list-row-meta";
import {
	DRAWER_PILL_ROW_CLASS,
	DRAWER_PILL_ROW_PADDING_PT,
	drawerPillFit,
	STATUS_LABEL_STYLE,
	STATUS_PILL_CHROME_PT,
	STATUS_PILL_SLOT_STYLE,
	STATUS_ROW_GAP_PT,
	statusPillFit,
	statusRowClass,
	statusRowStacked,
} from "@/ui/components/status-pill-layout";
import { sidebarWidthFor } from "@/ui/size-class";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { TOUCH_TARGET } from "@/ui/tokens.gen";

/**
 * The connection pill in a ROW (Sherman's iPhone, relayed by Aida: "Not
 * answering" ran past the right edge in Settings › Connection › Status and in the
 * Agents drawer header). Node has no layout engine, so — as in
 * `list-row-layout.test.ts` — the rule is pinned as values over the catalogue's
 * real strings, and the components are checked to use it.
 *
 * Widths come from `sansTextWidthDp`, the shipped Figtree's measured advances
 * with a conservative 0.7 em for every glyph outside ASCII, so a non-Latin line
 * is over- rather than under-counted.
 */
const SRC = join(process.cwd(), "src");
const flat = (path: string) =>
	readFileSync(join(SRC, path), "utf8").replace(/\s+/g, " ");

const LOCALES = ["en", "es", "fr", "hi", "ru", "ur", "vi", "zh-CN"] as const;
const settingsCopy = (locale: string): Record<string, string> =>
	JSON.parse(
		readFileSync(
			join(SRC, "i18n/catalogues", locale, "mobile.settings.json"),
			"utf8",
		),
	);

/** iPhone SE width, the narrowest phone the app is laid out for. */
const VIEWPORT = 320;
/** The Settings column: the viewport less `Screen`'s `px-4` both sides. */
const SETTINGS_ROW = VIEWPORT - 32;
/** The drawer at 320 pt (iOS touch floor), less the pill line's `px-4`. */
const DRAWER_ROW =
	sidebarWidthFor(VIEWPORT, TOUCH_TARGET.ios) - DRAWER_PILL_ROW_PADDING_PT;
/** `text-body-sm` (the row label) is 14 pt; `sansTextWidthDp` measures `meta`
 *  (12 pt), so the label is measured at the proportional scale. */
const labelWidth = (text: string, scale: number) =>
	sansTextWidthDp(text, (scale * 14) / 12);

const statusRow = (locale: string, scale: number) => {
	const copy = settingsCopy(locale);
	const label = copy["mobile.settings.connection.status"] ?? "";
	const word = copy["mobile.settings.status.not_answering"] ?? "";
	return {
		label,
		word,
		fit: statusPillFit({
			rowPt: SETTINGS_ROW,
			labelPt: labelWidth(label, scale),
			textPt: sansTextWidthDp(word, scale),
			stacked: statusRowStacked(scale),
		}),
	};
};

describe("Settings › Status: the pill stays inside a 320 pt row", () => {
	it("never overflows the row, in any locale, at any scale up to 200 %", () => {
		for (const locale of LOCALES) {
			for (const scale of [1, 1.2, LARGE_TEXT_SCALE, 1.6, 2]) {
				const { fit } = statusRow(locale, scale);
				expect(fit.usedPt, `${locale} @ ${scale}`).toBeLessThanOrEqual(
					SETTINGS_ROW,
				);
				expect(fit.pillPt).toBeGreaterThanOrEqual(0);
			}
		}
	});
	it("at 320 pt / 200 % stacks, and the long locales keep the WHOLE word", () => {
		expect(statusRowStacked(2)).toBe(true);
		for (const locale of LOCALES) {
			const { fit } = statusRow(locale, 2);
			expect(fit.truncated, locale).toBe(false);
			expect(fit.labelIntact, locale).toBe(true);
		}
		/* The cases that overflowed side by side: ru's label alone is 176 pt and its
		 *  pill 206 pt at 200 %, 394 pt in a 288 pt row. */
		const ru = statusRow("ru", 2);
		expect(
			labelWidth(ru.label, 2) +
				STATUS_ROW_GAP_PT +
				sansTextWidthDp(ru.word, 2) +
				STATUS_PILL_CHROME_PT,
		).toBeGreaterThan(SETTINGS_ROW);
	});
	it("at 100 % stays inline and shows every locale's word whole", () => {
		expect(statusRowStacked(1)).toBe(false);
		for (const locale of LOCALES) {
			const { fit } = statusRow(locale, 1);
			expect(fit.truncated, locale).toBe(false);
		}
	});
	it("inline, the label keeps its word: every label fits half the row at LARGE_TEXT_SCALE", () => {
		/* The label does not shrink (a one-word label that shrinks breaks
		 *  mid-word). That is only safe while inline labels are short, so pin it. */
		for (const locale of LOCALES) {
			const label =
				settingsCopy(locale)["mobile.settings.connection.status"] ?? "";
			expect(labelWidth(label, LARGE_TEXT_SCALE), locale).toBeLessThanOrEqual(
				SETTINGS_ROW / 2,
			);
		}
	});
	it("truncates the pill, not the row, for a sentence longer than the row", () => {
		const fit = statusPillFit({
			rowPt: SETTINGS_ROW,
			labelPt: labelWidth("Status", 1),
			textPt: sansTextWidthDp(
				"Offline. Messages will send when you're back. ".repeat(3),
				1,
			),
			stacked: false,
		});
		expect(fit.truncated).toBe(true);
		expect(fit.usedPt).toBeCloseTo(SETTINGS_ROW);
	});
	it("the row, label and slot carry exactly the constraints the model assumes", () => {
		expect(statusRowClass(false)).toContain("min-w-0");
		expect(statusRowClass(false)).toContain("flex-row");
		expect(statusRowClass(false)).toContain("gap-3"); // STATUS_ROW_GAP_PT
		expect(STATUS_ROW_GAP_PT).toBe(12);
		expect(statusRowClass(true)).toContain("min-w-0");
		expect(statusRowClass(true)).not.toContain("flex-row");
		expect(STATUS_PILL_SLOT_STYLE).toEqual({
			flexShrink: 1,
			minWidth: 0,
			maxWidth: "100%",
		});
		expect(STATUS_LABEL_STYLE).toEqual({ flexShrink: 0 });
		const settings = flat("features/settings/settings.tsx");
		expect(settings).toContain(
			"const statusStacked = statusRowStacked(textScale.effectiveScale);",
		);
		expect(settings).toContain("className={statusRowClass(statusStacked)}");
		expect(settings).toContain("style={STATUS_LABEL_STYLE}");
		expect(settings).toContain(
			"<View style={STATUS_PILL_SLOT_STYLE}> <ConnectionPill state={status.state} message={status.message} singleLine />",
		);
	});
});

describe("Agents drawer header: the pill stays inside the pane", () => {
	it("is capped at its line at 320 pt / 200 %, whole when the word fits", () => {
		expect(DRAWER_ROW).toBe(244);
		const word = drawerPillFit({
			rowPt: DRAWER_ROW,
			textPt: sansTextWidthDp("Not answering", 2),
		});
		expect(word.truncated).toBe(false);
		for (const locale of LOCALES) {
			const text =
				settingsCopy(locale)["mobile.settings.status.not_answering"] ?? "";
			const fit = drawerPillFit({
				rowPt: DRAWER_ROW,
				textPt: sansTextWidthDp(text, 2),
			});
			expect(fit.pillPt, locale).toBeLessThanOrEqual(DRAWER_ROW);
		}
		const sentence = drawerPillFit({
			rowPt: DRAWER_ROW,
			textPt: sansTextWidthDp("Last updated 12 min ago.", 2),
		});
		expect(sentence.pillPt).toBe(DRAWER_ROW);
		expect(sentence.truncated).toBe(true);
	});
	it("the pane wraps the pill in a min-w-0 line and asks for one line", () => {
		expect(DRAWER_PILL_ROW_CLASS).toContain("min-w-0");
		expect(DRAWER_PILL_ROW_CLASS).toContain("px-4"); // DRAWER_PILL_ROW_PADDING_PT
		const pane = flat("features/sessions/conversations-pane.tsx");
		expect(pane).toContain(
			"<View className={DRAWER_PILL_ROW_CLASS}> <ConnectionPill state={pillState(streamHealth, stale)} message={staleNote({ stale, lastFrameAt }) ?? undefined} singleLine />",
		);
	});
});

describe("ConnectionPill singleLine: one tail-truncated line, whole accessible name", () => {
	it("caps the line, ellipsises the tail and keeps the full text as the label", () => {
		const pill = flat("ui/components/connection-pill.tsx");
		expect(pill).toContain("accessibilityLabel={text}");
		expect(pill).toContain("numberOfLines={singleLine ? 1 : undefined}");
		expect(pill).toContain('ellipsizeMode={singleLine ? "tail" : undefined}');
		expect(pill).toContain("style={{ flexShrink: 1, minWidth: 0 }}");
		expect(pill).toContain('style={{ maxWidth: "100%", minWidth: 0 }}');
	});
});
