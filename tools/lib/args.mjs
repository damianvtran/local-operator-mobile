/**
 * A 40-line flag parser, deliberately.
 *
 * The audit instruments must run on a machine with nothing installed but Node
 * and Chrome (ADR 0003, "Context"), so they cannot depend on a CLI framework.
 * The grammar is the one the READMEs document: `--flag value`, `--flag=value`,
 * repeated `--flag a --flag b`, and bare boolean `--flag`. A value that looks
 * like a number becomes one, because every caller here passes ports, durations
 * and pixel counts.
 */

/** Parse `argv` into `{ _: [...positional], flags: {name: value|true|[values]} }`. */
export function parseArgs(argv) {
	const flags = {};
	const positional = [];
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			positional.push(token);
			continue;
		}
		const eq = token.indexOf("=");
		const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
		let value = eq === -1 ? undefined : token.slice(eq + 1);
		// A bare `--flag` followed by a non-flag token consumes it as the value;
		// `--flag` at the end (or before another `--flag`) is boolean true.
		if (value === undefined) {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) value = true;
			else {
				value = next;
				i += 1;
			}
		}
		const coerced = typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)
			? Number(value)
			: value;
		if (name in flags) {
			flags[name] = Array.isArray(flags[name])
				? [...flags[name], coerced]
				: [flags[name], coerced];
		} else flags[name] = coerced;
	}
	return { _: positional, flags };
}

/** One flag's value as a string, or `fallback` when the flag is absent. */
export const str = (flags, name, fallback = undefined) => {
	const v = flags[name];
	if (v === undefined) return fallback;
	return String(Array.isArray(v) ? v[v.length - 1] : v);
};

/** One flag's value as a number, or `fallback` when absent/not numeric. */
export const num = (flags, name, fallback = undefined) => {
	const v = str(flags, name);
	const n = v === undefined ? NaN : Number(v);
	return Number.isFinite(n) ? n : fallback;
};

/** One flag's value as a boolean; `--flag` alone is true, `--flag=false` is false. */
export const bool = (flags, name, fallback = false) => {
	const v = flags[name];
	if (v === undefined) return fallback;
	const last = Array.isArray(v) ? v[v.length - 1] : v;
	if (last === true) return true;
	return !["false", "0", "no", "off", ""].includes(String(last).toLowerCase());
};

/**
 * One or more occurrences of a repeatable flag as a list, splitting commas:
 * `--devices a,b --devices c` → `["a","b","c"]`. A comma is how these flags
 * read on a command line and inside a YAML step, so the parser accepts it rather
 * than making every caller split by hand.
 */
export const csv = (flags, name) =>
	list(flags, name)
		.flatMap((value) => String(value).split(","))
		.map((value) => value.trim())
		.filter((value) => value !== "");
export const list = (flags, name) => {
	const v = flags[name];
	if (v === undefined) return [];
	const arr = Array.isArray(v) ? v : [v];
	return arr.filter((x) => x !== true).map(String);
};
