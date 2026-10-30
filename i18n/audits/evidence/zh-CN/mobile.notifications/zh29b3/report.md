# Independent Chinese audit — `mobile.notifications` (`zh29b3`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 1 MINOR (`ZH-NTF-1`), 1 NIT (`ZH-NTF-2`); unresolved blocker/major count = 0.** All 14 English/context/zh-CN entries were read and judged. A `passed` result is allowed with minor/nit findings under the programme's “no blocker or major remains” rule; both are batched here for the wave's single remediation pass.

- **Auditor:** `i18n-auditor` (lopdev team), session `09e9d1711068`. **Actual model: `radient/auto`**, after `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` provider-quota 429 fallbacks; all evidence commands ran under the final model.
- **Translator:** a different agent, `radient/auto` as supplied; not observed. Independence is agent/session/context, not model diversity (same served model, disclosed).
- **Second independent pass:** job `a163531a0dbd` (`zh-group-B-second-pass`, role `reviewer`, actual `radient/auto`). It independently found both items below (`earlier_updates` MINOR, `from` NIT). No disagreement in substance; the second pass's count summary says 83 keys, while the executed count is 77 across the group and 14 here — this report uses the executed count.
- **Inputs:** en `c6e58c6129727513a00b0c67abdfc6cd5284d326792f00886767a26a60778064` · context `240ec6befb692d72ac51a346fbc70a6f79e5853ae03f62ce25654d81db7f21e6` · zh-CN `84e5360c407face2b0f635b57f472e6586481cd389bf66d76774d758574e673f`.
- No translation/MT service, no human native review, no rendered frame.

## Mechanical evidence

- `npm run -s i18n:catalogue:check` → exit 0, projection current (143 keys, 10 namespaces); strings ratchet 0 new vs `a57fb8c`.
- JSON valid; **14/14/14** keys; no missing/extra; context parity complete.
- No placeholders or ICU structures in this namespace; every message parses.
- No bidi controls, no ASCII prose punctuation; full-width `，。` and `……` only; no `您`/`请`/`！`; no keys added or dropped.
- `load_failed` is an alert title and correctly carries no final full stop; the empty-state sentences do.

## Rendered strings (app parser)

```
回答 · 返回 · 在对话中回答 · 此对话的问题 · 较早的更新
此对话中没有问题。 · 此对话没有可忽略的更新。
项目 · 忽略 · 显示 · 无法加载通知 · 高 · 通知
```

## Findings

### ZH-NTF-1 — MINOR — `mobile.notifications.detail.earlier_updates` (core consistency)

- **Current:** `较早的更新`
- **Problem:** the same relay-inbox section is already committed in core as `更早的更新` (`relay.notifications.detail.section.history`), with the section word `更早`; `较早` is attested in core only for older history in prose, never for this header. Both are correct Chinese; one product should use one rendering for the identical section.
- **Replacement:** `更早的更新`

### ZH-NTF-2 — NIT — `mobile.notifications.detail.from` (section header register)

- **Current:** `来自`
- **Problem:** a preposition used as a bare section heading; the committed header for the identical section is the noun `来源` (`relay.notifications.detail.section.from`). The card beneath already carries the conversation name and state, so `来源` reads as the label, `来自` reads as an unfinished sentence.
- **Replacement:** `来源`

## Per-key judgement (all 14)

| # | key | Verdict |
|---|---|---|
| 1 | `answer` | PASS — `回答`, one-word imperative; matches core |
| 2 | `back` | PASS — `返回` |
| 3 | `detail.answer_in_conversation` | PASS — `在对话中回答`; sentence case, no full stop |
| 4 | `detail.conversation_asks` | PASS — `此对话的问题`; `问题` is core's word for an ask |
| 5 | `detail.earlier_updates` | **ZH-NTF-1 MINOR** |
| 6 | `detail.from` | **ZH-NTF-2 NIT** |
| 7 | `detail.no_asks` | PASS — `此对话中没有问题。`; full stop |
| 8 | `detail.nothing_to_dismiss` | PASS — `此对话没有可忽略的更新。`; `忽略` matches core's dismiss verb |
| 9 | `detail.projects` | PASS — `项目` |
| 10 | `dismiss` | PASS — `忽略`, core's verb throughout |
| 11 | `filter_label` | PASS — `显示`, verb label for the segmented control |
| 12 | `load_failed` | PASS — `无法加载通知`; alert title, no final full stop |
| 13 | `priority_high` | PASS — `高`, one-word badge; core uses `高优先级` in prose, the badge stays one word |
| 14 | `title` | PASS — `通知` |

## Fit

Content width 288 pt at 320 pt. `在对话中回答` (button, 15/600) is 89.6 pt; `此对话没有可忽略的更新。` (14/400) is 168 pt on one line and wraps at 200%; `无法加载通知` is 84 pt; `高` is 11 pt. Nothing is clamped in this namespace; no overflow risk.

## Notes and limits

- **Unkeyed detail headers:** `src/features/notifications/notification-detail.tsx` still renders `SectionHeader label="Notification"`, `"Links"` and `"Message"` as source literals. A zh-CN build will keep those three English headings until the strings programme keys them; they are outside this catalogue pair and not counted. The rest of the namespace is keyed.
- `detail.nothing_to_dismiss` uses `可忽略`, which can also mean “negligible”; in the dismiss dialog the action verb `忽略` disambiguates, and the sentence reads correctly. No change.
- No rendered frame or human native review; fit is a font-metric estimate.

## Gate note

`node_modules/.bin/vitest run src/i18n/__tests__/catalogues.test.ts` fails on this tree at `ships no locale the runtime cannot render`: the directory list is `['en','es','fr','zh-CN']` while `SHIPPED_LOCALES` is `['en','es','fr']`. That is the designed directory-vs-shipped gate (a catalogue directory is not activation), not a copy defect; the wave cannot land green until the `locale.ts` flip (zh-CN shipped, removed from pending) lands with the catalogue after the audits pass. `i18n:catalogue:check` and the strings ratchet are green; the catalogue bytes are untracked at `a57fb8c` and must be committed together with the projection.

## Recording boundary

No `i18n/ledger.json` and no audit-ledger command in this repository; `docs/i18n.md` makes the PR report the audit artifact. Proposed ledger row in `record.json.ledger` is explicitly unwritten. The catalogue is untracked at `a57fb8c` and pinned by the target hash.
