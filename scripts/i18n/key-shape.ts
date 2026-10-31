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
 *
 * THE MIRRORED NAMESPACES ARE EXEMPT FROM THE GROUP LIMIT. The `relay.*`
 * catalogues are not this app's copy: they are the desktop relay's own strings,
 * mirrored key for key so a later adoption of the core locale files is a file
 * copy rather than a translation pass (docs/i18n.md, "Mirrored copy"). The
 * core's shape is deeper than one group — `relay.chrome.session.subtitle
 * .not_answering` is a real key there — so capping depth here would force a
 * rename that breaks the one property those files exist to hold. Everything
 * else still applies to them: the prefix, the lower_snake_case segments and the
 * non-empty remainder.
 */
const SEGMENT = /^[a-z][a-z0-9_]*$/;

/** Namespaces mirrored verbatim from the core relay catalogue (see above). */
const MIRRORED_NAMESPACE_PREFIXES = ["relay"];

const isMirrored = (namespace: string): boolean =>
	MIRRORED_NAMESPACE_PREFIXES.some(
		(prefix) => namespace === prefix || namespace.startsWith(`${prefix}.`),
	);

export function keyShapeError(
	namespace: string,
	key: string,
): string | undefined {
	const prefix = `${namespace}.`;
	if (!key.startsWith(prefix)) {
		return `${key} does not begin with its namespace ${prefix} (the file stem)`;
	}
	const segments = key.slice(prefix.length).split(".");
	if (segments.length > 2 && !isMirrored(namespace)) {
		return `${key} has ${segments.length} segments after ${prefix}; the shape is <namespace>.<name> or <namespace>.<group>.<name>`;
	}
	if (segments.some((segment) => !SEGMENT.test(segment))) {
		return `${key} has an empty or non lower_snake_case segment after ${prefix}`;
	}
	return undefined;
}
