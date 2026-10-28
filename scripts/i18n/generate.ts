/**
 * Generate the runtime's catalogue projection and typed key surface from the
 * English catalogues.
 *
 * WHY GENERATED. The typed surface has to be a *consequence* of the catalogues,
 * not a second list maintained beside them. A key added to a JSON file and not
 * regenerated fails `--check` in review; a key removed from the JSON can never
 * keep compiling because it was hand-listed somewhere.
 *
 * WHY A TS PROJECTION AND NOT A JSON IMPORT. The JSON files under
 * `src/i18n/catalogues/en/` are the AUTHORING source — that is the programme's
 * layout, and `catalogues.test.ts` checks them directly. The app cannot import
 * them as JSON, though: `scripts/ci/account-routing-*.ts` load a feature module
 * that reaches this runtime under plain Node, and Node refuses a JSON import
 * without an import attribute (`ERR_IMPORT_ATTRIBUTE_MISSING`; measured with
 * Node 24.22.1 on this change). Metro's support for that attribute is not
 * something this slice can verify without a build, which the brief forbids. So
 * the generator emits `catalogue.gen.ts` — messages and context sidecars alike —
 * and the runtime imports that. One source of truth, one generated projection,
 * and a `--check` that fails the moment they disagree.
 *
 * The parser is imported from `src/i18n/messages.ts` rather than re-implemented:
 * the parameter list this tool writes into `MessageParams` must be the same
 * reading of the message that the renderer will do, or the types would promise
 * arguments the renderer never receives. That shared reading is also why an
 * invalid message fails generation — the catalogue cannot be committed broken.
 *
 * Usage:
 *   node scripts/i18n/generate.ts           # write the generated files
 *   node scripts/i18n/generate.ts --check   # fail if either is stale (CI)
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { registerSourceResolver } from "../lib/load-src.ts";

registerSourceResolver();

const parser = (await import(
	new URL("../../src/i18n/messages.ts", import.meta.url).href
)) as typeof import("../../src/i18n/messages.ts");

const { parseMessage } = parser;

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CATALOGUE_DIR = join(ROOT, "src", "i18n", "catalogues", "en");
const OUTPUT = join(ROOT, "src", "i18n", "catalogue.gen.ts");

/** The sidecar vocabulary. A role outside this set is a generation failure,
 *  which is also how the union in the generated file stays exact. */
const ROLES = [
	"heading",
	"help",
	"status",
	"button",
	"confirm",
	"meta",
] as const;
type Role = (typeof ROLES)[number];

type ArgumentKind = "text" | "plural" | "select";

const KIND_ORDER: Readonly<Record<ArgumentKind, number>> = {
	text: 0,
	plural: 1,
	select: 2,
};

function compare(left: string, right: string): number {
	/* Plain code-unit ordering, not `localeCompare`: the generated files must be
	 * byte-identical on every machine and in every shell locale. */
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function readObject(path: string, label: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		fail(`${label}: must be a flat object`);
	}
	return parsed as Record<string, unknown>;
}

function typeFor(kind: ArgumentKind): string {
	switch (kind) {
		case "plural":
			return "number";
		case "select":
			return "string";
		case "text":
			return "string | number";
	}
}

const namespaces = readdirSync(CATALOGUE_DIR)
	.filter((name) => name.endsWith(".json") && !name.endsWith(".context.json"))
	.sort(compare);

if (namespaces.length === 0) {
	fail(`No English catalogues in ${CATALOGUE_DIR}`);
}

interface ContextEntry {
	readonly role: Role;
	readonly note: string;
}

/** key → its parameter names and kinds. */
const messages = new Map<string, ReadonlyMap<string, ArgumentKind>>();
/** key → its English source text, as authored. */
const values = new Map<string, string>();
const context = new Map<string, ContextEntry>();
const owner = new Map<string, string>();

