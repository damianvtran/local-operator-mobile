/**
 * The seed hook's parameters, compared as RAW parsed pairs.
 *
 * The original check compared two rendered strings, and one side was a literal a human
 * transcribed from the harness's redacted output — so it carried the redaction
 * placeholder where a password belonged. The comparison is therefore on parsed values,
 * and a failure names only the keys that differ: at `9810b50` that check failed while
 * printing two identical-looking strings, and the redaction is what made it unreadable.
 *
 * `paramDiff` returns "" when the query matches `expected` exactly, and it deliberately
 * IGNORES two things, both stated here because a silent allowance is how a check stops
 * meaning what it says:
 *  - **order** — a seed URL's parameter order carries no meaning: the app reads by name
 *    with `URLSearchParams.get`, so the comparison is order-insensitive;
 *  - **encoding** — `URLSearchParams` normalises `%20` and `+`, so encoded forms compare
 *    as the values they decode to rather than as bytes.
 *
 * It does NOT ignore duplicates, and it does not choose between them: the same key twice
 * means the URL carries two values while a name-based reader sees one, so a repeated key
 * is reported and fails. No first-or-last reading is taken for such a key, so `Map`'s
 * last-wins behaviour never reaches the result — that note matters only because dropping
 * either duplicate guard would make it reachable.
 */
export function seedParams(query: string): Array<[string, string]> {
	return [...new URLSearchParams(query).entries()];
}

export function paramDiff(
	actual: string,
	expected: Array<[string, string]>,
): string {
	const pairs = seedParams(actual);
	const keys = pairs.map(([key]) => key);
	const duplicated = [
		...new Set(keys.filter((key, index) => keys.indexOf(key) !== index)),
	];
	const got = new Map(pairs);
	const differing = expected
		.filter(
			([key, value]) => !duplicated.includes(key) && got.get(key) !== value,
		)
		.map(([key]) => key);
	const unexpected = keys.filter(
		(key) =>
			!expected.some(([expectedKey]) => expectedKey === key) &&
			!duplicated.includes(key),
	);
	if (
		duplicated.length === 0 &&
		differing.length === 0 &&
		unexpected.length === 0
	) {
		return "";
	}
	return (
		`parameters that differ: ${differing.join(", ") || "none"}; ` +
		`duplicated: ${duplicated.join(", ") || "none"}; ` +
		`unexpected: ${unexpected.join(", ") || "none"}`
	);
}
