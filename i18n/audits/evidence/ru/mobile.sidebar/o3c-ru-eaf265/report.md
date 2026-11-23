# O3-c audit — ru — mobile.sidebar (o3c-ru-eaf265)

Auditor: i18n-auditor (team lopdev), session eaf2654d42af, model anthropic/claude-opus-5-5 (harness `Model:` line; no fallback observed). Independent of translator session 0d790ba194ba.
Source: local-operator-mobile `feat/i18n-o3c-rows-headers` @ e7ebc391. Draft sha256 04f108c6… verified before reading. Read route: ordinary file reads (draft, brief, worktree catalogues, ~/local-operator style guide + glossary); mechanical checks via the worktree's own `parseMessage`/`formatMessage` under `node_modules/.bin/tsx`, read-only. No MT service used.

**Verdict: passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT.

## Mechanical
- 9/9 keys, none extra; placeholders identical (`kind`, `device`); select arms `approval`/`other` kept, parses under repo parser (negative controls caught: unterminated select, renamed arg, redaction literal, NFD).
- NFC; only Cyrillic + ASCII; ё precomposed (U+0451). Redaction marker hits 0 (draft, en, context, brief excluding its own pattern field).
- Width: all within `width_hint_chars` (approval 9/10, question 6/10, not_reachable 10/14, ended 9/10, not_answering 11/14, waiting 14 and 21/24, working 8/24, on_device «на Studio Mac» 13/24, open 7/24). Cyrillic is single-cell.

## Accuracy, idiom, terminology
- Feminine agreement (недоступна/завершена/открыта) matches the sidebar's noun «беседа» (show_ended_hint, empty_by_view, tags.remove_all_body, mobile.chrome.drawer.*) and the shipped strip word row.new «новая». Lowercase, no punctuation, per brief. (Pre-existing corpus split: mobile.remote_sessions says «разговор»; not on this surface, does not gate.)
- «одобрение» = glossary approvals → одобрения (not подтверждение). «вопрос» matches row.asks.
- ended/not_answering/working reuse shipped relay.chrome subtitles lowercased (Завершена, Не отвечает, Работает) — neutral receipts, no alarm.
- waiting arms are whole natural phrases with the shipped «Ждёт» verb; «ждёт ответа на вопрос» is the idiomatic form, not a gloss of «вопрос ждёт».
- Composed label reads naturally: «Платежи, ждёт одобрения, завершена, на Studio Mac, недоступна, открыта».
- «открыта» for the on-screen conversation is natural («беседа открыта»); no confusion with a permission sense in this position.

## Findings
- **RU-N1 (NIT)** `row_label.on_device` «на {device}»: uninflected name after «на» is fine for Latin hostnames, ungrammatical for a Cyrillic noun-like name («на Ноутбук»). Mirrors shipped «На {owner}»; keep — corpus-wide call only if needed.
