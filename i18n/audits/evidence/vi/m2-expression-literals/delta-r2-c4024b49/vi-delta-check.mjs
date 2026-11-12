/* vi delta audit — independent checker for the M2 expression-literal slice at
 * HEAD c4024b49. Imports the repo's SHIPPING parser (src/i18n/messages.ts) so
 * placeholder extraction is not a reimplementation. Read-only.
 *
 * Usage: node vi-delta-check.mjs <report|negative>
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const REPO = process.env.REPO;
const NS = ["mobile.computers", "mobile.session", "mobile.settings"];
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

async function loadParser() {
	// The shipping parser is plain TS; strip types with the Node 22+ built-in.
	const src = readFileSync(`${REPO}/src/i18n/messages.ts`, "utf8");
	const js = stripTypeScriptTypes(src, { mode: "transform" });
	const path = `${process.env.SCRATCH}/messages.stripped.mjs`;
	await import("node:fs").then((fs) => fs.writeFileSync(path, js));
	return import(path);
}

const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" });

function readAt(rev, path) {
	try {
		return JSON.parse(git(["show", `${rev}:${path}`]));
	} catch {
		return null;
	}
}
const readHead = (p) => JSON.parse(readFileSync(`${REPO}/${p}`, "utf8"));

const BASE = "fa2bc5e0";
const HEAD = "HEAD";

export function sliceKeys() {
	const keys = [];
	for (const ns of NS) {
		const p = `src/i18n/catalogues/en/${ns}.json`;
		const before = readAt(BASE, p) ?? {};
		const now = readHead(p);
		const added = Object.keys(now).filter((k) => !(k in before));
		const dropped = Object.keys(before).filter((k) => !(k in now));
		if (dropped.length) throw new Error(`en keys dropped in ${ns}: ${dropped}`);
		keys.push(...added);
	}
	return keys;
}

export function pairs(keys) {
	const en = {};
	const vi = {};
	for (const ns of NS) {
		const e = readHead(`src/i18n/catalogues/en/${ns}.json`);
		const v = readHead(`src/i18n/catalogues/vi/${ns}.json`);
		for (const k of Object.keys(e)) {
			if (!keys.includes(k)) continue;
			en[k] = e[k];
			vi[k] = v[k];
		}
	}
	return { en, vi };
}

const sortedJson = (o) =>
	JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

const PLACEHOLDER = /\{\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const argsOf = (msg) => {
	const set = new Set();
	for (const m of msg.matchAll(PLACEHOLDER)) set.add(m[1]);
	for (const m of msg.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\s*,/g)) set.add(m[1]);
	return [...set].sort();
};

export async function run({ mutate } = {}) {
	const P = await loadParser();
	const keys = sliceKeys();
	const { en, vi } = pairs(keys);
	const target = mutate ? mutate({ ...vi }) : vi;
	const findings = [];

	for (const k of keys) {
		const ev = en[k];
		const tv = target[k];
		if (typeof tv !== "string") {
			findings.push(`${k}: not a string (${typeof tv})`);
			continue;
		}
		if (tv.trim() !== tv || tv === "") findings.push(`${k}: edge whitespace/empty`);
		if (tv.normalize("NFC") !== tv) findings.push(`${k}: NOT NFC precomposed`);
		if (/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(tv))
			findings.push(`${k}: bidi control char`);
		const ea = argsOf(ev);
		const ta = argsOf(tv);
		if (ea.join(",") !== ta.join(","))
			findings.push(`${k}: placeholder drift en[${ea}] vi[${ta}]`);
		// ICU validity through the shipping parser.
		try {
			P.parseMessage(tv);
		} catch (e) {
			findings.push(`${k}: ICU parse failure: ${e.message}`);
		}
		// Glyph parity for the separators this slice uses.
		for (const g of ["·", "↑", "↓", "%"]) {
			const c = (s) => s.split(g).length - 1;
			if (c(ev) !== c(tv)) findings.push(`${k}: glyph '${g}' count ${c(tv)} vs en ${c(ev)}`);
		}
	}
	return { keys, en, vi, target, findings, P };
}

const mode = process.argv[2] ?? "report";
const out = await run();
const { keys, en, vi, findings, P } = out;

if (mode === "report") {
	console.log(`keys: ${keys.length}`);
	console.log(`per-namespace: ` + NS.map((n) => {
		const e = readHead(`src/i18n/catalogues/en/${n}.json`);
		return `${n}=${keys.filter((k) => k in e).length}`;
	}).join(" "));
	console.log(`vi hash  ${sha(sortedJson(vi))}`);
	console.log(`en hash  ${sha(sortedJson(en))}`);
	console.log(`findings ${findings.length}`);
	for (const f of findings) console.log("  " + f);
	// Placeholder kinds, from the shipping parser's own view.
	const typed = keys.filter((k) => argsOf(en[k]).length > 0);
	console.log(`parameterised keys: ${typed.length}`);
	for (const k of typed) console.log(`  ${k}: en[${argsOf(en[k])}] vi[${argsOf(vi[k])}]`);
	// plural/select anywhere in the slice?
	const icu = keys.filter((k) => /\{\s*\w+\s*,\s*(plural|select)/.test(en[k]));
	console.log(`plural/select keys: ${icu.length}${icu.map((k) => " " + k).join("")}`);
	// English-identical / Latin-token inventory
	for (const k of keys) {
		const latin = vi[k].match(/[A-Za-z][A-Za-z.]*/g) ?? [];
		if (latin.length) console.log(`latin  ${k} -> ${JSON.stringify(latin)}`);
	}
	// The three delta keys, byte-exact
	for (const k of [
		"mobile.session.tray.context_short",
		"mobile.session.tray.context_short_estimate",
		"mobile.settings.diagnostics.stream_degraded",
	]) console.log(`delta ${k} = ${JSON.stringify(vi[k])}`);
}

if (mode === "negative") {
	const cases = {
		"placeholder renamed": (m) => {
			m["mobile.session.tray.context_short"] = "{pct}% ngữ cảnh";
			return m;
		},
		"placeholder dropped": (m) => {
			m["mobile.session.tray.context_short"] = "% ngữ cảnh";
			return m;
		},
		"malformed ICU": (m) => {
			m["mobile.session.tray.context"] = "{percent% ngữ cảnh";
			return m;
		},
		"decomposed (NFD)": (m) => {
			m["mobile.session.tray.context_short"] = "{percent}% ngu\u0310\u0303 ca\u0309nh";
			return m;
		},
		"trailing space": (m) => {
			m["mobile.settings.diagnostics.stream_degraded"] = "không phản hồi ";
			return m;
		},
		"glyph dropped": (m) => {
			m["mobile.session.region.end"] = "hết · cuộn";
			return m;
		},
	};
	for (const [name, mutate] of Object.entries(cases)) {
		const r = await run({ mutate });
		console.log(`${r.findings.length ? "CAUGHT" : "MISSED"}  ${name}: ${r.findings.join(" | ")}`);
	}
}
