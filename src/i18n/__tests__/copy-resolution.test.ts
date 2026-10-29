import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * NO COPY MODULE MAY RESOLVE TEXT AT IMPORT TIME.
 *
 * `const GREETING = t("mobile.home.greeting")` evaluates `t` exactly once, when
 * the module is first imported. The relay owns the language and pushes it down
 * `/api/config/events` AFTER the app is running, so such a constant freezes
 * whichever language happened to be active at import — in practice English — and
 * a French reader keeps it for the life of the process. The remedy is a function
 * (`() => t(...)`), resolved per render, which is what every copy module does
 * today.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER. The defect is invisible to a rendering
 * test: by the time a test imports the module, the wrong value IS the module's
 * value, and it renders consistently. The mistake is only visible in the source —
 * whether the `t(` call sits inside a function body or in a top-level
 * initializer — so this reads the source.
 *
 * WHAT IT DOES: strip comments and string literals (so a mention in prose or a
 * message's own text cannot trip it), split the file into top-level statements,
 * and fail a statement that calls `t(` without a function (`=>` or `function`)
 * before the call. A statement like `export const X = flag ? t("a") : t("b")` is
 * flagged: both arms freeze. A call inside an IIFE
 * (`export const X = (() => t("a"))()`) is NOT flagged — the arrow is in the
 * statement — which is the one shape this does not see, and it is not a shape
 * anyone writes for copy. The negative controls below pin both readings.
 */
const PINNED_MODULES: ReadonlySet<string> = new Set([
	/* English-pinned ON PURPOSE: a plain-`node` CI proof
	 * (`scripts/ci/account-routing-*.ts`) imports this table without a runtime,
	 * so it must not depend on the locale source at all — and its own test asserts
	 * the table mirrors the English catalogue key for key. */
	"src/features/settings/account-routing-copy.ts",
]);

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Every copy module under `src/features`: the `*-copy.ts` family plus the two
 *  modules that build a NAMED table from the catalogue (`composer.ts` composes
 *  `composerCopy`, `health-copy.ts` composes `healthCopy`). Both were module-level
 *  tables once, and both froze English until a QA round caught the composer in a
 *  French build — the defect is the same shape whether the file is called
 *  `-copy` or not, so the scan follows the SHAPE, not the filename. */
const TABLE_MODULES = [
	"src/features/session/composer.ts",
	"src/features/session/health-copy.ts",
];

function copyModules(): string[] {
	const root = join(ROOT, "src", "features");
	return (readdirSync(root, { recursive: true, encoding: "utf8" }) as string[])
		.filter((name) => name.endsWith("-copy.ts"))
		.concat(TABLE_MODULES.map((rel) => rel.replace("src/features/", "")))
		.map((name) => relative(ROOT, join(root, name)).split("\\").join("/"))
		.filter((rel) => !PINNED_MODULES.has(rel))
		.sort();
}

/** Source with comments and string/template literals blanked out, so the scan
 *  below only ever sees code. Newlines are preserved to keep it readable in a
 *  failure message. */
function stripNonCode(source: string): string {
	let out = "";
	let index = 0;
	const blank = (chunk: string): string => chunk.replace(/[^\n]/g, " ");
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (char === "/" && next === "/") {
			const end = source.indexOf("\n", index);
			const stop = end === -1 ? source.length : end;
			out += " ".repeat(stop - index);
			index = stop;
			continue;
		}
		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", index);
			const stop = end === -1 ? source.length : end + 2;
			out += blank(source.slice(index, stop));
			index = stop;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			/* Consume to the matching quote. Escapes are handled so a `\"` inside
			 * a message cannot end the literal early. */
			let stop = index + 1;
			while (stop < source.length && source[stop] !== char) {
				stop += source[stop] === "\\" ? 2 : 1;
			}
			stop = Math.min(stop + 1, source.length);
			out += blank(source.slice(index, stop));
			index = stop;
			continue;
		}
		out += char;
		index += 1;
	}
	return out;
}

/** The module-scope `t()` calls in one source file, as their statement text. */
function moduleScopeCopies(source: string): string[] {
	const code = stripNonCode(source);
	const findings: string[] = [];
	let depth = 0;
	let start = 0;
	const statements: string[] = [];
	for (let index = 0; index < code.length; index += 1) {
		const char = code[index];
		if (char === "{" || char === "(" || char === "[") depth += 1;
		else if (char === "}" || char === ")" || char === "]") depth -= 1;
		else if (char === ";" && depth === 0) {
			statements.push(code.slice(start, index));
			start = index + 1;
		}
	}
	statements.push(code.slice(start));
	for (const statement of statements) {
		const call = /\bt\s*\(/.exec(statement);
		if (call === null) continue;
		const before = statement.slice(0, call.index);
		if (before.includes("=>") || /\bfunction\b/.test(before)) continue;
		findings.push(statement.trim().replace(/\s+/g, " ").slice(0, 80));
	}
	return findings;
}

describe("the import-time copy guard's own readings", () => {
	/* Negative controls: a scanner nobody tests is a scanner that quietly stops
	 * scanning. Each case is the shape it claims to see or to allow. */
	it.each([
		['export const GREETING = t("mobile.home.greeting");', 1],
		[
			'export const TIPS = [\n\tt("mobile.home.tip.a"),\n\tt("mobile.home.tip.b"),\n];',
			1,
		],
		['export const X = flag ? t("a") : t("b");', 1],
		['export const greeting = (): string => t("mobile.home.greeting");', 0],
		['export function greeting(): string {\n\treturn t("k");\n}', 0],
		[
			'// t("mobile.home.greeting") in a comment is not a call\nexport const A = 1;',
			0,
		],
		['export const A = "t(" + "still a string";', 0],
	] as const)("counts %#", (source, expected) => {
		expect(moduleScopeCopies(source)).toHaveLength(expected);
	});
});

describe("no copy module resolves its text at import time", () => {
	it("finds the copy modules it is meant to guard", () => {
		/* The list is read from disk rather than hand-written, so a new copy
		 * module is covered the day it lands — but a path typo that silently
		 * matched nothing would make every assertion below vacuous. */
		const modules = copyModules();
		expect(modules).toContain("src/features/home/home-copy.ts");
		expect(modules).toContain("src/features/projects/projects-copy.ts");
		expect(modules).toContain("src/features/schedules/schedules-copy.ts");
	});

	it.each(copyModules())("%s keeps its copy inside functions", (module) => {
		const source = readFileSync(join(ROOT, module), "utf8");
		expect(moduleScopeCopies(source)).toEqual([]);
	});
});
