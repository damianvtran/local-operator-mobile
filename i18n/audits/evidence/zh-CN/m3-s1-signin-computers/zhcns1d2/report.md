# zh-CN — M3 S1 (mobile.computers + mobile.signin) — DELTA audit (v2 draft)

**Verdict: `passed`** — no BLOCKER, no MAJOR. Two MINOR findings recorded, neither gating.

- **Auditor:** `i18n-auditor` (independent instance), instance id `475e8f60464f`.
- **Model (actual):** `deepseek/deepseek-flash` — the harness session model from the
  session header; no role pin, no fallback used or attempted. `actual_model_source`:
  session system-prompt header. Not the translator's session.
- **Locale:** `zh-CN`. **Namespace / file group:** `mobile.computers+mobile.signin (M3 S1)`.
- **Audit kind:** `delta` — the three changed keys in full, plus integrity of the whole
  44-key draft, plus the new six-label slot check.
- **Head under audit:** `a5593a79ef8414cfa6af05dfbc151dd47ada6199`
  (worktree `~/local-operator-mobile/.worktrees/i18n-m3-s1`, branch
  `feat/i18n-m3-s1-signin-computers`); `HEAD` verified with `git rev-parse HEAD`,
  `git status --porcelain` empty. Read-only throughout: nothing edited, committed,
  checked out or installed.
- **Base:** `origin/main` `9e193b57`.
- **No translation API, SDK, MT service or website was used** for judging or
  back-translation. Judgement is reasoning against the English source, the two
  sidecars, the shipped zh-CN catalogue, the style guide and the glossary.

## Inputs (sha256, all verified in-session)

| Input | Path | sha256 |
|---|---|---|
| draft v2 (audited) | `…/7a547984994d/scratchpad/draft-zh-CN-s1-v2.json` | `007dc881078ff550bdcde01ffb6be7a3be8d31507f84a5b12ebbaeb53f9991b7` |
| draft v1 (original) | `…/29c21686ee28/scratchpad/draft-zh-CN-s1.json` | `6969215384e6841040121536acc8e2c510d25c4f73d3100a32fb5fa2bf3c629b` |
| replacements v2 | `…/7a547984994d/scratchpad/replacements-zh-CN-s1.json` | `c9ccace4f4f6ee9a572f4c5e10a95d11183158afd8514f6fcb831181361a35ed` |
| brief | `…/d5aaf8ba6ba5/scratchpad/translation-brief-s1.json` | `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f` |

Both draft hashes match the values given in the task. The brief and the two draft
files were read with the `read` tool after `bash` access to the sibling sessions'
scratchpads was refused by the guardrail; the hash checks above were run in my own
scratchpad.

## Integrity (task item 2) — PASS

Script `integrity.mjs` (output in `audit.log`):

- 44 keys in both drafts; key order byte-identical (`JSON.stringify(keys)` equal).
- Exactly **3** values differ, and they are exactly the three keys named in the task:
  `mobile.computers.wait.tunnel_status`, `mobile.signin.welcome.headline`,
  `mobile.computers.paths.radient_body`.
- `replacements-zh-CN-s1.json` has exactly those 3 keys; every replacement equals the
  v2 value and differs from v1 (no no-op replacement).
- Draft key order equals the brief's order; no key added, dropped or renamed.
  Namespace split: 30 `mobile.computers` + 14 `mobile.signin`.
- Corroboration that the draft is the complete S1 gap: the branch's English source has
  75 computers + 32 signin keys, shipped zh-CN has 45 + 18; the missing sets are 30 + 14
  = 44, and the draft's key set is **exactly** that missing set (`gap` set equality true).

## Mechanical (task item 1) — PASS

Run with the repo's **own** parser, `parseMessage` from `src/i18n/messages.ts` (the
module `scripts/i18n/generate.ts` gates commits on), imported read-only from the
worktree by `audit-zhCN-s1-delta.mjs`:

