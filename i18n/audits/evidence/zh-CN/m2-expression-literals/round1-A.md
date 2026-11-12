# M2 audit — zh-CN, Lane A — round 1

**Verdict: changes_requested** · BLOCKER 0 · MAJOR 1 · MINOR 0 · NIT 3
(group `mobile.settings.*` + `mobile.computers.*` + `mobile.session.*`, 27 keys)

## Provenance

- Auditor role: `i18n-auditor` (independent), session `d78856afcb03`.
- Actual served model: **`deepseek/deepseek-flash`** (session header; no fallback used).
- Independent of the translator: translator `i18n-translator`, session `3ef6295a5545`, `openai/gpt-6.1-sol`.
- Method: reading and reasoning only. No translation API/SDK/MT service, no back-translation, no
  repo or ledger edits (per brief). Candidate was not edited.

## Inputs (SHA-256)

| Input | Path | SHA-256 |
|---|---|---|
| candidate | `…/3ef6295a5545/scratchpad/m2-prep/zh-CN.v1.json` | `2118716b622fc672de49a7e672010f4947659e6f90d8c9d0597afa8dcb66265f` |
| en source + context | `…/3ef6295a5545/scratchpad/m2-prep/keys27.json` | `5a87db85aa45931827154dd6da772dba269eb824e57e8e7faf5d76cdcce02e1e` |
| M1 reference (read-only) | `…/3ef6295a5545/scratchpad/m1-prep/zh-CN.v2.json` | `b9548524f9ed546eb85cb4ab1d2a2bb80411e9b51ebaf87db3360282c8d41592` |

Also read: `i18n/style-guides/zh-CN.md`, `i18n/style-guides/en.md`, `i18n/glossary.md`, shipped
catalogue `~/local-operator-mobile/.worktrees/i18n-app-scan/src/i18n/catalogues/zh-CN/*.json`
(22 namespaces, recounted rather than trusted) with the `en` context sidecars, and the M2 wiring at
`feat/i18n-app-scan-expression-literals` (`b6b890e0`, worktree HEAD `ae0b2ae7`):
`d349df3c` (settings.tsx, computers.tsx, `app/(app)/session/[id].tsx`, `video.tsx`) and `b6b890e0`
(the `connected_to` single-message fix). Spec repo HEAD `b42471d3935c`.

## 1. Mechanical — executed, not assumed

`python3` on both JSON files (key set/order, placeholder names, ICU presence, empties, English-identical,
NFC, brace balance, bidi controls, Latin runs). Actual output:

```text
n_src 27 n_cand 27 order_equal True
missing [] extra []
brace balanced True
bidi []
three-dot []
latin runs {'mobile.settings.account.not_signed_in': ['Radient'], 'mobile.settings.account.route_radient': ['Radient'], 'mobile.settings.account.route_direct': ['baseUrl'], 'mobile.computers.wait.host_answering': ['host'], 'mobile.session.tray.context': ['percent'], 'mobile.session.tray.context_short': ['percent'], 'mobile.session.tray.context_estimate': ['percent'], 'mobile.session.tray.context_short_estimate': ['percent'], 'mobile.session.region.below_labels': ['labels'], 'mobile.settings.account.app_name': ['Local', 'Operator'], 'mobile.computers.added.connected_to': ['name']}
en-identical ['mobile.settings.account.app_name']
halfwidth paren []
charset ['DOWNWARDS ARROW', 'FULLWIDTH COMMA', 'FULLWIDTH LEFT PARENTHESIS', 'FULLWIDTH RIGHT PARENTHESIS', 'IDEOGRAPHIC FULL STOP', 'UPWARDS ARROW']
```

Read-out: valid JSON; 27/27 keys in exact source order, none added or dropped; every placeholder
(`{percent}`, `{labels}`, `{host}`, `{baseUrl}`, `{name}`) present once and unchanged; no ICU
plural/select in this group at all, so the zh-CN `other`-only rule is not exercised; no empties, no
edge whitespace, all strings NFC; no bidi controls (none needed); no `...`; Latin runs are exactly the
product names and placeholders. The only English-identical value is `app_name` = `Local Operator`,
which is a keep-as-is product name per glossary §1.

