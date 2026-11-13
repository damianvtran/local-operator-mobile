# hi — M3 S2b-1 — round 2 delta re-audit `hiS2b1r2`

**Verdict: PASS (`passed`).** 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT (HIR2-N1, non-gating). Open device-verification row: HIS2B1-06 (carried, not a failure).

- **Auditor:** i18n-auditor (team lopdev), session b95f4f7d65fe. **Model (actual):** anthropic/claude-opus-5-5 (session runtime header); no fallback observed.
- **Independence:** not the translator (jobs 1cd7f1f0d760 v1 / 7c5a1c345ae8 v2), not the round-1 auditor (job d41ab7e9ec52, session 3c631e8c8e6f).
- **Source:** 254e6fba on feat/i18n-m3-s2b1 (worktree HEAD verified).
- **Hashes recomputed, all MATCH:** brief d694b10a…88e9; v1 2ff6e86a…2d8c; v2 fdcad45b…c6a1. Notes-v2 92a0d635…21dd; round-1 record f9f9afea…e367; report 58382cb3…0d85c.
- **Read route:** ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable.
- **Redaction hits:** 0 in v1/v2. No MT/translation service used.

## Mechanical — PASS (executed; audit.log)
- 41/41/41 keys, v1 and v2 both in brief order. Changed = exactly the 7 keys in notes-hi-v2 (`changed==notes true`); other 34 byte-identical.
- Each changed value parses with repo `parseMessage` (src/i18n/messages.ts, node heap 256 MB); placeholder name/type sets equal English (`address`/text, `label`/text, else none); `#` counts 0=0; no plurals among changed keys; no bidi/zero-width controls. Negative controls (3 malformed) throw RangeError.

## Per-key judgement (changed keys)
| Key | v2 | Result |
|---|---|---|
| mobile.common.copy_command_hint | “{label}” वाली कमांड कॉपी करता है | PASS — curly quotes match catalogue convention (relay.health, mobile.home); reads well for both imperative labels (“कंप्यूटर पर इंस्टॉल करें”) and product names (“ngrok”). No full stop, per note. |
| own_tunnel.rotate_note | …पासवर्ड टर्मिनल में आपसे पूछती है…प्रोसेस लिस्ट… | PASS — conveys "interactively" concretely; loan pair consistent. |
| own_tunnel.verdict_forbidden | …कोई ऐक्सेस पॉलिसी… | PASS — only change is spelling, now matches catalogue majority (billing_help, billing_inactive). Polarity unchanged. |
| own_tunnel.verdict_refused | …लेकिन ऐसा जवाब नहीं जिसे यह ऐप समझ सके। | PASS — correlative fixed, natural. |
| own_tunnel.password_slot_other | यह फ़ोन सिर्फ़ एक…नया पासवर्ड पुराने की जगह ले लेगा। | PASS — "one" unambiguous; replacement subject explicit. |
| settings.own_tunnel.runtime_body | …टनल सिर्फ़ ऐप के इस बार चलने तक रहती है। फ़ोन पर इसे… | PASS — natural, keeps "this run only"; टनल f. agreement correct. |
| settings.own_tunnel.remove_body | इससे इस फ़ोन पर सहेजे गए पता और पासवर्ड, दोनों हट जाते हैं। … | PASS with NIT HIR2-N1 — verb agreement fixed; scope "on this phone" kept. |

### HIR2-N1 — NIT — `mobile.settings.own_tunnel.remove_body`
- Current: इससे इस फ़ोन पर सहेजे गए पता और पासवर्ड, दोनों हट जाते हैं।
- Problem: attributive participle before coordinated singular nouns more naturally agrees with the nearest conjunct (`सहेजा गया पता और पासवर्ड`); `सहेजे गए पता` grates slightly. Meaning is clear; optional.
- Suggested: इससे इस फ़ोन पर सहेजा गया पता और पासवर्ड, दोनों हट जाते हैं।

## Round-1 finding rulings
| ID | Disposition | Ruling |
|---|---|---|
| HIS2B1-01 | accepted | RESOLVED (verbatim suggestion). |
| HIS2B1-02 | accepted | RESOLVED (verbatim). |
| HIS2B1-03 | accepted, own wording | RESOLVED — plural agreement fixed; translator's wording keeps the "saved on this phone" scope, acceptable over round-1 text; residual NIT HIR2-N1 only. |
| HIS2B1-04 | accepted | RESOLVED (verbatim). |
| HIS2B1-05 | accepted | RESOLVED (verbatim). |
| HIS2B1-06 | kept as drafted | ACCEPTABLY KEPT — key unchanged (byte-identical); carried as OPEN device-verification row: confirm सेटिंग्ज़ → गोपनीयता और सुरक्षा → स्थानीय नेटवर्क on a Hindi-locale iPhone before release. Not a failure. |
| HIS2B1-N1 | accepted | RESOLVED. |
| HIS2B1-N2 | accepted | RESOLVED (verbatim). |

## Claims not made
No re-audit of the 34 unchanged keys beyond byte equality; no device check; no rendered-frame measurement; no ledger command run (writes restricted to this directory).
