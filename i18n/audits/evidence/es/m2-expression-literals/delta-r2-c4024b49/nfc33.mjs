import { readFileSync } from "node:fs";
const WT="/Users/damian/local-operator-mobile/.worktrees/i18n-m2-scanner";
const read=p=>JSON.parse(readFileSync(p,"utf8"));
const fin=read(`${WT}/i18n/audits/evidence/es/m2-expression-literals/final.json`);
const ns=[...new Set(Object.keys(fin).map(k=>k.split(".").slice(0,2).join(".")))];
const load=l=>{const o={};for(const n of ns){const f=read(`${WT}/src/i18n/catalogues/${l}/${n}.json`);for(const k of Object.keys(fin)) if(k.startsWith(n+".")) o[k]=f[k];}return o;};
for (const loc of ["en","es"]) {
  const d=load(loc); let bad=[];
  for (const [k,v] of Object.entries(d)) {
    if (v!==v.normalize("NFC")) bad.push([k,"NFD"]);
    if (/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/.test(v)) bad.push([k,"bidi"]);
    if (v!==v.trim()) bad.push([k,"edge-ws"]);
  }
  console.log(`${loc}: ${Object.keys(d).length} values, NFC/bidi/edge-whitespace problems: ${bad.length}`, bad);
  console.log(`  distinct non-ASCII code points:`, [...new Set([...Object.values(d)].join("").split("").filter(c=>c.codePointAt(0)>126))].map(c=>`${c}=U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(" "));
}
