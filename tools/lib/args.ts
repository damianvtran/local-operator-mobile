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

/** One flag's accumulated value: absent, a bare `true`, or one/many strings or numbers. */
export type FlagValue =
	| boolean
	| string
	| number
	| Array<string | number | boolean>;

export interface ParsedArgs {
	_: string[];
	flags: Record<string, FlagValue>;
}

/** Parse `argv` into positionals and flags. */
export function parseArgs(argv: string[]): ParsedArgs {
	const flags: Record<string, FlagValue> = {};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === undefined) continue;
		if (!token.startsWith("--")) {
			positional.push(token);
			continue;
		}
		const eq = token.indexOf("=");
		const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
		let value: string | boolean | undefined =
			eq === -1 ? undefined : token.slice(eq + 1);
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
		const coerced: string | number | boolean =
			typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)
				? Number(value)
				: value;
		const existing = flags[name];
		if (existing === undefined) flags[name] = coerced;
		else if (Array.isArray(existing)) existing.push(coerced);
		else flags[name] = [existing, coerced];
	}
	return { _: positional, flags };
}

/** The last value of a flag, before any interpretation. */
const last = (
	flags: Record<string, FlagValue>,
	name: string,
): string | number | boolean | undefined => {
	const value = flags[name];
	if (value === undefined) return undefined;
	return Array.isArray(value) ? value[value.length - 1] : value;
};

/** One flag's value as a string, or `fallback` when the flag is absent. */
export function str(
	flags: Record<string, FlagValue>,
	name: string,
	fallback: string | undefined = undefined,
): string | undefined {
	const value = last(flags, name);
	if (value === undefined || value === true || value === false) return fallback;
	return String(value);
}

/** One flag's value as a number, or `fallback` when absent or not numeric. */
export function num(
	flags: Record<string, FlagValue>,
	name: string,
	fallback: number,
): number {
	const value = last(flags, name);
	if (value === undefined || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** One flag's value as a boolean; `--flag` alone is true, `--flag=false` is false. */
export function bool(
	flags: Record<string, FlagValue>,
	name: string,
	fallback = false,
): boolean {
	const value = last(flags, name);
	if (value === undefined) return fallback;
	if (value === true) return true;
	if (value === false) return false;
	return !["false", "0", "no", "off", ""].includes(String(value).toLowerCase());
}

/** Every string occurrence of a repeatable flag, `true` markers dropped. */
export function list(flags: Record<string, FlagValue>, name: string): string[] {
	const value = flags[name];
	if (value === undefined) return [];
	const values = Array.isArray(value) ? value : [value];
	return values.filter((entry) => entry !== true).map((entry) => String(entry));
}

/**
 * One or more occurrences of a repeatable flag as a list, splitting commas:
 * `--devices a,b --devices c` → `["a","b","c"]`. A comma is how these flags
 * read on a command line and inside a YAML step, so the parser accepts it rather
 * than making every caller split by hand.
 */
export function csv(flags: Record<string, FlagValue>, name: string): string[] {
	return list(flags, name)
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter((value) => value !== "");
}
