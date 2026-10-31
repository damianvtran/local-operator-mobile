# Independent French audit, round 3 — mobile.home, delta of one key (fr29h3)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. `mobile.home` is passing at these bytes.**

Round 3 is a **delta re-audit of one key**, `mobile.home.options.fixed`, re-checking the fix that round 2 (bundle `fr29h2`, MAJOR H-01) requested and that the translator applied verbatim. The other 26 keys of the namespace were **not** re-audited and are not re-judged here; their round-2 dispositions stand at the round-2 bytes, which this round proves unchanged except for this one key.

- **Auditor:** `i18n-auditor`, session `4191880b0141`.
- **Actual model in force: `radient/auto`**, after a provider-quota descent observed in this transcript — `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`. Every switch was a quota/429 fallback, not a choice. The chain is recorded in `record.json`.
- **Translator:** `i18n-translator`, session `c66311717837` (the session id is from the requesting manager's brief; its model `kimi/k3.1-pro` is carried from round 2's record, not observed by this auditor).
- **No human native-speaker review and no rendered frame are claimed anywhere in this bundle.**

## What changed

Round 2's H-01 rejected `…pour accéder à ses commandes en cours.` because `commandes en cours` is settled French for *commands/orders in progress* — a state, not a place to act — and suggested `…commandes en direct.` The manager's brief states the suggestion was applied verbatim; the bytes below are what I actually read and judged.

The current bytes carry that suggestion:

> `Les options initiales de cette conversation sont figées. Utilisez Détails de la conversation pour accéder à ses commandes en direct.` (132 UTF-16 characters)

**Exactly one key differs from the round-2 bytes, proved by hash, not by inspection.** Round 2 recorded `src/i18n/catalogues/fr/mobile.home.json` at sha256 `6cb1b100a3881b7be3e4fa26d10bb5861c6d10a76a56ab3f457c098567b2b00d`. Replacing the single substring `commandes en direct` → `commandes en cours` in today's file reproduces that hash **byte-for-byte**:

```
reverted hash: 6cb1b100a3881b7be3e4fa26d10bb5861c6d10a76a56ab3f457c098567b2b00d
round-2 hash:  6cb1b100a3881b7be3e4fa26d10bb5861c6d10a76a56ab3f457c098567b2b00d   MATCH
byte size now / after revert: 2002 / 2001     occurrences of the new substring in the file: 1
```

A sha256 match over the whole file after reverting one substring (`en direct` → `en cours`, one byte shorter) is a proof that no other byte in the file changed — no reflowed whitespace, no second edit, no other key touched. `git diff -U0` independently shows the same single changed line in `src/i18n/catalogues/fr/mobile.home.json` and the matching single line in the generated `src/i18n/catalogue.gen.ts`; nothing else in `src/i18n/` is modified. The English source and its context sidecar hash identically to round 2 (`4ebba126…` / `db18b25d…`), so the source did not move under the fix.

## What was checked, and the executed result

Full command output is in `audit.log` (sections 1–11); this section states what each found.

1. **The app's own parser.** `parseMessage` on the current value → **PARSE: OK**, `params: {}`, a single `text` node. No placeholders, no interpolation, no plural or select, so there is no delimiter or plural form that could be broken. English parses to the same empty param set.
2. **The real render path.** `renderFor(key, {}, locale)` from `src/i18n/runtime.ts` — the function `t()` calls, over the generated `src/i18n/catalogue.gen.ts` — returns the French string for `fr`, `fr-CA` and `FR`, and the English source for `en`, `es`, `null`, `de`. Only `fr` has a directory under `src/i18n/catalogues`, so that is the expected result, and it shows the key resolves to French rather than falling back. `renderFor` imports `./catalogues` without a file extension, so the run needed a resolver hook; the hook is the same pattern round 2's bundle used (`resolver.mjs`, copied from `i18n/audits/evidence/fr/mobile.computers/fr29c2/resolver.mjs.txt` and recorded here as an artifact), and it only maps extensionless relative specifiers to their `.ts` file.
3. **The validator the repository's CI runs.** `npm run -s i18n:catalogue:check` → exit 0, `src/i18n/catalogue.gen.ts is current (120 keys, 7 namespaces, argument types from en, fr)`. Key parity holds (27 en / 27 context / 27 fr) and the generated projection agrees with the authoring source.
4. **The repository's own i18n tests on these bytes.** `npx vitest run src/i18n/__tests__` → **5 files, 74 tests passed**.
5. **The referenced destination label.** The English context note for `mobile.home.options.fixed` says `"Conversation details"` names another screen and must keep matching that screen's title; the note on `mobile.session.conversation_details` itself goes further — "It must stay identical wherever that screen is named, including the sentence in mobile.home.options.fixed, so a reader recognises the same destination." French `mobile.session.conversation_details` is `Détails de la conversation`, and that exact string occurs in the sentence, unmodified, with capital `D` and lowercase `conversation` — the cross-reference resolves byte-exactly to the label rendered at `src/features/new-session/startup-transcript.tsx:52`. The label half of round 1's H-04 stays fixed.
6. **Both sentences survive.** English is two sentences ("…are fixed." / "Use … for its live controls."); French is two, split on `. `, each closed with a full stop.

