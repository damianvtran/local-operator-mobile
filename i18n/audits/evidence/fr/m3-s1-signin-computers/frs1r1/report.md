# Independent i18n audit — fr / `mobile.computers` + `mobile.signin` (M3 slice S1)

- Auditor: `i18n-auditor`, session `7d94e65185a6`, instance `d8edea3668da`
- Model: **`deepseek/deepseek-flash`** (the session's actual model; no fallback used)
- Translator: session `4270cae4ed9c` (`i18n-translator`, same model family) — **different instance, independent pass**
- Date: 2026-11-12
- Head: `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce` (base `origin/main` `9e193b57`), worktree
  `~/local-operator-mobile/.worktrees/i18n-m3-s1` — read-only here; nothing written into it
  (`git status --porcelain` empty after the audit)
- Draft audited: `draft-fr-s1.json`, sha256 `07a54a5b9725f2d97f264e94b40eb2a5939e33f2a7d2e79187ffb41f5bf0c0bb` (matches the task)
- Brief: `translation-brief-s1.json`, sha256 `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f`
- Keys read: **44 / 44**

## Verdict: `changes_requested` — 1 MAJOR, 2 MINOR, 2 NIT, 0 BLOCKER

No meaning, polarity, placeholder or safety defect. One syntactic calque (A-01) is the only
MAJOR; the two MINORs are wording precision, not correctness. With A-01 and A-02 applied the
group is shippable in my judgement.

## Findings

| ID | Sev | Key | Current | Problem | Suggested |
| --- | --- | --- | --- | --- | --- |
| A-01 | **MAJOR** | `mobile.computers.wait.listing` | « En attente que Radient liste votre ordinateur… » | « en attente que » + subjunctive is a calque. Standard French has the conjunctive locution « **en attendant que** » (+ subj.); « en attente de » takes a noun only — which the same draft gets right two keys later (« En attente de votre navigateur. »). This is the first shimmering line of the add-a-computer panel, so a native reader meets the defect immediately. | « **En attendant que Radient liste votre ordinateur…** » |
| A-02 | MINOR | `mobile.signin.panel.waiting_help` | « Terminez la connexion dans le navigateur, puis revenez à cette app. » | « terminer une connexion » also reads as *ending/closing* it, in the exact panel whose job is to say the sign-in is still pending. The shipped corpus names this step « Finalisation de la connexion dans le navigateur » (`mobile.signin.stage_exchanging`), so there is a settled verb to reuse. | « **Finalisez la connexion dans le navigateur, puis revenez à cette app.** » |
| A-03 | MINOR | `mobile.computers.remove.body` | « Il est retiré de la liste de ce téléphone. Cela ne touche ni l’ordinateur, ni son tunnel, ni votre compte. » | The opening present passive states the resulting *state* where the dialog must state the *action* it is confirming; and « ne touche ni… » is looser than the explicit non-modification reassurance a confirm on a destructive-sounding action carries. All three negations are preserved and must stay preserved. | « **Il sera retiré de la liste de ce téléphone. Cela ne modifie ni l’ordinateur, ni son tunnel, ni votre compte.** » |
| A-04 | NIT | `mobile.computers.status.provisioning` | « provisionnement » | Jargon noun with no precedent in the shipped fr corpus, on a mono badge in a row whose sibling is already the most jargon a reader should meet (« acheminement prêt »). « mise en place » is plainer and two glyphs shorter. Acceptable as-is (it is what French cloud vendors say), which is why it is a NIT. | « mise en place » |
| A-05 | NIT | `mobile.computers.paths.own_body` | « …puis vous collez son adresse ici. » | « son » can attach to « votre ordinateur » (also masculine, and the nearest antecedent in reading order) as easily as to « un tunnel ». English carries the same ambiguity (« its address »), so this is clarity only, not a mistranslation. | « …puis vous collez **l’adresse de ce tunnel** ici. » |

NIT budget used: 2 of 5.

## Per-key verdicts where not clean

Only the five keys above. The other **39 keys are clean** on all six audit axes. Notable
deliberate checks that came back clean (recorded so the manager sees they were actually run,
not assumed):

- `mobile.computers.not_harness` — « le harness Local Operator »: the article attaches to
  *harness*, not to the product name, so the guide's "no article before Local Operator" rule is
  not breached; and `harness` kept English is the shipped core fr precedent
  (`tui.import.metadata_only_explain` "Le harness a peut-être supprimé la transcription.",
  `wire.settings.shell_environment_exclude.help` "les processus du harness"). Kept.
- `mobile.signin.title` « Connexion » — the English sidecar says "verb phrase", but French screen
  titles are nominal, and every shipped `mobile.signin`/`mobile.settings.section.connection`
  value already uses « Connexion ». Nominalisation upheld.
- `mobile.computers.paths.radient_body` « Nécessite un compte Radient. » — the verbless
  third-person fragment is established French system copy (« Nécessite iOS 17.0 ou ultérieur »),
  not a calque. Upheld.
- `mobile.computers.paths.own_body` « Le parcours avancé : » — « parcours » is a *new* term in
  the mobile fr corpus (which says « option » for settings choices), but a setup flow is a
  « parcours » in settled French UX vocabulary and it does not contradict « option »: different
  objects. Upheld, no finding.
- `mobile.computers.reach.answering` « répond » — verb form, matching the shipped affirmative/
  negative pair (`mobile.settings.status.not_answering` « Ne répond pas »). Upheld.
- `mobile.computers.remove.*` « Retirer » vs « Supprimer » — correct: the corpus uses `Retirer`
  for taking an item out of a local list and `Supprimer` for deleting; this dialog is explicitly
  local-only. Upheld.
- `mobile.computers.status.*` agreement — all masculine (`acheminement`, `tunnel`, `statut`),
  and `row.a11y_active` « , actif » reuses `badge.active` « actif » verbatim as the sidecar
  demands. Upheld.

## Mechanical results (all from the repo's own parser)

| Check | Result |
| --- | --- |
| Keys missing / extra / reordered vs brief | 0 / 0 / order identical |
| Parse with `src/i18n/messages.ts` `parseMessage` (the parser `generate.ts` and the runtime use) | 44/44 parse, 0 errors |
| Placeholder **names** and **kinds** vs English | 44/44 identical (`{status}` text, `{name}/{status}/{reach}` text ×3) |
| ICU plural/select in this group | none, so no CLDR category obligation arises (`one`/`many`/`other` + never `few` would apply if one were added) |
| ICU apostrophe-quoting forms (`''`, `'{`) | none — none would parse anyway |
| Backticks / code spans / commands / flags / identifiers | none present; `Local Operator`, `Radient`, `URL`, `{status}` byte-identical to source |
| Valid non-empty strings | 44/44 |
| Typography | U+2019 apostrophes only, `…` (never `...`), spaced em dash, **U+202F before `?` and before every `:`** per the fr guide — 0 deviations |
| Ellipsis / final-full-stop parity with English | 44/44 |
| Bidi / zero-width / CJK punctuation | none |
| English residue | none; the only shared tokens are `Local Operator`, `Radient`, `URL`, `harness`, `tunnel`, `agent`, `code`, `machine`, `sessions` — all legitimate (product name, brand, kept-English token, or the same French word) |

The canonical gate `node scripts/i18n/generate.ts --check` is **red on this branch before
landing** — `es/mobile.computers.json` and every non-en locale still lack the 30 new keys
(`EXIT=1`, output in `audit.log`). That is the pre-landing state of a one-locale draft, **not** a
verdict on the fr draft; it cannot be used as a clean run for this group and I do not claim it as
one. When all seven locales land, `--check` is the gate that proves the mechanical column above
at repository scale.

## Judge calls the brief asked for

- **The translator's "judged identical" list (1 key: `mobile.computers.row.a11y` =
  `{name}, {status}, {reach}`)** — **upheld**. It is three placeholders and two commas; French
  separates with the same comma and puts no space before it, so the byte-identical value is the
  correct French string. `row.a11y_active`/`_connecting` are correctly *not* identical: they
  append the badge words (« actif », « connexion »), which must be translated.
