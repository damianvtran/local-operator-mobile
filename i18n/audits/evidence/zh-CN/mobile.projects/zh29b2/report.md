# Independent Chinese audit — `mobile.projects` (`zh29b2`)

**Verdict: `changes_requested` — 0 BLOCKER, 1 MAJOR (`ZH-PRJ-1`), 2 MINOR (`ZH-PRJ-2`–`ZH-PRJ-3`); unresolved blocker/major count = 1.** All 15 English/context/zh-CN entries were read and judged.

- **Auditor:** `i18n-auditor` (lopdev team), session `09e9d1711068`. **Actual model: `radient/auto`**, after `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` provider-quota 429 fallbacks; all evidence commands ran under the final model.
- **Translator:** a different agent, `radient/auto` as supplied by the manager; not observed. Independence is agent/session/context, not model diversity (same served model, disclosed).
- **Second independent pass:** job `a163531a0dbd` (`zh-group-B-second-pass`, role `reviewer`, actual `radient/auto`). It independently found the `项目行`/`进度行` calques and `filed_by`; it graded the delete/remove pair MINOR and `filed_by` NIT. This report keeps `delete_body` MAJOR because it is the destructive confirmation's primary object; `remove_milestone_body` and `filed_by` are MINOR. Severity differences are stated, not hidden.
- **Inputs:** en `a598ddc447a47476a54dc0510b156fd4d35d27bf15d79b44850a65a4bf6efc09` · context `5481687e7c4c089cf9ec39175630a5f3f5dd686c041561aceb671083933eed99` · zh-CN `7828e1156d9e6828a581af3735b15833b9c1373a987220c8f64fcb378b0eb309`.
- No translation/MT service, no human native review, no rendered frame.

## Mechanical evidence

- `npm run -s i18n:catalogue:check` → exit 0, projection current (143 keys, 10 namespaces); `node scripts/i18n/check-strings.ts` → 0 new, no growth vs `a57fb8c`.
- JSON valid; **15/15/15** en/zh-CN/context keys; no missing/extra; context parity complete.
- Every message parses; **0** placeholder mismatches; `write_receipt` keeps all four nested selects and every action arm in all three kind arms. `sessions.count` is `other`-only, correct for zh-CN.
- No bidi controls, no ASCII prose punctuation, no Latin prose outside kept names (`Radient`), placeholders, and arm identifiers.
- `milestones.count` has two plain text arguments, no plural — correct because the Chinese noun does not agree with the count.

## Rendered evidence — the app's own parser

### `write_receipt` — all 7 action codes + unknown, × project / milestone / other

| action | project | milestone | other |
|---|---|---|---|
| created | `已创建项目“payments-migration”。` | `已创建里程碑“beta cut”。` | `已创建“payments-migration”。` |
| completed | `已完成项目“payments-migration”。` | `已完成里程碑“beta cut”。` | `已完成“payments-migration”。` |
| reopened | `已重新打开项目“payments-migration”。` | `已重新打开里程碑“beta cut”。` | `已重新打开“payments-migration”。` |
| added | `已添加项目“payments-migration”。` | `已添加里程碑“beta cut”。` | `已添加“payments-migration”。` |
| updated | `已更新项目“payments-migration”。` | `已更新里程碑“beta cut”。` | `已更新“payments-migration”。` |
| removed | `已移除项目“payments-migration”。` | `已移除里程碑“beta cut”。` | `已移除“payments-migration”。` |
| deleted | `已删除项目“payments-migration”。` | `已删除里程碑“beta cut”。` | `已删除“payments-migration”。` |
| archived (unknown) | `已更新项目“payments-migration”。` | `已更新里程碑“beta cut”。` | `已更新“payments-migration”。` |

PASS: every arm is natural verb–object Chinese, ends with the full stop, uses full-width quotes, keeps `{subject}` bare, and contains **no English verb or noun**. The only Latin is the user-supplied subject (`payments-migration`, `beta cut`). Unknown action falls back to `已更新`; unknown kind falls back to the noun-less `已更新“X”。` — both are true and readable.

### Counts

