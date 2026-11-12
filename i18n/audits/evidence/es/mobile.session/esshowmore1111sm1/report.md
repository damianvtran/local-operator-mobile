# Independent i18n audit — es — `mobile.session.user_message.show_more` / `show_less`

Auditor: `i18n-auditor` (lopdev team), session `d1d6f85b4577`, model **deepseek/deepseek-flash**
(actual, from this session's harness header; no fallback recorded).
Independent of the translator (`translator`, anthropic/claude-sonnet-5-5, session `d5aaf8ba6ba5`):
different agent, session and context. I did not translate, edit or back-translate these values, and used
no MT service.

Source of truth: English at integration PR #237 head **8fdfb2e9** (`git show`), target bytes: the
translator's scratch `followon-show-more/es.json` (not applied to any catalogue; `origin/main` fa2bc5e0
does not contain either key).

## Verdict

**clean-with-findings** — { blocker: 0, major: 0, minor: 1, nit: 0 } → ledger status `passed`.

| key | candidate | cells | en |
|---|---|---|---|
| `mobile.session.user_message.show_more` | `Ver más` | 7 | Show more |
| `mobile.session.user_message.show_less` | `Ver menos` | 9 | Show less |

Recommendation: **ship both values unchanged.**

## 1. Mechanical (executed; `audit.log`)

The repo validator (`npm run -s i18n:check`) cannot see these keys — they exist in no catalogue yet, and
writing them into one is outside this read-only audit — so I ran a checker implementing the same
invariants `scripts/i18n/generate.ts` enforces (key parity, non-empty, message parse / placeholder
parity) plus the locale checks it does *not* do.

PASS on all: valid JSON; key set == en slice (2/2, none added/dropped); both values non-empty strings;
no `{…}` in either side, so no placeholder/ICU arms to preserve (no plural/select involved; `es`
categories irrelevant here); no `<…>` markup, backticks, code, flags or identifiers introduced; NFC
(`Ver más` = `…U+006D U+00E1 U+0073`, one precomposed á, no combining sequence); no control/bidi
character (no U+202A–U+202E, U+2066–U+2069, no BOM); no edge whitespace, no double space, no trailing
full stop; sentence case. Key shape legal for this repo: after `mobile.session.`, `user_message.show_more`
is namespace.group.name (one group, lower_snake_case).

Negative control (proof the checker bites, in-memory mutations only): empty value, Latin/English leftover
(`Show more`), identical-to-English, introduced placeholder, trailing full stop, injected U+202B, NFD
decomposed accent, 39-cell overflow, leading space — **9/9 rejected**, 0 survivors.

## 2. Accuracy

- `Ver más` = "see more": under a message clipped to eight lines under a fade, it promises the rest of
  *this* message, which is what the control does. No reader can read it as "more messages" here — it sits
  inside the bubble, centred, under the clipped text.
- `Ver menos` = the reverse: re-clip to eight lines. Mirrored polarity, same verb, same object; no
  negation or direction error. Correct English-pair mapping (more↔más, less↔menos; not "fewer").
- Safe wording: non-destructive toggle; neither label promises deletion, sending or permanence.
  Screen-reader label and `accessibilityState.expanded` agree with the verb pair.

## 3. Idiom and register

Infinitive action label, which is the es guide's binding convention ("Guardar", "Reanudar", "Abrir
{agent}", "Cargar mensajes anteriores" in the shipped catalogue); sentence case, no final full stop, no
`!`. Neutral Spanish, no region-marked word; no `tú`/`usted` exposure because the label has no addressee.

Native read: `Ver más` / `Ver menos` is the settled Spanish product idiom for revealing more of a text
body (Apple es uses exactly this pair for expanded descriptions; Google es prefers `Mostrar más`). It
reads as a control, not a label, precisely because it is a bare infinitive with no object.

## 4. Terminology — one MINOR

