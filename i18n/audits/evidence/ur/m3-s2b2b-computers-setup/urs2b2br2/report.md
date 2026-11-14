# ur round-2 delta audit — M3 S2b-2b (mobile.computers.setup / route_invalid / your_computer)

Auditor: i18n-auditor (lopdev), session c5f4eb470a3d, model anthropic/claude-opus-5-5 (session system-prompt model line; no fallback observed). Independent of translator (21e12a3778c1 / f866fbf7b531) and of the round-1 auditor session e12483c5cbc6.
Brief sha256 9b37cb3d…c67 ✔ · v1 aa7a5029…c121c63 ✔ · v2 7c089b93…9bb0 ✔ · redaction markers in brief: 0.
Scope: v1..v2 delta (3 keys) plus slice-wide mechanical/RTL re-checks on v2.

**Verdict: passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT (on the translator notes, not the catalogue).

## Delta integrity
- v1→v2 changes exactly the three keys the notes list: setup.address_help, route_invalid.not_address, route_invalid.insecure_off. Other 24 values and key order byte-identical (diff hunks only; remaining lines `cmp`-identical). 27 keys, brief order.
- Each changed value equals the round-1 suggested replacement verbatim.
- All 27 v2 values parse with messages.ts@e0027e61; placeholder sets equal English per key ({scheme} text in not_address; none in the other two changed keys). NFC; no Arabic ك/ي/ه.

## Round-1 findings
- UR-S2B2B-1 (MINOR, not_address) — RESOLVED. 'یہ کسی پتے جیسا نہیں لگتا' = "this doesn't look like an address"; oblique پتے before جیسا is correct; no longer collides with the idiom 'پتہ نہیں لگتا'.
- UR-S2B2B-2 (MINOR, address_help) — RESOLVED. 'پاس ورڈ کے ساتھ اس سے منسلک ہوں' removes the doubled سے; 'یہ طریقہ ایسی مشین کے لیے ہے جو Radient پر بالکل نہیں ہے' correctly says "this route is for a machine that isn't on Radient at all". طریقہ (m.) agrees with ہے; ایسی (f., مشین) agrees.
- UR-S2B2B-3 (NIT, insecure_off) — RESOLVED. 'سادہ http پتے کی اجازت والا اختیار' now tracks the visible switch label 'سادہ http:// پتے کی اجازت دیں' (own_tunnel.insecure_allow). Bare 'http' (no '://') is a single strong-L token; no isolate needed.

## RTL
- 0 bidi controls (U+200E/F, U+202A–E, U+2066–9, U+061C) in all 27 v2 values.
- Only Latin-initial value: setup.tui_label = "TUI".
- not_address {scheme} pattern: CoreText (base RTL) on the formatted string with scheme=https:// gives one L run 'https:// URL' between R runs; control 'یہ https:// سے…' splits '://' into an R run (displays //:https). '://' is a 3-char CS sequence → ON, neutral between L 'https' and L 'URL' → resolves L (UBA N1). Ordering correct.

## New findings (delta only)
- **UR-R2-N1 NIT** (notes-ur-v2.md, not a catalogue key): notes say "only lines 17, 19 and 24 of the 29-line file differ"; the actual 1-based lines are 18, 20 and 25 (diff `18c18 20c20 25c25`). The key names in the notes are correct, so no catalogue impact; fix the line numbers if the notes are retained as evidence.

No new findings on the three changed values. Execution log: audit.log (same directory).