- 44/44 values parse; valid JSON/UTF-8.
- Placeholder **names and kinds** identical to the English catalogue (not to the
  brief's copy): `status:text` (`wait.tunnel_status`); `name/status/reach:text`
  (`row.a11y*`). No plural or select anywhere in this slice, so the `other`-only
  zh-CN rule is not exercised and no CLDR-category question arises.
- No markup/Rich tags, no added backticks; Latin tokens byte-identical (`Radient`,
  `Local Operator`, `URL`).
- **No English left anywhere in the draft:** the only Latin runs outside placeholders
  are `Radient`, `Local Operator`, `URL` — nothing else (sweep over all 44 values).
- Punctuation of the three changed values: full-width only (，：。); no ASCII
  punctuation outside `{`/`}`; no ASCII `...`; no bidi/format/control characters.
- Width: `wait.tunnel_status` 35 cells (= English), `welcome.headline` 24 cells
  (English 33), `radient_body` 113 cells (English 178). No `maxCells` hint exists for
  these keys in the sidecars (same pattern as the rest of this namespace), so fit is
  judged by ratio and call site; all three shrink against English and none is at risk.

**Negative controls (so the clean run is not vacuous).** `negctl` + `mutant-ctl`:

- `{status。` → THREW `expected ',' or '}'`; `{status}}` → THREW `unexpected '}'`;
  `'{status}'` → THREW `ICU apostrophe quoting ('{) is not supported`.
- A **renamed** or **dropped** placeholder parses cleanly, which is exactly why the
  checker compares names against English: mutating the draft to `{sttaus}`, to no
  placeholder, dropping `{reach}` from `row.a11y`, or deleting a key each produced the
  expected mismatch finding and the real draft produced none.

**Repo validator.** `node scripts/i18n/generate.ts --check` → **exit 1**, one line:
`es/mobile.computers.json disagrees with the English source — missing: … (30 keys)`.
Its `fail()` is `console.error` + `process.exit(1)`, and locales sort `es` before
`zh-CN`, so it stops at the first failing locale — **zh-CN's own 30+14 key gap is real
but never reached by the run** (measured directly: 45 vs 75 and 18 vs 32). This is a
branch-state (English-first) fact, not a defect in the draft, and the validator cannot
see an uncommitted draft at all. Reported as a wrapper limitation, not as a pass.

## Changed keys in full (accuracy, idiom, register, terminology) — task item 1

### `mobile.computers.wait.tunnel_status` — ZH-01 fix RESOLVES the first-round MAJOR
`Radient已配置好隧道，状态：{status}。` → **`Radient已有此隧道，状态：{status}。`**
English: `Radient has the tunnel — {status}.`

Independently reached the same conclusion before reading the first-round report: `已配置好`
asserts *completed provisioning* on the same line that can say `配置中`/`已暂停`/`已禁用`/
`已撤销` — an addition and a self-contradiction, against the call-site comment that
`status: active` means only "the cloud route is provisioned". `已有` is neutral possession
and names no lifecycle stage. The em dash is legitimately restructured as `，状态：` —
which is what makes a bare status label grammatical in every case, and avoids an em dash
Chinese product copy does not use. Kept `。` (full sentence; brief requires it). **Sound.**

### `mobile.signin.welcome.headline` — ZH-02 fix RESOLVES the MINOR
`你的智能体运行在你的电脑上。` → **`智能体运行在你的电脑上。`**
English: `Your agent runs on your computer.` The guide forbids 你-repetition and prefers
verb-forward phrasing; the load-bearing possessive is the second one (local execution, not
the cloud). Dropping the first `你的` loses no claim, keeps `运行在` verb-forward, 12 chars
/ 24 cells with no `numberOfLines` constraint. **Sound.**

### `mobile.computers.paths.radient_body` — ZH-03 fix RESOLVES the stumble, costs register
`…因此此手机无需任何配置…` → **`…因此手机上无需任何配置…`**
The `因此此手机` adjacency (此+此) is a real spoken stumble and is gone. Three clauses and
the honest cost (an account is needed) all survive; `URL` and `中继` per guide/glossary.
But see ZH2-02 below: bare `手机上` diverges from the locale's shipped voice.

## Rejected alternatives — rightly rejected

- `隧道已在Radient端` — needs `端` to complete ("服务端/一端"); rejected. Agreed.
- `由Radient托管` — adds hosting semantics the English does not state; rejected. Agreed.
- `你的智能体，就运行在你自己的电脑上。` — re-adds a pronoun and is a third longer for no
  extra claim; rejected. Agreed.
- ZH-04 `not_harness` (noun "harness" dropped), ZH-05 `try_now` = `立即重试`, ZH-06
  `own_body` kept, ZH-08 `own_title` = `设置自己的隧道` kept — all defensible; none is a
  defect and none re-opened here. `设置` + object is unambiguously verbal, and no
  Settings affordance shares those two screens.

## Register consistency detail — ZH2-02 (MINOR)
The shipped zh-CN catalogue renders "this phone" as **`此手机`** in 11 values
(`mobile.settings.sign_out.*`, `mobile.settings.text_size.*`, `mobile.chrome.home.saved_draft`,
`mobile.computers.added.stays_listed`, `mobile.computers.none_on_phone`,
`mobile.computers.section.on_phone`, `mobile.notifications.permission.*`,
`mobile.session.history.gap_load_hint`) — and `手机上` appears in shipped copy **only**
inside `此手机上`. v2's `radient_body` is the only bare `手机上` in the group, while the
same draft keeps `此手机` in `remove.body`. The fix also drops the deictic ("this" phone).
A fix that keeps both properties: replace `因此` with `所以` — `…URL，所以此手机无需任何配置，
也无需保管中继密码。` — or end the sentence and start `此手机无需任何配置，…`.

## Fit
No `maxCells` budget on these keys; all three changed values are shorter than English
(35/35, 24/33, 113/178 cells). `welcome.headline` is rendered with no line clamp, so no
overflow risk. No wide-glyph/combining-mark risk beyond ordinary CJK.

## RTL
Not applicable (zh-CN).

## Slot check — six labels through `mobile.computers.wait.tunnel_status` @ a5593a79

Ground truth read from the head, not assumed: `computers.tsx:260` passes
`status: t(tunnelStatusKey(state.tunnelStatus))`, i.e. at this head the slot receives a
**localised label**, never the raw English word (`tunnel-status-key.ts` maps
`ready → badge.active`, `provisioning|suspended|off|gone|unknown → status.*`, else
`status.unknown`). So the six reachable labels in zh-CN are one **shipped** value plus
five **draft** values.

| Label | zh-CN value | Sentence rendered | Reads ok? |
|---|---|---|---|
| `badge.active` (shipped) | 使用中 | Radient已有此隧道，状态：使用中。 | ⚠ grammatical; sense drifts — 使用中 = "in use", see ZH2-01 |
| `status.provisioning` (draft) | 配置中 | Radient已有此隧道，状态：配置中。 | ✓ |
| `status.suspended` (draft) | 已暂停 | Radient已有此隧道，状态：已暂停。 | ✓ |
| `status.disabled` (draft) | 已禁用 | Radient已有此隧道，状态：已禁用。 | ✓ |
| `status.revoked` (draft) | 已撤销 | Radient已有此隧道，状态：已撤销。 | ✓ |
| `status.unknown` (draft) | 未知 | Radient已有此隧道，状态：未知。 | ✓ |

All six are grammatical: the `，状态：` scaffold takes any bare label or noun phrase, so no
agreement/article/case failure is possible, and `。` closes every variant. No contradiction
of the "has the tunnel — provisioning" kind survives the `已配置好 → 已有` fix: `已有` no
longer asserts provisioning, so `配置中`/`已暂停`/`已禁用`/`已撤销` are read as the state of a
tunnel that exists.

## Findings

### ZH2-01 — MINOR — `mobile.computers.badge.active` (surfaces in `wait.tunnel_status`)
**Current:** `使用中` (shipped) → sentence `Radient已有此隧道，状态：使用中。`
**Problem:** English `active` for this slot means, by the code's own definition, "the cloud
route is provisioned"; `使用中` means "in use / occupied". In the wait panel nothing is using
the tunnel yet (the phone has not connected), and the catalogue's own tunnel-active
vocabulary is `活动` (`disabled_help`: `此隧道当前未处于活动状态`). At the row badge the value
is fine — there it marks the connected computer — so this is a collision created by reusing
that badge key for a tunnel-state sentence, not a defect in the v2 draft.
**Suggestion:** keep the sentence; give the wait panel a tunnel-state label
(`已启用` or `活动`) in code, leaving `使用中` to the connected-row badge. Code-side, so it
does not gate this locale's draft.

### ZH2-02 — MINOR — `mobile.computers.paths.radient_body`
**Current:** `…并提供私有且经过身份验证的URL，因此手机上无需任何配置，也无需保管中继密码。`
**Problem:** fixes the `因此此手机` stumble but introduces the group's only bare `手机上`
against 11 shipped `此手机`, and drops the deictic "this".
**Suggestion:** `…URL，所以此手机无需任何配置，也无需保管中继密码。`

**No NITs recorded** — nothing else in the three changed keys or the 41 unchanged values
warrants one, and an empty NIT list is not filled for symmetry.

## Provenance note (not a finding)

The v2 translator notes name head `1796c3a5` and, in their ZH-01 evidence, quote the call
site as `status: state.tunnelStatus` (raw word). The mapping to a localised label landed in
the commit under audit, `a5593a79`. The v2 wording is correct under **both** heads (and the
raw-token case reads `状态：active。`, also grammatical), so the fix stands; but the notes'
description of the rendering path is one commit stale, and the localised-label path — the
one that actually ships — is checked here for the first time. The note's glossary proposal
to reuse the `status.*` family for this slot is the correct instinct and is the basis of
ZH2-01.

## Verdict

`passed` — 0 BLOCKER, 0 MAJOR, 2 MINOR (both non-gating; ZH2-01 is code-side and
pre-existing-copy, ZH2-02 is a register consistency nit inside an otherwise improved
string). Integrity and mechanical checks are clean and their negative controls are
discriminating.