**M1 (MINOR, does not gate).** The app's own Spanish mapping renders English "Show X" as `Mostrar X` in
button copy, so this pair introduces a second verb for the same English verb:
`mobile.computers.show_details` ("Show details", role=button) → `Mostrar detalles`;
`mobile.schedules.show_more/show_less.*` ("Show N more …" / "Show fewer …") → `Mostrar …`;
same file: `mobile.session.subagents_hint` ("Show the subagents") → `Mostrar los subagentes`.
"View X" is what the catalogue renders as `Ver` (`mobile.home.queue.view` → `Ver los mensajes en cola`).
Problem: `Show more` → `Ver más` is a verb-family mismatch against that mapping.
Why it is not MAJOR: "show" is not a glossary term (`i18n/glossary.md` has no row for it), the es guide
records only the infinitive rule, which is met, and both renderings are idiomatic shipped Spanish UI.
Object matters: the `Mostrar` precedents reveal a details panel or hidden count-bearing rows, while this
control reveals the rest of the reader's own prose, where `Ver más` is the conventional string.
If the manager wants one verb per English verb, the compliant alternative is `Mostrar más` /
`Mostrar menos` (13 cells each, also fits — see §5). My recommendation is to **keep `Ver más` /
`Ver menos`**; the translator's stated reason for rejecting `Mostrar` (length) is not the binding one —
the control is full-width — the binding one is idiom for a text body.

Glossary/product names: none present in either value, nothing left English, no kept-English token
dropped or invented.

## 5. Fit (no overflow at the tightest supported column)

Derived from the component at 8fdfb2e9, not assumed: `user-message-clamp.tsx` renders the control as a
`Pressable` with `className="w-full items-center justify-center"` inside the bubble, label
`text-meta` = 12 px / 1.4 / weight 500 (`design/tokens/tailwind-preset.js`). Row is
`items-end px-4 py-1`, bubble `max-w-[85%] px-3 py-1.5`, so at a 320 pt column the label has
320 − 32 = 288 → 85 % = 244.8 → − 24 (px-3) ≈ **220.8 pt** to lay out in, centred.

`Ver más` 7 cells / `Ver menos` 9 cells. Under a deliberately wide 0.75 em-per-character bound:
9 × 0.75 × 12 ≈ **81 pt at 100 %**, ≈ 162 pt at 200 % text scale — under 220.8 pt with ≥ 58 pt headroom.
The brief's 14-cell pill budget (≈ 126 pt) is also cleared by both. No `maxCells` hint exists in the
sidecar and the real control is full-width, so the pill figure is not binding — both readings pass.
Widths are an arithmetic bound from the real layout classes, **not** a rendered frame; no clipping claim
beyond it. The 7→9 cell difference cannot cause a layout jump: the pressable is `w-full`, only the
centred text re-centres by two cells.

## 6. RTL

Not applicable: `es` is LTR, and neither value contains Latin/CJK mixed-direction content, digits, paths
or arrows.

## 7. Second independent pass

Not requested and not required by the brief's high-visibility list (onboarding, errors, settings): this
is one transcript toggle. Single pass by this auditor; disclosure stands rather than claiming a second
read.

## Provenance

- English pair canonical JSON (`json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=False)`):
  `{"mobile.session.user_message.show_less":"Show less","mobile.session.user_message.show_more":"Show more"}`
  → **sha256 26d065694437406a3aebff2dd163d08f6d1b3afa1ad51701630f2e4ab6ec9022**
- Shipped-candidate pair, same serialization:
  `{"mobile.session.user_message.show_less":"Ver menos","mobile.session.user_message.show_more":"Ver más"}`
  → **sha256 b458a2d65b2f3fd31fbd3213866abaf7cf221b13d2427c90a04a5d3311988e37**
- Input hashes (file bytes): en catalogue @8fdfb2e9
  `143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0`; en context @8fdfb2e9
  `ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102`; candidate es.json
  `45ce46ee87297c71cf83031d1ffc277f0848ef8b341ea328525ae3fc6eb95eee`.
- Repo write not performed (read-only mandate). Evidence bundle to be committed by the owner at
  `i18n/audits/evidence/es/mobile.session/es-sm1/`: `record.json`, `report.md`, `audit.log`
  (+ `tools/check.py`). Note `i18n/audits/evidence/README.md` is absent from `origin/main`, so the
  contract is carried by existing sibling bundles, not by that file.
- Applying commit note (repo formatting, not a copy finding): catalogue files are tab-indented; two keys
  go into `src/i18n/catalogues/es/mobile.session.json` plus `…/en/…` and the context sidecars, then
  `node scripts/i18n/generate.ts` to regenerate `catalogue.gen.ts`.
