// Delta audit checker for es (M2 remediation 3af477ee..c4024b49).
// Uses ONLY the repo's shipping parser (src/i18n/messages.ts) — no reimplementation,
// no translation service, no back-translation.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseMessage, formatMessage } from "/Users/damian/local-operator-mobile/.worktrees/i18n-m2-scanner/src/i18n/messages.ts";

const WT = "/Users/damian/local-operator-mobile/.worktrees/i18n-m2-scanner";
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");

const FINAL = read(`${WT}/i18n/audits/evidence/es/m2-expression-literals/final.json`);
const keys = Object.keys(FINAL);
const byNs = {};
for (const k of keys) (byNs[k.split(".").slice(0, 2).join(".")] ??= []).push(k);

const loadLocale = (loc) => {
	const out = {};
	for (const [ns, ks] of Object.entries(byNs)) {
		const f = read(`${WT}/src/i18n/catalogues/${loc}/${ns}.json`);
		for (const k of ks) out[k] = f[k];
	}
	return out;
};
const en = loadLocale("en");
const es = loadLocale("es");
const sortedHash = (o) =>
	sha(JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))));

const DELTA = [
	"mobile.session.tray.context_short",
	"mobile.session.tray.context_short_estimate",
	"mobile.settings.diagnostics.stream_degraded",
];

let fails = 0;
const ok = (cond, msg) => {
	if (!cond) { fails++; console.log(`FAIL  ${msg}`); } else console.log(`ok    ${msg}`);
};

// --- hashes -------------------------------------------------------------
ok(keys.length === 33, `33 keys in the slice (got ${keys.length})`);
ok(sortedHash(en) === "c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528",
	`en 33 sorted-key hash = c326a93f… (${sortedHash(en)})`);
ok(sortedHash(es) === "987ad1d7457dfbf788d63c67ce77d4693cf79f397077806d4068d85da3422097",
	`es 33 sorted-key hash = 987ad1d7… (${sortedHash(es)})`);

// --- delta: byte-exact reuse of audited full forms / case-only change ----
ok(es["mobile.session.tray.context_short"] === es["mobile.session.tray.context"],
	`context_short === context byte-for-byte (${JSON.stringify(es["mobile.session.tray.context_short"])})`);
ok(es["mobile.session.tray.context_short_estimate"] === es["mobile.session.tray.context_estimate"],
	`context_short_estimate === context_estimate byte-for-byte (${JSON.stringify(es["mobile.session.tray.context_short_estimate"])})`);
const auditedDegraded = FINAL["mobile.settings.diagnostics.stream_degraded"];
ok(auditedDegraded === "No responde", `audited es value was "No responde" (${JSON.stringify(auditedDegraded)})`);
ok(es["mobile.settings.diagnostics.stream_degraded"] === "no responde" &&
	auditedDegraded.toLowerCase() === es["mobile.settings.diagnostics.stream_degraded"],
	`stream_degraded is the case-only lower-casing of the audited value (${JSON.stringify(es["mobile.settings.diagnostics.stream_degraded"])})`);

