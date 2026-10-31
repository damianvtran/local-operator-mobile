import { readFileSync } from "node:fs";
import { formatMessage, parseMessage } from "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/messages.ts";
const root = "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/catalogues";
const en = JSON.parse(readFileSync(`${root}/en/mobile.library.json`, "utf8"));
const bidi = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c\u200b-\u200d\ufeff]/g;
for (const loc of ["ur", "hi"]) {
  const d = JSON.parse(readFileSync(`${root}/${loc}/mobile.library.json`, "utf8"));
  console.log(`== ${loc} keys=${Object.keys(d).length} sameKeys=${JSON.stringify(Object.keys(d).sort())===JSON.stringify(Object.keys(en).sort())}`);
  let bidiCount = 0;
  for (const [k, v] of Object.entries<string>(d)) {
    bidiCount += (v.match(bidi) || []).length;
    const sample = k.endsWith("tag_limit") ? [{limit:12},{limit:0},{limit:1},{limit:2},{limit:21}] : k.endsWith("filters_count") ? [{count:0},{count:1},{count:2},{count:21}] : [{}];
    for (const a of sample) console.log(k.replace("mobile.library.",""), JSON.stringify(a), "=>", formatMessage(parseMessage(v), a as any, loc));
  }
  console.log("bidi/zero-width controls:", bidiCount);
}
