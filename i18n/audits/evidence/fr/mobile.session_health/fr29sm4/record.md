# French final fit verdict — `fr29sm4`

| | |
| --- | --- |
| Audit id | `fr29sm4` |
| Locale · namespace | `fr` · `mobile.session_health` |
| Head judged | `c0fe99944cd72cd6e8f993e285e72ef0e9017675` (`feat/i18n-mobile-locales`, PR #132) |
| Value judged | `mobile.session_health.ended_placeholder` = `Envoyer rouvre…` |
| Sheet sentence read with it | `relay.health.ended_detail` (fr: `L’historique est conservé. Envoyez un message ou touchez « Reprendre » pour rouvrir la session dans votre dossier personnel.`) |
| Auditor | `i18n-auditor` (lopdev team), session `a731c4942a85`, **model `radient/auto`** — provider-quota fallback from `anthropic/claude-sonnet-5-5`, after `openai/gpt-6-astra` and `kimi/k3.1-pro` also failed on quota. Every number below was produced under `radient/auto`.
| Nature | Fifth pass on ONE value (fr29sm2 → fr29sm3 → design round 4 → c0fe999 → this). Not a fresh audit of the namespace: fr29sh1 and fr29sm2 cover the other ten values.

**Verdict: `passed`.** SH-01 stays resolved on the new bytes; no BLOCKER or MAJOR remains against the French value. The fit claim is now a measurement, not a cell count, and it holds at every scale the app offers.

Read-only: no catalogue, context sidecar or generated file was edited. This bundle is the only thing written, and it is uncommitted (the task forbade a commit).

## 1. Q4 first, because it decides what the other three answers are worth — the cell budget was the wrong instrument

The 36-cell budget came from core's `maxCells` for this key (`24d328a19a`), recorded in the context sidecar because the native context schema has no `maxCells` field. A cell count is a *character* count: it treats every Latin glyph as one unit, ignores the field's actual geometry, ignores the font, and cannot see a text-scale step. On this key it passed a string that does not render at any scale above 100 %:

- `Rouvre dans votre dossier personnel…` is exactly **36/36 cells** — my fr29sm3 round marked SH-01 resolved on precisely that fact.
- Design round 4 then measured instead of counting: **348 px** of content box at 390 pt, **278 px** at 320 pt, and the sentence needs **276.9 px at 100 %**, **354.4 px at the 135 % step**, **388.7 px at 150 %**, **590.9 px at 200 %** — at 200 % the frame paints `Rouvre dans votre d…`, and on the 320 pt phone it clears the default scale by **1.1 px**.
- I reproduced the magnitude independently with the field's own font (CoreText, `design/fonts/Figtree-Regular.ttf`, 16 px body): **269.70 / 364.09 / 404.54 / 539.39 px** at 100 / 135 / 150 / 200 %. Calibration: the same probe returns **73.28 px** for `Message…`, and `src/features/session/composer.ts:43` records `73.3 pt` for that same string in that same field — so font family and size are the field's own, not a guess.

**The cell budget is superseded by the measurement for this key, and my fr29sm3 "exactly 36/36" was not evidence of fit.** It is evidence of length. A budget inherited from a character count cannot certify a single-line field that ellipsizes.

Note on `135 %`: it is a real step, but not an in-app one. `src/ui/text-scale.ts:35` offers `100 / 150 / 200`; `135` is the capture matrix's iOS `xxxLarge` Dynamic Type factor (`tools/visual/matrix.ts:458`, `factor: 1.3529411765`), which native reaches through the OS setting. Design's D1 and the commit message `c0fe999` both call it "the app's 135 % step"; it is the harness/OS step. Documentation-only (see CO-2), and it does not change the verdict: the string fails at **150 %**, an in-app step.

## 2. The four candidates, with cells and measured widths

Rendered widths are design round 4's (PR #132, browser, field's computed `16px Figtree`, content box 348 px @ 390 pt and 278 px @ 320 pt). Auditor widths are CoreText advance sums at the same font and the same scale ladder (`16 / 21.6 / 24 / 32 px` for the `100 / 135 / 150 / 200 %` steps). The two paths agree to 1.2–2.7 % at 100 % and diverge up to ~9 % at 200 % (browser hinting and integer-px layout at large zoom; the static TTF is narrower); every ordering and every threshold below is the same under both, which is why the verdict does not rest on the absolute value.

