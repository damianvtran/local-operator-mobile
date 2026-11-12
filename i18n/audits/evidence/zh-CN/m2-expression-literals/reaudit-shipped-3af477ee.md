# M2 expression-literal slice — independent re-audit, locale `zh-CN`

Auditor `i18n-auditor`, session `7c919c925a92`, served model `deepseek/deepseek-flash`
(session header; no fallback observed). Independent of the translator
(`i18n-translator`, `openai/gpt-6.1-sol`) and of every earlier auditor; fresh instance,
read-only, no translation/MT service used. Note for disclosure: R1-A and R2 also ran
`deepseek/deepseek-flash`; different sessions, and this verdict is derived from the
shipped bytes, not their reports.

Repo `~/local-operator-mobile`, worktree `~/local-operator-mobile/.worktrees/i18n-m2-scanner`,
HEAD `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a` (PR #236). Base `fa2bc5e0`.

## Verdict

**clean-with-findings** — blocker 0 · major 0 · minor 1 · nit 4.
One MINOR is a carried, still-open fit risk (non-gating); no BLOCKER/MAJOR remains, so the
ledger status for this file group is `passed`.

## 1. What was audited (33 keys, shipped bytes)

`git diff fa2bc5e0..HEAD -- src/i18n/catalogues/zh-CN` = 36 insertions / 3 deletions across
three namespaces: `mobile.computers` +4, `mobile.session` +15, `mobile.settings` +14 = 33
new keys. Only one commit touched these files (`6b539d7a`); `17e9e0f6` (docs) and
`3af477ee` (content pins, `tools/audit/u08-content-pins.ts` only) did not. The shipped
values are therefore the ones committed with the slice.

Key parity vs `en` (whole files, not just the 33): settings 59/59, computers 45/45,
session 78/78 — no key added or dropped.

## 2. Provenance: which version the last auditor read, and does the shipped text equal it?

| Evidence | Value |
|---|---|
| `zh-CN/m2-expression-literals/final.json` raw SHA-256 | `14902070cb57b05d0cf776adabe1a3d74198391c837eb7be91b85633faaba739` |
| Hash round 3 names as its input (`round3.md` §Inputs) | `14902070cb57b05d0cf776adabe1a3d74198391c837eb7be91b85633faaba739` — identical |
| `NOTE-m2-expression-literals.md` original vs committed SHA for that file | identical (`14902070…` / `14902070…`), i.e. not normalised |
| Canonical SHA-256 of the **shipped** 33 zh-CN key/value pairs | `7eb211fa65966ee1e15bb5ddd6457a84d43177fc51218f8c746c0bd5016e15fc` |
| Canonical SHA-256 of `final.json`'s 33 pairs | `7eb211fa65966ee1e15bb5ddd6457a84d43177fc51218f8c746c0bd5016e15fc` — identical |
| Per-key comparison shipped vs `final.json` | 33 keys, **0 differing values** |

Conclusion, derived by comparison and not from any report's claim: the last round
(`round3.md`, `anthropic/claude-sonnet-5-5`, session `4cc8e99d0283`) read the exact bytes
whose 33 values are shipped. The v4 rename and the three v4 value changes are in the
catalogue. **No unaudited new text.** (Its `v3` hash `31d8f924…` is unverifiable here —
the v3 candidate is not in the repo — but v3 is not what shipped, so it does not bind.)

Caveat carried from the evidence bundle: round 3 was a *delta* audit (v3→final, 6 entries);
the other 27 values rest on rounds 1–2. This report re-audits all 33 on their merits, which
is the gap the task named.

## 3. Mechanical (repo validator run, then verified independently)

- `node scripts/i18n/generate.ts --check` → exit 0, actual stdout:
  `src/i18n/catalogue.gen.ts is current (684 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`
  (a `MODULE_TYPELESS_PACKAGE_JSON` warning was emitted; no generated files written).
- Placeholder names/types identical to English for all 33 (`{host}`, `{name}`, `{baseUrl}`,
  `{percent}`, `{labels}`) — 0 mismatches.
- ICU: none of the 33 English values contains `plural`/`select`/`selectordinal`, and none was
  introduced in zh-CN; the locale's CLDR arm set (`other` only) is therefore vacuously satisfied.
  No plural branch was added.
- Markup/code/flags/identifiers: no `<…>`/Rich tags or backticked spans in this slice; nothing
  altered. `{baseUrl}`, `{host}` stay left-to-right inside the Chinese run.
- Valid JSON in all three files; no empty or edge-whitespace values; all NFC; no ASCII
  punctuation in prose (only `%`, `·`, `↑`, `↓` and the full-width `。，（）`).
- Leftover Latin runs across the 33: only `Local Operator` (glossary §1, keep), `Radient`
  (sidecar: product name, keep Latin) and the placeholders. **No English left untranslated.**

### Negative control (checker must bite)

Same checker run on an in-memory mutation of the shipped map — `mobile.session.tray.context`
`{percent}`→`{pct}`, and `mobile.session.back_to` reverted to `Back to {name}`:

```
('mobile.session.tray.context', 'placeholder mismatch', ['percent'], ['pct'])
('mobile.session.back_to', 'identical to English', 'Back to {name}', 'Back to {name}')
```

Both flagged; unmutated map returned `[]`. The checker is not vacuous.

## 4. Renamed region-label keys (item 5 of the brief)

Key names in the shipped catalogues: `mobile.session.region.label_working`,
`label_subagents`, `label_todos`, `label_strip` — matching the sidecar
(`src/i18n/catalogues/en/mobile.session.context.json`), the English catalogue, the generated
`src/i18n/catalogue.gen.ts` (lines 398–401, 1034–1037, 1673–1676, 2376–2379) and the call
sites `app/(app)/session/[id].tsx:1100–1103` (`working / subagents / todos / strip` map).
Values are attached to the right English source: 动态=activity, 子智能体=agents, 任务=tasks,
状态=status. The `.`-dotted forms the ru audit blocked appear nowhere.
`src/i18n/__tests__/expression-literals.test.ts:109` builds `label_${k}` and asserts
`["activity","agents","tasks","status"]`, so the names are pinned by a test as well as by code.

## 5. Findings

**MINOR-1 (carried from R3 MINOR-A, still open, non-gating — fit unproven)**
`mobile.session.tray.context_short_estimate` = `上下文{percent}%（约）` — 15 cells at 21 %,
16 at 100 %. The code's own D17 anchors (`app/(app)/session/[id].tsx:1008–1012`) state that
`21% context (est.)` (18 cells) wraps to two lines inside the band under 340 pt and the
abbreviated `21% ctx (est.)` (14 cells) fits. 15 sits between a proven fit and a proven wrap,
so the narrow chip's fit is arithmetic, not rendered. Needs one rendered <340 pt frame with
the cost and subagents chips present (design/QA), or an explicit acceptance. Not a wording
defect, hence non-gating.

**NIT-1 (carried R3 NIT-A)** `mobile.session.tray.context_short` = `上下文{percent}%` is
byte-identical to `mobile.session.tray.context`. No width is saved by the narrow key in zh-CN
(9 cells either way, vs 11/14 in English) because Chinese has no native short form for
"context" and 上下文 is the shipped term (25 core occurrences, `ctx` 0). Correct per the
sidecar's "full word if none exists"; record it so it is not read later as an omission.

**NIT-2 (carried R3 NIT-B)** the estimate marker differs between the pair: `（估算）` wide vs
`（约）` narrow. `（估算）` matches shipped precedent (`tui.import.preview_summary`); a
parenthetical `（约）` has none (`约`=about appears attributively in core). Meaning is right and
the narrow form is deliberately 2 cells shorter (17 → 15), so keep — noted for the ledger.

**NIT-3 (new)** `mobile.settings.diagnostics.stream_degraded` = `未响应` is the same word as
`mobile.settings.status.not_answering` = `未响应`, while English keeps two different words
("degraded" / "Not answering") and core zh-CN renders "degraded" as `降级`
(`wire.settings…会被降级`). The sidecar defines the degraded state as "open but not answering",
and `relay.chrome.session.subtitle.not_answering` ships `未响应`, so the choice is defensible
and the five stream words stay distinct (空闲 / 连接中 / 在线 / 未响应 / 离线). Suggestion if a
future wave wants strict parity with core: `降级`. No change required now.

**NIT-4 (new, optional polish)** `mobile.session.region.below_labels` = `{labels}在下方 · 向下滚动 ↓`
— with several labels joined (`动态 · 子智能体 · 任务 · 状态在下方`) the postfix attaches to the
last item syntactically, though it reads as the whole list and mirrors the English shape. If
ever revisited: `{labels}均在下方 · 向下滚动 ↓` (+2 cells) or `下方：{labels} · 向下滚动 ↓`.
No change required.

## 6. Judged and found correct (no finding — recorded so the manager does not re-open them)

Direction of the cues: `已到底部 · 向上滚动 ↑` and `下方还有内容 · 向下滚动 ↓` / `{labels}在下方 · 向下滚动 ↓`
— at the end scroll up, for hidden content scroll down: correct, arrows not mirrored.
Register: 你 throughout, no 您, no 啦/哦/呀/！, no sentence-final 。 on status/meta/button/heading
roles, full stops only on the three full sentences (`host_answering`, `answering`, `connected_to`),
per the zh-CN style guide. Terminology: 会话 (session), 子智能体 (subagent), 智能体 (agent),
任务 (tasks), 中继 (relay), 状态 (status) all match the glossary and shipped mobile copy
(`mobile.session.status_tray.hint`, `sheet_title.status`, `relay.chrome.session.tray.tasks`).
`在线` for "live" matches shipped `relay.health.live` in both repos. `Local Operator` and
`Radient` kept as product names. `未登录` / `尚未连接` / `未连接` are three distinct negatives for
three distinct English states (no polarity error). No space inserted between Chinese and
Latin runs — as the style guide requires, including `已直连{baseUrl}`. No RTL (zh-CN).

## 7. Identity, hashes, limits

Canonicalisation for the pair hashes:
`sha256(json.dumps(d, ensure_ascii=False, sort_keys=True, separators=(',',':')).encode('utf-8'))`
over the 33 key/value pairs.

- shipped target values (33 pairs): `7eb211fa65966ee1e15bb5ddd6457a84d43177fc51218f8c746c0bd5016e15fc`
- English source values (same 33 keys): `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528`
- `en/mobile.settings.json` `d7e1d85b…`, `en/mobile.computers.json` `71382783…`,
  `en/mobile.session.json` `8df14a0d…`
- `zh-CN/mobile.settings.json` `db364cb8…`, `zh-CN/mobile.computers.json` `b6f9e5bf…`,
  `zh-CN/mobile.session.json` `224ee100…`
- context sidecars: `settings 67691ab9…`, `computers cc297300…`, `session a988f1c9…`
- `final.json` `14902070…` · `round3.md` `9e41c7cc…` · `translator-v4-changes.md` `616a0319…`
  (the NOTE's `e38e3510…` is its pre-normalisation original — documented prefix/whitespace
  normalisation, not a content change)

Limits, stated plainly: no app build, no rendering, no native/device run — widths are
arithmetic (`east_asian_width`, 2 cells for W/F) replaced at 21 %/100 %, not measured points;
the three source `.context.json` sidecars carry only `role`/`note` and no `maxCells`, so fit is
judged against the code's D17 anchors. The v3 candidate is not in the repo, so its hash claim
is unreproducible (not needed: v4 is what shipped). Read-only mandate honoured: no repo edits,
commits or pushes, **no ledger row and no evidence record written by me** — the manager's
`passed` row should cite this report and the hashes above (locale `zh-CN`, namespace
`m2-expression-literals`, 33 keys, source `c326a93f…`, target `7eb211fa…`).
