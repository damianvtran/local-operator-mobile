#!/usr/bin/env node
/**
 * The desktop palettes, exported as data and pinned by hash.
 *
 *     node design/themes/export-desktop-palettes.mjs --from ~/local-operator-ui --ref <commit>
 *         # (re)write desktop-palettes.json and its lock from a local checkout
 *     node design/themes/export-desktop-palettes.mjs --check
 *         # prove the vendored copy is still the desktop's, byte for byte
 *
 * WHY A VENDORED COPY. The desktop app (`damianvtran/local-operator-ui`,
 * `src/renderer/src/shared/themes`) is the source of truth for every theme the
 * product ships: its 59 definitions were re-lit on 2026-11-03 and the mobile
 * relay's 31 copies have already drifted from them (decision record
 * `mobile-design-direction.md` § 5, "only 3 of 31 are byte-identical"). The
 * long-term home for this data is the design kit's `app-family.json`; until a
 * kit release carries it, this repository pins an exported slice with the same
 * discipline as `design-kit.lock.json` (ADR 0007 § Decision 2): the export is a
 * deterministic function of the pinned source files, and the check re-runs that
 * function on the files fetched from GitHub at the pinned commit. When the kit
 * adopts the palettes, this file and its lock are deleted in favour of the kit
 * pin — nothing else reads them except `scripts/build-theme.ts` and the
 * contrast contract.
 *
 * WHY IMPORT RATHER THAN PARSE. Each palette module is TypeScript whose only
 * import is `import type`, so Node's native type stripping can evaluate it as
 * is (the kit's own extractor does the same). Reading the values by evaluating
 * the module means a comment, a trailing comma or a reordered key can never be
 * mis-read as a colour, which a regex over the source could.
 *
 * Constraints: plain `node` >= 22.18 (type stripping on by default; CI runs 24),
 * no dependencies, so the design job can run it without `pnpm install`. The
 * check needs the network (anonymous raw.githubusercontent.com; the desktop
 * repository is public, so it is fork-safe and carries no credential).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const here = new URL(".", import.meta.url);
const EXPORT = new URL("desktop-palettes.json", here);
const LOCK = new URL("desktop-palettes.lock.json", here);
const REPO = "damianvtran/local-operator-ui";
const THEMES_DIR = "src/renderer/src/shared/themes";
/* `index.ts` is pinned for ONE fact: the `definitions` order, which is the
 * desktop picker's family order and the order the phone's picker keeps
 * (record § 5, "keep the desktop's family order"). */
const INDEX = `${THEMES_DIR}/index.ts`;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Every palette module under `palettes/`, by the names `index.ts` imports.
 *  Reading the list from the index rather than a directory listing means a
 *  file the desktop does not register is not exported either. */
const paletteFiles = (indexSource) => {
	const files = new Map();
	const importLine =
		/import\s*\{([^}]+)\}\s*from\s*"\.\/palettes\/([a-z0-9-]+)";/g;
	for (const match of indexSource.matchAll(importLine)) {
		for (const name of match[1].split(",").map((s) => s.trim()))
			if (name) files.set(name, `${THEMES_DIR}/palettes/${match[2]}.ts`);
	}
	return files;
};

/** The `definitions` array's identifiers, in order. */
const definitionOrder = (indexSource) => {
	const block = indexSource.match(
		/const definitions:[^=]*=\s*\[([\s\S]*?)\];/,
	);
	if (!block) throw new Error(`${INDEX}: no \`definitions\` array found`);
	return block[1]
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
};

/**
 * The export: a pure function of the pinned files' bytes.
 *
 * `read(path)` returns one source file's text at the pinned commit; the local
 * export reads through `git show`, the check through an HTTPS fetch, and both
 * then go through this same function, which is what makes "the vendored copy
 * equals the desktop" a byte comparison rather than a judgement.
 */
