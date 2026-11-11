# hi — M2 round-3 delta audit (hi.final.json, 33 keys)
Auditor: i18n-auditor m2-a3-hi, ACTUAL model anthropic/claude-sonnet-5-5. Date 2026-11-11. No edits, no MT.

Verdict: CLEAN. BLOCKER 0, MAJOR 0, MINOR 0, NIT 0.

1. Delta (python dict diff v3→final): exactly 3 value changes (stream_degraded, context_short, context_short_estimate) + 4 renames label.X→label_X (values identical). hi.final == hi.v4. Nothing else.
2. Changed values:
 - stream_degraded `बाधित` (3 cells): one word, distinct from the 4 siblings (आइडल/कनेक्ट हो रहा/ऑनलाइन/ऑफ़लाइन; 5 distinct values) and from the status pill `उत्तर नहीं दे रहा` (collapse removed). Not attested elsewhere in corpus (0 hits) — plain standard Hindi, acceptable.
 - context_short `{percent}% संद॰` 7/8 cells (42%/100%) vs full `संदर्भ` 8/9; context_short_estimate 14/15 vs wide 16/17 (rich cell_len). Genuinely narrower. U+0970 confirmed = same sign as shipped formatter data (formats.json `अक्टू॰`) and style guide line 60; no ASCII `संद.` remains.
3. Mechanical (all 33): key order == keys33.final.json; placeholders per key == sidecar; no empties/stray spaces; all NFC; `{percent}` kept; parentheses kept; no plural/select in slice.
   Region keys match shipped English catalogue (i18n-m2-scanner@9d99fa0f en/mobile.session.json:58-61).
4. Round-2 items: BLOCKER (region key names) RESOLVED; MAJOR H-D-03 RESOLVED (बाधित); MINOR H-D-02 RESOLVED (संद॰).
Caveat: widths are terminal cell-model, not native render.
