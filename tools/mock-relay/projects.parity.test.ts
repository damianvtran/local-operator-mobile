/**
 * The store against the corpus: the reads it answers must be the captured bytes.
 *
 * `projects.ts` seeds itself from the fixtures and then mutates, and the whole
 * read path's S16 frames were captured against those fixture bytes. A store that
 * seeded itself even slightly differently — a recomputed milestone count, a
 * `created_at` the wire SUMMARY does not carry, a field dropped from the view —
 * would silently re-shoot every one of those frames and no capture would say so:
 * the frames would simply be of a different listing, and the identical-frame
 * check would compare them with each other rather than with the capture.
 *
 * So the two READ answers are compared with the corpus BYTE FOR BYTE, here, where
 * a diff names the field. Everything below that is a write is checked for the
 * sentences the real relay was measured to write (`divergences.ts` exercises the
 * same routes over a real socket; this file is the fast, field-naming half).
 */

import { describe, expect, it } from "vitest";

import type { Json } from "../lib/json.ts";
import { loadFixtures } from "./fixtures.ts";
import { createProjectsStore, isProjectsRefusal } from "./projects.ts";

const store = () => createProjectsStore(loadFixtures());

/** A refusal's body, or a failure that names what came back instead. */
const refusalOf = (outcome: unknown): { status: number; json: unknown } => {
	if (!isProjectsRefusal(outcome)) {
		throw new Error(`expected a refusal, got ${JSON.stringify(outcome)}`);
	}
	return outcome.refuse;
};

/** A success's body, or a failure that names what came back instead. */
const answerOf = (outcome: unknown): { status: number; json: Json } => {
	if (isProjectsRefusal(outcome)) {
		throw new Error(
			`expected an answer, got ${JSON.stringify(outcome.refuse)}`,
		);
	}
	const answer = (outcome as { answer?: { status?: unknown; json?: unknown } })
		.answer;
	if (answer === undefined) {
		throw new Error(`expected an answer, got ${JSON.stringify(outcome)}`);
	}
	return { status: Number(answer.status), json: answer.json as Json };
};

describe("the mock's project store against the captured reads", () => {
	it("answers the listing byte-for-byte as the corpus captured it", () => {
		const fix = loadFixtures();
		expect(JSON.stringify(store().list())).toBe(
			JSON.stringify(fix.body("projects-list")),
		);
	});

	it("answers the detail byte-for-byte as the corpus captured it", () => {
		const fix = loadFixtures();
		expect(
			JSON.stringify(answerOf(store().detail("payments-migration")).json),
		).toBe(JSON.stringify(fix.body("projects-detail")));
	});

	it("resolves a key by exact id as well as by name", () => {
		const fix = loadFixtures();
		const captured = fix.body("projects-detail") as {
			project?: { id?: unknown };
		};
		const id = String(captured.project?.id ?? "");
		expect(id).not.toBe("");
		expect(JSON.stringify(answerOf(store().detail(id)).json)).toBe(
			JSON.stringify(captured),
		);
	});

	it("answers the captured 404 for a key it does not hold", () => {
		const notFound = refusalOf(store().detail("no-such-project"));
		expect(notFound.status).toBe(404);
		expect(notFound.json).toEqual({
			error: "no project with id or name 'no-such-project'",
			code: "project_not_found",
		});
	});
});

