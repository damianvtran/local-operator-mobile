/**
 * Generate the runtime's catalogue projection and typed key surface from the
 * catalogues: English is the source of the typed surface and of every message,
 * and every other locale directory beside `en/` is projected beside it.
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
 * `MessageParams` is derived from the STRICTEST reading across English and every
 * SHIPPED locale (`src/i18n/locale.ts`), not from English alone — see the
 * parameter-parity block below for the runtime failure that rule prevents.
 *
 * Usage:
 *   node scripts/i18n/generate.ts           # write the generated files
 *   node scripts/i18n/generate.ts --check   # fail if either is stale (CI)
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { registerSourceResolver } from "../lib/load-src.ts";
import { keyShapeError } from "./key-shape.ts";

registerSourceResolver();

const parser = (await import(
	new URL("../../src/i18n/messages.ts", import.meta.url).href
)) as typeof import("../../src/i18n/messages.ts");

const { parseMessage } = parser;

/* The shipped set is read from the runtime's own manifest rather than inferred
 * from which directories happen to exist: a drafted locale that no build
 * renders must not tighten the app's call sites, and a SHIPPED locale's plurals
 * must. `catalogues.ts` and `catalogues.test.ts` bind the two directions
 * (shipped without a directory, directory without shipping); this tool needs
 * the list itself, for the type surface only. */
const localeModule = (await import(
	new URL("../../src/i18n/locale.ts", import.meta.url).href
)) as typeof import("../../src/i18n/locale.ts");

const shippedLocales = localeModule.SHIPPED_LOCALES;

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

	const namespace = file.replace(/\.json$/, "");
	for (const key of keys) {
		const shapeError = keyShapeError(namespace, key);
		if (shapeError !== undefined) fail(`${file}: ${shapeError}`);
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
 * LOCALE PARITY AND PROJECTION. Every other locale directory next to `en/` must
 * define exactly the English keys, namespace by namespace: a key missing from a
 * locale would render the English fallback for that reader without anyone having
 * decided it should, and a key the source does not have is a message nothing can
 * ask for. The same walk PROJECTS each translation into the generated module
 * (`LOCALISED_MESSAGES`), so `catalogues.ts` never hand-copies a locale: a
 * directory that exists is a directory the runtime can reach, and "wire the new
 * locale up" stops being a second manual step nobody can check.
 *
 * Each translated message is PARSED with the same parser the runtime uses, so a
 * translation that breaks the placeholder/plural grammar fails generation rather
 * than throwing on a reader's screen. Placeholder NAMES are compared (the
 * parameter-parity block below), because a translation that quietly drops one renders
 * a sentence with a hole in it — and, since the dropped name is what the call
 * site types against, nothing else would ever notice.
 */
const catalogueRoot = join(CATALOGUE_DIR, "..");

const localeNames = readdirSync(catalogueRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && entry.name !== "en")
	.map((entry) => entry.name)
	.sort(compare);

/** locale → key → translated message, projected into `catalogue.gen.ts`. */
const translations = new Map<string, Map<string, string>>();
/** locale → key → the parsed parameter kinds of its translation. */
const translationParams = new Map<
	string,
	ReadonlyMap<string, ReadonlyMap<string, ArgumentKind>>
>();

for (const locale of localeNames) {
	const directory = join(catalogueRoot, locale);
	const translated = new Map<string, string>();
	const translatedParams = new Map<string, ReadonlyMap<string, ArgumentKind>>();
	const unknownNamespaces = readdirSync(directory)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".context.json"))
		.filter((name) => !namespaces.includes(name))
		.sort(compare);
	if (unknownNamespaces.length > 0) {
		fail(
			`${locale}: defines a namespace the English source does not — ${unknownNamespaces.join(", ")}`,
		);
	}
	for (const file of namespaces) {
		let catalogue: Record<string, unknown>;
		try {
			catalogue = readObject(join(directory, file), `${locale}/${file}`);
		} catch {
			fail(`${locale}/${file} is missing; every locale needs every namespace`);
		}
		const source = Object.keys(readObject(join(CATALOGUE_DIR, file), file));
		const missing = source.filter((key) => !(key in catalogue));
		const extra = Object.keys(catalogue).filter((key) => !source.includes(key));
		if (missing.length > 0 || extra.length > 0) {
			fail(
				`${locale}/${file} disagrees with the English source — missing: ${
					missing.join(", ") || "none"
				}; unknown: ${extra.join(", ") || "none"}`,
			);
		}
		for (const key of source) {
			const value = catalogue[key];
			if (typeof value !== "string" || value.trim() === "") {
				fail(`${locale}/${file}: ${key} must be a non-empty string`);
			}
			let params: ReadonlyMap<string, ArgumentKind>;
			try {
				params = parseMessage(value).params;
			} catch (error) {
				fail(
					`${locale}/${file}: ${key} is not a valid message — ${(error as Error).message}`,
				);
			}
			translated.set(key, value);
			translatedParams.set(key, params);
		}
	}
	translations.set(locale, translated);
	translationParams.set(locale, translatedParams);
}

