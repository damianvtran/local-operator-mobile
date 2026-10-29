/**
 * THE KEY-SHAPE RULE (the one AGENTS.md and docs/i18n.md state).
 *
 * The namespace is the catalogue's FILE STEM (`mobile.schedules` for
 * `mobile.schedules.json`) and a key is `<namespace>.<name>` or any deeper
 * lower_snake_case path under it — up to FIVE segments after the namespace.
 * A flat key is legal because a namespace that is one screen's copy
 * (`mobile.account_routing`) has nothing to group; deeper paths are for a
 * namespace whose keys fall into clusters (`mobile.schedules.count.wakes`) and
 * for keys SHARED with another client (`relay.chrome.session.subtitle.ended`,
 * which core ships and mobile adopts byte-for-byte rather than renaming).
 *
 * WHY FIVE AND NOT TWO. The first version of this rule allowed one group, and
 * it contradicted the catalogue it governed: `relay.chrome` carries core's
 * audited safety copy, whose keys go three segments deep. Renaming them would
 * hide that two clients name one state the same way, so the BOUND is derived
 * from core's shipped vocabulary instead of from a preference: a longer path is
 * how a shared key stays shared. The character-set, namespace-prefix and
 * non-empty rules still apply to every segment, so a key cannot hide its
 * namespace in an arbitrary path.
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
	if (segments.length > 5) {
		return `${key} has ${segments.length} segments after ${prefix}; the shape allows up to five (<namespace>.<name> … <namespace>.<a>.<b>.<c>.<d>.<name>) so a key shared with another client stays byte-identical`;
	}
	if (segments.some((segment) => !SEGMENT.test(segment))) {
		return `${key} has an empty or non lower_snake_case segment after ${prefix}`;
	}
	return undefined;
}
