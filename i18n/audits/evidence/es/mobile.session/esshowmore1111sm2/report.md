# Independent i18n audit (v2) — es — `mobile.session.user_message.show_more` / `show_less`

Auditor: `i18n-auditor` (lopdev), session `d1d6f85b4577`, model **deepseek/deepseek-flash**
(actual, this session's harness header; no fallback observed). Independent of the translator
(`translator`, anthropic/claude-sonnet-5-5, session `d5aaf8ba6ba5`) and of the #235 coder whose values
are audited here. No MT service, no back-translation, no repo write.

**Supersedes the single-pair pass `es-sm1`** (retained unchanged in my scratch, not committed): that pass
was told the two keys were English-only in #237. **The manager's correction is confirmed:**
`git show 8fdfb2e9:src/i18n/catalogues/es/mobile.session.json | grep user_message` → lines 20–21

```
"mobile.session.user_message.show_more": "Mostrar más",
"mobile.session.user_message.show_less": "Mostrar menos",
```

absent from `origin/main` fa2bc5e0, introduced by merge `efdf8883` (#235 → integrate/mobile-batch-1111).

## Pairs audited on the same checks

| | pair A — **shipped in #237** | pair B — translator candidate |
|---|---|---|
| show_more | `Mostrar más` (11 cells) | `Ver más` (7 cells) |
| show_less | `Mostrar menos` (13 cells) | `Ver menos` (9 cells) |
| canonical-json sha256 | `fdcc81fd3e63063234e0eb7a20265ecb937dfc1651314b53a7d4766104b85e4a` | `b458a2d65b2f3fd31fbd3213866abaf7cf221b13d2427c90a04a5d3311988e37` |

English pair canonical-json sha256 `26d065694437406a3aebff2dd163d08f6d1b3afa1ad51701630f2e4ab6ec9022`.

## Recommendation

**Ship pair A — `Mostrar más` / `Mostrar menos` — and make NO change to the #237 values.** They are
correct, idiomatic, infinitive action labels; they match the catalogue's own English→Spanish mapping; they
are the bytes already in the shipping PR, so approving them costs no churn and no overwrite of shipped
strings.

Verdicts: **A = clean** (0 blocker / 0 major / 0 minor / 0 nit) → ledger `passed`.
**B, if it ships anyway = clean-with-findings** (0 / 0 / 1 minor / 0 nit) → also `passed`, since nothing
in B is wrong, unsafe or oversized; the minor is a consistency call, and Apple es uses exactly this pair.

## 1. Mechanical — both pairs PASS, executed (`audit-showmore-es-both.log`)

The repo validator cannot see these keys in any *unapplied* state, and the shipped bytes are inside PR
#237 rather than `main`, so `npm run -s i18n:check` is not the gate here; I ran a checker implementing the
same invariants `generate.ts` enforces plus the checks it does not do. For **A and B** alike: valid JSON
(the shipped es file parses, 65 keys); key parity 2/2, none added/dropped; non-empty; no `{…}` on either
side, so no placeholder/ICU arms to preserve (no plural/select involved, so `es` CLDR categories are not
engaged); no `<…>` markup, backtick, code, flag or identifier; NFC (`más` = `U+006D U+00E1 U+0073`, one
precomposed á); no control/bidi character (no U+202A–202E / U+2066–2069); no edge whitespace, no double
space, no trailing full stop; sentence case; not equal to English; no English leftover token.

Key shape legal for this repo: after `mobile.session.`, `user_message.show_more` = namespace.group.name
(one group, lower_snake_case).

Negative control — 9 mutations × 2 pairs = **18/18 caught, 0 survivors**: empty value, `Show more`,
identical-to-English, introduced `{count}`, trailing full stop, injected U+202B, NFD accent, overflow,
leading space.

## 2. Accuracy (both pairs)

`más`/`menos` map "more"/"less" (not "fewer"), the two labels are mirrored on one verb, and the pair
promises exactly what the control does: reveal the rest of *this* message, then re-clip it to eight lines.
No omission, addition or polarity error; no destructive or permission implication in a reversible toggle;
the label and `accessibilityState={{expanded}}` agree.

## 3. Idiom and register

Both are bare infinitives, which the es guide makes binding for action labels, in sentence case with no
final stop — they read as controls, not labels, and carry no addressee (so `tú`/`usted` never surfaces).
Both are neutral-Spanish, unmarked for region. A (`Mostrar`, Google-Material style) is slightly more
mechanical than B (`Ver`, Apple-es style) for revealing prose; neither is a calque or a literal rendering.

## 4. Terminology — the discriminating evidence (precedent beats taste)

The catalogue renders English **"Show X" as `Mostrar X`** in every button-sized precedent:

- `mobile.computers.show_details` — "Show details", role=button → `Mostrar detalles`
- `mobile.signin.show_diagnostics` — "Show details of the sign-in" → `Mostrar detalles del inicio de sesión`
- `mobile.schedules.show_more/show_less.*` — "Show N more monitors" / "Show fewer monitors" → `Mostrar …` (the direct analogue, same English verb pair)
- `mobile.session.subagents_hint` — "Show the subagents" (same file, role=help) → `Mostrar los subagentes`

and English **"View X" as `Ver X`**: `mobile.home.queue.view` — "View queued messages", role=button →
`Ver los mensajes en cola`. So A sits inside the established mapping and B introduces a second Spanish verb
for "show" — the one MINOR against B. "show" itself is not a glossary term (`i18n/glossary.md` has no row)
and the es guide has no rule that B breaks, which is why B is a minor and not a major. No glossary term,
product name or kept-English token is involved in either pair; nothing is left English in either.

## 5. Fit — measured, not bounded (`font-metrics-es.log`)

Real advance widths from the app's own `design/fonts/Figtree-Medium.ttf` @8fdfb2e9 (sha256 `358a4de7…c19`,
pure-Python sfnt reader, unitsPerEm 1000) at the `text-meta` token (12 px / 1.4 / 500) and at 200 % text
scale, against the real control geometry: the pressable is `w-full items-center` inside the bubble
(`max-w-[85%] px-3 py-1.5`, row `items-end px-4 py-1`), so a 320 pt column leaves **220.8 pt** of text
width.

| string | cells | 12 px | 24 px (200 %) | share of 220.8 pt |
|---|---|---|---|---|
| `Mostrar más` (A) | 11 | 66.89 | 133.78 | 61 % |
| `Mostrar menos` (A) | 13 | 80.99 | 161.98 | 73 % |
| `Ver más` (B) | 7 | 44.15 | 88.30 | 40 % |
| `Ver menos` (B) | 9 | 58.25 | 116.50 | 53 % |

Both clear the brief's 14-cell pill budget (A's `Mostrar menos` at 13 of 14 is the tightest row, 1 cell to
spare) and both fit the 320 pt / 200 % layout with ≥ 26 % headroom, single line, no truncation. B has more
headroom, which is a margin, not a defect in A. Widths are real font metrics, not a rendered frame; no
pixel-level regression claim.

