# i18n audit — vi / M2 expression-literal slice (independent re-audit of the SHIPPED bytes)

- Audit ID: `m2-re-vi-1`
- Locale: `vi` · File group: `mobile.computers` + `mobile.session` + `mobile.settings` (33 keys)
- PR: `#236` M2 · worktree `~/local-operator-mobile/.worktrees/i18n-m2-scanner`
  HEAD `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a` · slice base `fa2bc5e0`
- Keys derived, not assumed: `git diff fa2bc5e0..HEAD -- src/i18n/catalogues/vi` → 4 `computers`
  + 15 `session` + 14 `settings` = **33**, 0 changed-existing, 0 dropped, relative order identical
  to `en`. The PR also introduces all 33 English keys + all 33 context notes (none existed at
  `fa2bc5e0`).
- Auditor: agent `i18n-auditor`, session `6934f10bf7bd`, **served model `deepseek/deepseek-flash`**
  (session model header; `actual_model_source` = that header, no in-harness attestation, no
  fallback observed). Independent of the translator (`i18n-translator`, `openai/gpt-6.1-sol`) and
  of every earlier auditor of this slice.
- Binding guidance read: `~/local-operator/i18n/style-guides/vi.md`,
  `~/local-operator/i18n/glossary.md`, `docs/i18n.md`, `AGENTS.md` § Internationalization,
  the 33 `en` sidecar notes, the evidence bundle `i18n/audits/evidence/vi/m2-expression-literals/`.
- **No translation/MT service used.** READ-ONLY: no repo/ledger/PR write; small scripts only, in
  session scratch.

## VERDICT: **changes-requested** — 0 BLOCKER · 1 MAJOR · 2 MINOR · 1 NIT

---

## 1. Identity of the thing audited (hashes)

Sorted-key JSON digests over exactly the 33 key/value pairs (UTF-8, no trailing newline):

| Input | sha256 |
|---|---|
| target (`vi` shipped values, sorted keys) | `3b48c60e64c1d896884a40dddd9d748e3bb3061d7bc15c4b45d4f9eaf570d009` |
| source (`en` values, sorted keys) | `c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528` |

File hashes (whole catalogue files, as shipped at HEAD):

| path | sha256 |
|---|---|
| `src/i18n/catalogues/en/mobile.computers.json` | `713827837aab9d75611441155d50522ccce9d8b410d88c1b7bd27e528776aff3` |
| `src/i18n/catalogues/en/mobile.computers.context.json` | `cc2973003f79db729001df88189b1f1ba52a0609e117fe384396a406437637e0` |
| `src/i18n/catalogues/en/mobile.session.json` | `8df14a0d12ef0386a3115c55dcdf7976e7234b9e82a79279741985e11aa716d3` |
| `src/i18n/catalogues/en/mobile.session.context.json` | `a988f1c90c380802bef31c8f8737cc9a6f32334518c652283a3d3dd210520ae5` |
| `src/i18n/catalogues/en/mobile.settings.json` | `d7e1d85b68773871a578791ad57e0a08e421a220738e561b9e09ce22f9aee23d` |
| `src/i18n/catalogues/en/mobile.settings.context.json` | `67691ab95fba5cbcc86596899504ce2b9ba1acd518b3a9bdc1048dcc22b54c12` |
| `src/i18n/catalogues/vi/mobile.computers.json` | `daab971c3ae7b8a2e509d9e3383d3c0786cc54bd5f383255bb1f8c460e050aab` |
| `src/i18n/catalogues/vi/mobile.session.json` | `b5b41ee521f82b4d14e93e1efe8741ca7800f14d4df9022777807f886f19bf5e` |
| `src/i18n/catalogues/vi/mobile.settings.json` | `7a21a379708fd5be9081802d94a00c2d5061387ca2d3cc19fa493b1914e408f9` |

## 2. Shipped vs audited text, and the post-audit rename (task step 3)

- Last audit round: **round 2** of this slice (`round2.md`, candidate `vi.v3.json`, auditor
  `anthropic/claude-sonnet-5-5`) — verdict then `clean-with-findings 0B/0M/1m/1n`.
- The evidence bundle's `final.json` **is** the shipped set: key set identical, **0 value
  differences** over all 33 keys, and its file hash
  (`8c2000826acfd005134aef377931167c362fdca5a16f717a0d32abbc2b9ec97f`) equals the hash the bundle
  manifest records for it.