for (const file of namespaces) {
	const path = join(CATALOGUE_DIR, file);
	const catalogue = readObject(path, file);
	const contextPath = join(
		CATALOGUE_DIR,
		file.replace(/\.json$/, ".context.json"),
	);
	const sidecar = readObject(contextPath, `${file} (context)`);

	const keys = Object.keys(catalogue);
	const contextKeys = Object.keys(sidecar);
	if (keys.length !== contextKeys.length || keys.some((key) => !sidecar[key])) {
		fail(`${file}: every key needs a context entry; the sidecars disagree`);
	}

	for (const key of keys) {
		const value = catalogue[key];
		if (typeof value !== "string") fail(`${file}: ${key} is not a string`);
		const previous = owner.get(key);
		if (previous !== undefined) {
			fail(
				`${file}: ${key} is also defined in ${previous}; a key has one owner`,
			);
		}
		owner.set(key, file);
		let params: ReadonlyMap<string, ArgumentKind>;
		try {
			params = parseMessage(value).params;
		} catch (error) {
			fail(
				`${file}: ${key} is not a valid message — ${(error as Error).message}`,
			);
		}
		messages.set(key, params);
		values.set(key, value);

		const entry = sidecar[key];
		if (entry === null || typeof entry !== "object") {
			fail(`${contextPath}: ${key} has no context object`);
		}
		const { role, note } = entry as { role?: unknown; note?: unknown };
		if (
			typeof role !== "string" ||
			!(ROLES as readonly string[]).includes(role)
		) {
			fail(
				`${contextPath}: ${key} has role ${JSON.stringify(role)}; expected one of ${ROLES.join(", ")}`,
			);
		}
		if (typeof note !== "string" || note.trim() === "") {
			fail(`${contextPath}: ${key} has no note`);
		}
		context.set(key, { role: role as Role, note });
	}
}

const keys = [...messages.keys()].sort(compare);

/**
 * LOCALE PARITY. Every other locale directory next to `en/` must define exactly
 * the English keys, namespace by namespace: a key missing from a locale would
 * render the English fallback for that reader without anyone having decided it
 * should, and a key the source does not have is a message nothing can ask for.
 * The programme's gate is "missing keys in any supported locale fail CI"; with
 * only `en` shipped today the loop has nothing to compare, and the moment a
 * translation directory lands this check is already armed. Placeholders are not
 * compared here — that is the translation wave's audit, not this slice's.
 */
for (const locale of readdirSync(join(CATALOGUE_DIR, ".."), {
	withFileTypes: true,
})) {
	if (!locale.isDirectory() || locale.name === "en") continue;
	const directory = join(CATALOGUE_DIR, "..", locale.name);
	for (const file of namespaces) {
		let translated: Record<string, unknown>;
		try {
			translated = readObject(join(directory, file), `${locale.name}/${file}`);
		} catch {
			fail(
				`${locale.name}/${file} is missing; every locale needs every namespace`,
			);
		}
		const source = Object.keys(readObject(join(CATALOGUE_DIR, file), file));
		const missing = source.filter((key) => !(key in translated));
		const extra = Object.keys(translated).filter(
			(key) => !source.includes(key),
		);
		if (missing.length > 0 || extra.length > 0) {
			fail(
				`${locale.name}/${file} disagrees with the English source — missing: ${
					missing.join(", ") || "none"
				}; unknown: ${extra.join(", ") || "none"}`,
			);
		}
	}
}

/** Split by shape: `t()` uses these two unions as its overload domains, so a
 *  parameterless key cannot be called with arguments and a parameterised key
 *  cannot be called without them. */
const noParamKeys = keys.filter((key) => (messages.get(key)?.size ?? 0) === 0);

if (noParamKeys.length === keys.length) {
	fail("No message in the catalogues takes an argument; nothing to type");
}

const keyUnion = keys.map((key) => `\t| ${JSON.stringify(key)}`).join("\n");
const noParamUnion = noParamKeys
	.map((key) => `\t| ${JSON.stringify(key)}`)
	.join("\n");

const paramRows = keys
	.map((key) => {
		const params = messages.get(key);
		if (params === undefined || params.size === 0) {
			return `\t${JSON.stringify(key)}: NoParams;`;
		}
		const fields = [...params.entries()]
			.sort((left, right) => {
				const byKind = KIND_ORDER[left[1]] - KIND_ORDER[right[1]];
				return byKind !== 0 ? byKind : compare(left[0], right[0]);
			})
			.map(([name, kind]) => `${name}: ${typeFor(kind)}`)
			.join("; ");
		return `\t${JSON.stringify(key)}: { ${fields} };`;
	})
	.join("\n");

