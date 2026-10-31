// Renders each prescribed replacement through the repo's own parseMessage/formatMessage and
// applies the same hygiene checks as the audited values (no bidi controls, locale full stop kept).
import { readFileSync } from "node:fs";
import { formatMessage, parseMessage } from "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/messages.ts";
const root = "/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave/src/i18n/catalogues";
const loc = process.argv[2];
const repl: Record<string, Record<string, string>> = {
  ur: {
    "mobile.library.detail.seen_in": "ان گفتگوؤں میں دیکھا گیا",
    "mobile.library.editor.new_tag_placeholder": "topic-name",
    "mobile.library.browse.no_tags": "ابھی کوئی ٹیگ نہیں۔ Librarian اثاثے منظم کرتے وقت ٹیگ شامل کرتی ہے۔",
    "mobile.library.editor.tag_limit": "ایک اثاثے پر ٹیگز کی حد {limit} ہے۔",
  },
  hi: {
    "mobile.library.editor.description": "विवरण",
    "mobile.library.detail.missing_file": "यह फ़ाइल ले जाई गई है या हटा दी गई है। इसका नाम, टैग और विवरण अब भी यहाँ हैं।",
    "mobile.library.editor.new_tag_placeholder": "topic-name",
    "mobile.library.editor.discard_title": "बदलाव छोड़ें?",
  },
};
const cur = JSON.parse(readFileSync(`${root}/${loc}/mobile.library.json`, "utf8"));
const bidi = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c\u200b-\u200d\u2060\ufeff]/;
for (const [k, v] of Object.entries(repl[loc])) {
  console.log(`${k}\n  before: ${formatMessage(parseMessage(cur[k]), k.endsWith("tag_limit") ? {limit: 12} : {}, loc)}\n  after : ${formatMessage(parseMessage(v), k.endsWith("tag_limit") ? {limit: 12} : {}, loc)}\n  bidi-controls-in-replacement: ${bidi.test(v) ? "YES" : "0"}`);
}
