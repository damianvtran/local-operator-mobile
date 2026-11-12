# zh-CN S1 revision — v2 notes (translator pass 2)

- **Translator (this pass):** fresh `i18n-translator` instance, session `7a547984994d`.
- **Model:** `deepseek/deepseek-flash` — the harness session model, no role pin, no
  fallback used or attempted. Stated as the actual model.
- **Head:** `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce` (worktree
  `~/local-operator-mobile/.worktrees/i18n-m3-s1`), read-only: nothing edited,
  committed, checked out or installed in the worktree.
- **Original draft:** `/Users/damian/.local-operator/sessions/29c21686ee28/scratchpad/draft-zh-CN-s1.json`,
  sha256 `6969215384e6841040121536acc8e2c510d25c4f73d3100a32fb5fa2bf3c629b`
  (verified before use; 44 keys).
- **Audit report adjudicated:** `/Users/damian/.local-operator/sessions/4fa2d8152a9f/scratchpad/report-zhCN-m3s1.md`
  (ZH-01..ZH-08).
- **Manager rulings treated as binding, not re-litigated:** ellipsis ships `……`;
  no space between CJK and Latin runs; R4 — `{status}` is being mapped to a
  localised label in code, so the wording must read correctly around a *translated*
  status word as well as around the raw token.
- **No translation API, SDK, MT service or website was used.** Every value below was
  authored by reasoning and checked against the English source, the context
  sidecars, the shipped zh-CN catalogue, the style guide and the glossary.

## Inputs read

| Input | sha256 |
|---|---|
| `en/mobile.computers.json` | `f0b7ee2800700254b8c2b90d1dac6811be79ec23ffdfd0f1460bba6accb40109` |
| `en/mobile.signin.json` | `2fc23f0abea7d1be5a1679e4d73a08fa8787353a4aefe8764eed29cb88d20252` |
| `en/mobile.computers.context.json` | `93a3f18eacd3985a65cef115e50dee5fdad9731b7692fccf4089e473723e6e6a` |
| `en/mobile.signin.context.json` | `1e9dc9d97bd3c5733d6631530996acb56e318c6ed24ed245450eabff32996f56` |
| brief | `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f` |
| `i18n/style-guides/zh-CN.md` @ `origin/main` | `8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c` |

Call sites read (not edited): `src/features/auth/computers.tsx` (`statusLabel`
73–88, wait panel render 250–262, `rawStatus` 418–426),
`src/features/auth/connector-wait.ts` (172–191), `src/features/auth/welcome.tsx`
(58–105), `src/features/auth/tunnel-paths.tsx` (37–70). Shipped
`src/i18n/catalogues/zh-CN/{mobile.computers,mobile.signin,mobile.settings}.json`.

## Per-finding adjudication

### ZH-01 — MAJOR — ACCEPTED — `mobile.computers.wait.tunnel_status`

- old `Radient已配置好隧道，状态：{status}。`
- new `Radient已有此隧道，状态：{status}。`

Evidence I verified myself, not taken on the auditor's word:

1. `computers.tsx:258-261` renders `t("mobile.computers.wait.tunnel_status", { status: state.tunnelStatus })`;
   `connector-wait.ts:181` sets `tunnelStatus: found.status`, and `computers.tsx:426`
   shows that `found.status` is `rawStatus` — the control plane's own string, not a
   label. `statusLabel` (73–88) maps exactly six statuses, including `provisioning`,
   `suspended`, `off`→已禁用 and `gone`→已撤销.
