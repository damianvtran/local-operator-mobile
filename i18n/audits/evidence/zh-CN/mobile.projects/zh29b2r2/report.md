# Independent Chinese delta audit — `mobile.projects` (`zh29b2r2`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR; 1 MINOR (`ZH-PRJ-4`). `unresolved_blocker_major_count = 0`.**
Round 1 (`zh29b2`) returned `changes_requested` on 1 MAJOR (`ZH-PRJ-1`) and 2 MINOR
(`ZH-PRJ-2`, `ZH-PRJ-3`). Two of the three prescribed replacements are present verbatim; the third
(`remove_milestone_body`) was **rewritten rather than applied**, and the rewrite introduced a
quoting asymmetry with its sibling confirmation. That is the residual MINOR below — it does not
block, and nothing else regressed.

- **HEAD audited:** `d3c39d8d2df2bccc78af82df9253776b4c933ad8` (branch `feat/i18n-chinese`,
  worktree `/Users/damian/workspace/zh-wave`). Tracked tree clean; the only untracked paths were
  peer auditors' bundles (`zh29a1r2`, `zh29a4r2`), untouched here.
- **Auditor:** `i18n-auditor` (lopdev team), session `09de4313fcaa`. **Actual model:
  `radient/auto`**, after `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro`
  provider-quota fallbacks. Every command in `audit.log` ran under the final model.
- **Independence:** different agent/session from the translator; independence is agent and session,
  not model diversity (the translator's supplied model is also `radient/auto`). This round is the
  round-1 auditor re-checking its own findings — a remediation check, **not** an independent second
  pass — and it is not presented as one. No human native review, no rendered UI frame.
- **Inputs:** en `a598ddc447a47476a54dc0510b156fd4d35d27bf15d79b44850a65a4bf6efc09` · context
  `5481687e7c4c089cf9ec39175630a5f3f5dd686c041561aceb671083933eed99` · zh-CN
  `5ca57753a788c9968c8818372477d6e15bc081f9e5240b8489e0803aa1c61825` (round 1 audited
  `7828e115…`, so the file changed).

## Delta: round-1 finding → bytes now

| id | sev. r1 | key | round-1 bytes | HEAD bytes | applied |
|---|---|---|---|---|---|
| ZH-PRJ-1 | major | `delete_body` | `删除“{name}”？项目行将永久移除。其关联会话和会话记录不受影响。` | `删除“{name}”？该项目将被永久删除。其关联会话和会话记录不受影响。` | verbatim |
| ZH-PRJ-2 | minor | `remove_milestone_body` | `从此项目中移除“{name}”？该里程碑将永久移除。项目的会话和进度行不受影响。` | `要从此项目中删除{name}吗？该里程碑将被永久移除。项目的会话和进度记录不受影响。` | **rewritten** |
| ZH-PRJ-3 | minor | `session_state.filed_by` | `由会话提交` | `由会话登记` | verbatim |

Machine-derived from `zh29b2/record.json` (`verify-prescriptions.py` in `audit.log`), not from the
round-1 report's prose. The rewrite kept both round-1 fixes it was aimed at (`进度行` →
`进度记录`, `将永久移除` → `将被永久移除`) and changed a third thing: it swapped
`从此项目中移除“{name}”？` for `要从此项目中删除{name}吗？`, which **drops the full-width quotes**
around the name and switches the question shape. See `ZH-PRJ-4`.

## Rendered evidence — executed through the app's own path

`render.ts.txt` imports `src/i18n/runtime.ts` (`renderFor`) and renders every key from the HEAD
catalogue; nothing is hand-composed here.

### `delete_body` — `{name}` survives, and the destructive halves are intact

| name supplied | zh-CN (executed) |
|---|---|
| `payments-migration` | `删除“payments-migration”？该项目将被永久删除。其关联会话和会话记录不受影响。` |
| `beta cut` | `删除“beta cut”？该项目将被永久删除。其关联会话和会话记录不受影响。` |
| `项目甲` | `删除“项目甲”？该项目将被永久删除。其关联会话和会话记录不受影响。` |

The placeholder survives in every case, quoted with full-width `“ ”` (mainland convention), and the
two load-bearing halves are both present: what the delete destroys (`该项目将被永久删除`) and what
it leaves alone (`其关联会话和会话记录不受影响`). The English says "the project row goes for good";
`项目行` is gone, as ZH-PRJ-1 required, and `该项目` names the thing a phone user sees.

### `remove_milestone_body` — `{name}` survives; wording deviates

| name supplied | zh-CN (executed) |
|---|---|
| `beta cut` | `要从此项目中删除beta cut吗？该里程碑将被永久移除。项目的会话和进度记录不受影响。` |
| `v2.0-rc1` | `要从此项目中删除v2.0-rc1吗？该里程碑将被永久移除。项目的会话和进度记录不受影响。` |
| `里程碑乙` | `要从此项目中删除里程碑乙吗？该里程碑将被永久移除。项目的会话和进度记录不受影响。` |

Meaning is preserved, `{name}` survives, `进度行` → `进度记录` landed, and `被永久移除` landed. The
name is unquoted, unlike its sibling and unlike all 24 `write_receipt` arms.

### `filed_by` and the rest of the namespace

```
session_state.filed_by     由会话登记        (core twin: tui.projects.render.filed_by = 由{ids}登记)
session_state.missing      缺失
session_state.not_running  未运行
sessions.count(2)          2 个会话          (plural, other-only)
sessions.live(2, 1)        2 个会话 · 1个进行中
milestones.count(1,2)      1/2个里程碑
```

