# Independent Chinese delta audit — `mobile.schedules` (`zh29b1r2`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR; 2 NIT. `unresolved_blocker_major_count = 0`.**
Round 1 (`zh29b1`) returned `changes_requested` with 3 MAJOR (`ZH-SCH-1`–`3`) and 2 MINOR
(`ZH-SCH-4`–`5`). All seven affected keys were re-read against the HEAD bytes and re-rendered
through the app's own render path. Every prescribed replacement is present verbatim
(`verify-prescriptions.py` in `audit.log`, `APPLIED VERBATIM` ×7). Nothing regressed.

- **HEAD audited:** `d3c39d8d2df2bccc78af82df9253776b4c933ad8` (branch `feat/i18n-chinese`,
  worktree `/Users/damian/workspace/zh-wave`). Tracked tree clean; the only untracked paths were
  peer auditors' bundles (`zh29a1r2`, `zh29a4r2`), untouched by this audit.
- **Auditor:** `i18n-auditor` (lopdev team), session `09de4313fcaa`. **Actual model:
  `radient/auto`.** This request began on `anthropic/claude-sonnet-5-5` and fell back through
  `openai/gpt-6-astra` and `kimi/k3.1-pro` on provider quota before reaching `radient/auto`; every
  command in `audit.log` ran under the final model. Disclosed, not hidden.
- **Independence:** different agent, session and context from the translator (a separate agent —
  independence is agent/session, not model diversity, and the translator's supplied model is also
  `radient/auto`). This delta round IS the round-1 first-pass auditor re-checking its own findings
  across a new session: that is a remediation check, **not** an independent second pass, and it is
  not presented as one. No human native-speaker review and no rendered UI frame are claimed.
- **Inputs:** en `0459a0485ceb2594c60a152a8dbdc5035689ade05ac370134f8e37be6abc575f` · context
  `d3f0d3bba057aacf4d3495b3d5eec2471d66b6d6c011b50834a1f58a0839aa92` · zh-CN
  `6f138a280fdf857cec41acb334a9477ab84ec4381f8c37b1480a08251ea7969c` (round 1's audited target was
  `12e5fd82…`, so the file did change).

## Delta: round-1 finding → bytes now

| id | severity r1 | key | round-1 bytes | HEAD bytes | applied |
|---|---|---|---|---|---|
| ZH-SCH-1 | major | `head.next` | `{head} · 下次{label}` | `{head} · 下次：{label}` | verbatim |
| ZH-SCH-2 | major | `summary.monitors_attention` | `{broken}/{total}个需要处理` | `{broken}/{total}项需要关注` | verbatim |
| ZH-SCH-3 | major | `supervisor.not_running` | `唤醒监管程序已安装但未运行，因此下方唤醒不会触发。` | `唤醒监督者已安装但未运行，因此以下唤醒不会触发。` | verbatim |
| ZH-SCH-3 | major | `supervisor.unsupported` | `此平台尚未支持唤醒监管，因此下方唤醒仅在对话运行时触发。` | `此平台尚不支持监督唤醒，因此以下唤醒仅在对话运行时触发。` | verbatim |
| ZH-SCH-3 | major | `supervisor.unverifiable` | `下方唤醒没有监管程序，因此仅在其对话运行时触发。` | `以下唤醒没有监督者，因此仅在其对话运行时触发。` | verbatim |
| ZH-SCH-4 | minor | `tail.failed` | `{count}个失败` | `{count}次失败` | verbatim |
| ZH-SCH-5 | minor | `truncated` | `显示{shown}/{total}个设有{family, select, wakes {唤醒} other {监控}}的对话。` | `显示{shown}/{total}个含{family, select, wakes {唤醒} other {监控}}的对话。` | verbatim |

The comparison is machine-derived from the round-1 `record.json` `current`/`replacement` fields,
not from the prose in the round-1 report.

## Rendered evidence — executed through the app's own path

`render.ts.txt` is the harness. It does **not** mirror the copy: it imports
`src/i18n/runtime.ts` (`renderFor`, `setLocaleSource`) and the real composition functions
`dueLabel` / `nextDueClause` / `wakeCountClause` / `monitorCountClause` from
`src/features/schedules/schedules-copy.ts`, with the locale source set to `zh-CN`. English
comparands are produced by the SAME functions with the source switched to `en`, so a difference
in the table is a difference in the catalogue, not in a hand-written comparator.

### `head.next` — future due, and the overdue branch it must not take

