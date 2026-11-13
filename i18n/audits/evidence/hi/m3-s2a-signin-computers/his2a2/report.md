# hi audit — M3 S2a round 2 (delta) — audit_id his2a2

Auditor: i18n-auditor (lopdev), session d94f1cd57c7d, model anthropic/claude-opus-5-5 (no fallback observed). Independent of translator (jobs 4753e146fd04/b4311682e916) and round-1 auditor (job 81e809611cf1). No MT service used. Source 59ec5184.

**Verdict: PASSED** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. Round-1 H1–H4 all resolved.

## Inputs (sha256 recomputed, all match)
- brief e64f41af7e262a49a92ddf6a2f9fe519bc046c771833ca58a2d622dfeeeba563
- v1 8f1e2d15f84028928eab1c04dcb6c356b9b3206d0c3e881f5d49ab954e12fce0
- v2 aadaa64be9fff741254607f7fa34c1aaf8145190844cdd509d75970f1362d30e

## Equality proof
v1 and v2: 37 keys each, same key set and order, none added/dropped; 33 values byte-identical; changed exactly the 4 keys the translator listed: `title.set_up`, `own_tunnel.intro`, `own_tunnel.step_computer_help`, `own_tunnel.insecure_off_help`.

## Mechanical (changed keys)
Tokens `{…}`, backticks, `http://`, `https://`, `Radient` identical to English (none in set_up; Radient in intro; http/https once each in insecure_off_help). NFC. `।` where English has `.`; no stop on the heading. Redaction hits: 0.

## Per-key rulings
- `mobile.computers.title.set_up` — `नया कंप्यूटर` → `कंप्यूटर जोड़ें`. **pass, resolves H2.** Imperative as the note asks, आप form; byte-identical to glossary `mobile.computers.add`, the button that opens this screen. "Add" narrows "Set up" slightly, but it matches the catalogue and reads naturally. Width: CoreText shaped line, KohinoorDevanagari-Semibold 28 pt, −0.02 em tracking = **123.7 dp vs ~226.2 budget** (≈55%). This is an estimate: it uses the iOS fallback font, because Figtree has no Devanagari. Android Noto not measured.
- `mobile.computers.own_tunnel.intro` — second `के ज़रिये` → `से`. **pass, resolves H3.** ज़रिये now appears once; `उसी पते से … जिसे` is a natural correlative; meaning unchanged.
- `mobile.computers.own_tunnel.step_computer_help` — `ऐप इस्तेमाल करते समय` → `ऐप का उपयोग करते समय`. **pass, resolves H4.** Postposition का correctly added; matches catalogue उपयोग (`wait.use_computer`).
- `mobile.computers.own_tunnel.insecure_off_help` — `जब भी पता इसे सपोर्ट करे, https:// का ही उपयोग करें` → `जब भी पता https:// सपोर्ट करे, उसी का उपयोग करें`. **pass, resolves H1.** The referent now comes before उसी, so it can no longer be misread as the http opt-in. Schemes are literal and LTR-safe. The off-by-default sentence is unchanged (accepted in round 1).

## Read route
Ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable.