| key | 0 | 1 | 2 | 1 000 000 |
|---|---|---|---|---|
| `sessions.count` | `0 个会话` | `1 个会话` | `2 个会话` | `1000000 个会话` |
| `sessions.live` (base = 2 sessions) | — | `2 个会话 · 1个进行中` | `2 个会话 · 2个进行中` | `2 个会话 · 1000000个进行中` |
| `milestones.count` | `0/0个里程碑` (not used; `milestones.none` covers 0 total) | `1/2个里程碑` | `2/3个里程碑` | `1000000/1000000个里程碑` |

`milestones.count` reads as “1 of 2 milestones” in the row context; the slash+`个` is compact but not misleading here because the noun follows immediately. The second pass read it as fine at every value; it is not scored. `sessions.count` has the same `# 个` spacing question as the schedules plural keys; recorded as a guide ambiguity, not a defect. `sessions.live` is only shown when `live > 0`.

## Findings

### ZH-PRJ-1 — MAJOR — `mobile.projects.delete_body` (destructive wording)

- **Current:** `删除“{name}”？项目行将永久移除。其关联会话和会话记录不受影响。`
- **Problem:** `项目行` is a literal “project row”. On a phone the reader sees cards, not table rows; in a destructive confirmation `行` can suggest only the listing row disappears, while the next sentence talks about what survives. The English “project row” is a data-model noun; Chinese needs the thing, not the widget. `将永久移除` also reads better with an explicit passive.
- **Replacement:** `删除“{name}”？该项目将被永久删除。其关联会话和会话记录不受影响。`
- **Second-pass difference:** graded MINOR there; this pass keeps MAJOR because this is the sentence that authorises an irreversible delete and its object must be unambiguous.

### ZH-PRJ-2 — MINOR — `mobile.projects.remove_milestone_body` (register)

- **Current:** `从此项目中移除“{name}”？该里程碑将永久移除。项目的会话和进度行不受影响。`
- **Problem:** `进度行` is a UI-row calque; the surviving thing is the project's progress record. `该里程碑将永久移除` is understandable UI passive but `将被永久移除` is cleaner in a confirmation. The milestone name and the “what stays” half are otherwise preserved.
- **Replacement:** `从此项目中移除“{name}”？该里程碑将被永久移除。项目的会话和进度记录不受影响。`

### ZH-PRJ-3 — MINOR — `mobile.projects.session_state.filed_by` (terminology)

- **Current:** `由会话提交`
- **Problem:** the field marks the session that **filed** the work, not one that committed/submitted it; core renders the same relay field as `由{ids}登记` (`tui.projects.render.filed_by`). `提交` is also the settled word for *commit*, so the fragment can read “committed by”.
- **Replacement:** `由会话登记`

## Per-key judgement (all 15)

| # | key | Verdict |
|---|---|---|
| 1 | `delete_body` | **ZH-PRJ-1 MAJOR** |
| 2 | `draft_kept_note` | PASS — `已保留上次填写的内容。清空各字段即可重新开始。`; keeps both instructions |
| 3 | `milestone_slash_note` | PASS — names the slash and the consequence; no route/path talk |
| 4 | `milestones.count` | PASS — `{completed}/{total}个里程碑`; both placeholders; reads as 1 of 2 in context |
| 5 | `milestones.none` | PASS — `无里程碑`, lower-case fragment joined with the session count |
| 6 | `project_name_hint` | PASS — exact range and allowed characters; `点` matches core's `cli.teams_help.create_alias` (`点、下划线、连字符`) |
| 7 | `remove_milestone_body` | **ZH-PRJ-2 MINOR** |
| 8 | `session_state.filed_by` | **ZH-PRJ-3 MINOR** |
| 9 | `session_state.missing` | PASS — `缺失`, matches core `tui.projects.render.session_missing` |
| 10 | `session_state.not_running` | PASS — `未运行`, matches core `relay.notifications.detail.from.state` |
| 11 | `sessions.count` | PASS — `other` only; 0/1/2/1 000 000 checked; spacing note |
| 12 | `sessions.live` | PASS — `2 个会话 · 1个进行中`; live count only when non-zero |
| 13 | `stale_badge` | PASS — `进度已过期`; core's word for stale is `已过期` (`tui.review.lane_stale`, `tui.usage.stale`); no change |
| 14 | `write_receipt` | PASS — 8×3 table above; no English; every arm preserved |
| 15 | `write_unknown_note` | PASS — `无法连接此电脑，因此无法确认是否已保存。重试前先检查项目。`; states unknown, never “not saved” |