| input | zh-CN (executed) | en (same functions) |
|---|---|---|
| 1 wake, +240 s | `1 个唤醒 · 下次：4m后` | `1 wake · next in 4m` |
| 3 wakes, +60 s | `3 个唤醒 · 下次：60s后` | `3 wakes · next in 60s` |
| 5 wakes, +240 s | `5 个唤醒 · 下次：4m后` | `5 wakes · next in 4m` |
| 3 monitors, +240 s | `3 个监控 · 下次：4m后` | `3 monitors · next in 4m` |
| 3 wakes, −7 200 s | `3 个唤醒 · 已逾期2h` (via `head.overdue`) | `3 wakes · 2h overdue` |
| 5 wakes, −259 200 s | `5 个唤醒 · 已逾期3d` (via `head.overdue`) | `5 wakes · 3d overdue` |

`dueLabel` renders `4m后` / `已逾期2h` in zh-CN and `in 4m` / `2h overdue` in en — executed, both
locales. The colon separates the two forward expressions that round 1 flagged as a splice:
`下次：4m后` no longer reads “next 4m later". Fed an overdue-shaped label directly, `head.next`
would print `下次：已逾期2h`; the app routes overdue instants to `head.overdue` (`3 个唤醒 · 已逾期2h`),
and the harness exercises that branch too.

### `summary.monitors_attention`

| ratio | zh-CN | en |
|---|---|---|
| 1/3 | `1/3项需要关注` | `1 of 3 need attention` |
| 2/3 | `2/3项需要关注` | `2 of 3 need attention` |
| 0/3 · 3/3 | `0/3项需要关注` · `3/3项需要关注` | `0 of 3…` · `3 of 3…` |
| 1 000 000 / 1 000 000 | `1000000/1000000项需要关注` | `1000000 of 1000000 need attention` |

`项` is the item classifier the guide asks for after a ratio, and it matches core's committed twin
`{shown}/{total}项需要关注` (`tui.small`, 1 occurrence in core's zh-CN at HEAD; `项需要处理`: 0).

### The three supervisor notices

```
唤醒监督者已安装但未运行，因此以下唤醒不会触发。            (not_running, 48 cells)
此平台尚不支持监督唤醒，因此以下唤醒仅在对话运行时触发。    (unsupported, 56 cells)
以下唤醒没有监督者，因此仅在其对话运行时触发。              (unverifiable, 46 cells)
```

One noun, `监督者`, matching core's committed zh-CN (14 occurrences in 4 files:
`cli.wake_help` 8, `cli.browser` 2, `cli.exec_help` 2, `wire.exec` 2). `监管` survives once in core
and only as a verb (`tui.schedule`); the phone no longer uses it as a noun. `以下` replaces the
spatial calque `下方`. The three keep their ORDERING semantics: installed-but-stopped must not be
confused with "nothing supervises" — the zh wording keeps that distinction (`没有监督者` never
claims the supervisor is installed).

### `truncated`, both families

```
wakes    3/10 -> 显示3/10个含唤醒的对话。        en: Showing 3 of 10 conversations with wakes.
monitors 3/10 -> 显示3/10个含监控的对话。        en: Showing 3 of 10 conversations with monitors.
```

`含` (contains) replaces `设有` (a facilities verb); the `family` select keeps both arms, `other`
included, and the arm set matches en exactly.

## Nothing regressed

- **Key parity:** 38/38/38 en · zh-CN · context; no key added or dropped; identical key order.
- **Parameter/structure parity:** 0 parse failures, 0 mismatches (placeholder names and kinds,
  plural count, select count, per-select non-`other` arm sets). Negative controls in the log prove
  each check can fail: a `one` arm CAUGHT, a dropped placeholder CAUGHT, a renamed select arm
  CAUGHT, a dropped plural CAUGHT.
- **Plurals:** 4 plural nodes inspected, every arm exactly `["other"]`;
  `Intl.PluralRules("zh-CN").resolvedOptions().pluralCategories` = `["other"]`, and
  `.select()` returns `other` for 0/1/2/3/1 000 000. Collapsing en's `one`/`other` is correct here.
- **Bidi:** no LRM/RLM/ALM, no U+202A–202E, no U+2066–2069 (regex proven live by a negative control).
- **Typography:** no ASCII `,.?!;:` adjacent to CJK; no `您`; no `！`; the only Latin runs are the
  kept terms and ICU arm identifiers.
- **Repo gates, executed:** `i18n:catalogue:check` → `catalogue.gen.ts is current (143 keys, 10
  namespaces …)`; `i18n:strings:check` → `284 finding(s), all baselined; 0 new; no growth vs
  a57fb8cbe161`; `vitest run src/i18n/__tests__` → **5 files / 89 tests passed** (round 1 could not
  get this green: the directory-vs-`SHIPPED_LOCALES` gate was red until the locale flip landed; it
  is green now, `SHIPPED_LOCALES = ["en","fr","es","zh-CN"]`).

