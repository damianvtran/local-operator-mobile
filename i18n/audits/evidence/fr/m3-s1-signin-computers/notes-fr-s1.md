# fr — M3 S1 translation notes (mobile.signin + mobile.computers)

Translator: `i18n-translator` subagent, session `4270cae4ed9c`, model
`deepseek/deepseek-flash` (the session's actual model; no fallback used).
Date: 2026-11-12.
English-first worktree: `~/local-operator-mobile/.worktrees/i18n-m3-s1` @
`1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce` (base `origin/main` `9e193b57`).
Brief: manager-owned `translation-brief-s1.json`, sha256
`531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f` — verified,
matches the stated prefix `531e6edd8e5f9af5`.
Draft: `draft-fr-s1.json` (44 keys, brief key order), sha256
`07a54a5b9725f2d97f264e94b40eb2a5939e33f2a7d2e79187ffb41f5bf0c0bb`.

No machine-translation service, SDK or website was used; every value was
reasoned from the English source, the locale style guide, the glossary and the
shipped fr corpus.

## Register and voice

- **vous**, lowercase mid-sentence (style guide, recorded decision). The
  English terseness is reproduced by short clauses, not by dropping the
  pronoun.
- Imperatives, no "Veuillez…". Status lines are short sentences or verbless
  fragments where the English is one ("Nécessite un compte Radient.").
- Lexical continuity with the shipped fr corpus is deliberate: `connexion` for
  sign-in (as in the 18 existing `mobile.signin` values), `ordinateur`,
  `relais`, `tunnel`, `acheminement`, `app`, `téléphone`, `Réessayer`,
  `Actualiser` (the corpus's rendering of "refresh", reused from
  `mobile.settings.connection.refresh`).
- Typography per the fr guide: apostrophe U+2019, ellipsis `…`, em dash
  " — " spaced, **espace fine insécable U+202F** before `:` `?`. Never inside a
  placeholder, command or product name. (Quoted strings below may show a plain
  space where the draft carries U+202F; the draft is authoritative.)

## Glossary decisions (and where each came from)

| English | fr used | Basis |
| --- | --- | --- |
| computer | ordinateur | shipped fr corpus (`mobile.computers.*`) |
| tunnel | tunnel (masc.) | shipped fr corpus; glossary has no row — proposal below |
| relay | relais | glossary §2 ("relais") and corpus |
| sign-in / sign in | connexion / se connecter | shipped fr `mobile.signin.*`, `mobile.chrome.home.sign_in` |
| route (control-plane), routing | acheminement | shipped fr `mobile.account_routing.*`, `mobile.settings.diagnostics.route`, `mobile.computers.wait.host_answering` ("Un acheminement configuré…") |
| harness | harness (kept English, masc.) | shipped fr core corpus: `tui.import.*` ("le harness", "un autre harness"), `wire.settings.shell_environment_exclude.help` ("les processus du harness") — the fr guide's kept-English principle for settled dev vocabulary |
| Local Operator | unchanged | glossary §1 product name |
| Radient | unchanged | brand, brief note on every Radient key |
| URL | unchanged | fr guide kept-English technical list |
| app | app | shipped fr corpus ("l'app n'a pas pu…", "après le redémarrage de l'app") |
| device / phone | téléphone (this surface) | corpus: "sur ce téléphone" |
| remove (from a local list) | retirer | corpus uses `Retirer` for taking an item out of a list (`mobile.team_bridge.attachment.remove_image`) and `Supprimer` for actual deletion (`mobile.projects.delete_body`); this dialog is explicitly local-only, so `retirer` — and it keeps the destructive verb out of a non-destructive action |
| delete | supprimer | not used here (see above) |
| refresh | Actualiser | `mobile.settings.connection.refresh` |
| retry | Réessayer | corpus |
| answering (reachability badge) | répond | affirmative counterpart of the corpus's `Ne répond pas` (`mobile.settings.status.not_answering`, `relay.chrome.session.subtitle.not_answering`) |
| active / connecting (badges) | actif / connexion | `mobile.computers.badge.active`, `mobile.computers.badge.connecting` — the a11y rows must reuse the badge words verbatim, per the brief notes |

## Glossary proposals (terms the glossary lacks; not edited here)

1. **harness** — *keep English* (all locales). Evidence: fr core `tui.import.*`,
   `wire.settings.shell_environment_exclude.help`. fr treats it as masculine
   ("le harness").
2. **tunnel** — *per-locale*; fr keeps `tunnel`.
3. **computer** — *translate*; fr `ordinateur` (the glossary's `device` row is
   `appareil`, a different word for a different thing).
4. **route (control plane) / routing** — *per-locale*; fr `acheminement`
   (the shipped corpus renders the concept that way in
   `mobile.account_routing.title`, `mobile.settings.diagnostics.route` and
   `mobile.computers.wait.host_answering`; no fr prose uses `route` for it).
5. **provisioning** — *translate*; fr `provisionnement` (dev register:
   OVH/Google Cloud fr; Microsoft fr uses `approvisionnement`). Recorded choice
   for the badge.
6. **build (of this app)** — *per-locale*; fr `version` ("Cette version de
   l'app…"), as `mobile.account_routing.unavailable` already says "Mettez à
   jour Local Operator".
7. **recommended** — *translate*; fr `Recommandé`.

## Per-key rationale (non-obvious strings only)

- `mobile.computers.not_harness` — "n'exécute pas le harness Local Operator":
  `exécuter` matches the corpus's "commande exécutée"; "ne fait pas tourner"
  would read informal in a status line.
- `mobile.computers.wait.listing` — "En attente que Radient liste votre
  ordinateur…". Subjunctive `liste` after `attendre que`; same "En attente de…"
  family as the shipped `stage_browser`.
- `mobile.computers.wait.tunnel_status` — "Radient dispose du tunnel — {status}."
  `disposer de` is the natural French for "has/holds at its disposal" and keeps
  the sentence grammatical around an untranslated English status word; a literal
  "Radient a le tunnel" reads as though Radient had just obtained one.
- `mobile.computers.wait.use_computer` / `own_action` / `own_tunnel_instead` —
  three near-identical English labels stay three distinct French labels:
  «Utiliser cet ordinateur», «Utiliser mon propre tunnel», «Utiliser plutôt mon
  propre tunnel». "plutôt" carries the contrast the note asks for ("instead"),
  which a bare "à la place" would make heavy at button size.
- `mobile.computers.remove.title` / `remove.confirm` — `Retirer…` / `Retirer`
  (see glossary table): the action is local to the phone list, so the
  destructive `Supprimer` would overstate it.
- `mobile.computers.remove.body` — "Cela ne touche ni l'ordinateur, ni son
  tunnel, ni votre compte." Three `ni` clauses keep all three negations the
  brief requires, which a literal "Il ne touche pas à…, ni à…" would blur.
- `mobile.computers.paths.radient_body` — three clauses kept in order; `gère le
  tunnel` for "runs the tunnel for you", `URL privée et authentifiée` verbatim
  concept, and the honest cost (`Nécessite un compte Radient.`) is its own short
  sentence, not a subordinate clause.
- `mobile.computers.paths.own_body` — "Le parcours avancé : …" keeps the word
  *advanced* prominent as the brief asks; `un tunnel que vous exploitez` renders
  "a tunnel you run" (operate) rather than the ambiguous "lancez".
- `mobile.signin.title` — «Connexion». The noun is the French convention for an
  auth screen title and matches the corpus's stage vocabulary; "Se connecter"
  is used for the button (`start`) instead, so title and action do not collide.
- `mobile.signin.intro` — keeps the guarantee exactly: the browser finishes it,
  the app never sees the password. `l'app` (not `l'application`) matches the
  corpus register.
- `mobile.signin.panel.waiting_help` — «là-bas» avoided; "dans le navigateur"
  names the referent of "there" outright, which is what the note defines.
- `mobile.signin.panel.cancelled` — «La connexion a été annulée.» (full
  sentence) stays visibly distinct from the diagnostic stage word
  `mobile.signin.stage_cancelled` («Connexion annulée»), as the brief requires.
- `mobile.signin.panel.unavailable` — `Cette version de l'app` for "this build";
  keeps the technical detail line below it untouched.
- `mobile.signin.try_anyway` — «Réessayer quand même» keeps the note's
  "even though it probably cannot complete" without a whole clause.
- `mobile.signin.welcome.headline` / `body` — `s'exécute sur votre ordinateur`
  parallels "runs on your computer"; the privacy promise is exact: "Votre code
  ne la quitte jamais" (`la` = la machine). `en montre le résultat` resolves
  English "shows what it did" to an unambiguous object.
- `mobile.computers.status.route_ready` — «acheminement prêt» reuses the corpus
  term for the route; a shorter "route prête" would introduce a second word for
  the same concept (see width risks).
- `mobile.computers.reach.answering` — «répond» (see glossary table).
- `mobile.computers.billing_inactive` — "La facturation de ce tunnel est
  inactive : l'accès à distance sera refusé." `accès à distance` is the
  corpus's rendering of remote access (`mobile.computers.billing_help`).
- `mobile.computers.try_now` — «Essayer maintenant», deliberately not
  «Réessayer»: this is a first immediate re-run of discovery, and `retry` is a
  different key on the same screen.

## Judged identical to English (deliberate, not untranslated copy)

- `mobile.computers.row.a11y` — `{name}, {status}, {reach}`. Nothing but the
  three placeholders and the separators; there is no prose to translate, and
  French uses the same comma separation and order. No other key is identical to
  its English source (checked mechanically against the en catalogue: 1 of 44).

## Width risks (no `maxChars`/`maxCells` in the brief; measured against the call sites)

- `mobile.computers.status.route_ready` = «acheminement prêt» (17 characters)
  renders in a **mono badge with no `numberOfLines`**, in a `flex-row` with no
  wrap, beside `reach.answering` = «répond» (≈ 23 characters for the pair).
  English's worst pair is `provisioning` + `answering` (21). So fr is ~2
  characters wider in the tightest row; on a 320 pt phone at 200 % text scale
  the second badge can wrap inside its pill (badges wrap, they do not
  truncate). Accepted: the corpus term `acheminement` is the correct rendering
  and «route prête» would create a second name for the same concept. Flagged
  for the rendered-frame check.
- `mobile.computers.own_tunnel_instead` (34 vs 26), `mobile.signin.use_address`
  (40 vs 27), `mobile.signin.panel.unavailable` (69 vs 44),
  `mobile.computers.paths.own_title` (30 vs 21). The auth call sites pass no
  `labelLines`, so button labels wrap rather than truncate (Button default);
  the cost is a taller button, not a clipped one. `panel.unavailable` is a
  full-width status headline.
- The two `paths.*_body` help paragraphs run ~20 % longer than English; they are
  body-sm blocks in cards and wrap freely.

## Validation performed

`scripts/i18n/generate.ts --check` / `i18n:check` in the worktree validates the
catalogues **in the tree**; this draft is not landed there (the worktree is
read-only for a translator), so the gate runs when the manager's coder lands the
files. What I did run, read-only, is the repo's **own** ICU parser
(`src/i18n/messages.ts` `parseMessage` — the same one `generate.ts` and the
runtime use) over all 44 draft values, comparing parameter name+kind against
the English source:

```
keys=44 errors=0
judged-identical-to-en (1): mobile.computers.row.a11y
```

Also checked: every key present exactly once and in the brief's order, no key
added or renamed, `{status}`/`{name}`/`{reach}` byte-identical, ellipses and
final full stops preserved, no ASCII apostrophe, no manual bidi control
characters, no `:`/`?` preceded by a plain space (U+202F used). Script:
`validate-fr-draft.mjs` in this scratchpad.

Coverage receipt for the manager: en `mobile.computers` has 75 keys and fr 45,
en `mobile.signin` 32 and fr 18 — the missing 30 + 14 are exactly this brief, so
landing the draft makes fr key-complete for both namespaces (the
directory-comparison gate in `generate.ts` then has nothing left to fail).

## Input hashes (for the independent auditor's record)

| Input | sha256 |
| --- | --- |
| `en/mobile.computers.json` | `f0b7ee2800700254b8c2b90d1dac6811be79ec23ffdfd0f1460bba6accb40109` |
| `en/mobile.computers.context.json` | `93a3f18eacd3985a65cef115e50dee5fdad9731b7692fccf4089e473723e6e6a` |
| `en/mobile.signin.json` | `2fc23f0abea7d1be5a1679e4d73a08fa8787353a4aefe8764eed29cb88d20252` |
| `en/mobile.signin.context.json` | `1e9dc9d97bd3c5733d6631530996acb56e318c6ed24ed245450eabff32996f56` |
| `fr/mobile.computers.json` (pre-existing, consistency input) | `c3015755e033b3fca2236ffee8d967df3c25ccff96ee85aad0bd9457cd5b6135` |
| `fr/mobile.signin.json` (pre-existing, consistency input) | `c44cf80d43eacbc6ea3a8d0dc4bbb8991e28fdc3298037a134d7eb15d2dadfee` |
| core `i18n/style-guides/fr.md` @ origin/main | `5315e1ac10c2ce57aac631ba653d08de680ee70c9a022ed3a8345ce2f9902ee7` |
| core `i18n/glossary.md` @ origin/main | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |

I did not audit my own locale; an independent `i18n-auditor` pass follows.