## 6. RTL

Not applicable: `es` is LTR and neither pair contains digits, paths or mixed-direction runs.

## 7. Second independent pass

Not required for this group (not onboarding/errors/settings). Single pass, disclosed.

## Provenance

- Input file-byte hashes: en catalogue @8fdfb2e9 `143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0`;
  en context @8fdfb2e9 `ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102`;
  es catalogue @8fdfb2e9 `8fd2e641ce1bc7c005dd8639eafe16f96882138395adb7b1ada28758e450bc7e`;
  translator candidate `45ce46ee87297c71cf83031d1ffc277f0848ef8b341ea328525ae3fc6eb95eee`.
- Canonical pair hashes: `json.dumps(ensure_ascii=False, sort_keys=True, separators=(',',':'))` — A
  `fdcc81fd…b85e4a`, B `b458a2d6…988e37`, en `26d06569…c9022`.
- Evidence bundle for the owner to commit at `i18n/audits/evidence/es/mobile.session/es-sm2/`
  (`record.json`, `report.md`, `audit.log`, `tools/`); repo write not performed under this audit's
  read-only mandate. `i18n/audits/evidence/README.md` does not exist on `origin/main`.
- If any value does change, catalogue files are tab-indented and `node scripts/i18n/generate.ts` must
  regenerate `catalogue.gen.ts`.
