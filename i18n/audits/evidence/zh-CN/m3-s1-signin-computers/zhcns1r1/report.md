# Audit report — zh-CN / mobile.computers + mobile.signin (M3 S1, 44 keys)

- **Verdict: CHANGES REQUESTED** — 0 blocker / 1 major / 2 minor / 5 nit.
- **Auditor:** `i18n-auditor` (independent lane). I did not translate these values and did not edit any file in the worktree. Instance `076aa4e7f41e`.
- **Auditor model:** `deepseek/deepseek-flash` — the harness session model (system prompt names it); no role/tier pin, no fallback used. Stated as the actual model, not a preferred one.
- **Translator (for independence only):** session `29c21686ee28` scratchpad lane, model `deepseek/deepseek-flash` per its notes; different instance from mine. I formed a view of every key before reading its notes and disagree with it on ZH-01 and ZH-02.
- **Head under audit:** `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce` (worktree `~/local-operator-mobile/.worktrees/i18n-m3-s1`, base `origin/main` `9e193b57`), read-only throughout.
- **Draft audited:** `draft-zh-CN-s1.json` sha256 `6969215384e6841040121536acc8e2c510d25c4f73d3100a32fb5fa2bf3c629b` (matches the hash in the task).
- **Brief:** sha256 `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f`.
- **No machine translation service, API, SDK or site was used** for judging or back-translation.

## Inputs read (hashes are sha256)

| Input | sha256 |
|---|---|
| `en/mobile.computers.json` | `f0b7ee2800700254b8c2b90d1dac6811be79ec23ffdfd0f1460bba6accb40109` |
| `en/mobile.signin.json` | `2fc23f0abea7d1be5a1679e4d73a08fa8787353a4aefe8764eed29cb88d20252` |
| `en/mobile.computers.context.json` | `93a3f18eacd3985a65cef115e50dee5fdad9731b7692fccf4089e473723e6e6a` |
| `en/mobile.signin.context.json` | `1e9dc9d97bd3c5733d6631530996acb56e318c6ed24ed245450eabff32996f56` |
| shipped `zh-CN/mobile.computers.json` | `b6f9e5bffbec5bb58ff3d1fb44bb592fd0779b312bec8655a1204348f45e0038` |
| shipped `zh-CN/mobile.signin.json` | `00d37fc3f73ac25efecbbaf9b1a16d673d56d1984cca5f9f01a044b6f95ee7fe` |
| shipped `zh-CN/mobile.common.json` / `mobile.chrome.json` / `mobile.settings.json` | `ce313993…567e` / `3e4b76be…6b85` / `db364cb8…c44b` (full values in the receipt) |
| `i18n/style-guides/zh-CN.md` @ `origin/main` `8459804f` | `8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c` |
| `i18n/glossary.md` @ `origin/main` `8459804f` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| call sites | `src/features/auth/{computers,tunnel-paths,sign-in,sign-in-panel,welcome}.tsx`, `connector-wait.ts`, `src/ui/components/badge.tsx` |

## 1. Mechanical — PASS

Run with the repo's **own** parser (`parseMessage` from `src/i18n/messages.ts`, the module `scripts/i18n/generate.ts` fails a commit on), imported read-only from the worktree; checker at `audit-zhCN.mjs`, transcript at `audit-zhCN-m3s1.log`.

- 44/44 values parse; JSON valid UTF-8, no BOM, no control/format (bidi) characters.
- Key set and **key order identical to the brief**; no key added, dropped, renamed or reordered.
- Placeholders **name and kind** identical to English: `status:text` (`wait.tunnel_status`), `name/status/reach:text` (`row.a11y`, `a11y_active`, `a11y_connecting`). No plural or select anywhere in this slice, and none invented; no CLDR-category question arises (`other`-only rule not exercised).
- Brace count per value equals English; no stray/literal braces.
- Latin tokens preserved byte-identically: `Radient`, `Local Operator`, `URL`.
- Ending punctuation matches English on all 44 (…… where the source has an ellipsis, 。 where it has a full stop, none on labels/buttons/badges).
- Style-guide rules all clean: no 您 (你 used where a pronoun is needed), no 请, no ！, no 啦/哦/呀, no ASCII `...`, no half-width punctuation after CJK, **no** space between CJK and Latin runs, ellipses are `……` (even U+2026 runs).
- My first checker run wrongly flagged `wait.listing` and `panel.opening` as single-`…`: a bug in **my** alternation regex, not in the draft. Verified by code point (`U+2026 U+2026` in both), fixed the checker to a run-length test, re-ran clean — recorded in the log so the error is auditable.