describe("the mock's project store on the writes the relay was measured to take", () => {
	it("creates a row with the store's own defaults and shows it in the listing", () => {
		const projects = store();
		const created = answerOf(
			projects.create({ name: "parity-probe", status: "active", tags: ["a"] }),
		);
		expect(created.status).toBe(200);
		const body = created.json as {
			ok?: unknown;
			project?: Record<string, unknown>;
		};
		expect(body.ok).toBe(true);
		expect(body.project?.name).toBe("parity-probe");
		/* `status` defaults to `active` and the description to `""` — the relay's
		 *  own default arms (measured: a create carrying only a name answers a row
		 *  with `status: "active"`, `description: ""`, `tags: []`). */
		expect(body.project?.description).toBe("");
		expect(body.project?.tags).toEqual(["a"]);
		expect(
			(
				projects.list() as { projects: Array<{ name?: unknown }> }
			).projects.some((row) => row.name === "parity-probe"),
		).toBe(true);
	});

	it("refuses a taken name case-insensitively, in the relay's words", () => {
		const projects = store();
		answerOf(projects.create({ name: "parity-probe" }));
		const taken = refusalOf(projects.create({ name: "PARITY-PROBE" }));
		expect(taken.status).toBe(409);
		expect(taken.json).toEqual({
			error: "project 'PARITY-PROBE' already exists",
			code: "project_name_exists",
		});
	});

	it("refuses the name grammar the store enforces, and an unknown key", () => {
		const projects = store();
		const blank = refusalOf(projects.create({ name: "   " }));
		expect(blank.status).toBe(422);
		expect(blank.json).toEqual({
			error: "name is required",
			code: "project_invalid",
		});
		const slashed = refusalOf(projects.create({ name: "slash/name" }));
		expect(slashed.json).toEqual({
			error:
				"project name must be 1-64 characters of letters, digits, dot, underscore or hyphen, and cannot start with a hyphen",
			code: "project_invalid",
		});
		const unknown = refusalOf(projects.create({ name: "ok", nope: 1 }));
		expect(unknown.json).toEqual({
			error: "unknown field(s): nope",
			code: "project_invalid",
		});
		const notObject = refusalOf(projects.create([1, 2, 3]));
		expect(notObject.status).toBe(400);
		expect(notObject.json).toEqual({ error: "request body must be an object" });
	});

	it("add-or-updates a milestone by name, and derives its status", () => {
		const projects = store();
		const added = answerOf(
			projects.setMilestone("payments-migration", {
				name: "release cut",
				target_date: "2099-01-01",
			}),
		);
		const milestones = (
			added.json as {
				project?: { milestones?: Array<{ name?: string; status?: string }> };
			}
		).project?.milestones;
		expect(milestones?.some((row) => row.name === "release cut")).toBe(true);
		expect(milestones?.find((row) => row.name === "release cut")?.status).toBe(
			"upcoming",
		);
		/* Completing it is the same call with `completed: true` — the toggle. */
		const completed = answerOf(
			projects.setMilestone("payments-migration", {
				name: "release cut",
				completed: true,
			}),
		);
		expect(
			(
				completed.json as {
					project?: { milestones?: Array<{ name?: string; status?: string }> };
				}
			).project?.milestones?.find((row) => row.name === "release cut")?.status,
		).toBe("completed");
	});

	it("clears a milestone's date with the empty string, and refuses a bad one", () => {
		const projects = store();
		projects.setMilestone("payments-migration", {
			name: "release cut",
			target_date: "2099-01-01",
		});
		const cleared = answerOf(
			projects.setMilestone("payments-migration", {
				name: "release cut",
				target_date: "",
			}),
		);
		expect(
			(
				cleared.json as {
					project?: {
						milestones?: Array<{ name?: string; target_date?: unknown }>;
					};
				}
			).project?.milestones?.find((row) => row.name === "release cut")
				?.target_date,
		).toBeNull();
		const bad = refusalOf(
			projects.setMilestone("payments-migration", {
				name: "release cut",
				target_date: "not-a-date",
			}),
		);
		expect(bad.json).toEqual({
			error: "milestone target_date must be an ISO YYYY-MM-DD date",
			code: "project_invalid",
		});
	});

	it("refuses removing a milestone the project does not hold", () => {
		const refused = refusalOf(
			store().removeMilestone("payments-migration", "never added"),
		);
		expect(refused.status).toBe(422);
		expect(refused.json).toEqual({
			error: "no milestone named 'never added'",
			code: "project_invalid",
		});
	});

	it("deletes only on the row's own name, and reads the outcome back", () => {
		const projects = store();
		answerOf(projects.create({ name: "parity-probe" }));
		const mismatch = refusalOf(
			projects.remove("parity-probe", { confirm: "something else" }),
		);
		expect(mismatch.status).toBe(422);
		expect(mismatch.json).toEqual({
			error:
				"confirm must repeat the project name 'parity-probe' exactly (the name, not the id)",
			code: "project_confirm_mismatch",
		});
		/* An id is not the name either — the relay's sentence says so. */
		const byId = refusalOf(projects.remove("parity-probe", { confirm: "p1" }));
		expect(byId.status).toBe(422);
		const noBody = refusalOf(projects.remove("parity-probe", undefined));
		expect(noBody.status).toBe(400);
		const deleted = answerOf(
			projects.remove("parity-probe", { confirm: "parity-probe" }),
		);
		expect(deleted.json).toEqual({ ok: true, deleted: true });
		expect(
			refusalOf(projects.remove("parity-probe", { confirm: "parity-probe" }))
				.status,
		).toBe(404);
	});

	it("starts every scenario from the corpus, so a write cannot leak", () => {
		const projects = store();
		answerOf(projects.create({ name: "leaky-probe" }));
		projects.reset();
		expect(
			(
				projects.list() as { projects: Array<{ name?: unknown }> }
			).projects.some((row) => row.name === "leaky-probe"),
		).toBe(false);
	});
});
