# O3-c ur audit: mobile.sidebar (o3c-ur-06b108)

Verdict: **passed**, with 0 BLOCKER/MAJOR. Keys: 9. Auditor: i18n-auditor (team lopdev), session 06b10865ce7b, anthropic/claude-opus-5-5. I did not translate these strings; the translator was session 5703a7a23771.
Inputs: draft sha256 ee2cda121c47eddc644c11f141c9511287a43b7efb56aadfb6d2c3d1bd67155e and brief e88beb09366b9ff795bf0ac916f30cef1c9a93c35fa4617575e904c7a6f5fd17. Both match the hashes the brief and draft declare. Source e7ebc391. The en sources hash to the brief's pins (beaba7ba…, 858f7c51…).
Redaction marker hits: draft 0. Brief 0 once the `redaction_scan.pattern` field is excluded (2 raw hits, both the pattern matching itself).

## Mechanical (see audit.log for the printed output)
- Keyset: 9/9, none missing, none extra.
- Placeholders and select: I ran the worktree's own `parseMessage`/`formatMessage` (read-only import through tsx). Params and select arms are identical to en (`kind: approval|other`, `device: text`).
- Negative controls for the parser: a missing `other` arm and an unterminated select both throw. A renamed placeholder parses but shows up in the params comparison.
- Text hygiene: all strings are NFC, with no bidi controls (LRM/RLM/LRE–RLO/LRI–PDI/ALM), no leading or trailing whitespace and no trailing punctuation.
- Latin punctuation: the checker's `latin_punct=true` on `row_label.waiting` comes only from the ICU syntax commas. The arm text has no Latin punctuation.
- Latin-initial output: none, including `on_device` with `{device}="Studio Mac"`, which renders «ڈیوائس Studio Mac پر».
- Width: I measured rendered width with CoreText at 12 pt regular. `text-meta` is 12px/500, so the 500 weight was not measured.
  - With the system UI font cascade:
    - «جواب نہیں دے رہی» is 88.9 pt, against 79.3 pt for en "not answering".
    - «پہنچ سے باہر» is 57.2 pt, against 77.4 for "not reachable".
    - «منظوری» is 37.1, against 48.5.
    - «سوال» is 24.7, against 48.8.
    - «ختم شدہ» is 44.1, against 35.5.
  - Noto Nastaliq Urdu gives 89.0 for not_answering.
  - I could not resolve SF Arabic or DecoType by name (CoreText fell back to Helvetica plus cascade). Those rows are not independent measurements.
  - I did not capture an on-device render.

## Accuracy, idiom, terminology
- The glossary terms are applied correctly: منظوری is the singular of منظوریاں, and ڈیوائس is the glossary term for device.
- The receipts are neutral, with no alarm wording.
- The wording matches shipped copy for the same states:
  - «پہنچ سے باہر» matches mobile.remote_sessions.health_dropped.
  - «جواب نہیں دے رہی» is feminine with گفتگو, as in health_quiet.
  - «ختم شدہ» matches show_ended.
  - «کام جاری» matches relay.chrome working_plain.
  - «زیر التوا» for a pending approval/question matches core wire.errors.desktop.question_no_longer_pending.
- Feminine agreement (نئی, رہی, کھلی ہوئی) is consistent across the strip.
- The `on_device` lead noun is a small addition to the source. It is idiomatic («ڈیوائس X پر» = "on device X") and keeps the fragment Arabic-script-initial.
- The `waiting` arms are whole phrases, not composed from the status word.

## Findings

### UR-S1: MINOR: `mobile.sidebar.row_status.not_answering`
- Current: `جواب نہیں دے رہی`
- Problem: It is 16 chars against the ~14 hint. Rendered, it is about 12% wider than en "not answering" (88.9 vs 79.3 pt), roughly 4 pt past the hint-scaled en width.
  - It does not clip. The slot is `shrink-0`. Below LARGE_TEXT_SCALE the title truncates first, and above it the marks wrap (list-row.tsx L231-249).
  - The translator's fallback «جواب نہیں» drops the progressive aspect. It reads as "no answer", which next to the danger-coloured «سوال» chip could be taken as "unanswered question".
- Proposed: keep it as it is. Treat it as a design call only if the 100 % strip is measured too tight.

### UR-S2: NIT: `mobile.sidebar.row_label.waiting`
- Current: `{kind, select, approval {منظوری زیرِ التوا} other {سوال زیرِ التوا}}`
- Problem: The draft writes the izafat kasra «زیرِ». The three shipped core uses of this exact term write «زیر التوا» (wire.errors.desktop.question_no_longer_pending, wire.settings.proactive_patience_max_pending.label/help). Both spellings are correct. Kasra does appear elsewhere in shipped copy (cli.services_status «زیرِ نگرانی»).
- Proposed: `{kind, select, approval {منظوری زیر التوا} other {سوال زیر التوا}}`. This is optional, for spelling consistency only.

## Out-of-scope observations (not translation defects, not gating)
- O1: `rowAccessibilityLabel` joins fragments with Latin ", " (list-row-meta.ts L505). Shipped ur uses «،» (mobile.settings.theme.row_label «تھیم، {name}»). Screen readers pause on either, so the effect is mostly cosmetic. Any fix belongs in code, for example a locale-aware list separator. The translator flagged this too.
- O2: The visible remote-row device line paints a literal English `On {remote.device}` (list-row.tsx L356). The new `row_label.on_device` key covers only the spoken label. In ur, a painted English "On" sits in a translated row. This is a source-side keying gap and should be reported to the manager.

## Audit notes
This report is the auditor's notes. audit.log carries the printed command output.
My first tsx run passed the two sibling-session files as argv, and guard 0.107.0 refused it, so nothing ran. The re-run used an authored copy of the 9 values in this session's scratchpad. A read-only Python comparison proved that copy equal to draft.values.
I did not run the repo validator (`npm run i18n:check`). The draft is outside the repo and the worktree is read-only for this audit.
I appended no ledger row, because the worktree is read-only per the brief. The manager owns committing the bundle and the ledger row.
