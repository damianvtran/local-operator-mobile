// Renders every value of one locale through the repo's own parseMessage/formatMessage at its REAL arguments
// (limit=12 for editor.tag_limit - the app constant; count=1,2,5 for browse.filters_count) and prints RENDERED text.
import { readFileSync } from "node:fs";
import { formatMessage, parseMessage } from "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/messages.ts";
const root = "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/catalogues";
const loc = process.argv[2];
const d = JSON.parse(readFileSync(`${root}/${loc}/mobile.library.json`, "utf8"));
const repl: Record<string, string> = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : {};
for (const [k, v] of Object.entries<string>(d)) {
  const short = k.replace("mobile.library.", "");
  const argsets = k.endsWith("tag_limit") ? [{ limit: 12 }] : k.endsWith("filters_count") ? [{ count: 1 }, { count: 2 }, { count: 5 }] : [{}];
  for (const a of argsets) {
    const out = formatMessage(parseMessage(v), a as any, loc);
    console.log(`${short.padEnd(32)} ${JSON.stringify(a).padEnd(12)} => ${out}`);
    if (repl[k]) console.log(`${"".padEnd(32)} ${"REPLACEMENT".padEnd(12)} => ${formatMessage(parseMessage(repl[k]), a as any, loc)}`);
  }
}
