import { readFileSync } from "node:fs";
import { formatMessage, parseMessage } from "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/messages.ts";
const c = JSON.parse(readFileSync("/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/catalogues/es/mobile.common.json", "utf8"));
for (const [k, v] of Object.entries<string>(c)) console.log(`${k.padEnd(26)} {} => ${formatMessage(parseMessage(v), {}, "es")}`);
