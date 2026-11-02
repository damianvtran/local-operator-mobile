// Renders every value of one locale through the repo's own parseMessage/formatMessage at its REAL arguments
// (limit=12 for editor.tag_limit - the app constant MAX_ASSET_TAGS; count=1,2,5 for browse.filters_count).
import { readFileSync } from "node:fs";
import { formatMessage, parseMessage } from "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/messages.ts";
const root = "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/catalogues";
const loc = process.argv[2];
const d = JSON.parse(readFileSync(`${root}/${loc}/mobile.library.json`, "utf8"));
const c = JSON.parse(readFileSync(`${root}/${loc}/mobile.common.json`, "utf8"));
for (const [k, v] of Object.entries<string>(d)) {
  const short = k.replace("mobile.library.", "");
  const argsets = k.endsWith("tag_limit") ? [{ limit: 12 }] : k.endsWith("filters_count") ? [{ count: 1 }, { count: 2 }, { count: 5 }] : [{}];
  for (const a of argsets) console.log(`${short.padEnd(28)} ${JSON.stringify(a).padEnd(12)} => ${formatMessage(parseMessage(v), a as any, loc)}`);
}
console.log("-- mobile.common (the six chrome verbs the Library screens render)");
for (const [k, v] of Object.entries<string>(c)) console.log(`${k.padEnd(28)} ${"{}".padEnd(12)} => ${formatMessage(parseMessage(v), {}, loc)}`);