## Findings

### ZH-SCH-6 — NIT — `mobile.schedules.supervisor.unsupported` (parallelism)

- **Current:** `此平台尚不支持监督唤醒，因此以下唤醒仅在对话运行时触发。`
- **Problem:** the sibling notices use the noun `监督者`; this one uses `监督唤醒`, which reads as
  a verb-object and breaks the noun parallelism the ZH-SCH-3 fix established. Understandable, and
  the meaning is right — this is polish, not a defect that misleads.
- **Suggested:** `此平台尚不支持唤醒监督，因此以下唤醒仅在对话运行时触发。` (noun phrase, same
  meaning, same length class) — or leave as-is if the programme prefers the verb form.

### ZH-SCH-7 — NIT — optional terser head line

- **Current:** `3 个唤醒 · 下次：4m后` (accepted).
- **Note:** `4m后` already carries futurity, so `{head} · {label}` (`3 个唤醒 · 4m后`) remains a
  valid terser alternative that drops "next". The colon form keeps the source's "next" and is what
  the round-1 prescription asked for; recorded as an option, not a change request.

### Carried, not scored

- **`# 个` spacing.** `count.wakes`/`count.monitors` render `1 个唤醒` with a space, while
  `summary.wakes` (`3个已定时`), `show_more.*` (`再显示2个唤醒`) and `tail.failed` (`3次失败`) do not.
  The style guide forbids a space between digits and CJK, yet its own plural example shows `# 个会话`.
  A programme-level style decision, unchanged by this delta; the round-1 report already logged it.

## Width / overflow

No `maxCells` budget is attached to any entry in this namespace. Across all ten namespaces
(`en/<ns>.json` with `en/<ns>.context.json`) the sidecars carry only `role` and `note` — there is no
machine-readable `maxCells`/`maxChars` field anywhere, and width budgets appear only in note prose
(`relay.health`, `mobile.session_health`); this namespace has none. Measured as cells (2 per
CJK/full-width glyph, 1 per ASCII) and compared with the round-1 metric measurements:

| key | r1 cells | now cells | Δ | verdict |
|---|---:|---:|---:|---|
| `head.next` (3 wakes) | 19 | 21 | +2 | one line, ~127 pt of a 276 pt row |
| `summary.monitors_attention` (1/3) | 13 | 13 | 0 | inline status |
| `supervisor.not_running` | 50 | 48 | −2 | wraps, 2 lines |
| `supervisor.unsupported` | 56 | 56 | 0 | wraps, 2 lines |
| `supervisor.unverifiable` | 48 | 46 | −2 | wraps, 2 lines |
| `truncated` (3 of 10) | 26 | 24 | −2 | one line, ~145 pt |
| `tail.failed` | 13 | 7 | −6 | inline tail |

Nothing here is clamped: these are wrapping paragraphs and inline status fragments, and no single
unbreakable token exceeds the 288 pt content width. No rendered frame is claimed; pixel figures are
round-1 AppKit measurements scaled by the cell delta and labelled as estimates.

## Limits

- No UI frame captured; this is a copy audit, and the two composition defects it checks are
  string-level. The delta changes no layout affordance.
- No human native-speaker review. No translation/MT service was used to compare or back-translate.
- No independent second pass was run for this delta (the manager did not request one for this
  round). The round-1 second pass (`a163531a0dbd`) covered the initial translation only, and it
  judged `head.next` acceptable where this auditor filed MAJOR — that disagreement is recorded in
  the round-1 report, not reopened here.
- Source-level, out of catalogue scope and unchanged: `src/features/schedules/schedules.tsx` still
  composes section headers with hardcoded English (`Wakes · …`, `Monitors · …`) and the screen title
  `Schedules`. A zh-CN build shows mixed-language headers until those literals are keyed; this is a
  strings-programme task, not a catalogue defect, and the fr/es audits recorded the same class.

## Recording boundary

`report.md` is judgement; `audit.log` is the executed command output. This repository has no
`i18n/ledger.json` and no audit-ledger command (verified: `i18n/` holds only `audits/`, the locale
directories live under `src/i18n/catalogues/`, and `docs/i18n.md` / `AGENTS.md` name no ledger);
the proposed ledger row is recorded in `record.json.ledger` and explicitly unwritten. These bundle
files are untracked additions — this audit made no edit to `src/` and no commit.
