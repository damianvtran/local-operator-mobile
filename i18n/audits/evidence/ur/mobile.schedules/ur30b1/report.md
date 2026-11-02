# ur · mobile.schedules · ur30b1 — independent audit

**Verdict: changes_requested** · keys 38/38 (en/ur), keyset equal: True · BLOCKER 0 · MAJOR 2 · MINOR 1 · NIT 0

Auditor: i18n-auditor (lopdev), session b5f20e88b803, model anthropic/claude-sonnet-5-5 (no fallback observed).

Route: Catalogue, sidecars, scripts and generate.ts read by ordinary worktree file reads and `git show origin/main:` of the core repo; NOT the read_public_copy route (refused for src/i18n/**). Context sidecars are nested JSON, not routable. No receipt claimed.

Redaction markers: **0** · bidi/zero-width control chars in target: **0** · `generate.ts --check`: current · placeholder-name parity: 0 mismatches.

## Findings

### S1 — MAJOR — `mobile.schedules.state.dormant`

- current: `غیر فعال`
- replacement: `خوابیدہ`
- why: Composed-screen contradiction. The monitors header reads «{count} فعال» (armed) and dormant rows are counted in it (monitorAlerting excludes dormant, so the header stays «5 فعال»), while the dormant row's own slot says «غیر فعال» — the literal antonym of فعال — directly beneath. It also spends the standard Urdu word for DISABLED (core uses غیر فعال for disabled) on the weaker state while the stronger state, disabled, is «بند». Rendered: header «5 فعال» + dormant slot «غیر فعال» (before) vs «خوابیدہ» (after). If خوابیدہ is judged too literary: «سویا ہوا». Not «معطل» (collides with the parked clause's meaning).
- verified: tsx repl.ts 'S1 composed BEFORE/AFTER' lines in audit.log; read of schedules-copy.ts monitorAlerting/monitorSectionSummary; core ur grep for غیر فعال=disabled (wire.errors.desktop.aida_disabled).

### S2 — MAJOR — `mobile.schedules.supervisor.not_running`

- current: `بیداریوں کا سپروائزر انسٹال تو ہے مگر چل نہیں رہا، اس لیے نیچے دی گئی بیداریاں نہیں چلیں گی۔`
- replacement: `بیداریوں کی نگرانی کرنے والی سروس انسٹال تو ہے مگر چل نہیں رہی، اس لیے نیچے دی گئی بیداریاں نہیں چلیں گی۔`
- why: Glossary inconsistency on one screen. The three supervisor sentences are alternatives of one status line: unsupported/unverifiable say «بیداریوں کی نگرانی» for 'supervised', only not_running introduces a transliterated «سپروائزر». i18n/glossary.md note 7 records, for ur, that 'supervised' is rendered with the existing monitor word نگرانی because none of the locales has a settled word for a supervisor unit and inventing one would give one concept two names; core tui.schedule.notice_supervisor does the same. Replacement keeps that call, names the thing descriptively, and agrees in gender (سروس is feminine: چل نہیں رہی).
- verified: git show origin/main:i18n/glossary.md note 7; core tui.schedule.notice_supervisor; replacement parsed and rendered via parseMessage/formatMessage in repl.ts.

### S3 — MINOR — `mobile.schedules.show_more.wakes / mobile.schedules.show_more.monitors`

- current: `{hidden, plural, one {# اور بیداری دکھائیں} other {# اور بیداریاں دکھائیں}} (and the monitors twin)`
- replacement: `{hidden, plural, one {# مزید بیداری دکھائیں} other {# مزید بیداریاں دکھائیں}} ; {hidden, plural, one {# مزید نگرانی دکھائیں} other {# مزید نگرانیاں دکھائیں}}`
- why: Numeral + «اور» ('21 اور بیداریاں') parses as the conjunction 'and'; the programme already settled «مزید» for '# more' (core relay.session.tags.more: «# مزید ٹیگ / # مزید ٹیگز»). Number agreement itself is correct at 1, 2, 21.
- verified: render.ts at hidden=1,2,21; repl.ts after-render; core relay.session.tags.more grep.

## Observations (not findings on the Urdu text)

- head.next/head.overdue render clean: «3 بیداریاں · اگلی بار 4m بعد», «1 بیداری · 2h سے تاخیر», «2 بیداریاں · اگلی بار 1h30m بعد», «21 بیداریاں · 45s سے تاخیر». No doubled postposition: ahead is «{label} بعد» and next supplies only «اگلی بار» (same wording as core tui.schedule.detail_next/due_in/due_overdue). Overdue drops «اگلی بار» exactly as the sidecar demands.
- truncated: oblique plural after numeral+میں سے is correct («2 گفتگوؤں میں سے»), singular «1 گفتگو میں سے»; shown agrees with the feminine گفتگو («1 … رہی ہے» / «2 … رہی ہیں»); select arms wakes→بیداریوں, other→نگرانیوں grammatical; an unknown family falls to نگرانیوں like English. Counts 0/1/2/21 all read correctly. generate.ts permits the text→plural escalation on shown/total.
- Plural categories: Intl.PluralRules('ur') = one/other only, 0→other; both app formatter and Intl agree (audit.log).
- cadence.* and due.* compose cleanly with duration tokens (ہر 1d · 3 باقی; ہر 1h30m · کوئی ڈیلیوری باقی نہیں); fribidi shows every Latin duration as an intact LTR island.

## Per-key read (each key read against EN text, sidecar note and, where composed, its call site)

| key | role | result |
|---|---|---|
| `cadence.every` | meta | ok |
| `cadence.left` | meta | ok |
| `cadence.once` | meta | ok |
| `cadence.spent` | meta | ok |
| `count.monitors` | meta | ok |
| `count.wakes` | meta | ok |
| `due.ahead` | meta | ok |
| `due.overdue` | meta | ok |
| `empty.body` | help | ok |
| `empty.title` | heading | ok |
| `empty_line.monitors` | status | ok |
| `empty_line.wakes` | status | ok |
| `gone.monitors` | status | ok |
| `gone.wakes` | status | ok |
| `head.next` | meta | ok |
| `head.overdue` | meta | ok |
| `parked.monitors` | status | ok |
| `parked.wakes` | status | ok |
| `read_error.monitors` | status | ok |
| `read_error.wakes` | status | ok |
| `read_unreachable` | status | ok |
| `show_less.monitors` | button | ok |
| `show_less.wakes` | button | ok |
| `show_more.monitors` | button | S3 |
| `show_more.wakes` | button | S3 |
| `state.disabled` | status | ok |
| `state.dormant` | status | S1 |
| `state.expired` | status | ok |
| `state.stale` | status | ok |
| `state.waiting` | status | ok |
| `summary.monitors_armed` | heading | ok |
| `summary.monitors_attention` | heading | ok |
| `summary.wakes` | heading | ok |
| `supervisor.not_running` | status | S2 |
| `supervisor.unsupported` | status | ok |
| `supervisor.unverifiable` | status | ok |
| `tail.failed` | status | ok |
| `truncated` | status | ok |

Commands and their actual output: `audit.log` in this directory.
