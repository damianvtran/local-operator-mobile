import { describe, expect, it } from "vitest";

import {
	groupProjectsByStatus,
	PROJECT_STATUS_ORDER,
	type ProjectSummary,
} from "../index";

/**
 * The board order, and the rule at its edge.
 *
 * Two things are asserted here and they pull in opposite directions, which is
 * why both are in one file: a KNOWN status must land in the relay's own rank
 * order (never a client sort), and an UNKNOWN status must land in a trailing
 * section rather than vanish. A test that only checked the first would pass with
 * `filter` + `find`, which drops the second.
 */

/** A row carrying only what the grouping reads. */
const row = (name: string, status: string): ProjectSummary =>
	({
		id: name,
		name,
		status,
	}) as ProjectSummary;

describe("the projects board order", () => {
	it("is the relay's own seven statuses, in the relay's rank order", () => {
		/* This list is a mirror of `STATUS_RANK` in local-operator's
		 * `server/models/desktop_projects.py`; the assertion is that the mirror has
		 * not lost an entry, which is exactly how the web client's copy drifted. */
		expect([...PROJECT_STATUS_ORDER]).toEqual([
			"planning",
			"active",
			"qa",
			"validation",
			"paused",
			"done",
			"archived",
		]);
	});

	it("puts sections in rank order, not in the order rows arrived", () => {
		const sections = groupProjectsByStatus([
			row("a-archived", "archived"),
			row("b-active", "active"),
			row("c-planning", "planning"),
		]);
		expect(sections.map((section) => section.status)).toEqual([
			"planning",
			"active",
			"archived",
		]);
	});

	it("keeps the relay's own row order inside one section", () => {
		/* The relay sorts a section by `-updated_at`; bucketing must not re-sort, or
		 *  the client's answer would present a different order than the one the relay
		 *  chose (the rule `endpoints.models` records for the model catalogue). */
		const sections = groupProjectsByStatus([
			row("newest", "active"),
			row("middle", "active"),
			row("oldest", "active"),
		]);
		expect(sections).toHaveLength(1);
		expect(sections[0]?.rows.map((r) => r.name)).toEqual([
			"newest",
			"middle",
			"oldest",
		]);
	});

	it("gives a status this build does not know its own trailing section", () => {
		const sections = groupProjectsByStatus([
			row("known", "active"),
			row("unknown", "escalated"),
		]);
		expect(sections.map((section) => section.status)).toEqual([
			"active",
			"escalated",
		]);
		expect(sections[1]?.known).toBe(false);
		/* The row is there, and it is in the section that names ITS status — not
		 *  folded into a known one and not dropped. */
		expect(sections[1]?.rows.map((r) => r.name)).toEqual(["unknown"]);
	});

	it("orders several unknown statuses alphabetically, after every known one", () => {
		const sections = groupProjectsByStatus([
			row("z", "zebra"),
			row("d", "done"),
			row("a", "aardvark"),
		]);
		expect(sections.map((section) => section.status)).toEqual([
			"done",
			"aardvark",
			"zebra",
		]);
	});

	it("draws no section for a status with no rows", () => {
		/* `archived` is the case this exists for: the relay's board only draws it
		 *  when it is non-empty, so a client that emitted every known status would
		 *  put six empty headings above one row. */
		const sections = groupProjectsByStatus([row("only", "active")]);
		expect(sections.map((section) => section.status)).toEqual(["active"]);
	});

	it("has nothing to draw for an empty listing", () => {
		expect(groupProjectsByStatus([])).toEqual([]);
	});
});
