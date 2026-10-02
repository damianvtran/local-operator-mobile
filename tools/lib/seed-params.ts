/**
 * The seed hook's parameters, compared as RAW parsed pairs.
 *
 * The original check compared two rendered strings, and one side was a literal a human
 * transcribed from the harness's redacted output — so it carried the redaction
 * placeholder where a password belonged. The comparison is therefore on parsed values,
 * and a failure names only the keys that differ: at `9810b50` that check failed while
 * printing two identical-looking strings, and the redaction is what made it unreadable.
 *
 * `paramDiff` returns "" when the query matches `expected` exactly — same keys, same
 * order, same raw values, nothing extra.
 */
export function seedParams(query: string): Array<[string, string]> {
	return [...new URLSearchParams(query).entries()];
}

export function paramDiff(
	actual: string,
	expected: Array<[string, string]>,
): string {
	const got = new Map(seedParams(actual));
	const differing = expected
		.filter(([key, value]) => got.get(key) !== value)
		.map(([key]) => key);
	const unexpected = [...got.keys()].filter(
		(key) => !expected.some(([k]) => k === key),
	);
	if (differing.length === 0 && unexpected.length === 0) return "";
	return `parameters that differ: ${differing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`;
}

export function paramCount(query: string): number {
	return seedParams(query).length;
}
