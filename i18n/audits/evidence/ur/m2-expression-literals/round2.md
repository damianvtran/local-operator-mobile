# M2 round 2 delta audit — ur (RTL) — m2-a2-ur

Auditor: i18n-auditor, independent of translator (i18n-translator, openai/gpt-6.1-sol). Actual served model: anthropic/claude-sonnet-5-5 (no fallback). No MT service used; nothing edited (repo, ledger, candidate).

Inputs (sha256): ur.v3.json `ebfa86b5…855b`; keys33.json `f3a96f9a…8f`; ur.v1.json `4f5005aa…6483`. Shipped catalogues recounted by parsing all non-context JSON in `~/local-operator-mobile/.worktrees/i18n-app-scan/src/i18n/catalogues/ur/` (649 keys) and core `~/local-operator/local_operator/i18n/catalogues/ur/` (1,921 keys).

## Verdict: CLEAN-with-1-NIT (0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT). `passed` is available.

## 1. v1 -> v3 diff (derived in python)
v1 had 27 keys; v3 has 33. Changed (10): not_signed_in, no_connection, not_answering, stream_idle, stream_connecting, stream_degraded, wait.host_answering, tray.context_estimate, tray.context_short_estimate, region.end. Added (6): region.label.{working,subagents,todos,strip}, back_to, back_to_session. v2 -> v3: only `back_to_session` added; the other 32 byte-identical; `fallback_name` (session) NOT revised (stays `سیشن`).

## 2. Mechanical pass — PASS
- 33 keys; key list and order == keys33.json (True).
- Placeholders per key == English/sidecar (`{baseUrl}`, `{host}`, `{percent}`x4, `{labels}`, `{name}` x2 incl. back_to); all 33 set-equal. back_to_session has none (English has none) — correct.
- No empty/padded values, no ASCII `.`, no double spaces, all NFC, no Cf/Cc chars (no manual bidi controls; ur.md "RTL & bidi" forbids them), no Arabic-variant letters (ي ك ى ة), Latin digits only (`{percent}`), Latin residue only Radient / Local Operator / placeholders.
- English-identical value: only `mobile.settings.account.app_name` = Local Operator (required).
- No ICU plural/select in the slice, so no CLDR-arm question for ur.
- Punctuation: `۔` on the 3 full sentences (wait.host_answering, wait.answering, connected_to); `·`, `↑`/`↓`, `%` and parentheses preserved; none of the label/pill strings carry a stop (as notes require).

## 3. Round-1 findings adjudicated against v3 (recount from shipped)
Shipped recount (mobile / core, substring counts): `جواب نہیں دے رہا` 2/3 (relay.chrome.session.subtitle.not_answering; mobile.session.subagent.unavailable_next; core also relay.chrome.session.degraded `جواب نہیں دے رہا — پیغامات رکے ہیں`, relay.asks.error.read_timeout); `بے جواب` 0/0; `منسلک ہو رہا` 3/10 (badge.connecting exact; relay.health.reconnecting); `فارغ` 1/1 (relay.chrome.session.subtitle.idle); `آن لائن` 1/1 (relay.health.live); `ویڈیو` 1 (video_open); `ایجنٹس` 8/20; `سرگرمی` 1 (status_tray.hint pairs سرگرمی · کام · ایجنٹس exactly as the new region labels do); `پر واپس جائیں` precedent: mobile.oauth.return `Local Operator پر واپس جائیں`; `سیاق` = composer.row_usage; `تخمینہ` only a noun in TUI project copy (no shipped adjective, so `تخمینی` introduces no conflict). Matches the translator's counts.

