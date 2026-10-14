import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type MessageFormatElement,
	parse,
	TYPE,
} from "@formatjs/icu-messageformat-parser";

import { loadSources, type Sources, validateSources } from "./generate.ts";
import { checkHomeScope, HOME_KEYS } from "./scope.ts";

type Kind = "argument" | "string" | "number" | "date";
function argumentsOf(source: string, locale: string): Record<string, Kind> {
	const args: Record<string, Kind> = {};
	const add = (name: string, kind: Kind) => {
		const previous = args[name];
		if (
			previous &&
			previous !== kind &&
			previous !== "argument" &&
			kind !== "argument"
		)
			throw new Error(`conflicting ICU argument kinds: ${name}`);
		if (!previous || previous === "argument") args[name] = kind;
	};
	const visit = (nodes: MessageFormatElement[]) => {
		for (const node of nodes) {
			switch (node.type) {
				case TYPE.literal:
				case TYPE.pound:
					break;
				case TYPE.argument:
					add(node.value, "argument");
					break;
				case TYPE.number:
					add(node.value, "number");
					break;
				case TYPE.date:
				case TYPE.time:
					add(node.value, "date");
					break;
				case TYPE.select:
					add(node.value, "string");
					for (const option of Object.values(node.options)) visit(option.value);
					break;
				case TYPE.plural: {
					add(node.value, "number");
					const categories: readonly string[] = new Intl.PluralRules(locale, {
						type: node.pluralType,
					}).resolvedOptions().pluralCategories;
					for (const [selector, option] of Object.entries(node.options)) {
						if (!selector.startsWith("=") && !categories.includes(selector))
							throw new Error(`invalid ${locale} plural category: ${selector}`);
						visit(option.value);
					}
					break;
				}
				default:
					throw new Error(
						"rich-text tags are outside the mobile text-only ICU contract",
					);
			}
		}
	};
	visit(
		parse(source, { requiresOtherClause: true, shouldParseSkeletons: true }),
	);
	return args;
}

/** Always parse the real source and every enabled message; schema generation
 * alone is insufficient evidence of placeholder parity. No missing-dependency
 * fallback exists: CI must install the pinned parser or this gate fails. */
export function checkCatalogues(sources: Sources): void {
	validateSources(sources);
	for (const [key, source] of Object.entries(sources.english)) {
		const expected = sources.context[key]?.params ?? {};
		const check = (text: string, locale: string) => {
			const actual = argumentsOf(text, locale);
			if (
				JSON.stringify(Object.keys(actual).sort()) !==
				JSON.stringify(Object.keys(expected).sort())
			)
				throw new Error(`source/context params differ: ${locale}/${key}`);
			for (const [name, kind] of Object.entries(actual)) {
				if (kind !== "argument" && expected[name] !== kind)
					throw new Error(
						`source/context params kind differs: ${locale}/${key}.${name}`,
					);
			}
		};
		check(source, "en");
		for (const locale of sources.config.enabledLocales) {
			const namespace = key.slice(0, key.lastIndexOf("."));
			const text = sources.catalogues[locale]?.[namespace]?.[key];
			if (text === undefined)
				throw new Error(`missing enabled key: ${locale}/${key}`);
			check(text, locale);
		}
	}
	if (sources.english[HOME_KEYS.STARTING]?.includes("\n"))
		throw new Error("starting has a one-line layout constraint");
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const sources = loadSources(root);
	checkCatalogues(sources);
	if (JSON.stringify(sources.config.enabledLocales) !== '["en"]')
		throw new Error(
			"native seed is English-only; activation needs separate translation/audit/native gates",
		);
	if (
		JSON.stringify(Object.keys(sources.english).sort()) !==
		JSON.stringify(Object.values(HOME_KEYS).sort())
	)
		throw new Error("seed scope must remain exactly six Home keys");
	checkHomeScope({
		copy: readFileSync(join(root, "src/features/home/home-copy.ts"), "utf8"),
		splash: readFileSync(
			join(root, "src/features/home/home-splash.tsx"),
			"utf8",
		),
		home: readFileSync(join(root, "src/features/home/home.tsx"), "utf8"),
	});
	console.log(
		"i18n AST catalogues valid; six Home slots enforced; enabled locales: en only (not global enforcement)",
	);
}
