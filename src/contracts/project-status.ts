/**
 * The projects board order — the ONE copy of it in this app.
 *
 * `local_operator/server/models/desktop_projects.py` declares `STATUS_RANK`, and
 * both the desktop routes and the phone daemon sort a listing by it before it
 * crosses the wire. This app cannot import Python, so the order is mirrored here
 * once; every reader of it (the list screen's sections, any later search or
 * timeline surface) imports this tuple rather than restating it.
 *
 * WHY ONE COPY MATTERS. The web client's sheet kept its own hand-copied list and
 * that list had DRIFTED — it was missing three of the seven statuses when this
 * was written, so a row in `qa`, `validation` or `paused` silently mis-grouped.
 * A second list beside an established one is a list that goes stale without
 * anyone noticing, which is the defect class this module exists to close.
 *
 * AN UNKNOWN STATUS IS NOT DROPPED. A newer relay may add a status this build
 * has never heard of, and the honest render is its own trailing section rather
 * than a vanished row (the same rule `types.gen.ts` states for `EntryKind`, and
 * the reason `ProjectSummary.status` is a `string` here rather than an enum).
 * Unknown statuses are ordered ALPHABETICALLY after every known one, so two
 * identical answers always produce identical sections.
 */

/**
 * The known statuses, in the relay's rank order.
 *
 * Order is the whole value: these are the section order of the listing, and
 * `archived` is last because the relay's board only draws it when it is
 * non-empty. Never re-sort a section's own rows — the relay already ordered them
 * by `STATUS_RANK` then `-updated_at`, and a client sort would throw away the
 * server's answer (the same rule `endpoints.models` records).
 */
export const PROJECT_STATUS_ORDER = [
	"planning",
	"active",
	"qa",
	"validation",
	"paused",
	"done",
	"archived",
] as const;

export type KnownProjectStatus = (typeof PROJECT_STATUS_ORDER)[number];

/** One section of the listing: a status and the rows that carry it. */
export interface ProjectStatusSection<T> {
	/** The status word itself — the section heading AND the key. */
	status: string;
	/** False for a status this build does not know, which the screen can mark. */
	known: boolean;
	rows: T[];
}

/**
 * Group a relay-ordered listing into sections.
 *
 * The input is kept in the order the relay sent: rows are bucketed, never
 * re-sorted, so a section's own order is the relay's `-updated_at` ordering.
 * The output puts every known status first in `PROJECT_STATUS_ORDER` (skipping
 * the ones with no rows), then any unknown statuses alphabetically.
 */
export function groupProjectsByStatus<T extends { status: string }>(
	projects: readonly T[],
): ProjectStatusSection<T>[] {
	const buckets = new Map<string, T[]>();
	for (const project of projects) {
		const rows = buckets.get(project.status);
		if (rows === undefined) buckets.set(project.status, [project]);
		else rows.push(project);
	}

	const sections: ProjectStatusSection<T>[] = [];
	for (const status of PROJECT_STATUS_ORDER) {
		const rows = buckets.get(status);
		if (rows !== undefined) sections.push({ status, known: true, rows });
	}
	const unknown = [...buckets.keys()]
		.filter(
			(status) => !(PROJECT_STATUS_ORDER as readonly string[]).includes(status),
		)
		.sort();
	for (const status of unknown) {
		const rows = buckets.get(status);
		if (rows !== undefined) sections.push({ status, known: false, rows });
	}
	return sections;
}
