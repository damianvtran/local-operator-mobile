/**
 * THE KEY-SHAPE RULE (the one AGENTS.md and docs/i18n.md state).
 *
 * The namespace is the catalogue's FILE STEM (`mobile.schedules` for
 * `mobile.schedules.json`) and a key is `<namespace>.<name>` or
 * `<namespace>.<group>.<name>` — the group is OPTIONAL. A flat key is legal
 * because a namespace that is one screen's copy (`mobile.account_routing`) has
 * nothing to group; a group is for a namespace whose keys fall into clusters
 * (`mobile.schedules.count.wakes`). Every segment is lower snake_case and
 * non-empty, and there is at most one group, so the shape is derivable and a
 * key cannot hide its namespace in a deeper path.
 *
 * WHY ENFORCED HERE. The prefix is what `t()` call sites, the sidecar and the
 * "a key has one owner" rule all rely on; nothing else checked it, so 41 of the
 * 116 keys disagreed with the prose for as long as the prose said otherwise.
 */
const SEGMENT = /^[a-z][a-z0-9_]*$/;

export function keyShapeError(
	namespace: string,
	key: string,
): string | undefined {
	const prefix = `${namespace}.`;
	if (!key.startsWith(prefix)) {
		return `${key} does not begin with its namespace ${prefix} (the file stem)`;
	}
	const segments = key.slice(prefix.length).split(".");
	if (segments.length > 2) {
		return `${key} has ${segments.length} segments after ${prefix}; the shape is <namespace>.<name> or <namespace>.<group>.<name>`;
	}
	if (segments.some((segment) => !SEGMENT.test(segment))) {
		return `${key} has an empty or non lower_snake_case segment after ${prefix}`;
	}
	return undefined;
}
