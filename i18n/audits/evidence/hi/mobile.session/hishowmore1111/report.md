# Hindi (`hi`) audit — `mobile.session.user_message.show_more` / `show_less`

Audit ID `hi1111sm` · namespace `mobile.session` · file group `mobile.session` · 2026-11-11
Auditor: `i18n-auditor` (lopdev team), session `fdb967df951c`, model **deepseek/deepseek-flash**
(as reported by this session's harness state; no fallback switch occurred during the run — I cannot
verify the provider-side model beyond that report). Independent of the translator (session
`1c44531632d2`, `anthropic/claude-sonnet-5-5` per the manager's brief, not observed by me) and of the
#235 coder who wrote the shipped bytes. Read-only audit: no repo edits, no ledger write.

Revision audited: PR #237 head `8fdfb2e970299a2c0947bf42ac6224ebacd97113` (branch
`integrate/mobile-batch-1111`), keys absent on `origin/main` (`fa2bc5e0`), hi catalogue 653/653 keys
in parity with en at that head.

## Recommendation

**Ship pair A — the bytes already in #237** (`और दिखाएँ` / `कम दिखाएँ`). For `hi` the follow-on PR
needs **no replacement**: the translator candidate B would be a regression against the catalogue's
own show-more/show-less family.

- Pair A (`#237`-shipped): **passed** — 0 BLOCKER / 0 MAJOR / 0 MINOR / 0 NIT.
- Pair B (translator candidate): **changes-requested** — 0 BLOCKER / 1 MAJOR / 0 MINOR / 1 NIT.

## Why A beats B (precedent, not taste)

The hi catalogue already renders the *same* English key family with `दिखाएँ`, and reserves `देखें`
for "View/See" that opens something else:

| key | en | hi (at 8fdfb2e9) |
|---|---|---|
| `mobile.schedules.show_more.monitors` | Show more monitors | `{hidden, plural, … {# और मॉनिटर दिखाएँ}}` |
| `mobile.schedules.show_more.wakes` | Show more wakes | `{# और जागृतियाँ दिखाएँ}` |
| `mobile.schedules.show_less.monitors` | Show fewer monitors | `कम मॉनिटर दिखाएँ` |
| `mobile.schedules.show_less.wakes` | Show fewer wakes | `कम जागृतियाँ दिखाएँ` |
| `mobile.computers.show_details` | Show details | `विवरण दिखाएँ` |
| `mobile.home.suggestion.last_turn` | Show me the last turn | `पिछला टर्न दिखाएँ` |
| `mobile.signin.show_diagnostics` | Show sign-in details | `साइन-इन का विवरण दिखाएँ` |
| `mobile.notifications.filter_label` | Show | `दिखाएँ` |
| `mobile.session.subagents_hint` | Show the subagents | `उप-एजेंट दिखाएँ` |
| `mobile.home.queue.view` | View queued messages | `कतार के संदेश देखें` |
| `mobile.team_bridge.profile.open` | View profile for {name} | `{name} की प्रोफ़ाइल देखें` |

11/11 English messages containing "Show" render with `दिखाएँ` — including "Show fewer monitors/wakes" and both
keys under audit. `देखें` appears only in view/see senses: `कतार के संदेश देखें`, `{name} की प्रोफ़ाइल देखें`,
and two prose sentences telling the reader to check something in the Radient console. This control reveals
more of the same message in place — a "show", and literally the same key family as `mobile.schedules.show_*`.

## Findings

**B1 · MAJOR · `mobile.session.user_message.show_more` / `show_less`** — current (candidate):
`और देखें` / `कम देखें`. Code path: visible label and `accessibilityLabel` of the clamp toggle at
`src/features/session/components/user-message-clamp.tsx` (role `button`). Problem: `देखें` is this
catalogue's verb for *view/see* — it carries the "go and look at something else" sense
(`कतार के संदेश देखें`, `प्रोफ़ाइल देखें`) — while every show-family control, including the shipped
`mobile.schedules.show_more` string, uses `दिखाएँ`. Shipping B puts two verbs on one action family
and, inside this very file, overwrites `कम दिखाएँ` with `कम देखें` beside it. Suggested wording
(exact): `mobile.session.user_message.show_more` = `और दिखाएँ`;
`mobile.session.user_message.show_less` = `कम दिखाएँ` — i.e. keep A. Meaning is *not* wrong
(`और देखें` is attested Hindi "see more"), which is why this is MAJOR consistency, not BLOCKER.

**B2 · NIT · same keys** — the translator note rejects `ज़्यादा दिखाएँ` because it is "longer". At
this width that reason does not hold: measured 51.05 pt (show_more) / 51.47 pt (show_less) for A and
37.06 / 37.49 pt for B at the label's 12 pt, against ≤ 264 pt available at a 320 pt screen (288 pt
column, bubble `px-3`). Length was never the constraint; verb consistency was.