- **Style-guide ruling** — the zh-CN typography question (no-Latin-space + `……` vs the shipped
  catalogue's spacing) is not an fr question and I make no ruling on it. For fr, no ruling was
  requested and none is needed: the draft follows the binding fr guide on every point I could
  test (U+202F, U+2019, `…`, spaced em dash), and it *departs* from the older shipped fr corpus
  in exactly the direction the guide mandates.
- **Second independent pass** — `mobile.signin` carries the first-run welcome and the whole
  sign-in surface (onboarding, high-visibility). This is **one** independent pass; a second one
  is the manager's call and I am not claiming it. If a second pass is scheduled, A-01/A-02/A-03
  are the rows to re-read.

## Fit (measured, not eyeballed)

Mono badge pair in the computer row (`flex-row`, no `numberOfLines`, no `flex-wrap`):
JetBrains Mono 11 px + 0.06 em tracking ≈ 7.26 px/glyph at 100 % text scale, badge chrome
`px-2` + 1 px border = 18 px, `gap-2` = 8 px.

- English worst pair `provisioning` + `answering` = **196.5 px**; French worst pair
  `acheminement prêt` + `répond` = **211.0 px** (+14.5 px, +7 %).
- Inner width on a 320 pt phone at `px-4` = 288 px: both fit at 100 %; **both** wrap at 200 %.
  So the French badge row introduces **no new overflow class** — it wraps at large text ~10 %
  earlier than English, in a row that already wraps. No MAJOR, no width exception needed.
- Button/headline growth (+25 % to +53 % glyphs: `use_address` 39/27, `own_tunnel_instead` 33/25,
  `paths.own_title` 30/22, `panel.unavailable` 66/43): every one of these call sites is a
  full-width `Button` or a wrapping `Text` with no `labelLines`/`numberOfLines`, so the cost is a
  taller block, never a clipped label. The title+badge row on the Radient card is `flex-wrap`
  (its own U-06 fix), so « Se connecter avec Radient » + « Recommandé » wraps rather than clips.
- Badge height note for whoever renders it: a wrapped mono badge takes a second 16 pt line box
  (`leading-4` below 2.3× scale), so a wrapped pill is ~32 pt tall against components.md §6's
  20–22 pt. True in both locales; worth a frame at 200 % on 320 pt.

## Provenance / files

Scratchpad (this session, `7d94e65185a6`):

- `scratchpad/au-fr/receipt.json` — the machine-readable record
- `scratchpad/au-fr/report.md` — this file
- `scratchpad/au-fr/audit.log` — every command run with its actual output
- `scratchpad/au-fr/validate-fr.mjs`, `measure-fit.mjs` — the two scripts, plus `audit-mechanical.log`, `fit.log`

No ledger append was performed: the mobile repo carries no `i18n/ledger.json` / audit-ledger
CLI (its i18n lives at `src/i18n/`), and the core ledger covers core namespaces. The tracked
evidence bundle for this row is the coder's to land — canonical root per the retention contract,
`i18n/audits/evidence/fr/mobile.computers+mobile.signin/first-d8edea3668da/`, with
`record.json` (= `receipt.json`), `audit.log` and `report.md`; the ledger/record `note` should
point at that path and stay ≤ 280 chars.

Input hashes read (sha256, full values in `receipt.json`): en `mobile.computers.json`
`f0b7ee28…`, `mobile.computers.context.json` `93a3f18e…`, `mobile.signin.json` `2fc23f0a…`,
`mobile.signin.context.json` `1e9dc9d9…`, shipped fr `mobile.computers.json` `c3015755…`,
`mobile.signin.json` `c44cf80d…`, core `fr.md` @origin/main `5315e1ac…`, core `glossary.md`
`0eb34437…`.
