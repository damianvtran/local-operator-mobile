/**
 * The mock relay's project store — the WRITE half of `/api/projects*`.
 *
 * The read routes replayed a capture and answered nothing else. That is the
 * right shape for a read and the wrong one for a store: `POST` accepts a body the
 * mock cannot predict, and a create that did not change the listing would make
 * every cell after it a lie about the relay's state. So the mock keeps an
 * in-memory store, seeded from the captured corpus and mutated by the same
 * writes the real relay's `mobile/projects.py` performs.
 *
 * WHAT IT MODELS, and why each rule is here rather than approximated: every
 * sentence below was MEASURED against an isolated `lop mobile` at the ref the
 * write fixtures name (`fixtures/relay/README.md`), because a mock that is more
 * lenient than the relay, or refuses where the relay stays open, cannot catch a
 * client bug in the place the bug lives — the rule `divergences.ts` exists for:
 *
 *   * a body that is not a JSON object → `400 {"error": "request body must be an
 *     object"}` (no `code`);
 *   * an unknown key → `422 project_invalid`, `unknown field(s): x`;
 *   * the name grammar `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and the tag grammar
 *     `^[a-z0-9][a-z0-9_-]{0,23}$` (at most 8), with the store's own sentences;
 *   * a taken name (case-insensitively) → `409 project_name_exists`;
 *   * a `confirm` that does not repeat the row's NAME → `422
 *     project_confirm_mismatch` — an id included, which the sentence says;
 *   * an unknown project key → `404 project_not_found`, with up to two
 *     prefix-matched names as the remedy;
 *   * a milestone name over 80 characters, a non-ISO `target_date` (the empty
 *     string CLEARS the date), and removing a milestone the project does not
 *     hold → `422`;
 *   * a milestone whose name carries a SLASH is creatable and unremovable: the
 *     remove route's `{name:str}` is `[^/]+`, so `ship%2Fv2` never reaches it and
 *     the real relay answers a bare `404 Not Found` with no JSON body. This
 *     module reproduces that by NOT matching the route (the server's own
 *     fall-through), which is the same shape for the same reason.
 *
 * WHAT IT DELIBERATELY DOES NOT MODEL, named rather than implied: the row cap,
 * the session-link family (`POST/DELETE …/links`), `PATCH`, `progress`, the
 * estimate and the date fields beyond a milestone's `target_date`, the
 * `coordination_sessions` split, and the archived-name reuse rule. None of them
 * is reachable from this client's slice; a route this store does not implement
 * keeps answering the wire's own `405` rather than an invented body, which is
 * the rule the method table already applies.
 *
 * DERIVED STATUS IS THE STORE'S, never the client's: `milestone_status` computes
 * completed / overdue / upcoming server-side, and the real relay's own
 * precedence (a completed milestone is never overdue) is what this mirrors.
 */

import { asString, isRecord, type Json } from "../lib/json.ts";
import type { FixtureCorpus } from "./fixtures.ts";

/** The store's own vocabulary, from `local_operator/projects.py`. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const TAGS_MAX = 8;
const DESCRIPTION_MAX = 2000;
const MILESTONE_NAME_MAX = 80;
const STATUS_ORDER = [
	"planning",
	"active",
	"qa",
	"validation",
	"paused",
	"done",
	"archived",
];
const STATUS_RANK: Record<string, number> = Object.fromEntries(
	STATUS_ORDER.map((status, index) => [status, index]),
);
/** The statuses a create body may name — the relay's `ProjectStatus` union. */
const STATUS_VALUES = new Set(STATUS_ORDER);
/** The keys each write body may carry, from the desktop request models. */
const CREATE_FIELDS = ["name", "description", "status", "tags"];
const MILESTONE_FIELDS = ["name", "target_date", "completed"];
const DELETE_FIELDS = ["confirm"];

/** One refusal, in the daemon's own JSON body shape. */
export interface StoreRefusal {
	status: number;
	json: Json;
}

