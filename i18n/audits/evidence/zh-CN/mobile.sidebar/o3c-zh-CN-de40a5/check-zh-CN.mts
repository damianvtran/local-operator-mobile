// O3-c zh-CN audit checker (read-only). Imports the repo's own parseMessage/formatMessage.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
const WT = "/Users/damian/local-operator-mobile/.worktrees/i18n-m3-s2a";
const { parseMessage, formatMessage } = await import(`${WT}/src/i18n/messages.ts`);
const DRAFT = "/Users/damian/.local-operator/sessions/702e8c7d168e/scratchpad/o3c/draft-zh-CN.json";
const BRIEF = "/Users/damian/.local-operator/sessions/162198c78bcb/scratchpad/o3c-translation-brief.json";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const draftRaw = readFileSync(DRAFT); const briefRaw = readFileSync(BRIEF);
console.log("draft sha256", sha(draftRaw), "expected c019694104901cbe725aad4c997224898e6757a8ea0145bde00dfc459acc5912");
console.log("brief sha256", sha(briefRaw), "expected e88beb09366b9ff795bf0ac916f30cef1c9a93c35fa4617575e904c7a6f5fd17");
const draft = JSON.parse(draftRaw.toString()); const brief = JSON.parse(briefRaw.toString());
const enText = execSync(`git -C ${WT} show e7ebc391:src/i18n/catalogues/en/mobile.sidebar.json`).toString();
const ctxText = execSync(`git -C ${WT} show e7ebc391:src/i18n/catalogues/en/mobile.sidebar.context.json`).toString();
console.log("en sha256", sha(enText), "brief says", brief.english_files["src/i18n/catalogues/en/mobile.sidebar.json"].sha256);
console.log("context sha256", sha(ctxText), "brief says", brief.english_files["src/i18n/catalogues/en/mobile.sidebar.context.json"].sha256);
const en = JSON.parse(enText);
const briefKeys: string[] = brief.keys.map((k: any) => k.key);
const draftKeys = Object.keys(draft.values);
console.log("keys missing", briefKeys.filter((k) => !draftKeys.includes(k)), "extra", draftKeys.filter((k) => !briefKeys.includes(k)), "count", draftKeys.length);
for (const k of briefKeys) if (en[k] !== brief.keys.find((x: any) => x.key === k).english) console.log("BRIEF/EN MISMATCH", k);
const shape = (src: string) => {
  const p = parseMessage(src);
  const arms: string[] = [];
  const walk = (nodes: any[]) => { for (const n of nodes) { if (n.options) { arms.push(`${n.name}:${Object.keys(n.options instanceof Map ? Object.fromEntries(n.options) : n.options).sort().join("|")}`); for (const v of (n.options instanceof Map ? n.options.values() : Object.values(n.options))) walk(v as any[]); } } };
  walk(p.nodes as any[]);
  return { params: JSON.stringify([...p.params.entries()].sort()), arms: arms.join(";") };
};
const cells = (s: string) => [...s].reduce((a, c) => a + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1), 0);
let fails = 0;
for (const k of briefKeys) {
  const zh = draft.values[k]; const s = brief.keys.find((x: any) => x.key === k);
  let a, b;
  try { a = shape(en[k]); b = shape(zh); } catch (e) { console.log("PARSE FAIL", k, String(e)); fails++; continue; }
  const ok = a.params === b.params && a.arms === b.arms;
  if (!ok) fails++;
  const nfc = zh === zh.normalize("NFC");
  const sample = formatMessage(parseMessage(zh), { kind: "approval", device: "Studio Mac" }, "zh-CN");
  console.log(`${k}: ${JSON.stringify(zh)} params ${b.params} arms ${b.arms || "-"} ${ok ? "MATCH" : "MISMATCH en " + JSON.stringify(a)} nfc ${nfc} | sample ${JSON.stringify(sample)} ${[...sample].length}ch/${cells(sample)}c hint ${s.width_hint_chars}ch | trail-punct ${/[。，、：；！？.,!?:;]$/.test(zh)} lead/trail-space ${zh !== zh.trim()}`);
}
const w = parseMessage(draft.values["mobile.sidebar.row_label.waiting"]);
console.log("waiting other-arm render:", JSON.stringify(formatMessage(w, { kind: "question" }, "zh-CN")), "| unknown kind:", JSON.stringify(formatMessage(w, { kind: "zzz" }, "zh-CN")));
// negative controls: the checker must catch these
const neg: Record<string, string> = {
  renamed_arg: "{type, select, approval {等待你批准} other {等待你回答问题}}",
  dropped_other: "{kind, select, approval {等待你批准}}",
  renamed_placeholder: "在 {设备} 上",
  dropped_placeholder: "在设备上",
  unbalanced: "{kind, select, approval {等待你批准} other {等待你回答问题}",
};
const ctl: Record<string, string> = { renamed_arg: "mobile.sidebar.row_label.waiting", dropped_other: "mobile.sidebar.row_label.waiting", renamed_placeholder: "mobile.sidebar.row_label.on_device", dropped_placeholder: "mobile.sidebar.row_label.on_device", unbalanced: "mobile.sidebar.row_label.waiting" };
let caught = 0;
for (const [n, src] of Object.entries(neg)) {
  let hit = false; try { const b = shape(src), a = shape(en[ctl[n]]); hit = a.params !== b.params || a.arms !== b.arms; } catch { hit = true; }
  console.log("negative control", n, hit ? "CAUGHT" : "MISSED"); if (hit) caught++;
}
console.log(`negative controls ${caught}/${Object.keys(neg).length}; real mismatches ${fails}`);
const pat = new RegExp(brief.redaction_scan.pattern.replace("(?i)", ""), "gi");
const briefNoPattern = JSON.stringify({ ...brief, redaction_scan: { ...brief.redaction_scan, pattern: "<excluded>" } });
console.log("redaction hits: draft", (draftRaw.toString().match(pat) || []).length, "| en", (enText.match(pat) || []).length, "| context", (ctxText.match(pat) || []).length, "| brief excl. pattern field", (briefNoPattern.match(pat) || []).length);
// assembled screen-reader label (mirrors rowAccessibilityLabel's ', ' join)
const t = (k: string, a: any = {}) => formatMessage(parseMessage(draft.values[k]), a, "zh-CN");
console.log("label sample:", ["支付对账", t("mobile.sidebar.row_label.waiting", { kind: "approval" }), t("mobile.sidebar.row_label.on_device", { device: "Studio Mac" }), t("mobile.sidebar.row_status.not_reachable"), t("mobile.sidebar.row_label.open")].join(", "));