Nothing else found in either pair: no added/dropped keys, no placeholders or ICU in the source, no
markup/code/backticks, no Latin or ASCII digits in the values, pure Devanagari + space, NFC, no bidi
controls (`U+200E/200F/202A-E/2066-2069`), no ZWJ/ZWNJ, no final punctuation, polite `-एँ` imperative
per the hi style guide, and `दिखाएँ` spelled with candrabindu exactly as the other 13 instances in
the catalogue (0 anusvara variants). Pair A reads as a control (imperative + `accessibilityState
{expanded}`), and its `और`/`कम` antonym pair matches `relay.chrome.row.more` = `और`.

## Mechanical evidence (all executed here)

1. Repo generator, audited head tree extracted read-only from `8fdfb2e9` into scratch:
   `node scripts/i18n/generate.ts` → `Wrote src/i18n/catalogue.gen.ts (653 keys, 21 namespaces, …)`,
   exit 0; `--check` → `catalogue.gen.ts is current (653 keys, …)`, exit 0.
2. Same tree with pair B substituted for pair A in `hi/mobile.session.json` → generate exit 0,
   `--check` exit 0 (653 keys). Neither pair can break the parser/argument surface; the two keys have
   no placeholders and no ICU branches.
3. Control run on `origin/main`'s tree → `651 keys`, exit 0 — proof the run is sensitive to exactly
   these two added keys.
4. In-memory checker (key parity, placeholders, ICU/markup chars, Latin, ASCII digits,
   identical-to-English, NFC, bidi controls, zero-width chars, script range, whitespace, final
   punctuation, cell width): **pair A 0 findings, pair B 0 findings**.
5. Negative control, 11 in-memory mutations, **11/11 fired**: empty value, whitespace-only, Latin
   leftover, identical-to-English, `U+202B…U+202C`, injected `{count}`, missing key, extra key,
   non-NFC (`e`+`U+0301`), inserted ZWJ, ASCII digit. Real pairs stayed clean in the same run.
6. Width (`CTLineGetTypographicBounds`, `NSFont.systemFont(size, .medium)`; Figtree has no
   Devanagari, so this is the platform fallback face at the label token `text-meta` 12 pt/500):
   A 51.05 / 51.47 pt at 12 pt, 95.58 / 96.43 pt at 24 pt (200 % text scale); B 37.06 / 37.49 and
   69.84 / 70.69 pt; English "Show more" 64.48 / 119.48 pt. Available ≈ 264 pt at a 320 pt screen →
   A uses 19 % (36 % at 2×), less than the English source itself. No overflow risk either way.
   Cell counts: A 8 / 8 cells, B 5 / 5, budget ≈ 14.
7. Repo `scripts/i18n/check-strings.ts` not applicable: it gates user-facing literals in code and
   this delta adds catalogue values only; the shared working checkout is on `pr92`, which predates
   `scripts/i18n/`, so the generator runs above came from the extracted head tree.

No rendered frame: fit is measured advance widths plus the component's geometry (`w-full`, centred,
`minHeight: TOUCH_FLOOR`, `text-meta`), not a screenshot — the app was not run in this read-only lane.

## Hashes (json.dumps(sort_keys=True, ensure_ascii=False, separators=(",",":")).encode())

- English pair `26d065694437406a3aebff2dd163d08f6d1b3afa1ad51701630f2e4ab6ec9022`
- Pair A (#237-shipped) `3c6eabf9e2594b5394d748f22f8943329f743a38b7e3d92bf4208097802dbf6e`
- Pair B (candidate) `bd9832b746b29164d9acddfafffb73fbee2c7f13b9ed3d49f03013c62e8364f6`
- Files at `8fdfb2e9`: `en/mobile.session.json` `143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0`,
  `en/mobile.session.context.json` `ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102`,
  `hi/mobile.session.json` `7a6eb058ab1a10ee2acb04885f2ad6d204dcb4c313342707bc00f84e59e3f858`
- Candidate file `followon-show-more/hi.json` `4071bd636802575dd3ca4530f47f9fb569e4015affa4141c0cf79647695f84b4`

## Ledger

This repository has no `i18n/ledger.json` and no audit-ledger command (prior mobile audits record the
same). Proposed, **not written**: `locale hi · namespace mobile.session · status passed (pair A) ·
auditor i18n-auditor · model deepseek/deepseek-flash · source_hash 143508157b6d… · note "hi1111sm …
record.json"` — ≤ 280 chars once the record path exists.

Retention: this lane is read-only, so nothing is committed. Durable home for the bundle when the
implementer lands it: `i18n/audits/evidence/hi/mobile.session/hi1111sm/{record.json,report.md,audit.log}`.