| # | French value | cells | 100 % (design / auditor) | 150 % | 200 % (design / auditor) | fits 278 px @ 200 % | disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | `Envoyer rouvre dans votre dossier personnel…` | 44 | 326.90 | 490.34 | 653.79 | no — and already over 278 at 100 % | rejected (fr29sm3: 8 cells over budget; now also unfit at 100 % on 320 pt) |
| C2 | `Envoyer rouvre (dossier personnel)…` | 35 | 258.69 | 388.03 | 517.38 | no | rejected (fr29sm2: ownerless detached parenthetical; now also fails 135–150 %) |
| C3 | `Rouvre dans votre dossier personnel…` | 36 | 276.9 / 269.70 | 388.7 / 404.54 | 590.9 / 539.39 | no | rejected — the value this round supersedes; D1 measured it out |
| **C4** | **`Envoyer rouvre…`** | **15** | **120.7 / 117.70** | **176.54** | **256.8 / 235.39** | **yes — 21.2 px (design) / 42.6 px (auditor) spare** | **accepted — the current value** |

Threshold scales (auditor metric, per phone width): C4 clears up to **236 % on 320 pt** and 296 % on 390 pt; C3 clears to **103 % / 129 %**; C2 to **107 % / 135 %**; C1 to **85 % / 106 %**. The app's highest step is 200 %, so C4 is the only candidate with headroom at every step on both phones.

Design also measured four remedies of its own (`Envoyer rouvre…` 120.7/256.8; `Rouvre la session…` 138.7/295.9; `Envoyez pour rouvrir…` 160.6/342.9; `Rouvre dans votre dossier…` 200.8/429.4) and only the first fits at 200 % on the narrow phone. My probe agrees on the cells for the first three (15/18/21) and counts 26 where design recorded 27 for `Rouvre dans votre dossier…` — a one-cell counting difference that changes nothing; the ordering is identical under both.

## 3. Q1 — with the destination gone, does the reader still learn it before acting?

**Where the fact lives now.** In `relay.health.ended_detail`, the body of the ended-state health sheet: *« … pour rouvrir la session dans votre dossier personnel. »* Not paraphrased from a brief — read out of `src/i18n/catalogues/fr/relay.health.json` this session, and its English context note pins the meaning: *"the session comes back there, not in its original project folder."*

**How the reader reaches it, verified in the code rather than assumed:**

- `src/features/session/health.ts:234` — `healthDetailKey("ended") → "relay.health.ended_detail"`, so that sentence is the ended sheet's body, under the title `Terminée` and above the `Reprendre` button.
- `src/features/session/components/session-health.tsx:283–286` — the header control is a `Pressable` whose `onPress` opens that sheet, and whose accessibility hint is `mobile.session_health.control_hint` = *« Affiche ce que signifie cet état et ce qu’un envoi fait maintenant. »* So the sheet is **one tap** away, it advertises exactly the fact the placeholder dropped, and it is the same surface that holds the other remedy (`Reprendre`).
- `relay.health.ended_send_failed` routes a failed reopen back to that sheet, so the reader who never opens it still meets the fact the moment it matters.

**Is that enough? Yes, for this field — with one residual I will not paper over.** The destination is not a choice: the app offers no second destination, so a reader who never learns "home folder" makes no worse decision than one who does. Nothing the placeholder says is contradicted by the sheet; the sheet is more specific, not different. And the previous form did not actually deliver the fact either: at ≥135 % it truncated to `Rouvre dans votre d…`, losing the destination *and* keeping only a verb whose subject was implicit. The residual is that a reader who expects the session back in its **project** folder is not warned before sending — and no single-line placeholder that fits can warn them; that expectation is answered in the sheet, one tap away, and after a failure.

The trade this round accepts, stated plainly: the placeholder now carries the *action* (sending reopens) at every scale and the *destination* nowhere; before, it carried both at 100 % and neither at ≥135 %. The action is the decision-relevant half, because it is the half that tells the reader the send is not inert.

## 4. Q2 — is `Envoyer rouvre…` grammatical, natural, and meaning-preserving?

**Grammatical, and idiomatic rather than a calque.** French takes an infinitive as subject with a finite verb — *Fumer nuit…*, *Cliquer ici ouvre une fenêtre* — and this catalogue already does it, in the neighbouring sentence: `relay.health.quiet_detail` ships *« Réessayer ne l’enverra pas en double. »* Same construction, same register, same file. The style guide's rule is infinitive/imperative for actions (`style-guides/fr.md:14`) and *vous* address (`:9`); both hold. `Envoyer` is the field's own button verb, and the object of the send is supplied by the field the reader is standing in, so the ellipsis is motivated rather than lazy. No tu/vous break, no literal-translation tell.

**Meaning: preserves the effect, drops the where — under-promise, never over-promise.** *Send to reopen in your home folder…* = *[you] send, and that reopens it, in your home folder*. `Envoyer rouvre…` states the sender and the effect and omits the location. It does not claim the reopen always succeeds; the failure case is a separate string (`relay.health.ended_send_failed`), and the ellipsis marks a fragment rather than a promise. It does not claim a destination it no longer names, which is the failure mode that would matter here.

