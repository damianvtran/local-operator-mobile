# Independent Chinese delta audit — `mobile.computers` (`zh29b4r2`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR; 1 MINOR carried from round 1 (`ZH-CMP-2`, bytes
unchanged). `unresolved_blocker_major_count = 0`.**
Round 1 (`zh29b4`) returned `changes_requested` on 1 MAJOR (`ZH-CMP-1`, the account noun) and 1 MINOR
(`ZH-CMP-2`, a possessive). The MAJOR is fixed verbatim and now agrees with core's committed zh-CN
across **both** namespaces that use the account term. The MINOR was **not applied** — its bytes are
byte-identical to the round-1 audited ones — so it carries forward as a residual MINOR.

- **HEAD audited:** `d3c39d8d2df2bccc78af82df9253776b4c933ad8` (branch `feat/i18n-chinese`,
  worktree `/Users/damian/workspace/zh-wave`). Tracked tree clean; the only untracked paths were
  peer auditors' bundles (`zh29a1r2`, `zh29a4r2`), untouched here.
- **Auditor:** `i18n-auditor` (lopdev team), session `09de4313fcaa`. **Actual model:
  `radient/auto`**, after `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro`
  provider-quota fallbacks. Every command in `audit.log` ran under that model.
- **Independence:** different agent and session from the translator (independence is agent/session,
  not model diversity — the translator's supplied model is also `radient/auto`). This is the
  round-1 auditor re-checking its own finding, i.e. a remediation check and **not** an independent
  second pass. No human native review; no rendered UI frame.
- **Inputs:** en `356f10123aa96d48169552395506cd9b1f2e3b50955bfd363624fd2371930643` · context
  `3ac04e8333c94e9d419a144bcf08b3ce40ea54b88acc153a9caa1789ba40b6a5` · zh-CN
  `90f4c203d68c8f7f402d448738b66cad3041ff3ea8df50588410af071f3701a5` (round 1 audited
  `35e1126c…`, so the file changed).

## Delta: round-1 finding → bytes now

| id | sev. r1 | key | round-1 bytes | HEAD bytes | applied |
|---|---|---|---|---|---|
| ZH-CMP-1 | major | `section.not_connected` | `Radient账号中，未连接` | `Radient账户下，未连接` | verbatim |
| ZH-CMP-2 | minor | `added.stays_listed` | `它仍会保留在此手机列表中，可从电脑列表切回。` | `它仍会保留在此手机列表中，可从电脑列表切回。` | **unchanged** |

Machine-derived from `zh29b4/record.json` (`verify-prescriptions.py` in `audit.log`).

## The account noun — checked against core across BOTH namespaces that use it

Round 1's MAJOR was a cross-namespace consistency failure, so the fix is checked the same way, not
against the string alone.

*Committed source of truth* — `~/local-operator` at `HEAD` = `2008053b5d6af37fa449fc303d9e344c262f82c8`
(printed in `audit.log`), reading `local_operator/i18n/catalogues/zh-CN/` from the **ref**, not the
working tree:

```
core zh-CN catalogue files at HEAD: 93
'账户': occurrences=42 files=10   top: mobile.setup 22, tui.authoring 6, wire.settings 4,
                                       relay.account_policy 3, wire.remote_compute 2, +5 more
'账号': occurrences=0 files=0
```

*This wave, both namespaces that use the term* (`grep -rn '账户\|账号' src/i18n/catalogues/zh-CN/`,
in `audit.log`):

```
mobile.computers.section.not_connected   Radient账户下，未连接
mobile.account_routing.disconnected      连接电脑后才能更改账户路由。
mobile.account_routing.load_error        无法加载账户路由。检查连接后重试。
mobile.account_routing.loading           正在加载账户路由……
mobile.account_routing.title             账户路由
mobile.account_routing.unavailable       此中继不提供账户路由设置。在此电脑上更新Local Operator。
```

One term, `账户`, in the app namespace **and** in `mobile.account_routing`; zero `账号` anywhere in
the zh-CN catalogue set. Byte-level confirmation of the changed string (the harness prints a codepoint trace):
`账` U+8D26 `户` U+6237 — the requested noun, not a homograph.

## Rendered evidence — every key, executed

`render.ts.txt` renders all ten keys through `src/i18n/runtime.ts` `renderFor` with preference
`zh-CN`, and each alongside its English source:

| key | zh-CN (executed) | cells |
|---|---|---:|
| `add` | `添加电脑` | 8 |
| `added.stays_listed` | `它仍会保留在此手机列表中，可从电脑列表切回。` | 44 |
| `badge.active` | `使用中` | 6 |
| `badge.connecting` | `连接中` | 6 |
| `connecting` | `正在连接……` | 10 |
| `none_on_phone` | `此手机尚未添加电脑。` | 20 |
| `password_placeholder` | `来自lop mobile的密码` | 20 |
| `section.not_connected` | `Radient账户下，未连接` | 21 |
| `section.on_phone` | `此手机` | 6 |
| `switch` | `切换电脑` | 8 |

`lop mobile` is kept byte-identical inside `password_placeholder` and `Radient` stays untranslated:
both are the glossary's kept-English runs. `正在连接……` uses two U+2026 marks per the zh-CN guide.

## Nothing regressed

- **Key parity:** 10/10/10 en · zh-CN · context; no key added or dropped; identical order.
- **Parameter/structure parity:** 0 parse failures, 0 mismatches; this namespace has no
  placeholders and no ICU structure at all (0 plural nodes, 0 select nodes), and the negative
  controls in the shared harness still prove the comparisons fire.
- **Plurals:** none present; `Intl.PluralRules("zh-CN")` = `["other"]` recorded for completeness.
- **Bidi:** no LRM/RLM/ALM, no U+202A–202E, no U+2066–2069.
- **Typography:** `，` and `。` only in prose; no ASCII prose punctuation beside CJK; no `您`, no `！`.
- **Repo gates, executed:** `i18n:catalogue:check` green (143 keys / 10 namespaces);
  `i18n:strings:check` `0 new; no growth vs a57fb8cbe161`; `vitest run src/i18n/__tests__` →
  **5 files / 89 tests passed** — including the `catalogues.test.ts` directory-vs-`SHIPPED_LOCALES`
  gate that round 1 recorded as red before the flip.

## Finding (carried)

### ZH-CMP-2 — MINOR — `mobile.computers.added.stays_listed` (possessive)

- **Current:** `它仍会保留在此手机列表中，可从电脑列表切回。`
- **Problem:** `此手机列表` reads as a compound ("this phone list") rather than "this phone's list";
  the possessive `的` is missing, and `从电脑列表切回` wants `中` to read as "from the computer
  list". Unchanged since round 1 — the prescription was not applied.
- **Replacement:** `它仍会保留在此手机的列表中，可从电脑列表中切回。`
- **Why it does not block:** a reader still lands on the right meaning (it stays listed on this
  phone) and nothing unsafe can be inferred; it is a grammar/register defect in a help sentence.

## Width / overflow

No `maxCells`/`maxChars` field exists on any entry here (budgets are stated in note prose only, in
`relay.health` and `mobile.session_health`). `section.not_connected` went 19 → 21 cells (+2) against
round-1's measured 181.0 pt in a 288 pt header, so ≈200 pt — one line with ~85 pt spare. Every other
key is unchanged. Nothing is clamped.

## Limits

- No rendered frame and no human native review; no MT service used for comparison or back-translation.
- The account check reads core's committed ref; if core's zh-CN moves, this comparison must be re-run
  (it is scripted in `account-term.py.txt`).
- No independent second pass for this delta. Round 1's second pass (`a163531a0dbd`) graded the
  account noun MINOR; the independent group-A audit (`zh29a4`, `AR-01`) graded it MAJOR and this
  auditor kept MAJOR. The fix landed; the severity disagreement stays recorded in `zh29b4/report.md`.

## Recording boundary

`report.md` is judgement; `audit.log` is the actual command output. No `i18n/ledger.json` and no
audit-ledger command exist in this repository, so the ledger row is recorded in `record.json.ledger`
as explicitly unwritten. These bundle files are untracked additions; this audit edited nothing under
`src/` and made no commit.