Repo validator note (honest limit): `npm run -s i18n:check` in the mobile worktree validates the
**integrated** catalogue tree (`generate.ts --check` + `check-strings.ts`) and cannot see an
unintegrated draft, so it proves nothing about this candidate; the python pass above is the validator
that actually covered it. I did not run the repo gate because it would report on the worktree's
`english-closure` HEAD, not on this file.

## 2. Findings

### MAJOR-1 — `mobile.session.tray.context_short_estimate` — narrow form is not narrow

- Current: `上下文{percent}%（估算）`
- EN: `{percent}% ctx (est.)` (narrow) / `{percent}% context (est.)` (wide)

Problem (fit, width-derived — see limits): the under-340 pt variant is **identical, byte for byte, to
the wide `context_estimate`** (`上下文{percent}%（估算）`), so the `< 340` branch renders exactly the
string the design round created these keys to avoid. Cell arithmetic against the rule in the call-site comment
(`app/(app)/session/[id].tsx`, D17: *"`ctx` under 340 pt: `21% context (est.)` … wraps to two lines
inside the band, and the cost then floats between them"*), CJK at 2 cells/char per the style guide:

| string | cells for a two-digit percent |
|---|---|
| en narrow `21% ctx (est.)` | 14 — the form that fixed D17 |
| en wide `21% context (est.)` | 18 — the form D17 measured as wrapping |
| **zh-CN candidate narrow** `上下文21%（估算）` | **17** |
| zh-CN wide (same string) | 17 |

17 cells sits one cell inside a string known to wrap in that band, and Chinese has no spaces, so the
overflow breaks mid-word (`…（估` / `算）`) rather than at a clean boundary — a worse failure than the
English original. The plain pair is fine and needs nothing: `context_short` = `上下文{percent}%` is
9 cells for a two-digit percent, comfortably below the 14-cell envelope (5 cells of headroom), and
`上下文` is the shortest settled Chinese form (shipped precedent `mobile.chrome.composer.row_usage`
= `上下文`) — so the note's "use the full word if none exists" covers that identity.

- Suggested: `上下文{percent}%（约）` (15 cells, −2). `约` is the idiomatic Chinese marker for an
  approximate value and keeps the parenthesised marker the note asks for. If a rendered `< 340 pt`
  capture still shows two lines at 15 cells, relax the sidecar's "keep the parentheses" for the narrow
  key only and use `上下文约{percent}%` (11 cells), which is how Chinese normally marks a projection.
- Does not gate the other three context keys.

### NIT-1 — `mobile.settings.account.route_radient` — redundant pronoun

- Current: `通过你的Radient隧道` (19 cells) → suggested `通过Radient隧道` (15 cells)
- `your` is carried by the card's own context; the zh-CN guide asks for dropped pronouns and
  verb-forward phrasing ("会话已保存" over "你的会话已被保存"). `你的` is harmless, just 4 cells of
  noise on a one-line status row. Optional.

### NIT-2 — `mobile.computers.wait.host_answering` — `位于` for a host name

- Current: `正在等待位于{host}的电脑响应。连接路径已配置，不代表电脑正在运行。`
- `位于` is a physical-location verb; a host name is an address, so `在{host}的电脑` (or
  `{host}上的电脑`) reads more naturally. Meaning, second sentence and full stops are all correct as
  written — this is polish only. No width risk (help line wraps freely).

### NIT-3 — `mobile.settings.account.not_signed_in` — parity with the shipped positive

- Current: `未登录Radient账户`; shipped `mobile.settings.account.signed_in` = `已登录`.
- Both correct; the negative carries `账户` where the positive carries none. `未登录Radient` would be
  the terse counterpart. No action needed unless the manager wants the pair symmetric.

## 3. Accuracy, idiom and terminology — key-by-key (all 27)

Meaning is preserved everywhere; no omission, addition, polarity or negation error; nothing unsafe in
status/destructive wording (these are all read-only state words — none of the 27 grants, denies or
destroys anything).

- `not_signed_in` `未登录Radient账户` — "Not signed in with Radient"; `账户` is a legitimate
  disambiguation, Radient kept Latin. ✔
- `route_radient` `通过你的Radient隧道` — tunnel = 隧道 ✔ (shipped count 7; M1 `隧道` ✔). ✔
- `route_direct` `已直连{baseUrl}` — `直连` taking the address directly is idiomatic Chinese tech
  usage (直连服务器 / 手机直连卫星); `{baseUrl}` byte-identical, LTR-safe, no space per guide. ✔
- `no_connection` `尚未连接` vs `not_connected` `未连接` — the English distinction is preserved, and
  four-character pill text is far inside the English width it replaces. ✔
- `offline` `离线` / `stream_offline` `离线` — no shipped precedent for this word (count 0), but it is
  the correct standard term and pairs coherently with `在线`. ✔
- `not_answering` `未响应` — matches the relay's own wording, which the note asks for: shipped
  `relay.chrome.session.subtitle.not_answering` = `未响应` (count 1). ✔
- `connected` `已连接`; `diagnostics.stream_idle` `空闲` (shipped `relay.chrome.session.subtitle.idle`
  = `空闲` ✔); `stream_connecting` `连接中` (shipped `mobile.computers.badge.connecting` = `连接中` ✔);
  `stream_live` `在线` (shipped `relay.health.live` = `Live` → `在线` ✔); `stream_degraded` `未响应`
  — same rendering as the Status pill, deliberate and correct per the sidecar note ("open but not
  answering"). Terminology is consistent across the two surfaces. ✔
- `wait.host_answering` / `wait.answering` — second sentence means "a provisioned route does not mean
  the machine is up" and the Chinese states exactly that (`连接路径已配置，不代表电脑正在运行`); `route`
  = `连接路径` matches shipped `mobile.settings.diagnostics.route`. Pronoun dropped, per guide. ✔
- `added.fallback_name` `你的电脑` + `added.connected_to` `已连接到{name}。` — the pair is the thing I
  was asked to check specifically: `已连接到` + `你的电脑` = `已连接到你的电脑。`, natural, correct
  full stop; with a real name (`已连接到Damian-MBP。`) it stays grammatical because Chinese has no
  case/article to agree. Wired as ONE message since `b6b890e0`, so no spliced fragments. ✔
- `session.tray.context*` — 上下文 is the shipped word for the context window, ordering word-first is
  native, `%` kept, `（估算）` full-width parens per guide (shipped `（{count}）` precedent). Meaning
  and estimate marking correct; only the narrow-estimate width is a problem (MAJOR-1). ✔
- `region.end` `已到底部 · 向上滚动 ↑`, `region.below_labels` `{labels}在下方 · 向下滚动 ↓`,
  `region.more_below` `下方还有更多 · 向下滚动 ↓` — middle dot with spaces (17 shipped precedents,
  e.g. `工作中 · {elapsed}`), arrows kept and correctly oriented, `{labels}` untouched, no English
  left. ✔
- `video.title_fallback` `视频` (shipped `播放视频{name}` ✔); `session.fallback_name` `会话` — bare
  noun, correct as a header title and inside "back to" context, glossary `session → 会话` ✔.
- `account.app_name` `Local Operator` — byte-identical, as required. ✔

Register: 你 throughout, no 您 in this group (the single shipped 您 in `mobile.team_bridge.json` is
pre-existing, outside this lane and outside this group — observation only, never a gate). No 啦/哦/呀,
no ！, no 请, no sentence-final 。 on the 24 label/status values, 。 kept on the three full sentences
(four stops, including `host_answering`'s two). Punctuation is full-width inside prose, half-width
only inside placeholders — matching the guide.

## 4. Shipped-term recount (used as ground truth above)

Grep over `catalogues/zh-CN/*.json`: 电脑 53 · 会话 49 · 你的 10 · 隧道 7 · 中继 7 · 上下文 2 ·
连接中 1 · 连接路径 1 · 未响应 1 · 空闲 1 · 在线 1 · 视频 1 · 数据流 1 · 离线 0 · 您 1 (pre-existing,
`mobile.team_bridge`). `" · "` separator: 17 uses.

## 5. Limits of this audit

- I did not render anything: no device, simulator or RN web view was used, so MAJOR-1's cell counts are
  arithmetic against the D17 comment, not a captured frame. A `< 340 pt` still would settle it; if the
  corrected 15-cell string renders on one line, the finding is answered by that evidence.
- No maxCells/maxChars hints exist for these 27 keys in `en/*.context.json` (checked all three
  namespaces), so "fit" is judged against the call-site layout constraints only.
- Mono-font CJK fallback glyph advance is assumed full-width per the style guide's 2-cells-per-CJK
  rule; a mono family with a narrower CJK fallback would shift the numbers, not the ordering.