It also **closes design's D2** (MINOR: the French named the outcome where the English named the action) as a side effect — `Envoyer` restores the actor. Design round 4 predicted this itself: *"D1's remedy closes it for free: `Envoyer rouvre…` restores the action English carries."* My judgement concurs on the merits, not on the citation.

One alternative considered and rejected: `Envoyer la rouvre…` (18 cells, 133.33 px, 266.66 px at 200 % under my metric — fits by 11.3 px). It is smoother French, but it spends three-quarters of C4's margin, and under design's rendered metric (×2.18) it would measure ~291 px in a 278 px box at 200 % — i.e. it converts a comfortable fit into a coin-flip between two measurement paths. Not requested; the bare form's omitted object is exactly what the field supplies.

## 5. Q3 — ship it over `Envoyer rouvre (dossier personnel)…`?

**Yes.** The parenthetical buys the destination back only as far as ~135 % (1.2 px over the 348 px box at the 135 % step in my measurement, over at 150 % under both), so it re-creates the very defect D1 measured, while re-introducing the ownerless, detached parenthetical that fr29sm2 rejected as not grammatically naming the destination — whereas the 15-cell form fits every app step on both phone widths with 21–43 px to spare, and puts a non-selectable fact one tap away instead of into a line that ellipsizes.

## 6. Second independent pass (disclosed, and its limit)

A separate agent and session (`scout`, job `01a4bd530a81`) read the same four files and the style guide cold, instructed to contradict if warranted, and answered: grammatical, idiomatic, not a calque (citing *Fumer nuit…* / *Cliquer ici ouvre une fenêtre*); meaning preserved apart from the destination, no over-promise; would not change it. Its model was also `radient/auto` — the same provider fallback, so this is independence of **pass**, not of **model**; I record it as such and do not claim two-model corroboration. It did not see my draft answers.

## 7. Findings and observations at this head

**Findings against the audited French value: none.** `unresolved_blocker_major_count = 0`; `finding_ids = []`.

**CO-1 (carried, upstream, does not block `fr`)** — the *English* source of this same key still carries a sentence the field cannot hold: 263.44 px (auditor) / 266.7 px (design) at 100 % is fine, but 526.88 px / 569.6 px at 200 % in a 348 px box clips in `en` exactly as C3 did. French now sidesteps it by moving the destination to the sheet; English does not. This is a shared-key copy-length issue to carry upstream (design round 4 flagged the same), not a French defect, and it is why the fix should not be filed as "French was too long".

**CO-2 (documentation, no copy impact)** — `c0fe999`'s message and design's D1 both say "the app's 135 % step". The app offers `100 / 150 / 200` (`src/ui/text-scale.ts:35`); 135 is the capture matrix's iOS `xxxLarge` factor (`tools/visual/matrix.ts:458`). Worth correcting wherever the release notes restate it, since the load-bearing threshold is 150 %.

**NITs: none raised.** The two alternatives worth naming (the parenthetical, and `Envoyer la rouvre…`) are recorded above as candidates with their measurements, not as findings against shipped copy.

## 8. Provenance, route, and what was not done

- **Read route:** ordinary workspace file reads; the design measurements were read out of PR #132's comment thread with `gh pr view 132 --json comments` (the round-4 comment is the source, not the manager's summary of it). The earlier rounds' records (`fr29sm3/record.json`, `fr29rh1/audit.log`) were read from this repo.
- **No translation service, MT API, SDK or back-translation** was used, at any point, by me or by the second pass.
- **No translation/audit tooling was added to the tree**; the measurement probes lived in session scratchpad (`fr29sm4-measure.swift`, `fr29sm4-mech.py`) and their source is inlined in `audit.log`, so the numbers are reproducible from this bundle alone.
- **Ledger: no row was written, and none could be.** The mobile repo has no audit-ledger CLI (no `ledger` script in `package.json`; `scripts/i18n/` holds only `generate`, `check-strings`, `key-shape`, `ratchet`, `scan-strings`), core's `i18n/ledger.json` has 333 entries and **no** `health`-namespace row at all, and the RFC §6 schema is core's, in a repo and a checkout this task marked read-only. Stating "recorded in the ledger" would be false, so instead: a ledger-ready row is provided in `record.json` under `ledger_row_candidate`, with its `note` sized for the 280-character limit, and this bundle is the record of record.
- **Not exercised:** no device or browser re-render of the new value. Design round 4 supplied the rendered measurement of C4 over C3 (`120.7 / 256.8` px) and the clipping frame for C3; I verified the metric basis independently and did not repeat their capture. If the manager wants a rendered frame of `Envoyer rouvre…` at 200 % on 320 pt for the PR thread, that is design's harness, not a new measurement.

## Bundle

| file | role |
| --- | --- |
| `record.json` | machine-readable record: identity, hashes, candidates, verdict, ledger row |
| `record.md` | this judgement |
| `audit.log` | actual execution log — every command run, with its captured output and exit code |
