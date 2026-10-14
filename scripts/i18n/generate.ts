import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface Context {
	role: string;
	tone: string;
	length: string;
	note: string;
	params: Record<string, string>;
	placeholders: Record<string, string>;
}
export interface Sources {
	config: {
		enabledLocales: string[];
		namespaces: string[];
		locales: Record<string, { direction: string; hold?: string }>;
	};
	english: Record<string, string>;
	context: Record<string, Context>;
	catalogues: Record<string, Record<string, Record<string, string>>>;
}
const json = <T>(path: string): T =>
	JSON.parse(readFileSync(path, "utf8")) as T;
export function loadSources(root: string): Sources {
	const config = json<Sources["config"]>(join(root, "src/i18n/config.json"));
	const english: Sources["english"] = {};
	const context: Sources["context"] = {};
	const catalogues: Sources["catalogues"] = {};
	for (const namespace of config.namespaces) {
		Object.assign(
			english,
			json(join(root, `i18n/catalogues/en/${namespace}.json`)),
		);
		Object.assign(
			context,
			json(join(root, `i18n/catalogues/en/${namespace}.context.json`)),
		);
		for (const locale of config.enabledLocales) {
			const path = join(root, `i18n/catalogues/${locale}/${namespace}.json`);
			if (existsSync(path)) {
				catalogues[locale] ??= {};
				catalogues[locale][namespace] = json(path);
			}
		}
	}
	return { config, english, context, catalogues };
}
const KEY = /^mobile\.home\.[a-z][a-z0-9_]*$/;
const PARAM = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const TYPES: Record<string, string> = {
	string: "string",
	number: "number",
	date: "Date | number",
};
const sameKeys = (a: object, b: object) =>
	JSON.stringify(Object.keys(a).sort()) ===
	JSON.stringify(Object.keys(b).sort());
function requireRecord(
	value: unknown,
	label: string,
): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label}: expected object`);
}

/** Context is an explicit parameter schema, not an ICU parser. The mandatory
 * check.ts gate independently derives arguments from FormatJS's AST before CI
 * accepts these types. Keeping generation dependency-free makes drift/eligibility
 * checks usable on a checkout without installing the native app's dependency tree. */
export function validateSources(sources: Sources): void {
	const { config, english, context, catalogues } = sources;
	if (
		!Array.isArray(config.enabledLocales) ||
		!config.enabledLocales.includes("en") ||
		new Set(config.enabledLocales).size !== config.enabledLocales.length
	)
		throw new Error("enabledLocales must include en exactly once");
	if (JSON.stringify(config.namespaces) !== '["mobile.home"]')
		throw new Error(
			"only the owned mobile.home namespace is enabled in this seed",
		);
	requireRecord(english, "English source");
	requireRecord(context, "context");
	if (!sameKeys(english, context))
		throw new Error("source/context keys differ");
	for (const [key, text] of Object.entries(english)) {
		if (!KEY.test(key) || typeof text !== "string" || !text.trim())
			throw new Error(`invalid source ${key}`);
		const entry = context[key];
		requireRecord(entry, `context ${key}`);
		for (const field of ["role", "tone", "length", "note"] as const) {
			if (typeof entry[field] !== "string" || !entry[field].trim())
				throw new Error(`missing context ${field}: ${key}`);
		}
		requireRecord(entry.params, `params ${key}`);
		requireRecord(entry.placeholders, `placeholders ${key}`);
		if (!sameKeys(entry.params, entry.placeholders))
			throw new Error(`parameter schema and placeholder notes differ: ${key}`);
		for (const [name, type] of Object.entries(entry.params)) {
			if (
				!PARAM.test(name) ||
				!Object.hasOwn(TYPES, type) ||
				typeof entry.placeholders[name] !== "string" ||
				!entry.placeholders[name]?.trim()
			)
				throw new Error(`invalid parameter schema: ${key}.${name}`);
		}
	}
	for (const locale of config.enabledLocales) {
		const metadata = config.locales[locale];
		if (
			!metadata ||
			!["ltr", "rtl"].includes(metadata.direction) ||
			metadata.hold
		)
			throw new Error(`held or unknown enabled locale: ${locale}`);
		for (const namespace of config.namespaces) {
			const messages = catalogues[locale]?.[namespace];
			if (!messages)
				throw new Error(`missing enabled namespace: ${locale}/${namespace}`);
			for (const key of Object.keys(english)) {
				if (typeof messages[key] !== "string" || !messages[key]?.trim())
					throw new Error(`missing enabled key: ${locale}/${key}`);
			}
			if (!sameKeys(messages, english))
				throw new Error(`unexpected enabled key: ${locale}/${namespace}`);
		}
	}
}

export function generate(sources: Sources): string {
	validateSources(sources);
	const keys = Object.keys(sources.english).sort();
	const canonical = {
		config: sources.config,
		messages: keys.map((key) => [
			key,
			sources.english[key],
			sources.context[key],
		]),
	};
	const hash = createHash("sha256")
		.update(JSON.stringify(canonical))
		.digest("hex");
	const rows = keys.map((key) => {
		const params = Object.entries(sources.context[key]?.params ?? {}).sort(
			([a], [b]) => a.localeCompare(b),
		);
		const shape = params.length
			? `{ ${params.map(([name, type]) => `${JSON.stringify(name)}: ${TYPES[type]}`).join("; ")} }`
			: "undefined";
		return `\t${JSON.stringify(key)}: ${shape};`;
	});
	return [
		"// Generated by scripts/i18n/generate.ts. Do not edit; CI validates the ICU AST.",
		`// Source/context/config SHA-256: ${hash}`,
		"export interface MessageParams {",
		...rows,
		"}",
		"export type MessageKey = keyof MessageParams;",
		"export type NoParamsKey = {",
		"\t[K in MessageKey]: MessageParams[K] extends undefined ? K : never;",
		"}[MessageKey];",
		"export type WithParamsKey = Exclude<MessageKey, NoParamsKey>;",
		"export interface Translator {",
		"\t(key: NoParamsKey): string;",
		"\t<K extends WithParamsKey>(key: K, params: MessageParams[K]): string;",
		"}",
		"",
	].join("\n");
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const path = join(root, "src/i18n/keys.gen.ts");
	const result = generate(loadSources(root));
	if (process.argv.includes("--check")) {
		if (!existsSync(path) || readFileSync(path, "utf8") !== result)
			throw new Error(
				"generated i18n key map drift; run pnpm i18n:generate",
			);
		console.log(
			"i18n generation current (source/context schema; ICU AST check is separate)",
		);
	} else {
		writeFileSync(path, result);
		console.log("generated src/i18n/keys.gen.ts");
	}
}