/**
 * PARAMETER PARITY — the check that keeps a translation from losing an argument.
 *
 * WHY A NAME SET AND NOT A TEXT DIFF. `t()` types a key's arguments from
 * `MessageParams`, and that type is what every call site writes against. A
 * translation that drops `{total}` renders a sentence nobody can repair at the
 * call site, and nothing else in the pipeline can see it: the key exists, the
 * message parses, and the missing word is simply absent from the screen. The
 * reviewer reproduced exactly that on `--check` (deleting `{total}` from
 * `fr/mobile.projects.milestones.count` left it green), so the names are
 * compared here, and the failure names the key and the missing/extra names.
 *
 * WHY A KIND MAY ONLY ESCALATE. French spells five counts as ICU plurals where
 * the English source uses a plain placeholder (`{count} armed` → `{count,
 * plural, one {# active} …}`), and that is legitimate translation work — a
 * locale's noun inflects and English's does not. Escalation is therefore
 * allowed (text → plural/select) and everything else is refused: a translation
 * may not DOWNGRADE a plural to a plain placeholder (it would lose the
 * agreement the source promised) and may not cross plural ↔ select (the two
 * demand different argument types, so one of the two locales would throw at
 * render time).
 */
function describeParams(params: ReadonlyMap<string, ArgumentKind>): string {
	if (params.size === 0) return "none";
	return [...params.entries()]
		.sort((left, right) => compare(left[0], right[0]))
		.map(([name, kind]) => `${name}:${kind}`)
		.join(", ");
}

for (const locale of localeNames) {
	const parsed = translationParams.get(locale);
	if (parsed === undefined) fail(`no parsed parameters for ${locale}`);
	for (const key of keys) {
		const source = messages.get(key) ?? new Map<string, ArgumentKind>();
		const target = parsed.get(key) ?? new Map<string, ArgumentKind>();
		const file = owner.get(key) ?? "(unknown file)";
		const missing = [...source.keys()]
			.filter((name) => !target.has(name))
			.sort(compare);
		const extra = [...target.keys()]
			.filter((name) => !source.has(name))
			.sort(compare);
		if (missing.length > 0 || extra.length > 0) {
			fail(
				`${locale}/${file}: ${key} does not carry the source's parameters — ` +
					`missing: ${missing.join(", ") || "none"}; ` +
					`unexpected: ${extra.join(", ") || "none"} ` +
					`(English: ${describeParams(source)}; ${locale}: ${describeParams(target)})`,
			);
		}
		for (const [name, kind] of target) {
			const sourceKind = source.get(name) ?? "text";
			if (kind === sourceKind) continue;
			const escalated =
				sourceKind === "text" && (kind === "plural" || kind === "select");
			if (escalated) continue;
			fail(
				`${locale}/${file}: ${key} uses {${name}} as ${kind} where the English ` +
					`source uses it as ${sourceKind}; a translation may turn a plain ` +
					`placeholder into plural/select (a locale whose noun inflects) but may ` +
					`not drop a plural or change one kind of argument into another`,
			);
		}
	}
}

/**
 * THE STRICTEST KIND WINS — the typing rule that stops a French plural becoming
 * a French-only crash.
 *
 * WHAT GOES WRONG WITHOUT IT. `MessageParams` used to be derived from English, so
 * `mobile.schedules.cadence.left`'s `{remaining}` was `string | number` and a
 * call site could pass `"3"`. English renders `… · 3 left` happily; the French
 * catalogue pluralizes the same name, and the renderer's `numericValue` refuses a
 * string with a `RangeError` — one language rendering and another throwing, from
 * the same call site. So the generated type is the strictest kind across the
 * SHIPPED locales (`number` for a plural, `string` for a select, `string | number`
 * only while every shipped reading is a plain placeholder). The type can only
 * tighten where a shipped catalogue earns it, and only a catalogue review can
 * loosen it.
 *
 * A DRAFTED (not-yet-shipped) locale is deliberately excluded: it is not rendered
 * by any build, so it must not break the app's call sites before it ships — and
 * the day it joins `SHIPPED_LOCALES`, tightening the type is the point.
 */
