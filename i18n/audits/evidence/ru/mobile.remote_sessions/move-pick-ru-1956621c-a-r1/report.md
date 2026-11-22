# Independent Russian translation audit A — round 1

Auditor: translation-auditor / session 1956621c6848 / **openai/gpt-6.1-sol** (actual visible fallback receipt: provider failure, quota; primary anthropic/claude-opus-5-5; provider-internal identity UNKNOWN).
Translator: 8866a2ce4a5d; independent session. Frozen source `9362cce8a631791b676b2d2c9eda90c43fc7e11c`.
Draft SHA-256: `15070cb7b89f902b53efdcc8e546c8ffce03df4a800cdfe121e59705f2cc627a`. Brief SHA-256: `5a72dfd72dc820b1fa8e73d78b97807581572334ee0fd25eb2eab346e759ebca`.

**Namespace verdict: mobile.remote_sessions / move_pick seven-key slice — PASSED WITH MINORS. Linguistic verdict: PASS; 0 blocker, 0 major, 2 minor width risks, 0 nit. Overall A-audit verdict: PASSED WITH MINORS; NOT a paired/high-visibility gate pass.**

## Scope and evidence
English/source context, seven draft values, actual move-sheet usage and neighboring Russian remote-session/sidebar catalogue were read side by side. Core Russian style guide/glossary plus the existing team-bridge pull-down instruction were checked. Hashes, keysets and context equality were derived here, not accepted from translator summaries. Ordinary approved file reads; nested context is not routable public copy; no public/keyed-reader receipt claimed.

## Per-key linguistic reasoning

### `mobile.remote_sessions.move_pick.cannot_reach`
- English: Can't reach {device}
- Russian: {device}: нет связи
- Verdict: passed. Name-first «{device}: нет связи» is a natural compact connection status. The colon treats the opaque display name as a label and avoids Russian case/gender agreement, whether Latin or Cyrillic. In this remote-computer row it does not claim a phone connection error. Literal name substitutions were verified, not rendered.
- Codepoints: EN 20, RU 19; ratio 0.95. Not rendered width.

### `mobile.remote_sessions.move_pick.destination_heading`
- English: Move or copy to
- Russian: Куда переместить или скопировать
- Verdict: passed_with_minor_width_risk. «Куда переместить или скопировать» naturally introduces destination choices, preserves both operations and the exact existing переместить/скопировать verbs, and is not an action-start promise. Infinitives and sentence case match Russian UI register. Expansion is F1, not a proven truncation.
- Codepoints: EN 15, RU 32; ratio 2.1333. Not rendered width.

### `mobile.remote_sessions.move_pick.discovery_help`
- English: This app can offer the devices your sessions show. A device with no visible session cannot be picked yet — open Local Operator on the other computer and pull the list to refresh.
- Russian: Приложение предлагает устройства, сессии которых видны в списке. Устройство без видимой сессии пока нельзя выбрать — откройте Local Operator на другом компьютере и потяните список сессий вниз, чтобы обновить его.
- Verdict: passed. «устройства, сессии которых видны в списке» naturally explains session-derived discovery rather than a network inventory. «пока нельзя выбрать» retains the temporary selection limit. «откройте … на другом компьютере и потяните список сессий вниз, чтобы обновить его» preserves both ordered instructions and explicit pull-to-refresh gesture. Formal plural imperatives match the existing Russian instructions; Local Operator is unchanged. сессия follows binding glossary. Existing сеанс variants are pre-existing drift, not introduced mistranslations.
- Codepoints: EN 178, RU 212; ratio 1.191. Not rendered width.

### `mobile.remote_sessions.move_pick.no_answer`
- English: It did not answer when this computer asked.
- Russian: Удалённый компьютер не ответил на запрос этого компьютера.
- Verdict: passed_with_minor_width_risk. Explicit «Удалённый компьютер» resolves English It without dependence on a display name’s gender. «на запрос этого компьютера» accurately preserves the requesting connected relay computer, not the phone. It is calm factual past-tense fallback text. Source lines 484–485 confirm server unreachable_reason.trim() takes precedence; those reasons are not translation input. Expansion is F2.
- Codepoints: EN 43, RU 58; ratio 1.3488. Not rendered width.

