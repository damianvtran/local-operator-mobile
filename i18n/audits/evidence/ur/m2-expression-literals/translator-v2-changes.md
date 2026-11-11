# Urdu M2 remediation — round 1

Translator: i18n-translator · session eda2ad82b76a · actual served model `openai/gpt-6.1-sol`; no fallback observed. Translation by my own reasoning; no translation service. Candidate only; not an audit or eligibility verdict. Lane: bounded translation fix (<2 h).

## Output

`ur.v2.json`: exactly 32 keys in `keys32.json` order; 10 existing values changed, 17 retained, 5 added. No repository catalogue, generated file or ledger was edited. Manager should preserve this candidate until integration and independent audits are recorded in the tracked evidence root.

## Evidence re-derived here

Parsed all non-context Urdu JSON files: mobile worktree `~/local-operator-mobile/.worktrees/i18n-app-scan/src/i18n/catalogues/ur/`: 21 files / 649 keys; core `~/local-operator/local_operator/i18n/catalogues/ur/`: 40 files / 1,921 keys. Substring-bearing value counts (mobile / core): `جواب نہیں دے رہا` 2/3; `منسلک ہو رہا` 3/10; `فارغ` 1/1; `آن لائن` 1/1; `سیاق` 2/18; `ویڈیو` 1/1; `ایجنٹس` 8/20; `کام` 21/71; `حالت` 5/18. These are substring counts, not counts of exact standalone labels.

Both roots contain exactly `relay.chrome.session.subtitle.not_answering = جواب نہیں دے رہا`, `relay.chrome.session.subtitle.idle = فارغ`, and `relay.health.live = آن لائن`. Mobile computers catalogue has `badge.connecting = منسلک ہو رہا`, `connecting = منسلک ہو رہا ہے…`; mobile chrome uses `سیاق` in composer.row_usage and `ایجنٹس` in drawer.agents. Relay tray uses `کام {done}/{total}` and `ایجنٹس {running}/{total}`. Mobile session video_open is `ویڈیو {name} چلائیں`. Mobile settings connection.status is `حالت`, account.signed_in is `سائن ان شدہ`, diagnostics.route is `راستہ`.

Source/context and both audit reports were read in full for their findings. The supplied `keys32.json` is the source contract for new call-site integration; the unintegrated worktree generator currently reports 649 existing keys, not 681. Claims about native rendering in the earlier reports are not treated as verified runtime proof here.

## Lane A dispositions

- **A-F1 fixed** — status.not_answering now `جواب نہیں دے رہا`, byte-identical to both shipped relay catalogues and the binding source note.
- **A-F2 fixed** — diagnostics.stream_degraded uses that same phrase. Its note explicitly says open but not answering: no evidence of a different state that would justify another term.
- **A-F3 fixed** — stream_connecting becomes `منسلک ہو رہا`, identical to the shipped computer badge; matches the same-screen connecting term.
- **A-F4 fixed** — stream_idle becomes `فارغ`, reusing the shipped relay idle label. This follows the manager's cross-screen consistency decision even though B considered the original acceptable. It does not collide with live, connecting, degraded or offline.
- **A-F5 fixed** — no_connection becomes `ابھی کنکشن نہیں`; `ابھی` retains “yet”. Both offline keys remain `آف لائن`, not synonyms for this not-chosen-yet state.
- **A-F6 fixed** — not_signed_in becomes `Radient میں سائن ان نہیں ہے`: explicit predicate completion and idiomatic account preposition; Latin product name preserved. Kept the shipped سائن ان term, not a new synonym.
- **A-F7 fixed** — both estimated-context strings use adjective `(تخمینی)` rather than noun `(تخمینہ)`. Short-form width exception is separately recorded below.
- **A-F8 fixed** — host wait text now starts `آپ کے کمپیوٹر ({host}) سے جواب آنے کا انتظار ہے۔`: parentheses attach the hostname unambiguously to the computer and retain an Urdu-first sentence. Second sentence unchanged. This is the report's offered shorter alternative.
- **A-N1 declined (no wording change requested)** — retain computer fallback `آپ کے کمپیوٹر`, correctly oblique before `سے`. The report's suggestion that every future “Back to” necessarily needs a nominative is too broad: Urdu back-navigation can itself use a postposition. Actual new key uses a separate session fallback, so no forced reuse problem exists.

## Lane B dispositions