- The candidate `vi.v3.json` is **gone** (translator session scratchpad is empty), so "final == v3"
  cannot be re-derived byte-for-byte today; it is asserted by the manifest. What I could check:
  round 2 quotes **22 of the 33 shipped values verbatim**, and every quote agrees with the shipped
  bytes — no shipped value contradicts any round-2 quote.
- **Rename**: round 2 (like ru/fr/es/ur) read the four region labels under the old dotted names
  `mobile.session.region.label.{working,subagents,todos,strip}`; the shipped names are
  `mobile.session.region.label_working|label_subagents|label_todos|label_strip`. Values are
  unchanged, and I verified the shipped names against both authorities:
  - sidecars: `en/mobile.session.context.json` carries exactly `…label_working` etc. (4/4);
  - call sites: `git grep` finds `t("mobile.session.region.label_working")` … `label_strip` at
    `app/(app)/session/[id].tsx:1100-1103` (the `REGION_LABEL` map), plus `catalogue.gen.ts`;
  - no old dotted name survives anywhere in the tree; each value sits on the right English source
    (working→"activity", subagents→"agents", todos→"tasks", strip→"status").
  So the shipped **text** is the audited text; the shipped **key names** were read by no auditor
  before this pass — they are correct. I still re-audited all 33 values on their merits (§3), so
  the verdict does not rest on the earlier round.

## 3. Mechanical pass (my own checker, then negative-controlled)

| Check | Result |
|---|---|
| JSON validity, all 3 files parse; en/vi key sets equal per namespace (45/78/59) | PASS |
| Key set = the 33 added; 0 added, 0 dropped; relative order == `en` in all 3 files | PASS |
| Placeholders name+type identical on all 9 parameterised keys (`{host}`, `{name}`×2, `{percent}`×4, `{labels}`, `{baseUrl}`) | PASS |
| ICU plural/select: none in the slice (0 keys) — nothing invented, no arms to check; plural logic proved on a real plural key outside the slice (below) | N/A, proved |
| Markup / backticks / commands / flags / paths / identifiers | none in source or target — nothing to drift |
| Separators and glyphs `·` (with spaces), `↑`, `↓`, `%`, `( )` — byte-preserved in all 6 keys that carry them | PASS |
| Empty / non-string values; double spaces; ASCII `...`; control chars; bidi controls (policy: none in a catalogue) | none |
| NFC precomposition (vi rule) | all 33 NFC |
| Final-stop parity: sentence keys `wait.host_answering`, `wait.answering`, `added.connected_to` end with `.`; `status`/`meta`/`button` keys have none | PASS |
| English-identical values | 4 keys / 3 distinct strings, all named: `account.app_name` "Local Operator" and `Radient` in two keys (product names, git glossary §1), `video.title_fallback` "Video" (settled vi loanword, shipped 1× already in `highlights.video_open`), `tray.context_short`/`_short_estimate` "{percent}% ctx" → the only one no authority authorises, see **F2** |
| Repo validator: `node scripts/i18n/generate.ts --check` | exit 0 — "catalogue.gen.ts is current (684 keys, 21 namespaces…)" |

**Negative control (checker must bite).** Mutating values in memory produced exactly the expected
flags: `{host}`→`{hostname}` and `{name}`→`{ten}` → "placeholder drift"; deleting `↑` → "glyph
count"; ASCII-ised `ngoai tuyen` → "NOT NFC precomposed". ICU control against the real plural key
`mobile.computers.wait.relay_version_sessions` (removing the `other` arm and dropping `{version}`) →
3 flags: placeholder drift, arms `['one']` vs `['one','other']`, "missing CLDR arm 'other'". The
pass above is therefore a biting pass, not a rubber stamp.

