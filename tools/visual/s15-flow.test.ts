import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTROL, SCREEN } from "../../src/ui/a11y.ts";
import { FOOTER_DESTINATIONS } from "./s15-flow.ts";

const scrollAssignment = /scrollTop\s*=(?!=)/;
const source = readFileSync(new URL("./s15-flow.ts", import.meta.url), "utf8");

describe("bounded S15 interaction contract", () => {
	it("pairs all four app destinations with their actual return controls", () => {
		expect(FOOTER_DESTINATIONS).toEqual([
			{
				control: CONTROL.sidebarPast,
				root: SCREEN.past,
				back: CONTROL.pastBack,
			},
			{
				control: CONTROL.sidebarComputers,
				root: SCREEN.computers,
				back: CONTROL.computersBack,
			},
			{
				control: CONTROL.sidebarProjects,
				root: SCREEN.projects,
				back: CONTROL.projectsBack,
			},
			{
				control: CONTROL.sidebarSchedules,
				root: SCREEN.schedules,
				back: CONTROL.schedulesBack,
			},
		]);
	});
	it("uses wheel and trusted input rather than scroll or navigation warps", () => {
		expect(source).toContain('type: "mouseWheel"');
		expect(source).toContain('type: "mousePressed"');
		expect(source).not.toMatch(scrollAssignment);
		expect(source).not.toContain("history.back");
		expect(source).not.toContain("location.assign");
		expect(source).toContain("await press(row, 1200)");
		expect(source).toContain('verdict: "FAIL"');
	});
});