## Fit — measured

Content width on a 320 pt device is **288 pt** (`Screen` `px-4`); the toast pill gives ~236 pt (16 pt margins + 16 pt padding + glyph column). Type roles: row meta 12/500, body/help 14/400, receipt toast 14/400.

| line | chars | cells | px @100% | available | verdict |
|---|---:|---:|---:|---:|---|
| `projectRowMeta` 2/3 + 2 sessions + 1 live | 23 | 34 | 195.8 | 288 | fits one line, 92 pt spare |
| `projectRowMeta` 12/150 + 120 + 8 | 28 | 39 | 226.6 | 288 | fits one line, 61 pt spare; this row is `numberOfLines=1` |
| `projectRowMeta` none + 2 | 12 | 19 | 109.1 | 288 | fits |
| `write_receipt` reopened milestone | 29 | 38 | 273.6 | 236 | wraps to 2 lines; English comparator `Reopened milestone payments-migration.` is 269.7 pt, so 2 lines there too — no translation-only regression |
| `delete_body` | 47 | 74 | 525.6 | 288 | 2 lines, alert body wraps |
| `remove_milestone_body` | 42 | 74 | 517.0 | 288 | 2 lines, wraps |
| `project_name_hint` | 41 | 78 | 548.7 | 288 | 2 lines, help wraps |
| `write_unknown_note` | 29 | 58 | 406.0 | 288 | 2 lines, wraps |
| `stale_badge` | 5 | 10 | 57.6 | 288 | fits |

No catalogued string is clamped; the only one-line field is the project row meta, which fits at realistic 3-digit counts with 61 pt to spare. At 200% the meta would need two lines and is clamped, but the English meta does the same; it is a pre-existing text-scale layout property, not a Chinese-only overflow. No unbreakable token exceeds the width.

## Notes that are not findings

- **`milestones.count` at 1/2** (`1/2个里程碑`) is compact but readable as 1 of 2 in the row; the second pass agreed. Not scored; if a future style pass wants the ratio unmistakable, `里程碑{completed}/{total}` is the clean noun-first form.
- **`stale_badge`** `进度已过期` is correct by core's own vocabulary; the second pass agreed. Not scored.
- **`sessions.count` spacing** shares the guide's `# 个` ambiguity with the schedules plural keys; not scored.
- **Hardcoded project-detail labels** (`progress`, `milestones`, `linked sessions`, `Add milestone`, `Delete project`, `Name`, `Target date`, `Add`/`Save`, `Remove milestone`, `Back`, `Try again`) are source literals in `src/features/projects/project-detail.tsx`, not catalogue keys. A zh-CN build will keep them English until the strings programme keys them. The prior French audit recorded the same class; excluded from this catalogue audit.

## Gate note

`node_modules/.bin/vitest run src/i18n/__tests__/catalogues.test.ts` fails on this tree at `ships no locale the runtime cannot render`: the directory list is `['en','es','fr','zh-CN']` while `SHIPPED_LOCALES` is `['en','es','fr']`. That is the designed directory-vs-shipped gate (a catalogue directory is not activation), not a copy defect; the wave cannot land green until the `locale.ts` flip (zh-CN shipped, removed from pending) lands with the catalogue after the audits pass. `i18n:catalogue:check` and the strings ratchet are green; the catalogue bytes are untracked at `a57fb8c` and must be committed together with the projection.

## Recording boundary

No `i18n/ledger.json` and no audit-ledger command exist here; `docs/i18n.md` makes the PR report the audit artifact, and this bundle plus `record.json` is the record. Proposed ledger row in `record.json.ledger` is explicitly unwritten. No rendered frame or human native review; the catalogue is untracked at `a57fb8c` and pinned by the target hash.