// --- placeholders: name AND kind identical to en (shipping parser) ------
const argsOf = (src) => {
	const p = parseMessage(src);
	return JSON.stringify(Object.fromEntries([...p.params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
};
for (const k of DELTA) {
	ok(argsOf(en[k]) === argsOf(es[k]), `${k}: arguments identical to en (${argsOf(es[k])})`);
}
ok(argsOf(es["mobile.session.tray.context_short"]) === '{"percent":"text"}',
	`{percent} parses as one text argument (${argsOf(es["mobile.session.tray.context_short"])})`);

// --- ICU: no plural/select in the delta; formatting renders cleanly -----
for (const k of DELTA) {
	const has = /\{\s*\w+\s*,\s*(plural|select)/.test(es[k]);
	ok(!has, `${k}: no plural/select arm (none in en either: ${!/\{\s*\w+\s*,\s*(plural|select)/.test(en[k])})`);
}
ok(formatMessage(parseMessage(es["mobile.session.tray.context_short"]), { percent: 21 }, "es") === "21% de contexto",
	`formats as "21% de contexto"`);
ok(formatMessage(parseMessage(es["mobile.session.tray.context_short"]), { percent: 100 }, "es") === "100% de contexto",
	`formats as "100% de contexto"`);
ok(formatMessage(parseMessage(es["mobile.session.tray.context_short_estimate"]), { percent: 7 }, "es") === "7% de contexto (aprox.)",
	`formats as "7% de contexto (aprox.)"`);

// --- structure/casing/typography rules from the sidecars ----------------
for (const k of DELTA) {
	const v = es[k];
	ok(v === v.trim(), `${k}: no edge whitespace`);
	ok(v === v.normalize("NFC"), `${k}: NFC`);
	ok(!/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/.test(v), `${k}: no bidi controls`);
	ok((v.match(/[()]/g) ?? []).length === (en[k].match(/[()]/g) ?? []).length, `${k}: parenthesis count matches en`);
	ok(v.endsWith(".") === en[k].endsWith("."), `${k}: terminal full stop matches en`);
	ok(!/ (\.|,|%;)/.test(v), `${k}: no stray space before punctuation`);
}
ok(/^[a-záéíóúñü]/.test(es["mobile.settings.diagnostics.stream_degraded"]),
	`stream_degraded starts lower-case (sidecar: "Lower-case diagnostic word")`);
ok(!es["mobile.settings.diagnostics.stream_degraded"].endsWith("."),
	`stream_degraded has no final full stop (sidecar)`);
ok(es["mobile.session.tray.context_short"].includes("de contexto") &&
	es["mobile.session.tray.context_short"].includes("contexto"),
	`"contexto" lower case (sidecar: 'Lower case "context"')`);

// --- no English left in the delta, and no "ctx" anywhere in the 33 es ---
const englishLeft = (v) => {
	// English tokens that are NOT Spanish and NOT sanctioned product names.
	// Placeholders are machine tokens (glossary §1) — strip {…} before scanning.
	const tokens = v.replace(/\{[^{}]*\}/g, " ").match(/[A-Za-z][A-Za-z.'’]*/g) ?? [];
	const allowed = new Set(["Local", "Operator", "Radient", "aprox"]);
	return tokens.filter((t) => !allowed.has(t.replace(/[.'’]+$/, "")) &&
		!["de", "contexto", "no", "responde"].includes(t.toLowerCase()));
};
for (const k of DELTA) ok(englishLeft(es[k]).length === 0, `${k}: no English token left (${JSON.stringify(englishLeft(es[k]))})`);
const ctxHits = keys.filter((k) => /\bctx\b/.test(es[k]));
ok(ctxHits.length === 0, `no es value in the 33 still contains "ctx" (${JSON.stringify(ctxHits)})`);

// --- negative control: the checker must BITE ----------------------------
console.log("\nnegative control (each mutation must be CAUGHT):");
const catches = [];
const mut = (label, k, value, test) => {
	const copy = { ...es, [k]: value };
	const caught = !test(copy);
	catches.push(caught);
	console.log(`${caught ? "CAUGHT " : "MISSED "} ${label}`);
};
// 1. the pre-remediation English token returns
mut("es context_short back to `{percent}% ctx`", "mobile.session.tray.context_short", "{percent}% ctx",
	(c) => !/\bctx\b/.test(c["mobile.session.tray.context_short"]) && englishLeft(c["mobile.session.tray.context_short"]).length === 0);
// 2. placeholder renamed
mut("placeholder renamed to {pct}", "mobile.session.tray.context_short", "{pct}% de contexto",
	(c) => argsOf(c["mobile.session.tray.context_short"]) === argsOf(en["mobile.session.tray.context_short"]));
// 3. placeholder dropped
mut("placeholder dropped", "mobile.session.tray.context_short", "de contexto",
	(c) => argsOf(c["mobile.session.tray.context_short"]) === argsOf(en["mobile.session.tray.context_short"]));
// 4. casing rule broken
mut("diagnostics value re-capitalised", "mobile.settings.diagnostics.stream_degraded", "No responde",
	(c) => /^[a-z]/.test(c["mobile.settings.diagnostics.stream_degraded"]));
// 5. NFC broken (delta-adjacent value from the same 33)
mut("Aún shipped NFD", "mobile.settings.status.no_connection", "A\u0301un sin conexión",
	(c) => c["mobile.settings.status.no_connection"] === c["mobile.settings.status.no_connection"].normalize("NFC"));
// 6. abbreviation parentheses dropped
mut("(aprox.) dropped", "mobile.session.tray.context_short_estimate", "{percent}% de contexto",
	(c) => (c["mobile.session.tray.context_short_estimate"].match(/[()]/g) ?? []).length &&
		c["mobile.session.tray.context_short_estimate"] !== c["mobile.session.tray.context_estimate"]);
// 7. trailing space
mut("trailing space", "mobile.session.tray.context_short", "{percent}% de contexto ",
	(c) => c["mobile.session.tray.context_short"] === c["mobile.session.tray.context_short"].trim());
ok(catches.every(Boolean), `all 7 negative-control mutations caught (${catches.filter(Boolean).length}/7)`);

console.log(`\n${fails === 0 ? "PASS" : "FAIL"} — ${fails} failing assertion(s)`);
process.exit(fails === 0 ? 0 : 1);
