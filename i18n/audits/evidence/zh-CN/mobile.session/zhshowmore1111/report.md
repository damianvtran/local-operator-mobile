# Independent i18n audit — zh-CN · `mobile.session.user_message.show_more` / `show_less`

- **Target**: `~/local-operator-mobile` PR #237, head `8fdfb2e9` (base: `origin/main` `fa2bc5e0`), read-only (`git show` only; no edit/commit/push/PR post).
- **Auditor**: agent `i18n-auditor`, session `9bbc570b1c57`, model **`deepseek/deepseek-flash`** (actual run model, no pin overridden, no provider fallback occurred). Independent of the translator (`translator`, `anthropic/claude-sonnet-5-5`) and of earlier auditors. No translation/MT service, no back-translation; all judgement by reading.
- **References read**: `~/local-operator` `origin/main` `i18n/style-guides/zh-CN.md`, `i18n/glossary.md` §1–3, core zh-CN catalogues (`local_operator/i18n/catalogues/zh-CN/*.json`); mobile zh-CN catalogue (`src/i18n/catalogues/zh-CN/`, all 21 namespaces), the en values + `mobile.session.context.json` sidecars at the head, and the call site `src/features/session/components/user-message-clamp.tsx`.

## Verdict

**clean-with-findings** → ledger `passed`
counts: **blocker 0 · major 0 · minor 1 · nit 2** (nits are recorded alternatives, no action required)

## What actually ships at the head (a finding in itself)

The lane brief called these "two English-only keys". They are not English-only in zh-CN: the PR head **already carries zh-CN values**, and they are *not* the pair the translator's record names.

| key | en (head) | zh-CN **shipped at head** | lane scratchpad transcription |
|---|---|---|---|
| `mobile.session.user_message.show_more` | Show more | **显示更多** | 展开 |
| `mobile.session.user_message.show_less` | Show less | **收起** | 收起 |

Read from `git diff origin/main 8fdfb2e9 -- src/i18n/catalogues/zh-CN/mobile.session.json`, which adds exactly these two lines. The scratchpad notes say the translator chose 展开 and "rejected 展开更多"; the file says 显示更多. One record is wrong. Copy as shipped is sound (see F1–F3); the ledger must state the value actually shipped.

## 1. Mechanical

| check | result |
|---|---|
| JSON validity, both head files | PASS (parsed) |
| key parity vs en `mobile.session.json` | PASS — 65 / 65, no key added or dropped |
| placeholders / ICU braces | PASS — none (`role: button`, no args in either locale) |
| markup, Rich tags, backticks, commands, flags, identifiers | PASS — none |
| sidecar presence | PASS — `role` + `note` for both keys; **no `maxCells`** on either key (confirmed programmatically: `['role','note']`) |
| Latin characters in value | PASS — zero (U+663E U+793A U+66F4 U+591A / U+6536 U+8D77) |
| bidi controls (U+202A–202E, U+200E/F, U+061C, U+2066–2069) | PASS — none (n/a for zh-CN, checked anyway) |
| NFC | PASS — both values `is_normalized('NFC')` true |
| leading/trailing space, sentence-final 。 | PASS — none (style guide: no 。 on labels) |
| full-width punctuation in a 2–4 char control | PASS — none present, none needed |
| repo validator `npm run -s i18n:check` | **NOT RUN** — it needs the PR head checked out and `generate.ts` writes into the tree; this audit is read-only from `git show` blobs. Its mechanical checks were reproduced by script instead. |

## 2. Accuracy

PASS. 显示更多 = "show more", 收起 = "put away / collapse" — the clipped-message meaning is preserved, no omission, addition or polarity error. Neither is destructive/permission/error copy; used identically as the visible label and the `accessibilityLabel` (both `t()` calls resolve the same key), with `accessibilityState={{ expanded }}` carrying the state, so the label does not need to say both directions.

## 3. Idiom, register, pair as a control

