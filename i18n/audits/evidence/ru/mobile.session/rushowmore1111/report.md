# Audit — ru · `mobile.session.user_message.show_more` / `show_less`

Independent translation audit (auditor ≠ author). Read-only: no repo write, no
translation/MT service, no back-translation.

- Locale: `ru` · Namespace: `mobile.session`
- Audited revision: `8fdfb2e9` (PR #237 head; `origin/main` = `fa2bc5e0` does not
  yet contain the keys)
- Auditor: `i18n-auditor` (lopdev team), session `2a6ddfb9ed18`, model
  `deepseek/deepseek-flash` (as shown in this session's header; no provider
  fallback notice appeared). Translator of the candidate: session
  `b765f5790e10`, model not stated in the transcribed notes. The values shipped
  by #237 were authored by that PR's coder, not by a translator.
- Keys: 2 (role `button`; centred control under the reader's own clipped long
  message; also the screen-reader label; no final full stop).

## Verdict

- **Recommended pair: «Показать больше» / «Показать меньше»** →
  **clean-with-findings** (0 blocker, 0 major, 1 minor, 2 nit) → ledger `passed`
  (blockers/majors decide `passed`; the one minor is a recorded width note, not
  an overflow).
- The recommended pair is **byte-identical to the #237-shipped pair**
  (sorted-key JSON sha256 `d0949d22…e45f` for both), so **RU needs no replacement
  in the follow-on PR** — it needs the audit recorded, nothing else.
- Because the two pairs are the same bytes, there is one verdict, not two. (a)
  #237-shipped pair and (b) translator candidate = **clean-with-findings**,
  identical finding set.

## Answer to the primary question: 15 chars or the 10/8 fallback?

**Ship «Показать больше» / «Показать меньше».** Precedent decides it, and the
width objection does not survive measurement.

1. *The catalogue already says exactly this.* `mobile.schedules.show_less.monitors`
   = «Показать меньше мониторов», `.show_less.wakes` = «Показать меньше
   пробуждений» — `show_less` is already rendered «Показать меньше» in this
   locale. `show_more` there is «Показать ещё # …» (count form), which the
   count-free English "Show more" cannot use.
2. *The show-X verb is «Показать».* 18 occurrences («Показать» 17 + «показать» 1)
   across 12 of the 22 ru catalogues — 16 of them in 10 keys outside this pair:
   `Показать сведения`, `Показать субагентов`, `Показать сообщения в очереди`,
   `Показать сведения о входе`, `Показать меньше мониторов` — against **zero**
   occurrences of «Развернуть»/«Свернуть» anywhere in ru. (Machine-counted, see
   `audit.log` § "ru precedent".)
3. *«Развернуть» / «Свернуть» is not wrong Russian*, but shipping it would make
   this one control speak a verb the app never uses for showing, while the
   identical action under Schedules keeps «Показать меньше». Two verbs for one
   action across two screens is the defect, and it is visible in the `ru`
   interface.
4. *15 cells is a proxy, not an overflow.* The control is a full-width centred
   `Pressable` (`className="w-full items-center justify-center"`, `minHeight`
   44) whose label `Text` carries **no `numberOfLines`** — it wraps, it cannot
   truncate. Measured (Core Text, SF Pro, the 12px `text-meta` step):

   | metric | value |
   | --- | --- |
   | label at 100 % | 102.2 pt («больше») / 104.0 pt («меньше») |
   | available line at 320 pt | 220.8 pt (320 − 2×16 transcript `px-4`; ×85 % bubble `max-w-[85%]`; − 2×12 `px-3`) |
   | share of the line at 100 % | 46–47 % |
   | label at the in-app 200 % step | 188.8 / 191.8 pt (87 % — still one line) |
   | first wrap | above ≈ 2.1× combined scale (in-app 200 % × OS > 100 %, or the platform-clamp ceiling 3×) |
   | en for comparison | 63.0 / 56.6 pt, fits even at 3× |

   A fixed pill of these characters' width does not exist in the component, so
   the ~14-cell budget overstates the risk by about a factor of two.

## Form, register, toggle semantics

- **Reads as a control, not a label.** Both halves are bare infinitives with no
  noun object — the style guide's action-label form («Сохранить», «Продолжить»)
  — and the same string is the screen-reader label, where an infinitive is read
  as actionable. In outline view, «показать» without an object is a visual
  control, while a noun phrase such as «длинное сообщение» would read as a
  label. The pair differs only in the direction word (больше / меньше), so the
  state change is legible on the button itself.
- **Register.** Sentence case, no final full stop, no «Пожалуйста», no «!» —
  matches the `button` role note. No «вы»/«ты» exposure: bare infinitive has no
  addressee.
