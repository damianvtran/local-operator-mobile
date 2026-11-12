# zh-CN — M3 slice S1 translator notes (sign-in + computers)

- **Locale:** `zh-CN` (Simplified Chinese)
- **Slice:** M3 S1 — `mobile.signin` (14 keys) + `mobile.computers` (30 keys) = **44 keys**
- **Brief:** `translation-brief-s1.json`, sha256 `531e6edd8e5f9af5…` (verified against the stated prefix)
- **Draft:** `draft-zh-CN-s1.json`, sha256 `6969215384e6841040121536acc8e2c510d25c4f73d3100a32fb5fa2bf3c629b`
- **Model:** `deepseek/deepseek-flash` (session model, no role/tier pin; no fallback used)
- **No machine translation** was used: no API, SDK, MT service or website. Every string below was reasoned from the English source, the sidecars, the existing zh-CN catalogues, and the zh-CN style guide.

## Register and tone

The zh-CN style guide (`i18n/style-guides/zh-CN.md` in `~/local-operator`, read from `origin/main`) is binding and settles the register:

- **Address: 你**, never 您 (the guide records this as a standing decision — 您 reads customer-service/government and fights the terse dev tone).
- **Verb-forward, terse.** Pronouns are dropped where Chinese drops them naturally (e.g. `正在打开浏览器……`, not `正在打开你的浏览器……`), but kept where the possessive carries meaning (`你的电脑`, `你的账户`, `你的代码`).
- **No 请** anywhere — the English has no "please" in these keys.
- **No ！, no 啦/哦/呀 particles.** Verified: zero occurrences in the draft.
- **Full stops (。) only on full sentences.** Every badge (`status.*`, `reach.answering`), heading, and button carries none.
- **No space between Chinese text and Latin runs**, per the guide's width rule. So `Radient已配置好隧道`, `未运行Local Operator`, `登录由你的浏览器完成`. Product names and technical tokens (`Radient`, `Local Operator`, `URL`) stay byte-identical Latin.

## Glossary decisions

Terms already translated elsewhere in the zh-CN catalogues were reused, not reinvented. Each one was checked against the existing files before use.

| English | zh-CN | Source of the decision |
|---|---|---|
| computer | **电脑** | Established throughout zh-CN (`添加电脑`, `切换电脑`, `这台电脑`, `此电脑`). |
| this computer | **此电脑** / **这台电脑** | Both already in use; 此电脑 for row/state copy, 这台电脑 where the sentence is *about* the machine. |
| sign in / sign-in | **登录** | Established (`登录诊断`, `退出登录`, `已登录`, `受登录保护`). `sign in` as a verb phrase and `sign-in` as a noun both land on 登录 — Chinese does not inflect, so one form serves both. |
| tunnel | **隧道** | Established (`此隧道`, `Radient隧道`, `所有隧道`). |
| relay | **中继** | Glossary §2 (`relay → 中继`) and existing copy (`它的中继报告`). |
| account | **账户** | Established (`Radient账户`, `另一个 Radient 账户`). |
| agent | **智能体** | Glossary §2 and the zh-CN style guide. |
| session | **会话** | Glossary §2. |
| route | **路径** (badge) / **连接路径** (prose) | Prose form taken from the existing `连接路径已配置` in `mobile.computers.wait.host_answering`. Shortened to 路径就绪 in the badge for row width (see "Width"). |
| address | **地址** | Established (`你的地址`). |
| password | **密码** | Established throughout. |
| billing | **账单** | Established (`打开此隧道的账单设置`). |
| console | **控制台** | Established (`Radient 控制台`). |
| remove | **移除** | Standard for taking an entry off a list; 删除 is reserved for the account-deletion copy already in the catalogue. |
| refresh | **刷新** | Established (`mobile.library.browse.refresh` = 刷新资料库). |
| retry | **重试** | Established (many sites). |

### glossary proposals (terms the core glossary does not yet carry)

Appended here because `i18n/glossary.md` has no row for any of these; zh-CN is the only locale that needed them in this slice.