**Character and typography inventory** (executed codepoint scan): non-ASCII is only `U+00E9` (é) and `U+00E0` (à); **no bidi control** (`U+061C`, `U+200E/F`, `U+202A–E`, `U+2066–9`); no `U+00A0`; no ASCII apostrophe, double quote or `...`; no `U+202F` — and none is required, because the string contains **no** `:`, `;`, `!` or `?`, the four sites the style guide puts an espace fine insécable before. No em dash, no guillemets, no backticked code, no flag, path or identifier in either language, so there is no byte-identical token to preserve.

## Judgement against the English source, its note and the fr style guide

**Accuracy.** `commandes` is standard French for *controls* (the controls of a device or interface), and `en direct` is the settled French for *live* — real-time, operating now. "Les commandes en direct" therefore reads as *the controls that are live*, which is what the English means: the starting options are frozen, but the details screen still carries controls that act on the running conversation. The round-2 defect is gone: `en cours` could only be read as a status, `en direct` cannot.

The choice also holds up against the catalogue's own vocabulary. `mobile.projects.sessions.live` renders `{base} · {live} en cours` with `{live}` a positive integer — `en cours` is that catalogue's word for *running*, exactly the reading round 2 rejected here. Using `en direct` keeps the two ideas distinct instead of collapsing "live controls" into "running commands". No glossary row governs *contrôle*, *commande*, *détail* or *live* (checked in `i18n/glossary.md`), so there is no term to violate; `commande` appears nowhere else in the fr catalogues, so no collision with an existing "commands" sense.

The second sentence adds `accéder à` ("to reach") where English says "for". That is a natural French construal of "use X for its controls", adds no claim, and drops nothing.

**Register and typography.** The `fr.md` style guide requires *vous*, lowercase mid-sentence, imperatives for actions, sentence case, no "Veuillez…". `Utilisez` is a vous-imperative, the only proper noun is the screen label, the sentence opens with a capital and continues in sentence case, and there is no bureaucratic formula. Apostrophes: none present, so the U+2019 rule has nothing to bite on. Bidi control characters: none — the string carries no layout state, per `docs/i18n.md` and the guide.

**Fit.** 132 UTF-16 characters, up from 131. The sidecar sets no `maxCells` for this key, and it is a `role: help` paragraph that wraps; no button, chip or status-line budget applies. Round 2 made the same limited statement, and it still holds: no pixel-level or truncation claim is made, because no frame was rendered.

## Verdict

**PASS.** No BLOCKER and no MAJOR remains on `mobile.home.options.fixed` at sha256 `2f25ddab1029a5cbd3121b9fc5e42f86fe8360c48b67865c106fb22fb86e8a39`, and that hash differs from the round-2 target only by this one verified fix. `mobile.home` is **passing at these bytes**.

## Observations, deliberately not raised as findings

Recorded so the manager sees them, not counted against the audit:

- **Unquoted label reference.** French typography would normally set a UI label off in guillemets — `Utilisez « Détails de la conversation » pour…`. The current form leaves it bare and relies on the capital `D` to signal a label. It reads unambiguously, no fr catalogue in this app uses guillemets at all, and round 2 accepted this same form when it verified the label half of H-04. Raising it now would reopen a settled disposition and cost a translation round for a preference, so it is disclosed here rather than filed.
- **`en direct` is a first use.** This is the only occurrence of the word in the fr corpus. If the programme later standardises *live* on `en temps réel`, this key follows that decision; it is not a defect today.
- **Not re-audited.** I read only this key and enough of the file to hash it. The other 26 keys were not judged; round 2's per-key table stands, and the hash proof above shows they are byte-identical to what round 2 judged.

## Independence, stated plainly

**The translator did not audit this.** Different agent, different session, different context.

**This round is not independent of the proposal it verifies, and that is the honest weakness here.** Round 2 ran in session `16ebcda69228`; this round runs in `4191880b0141`. Same agent identity, different session — and the wording applied is the wording I proposed. A fix accepter checking a fix author's own text is a self-confirmation hazard. I mitigated it by re-deriving the judgement from the English, the context note, the style guide and the catalogue's own `en cours` usage rather than comparing against my round-2 sentence, and by testing the competing reading (`en direct` as broadcast-live) explicitly; the checks that matter here — parse, render, label resolution, hash delta — are mechanical and would have failed regardless of who proposed the wording. If the manager wants the *independent* confirmation that the high-visibility rule asks for, the right instrument is a second pass by another auditor on these bytes; it was not requested for this delta round and is not claimed.

Model diversity from the translator is partial: my run passed through `kimi/k3.1-pro`, the translator's reported model, on the fallback chain. Disclosed, not closed.

## Recording boundary

This repository has no `i18n/ledger.json` and no audit-ledger command — as round 2 recorded, `docs/i18n.md` keeps the report in the pull request. The durable record is this bundle; the ledger row that would be written is carried in `record.json.ledger.ledger_row_proposed`, explicitly marked as not written. No keyed public-copy receipt is claimed for this locale.

**The worktree is shared and moved while I audited; the audited bytes did not.** My first read showed `?? i18n/` and two modified source files. By the time `audit.log` captured `git status`, the earlier evidence bundles had been staged by another session and `.gitignore` had gained a `!i18n/audits/evidence/**/audit.log` negation (a fix so execution logs are not swallowed by the blanket `*.log` rule — it does not ignore this bundle; `git check-ignore` returns nothing for it). Neither change touches the catalogue: `src/i18n/catalogues/fr/mobile.home.json` still hashes `2f25ddab…` at the end of this run, identical to the hash I audited, and the English source and context sidecar are unchanged. I staged, committed and edited nothing.