### `mobile.remote_sessions.move_pick.no_devices`
- English: No other devices are visible.
- Russian: Другие устройства не видны.
- Verdict: passed. «Другие устройства не видны.» is idiomatic factual Russian, preserves other/visible and does not assert network absence or offline status. устройство matches the glossary. No numerical count or ICU plural is required.
- Codepoints: EN 29, RU 27; ratio 0.931. Not rendered width.

### `mobile.remote_sessions.move_pick.on_this_computer`
- English: On this computer
- Russian: На этом компьютере
- Verdict: passed. «На этом компьютере» is the natural current-location label, parallel to existing «На {device}» without copying a duplicate key. компьютер correctly denotes the connected relay, not the phone. No final punctuation.
- Codepoints: EN 16, RU 18; ratio 1.125. Not rendered width.

### `mobile.remote_sessions.move_pick.right_now`
- English: Right now
- Russian: Сейчас
- Verdict: passed. «Сейчас» naturally labels the current-state section in this context; it is not an imperative or urgency instruction. Concise sentence case and no final punctuation match neighboring labels.
- Codepoints: EN 9, RU 6; ratio 0.6667. Not rendered width.

## Findings (non-gating; no self-authored remediation)

### F1 — minor — `mobile.remote_sessions.move_pick.destination_heading`
- Current: Куда переместить или скопировать
- Proposed: Куда переместить или скопировать (retain; rendered check, not a textual rewrite).
- Reason: 32 versus 15 source codepoints (+113.3%) in a compact destination heading; wrapping is allowed but narrow-phone height/fit is unverified.
- Disposition: deferred — rendered verification outside this read-only linguistic A-audit; no minor-only remediation round.

### F2 — minor — `mobile.remote_sessions.move_pick.no_answer`
- Current: Удалённый компьютер не ответил на запрос этого компьютера.
- Proposed: Удалённый компьютер не ответил на запрос этого компьютера. (retain; rendered check, not a textual rewrite).
- Reason: 58 versus 43 source codepoints (+34.9%) in fallback body copy; wrapping is allowed but narrow-phone height/fit is unverified.
- Disposition: deferred — rendered verification outside this read-only linguistic A-audit; no minor-only remediation round.

## Integrity, glossary and boundaries
- Exactly seven keys. Byte-exact `{device}` once in cannot_reach, six argument-free messages. Four malformed-brace negative controls rejected. No ICU plural/select/date/number skeleton or markup; Russian plural categories are N/A for these count-free messages. No runtime ICU execution claimed.
- `{device}: нет связи` leaves arbitrary Latin/Cyrillic names unchanged and avoids case/gender inflection. Literal substitutions for MacBook Pro, Рабочий компьютер, Ирина and Москва-2 passed; these are synthetic examples, not runtime/native evidence. Dynamic names remain unbounded width risk.
- Local Operator remains exactly Latin. Source lines 484–485 prove trimmed server reason wins over client fallback; server text is not translation input.
- Professional formal plural «откройте/потяните», impersonal status, sentence case and infinitive heading are consistent. Device/device instruction vocabulary matches устройство and move/copy matches переместить/скопировать.
- Existing session vocabulary drift is explicitly acknowledged: binding сессия versus pre-existing сеанс (remote_sessions.owner_unresolved / sidebar.show_ended). Draft follows the binding glossary. No unrelated catalogue cleanup requested and no gating finding manufactured.
- Discovery help is 212 vs 178 codepoints (+19.1%); on_this_computer is 18 vs 16 (+12.5%). Include these in the owning visual lane with F1/F2. These counts do not prove overflow. No pseudo/render/native measurement performed.
- Russian is LTR; zero bidi controls in all seven values; NFC passed. Mixed-direction arbitrary names were not rendered.
- Redaction scan: zero hits in seven English/context/draft copy inputs. One marker-like raw metadata hit was traced to verification.redaction_scan.patterns.unicode_mask, a regex character class; not redacted copy.

## Open gates / non-claims
Source-hook evidence GAP remains OPEN (delegation; no hook executed). High-visibility fresh independent B audit remains PENDING: this A pass alone is NOT the paired gate pass. No repository edits, commit, hook, test suite, build/install, browser/native or push. No full-namespace or human-native-speaker approval claimed.

**Read count: 7/7 delegated English/Russian message pairs. Namespace linguistic result CLEAN (7); overall result PASSED WITH MINORS (2 deferred width checks), zero unresolved blocker/major.**