/** A success answer, as the wire body. */
export interface StoreAnswer {
	status: number;
	json: Json;
}

type Refusal = { refuse: StoreRefusal };
type Answer = { answer: StoreAnswer };

/** A milestone as the store holds it, before the view derives its status. */
interface MockMilestone {
	name: string;
	target_date: string | null;
	completed_at: string | null;
}

interface MockRow {
	id: string;
	name: string;
	description: string;
	status: string;
	tags: string[];
	/**
	 * The row's milestones, or `null` when the corpus captured no detail for this
	 * row and no write has touched it yet.
	 *
	 * NULL IS NOT EMPTY, and the distinction is the whole reason this is nullable:
	 * the listing capture carries every row's `milestones_completed`/
	 * `milestones_total` but only ONE row's milestone list. A store that answered
	 * `[]` for the other five would change the numbers the read path's own cells
	 * already show (`projects-feature` has two milestones and no detail capture),
	 * which would make this branch a silent re-capture of a state nobody asked it
	 * to change. So the counts stay the capture's until a write reveals the list,
	 * and `null` is what "the store has no opinion" looks like.
	 */
	milestones: MockMilestone[] | null;
	/** The row's captured summary, VERBATIM — every field this store has no
	 *  opinion about (`sessions`, `live_sessions`, the progress stamps) is the
	 *  relay's own, so a listing cell renders what it rendered before. */
	summary: Record<string, Json>;
	/** Whether the captured corpus holds this row's linked sessions. Only the
	 *  detail capture's own row has links; the rest answer `[]`. */
	links: Json[];
	/** Whether this is the one row the corpus captured a DETAIL for — the flag
	 *  that decides whether the view keeps the capture's progress line and linked
	 *  sessions or starts blank. */
	capturedDetail: boolean;
	created_at: number;
	updated_at: number;
}

const refuse = (status: number, error: string, code?: string): Refusal => ({
	refuse: { status, json: code === undefined ? { error } : { error, code } },
});

/**
 * A value the way the relay's own sentences spell it — Python's `repr` for a
 * plain string, which is single quotes. The daemon writes
 * `f"no project with id or name {key!r}"`, so `JSON.stringify` here produced
 * `"key"` where the relay says `'key'` — a mock that re-words a refusal cannot
 * catch a screen rendering it wrongly, which is the one thing these sentences
 * are for.
 */