**Widths** — measured, not asserted: CoreText, `.AppleSystemUIFont` at **text-meta 12/500** (the cue
line's own type step), greedy word wrap against 358 pt (a 390 pt device less `px-4` = 32) and 288 pt
(320 pt device):

| string | pt | 390 pt | 320 pt |
|---|---|---|---|
| vi cue, all 4 bands hidden: `hoạt động · tác nhân con · tác vụ · trạng thái bên dưới · cuộn ↓` | 360.4 | **2 lines** | 2 |
| es cue, same state | 320.8 | 1 | 2 |
| fr cue, same state | 298.2 | 1 | 2 |
| en cue, same state | 272.2 | 1 | 1 |

Counts (mono 12 px, fixed pitch ⇒ cells = chars): status pills and diagnostics stay at or near en
(vi `Không kết nối được` 18 = 111.7 pt vs en's longest pill value `No connection yet` 17 = 105.3 pt;
`Đã kết nối` 10; `Không phản hồi` 14); the tray narrow slots are the exception — see **F1**.

## 4. Findings

### F1 — MAJOR — `mobile.session.tray.context_short_estimate` (and `mobile.session.tray.context_estimate`)
- Current: `{percent}% ctx (ước tính)` · wide `{percent}% ngữ cảnh (ước tính)`
- Problem: the narrow estimate slot is **wider than the string the design fix removed**. The call
  site records (design D17, `app/(app)/session/[id].tsx:1004-1008` and `:132`) that
  `21% context (est.)` — 18 cells — "wraps to two lines inside the band, and the cost then floats
  between them"; `ctx` was the fix, taking en to **14 cells** at a two-digit percentage (**15** at
  `100%`). The vi narrow estimate is **18 cells** at a two-digit percentage and **19** at `100%` —
  i.e. equal to the proven-wrapping width in every estimate state under 340 pt, and 3-4 cells above
  en's fixed form. `21% ctx` (non-estimate) is 7 cells and fine; the defect is the `(ước tính)`
  marker, not `ctx`. The wide form is 23 cells vs en's 18, so it is also over the budget en fits
  between 340 and ~375 pt (derived, see caveat). The band is `flex-row flex-wrap`, so the failure
  mode is the two-line band D17 fixed, not clipping.
- Basis and limits: cell counts are exact (fixed-pitch mono); the 18-cell reference is the code's own
  D17 record. The chip cannot silently be absent in the narrow state: `narrow` is `viewportWidth <
  340`, which implies a portrait phone, and `compact` (which drops the chip) is short-**landscape**
  chrome (`compactChromeFor`, `src/ui/size-class.ts:225`), so the chip is on screen whenever the
  narrow slot renders. The wide-band claim depends on the chip's measured width, which I did not
  render — a 320/360 pt frame with `context_is_estimate=true` and a ≥99 % percentage is the
  confirming capture (design/QA), not something I can assert from source alone.
