import { describe, expect, it } from "vitest";
import {
	type StatusTrayFacts,
	statusTrayHasFacts,
	statusTraySummary,
} from "./status-tray";

const facts = (over: Partial<StatusTrayFacts> = {}): StatusTrayFacts => ({
	working: null,
	tasks: null,
	agents: null,
	context: null,
	...over,
});

/** The row compresses four panels into one line, so what it DROPS is the defect:
 *  a count that vanishes when another appears is how a reader loses a task list
 *  behind a gesture they had no reason to make. */
describe("session status row", () => {
	it("summarises every available panel in reading order", () => {
		expect(
			statusTraySummary(
				facts({
					working: "Editing",
					tasks: { open: 2, total: 5 },
					agents: { running: 1, total: 3 },
					context: "40% ctx",
				}),
			),
		).toBe("Editing · 2/5 tasks · 1/3 agents · 40% ctx");
	});

	it("omits what is absent rather than printing empty placeholders", () => {
		expect(facts({ working: "   " })).not.toBeNull();
		expect(statusTraySummary(facts({ working: "   " }))).toBe("");
		expect(statusTrayHasFacts(facts())).toBe(false);
		// A zero OPEN count is a fact (`0 of 3 left`), so the list still shows.
		expect(statusTraySummary(facts({ tasks: { open: 0, total: 3 } }))).toBe(
			"0/3 tasks",
		);
		// An EMPTY task list is not: nothing is hidden behind the tray.
		expect(statusTraySummary(facts({ tasks: { open: 0, total: 0 } }))).toBe("");
	});

	it("keeps the meter last so a changing number cannot reorder the row", () => {
		const text = statusTraySummary(
			facts({
				working: "Running",
				tasks: { open: 1, total: 2 },
				agents: { running: 2, total: 2 },
				context: "7% ctx",
			}),
		);
		expect(text).toBe("Running · 1/2 tasks · 2/2 agents · 7% ctx");
		expect(statusTrayHasFacts(facts({ context: "7% ctx" }))).toBe(true);
	});
});