const shipped = new Set<string>(shippedLocales);
const absentShipped = shippedLocales.filter(
	(locale) => locale !== "en" && !localeNames.includes(locale),
);
if (absentShipped.length > 0) {
	fail(
		`SHIPPED_LOCALES names ${absentShipped.join(", ")} but ` +
			`src/i18n/catalogues/<tag>/ does not exist; the generated argument types ` +
			`would ignore that locale's plurals and the runtime would throw at import`,
	);
}

const strict = new Map<string, ReadonlyMap<string, ArgumentKind>>();
for (const key of keys) {
	const merged = new Map<string, ArgumentKind>(messages.get(key) ?? []);
	for (const locale of localeNames) {
		if (!shipped.has(locale)) continue;
		const params = translationParams.get(locale)?.get(key);
		if (params === undefined) continue;
		for (const [name, kind] of params) {
			const current = merged.get(name);
			if (current === undefined) {
				/* Unreachable while the name parity above holds, and a thrown
				 *  generation is still better than a silently narrower type. */
				fail(`${key}: ${locale} declares {${name}} which English does not`);
			}
			if (
				(current === "plural" && kind === "select") ||
				(current === "select" && kind === "plural")
			) {
				fail(
					`${key}: shipped locales disagree about the KIND of {${name}} ` +
						`(${current} vs ${kind}); one of them would throw at render time, ` +
						`so the argument cannot be typed`,
				);
			}
			if (KIND_ORDER[kind] > KIND_ORDER[current]) merged.set(name, kind);
		}
	}
	strict.set(key, merged);
}

/** Split by shape: `t()` uses these two unions as its overload domains, so a
 *  parameterless key cannot be called with arguments and a parameterised key
 *  cannot be called without them. */
const noParamKeys = keys.filter((key) => (strict.get(key)?.size ?? 0) === 0);

if (noParamKeys.length === keys.length) {
	fail("No message in the catalogues takes an argument; nothing to type");
}

const keyUnion = keys.map((key) => `\t| ${JSON.stringify(key)}`).join("\n");
const noParamUnion = noParamKeys
	.map((key) => `\t| ${JSON.stringify(key)}`)
	.join("\n");

const paramRows = keys
	.map((key) => {
		const params = strict.get(key);
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

/** One locale's whole catalogue, key-ordered exactly as the English source is, so
 *  a translation diff is a value change and never a reordering. */
const localeRows = localeNames
	.map((locale) => {
		const translated = translations.get(locale);
		if (translated === undefined) fail(`no projection for ${locale}`);
		const rows = keys
			.map((key) => {
				const value = translated.get(key);
				if (value === undefined) fail(`${locale}: no projection for ${key}`);
				return `\t\t${JSON.stringify(key)}: ${JSON.stringify(value)},`;
			})
			.join("\n");
		return `\t${JSON.stringify(locale)}: {\n${rows}\n\t},`;
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
 *    the same parse the renderer performs, so a key that is missing, misspelled
 *    or mistyped fails the build rather than rendering a wrong sentence. Both
 *    are read from the STRICTEST kind across the shipped locales (see the
 *    parity block in \`scripts/i18n/generate.ts\`): a French plural tightens an
 *    English plain placeholder to \`number\` here, so the one call site cannot
 *    pass a string that renders in English and throws in French.
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

/**
 * Every locale directory beside \`en/\`, projected from its JSON exactly as
 * written. \`Record<CatalogueKey, string>\` is a compile-time completeness check
 * as well as a type: a locale that loses a key stops compiling here, one step
 * before \`--check\` reports the same parity failure.
 *
 * The map is keyed by the directory name — the canonical BCP-47 tag — and is
 * UNFILTERED: it carries a locale whether or not \`SHIPPED_LOCALES\` in
 * \`src/i18n/locale.ts\` claims it, because "a translation exists" and "this
 * build renders it" are two decisions with two owners. \`catalogues.ts\` is where
 * the shipped set is applied.
 */
export const LOCALISED_MESSAGES: Readonly<
	Record<string, Readonly<Record<CatalogueKey, string>>>
> = {
${localeRows}
};
`;

const shippedTranslations = localeNames.filter((name) => shipped.has(name));

/** What one run reports: the key/namespace counts, and which translations were
 *  read as shipped (they are what the argument types are derived from). */
const summary =
	`${keys.length} keys, ${namespaces.length} namespaces, ` +
	`argument types from ${["en", ...shippedTranslations].join(", ")}`;

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
	console.log(`src/i18n/catalogue.gen.ts is current (${summary})`);
} else {
	writeFileSync(OUTPUT, output);
	console.log(`Wrote src/i18n/catalogue.gen.ts (${summary})`);
}