| ID | Key | v3 | Disposition |
|---|---|---|---|
| A-F1 MAJOR / B-F1 MAJOR | status.not_answering | `جواب نہیں دے رہا` | FIXED CORRECTLY — byte-identical to the shipped relay subtitle the sidecar binds to. `بے جواب` appears nowhere shipped. |
| A-F2 / B-F2 | diagnostics.stream_degraded | `جواب نہیں دے رہا` | FIXED. B's extra argument (degraded must be distinguishable from Not answering) — translator DECLINED the reasoning; DECLINE UPHELD: sidecar defines degraded = open but not answering, and shipped relay.chrome.session.degraded already maps "degraded" to this same phrase. |
| A-F3 / B-F3 | stream_connecting | `منسلک ہو رہا` | FIXED — identical to shipped badge.connecting. B's "needs auxiliary" argument declined; UPHELD (shipped badge/relay omit ہے). |
| A-F4 | stream_idle | `فارغ` | FIXED — shipped relay idle word; no longer reads "disabled". (B had judged `غیرفعال` acceptable; consistency wins and `فارغ` is not wrong.) |
| A-F5 / B-F4 | no_connection | `ابھی کنکشن نہیں` | FIXED — "yet" retained. B suggested `ابھی کوئی کنکشن نہیں`; `کوئی` optional, not a defect. Distinct from not_connected `منسلک نہیں` and offline `آف لائن`. 15 cells, fits the 1-line ellipsised card line. |
| A-F6 / B-N3 | not_signed_in | `Radient میں سائن ان نہیں ہے` | FIXED — the exact form both auditors proposed; preposition `میں` idiomatic; predicate complete; Radient Latin. |
| A-F7 / B-N2 | tray.context_estimate, context_short_estimate | `{percent}% سیاق (تخمینی)` | FIXED — adjective. Short==wide (see §4) accepted. |
| A-F8 | wait.host_answering | `آپ کے کمپیوٹر ({host}) سے جواب آنے کا انتظار ہے۔ …` | FIXED — A's own shorter alternative; host unambiguously attached to the computer; parentheses around a Latin host mid-sentence resolve correctly in an RTL paragraph (the "(" sits between Urdu and Latin letters, ")" after a letter/digit). 106 cells wraps by design (help line). |
| A-N1 | added.fallback_name | `آپ کے کمپیوٹر` | DECLINE UPHELD — sole call site is `{name} سے منسلک ہو گیا۔`; oblique is required there. Reuse constraint is a note for integrators, not a wording defect. |
| B-F5 MINOR | Latin-initial composed strings (below_labels, connected_to, not_signed_in) | unchanged | DECLINE UPHELD as a translation edit: ur.md bars manual bidi controls and the app already has `useComposedDir()` (`src/ui/direction.tsx`, used in schedules/section-header) for composed copy whose first strong char is the wrong script. Not wording-fixable without hurting idiom (Urdu is verb-final, name-first is natural). Remains a QA item (see §6): confirm these call sites apply it — I did not find the wiring in the worktree HEAD (b783c878, branch english-closure; expression-literals branch separate), so this is unverified here. |
| B-N1 | region.end | `آخر · اسکرول کریں ↑` | FIXED (see NIT-1). |
| A-§5 / B out-of-lane (English REGION_LABEL, "Back to ${parentName}") | — | 5 new keys | Resolved at candidate level by the new keys; integration not provable from a candidate. |

All 15 round-1 findings that the translator marked fixed are confirmed fixed against the v3 values; the 4 declines (A-N1, B-F5, plus the two argument-level declines in B-F2/B-F3) are upheld. No round-1 finding left open.

