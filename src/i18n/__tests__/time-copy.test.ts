import { describe, expect, it } from "vitest";

import { renderFor } from "@/i18n";

/**
 * O3-a keyed the date/time copy WITHOUT changing a character of the English the
 * user sees. Each expectation is the exact string the old inline template
 * produced (`${minutes} min ago`, `${hours}h`, …), for a count of one and of
 * many, so a catalogue edit that drifts from the shipped English — or an ICU arm
 * that drops `#` — fails here. Two spacing registers shipped (`5 min ago` /
 * `3 h ago` on computer rows and Past; `5m ago` / `3h ago` in the inbox and the
 * stale note) and both are kept, as separate keys, on purpose.
 */
const en = (key: Parameters<typeof renderFor>[0], params = {}) =>
	renderFor(key, params, "en");

describe("mobile.time renders the English it replaced", () => {
	it("day buckets", () => {
		expect(en("mobile.time.bucket.today")).toBe("Today");
		expect(en("mobile.time.bucket.yesterday")).toBe("Yesterday");
		expect(en("mobile.time.bucket.earlier_this_week")).toBe(
			"Earlier this week",
		);
		expect(en("mobile.time.bucket.earlier")).toBe("Earlier");
	});

	it("relative ages, both spacing registers", () => {
		expect(en("mobile.time.relative.now")).toBe("now");
		expect(en("mobile.time.relative.just_now")).toBe("just now");
		expect(en("mobile.time.relative.yesterday")).toBe("yesterday");
		for (const count of [1, 5]) {
			expect(en("mobile.time.relative.minutes_ago", { count })).toBe(
				`${count} min ago`,
			);
			expect(en("mobile.time.relative.hours_ago", { count })).toBe(
				`${count} h ago`,
			);
			expect(en("mobile.time.relative.days_ago", { count })).toBe(
				`${count} d ago`,
			);
			expect(en("mobile.time.relative.seconds_ago_compact", { count })).toBe(
				`${count}s ago`,
			);
			expect(en("mobile.time.relative.minutes_ago_compact", { count })).toBe(
				`${count}m ago`,
			);
			expect(en("mobile.time.relative.hours_ago_compact", { count })).toBe(
				`${count}h ago`,
			);
			expect(en("mobile.time.relative.days_ago_compact", { count })).toBe(
				`${count}d ago`,
			);
		}
	});

	it("short duration units", () => {
		for (const count of [1, 12]) {
			expect(en("mobile.time.short.seconds", { count })).toBe(`${count}s`);
			expect(en("mobile.time.short.minutes", { count })).toBe(`${count}m`);
			expect(en("mobile.time.short.hours", { count })).toBe(`${count}h`);
			expect(en("mobile.time.short.days", { count })).toBe(`${count}d`);
			expect(en("mobile.time.short.weeks", { count })).toBe(`${count}w`);
			expect(en("mobile.time.short.years", { count })).toBe(`${count}y`);
			expect(en("mobile.time.short.minutes_spaced", { count })).toBe(
				`${count} min`,
			);
		}
		expect(
			en("mobile.time.short.minutes_seconds", { minutes: 1, seconds: "07" }),
		).toBe("1m 07s");
		expect(
			en("mobile.time.short.hours_minutes", { hours: 2, minutes: "07" }),
		).toBe("2h 07m");
	});

	it("section headers keep their shipped casing", () => {
		expect(en("mobile.notifications.section.waiting_count", { count: 3 })).toBe(
			"Waiting on you · 3",
		);
		expect(
			en("mobile.schedules.section.wakes_summary", { summary: "2 scheduled" }),
		).toBe("Wakes · 2 scheduled");
		expect(en("mobile.projects.section.linked_sessions")).toBe(
			"linked sessions",
		);
		expect(en("mobile.session.sheet_title.attach")).toBe("attach");
	});

	it("conversation sheet titles share one Title-case idiom (visual audit D7)", () => {
		/* The slash sheet's title was the last lower-case one beside `Model` and
		 *  `Effort`; the attach title is left to the attach-sheet rework (#278),
		 *  which moves it to its own key. */
		expect(en("mobile.session.sheet_title.model")).toBe("Model");
		expect(en("mobile.session.sheet_title.effort")).toBe("Effort");
		expect(en("mobile.session.sheet_title.commands")).toBe("Commands");
	});
});