**The repo's own `node scripts/i18n/generate.ts --check` cannot see this draft** (it reads locale directories on disk, and the worktree is read-only for me). On the branch head it exits 1 because the *shipped* locales have not yet been given the 30 new `mobile.computers` keys — the English-first branch state, reported first for `es`, never reaching `zh-CN`. So the draft was validated with the same parser directly instead of with the wrapper. `i18n:check`, `i18n:strings:check` and the render gate belong to whoever lands the draft.

## 2. Findings

### ZH-01 — MAJOR — `mobile.computers.wait.tunnel_status`

- **Current:** `Radient已配置好隧道，状态：{status}。`
- **English:** `Radient has the tunnel — {status}.`
- **Problem:** the English is *neutral possession* ("Radient now has this tunnel, here is its status"). `已配置好` asserts **completed provisioning**, which the product goes out of its way not to assert. `{status}` is not a fixed word: it is the control plane's raw token (`computers.tsx:426` → `found.rawStatus`, `connector-wait.ts:181` → `state.tunnelStatus`), and the vocabulary in `statusLabel` (`computers.tsx:73-88`) includes `provisioning`, `suspended`, `disabled`, `revoked`. The line can therefore render **`Radient已配置好隧道，状态：provisioning。`** — "has finished setting up the tunnel, status: setting up" — i.e. a self-contradiction, and a collision with the badge `配置中` = provisioning. It also breaks the invariant the call site states in words: *"never rewritten into 'active', because `disabled` and `suspended` are statuses this app must not call provisioned"* (`connector-wait.ts:178-181`; same rule restated at `computers.tsx:57-58`). This sits on the BLOCKER boundary; I graded MAJOR because the status token follows immediately and disambiguates, but the copy should not claim provisioning at all.
- **Suggested:** `Radient已有此隧道，状态：{status}。` (neutral possession; still grammatical around the untranslated Latin token, which is the note's requirement).

### ZH-02 — MINOR — `mobile.signin.welcome.headline`

- **Current:** `你的智能体运行在你的电脑上。`
- **Problem:** two `你的` in one thirteen-character headline. The zh-CN style guide is explicit: *"No 您/你 repetition: Chinese drops pronouns naturally — prefer verb-forward phrasing."* The second possessive carries the claim (your machine, not the cloud); the first does not, and the headline is the first sentence a new reader sees. The translator kept both deliberately; I read it as the pattern the guide discourages.
- **Suggested:** `智能体运行在你的电脑上。` (if both are wanted for emphasis, `你的智能体，就运行在你自己的电脑上。` — longer, and I would not choose it for a headline).

### ZH-03 — MINOR — `mobile.computers.paths.radient_body`

- **Current:** `…并提供私有且经过身份验证的URL，因此此手机无需任何配置，也无需保管中继密码。`
- **Problem:** `因此` + `此手机` puts 此/此 adjacent (`因此此手机`), which stumbles when read aloud and reads as translated rather than written.
- **Suggested:** `…并提供私有且经过身份验证的URL，因此手机上无需任何配置，也无需保管中继密码。`

### ZH-04 — NIT — `mobile.computers.not_harness`

- **Current:** `这台电脑未运行Local Operator。` The English names *the Local Operator harness*; the noun is dropped.
- **Accepted, not requested:** it follows the shipped precedent (`harness_help` = `在 Radient 控制台中为此隧道启用 Local Operator。`). Recorded because the glossary has **no row for harness**; the translator's proposed `运行框架` is not endorsed by this audit — either add a row or record the drop as the policy.

### ZH-05 — NIT — `mobile.computers.try_now`

- **Current:** `立即重试` for `Try now`. Adds `重试`, which the English does not say. Clearer for a button that re-runs discovery and consistent with the `重试` family; recorded so a later literal pass does not "correct" it.

### ZH-06 — NIT — `mobile.computers.paths.own_body`

- **Current:** `进阶方式：自行运行隧道来发布电脑，并在此粘贴其地址。` `发布电脑` with no complement can be read as "release a computer"; the direction of exposure is unstated. Risk is low (the following clause explains it). Suggestion if it is touched anyway: `自行运行隧道，把电脑发布出去，并在此粘贴其地址。`

### ZH-07 — NIT — translator notes (not a shipped string)

`notes-zh-CN-s1.md:82` cites `mobile.signin.panel.try_anyway`; the key is `mobile.signin.try_anyway` (only opening/waiting/cancelled/unavailable carry the `panel.` prefix). Documentation only — no shipped value is affected.

### ZH-08 — NIT — `mobile.computers.paths.own_title`

- **Current:** `设置自己的隧道` for `Set up your own tunnel` (heading on the tunnel-paths card **and** the quiet button on the welcome screen).
- **Problem:** `设置` is this product's word for *Settings* (`mobile.settings`), so a button can read as "the tunnel's settings". `搭建` is the specific verb for standing a tunnel up. Recorded, not requested — both strings are idiomatic enough not to gate.

## 3. Rulings the manager asked for

**R1 — ellipsis: ship `……`.**
The binding zh-CN guide says *"Ellipsis is …… (two marks), not '...'"*, and `……` is also the mainland-correct typography. My census of the shipped catalogue: **17 single `…` runs vs 7 `……` runs**, including a contradiction inside one file (`mobile.computers.connecting` = `正在连接……` but `signing_out` = `正在退出登录…`). The draft is right; the catalogue is inconsistent. **Ruling: the draft ships as written, and one mechanical normalisation pass over the shipped zh-CN values (to `……`) should ride the same landing commit** — otherwise the new `正在打开浏览器……` sits beside the shipped `正在登录…` on the sign-in screen. Amending the guide to `…` instead is the only other coherent option, and nobody has proposed it.

**R2 — Latin spacing: ship no space.**
The guide forbids a space between Chinese and Latin runs, with its own rationale (width discipline, mainland software convention). The draft follows it. The shipped catalogue does not: my recount is **55 spaced adjacencies (29 CJK→Latin, 26 Latin→CJK) vs 19 unspaced**, and on the very screen this slice changes, four shipped values carry ten of them (`account_mismatch`, `billing_help`, `disabled_help`, `harness_help`). (The translator reported 54/19; my count differs by one adjacency, ranking unchanged.) So the draft will sit next to spaced shipped copy on the same rows. **Ruling: the no-space form ships — it is the binding rule, and a per-string mix is the worst outcome — and the shipped zh-CN values on these screens should be normalised in the same wave.** If the team would rather match the spaced majority, that is a **guide amendment first**, then a reissue of the 8 affected keys (`not_harness`, `wait.listing`, `wait.tunnel_status`, `paths.radient_title`, `paths.radient_body`, `paths.own_body`, `signin.start`, `panel.unavailable`); do not ship both conventions.

**R3 — mono badges with CJK: render note, not a wording defect.**
The status and reach badges are `Badge mono` (`computers.tsx:199,203`) in one `flex-row` with `gap-2` and **no** `numberOfLines`. Chinese badge labels are 4–8 cells (`路径就绪` is the widest) against 7–12 ASCII characters in English, so **no overflow risk** at any reasonable width — the row gets shorter in zh-CN, not longer. The open item is the face: `badge mono` paints through the mono family, and this repo has a measured defect from exactly that (`features/session/components/turn-bar.test.ts:35-36`: "*`font-mono` drew Urdu's cursive details as disconnected letters*"). For CJK, per-glyph fallback usually renders cleanly, but it has not been rendered. Request: one rendered frame of a row carrying both badges in zh-CN, at 320 pt and at the largest type step, before sign-off — evidence, not a wording change.

**R4 — the one English word left on a localised screen is by design.**
`wait.tunnel_status` inserts `{status}` verbatim — the control plane's own token (`active`, `suspended`, `disabled`, `provisioning`). So the zh-CN line reads `Radient已有此隧道，状态：active。` and every locale keeps that residual English. This is what the brief mandates and the call site intends; it is also the one place where the operator's "no English anywhere" cannot be met by translation. If the requirement is literal, the follow-up is to map the control-plane status vocabulary through keys (a code change in `statusLabel`/`connector-wait`), not a translation change. Flagging so the final claim is precise.

## 4. Second pass (high-visibility groups)

Per the standing instruction I did not treat the first pass as final. Second deliberate pass over the fourteen `mobile.signin` values plus the destructive remove dialog, reading for negation scope, modal force, ambiguity for a non-technical reader, and register drift: **no additional finding** — `signin.intro` (privacy guarantee: `应用绝不会看到你的密码`), `panel.cancelled_help` (`你的账户没有任何改动`), `remove.body` (all three negations present: 电脑本身 / 其隧道 / 你的账户) and `billing_inactive` (`远程访问将被拒绝`) all hold their polarity and safety. What the second pass did change is ZH-01: on first reading `已配置好` looked like a harmless gloss of "has"; re-reading it against the call site showed it asserts a state the app's own comment forbids.

## 5. Per-key verdicts

Clean (no finding): `wait.listing`, `wait.answered`, `wait.use_computer`, `wait.start_again`, `refresh`, `list.heading`, `own_tunnel_instead`, `remove.title`, `remove.body`, `remove.confirm`, `paths.radient_title`, `paths.recommended`, `paths.own_action`, `signin.title`, `signin.intro`, `signin.start`, `signin.use_address`, `panel.opening`, `panel.waiting`, `panel.waiting_help`, `panel.cancelled`, `panel.cancelled_help`, `panel.unavailable`, `panel.unavailable_alt`, `try_anyway`, `welcome.body`, `status.route_ready`, `status.provisioning`, `status.suspended`, `status.disabled`, `status.revoked`, `status.unknown`, `reach.answering`, `row.a11y`, `row.a11y_active`, `row.a11y_connecting`, `billing_inactive`.

Finding as above: `wait.tunnel_status` (ZH-01), `welcome.headline` (ZH-02), `paths.radient_body` (ZH-03), `not_harness` (ZH-04), `try_now` (ZH-05), `paths.own_body` (ZH-06), `paths.own_title` (ZH-08). Notes-only: ZH-07.

Terminology was checked against the shipped catalogue and the glossary: 电脑, 此手机, 登录, 隧道, 中继, 账户, 账单, 智能体, 会话, 移除, 刷新, 重试, 使用中 / 连接中 (the a11y trailing words match `badge.active` / `badge.connecting` exactly, as the sidecar requires). No glossary violation found; no new term contradicts shipped copy, with the single exception recorded in ZH-01 (`配置好` vs the `配置中` badge family).

## 6. Limitations and evidence

- **Rendering:** no frame was captured and no simulator was run by this audit. The fit judgement is a cell measurement (CJK and full-width = 2 cells) plus the call-site geometry, so read the badge figure in R3 as an estimate and the requested frame as the evidence that would retire it. This report is a copy audit, not UI evidence.
- **Ledger/evidence:** per this task's record instruction nothing was written into the mobile worktree, and nothing was committed into `~/local-operator`. The canonical evidence home for a landed bundle is `i18n/audits/evidence/zh-CN/<group>/<audit-id>/{record.json,report.md,audit.log}`; landing it is the manager's/implementer's step, and this report does not claim it is on `main`.
- **Second independent instance:** I performed the second pass myself (same instance) and say so rather than implying a separate auditor ran one. The translator is a different instance (its notes' session `29c21686ee28`) and I never saw its reasoning while forming the above, only afterwards.
- **Evidence files:** `receipt-zhCN-m3s1.json` (machine record), `audit-zhCN-m3s1.log` (real commands and their actual output, sections [1]–[9]), `audit-zhCN.mjs` (the checker), all in `/Users/damian/.local-operator/sessions/4fa2d8152a9f/scratchpad/`. `audit.log` there is the raw `tee` of the checker's *first* run, kept only because transcript section [5] quotes it; the authoritative run is `audit-zhCN-m3s1.log` [4].