- **B-F1 fixed** — same source-bound relay wording fix as A-F1. No need to rely on the report's broader claim about the meaning of بے جواب to establish the consistency defect.
- **B-F2 fixed** — same degraded fix as A-F2. Identical words are appropriate here because the source notes define the same not-answering condition; the report's suggestion that the two labels must themselves be distinguishable is declined as reasoning, not as the requested wording fix.
- **B-F3 fixed** — same shipped connecting terminology as A-F3. The report's “unlike every sibling” auxiliary argument is not adopted: shipped badge and relay status phrases themselves omit ہے; consistency of the term is the evidence.
- **B-F4 fixed** — `ابھی کنکشن نہیں` retains yet, without unnecessary کوئی. Distinct from `منسلک نہیں` and both offline labels.
- **B-F5 declined as a translation edit** — no manual bidi controls, per binding ur style guide. {labels} and {name} must remain available for dynamic values; reordering cannot prove native alignment. Kept the correct template and product spelling; host wording changed for A-F8, not as a bidi repair. No native frame was captured here, so device alignment/isolation remains an explicit manager QA item, not a claimed pass. A's claim of renderer isolation and B's claim of missing isolation disagree; neither is used as execution evidence in this translation task.
- **B-N1 fixed** — lighter scroll-end noun `آخر` replaces `اختتام`; middle dot and ↑ retained.
- **B-N2 fixed** — `(تخمینی)` is adjectival, satisfying the wording concern alongside A-F7. Retaining the full context term is documented as a width exception, not misrepresented as an abbreviation.
- **B-N3 fixed** — `Radient میں سائن ان نہیں ہے` incorporates the account preposition as well as A-F6's completed predicate.

Totals: A 8 fixed / 1 declined; B 7 fixed / 1 declined; **15 finding entries fixed / 2 declined** (overlapping entries across audits counted separately).

Both reports' out-of-lane English REGION_LABEL / back-navigation observations are addressed at candidate level by the five newly requested keys. Integration remains the implementer's responsibility, not proven by writing a candidate.

## Five added keys and interpolation

- working → `سرگرمی` (activity noun; shipped session status_tray.hint uses سرگرمی).
- subagents → `ایجنٹس` (same agents heading as shipped relay tray and mobile drawer; full subagent headings elsewhere remain ذیلی ایجنٹ).
- todos → `کام` (same task noun as relay tray).
- strip → `حالت` (same status noun as settings).
- back_to → `{name} پر واپس جائیں` (respectful imperative; no full stop).

Examples by grammatical substitution, not rendered-device evidence:

- connected_to with `Office Mac`: `Office Mac سے منسلک ہو گیا۔`
- connected_to with its computer fallback: `آپ کے کمپیوٹر سے منسلک ہو گیا۔`
- back_to with `Release prep`: `Release prep پر واپس جائیں`
- back_to with its session fallback: `سیشن پر واپس جائیں`
- below_labels single band: `سرگرمی نیچے · اسکرول کریں ↓`
- below_labels joined bands: `ایجنٹس · کام نیچے · اسکرول کریں ↓`

**No split-key request.** Computer fallback remains oblique for سے; session fallback سیشن is invariant before پر and also works as a bare header. These are already distinct fallback keys; do not merge them. If a future computer-naming slot requires a nominative, add a separate key then.

## Width exception — both short context forms

No established, recognisable Urdu abbreviation of the shipped four-letter `سیاق` is available; inventing a clipped fragment would obscure the UI meaning and Latin `ctx` would abandon the shipped term. Exercise the manager's explicit “if truly none exists” exception: short and wide remain equal, including the estimated variants. This does NOT claim to solve under-340pt wrapping; the manager must carry the exception to layout QA.

Measured with Python unicodedata: combining marks 0, East Asian W/F 2, all other characters 1; substitute percent=50. Wide context = **8 cells**, short context = **8 cells**; wide estimated = **17 cells**, short estimated = **17 cells**. `سیاق` alone = 4 cells. No CJK in these strings. These are terminal-cell counts, not a native font/pixel fit claim.

## Glossary proposals

Record `اسکرول کریں` for the scroll action and `تخمینی` for estimated metadata if the shared glossary is expanded; context already uses the shipped `سیاق`, video `ویڈیو`, and the new region nouns reuse existing catalogue wording. No glossary file was changed.

## Actual validation

Python3 validation: PASS — 32 keys, exact source order, placeholder names equal per key, all nonempty/trimmed, NFC, no format/bidi controls, English-identical only `Local Operator`. 10 old values changed and 5 new keys; no ICU plural/select structures occur in this slice.

Repository catalogue validator actually executed:

`cd ~/local-operator-mobile/.worktrees/i18n-app-scan && node scripts/i18n/generate.ts --check`

Exit 0; stdout: `src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`.

Node emitted MODULE_TYPELESS_PACKAGE_JSON warning for existing messages.ts; no validator error. This command checks the existing repository, NOT the not-yet-integrated 32-key candidate. Candidate-specific proof is the Python validation above. Independent language audit and native RTL/width frames remain with the manager's separate roles; no self-audit performed.