2. Therefore the sentence really can render `Radient已配置好隧道，状态：provisioning。`
   (before R4's mapping) or `…状态：配置中。` (after it): "the tunnel is fully
   configured, status: configuring". That is a self-contradiction in the same line,
   and with 已暂停 / 已禁用 / 已撤销 it asserts provisioning the app's own comment
   (`connector-wait.ts:178-181`) forbids. English "has the tunnel" is neutral
   possession (the tunnel exists on Radient's side; here is its state).
3. `已有` is the neutral possessive, names no lifecycle stage, and stays grammatical
   with both slots: `状态：active` and `状态：配置中` / `已暂停` / `已撤销` all read
   naturally. I considered `隧道已在Radient端` (awkward without 端) and
   `由Radient托管` (adds hosting semantics the English does not state), and rejected
   both for that reason. `此隧道` matches shipped `billing_help` (`…此隧道的账单设置…`).

### ZH-02 — MINOR — ACCEPTED — `mobile.signin.welcome.headline`

- old `你的智能体运行在你的电脑上。`
- new `智能体运行在你的电脑上。`

The style guide is explicit ("No 您/你 repetition … prefer verb-forward phrasing"),
and the load-bearing possessive is the second one — it is the local-execution claim
(the machine, not the cloud). `welcome.tsx:62-67` renders it as `text-title`,
centred, with no `numberOfLines`: 24 cells (12 chars) against a 30-character
English headline, so nothing tightens. I did not take the auditor's longer
alternative (`你的智能体，就运行在你自己的电脑上。`): it re-adds a pronoun and is a
third longer for no extra claim.

### ZH-03 — MINOR — ACCEPTED — `mobile.computers.paths.radient_body`

- old `…因此此手机无需任何配置，…`
- new `…因此手机上无需任何配置，…`

`因此此手机` puts two `此` in contact — a spoken-reading stumble, and the one
repeated-character adjacency in the whole 44-key draft (census run: none left).
`手机上` keeps the referent (the phone app, not the desktop), keeps the clause at
the same length, and does not disturb the three clauses the sidecar requires
(account needed / Radient runs the tunnel and gives a private authenticated URL /
nothing to configure on the phone, no relay password). No CJK–Latin space added.

### ZH-04 — NIT — KEPT (no change), with a glossary proposal — `mobile.computers.not_harness`

The English noun "harness" is dropped: `这台电脑未运行Local Operator。` I keep it.
Reasons: the glossary has no row for *harness*, so inventing `运行框架` would put a
term in the UI that no other string uses; the shipped precedent (`harness_help` =
`…为此隧道启用 Local Operator。`) already names the product and drops the noun; and on
a muted row the shorter line is the clearer one. The auditor reached the same
conclusion and explicitly did not endorse `运行框架`. Glossary proposal below.

### ZH-05 — NIT — KEPT — `mobile.computers.try_now`

`立即重试` adds a verb the English leaves implicit, but the sidecar says the button
"re-runs discovery immediately" and the banner exists only after a failed attempt, so
"retry now" is the action's real meaning; `立即重试` also joins the `重试` family in
the same slice (`try_anyway` = 仍要重试, `refresh` = 刷新). No change.

### ZH-06 — NIT — KEPT — `mobile.computers.paths.own_body`

`自行运行隧道来发布电脑` — `发布电脑` alone could be misread as "release a
computer", but the clause continues into `并在此粘贴其地址`, which fixes the
direction of exposure one phrase later; the risk the auditor names (low) is bounded
by the sentence it sits in. No change: a rewrite for a bounded reading risk would be
unreviewed churn on a string nobody flagged as gating.

### ZH-07 — NIT — NOTES ONLY (not a shipped string)

Correct key is `mobile.signin.try_anyway` (only `panel.opening`, `panel.waiting`,
`panel.cancelled`, `panel.unavailable` carry the `panel.` prefix). The incorrect
citation is in the pass-1 translator's notes file, not in any catalogue value. These
v2 notes use the exact key names; nothing shipped changes.

### ZH-08 — NIT — KEPT (my call, as the manager delegated it) — `mobile.computers.paths.own_title`

`设置自己的隧道` for "Set up your own tunnel". Kept, and here is the call with its
evidence: `设置` is indeed this product's Settings (`mobile.settings.screen_title`
= `设置`), but (a) `设置` + object is unambiguously the verb "to set X up" in
Chinese — the Settings collision only bites when the bare noun is alone in a
navigation slot; (b) neither call site renders a Settings affordance on the same
screen: `tunnel-paths.tsx:59` is a `SectionHeader` inside the own-tunnel `Card`, and
`welcome.tsx:97` is a quiet `Button` on the first-run welcome screen, which is a
branded `Screen` with no tab bar; (c) the auditor recorded it as not gating. If a
`设置` affordance ever lands on the same screen, the fix is `搭建自己的隧道` — noted
here rather than pre-emptively shipped.

## Formatting inside the v2 file

- Key set, key order and tab indentation identical to the original draft (44 keys,
  brief order); only the three values above differ. No key added, dropped or renamed.
- `{status}` preserved exactly; `params` for `wait.tunnel_status` is
  `[["status","text"]]`, identical to English. No plural/select in this slice, so no
  CLDR category question arises.
- Latin tokens preserved: `Radient` (×2 in radient_body), `URL`, `Local Operator`.
- No CJK–Latin space, no ASCII `...`, no bidi/format characters, full-width
  punctuation only, `。` endings match English full stops (no ellipsis in the three
  changed values, so the `……` ruling is not exercised here).

## Validation (repo's own parser) and negative control

`revision-zh-CN-s1.mjs` imports `parseMessage` read-only from
`src/i18n/messages.ts` (the module `scripts/i18n/generate.ts` gates commits on) and
checks, for all 44 values: parse succeeds, placeholder names+kinds equal English,
brace counts equal English, key order equals the brief, ending punctuation matches
English, Latin tokens retained, no bidi/format characters.

Run output (`revision-run.log`, exit 0): `problems: []`, `keyCount: 44`.
Widest value is `radient_body` at 113 cells (English: 205 characters).

Negative control (`negctl-zh-CN.mjs`), so the clean run is not vacuous:

- `Radient已有此隧道，状态：{status。` → **THREW** `Invalid message …: expected ',' or '}' (at offset 23)`
- `Radient已有此隧道，状态：{stat}。` → parsed, `params=[["stat","text"]]` — a
  *renamed* placeholder is syntactically valid, which is exactly why the checker
  compares names against English rather than trusting the parse alone.
- `你的智能体运行在你的电脑上。` → parsed, no params (baseline).

The repo's `node scripts/i18n/generate.ts --check` still cannot see this draft: it
reads locale directories on disk and the branch is English-first (the shipped
locales lack the 30 new `mobile.computers` keys), and the worktree is read-only for
me. Reported as a wrapper limitation, not a pass.

## Glossary proposals

1. **harness** — add a row: *no translation; refer to the product as Local Operator
   (drop the noun) where the sentence allows. If a noun is unavoidable in a
   language, prefer a generic "runtime/framework" term rather than a transliterated
   one.* Foundation: ZH-04, shipped `harness_help`, `not_harness`.
2. **tunnel status** — no new term needed: 隧道 + the shipped `status.*` family
   (路径就绪 / 配置中 / 已暂停 / 已禁用 / 已撤销 / 未知) is the vocabulary to reuse when
   R4 maps `statusLabel` into `{status}`.

## Deliverables

- `replacements-zh-CN-s1.json` — sha256 `c9ccace4f4f6ee9a572f4c5e10a95d11183158afd8514f6fcb831181361a35ed`
- `draft-zh-CN-s1-v2.json` — sha256 `007dc881078ff550bdcde01ffb6be7a3be8d31507f84a5b12ebbaeb53f9991b7`
- `revision-zh-CN-s1.mjs`, `revision-run.log`, `negctl-zh-CN.mjs` (evidence)

I did not audit this locale; the re-audit stays with the independent auditor.
