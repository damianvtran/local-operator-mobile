import { describe, expect, it } from "vitest";

import type { LinkedSession, ProjectSummary } from "@/contracts";
import {
	linkedSessionLabel,
	linkedSessionState,
	milestoneCountLabel,
	projectDisplayName,
	projectRefusalSentence,
	projectRowMeta,
	projectStatusTone,
	sessionCountLabel,
	showsStaleMark,
} from "@/features/projects/projects-copy";
import { RelayError } from "@/relay";

const summary = (over: Partial<ProjectSummary>): ProjectSummary =>
	({
		id: "p1",
		name: "payments-migration",
		title: null,
		status: "active",
		milestones_completed: 0,
		milestones_total: 0,
		sessions: 0,
		live_sessions: 0,
		progress_stale: false,
		...over,
	}) as ProjectSummary;

const link = (over: Partial<LinkedSession>): LinkedSession =>
	({
		session_id: "aa11bb22cc33",
		role: "work",
		exists: true,
		title: null,
		archived: false,
		runtime: null,
		subagents: null,
		todos: null,
		...over,
	}) as LinkedSession;

describe("project copy", () => {
	it("names a project by its title, falling back to the addressing name", () => {
		expect(
			projectDisplayName({ title: null, name: "payments-migration" }),
		).toBe("payments-migration");
		expect(
			projectDisplayName({ title: "Payments migration", name: "payments" }),
		).toBe("Payments migration");
		/* An empty title is not a name: the relay allows `""` and a screen that
		 *  rendered it would show a blank row. */
		expect(projectDisplayName({ title: "  ", name: "payments" })).toBe(
			"payments",
		);
	});

	it("states the milestone counts the relay sent, including none", () => {
		expect(milestoneCountLabel(2, 3)).toBe("2 of 3 milestones");
		expect(milestoneCountLabel(0, 0)).toBe("no milestones");
		/* Never re-counted from the array: a listing row carries no milestone array
		 *  at all, only these two numbers. */
		expect(milestoneCountLabel(3, 3)).toBe("3 of 3 milestones");
	});

	it("states the live count only when there is one", () => {
		expect(sessionCountLabel(2, 1)).toBe("2 sessions · 1 live");
		expect(sessionCountLabel(2, 0)).toBe("2 sessions");
		expect(sessionCountLabel(1, 0)).toBe("1 session");
		/* A zero live count is not a claim worth making: the relay scanned and found
		 *  none, which is the same thing an absent chip says. */
		expect(sessionCountLabel(0, 0)).toBe("0 sessions");
	});

	it("joins the row's meta from the relay's numbers alone", () => {
		expect(
			projectRowMeta(
				summary({
					milestones_completed: 1,
					milestones_total: 3,
					sessions: 2,
					live_sessions: 1,
				}),
			),
		).toBe("1 of 3 milestones · 2 sessions · 1 live");
	});

	it("tones a known status, and does not colour an unknown one as a problem", () => {
		expect(projectStatusTone("active")).toBe("info");
		expect(projectStatusTone("paused")).toBe("warning");
		expect(projectStatusTone("archived")).toBe("neutral");
		expect(projectStatusTone("escalated")).toBe("neutral");
	});

	it("marks a stale verdict only where a progress line exists to be stale", () => {
		/* The relay's `progress_is_stale` answers `true` for a record that has never
		 *  had a progress line (`docs-sweep` in the captured fixture), which is the
		 *  honest reading of "nothing reported" — marking that row stale would tell the
		 *  reader a report exists and has gone old. */
		expect(
			showsStaleMark({ progress_stale: true, progress_updated_at: null }),
		).toBe(false);
		expect(
			showsStaleMark({
				progress_stale: true,
				progress_updated_at: 1_791_209_087,
			}),
		).toBe(true);
		expect(
			showsStaleMark({
				progress_stale: false,
				progress_updated_at: 1_791_209_087,
			}),
		).toBe(false);
	});

	it("names a linked session by its title, falling back to the id", () => {
		expect(
			linkedSessionLabel(link({ title: "Payments cutover — ledger" })),
		).toBe("Payments cutover — ledger");
		/* A link with no title is the state the fixture seeds: the row must fall back
		 *  to the id rather than rendering blank. */
		expect(linkedSessionLabel(link({ title: null }))).toBe("aa11bb22cc33");
		expect(linkedSessionLabel(link({ title: "  " }))).toBe("aa11bb22cc33");
	});

	it("reads a link's state without painting a filing as a stopped worker", () => {
		expect(linkedSessionState(link({ runtime: { state: "live" } }))).toBe(
			"live",
		);
		/* `stopped` is the ordinary state of a finished session, not an error. */
		expect(linkedSessionState(link({ runtime: { state: "stopped" } }))).toBe(
			"not running",
		);
		expect(linkedSessionState(link({ exists: false }))).toBe("missing");
		/* A COORDINATION row carries no runtime by construction, and `null` here is
		 *  what stops a renderer gating liveness chrome on one. */
		expect(linkedSessionState(link({ role: "coordination" }))).toBe("filed by");
		expect(linkedSessionState(link({ runtime: null }))).toBeNull();
	});
});

describe("the refusal sentence", () => {
	it("shows the daemon's own sentence verbatim", () => {
		const error = new RelayError(
			"rejected",
			"no project with id or name 'paymnts' — closest: payments-migration",
			{ status: 404, code: "project_not_found" },
		);
		expect(projectRefusalSentence(error)).toBe(
			"no project with id or name 'paymnts' — closest: payments-migration",
		);
	});

	it("leaves a connection failure to the connection's own surface", () => {
		/* A transport failure's message is the RUNTIME's own words, and the
		 *  connection taxonomy already names that cause — a second line here would
		 *  give one failure two voices. */
		const error = new RelayError("transport", "Network request failed");
		expect(projectRefusalSentence(error)).toBeNull();
	});

	it("has nothing to say about a non-relay error", () => {
		expect(projectRefusalSentence(new TypeError("Failed to fetch"))).toBeNull();
		expect(projectRefusalSentence(undefined)).toBeNull();
	});
});
