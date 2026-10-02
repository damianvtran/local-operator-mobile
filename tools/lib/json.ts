/**
 * The boundary layer: everything this tooling reads from outside the process —
 * a fixture file, a CDP payload, a relay frame — arrives as `unknown` and is
 * narrowed here rather than asserted with a cast.
 *
 * Why this exists as a module: the alternative in each caller is `x as Foo`, and
 * a cast asserts a shape nobody checked. These helpers make the check explicit
 * and cheap to reuse, so a malformed fixture fails at the field that is wrong
 * instead of producing `undefined` three layers deeper.
 */

/** A parsed JSON value, as this tooling is willing to reason about it. */
export type Json =
	| null
	| boolean
	| number
	| string
	| Json[]
	| { [key: string]: Json };

/**
 * Is this a JSON object (not null, not an array)? The predicate form is what
 * keeps the callers cast-free: `value is Record<string, unknown>` is checked by
 * `typeof`, not asserted by `as`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field as a string, or `undefined` when it is absent or not a string. */
export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** A field as a finite number, or `undefined`. Numeric strings are NOT coerced. */
export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** A field as an array of strings, or `undefined` when it is not one. */
export function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.every((entry) => typeof entry === "string") ? value : undefined;
}

/** A field as a plain string→string map, or `undefined` when it is not one. */
export function asStringMap(
	value: unknown,
): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string") return undefined;
		out[key] = entry;
	}
	return out;
}

/**
 * A field as JSON, or `undefined` when it could not be one. Used where a fixture
 * carries a value whose exact shape a scenario will narrow for itself.
 *
 * The four `as Json` casts below are the one place this module asserts rather
 * than checks, and each is safe for a reason the compiler cannot see: `Json` is
 * a recursive union, so after `typeof v === "boolean"` TypeScript still will not
 * accept `v` as the whole union — it knows the member, not the union. The branch
 * that performs the cast is what establishes membership, so the cast adds no
 * claim beyond the check beside it.
 */
export function asJson(value: unknown): Json | undefined {
	if (value === null) return null;
	if (typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (Array.isArray(value)) return value as Json;
	if (isRecord(value)) return value as Json;
	return undefined;
}

/** Read the file at `path` and parse it as JSON, with the path named on failure. */
export function readJsonFile(
	read: (path: string) => string,
	path: string,
): unknown {
	const text = read(path);
	try {
		// `JSON.parse` is typed `any`; assigning it to a function that returns
		// `unknown` is what stops that `any` reaching a caller.
		const parsed: unknown = JSON.parse(text);
		return parsed;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`${path} is not valid JSON: ${reason}`);
	}
}