- Suggested: shorten the narrow marker while keeping the parenthesised form, e.g.
  `{percent}% ctx (ước)` (13 cells at a two-digit percentage, 14 at `100%` — under en's 14/15), or,
  if a tilde reads better in the band, `~{percent}% ctx` (8/9 cells; drops the sidecar's
  "keep the parentheses", so it needs a recorded guide call). Either way the wide form stays whole.
- Safety: informational only — no destructive/permission text; wrongly wrapping costs layout, not
  meaning.

### F2 — MINOR — `mobile.session.tray.context_short`, `mobile.session.tray.context_short_estimate` — "ctx"
- Current: `{percent}% ctx` · `{percent}% ctx (ước tính)`
- Problem: `ctx` is the only English token in the slice that no authority authorises (the rest are
  product names and one settled loanword) — and neither authority covers it. `docs/i18n.md` ("Technical tokens stay English and untranslated: commands, flags, paths,
  hostnames, model names, tool names and identifiers") and `AGENTS.md` ("An exemption is for what
  must NOT be translated. Commands, flags, paths, identifiers, developer diagnostics and tool or
  model names") do not cover an abbreviation of a common noun; the vi style guide's kept-English
  list (commit, push, token, API, CLI, TUI, JSON, YAML, HTTP, URL …) does not either, and `grep ctx`
  over `~/local-operator/i18n/style-guides/vi.md` and `glossary.md` returns nothing. Round 2
  accepted it **on the condition** that the exception be recorded in `vi.md` when landing; that
  condition is unmet, and it cannot be met inside this repo (the guide lives in core).
- This collides directly with the operator's acceptance test ("no English anywhere in the
  interface"), which is why I raise it rather than carry it silently.
- Suggested: fold into F1's fix (`(ước)` — identical width win, no Latin token), or keep `ctx` and
  open the core-guide record in the same release window. Not gating on its own.

### F3 — MINOR — `mobile.session.region.below_labels` (with `label_working`/`label_subagents`/`label_todos`/`label_strip`)
- Current: `{labels} bên dưới · cuộn ↓` (worst case `hoạt động · tác nhân con · tác vụ · trạng thái bên dưới · cuộn ↓`)
- Problem: measured 360.4 pt against 358 pt of content at 390 pt, so the cue breaks to a second line
  where en (272.2), fr (298.2) and es (320.8) stay on one. vi is the only shipped locale that wraps
  at the reference width. The inflators are the glossary-mandated band nouns (`tác nhân con` 12
  cells, `trạng thái` 10) plus `bên dưới`; at 320 pt every locale wraps, so the 320 pt case is
  accepted design, the 390 pt case is vi-specific. No clipping (the `Text` wraps); the cost is a
  line taken from the capped region.
- Suggested: `{labels} ở dưới · cuộn ↓` — measured 345.9 pt, one line at 390 pt, same meaning; or
  keep and let design/QA confirm the extra line is intended at the reference width.
- Note: the shipped `status_tray.hint` calls the same band `dòng làm việc` while the cue calls it
  `hoạt động`; en does exactly the same ("working line" / "activity"), so this is not a vi finding.

### F4 — NIT — `mobile.settings.diagnostics.stream_degraded`
- Current: `Không phản hồi` (capital `K`) in a lower-case monospace row whose siblings are `rảnh`,
  `đang kết nối`, `hoạt động`, `ngoại tuyến`; the sidecar asks for a lower-case word.
- The capital is a deliberate byte-identity with `relay.chrome.session.subtitle.not_answering` and
  `mobile.settings.status.not_answering`, mandated in round 2. I carried it forward (round 2 had it
  as n1) and do not gate: `không phản hồi` would be the tidy form.

## 5. Judged clean (no finding), with the reason

Register/tone: `bạn` only as possessive (`của bạn` ×2) per guide; no `Vui lòng`, no `!`, sentence
case, no Title Case, no space before punctuation, em-dash rule irrelevant (none used).
Terminology matches the shipped catalogue and glossary: `phiên` (session, 28×), `tác nhân con`
(subagent), `tác vụ` (task/job), `trạng thái`, `máy tính` (computer, 46×), `đường hầm` (tunnel),
`ngữ cảnh` (context), `phản hồi` (respond, `Không phản hồi` = the relay's own wording),
`Ngoại tuyến`, `rảnh` (= shipped relay idle `Rảnh`), `hoạt động` (live/active = `badge.active`).
Meaning checks that matter: `Chưa có kết nối` (no route chosen) vs `Không kết nối được` (the chosen
computer refused) are correctly distinct, both distinct from `Ngoại tuyến`; host-wait text
`Tuyến kết nối đã cấp không có nghĩa là máy tính đang chạy` keeps the provisioned route *and* the
definitive negator (no temporal hedge), so it still stops the reader assuming the machine is up;
`Quay lại {name}` reads with a real name and `Quay lại phiên` is a complete phrase for the unnamed
parent (`src/features/session/back-label.ts` picks them); `Đã kết nối với máy tính của bạn.` slots
the fallback noun phrase grammatically (vi has no case/article). RTL: not applicable to `vi`.

## 6. Out of slice, but material to the operator's acceptance test

`app/(app)/session/[id].tsx:1036` still renders a hardcoded English Chip label
`` `${subagents.running} of ${subagents.total} running` `` (e.g. "1 of 6 running") in the same status
band, in every locale. It is **pre-existing** (present at `fa2bc5e0`), not in the `check-strings`
baseline (the scanner's documented JSX-template blind spot) and untouched by this PR — so it neither
gates nor counts in the verdict above, but "no English anywhere in the interface" is **not** met for
`vi` while it ships. Worth its own keyed follow-up.

## 7. Ledger / evidence

No ledger or evidence write made: this lane is read-only and the manager owns the record. The fields
for its row: locale `vi` · namespace `mobile.{computers,session,settings}` (M2 expression literals) ·
`audit_date` 2026-11-11 · `key_count` 33 · auditor `i18n-auditor` / session `6934f10bf7bd` /
`deepseek/deepseek-flash` (session model header, `actual_model_source` = header, no fallback) /
`independent_from_translator_session` true · the source and target digests in §1 · status
`changes_requested` · `unresolved_blocker_major_count` 1 · finding ids F1-F4. Suggested note (≤280):
"vi M2 re-audit of shipped bytes 3af477ee: F1 MAJOR narrow est. slot 18-19 cells vs en 14-15 (D17
wrap returns); F2 ctx not in guide; F3 cue 360pt wraps; F4 nit. 0B/1M/2m/1n."