- Register: 你-voice, terse, verb-first, no 您, no particles — matches the zh-CN guide.
- Both read as **controls, not labels**: they are verb phrases with no trailing punctuation, centred under the clamped text.
- Pair symmetry: one is verb+quantity (显示更多), the other bare verb (收起). Chinese UIs do pair them this way (Apple's zh copy does), and the sibling `vi` pair shipped in the same PR is asymmetric too (`Xem thêm` / `Thu gọn`), so asymmetry is not a defect here — recorded in F2/F3 as an alternative, not a gate.

## 4. Terminology / precedent (the substantive question)

`grep` over all 21 zh-CN mobile namespaces + the core zh-CN catalogues:

| precedent | string | en |
|---|---|---|
| **mobile** `mobile.schedules.show_more.monitors` | 再显示#个监控 | Show # more monitors |
| **mobile** `mobile.schedules.show_less.monitors` | **收起**部分监控 | Show fewer monitors |
| **mobile** `mobile.schedules.show_less.wakes` | **收起**部分唤醒 | Show fewer wakes |
| **mobile** `mobile.team_bridge.default_on.hide` | **收起**详情 | Hide details |
| **mobile** `mobile.chrome.composer.dismiss_keyboard` | **收起**键盘 | Dismiss keyboard |
| core `tui.small.todo_panel.expand` / `.collapse` | ctrl+t**展开** / ctrl+t**折叠** | expand / collapse |
| core `tui.chrome.bindings.legend_app_ctrl_t` | **展开**或折叠待办面板 | Expand or collapse the todo panel |
| core `tui.analytics.hint.expand.compact` | enter**展开** · e全 | enter expand |
| core `relay.notifications.empty.caught_up.show_all` | **显示**全部通知 | Show all notifications |
| **mobile** `mobile.home.tip.parallel` | 要求并行工作以**展开**多个子智能体 | …to fan out subagents |

Reading: this catalogue already pairs **显示**(reveal more) with **收起**(put away) for exactly a show-more/show-less family (`mobile.schedules`), and the mobile locale never uses 展开 as an expand toggle — its one 展开 is the *fan out* sense. Core's 展开/折叠 is the panel-keybinding family, not a message clamp. So the shipped 显示更多/收起 is **consistent with the mobile zh-CN catalogue's own show_more/show_less pairing**, and 展开 is not a violated glossary term (the glossary and the zh-CN guide list no expand/collapse row — "Prefer settled Chinese where it exists" is satisfied by 显示 here).

## 5. Fit / width (measured, not eyeballed)

Call site: full-width `Pressable` (`w-full items-center justify-center`, `minHeight TOUCH_FLOOR` = 44) inside the bubble; label is `text-meta` = **12 px / weight 500** (`src/ui/theme.css:117`); bubble is `max-w-[85%]` + `px-3` (`src/features/session/user-bubble.ts`).

| value | chars | cells (EAW W/F = 2) | ≈ width @12 px | budget |
|---|---|---|---|---|
| 显示更多 (shipped) | 4 | **8** | ~48 pt | 14-char / ≈14-cell pill budget → PASS, ~1.75× under |
| 展开 (alternative) | 2 | 4 | ~24 pt | PASS |
| 收起 | 2 | 4 | ~24 pt | PASS |

At a 320 pt phone, row 288 pt → bubble ≤ 244.8 pt → content ≤ ~221 pt; at 2× accessibility text scale 显示更多 is ~96 pt, still inside. No `numberOfLines` cap and no fixed pill width, so neither value can truncate; the full-width pressable removes pill-overflow risk entirely. **Width is a non-issue for either candidate** — the brief's 14-character pill concern does not bind at this call site.

## 6. RTL / script

n/a for RTL (zh-CN is LTR). Han only, both values are common GB2312-level characters (显 示 更 多 / 收 起), no variants or simplified/traditional mixing (显 U+663E is simplified 显; traditional 顯 not used). No combining marks, no wide-glyph width risk in terminals beyond the 2-cells-per-char rule already counted.

## 7. Nothing left English

Both keys: no Latin, no English. Whole-locale cross-check at the head (all 21 namespaces, en vs zh-CN): exactly 6 values are byte-identical to English, and every one is legitimate — `Radient` (product name), `topic-name`, `my-project`, `ios, q4` (technical placeholders), `{head} · {label}` (separator format), `Team Bridge` (surface name). **No English leakage in zh-CN at this head** (out of scope for findings; supports the operator's "no English anywhere" acceptance for this locale).

## 8. Negative control (checker must bite)

In-memory mutations of `show_more`, run through the same checker used above:

| mutation | checker output |
|---|---|
| `""` (empty) | `['empty']` |
| `显示 more` (Latin leftover) | `['latin']` |
| `Show more` (identical to English) | `['latin', 'identical to English']` |
| `显示更多 ` (trailing space) | `['leading/trailing space']` |
| `显示{count}更多` (stray placeholder) | `['latin', 'markup/placeholder/backtick']` |
| `显示\u200f更多` (bidi control) | `['bidi control']` |
| `显示更多。` (final full stop) | `['final 。']` |
| control: `显示更多`, `展开`, en values | `[]` (only en flags latin+identical, as it must) |

The checker detects each class; the clean result for the real values is therefore a reading, not a silent pass.

## Findings

**F1 — MINOR (provenance, not copy) · `show_more`** — shipped `显示更多` vs the translator's recorded `展开`. The copy is publishable as it stands; the *record* is not. Fix one side before the ledger row: keep `显示更多` and correct the translator note (recommended — see F2/F3), or ship `展开` and say so. Current text: `显示更多`. Nothing unsafe either way.

**F2 — NIT (alternative, no action) · `show_more`** — if the team ever wants the canonical Chinese text-clamp pair and the shortest string, the exact replacement is **`展开`** (2 cells-chars, 4 cells; matches core's 展开 for expand). *Not requested*: `显示更多` matches this catalogue's own `show_more`/`show_less` pair in `mobile.schedules` (再显示N个… / 收起部分…), so precedent beats taste and the shipped value wins.

**F3 — NIT (record) · `show_more`** — 展开 already carries the *fan out* sense in `mobile.home.tip.parallel` ("…以展开多个子智能体"); giving one word two senses in the same app family is a further reason to keep `显示更多` rather than adopt F2.

## Hashes (SHA-256)

Sorted-key JSON of the two pairs, `ensure_ascii=false`, compact separators:

- English pair (`Show more` / `Show less`): `26d065694437406a3aebff2dd163d08f6d1b3afa1ad51701630f2e4ab6ec9022`
- **Shipped candidate, as in the head file** (`显示更多` / `收起`): `4b45271ef0e084dd6947c00e5794bc34a22aaabc12e3ff058aa5bcdd317dba0e`
- Transcribed candidate (`展开` / `收起`): `6f574035f643e45744ec2379614d059ca9d5162f82290825dab26a198e0599b1`

Head blobs (git show, byte-exact): `en/mobile.session.json` `143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0`; `en/mobile.session.context.json` `ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102`; `zh-CN/mobile.session.json` `efa6c940407869667c953c5b96c75ccb80aa18ade8695f66669cbd6cb244561f`.

## Ledger row (not written — this audit is read-only)

```json
{
  "locale": "zh-CN",
  "namespace": "mobile.session",
  "source_sha256": "143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0",
  "auditor": {"agent": "i18n-auditor", "model": "deepseek/deepseek-flash", "date": "2026-11-11", "result": "passed", "findings": 1},
  "status": "passed",
  "note": "2 keys; shipped 显示更多/收起, 8+4 cells, no maxCells, full-width button. 1 MINOR: file value ≠ translator note (展开); fix record. 2 nits: 展开 alt (mobile.schedules precedent favours 显示更多). Evidence i18n/audits/evidence/zh-CN/mobile.session/zh-showmore-11/"
}
```

Note is 248 chars (≤280) and agrees with this report. A record bundle (`record.json` + `audit.log`) under `i18n/audits/evidence/zh-CN/mobile.session/zh-showmore-11/` is the manager's/coder's write to land — I did not create it (read-only), and this scratchpad file is not the served artifact of record.