const messageRows = keys
	.map((key) => {
		const value = values.get(key);
		if (value === undefined) fail(`no source text for ${key}`);
		return `\t${JSON.stringify(key)}: ${JSON.stringify(value)},`;
	})
	.join("\n");

const contextRows = keys
	.map((key) => {
		const entry = context.get(key);
		if (entry === undefined) fail(`missing context for ${key}`);
		return `\t${JSON.stringify(key)}: { role: ${JSON.stringify(entry.role)}, note: ${JSON.stringify(entry.note)} },`;
	})
	.join("\n");

const output = `/**
 * GENERATED by \`scripts/i18n/generate.ts\` from the English catalogues
 * (\`src/i18n/catalogues/en/*.json\` and their \`*.context.json\` sidecars).
 * Do not edit by hand: \`--check\` compares this file with a fresh generation, so
 * an edit that is not in a catalogue is a failing build rather than a quiet
 * divergence.
 *
 * WHY ONE MODULE WITH NO IMPORTS. Two reasons, both load-bearing:
 *
 * 1. The typed surface has to be a consequence of the catalogues, not a second
 *    list beside them. \`CatalogueKey\` and \`MessageParams\` are derived here from
 *    the same parse the renderer performs, so an unknown key, a misspelled one, a
 *    missing argument or a wrongly typed argument fails \`tsc\` instead of
 *    rendering \`undefined\` at run time.
 * 2. Part of this app is loaded by plain Node scripts (\`scripts/ci/account-routing-*\`
 *    reach the runtime through a feature module), and Node cannot resolve \`src/\`'s
 *    extensionless imports or a JSON import without an import attribute. A single
 *    generated module that imports NOTHING is loadable by the bundler, by vitest
 *    and by plain Node alike — and \`scripts/node-specifiers.test.ts\` rejects
 *    extensionless specifiers in this directory, which is why the types and the
 *    data live together here rather than in two generated files that import each
 *    other.
 */

/** A key with no placeholders. \`keyof\` is \`never\`, which is what the \`t()\`
 *  overload reads to demand no arguments. */
export type NoParams = Record<never, never>;

/** Every key the English source defines. */
export type CatalogueKey =
${keyUnion};

/** Keys with no placeholders: \`t()\` takes no second argument for these. */
export type NoParamKey =
${noParamUnion};

/** Keys that take one argument object, typed by \`MessageParams\`. */
export type ParamKey = Exclude<CatalogueKey, NoParamKey>;

/** The arguments each key takes, keyed by the same union. */
export type MessageParams = {
${paramRows}
};

export type ContextRole =
${ROLES.map((role) => `\t| ${JSON.stringify(role)}`).join("\n")};

export interface CatalogueContext {
	/** What the message IS on its surface, so a translator is not guessing. */
	readonly role: ContextRole;
	/** The translator-facing note: placeholders, constraints, what not to imply. */
	readonly note: string;
}

/** English source, keyed exactly as the catalogues are. */
export const ENGLISH_MESSAGES: Readonly<Record<CatalogueKey, string>> = {
${messageRows}
};

/** Translator context for every key above. */
export const ENGLISH_CONTEXT: Readonly<Record<CatalogueKey, CatalogueContext>> = {
${contextRows}
};
`;

function check(path: string, expected: string): void {
	let current = "";
	try {
		current = readFileSync(path, "utf8");
	} catch {
		console.error(`${path} is missing; run \`node scripts/i18n/generate.ts\``);
		process.exit(1);
	}
	if (current !== expected) {
		console.error(`${path} is stale; run \`node scripts/i18n/generate.ts\``);
		process.exit(1);
	}
}

if (process.argv.includes("--check")) {
	check(OUTPUT, output);
	console.log(
		`src/i18n/catalogue.gen.ts is current (${keys.length} keys, ${namespaces.length} namespaces)`,
	);
} else {
	writeFileSync(OUTPUT, output);
	console.log(
		`Wrote src/i18n/catalogue.gen.ts (${keys.length} keys, ${namespaces.length} namespaces)`,
	);
}