`filed_by` now matches core's verb: in the committed zh-CN catalogue, `登记` appears once (in
`tui.projects`) and `提交` 15 times elsewhere (6 files) as *commit/submit*, so the old wording shared a word
with a different concept. `由会话进行`-style calques avoided; the fragment stays two words and stays
a fragment, as its context note requires ("never imply the row is a worker").

### `write_receipt` — 24 executed renderings (regression pass)

All 8 action codes × 3 kinds render as natural verb–object Chinese with a full stop and full-width
quotes, unknown action/kind fall back to `已更新`, and the only Latin is the user-supplied subject:

```
created/project    已创建项目“payments-migration”。      created/milestone  已创建里程碑“beta cut”。      created/other  已创建“payments-migration”。
completed/…        已完成项目“payments-migration”。      … removed/…        已移除…。                    deleted/…      已删除…。
archived/…         已更新项目“payments-migration”。      (unknown → 已更新)
```

The full table is in `audit.log`. Every one of the 24 keeps `“{subject}”` — which is what makes the
unquoted `remove_milestone_body` visible as an outlier.

## Nothing regressed

- **Key parity:** 15/15/15 en · zh-CN · context; no key added or dropped; identical key order.
- **Parameter/structure parity:** 0 parse failures, 0 mismatches. 1 plural node (`sessions.count`)
  and 4 `select` nodes (the `write_receipt` `kind` select plus one `action` select inside each of its
  three arms), all matching English's non-`other` arms and order. Negative controls in the log prove
  each check fires: a dropped placeholder, a renamed select arm, a one-arm plural and a missing
  `plural` all CAUGHT.
- **Plurals:** every arm exactly `["other"]`, matching `Intl.PluralRules("zh-CN")` (`["other"]`).
- **Bidi:** none. **Typography:** full-width `“ ”` `，` `。` and `——` throughout; no ASCII prose
  punctuation beside CJK. The `1-64` range in `project_name_hint` is intentionally ASCII, as in the
  source.
- **Repo gates, executed:** `i18n:catalogue:check` → green (143 keys / 10 namespaces);
  `i18n:strings:check` → `0 new; no growth vs a57fb8cbe161`; `vitest run src/i18n/__tests__` →
  **5 files / 89 tests passed**.

## Finding

### ZH-PRJ-4 — MINOR — `mobile.projects.remove_milestone_body` (quoting convention)

- **Current:** `要从此项目中删除{name}吗？该里程碑将被永久移除。项目的会话和进度记录不受影响。`
  → executed: `要从此项目中删除beta cut吗？…`
- **Problem:** the namespace quotes user-supplied names with full-width `“ ”` — its sibling
  `delete_body` (`删除“{name}”？`) and all 24 `write_receipt` arms (`已创建项目“{subject}”。`) do —
  and this one dialog does not, so two destructive confirmations reached from the same project screen
  render the object differently. It is also the only place the prescribed wording was replaced
  instead of applied. Neither reads wrong; the pair reads inconsistent.
- **Replacement (minimal — keeps the implementer's `要…吗？` shape):**
  `要从此项目中移除“{name}”吗？该里程碑将被永久移除。项目的会话和进度记录不受影响。`
  → `要从此项目中移除“beta cut”吗？该里程碑将被永久移除。项目的会话和进度记录不受影响。`
  That also puts one verb in the dialog (`移除` … `被永久移除`) instead of `删除` … `被移除`.
- **Alternative (round-1 prescription, restores the sibling's terse shape):**
  `从此项目中移除“{name}”？该里程碑将被永久移除。项目的会话和进度记录不受影响。`
- **Why MINOR, not MAJOR:** the object is unambiguous either way, the destructive halves are intact,
  and no meaning shifts. It is a typographic/convention defect, not an unsafe sentence.

## Width / overflow

No `maxCells`/`maxChars` field exists on any entry in these catalogues (budgets appear in note prose
only, in `relay.health`/`mobile.session_health`), so there is no declared budget to exceed.

| string | cells | change vs round 1 | verdict |
|---|---:|---:|---|
| `delete_body` (payments-migration) | 76 | +2 | alert body, wraps to 2 lines of 288 pt |
| `remove_milestone_body` (beta cut) | 80 | +6 | alert body; ~559 pt at round-1's 6.99 pt/cell → 2 lines (576 pt capacity), ~17 pt spare |
| `filed_by` | 10 | n/a | inline meta fragment |
| `sessions.live` (2, 1) | 20 | 0 | row meta |

`remove_milestone_body` is the only string in this delta that grew materially (+6 cells) and it is
the tightest at two lines. It is an alert body that wraps, not a clamped field, so this is recorded
as a margin note rather than an overflow finding; no rendered frame was captured to confirm it.

## Limits

- No UI frame; the two confirmations are copy-only changes. No human native review. No MT service
  used for comparison or back-translation.
- No independent second pass for this delta; the round-1 second pass (`a163531a0dbd`) covered the
  initial translation and graded the delete/remove pair MINOR where this auditor's first pass filed
  `delete_body` MAJOR — that disagreement stands recorded in `zh29b2/report.md`.
- Out of catalogue scope, unchanged: hardcoded project-detail labels (`progress`, `milestones`,
  `linked sessions`, `Add milestone`, `Delete project`, `Back`, `Try again`) live in
  `src/features/projects/project-detail.tsx`, not in the catalogue; a zh-CN build keeps them English
  until they are keyed.

## Recording boundary

`report.md` is judgement; `audit.log` is the actual command output. No `i18n/ledger.json` and no
audit-ledger command exist in this repository, so the ledger row is recorded in `record.json.ledger`
as explicitly unwritten. These bundle files are untracked additions; this audit edited nothing under
`src/` and made no commit.