## 4. Fresh judgment of new/changed values
- region.label.working `سرگرمی` (activity), subagents `ایجنٹس`, todos `کام`, strip `حالت`: one word each (3-6 cells), lower-case n/a in Urdu, shipped terms (relay tray `کام`/`ایجنٹس`; settings `حالت`). Spliced: `سرگرمی نیچے · اسکرول کریں ↓`; `ایجنٹس · کام نیچے · اسکرول کریں ↓` (29 cells, reads naturally; `·` joiner and `↓` neutral, arrows vertical so no mirror hazard).
- region.end `آخر · اسکرول کریں ↑` (19 cells) / more_below `مزید نیچے · اسکرول کریں ↓` (25): fine; one NIT below.
- back_to `{name} پر واپس جائیں`: grammatical with a real name (`Release prep پر واپس جائیں`) and with the session fallback (`سیشن پر واپس جائیں`); `پر` takes the unmarked noun so there is no case clash (unlike the computer fallback). Respectful آپ imperative; matches `Local Operator پر واپس جائیں`. 20 cells + name.
- back_to_session `سیشن پر واپس جائیں` (18 cells): idiomatic, glossary `سیشن`; same string as back_to with the fallback, so redundant for ur but harmless (key exists for other locales).
- fallback_name (session) `سیشن` unchanged: valid bare noun, and valid in back_to. fallback_name (computer) `آپ کے کمپیوٹر` + `connected_to` = `آپ کے کمپیوٹر سے منسلک ہو گیا۔`; with a real name `Office Mac سے منسلک ہو گیا۔` — both grammatical; `منسلک ہو گیا` matches shipped event wording.
- Narrow context forms: `{percent}% سیاق` is 8 cells (vs English `{percent}% ctx` 8, `{percent}% context` 11). Not narrower than the wide form, but `سیاق` is already 4 letters and no recognised shorter Urdu abbreviation exists; the sidecar explicitly allows "the full word if none exists". Genuinely-narrower is impossible without inventing a fragment; ACCEPT the recorded width exception (estimated forms 17 cells both). Do carry to layout QA under 340 pt.
- Cell widths (python: combining=0, WF=2, else 1, percent=50): not_signed_in 27, route_radient 26, route_direct 28 (+baseUrl), no_connection 15, not_answering/stream_degraded 16, tray 8/17, region cues 19–29, back_to 20 (+name). The only hard-capped line is the account card line 2 (`numberOfLines=1`, per A's read of settings.tsx:312-315): route_* and no_connection there are 15–28 cells + a URL; tail-ellipsis possible for long baseUrl but that is the English behaviour too. No maxCells hints in the sidecar; no overflow finding.

## 5. `not answering` pair, no_connection vs offline, safety
- not_answering == stream_degraded == shipped relay wording `جواب نہیں دے رہا` (16 cells). Distinct from offline `آف لائن`, from not_connected `منسلک نہیں`, from no_connection `ابھی کنکشن نہیں`, and from connecting/idle/live: five different Urdu strings for five states in the Settings pill/stream row, except the deliberate not_answering/degraded identity.
- Terse-label safety: `منسلک` (Connected) and `منسلک نہیں` (Not connected) differ only by `نہیں` — polarity pair kept verbatim from shipped (home.picker.not_connected); the pill wraps rather than truncating, so `نہیں` cannot be clipped. No destructive/permission text in this slice. `آن لائن` (live) vs `آف لائن` (offline) is a one-letter-ish contrast but shipped and colour/field-labelled. No negation/polarity error found.

## 6. Findings
- NIT-1 `mobile.session.region.end` current `آخر · اسکرول کریں ↑` — `آخر` is also the very common adverb "after all/finally", so a bare `آخر` can momentarily read as an interjection rather than "end". The adopted wording is a fine, lighter cue (B suggested it, shipped uses `آخری` elsewhere); alternatives `اختتام` (round-1 original, accurate but formal) or `آخر تک پہنچ گئے · …` (too long). Optional; no change required, does not gate.

QA item (not a finding, not gating the translation): once wired, check on an RTL device/simulator frame that the Latin-initial composed lines (`connected_to` with a Latin computer name, `below_labels`, `back_to`, `not_signed_in`) are laid out via `useComposedDir()` so the trailing `۔` and the `·`/arrow stay on the correct side; the app's `FSI/PDI`-wrapping claim in the style guide vs B-F5's "no isolation in src/i18n" disagree and I could not settle it from source alone.

Recommended ledger status for this group: `passed` (no BLOCKER/MAJOR). Round-1 A and B findings: 0 open.