- **Meaning and polarity.** `show_more` reveals the whole message, `show_less`
  clips it back to eight lines — neither claims more content than exists, adds
  a promise or hints at deletion. Safe for its destructive-free role; the pair
  is not reversible-destructive, so no warning wording is needed.
- **Script/RTL.** Cyrillic only, no Latin, no digits, no bidi or invisible
  controls, NFC — nothing to mirror or isolate.

## Mechanical

- `node scripts/i18n/generate.ts --check` on an extracted tree of `8fdfb2e9`:
  `src/i18n/catalogue.gen.ts is current (653 keys, 21 namespaces, argument types
  from en, es, fr, hi, ru, ur, vi, zh-CN)`.
- Key sets identical (en vs ru, and no key added/dropped); valid JSON; no
  placeholders on either side, so no ICU/plural/CLDR obligation and no
  placeholder-parity risk; no markup, Rich tags, backticks, paths or flags; no
  Latin letters or ASCII digits; no bidi or invisible controls; NFC; no edge
  whitespace, no double space, no non-ASCII space; sentence case, no terminal
  punctuation. All 12 negative controls bit (empty, Latin leftover,
  identical-to-English, trailing space, RLM inserted, final full stop, NFD,
  dropped key, same text both states, interior capital, lowercase start,
  smuggled placeholder) plus the NFC rule itself — `audit.log`.

## Findings

| ID | Sev | Key | Current | Problem | Suggestion |
| --- | --- | --- | --- | --- | --- |
| RU-SM-1 | minor | both | 15 cells each | Over the ~14-cell character proxy; measured at 102.2/104.0 pt in a 220.8 pt line on a 320 pt screen (46–47 %), still one line at the in-app 200 % step. No truncation is possible (no `numberOfLines`). | Ship as-is; record the width note. If the lane treats 14 cells as a hard cap independent of geometry, the only compliant alternative is «Развернуть»/«Свернуть» — rejected above (breaks the «Показать» convention). |
| RU-SM-2 | nit | both | «Показать больше» | At the platform-clamp ceiling (3×) the ru pair wraps to two lines while `Show more`/`Show less` stay on one (285.8 vs 173.0 pt). Cosmetic: the Pressable grows and keeps the 44 pt floor. | None — visible only at extreme accessibility settings. |
| RU-SM-3 | nit | `show_more` | «Показать больше» | Mild calque: Russian truncation controls more often read «Показать полностью». Accepted — it is the consistent rendering, and «Показать полностью» would break parallelism with «Показать меньше». | Keep. |

Not counted, recorded as observations:

- **Pre-existing, out of scope:** the bundled Figtree faces are latin-only —
  `hb-shape --font-size=12 Figtree-Medium.ttf "Показать больше"` maps every
  Cyrillic glyph to `.notdef`, so all ru copy renders in the platform fallback
  (SF Pro / Roboto) rather than the brand face. App-wide, not caused by these
  two keys, and not gating this slice.
- **No ledger in this repository:** the mobile repo has no `i18n/ledger.json`
  and no audit-ledger command (consistent with prior mobile bundles); the row
  proposed in `record.json.ledger.ledger_row_proposed` is explicitly unwritten.

## Not claimed

- No rendered frame, simulator run or native build: this is a read-only copy
  audit. The widths above are font measurements, not screenshots.
- No native-speaker review beyond this auditor.

## Hashes

| input | sha256 |
| --- | --- |
| ru pair, sorted-key JSON (recommended = #237-shipped) | `d0949d22d5cdd791242addac1e99b69e50d76e3521fd47f6df00b22e4ecde45f` |
| en pair, sorted-key JSON | `b285de7371f1a73b6c5adc4d70d999acbc7a6a8eea4a4057f2775c618aa5beef` |
| `src/i18n/catalogues/en/mobile.session.json` @8fdfb2e9 | `143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0` |
| `src/i18n/catalogues/en/mobile.session.context.json` @8fdfb2e9 | `ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102` |
| `src/i18n/catalogues/ru/mobile.session.json` @8fdfb2e9 | `1acba82d5cb86dfe129ab8dd6bb32131c5c0a6e91edc89fae49c324cc3b2c076` |

The translator candidate (`followon-show-more/ru.json`) hashes to the same
`sorted-key` value as the shipped pair: byte-identical.

## Artifacts

Staged (not committed — this audit was read-only): proposed tracked path
`i18n/audits/evidence/ru/mobile.session/ru1111sm1/` holding `record.json`,
`report.md`, `audit.log` (real command output: checker + negative controls,
`generate.ts --check`, Core Text widths, pair identity), `receipt.json`,
`audit_showmore_ru.py.txt`, `measure.swift.txt`, `width-measure.log`.
Session staging copy: `/Users/damian/.local-operator/sessions/2a6ddfb9ed18/scratchpad/evidence-proposal/`.
The lane owner must commit it; nothing here is on `main`.
