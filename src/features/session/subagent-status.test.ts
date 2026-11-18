import { afterEach, describe, expect, it } from "vitest";

import type { SubagentStatus } from "@/contracts";
import { subagentBadge } from "@/features/session/subagent-status";
import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";

/**
 * The subagent detail screen's status badge (`[jobId].tsx`), per state.
 *
 * Visual audit D6 (2026-10-11): a fetch that came back empty painted
 * "This subagent is no longer available." under a badge that still read
 * `loading`, because the badge fell back to `loading` whenever the detail was
 * `null`. The badge and the body must state the same fact (P-9).
 */
describe("subagentBadge", () => {
	it("says unavailable, not loading, once the fetch settled with nothing", () => {
		expect(subagentBadge(null, true)).toEqual({
			label: "unavailable",
			tone: "neutral",
		});
	});

	it("says loading only while the fetch is still in flight", () => {
		expect(subagentBadge(null, false)).toEqual({
			label: "loading",
			tone: "neutral",
		});
	});

	it("names every relay status in words, with its tone", () => {
		const cases: Array<[SubagentStatus, string, string]> = [
			["queued", "queued", "info"],
			["running", "running", "info"],
			["completed", "completed", "success"],
			["failed", "failed", "danger"],
			["parked", "parked", "neutral"],
			["cancelled", "cancelled", "neutral"],
		];
		for (const [status, label, tone] of cases)
			expect(subagentBadge({ status }, false)).toEqual({ label, tone });
	});

	afterEach(() => resetLocaleSource());

	it("reads the word from the reader's catalogue, not the wire's English", () => {
		setLocaleSource(() => "fr");
		expect(subagentBadge(null, true).label).toBe(
			renderFor(
				"mobile.session.subagent.status",
				{ status: "unavailable" },
				"fr",
			),
		);
		expect(subagentBadge({ status: "parked" }, false).label).toBe(
			renderFor("mobile.session.subagent.status", { status: "parked" }, "fr"),
		);
	});

	it("lets a loaded detail win over a stale missing flag", () => {
		expect(subagentBadge({ status: "running" }, true).label).toBe("running");
	});
});
