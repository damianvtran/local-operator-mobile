import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTROL, SCREEN } from "../../src/ui/a11y.ts";
import { seedQuery } from "../lib/readiness.ts";
import { DEFAULT_PASSWORD } from "../mock-relay/relay.ts";
import {
	FOOTER_DESTINATIONS,
	s15FlowQuery,
	scrollBoundarySettled,
} from "./s15-flow.ts";

const scrollAssignment = /scrollTop\s*=(?!=)/;
const source = readFileSync(new URL("./s15-flow.ts", import.meta.url), "utf8");

describe("bounded S15 interaction contract", () => {
	it("rejects the measured stale maximum when virtual rows grow from eight to twelve", () => {
		const oldTail = {
			top: 1176,
			client: 265,
			height: 1441,
			listTop: 104,
			listBottom: 369,
			footerTop: 313,
			footerBottom: 361,
			footerHit: true,
			footerInsideList: true,
			viewportHeight: 390,
		};
		const expanded = {
			...oldTail,
			height: 1996,
			footerTop: 860,
			footerBottom: 908,
			footerHit: false,
		};
		expect(scrollBoundarySettled(expanded, oldTail, true)).toBe(false);
		expect(scrollBoundarySettled(expanded, expanded, true)).toBe(false);
		const realTail = { ...oldTail, height: 1996, top: 1731 };
		expect(scrollBoundarySettled(realTail, expanded, true)).toBe(false);
		expect(scrollBoundarySettled(realTail, realTail, true)).toBe(true);
	});
	it("keeps pinned portrait navigation outside the list clip but fully hit-testable", () => {
		const portrait = {
			top: 794,
			client: 414,
			height: 1208,
			listTop: 163,
			listBottom: 577,
			footerTop: 762,
			footerBottom: 810,
			footerHit: true,
			footerInsideList: false,
			viewportHeight: 844,
		};
		expect(scrollBoundarySettled(portrait, portrait, true)).toBe(true);
		expect(
			scrollBoundarySettled({ ...portrait, footerHit: false }, portrait, true),
		).toBe(false);
		expect(
			scrollBoundarySettled(
				{ ...portrait, footerInsideList: true },
				portrait,
				true,
			),
		).toBe(false);
	});
	it("carries every canonical seed parameter including explicit HTTP opt-in", () => {
		const origin = "http://127.0.0.1:12345";
		const query = s15FlowQuery(origin, "dark", "iphone-15-landscape");
		for (const [key, value] of new URLSearchParams(
			seedQuery(origin, DEFAULT_PASSWORD),
		)) {
			expect(query.get(key)).toBe(value);
		}
		expect(query.get("lo-relay-insecure")).toBe("1");
		expect(query.get("lo-inset-left")).toBe("59");
		expect(query.get("lo-text-scale")).toBe("2");
	});
	it("pairs every footer ROUTE with their actual return controls", () => {
		expect(FOOTER_DESTINATIONS).toEqual([
			{
				control: CONTROL.sidebarPast,
				root: SCREEN.past,
				back: CONTROL.pastBack,
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