| Term | Proposed zh-CN | Reasoning |
|---|---|---|
| tunnel | **隧道** | Already the de-facto rendering across the mobile zh-CN catalogues; proposing it as the citation form so a future locale pass does not diverge. |
| computer (the paired device) | **电脑** | Same situation: settled in practice, absent from the glossary. |
| harness | *(dropped — rendered as the product name)* | "The Local Operator harness" has no settled zh-CN noun that is not clumsy (框架/宿主/服务 all mislead). The existing catalogue already renders `harness_help` as `为此隧道启用 Local Operator`, dropping the noun; this slice follows that precedent. Flagged for the glossary: if a noun is wanted, **运行框架** is the least bad, but it is worse copy. |
| route | **连接路径** | Distinguishes Radient's tunnel route from 路由 (network routing) and from 路径 (file path). Used in prose; badges shorten to 路径. |
| provisioning (badge) | **配置中** | Parallel to the existing `连接路径已配置`. |
| reachability / probe result | **响应** | Already the word for "answer" in this namespace (`正在等待电脑响应`). |

## Judged-identical strings

**None.** Zero of the 44 keys is left in English. Every value is Chinese; the Latin runs that remain are the required untranslated tokens only — `Radient` (brand, kept Latin per the sidecar notes and glossary §1), `Local Operator` (product name), `URL` (style guide's kept-English technical list), and the ICU placeholders `{status}`, `{name}`, `{reach}`. The one value with no Chinese characters at all, `mobile.computers.row.a11y` (`{name}，{status}，{reach}`), is a pure placeholder skeleton for screen readers — only its separator changed, from ASCII commas to the full-width ，the locale reads aloud correctly.

## Per-key rationale (non-obvious ones)

- **`mobile.computers.not_harness`** — `这台电脑未运行Local Operator。` Dropped the noun "harness" exactly as the existing `harness_help` string does; the sentence still says precisely what the row means (listed on the account, harness not up).
- **`mobile.computers.wait.tunnel_status`** — `Radient已配置好隧道，状态：{status}。` The English em-dash clause became a colon clause: `{status}` is an untranslated English word (`active`, `suspended`), and a colon keeps the sentence grammatical around a Latin token without implying the token is Chinese. "has the tunnel" → 已配置好隧道 ("has provisioned the tunnel").
- **`mobile.computers.wait.answered`** — `你的电脑已响应。` Reuses 响应 from `wait.answering`, so the two adjacent steps read as a sequence.
- **`mobile.computers.list.heading`** — `你的电脑`. Chinese has no plural marking; the English "Your computers" needs no classifier here and adding 所有 would be heavier than the source.
- **`mobile.computers.remove.title` / `remove.body` / `remove.confirm`** — `移除此电脑？` / `此操作只将它从此手机的列表中移除。不会影响电脑本身、其隧道或你的账户。` / `移除`. All three negations in the body are preserved (the computer, its tunnel, the account); 此操作 carries "This removes…" as an action subject, which is idiomatic where 这 alone is not. 移除 = "take off this list", deliberately not 删除.
- **`mobile.computers.paths.radient_title`** — `通过Radient连接`. Matches the existing 通过Radient phrasing in the catalogue (通过Radient隧道).
- **`mobile.computers.paths.radient_body`** — `需要Radient账户。Radient为你运行隧道，并提供私有且经过身份验证的URL，因此此手机无需任何配置，也无需保管中继密码。` The honest cost ("needs an account") opens the sentence as in English; 保管 carries "to keep" (you have no password to look after), which is the actual promise.
- **`mobile.computers.paths.own_title` / `own_action`** — `设置自己的隧道` / `使用我自己的隧道`. The title states the outcome (set up your own tunnel, also the welcome-screen button); the card's outline button is the explicit first-person 我自己的, distinguishing it from the computers-screen `改用我自己的隧道` ("instead").
- **`mobile.computers.own_tunnel_instead`** — `改用我自己的隧道`. 改用 is the natural rendering of "instead" for switching paths; it needs no 代替.
- **`mobile.computers.status.route_ready`** — `路径就绪`. Reads as a state of the route, not the machine, matching the sidecar. See the width note for the 连接路径 alternative.
- **`mobile.computers.status.provisioning`** — `配置中`. "Still setting the route up", parallel to the existing 已配置.
- **`mobile.computers.status.suspended` / `disabled` / `revoked` / `unknown`** — `已暂停` / `已禁用` / `已撤销` / `未知`. 已- prefix for the three completed states; 撤销 is the catalogue's existing word for revocation.
- **`mobile.computers.reach.answering`** — `已响应`. The probe got an answer. Deliberately distinct from the `status.*` family (it is a probe result, per the sidecar), while sharing the 响应 root with `wait.answering`.
- **`mobile.computers.row.a11y` / `_active` / `_connecting`** — `{name}，{status}，{reach}` / `…，使用中` / `…，连接中`. Order preserved, placeholders untouched. The trailing state words reuse the catalogue's own `badge.active` = 使用中 and `badge.connecting` = 连接中, exactly as the sidecar requires.
- **`mobile.signin.title`** — `登录`. Matches `mobile.team_bridge.gate.sign_in` and the namespace's own 登录 terminology.
- **`mobile.signin.intro`** — `登录由你的浏览器完成，应用绝不会看到你的密码。` "never sees" → 绝不会看到; the guarantee is stated as a hard negation, and 由你的浏览器完成 makes the browser the actor.
- **`mobile.signin.start`** — `使用Radient登录`. Consistent with the sibling `use_address` button's 使用… and with the Radient-branded path titles.
- **`mobile.signin.panel.opening`** — `正在打开浏览器……`. No possessive, matching the existing `stage_browser` = 正在等待浏览器.
- **`mobile.signin.panel.cancelled`** — `本次登录已取消。` The sidecar insists this must read differently from the diagnostic stage word (`stage_cancelled` = 登录已取消). 本次 ("this attempt") is what makes it a sentence about the attempt rather than a re-typed label.
- **`mobile.signin.panel.try_anyway`** — `仍要重试`. "anyway" → 仍要; a short verb phrase suited to a quiet button.
- **`mobile.signin.welcome.headline`** — `你的智能体运行在你的电脑上。` Keeps both possessives: the point of the headline is *your* agent on *your* machine, and dropping either halves the claim.
- **`mobile.signin.welcome.body`** — `此应用在你的电脑上运行会话，并展示它做了什么。你的代码绝不会离开这台电脑。` "it" = the machine is resolved to 这台电脑 rather than a bare 它, so the privacy promise cannot be misread as being about the app.

## Width risks

No `maxCells` hints exist in either English sidecar, so width was judged from the sidecar notes (badge/button brevity) and measured in cells (CJK and full-width punctuation = 2).

| Measure | Result |
|---|---|
| Max cell width of any deliberate short label | **8** cells (`立即重试`) |
| Widest badge in the `status.*` / `reach.*` family | **8** cells (`路径就绪`) — the rest are 6 |
| Longest button | `使用我自己的隧道` = 16 cells (English `Use my own tunnel` = 17) |
| Mean draft/en length ratio (cells vs ASCII chars) | **0.69** — zh-CN is more compact than the English here, no key exceeds 1.14× |

**The one string I could not fit at the fuller wording:** `mobile.computers.status.route_ready`. The prose term is 连接路径 (used in `wait.host_answering`), but 连接路径就绪 is 12 cells in a row badge next to 6-cell siblings (配置中 / 已暂停 / 已禁用 / 已撤销 / 未知). I took the guide's "prefer a shorter idiomatic wording over truncation" and used **路径就绪**, which keeps the route-not-computer reading. If a reviewer wants the full term, the only cost is 4 more cells and a visibly wider badge — 路径就绪 is my recommendation.

## Punctuation — decisions, and two pre-existing drifts I did not touch

Decisions applied to my 44 keys, per the style guide:

- Full-width punctuation throughout: 20 × 。, 18 × ，, 1 × 、, 2 × ：, 1 × ？. No half-width comma, full stop, parenthesis or quote appears inside any value.
- Ellipsis written as **……** (two marks), per the guide ("Ellipsis is …… (two marks), not \"…\"").

**Two drifts already in the zh-CN catalogues** (out of my 44-key scope — reported, not edited, because another agent owns those strings):

1. **Ellipsis:** the catalogue is split — **17 standalone `…`** occurrences (`mobile.signin.progress` = 正在登录…, `mobile.computers.signing_out` = 正在退出登录…, `mobile.chrome.home.connecting` = 正在连接 {host}…) against **7 `……`** — including a contradiction inside one file (`mobile.computers.connecting` = 正在连接…… but `signing_out` = 正在退出登录…). I followed the guide, so my `正在打开浏览器……` sits next to the existing `正在登录…` on the same sign-in screen. **Recommendation:** one mechanical normalisation pass over the zh-CN catalogue to `……` (or a guide amendment to `…`), so the choice is made once.
2. **Latin spacing — this one runs the other way, and you should rule on it.** The guide forbids a space between Chinese and Latin runs. The catalogue in practice mostly **inserts** one: **54 spaced** adjacencies (28 Chinese→Latin, 26 Latin→Chinese) against **19 unspaced** (8 + 11). So the guide describes a minority of the existing copy (`在浏览器中的Radient控制台` is unspaced; `在 Radient 控制台中为此隧道…`, `属于另一个 Radient 账户`, `未登录Radient账户` shows both spellings in one file).

   I followed the **binding guide** (no space) because that is the authority the auditor will read against, and because a single rule beats picking per string. **If you would rather the 44 new keys match the majority of the existing copy, this is a mechanical change to 8 of the 44 keys** (`not_harness`, `wait.listing`, `wait.tunnel_status`, `paths.radient_title`, `paths.radient_body`, `paths.own_body`, `signin.start`, `panel.unavailable`) **and I can reissue the draft** — the call is yours, not one I should hide. Either way the catalogue needs one normalisation pass before the locale is internally consistent.

Neither drift is in the 44 keys I was given, and I left every other file in the read-only worktree untouched.

## Validation (actually run)

Command: `node /Users/damian/.local-operator/sessions/29c21686ee28/scratchpad/validate-zh-CN-s1.mjs`

This imports the repo's **own** message parser (`src/i18n/messages.ts`, the one `scripts/i18n/generate.ts` uses) read-only from the worktree and applies the same checks generation applies to a locale directory — valid ICU, placeholder-name parity, legal kind escalation only — plus the zh-CN style-guide rules. It writes nothing inside the repo. Actual output:

```
keys: 44
parsed placeholders: tunnel_status=status:text | a11y=name:text,reach:text,status:text |
  a11y_active=name:text,reach:text,status:text | a11y_connecting=name:text,reach:text,status:text

WARNINGS: none
ERRORS: none
```

Negative control (`negctl-zh-CN.mjs`, deliberately broken strings fed to the same checks) — all three injected defects caught, so the clean pass is meaningful:

```
CAUGHT mobile.computers.wait.tunnel_status: placeholders status vs
CAUGHT mobile.computers.row.a11y: placeholders name,reach,status vs extra,name,reach,status
CAUGHT mobile.computers.status.revoked: badge full stop
```

Also verified: 44 keys, **exactly the brief's key order**, no key added, dropped or renamed; JSON parses, UTF-8, no trailing commas; no `您`, `请`, `！`, `啦`/`哦`/`呀`, no ASCII `...`, no manual bidi control characters.

**Not run:** `npm run -s i18n:check` in the repo. It compares `catalogue.gen.ts` against the JSON **on disk**, so it can only see these strings once they are written into `src/i18n/catalogues/zh-CN/` — which is the manager/lane owner's write, not mine (the worktree is READ-ONLY for this role). Nothing was written, staged or committed anywhere. That check belongs to whoever lands the draft.

I do not audit my own locale; independent zh-CN auditors follow.