const extract = async (read, ref, commitDate) => {
	const indexSource = await read(INDEX);
	const files = paletteFiles(indexSource);
	const order = definitionOrder(indexSource);
	const sources = { [INDEX]: indexSource };
	for (const path of new Set(files.values())) sources[path] = await read(path);

	const work = mkdtempSync(join(tmpdir(), "lo-desktop-palettes-"));
	try {
		const modules = new Map();
		for (const path of new Set(files.values())) {
			const target = join(work, path);
			mkdirSync(join(target, ".."), { recursive: true });
			writeFileSync(target, sources[path]);
			modules.set(path, await import(pathToFileURL(target).href));
		}
		const palettes = order.map((name) => {
			const path = files.get(name);
			if (!path) throw new Error(`${name} is in \`definitions\` but not imported`);
			const definition = modules.get(path)[name];
			if (!definition?.palette)
				throw new Error(`${path} does not export a definition named ${name}`);
			return {
				id: definition.id,
				name: definition.name,
				mode: definition.palette.mode,
				values: Object.fromEntries(
					Object.entries(definition.palette).filter(([k]) => k !== "mode"),
				),
			};
		});
		const payload = {
			$meta: {
				source: `https://github.com/${REPO}/tree/${ref}/${THEMES_DIR}`,
				ref,
				commitDate,
				generatedBy: "design/themes/export-desktop-palettes.mjs",
				note: "Generated, never hand-edited: values are the desktop's palette modules evaluated under Node type stripping, in the desktop `definitions` order. `--check` re-derives this file from the pinned sources fetched from GitHub.",
			},
			palettes,
		};
		return {
			json: `${JSON.stringify(payload, null, "\t")}\n`,
			sources: Object.fromEntries(
				Object.entries(sources)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([path, text]) => [path, sha256(text)]),
			),
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
};

const args = process.argv.slice(2);
const flag = (name) => {
	const at = args.indexOf(name);
	return at === -1 ? undefined : args[at + 1];
};

if (args.includes("--check")) {
	const lock = JSON.parse(readFileSync(LOCK, "utf8"));
	const vendored = readFileSync(EXPORT, "utf8");
	const problems = [];
	if (sha256(vendored) !== lock.export.sha256)
		problems.push(
			`desktop-palettes.json does not match its lock — sha256 ${sha256(vendored)}, lock ${lock.export.sha256}. It was edited by hand; re-export instead.`,
		);
	const base = `https://raw.githubusercontent.com/${lock.repo}/${lock.ref}`;
	const fetched = {};
	const read = async (path) => {
		const res = await fetch(`${base}/${path}`, {
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}/${path}`);
		fetched[path] = await res.text();
		return fetched[path];
	};
	let rebuilt;
	try {
		rebuilt = await extract(read, lock.ref, lock.commitDate);
	} catch (err) {
		problems.push(
			`could not re-derive from ${lock.repo}@${lock.ref}: ${err.message} — this check needs the network`,
		);
	}
	if (rebuilt) {
		for (const [path, hash] of Object.entries(lock.files))
			if (rebuilt.sources[path] !== hash)
				problems.push(
					`${path}: upstream at ${lock.ref} hashes ${rebuilt.sources[path] ?? "(missing)"}, the lock says ${hash}`,
				);
		for (const path of Object.keys(rebuilt.sources))
			if (!(path in lock.files))
				problems.push(`${path}: imported upstream but not pinned in the lock`);
		if (rebuilt.json !== vendored)
			problems.push(
				`desktop-palettes.json is not the export of ${lock.repo}@${lock.ref} — re-run with --from`,
			);
	}
	if (problems.length) {
		for (const p of problems) console.error(`FAIL  ${p}`);
		process.exit(1);
	}
	const count = JSON.parse(vendored).palettes.length;
	console.log(
		`desktop palettes: ${count} palettes == export of ${lock.repo}@${lock.ref.slice(0, 12)} (${Object.keys(lock.files).length} source files, sha256-pinned)`,
	);
	process.exit(0);
}

const from = flag("--from");
const ref = flag("--ref");
if (!from || !ref) {
	console.error(
		"usage: export-desktop-palettes.mjs --from <local-operator-ui checkout> --ref <commit>  |  --check",
	);
	process.exit(2);
}
const git = (...a) => execFileSync("git", ["-C", from, ...a], { encoding: "utf8" });
const commit = git("rev-parse", `${ref}^{commit}`).trim();
const commitDate = git("show", "-s", "--format=%cs", commit).trim();
const { json, sources } = await extract(
	async (path) => git("show", `${commit}:${path}`),
	commit,
	commitDate,
);
writeFileSync(EXPORT, json);
writeFileSync(
	LOCK,
	`${JSON.stringify(
		{
			repo: REPO,
			ref: commit,
			commitDate,
			algorithm: "sha256",
			note: "A pin bump is deliberate: re-run `node design/themes/export-desktop-palettes.mjs --from <checkout> --ref <commit>`, then `pnpm theme:build`, and review the contrast contract's fleet section. `--check` proves export == f(upstream files at ref) and the hashes below.",
			files: sources,
			export: { path: "design/themes/desktop-palettes.json", sha256: sha256(json) },
		},
		null,
		"\t",
	)}\n`,
);
console.log(
	`wrote desktop-palettes.json (${JSON.parse(json).palettes.length} palettes) and its lock at ${commit}`,
);