const repr = (value: string): string =>
	`'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const isProjectsRefusal = (value: unknown): value is Refusal =>
	isRecord(value) && value.refuse !== undefined;

/** Today, as the store stamps it (`completed_at` is a date, not a timestamp). */
const today = (): string => new Date().toISOString().slice(0, 10);

/** The relay's derived milestone status, including its precedence. */
const milestoneStatus = (milestone: MockMilestone): string => {
	if (milestone.completed_at !== null) return "completed";
	if (milestone.target_date !== null && milestone.target_date < today())
		return "overdue";
	return "upcoming";
};

/** The keys a body carries from `allowed`; anything else is the store's 422. */
const selected = (
	body: Record<string, Json>,
	allowed: string[],
): Record<string, Json> | Refusal => {
	const unknown = Object.keys(body)
		.filter((key) => !allowed.includes(key))
		.sort();
	if (unknown.length > 0) {
		return refuse(
			422,
			`unknown field(s): ${unknown.join(", ")}`,
			"project_invalid",
		);
	}
	const out: Record<string, Json> = {};
	for (const key of allowed) if (key in body) out[key] = body[key] as Json;
	return out;
};

/**
 * The store, seeded from the captured listing and mutated in memory for the life
 * of one scenario.
 *
 * The SUMMARY and VIEW shapes are the captured ones (`projects-created.json`'s
 * body and `projects-detail.json`'s `project`), spread and overridden field by
 * field: a shape re-typed here would be a second wire definition, which is
 * exactly what `shape.ts` exists to prevent. The row id is minted from a
 * deterministic counter rather than a uuid, so two runs of one cell render the
 * same bytes (the fixtures' own ids are the corpus's and are kept for the rows
 * it captured).
 */
export function createProjectsStore(fix: FixtureCorpus) {
	/** A real relay summary, used as the template for every created row. */
	const summaryTemplate = (): Record<string, Json> => {
		const created = fix.record("projects-created");
		const project = created.project;
		if (!isRecord(project)) {
			throw new Error("projects-created.json carries no project object");
		}
		return structuredClone(project);
	};
	/** A real relay view, used as the template for the key-scoped answer. */
	const viewTemplate = (): Record<string, Json> => {
		const detail = fix.record("projects-detail");
		const project = detail.project;
		if (!isRecord(project)) {
			throw new Error("projects-detail.json carries no project object");
		}
		return structuredClone(project);
	};
	/** The captured links for the one row the corpus captured a detail for. */
	const capturedLinks = (): Json[] => {
		const detail = fix.record("projects-detail");
		return Array.isArray(detail.links) ? structuredClone(detail.links) : [];
	};
	const rows: MockRow[] = [];
	let minted = 0;

	const seed = (): void => {
		rows.length = 0;
		minted = 0;
		const listing = fix.record("projects-list");
		const listed = Array.isArray(listing.projects) ? listing.projects : [];
		/* The ONE row the corpus captured a detail for: its id names it, its
		 *  milestones seed the list, and its links are the store's own. */
		const captured = viewTemplate();
		const detailId = asString(captured.id) ?? "";
		const detailMilestones: Record<string, unknown>[] = (
			Array.isArray(captured.milestones) ? captured.milestones : []
		).flatMap((entry) => (isRecord(entry) ? [entry] : []));
		for (const entry of listed) {
			if (!isRecord(entry)) continue;
			const id = asString(entry.id) ?? "";
			const isCapturedDetail = id === detailId;
			rows.push({
				id,
				name: asString(entry.name) ?? "",
				description: asString(entry.description) ?? "",
				status: asString(entry.status) ?? "active",
				tags: Array.isArray(entry.tags)
					? entry.tags.filter((tag): tag is string => typeof tag === "string")
					: [],
				milestones: isCapturedDetail
					? detailMilestones.map((milestone) => ({
							name: asString(milestone.name) ?? "",
							target_date: asString(milestone.target_date) ?? null,
							completed_at: asString(milestone.completed_at) ?? null,
						}))
					: null,
				created_at: typeof entry.created_at === "number" ? entry.created_at : 0,
				updated_at: typeof entry.updated_at === "number" ? entry.updated_at : 0,
				links: isCapturedDetail ? capturedLinks() : [],
				capturedDetail: isCapturedDetail,
				summary: entry,
			});
		}
	};
	seed();

	/**
	 * The row's summary: the CAPTURED summary verbatim, with only the fields the
	 * store owns replaced.
	 *
	 * The captured fields that are NOT the store's to compute stay as the relay
	 * wrote them — `sessions`, `live_sessions` and `coordination_sessions` are the
	 * listing's own answer about a row's links, and a mock that recomputed them
	 * from its own link list would silently change the read path's cells (the
	 * captured `payments-migration` row is `2 sessions · 1 live`, and the live half
	 * is a runtime fact this store has no way to know). The milestone COUNTS are
	 * recomputed only once the store knows the list (`milestones !== null`).
	 */
	const summaryOf = (row: MockRow): Json => ({
		...row.summary,
		id: row.id,
		name: row.name,
		description: row.description,
		status: row.status,
		tags: [...row.tags],
		...(row.milestones === null
			? {}
			: {
					milestones_completed: row.milestones.filter(
						(milestone) => milestone.completed_at !== null,
					).length,
					milestones_total: row.milestones.length,
				}),
		/* NO `created_at`: the wire SUMMARY does not carry one (the captured rows
		 *  have none, and `ProjectSummary` declares none) — the view is the model
		 *  that does. A summary that invented one would be this mock describing a
		 *  field the relay never sends. */
		updated_at: row.updated_at,
	});

	/**
	 * The row's milestone list, MATERIALISED on first need.
	 *
	 * A row the corpus captured no detail for holds `null` — the store has no
	 * opinion about its milestones, which is what keeps its captured counts — and
	 * the first write to that row is what reveals the list. From then on its
	 * counts are the store's own, which is the bound this module's header states:
	 * the corpus captured ONE row's milestones, so a write to another row starts
	 * from the only list this store can honestly see.
	 */
	const milestonesOf = (row: MockRow): MockMilestone[] => {
		if (row.milestones === null) row.milestones = [];
		return row.milestones;
	};

	/**
	 * The row's composed view.
	 *
	 * Built from the captured view (the corpus holds ONE — the detail capture's own
	 * row), so the fields a write cannot touch keep the relay's own values for that
	 * row: its `progress` line, its `progress_stale` verdict and its linked-session
	 * ids. Every other row starts blank there, because the alternative is a minted
	 * row rendering another project's progress line — and `sessions` is a LIST of
	 * ids in the view where the summary's is a COUNT, which is why the view is not
	 * built by spreading the summary over it.
	 */
	const viewOf = (row: MockRow): Json => {
		const template = viewTemplate();
		const own: Record<string, Json> = row.capturedDetail
			? {}
			: {
					/* The view's own `created_at`, from the template, is the CAPTURED row's
					 *  when this row is that one — only a minted row brings its own. */
					created_at: row.created_at,
					progress: "",
					progress_updated_at: null,
					progress_reported_by: "",
					progress_refreshed_at: null,
					progress_refreshed_by: "",
					progress_stale: true,
					updates: [],
					sessions: [],
					coordination_sessions: [],
				};
		return {
			...template,
			id: row.id,
			name: row.name,
			description: row.description,
			status: row.status,
			tags: [...row.tags],
			/* The store's own stamp: seeded from the row's captured value and moved
			 *  by every write, so a milestone edit is visible in the view the same
			 *  answer carries. */
			updated_at: row.updated_at,
			...own,
			milestones: (row.milestones ?? []).map((milestone) => ({
				name: milestone.name,
				target_date: milestone.target_date,
				completed_at: milestone.completed_at,
				status: milestoneStatus(milestone),
			})),
		};
	};

	/** The relay's key resolution: an exact id first, then a case-insensitive name. */
	const find = (key: string): MockRow | undefined =>
		rows.find((row) => row.id === key) ??
		rows.find((row) => row.name.toLowerCase() === key.toLowerCase());

	const notFound = (key: string): Refusal => {
		const prefix = key.trim().toLowerCase().slice(0, 4);
		const near = prefix
			? rows
					.filter((row) => row.name.toLowerCase().startsWith(prefix))
					.slice(0, 2)
					.map((row) => row.name)
			: [];
		const names = near.length > 0 ? ` — closest: ${near.join(", ")}` : "";
		return refuse(
			404,
			`no project with id or name ${repr(key)}${names}`,
			"project_not_found",
		);
	};

	const boardOrder = (): MockRow[] =>
		[...rows].sort(
			(left, right) =>
				(STATUS_RANK[left.status] ?? 99) - (STATUS_RANK[right.status] ?? 99) ||
				right.updated_at - left.updated_at,
		);

	const asBody = (value: unknown): Record<string, Json> | null =>
		isRecord(value) ? (value as Record<string, Json>) : null;

	return {
		/** `GET /api/projects` — the listing, in the relay's board order. */
		list(): Json {
			return { projects: boardOrder().map(summaryOf) };
		},

		/** `GET /api/projects/{key}` — the row plus the links the store holds. */
		detail(key: string): Answer | Refusal {
			const row = find(key);
			if (row === undefined) return notFound(key);
			return {
				answer: {
					status: 200,
					json: { project: viewOf(row), links: structuredClone(row.links) },
				},
			};
		},

		/**
		 * `POST /api/projects` — create one row.
		 *
		 * `status` defaults to `active` (the relay's `ProjectCreate` default), the
		 * tags are checked by the store's grammar, and the name is checked for the
		 * grammar FIRST and for uniqueness second — the real relay's order, which
		 * is why a name that is both malformed and taken answers 422.
		 */
		create(body: unknown): Answer | Refusal {
			const raw = asBody(body);
			if (raw === null) return refuse(400, "request body must be an object");
			const fields = selected(raw, CREATE_FIELDS);
			if (isProjectsRefusal(fields)) return fields;
			const name = fields.name;
			if (typeof name !== "string" || name.trim() === "") {
				return refuse(422, "name is required", "project_invalid");
			}
			if (!NAME_RE.test(name)) {
				return refuse(
					422,
					"project name must be 1-64 characters of letters, digits, dot, underscore or hyphen, and cannot start with a hyphen",
					"project_invalid",
				);
			}
			const description = fields.description;
			if (description !== undefined && description !== null) {
				if (typeof description !== "string") {
					return refuse(422, "description must be a string", "project_invalid");
				}
				if (description.length > DESCRIPTION_MAX) {
					return refuse(
						422,
						`description must be at most ${DESCRIPTION_MAX} characters`,
						"project_invalid",
					);
				}
			}
			const status = fields.status;
			if (status !== undefined && status !== null) {
				if (typeof status !== "string" || !STATUS_VALUES.has(status)) {
					return refuse(
						422,
						`status: Input should be ${STATUS_ORDER.map((value) => `'${value}'`)
							.join(", ")
							.replace(/, ([^,]*)$/, " or $1")}`,
						"project_invalid",
					);
				}
			}
			const tags = fields.tags;
			if (tags !== undefined && tags !== null) {
				if (!Array.isArray(tags)) {
					return refuse(422, "tags must be a list", "project_invalid");
				}
				if (tags.length > TAGS_MAX) {
					return refuse(422, `at most ${TAGS_MAX} tags`, "project_invalid");
				}
				for (const tag of tags) {
					if (typeof tag !== "string" || !TAG_RE.test(tag)) {
						return refuse(
							422,
							`tag ${repr(String(tag))} must be 1-24 characters of lowercase letters, digits, underscore or hyphen, and cannot start with a hyphen`,
							"project_invalid",
						);
					}
				}
			}
			if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
				return refuse(
					409,
					`project ${repr(name)} already exists`,
					"project_name_exists",
				);
			}
			minted += 1;
			const now = Date.now() / 1000;
			const row: MockRow = {
				// Deterministic, and hex-shaped like the store's own uuid column: a
				// cell's frame must not change between runs.
				id: `mock${minted.toString(16).padStart(4, "0")}${"0".repeat(24)}`.slice(
					0,
					32,
				),
				name,
				description: typeof description === "string" ? description : "",
				status: typeof status === "string" ? status : "active",
				tags: Array.isArray(tags)
					? tags.filter((tag): tag is string => typeof tag === "string")
					: [],
				milestones: [],
				created_at: now,
				updated_at: now,
				links: [],
				capturedDetail: false,
				/* A fresh row's summary, from the capture of a fresh row: the corpus's
				 *  answered `POST /api/projects` body IS this shape, so a minted row's
				 *  unset fields (no progress stamps, no estimate) are the relay's own. */
				summary: summaryTemplate(),
			};
			rows.push(row);
			return {
				answer: { status: 200, json: { ok: true, project: summaryOf(row) } },
			};
		},

		/** `DELETE /api/projects/{key}` — the name must be typed back. */
		remove(key: string, body: unknown): Answer | Refusal {
			const raw = asBody(body);
			if (raw === null) return refuse(400, "request body must be an object");
			const fields = selected(raw, DELETE_FIELDS);
			if (isProjectsRefusal(fields)) return fields;
			const confirm = fields.confirm;
			if (typeof confirm !== "string" || confirm.trim() === "") {
				return refuse(
					422,
					"confirm must repeat the project name",
					"project_invalid",
				);
			}
			const row = find(key);
			if (row === undefined) return notFound(key);
			if (confirm.trim().toLowerCase() !== row.name.toLowerCase()) {
				return refuse(
					422,
					`confirm must repeat the project name ${repr(row.name)} exactly (the name, not the id)`,
					"project_confirm_mismatch",
				);
			}
			rows.splice(rows.indexOf(row), 1);
			return { answer: { status: 200, json: { ok: true, deleted: true } } };
		},

		/**
		 * `POST /api/projects/{key}/milestones` — add-or-update, keyed by name.
		 *
		 * `completed: true` stamps today and `false` clears it; a `target_date`
		 * that is absent leaves the date alone, `""` or `null` CLEARS it (the
		 * tri-state the web client's form depends on), and anything else must be
		 * an ISO date.
		 */
		setMilestone(key: string, body: unknown): Answer | Refusal {
			const raw = asBody(body);
			if (raw === null) return refuse(400, "request body must be an object");
			const fields = selected(raw, MILESTONE_FIELDS);
			if (isProjectsRefusal(fields)) return fields;
			const name = fields.name;
			if (typeof name !== "string" || name.trim() === "") {
				return refuse(422, "name is required", "project_invalid");
			}
			if (name.length > MILESTONE_NAME_MAX) {
				return refuse(
					422,
					`milestone name must be at most ${MILESTONE_NAME_MAX} characters`,
					"project_invalid",
				);
			}
			const row = find(key);
			if (row === undefined) return notFound(key);
			let target: string | null | undefined;
			if ("target_date" in fields) {
				const value = fields.target_date;
				if (value === null || value === "") target = null;
				else if (
					typeof value !== "string" ||
					!/^\d{4}-\d{2}-\d{2}$/.test(value)
				) {
					return refuse(
						422,
						"milestone target_date must be an ISO YYYY-MM-DD date",
						"project_invalid",
					);
				} else target = value;
			}
			const milestones = milestonesOf(row);
			const existing = milestones.find(
				(milestone) => milestone.name.toLowerCase() === name.toLowerCase(),
			);
			const completed = fields.completed;
			if (
				completed !== undefined &&
				completed !== null &&
				typeof completed !== "boolean"
			) {
				return refuse(422, "completed must be a boolean", "project_invalid");
			}
			if (existing === undefined) {
				milestones.push({
					name,
					target_date: target ?? null,
					completed_at: completed === true ? today() : null,
				});
			} else {
				if (target !== undefined) existing.target_date = target;
				if (completed === true) existing.completed_at = today();
				else if (completed === false) existing.completed_at = null;
			}
			row.updated_at = Date.now() / 1000;
			return {
				answer: { status: 200, json: { ok: true, project: viewOf(row) } },
			};
		},

		/**
		 * `DELETE /api/projects/{key}/milestones/{name}` — remove one by name.
		 *
		 * A name this project does not hold is the relay's `422` (not a 404): the
		 * project was found, and what the store refuses is the milestone's absence.
		 */
		removeMilestone(key: string, name: string): Answer | Refusal {
			const row = find(key);
			if (row === undefined) return notFound(key);
			const index = milestonesOf(row).findIndex(
				(milestone) => milestone.name.toLowerCase() === name.toLowerCase(),
			);
			if (index === -1) {
				return refuse(
					422,
					`no milestone named ${repr(name)}`,
					"project_invalid",
				);
			}
			milestonesOf(row).splice(index, 1);
			row.updated_at = Date.now() / 1000;
			return {
				answer: { status: 200, json: { ok: true, project: viewOf(row) } },
			};
		},

		/** Reset to the captured corpus — one scenario's writes never leak into
		 *  the next one's cells. */
		reset(): void {
			seed();
		},
	};
}

export type ProjectsStore = ReturnType<typeof createProjectsStore>;
export { isProjectsRefusal };
