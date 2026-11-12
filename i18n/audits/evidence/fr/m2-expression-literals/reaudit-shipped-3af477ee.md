# M2 re-audit on shipped bytes — fr — 33 keys (PR #236)

**Verdict: clean-with-findings — 0 BLOCKER · 0 MAJOR · 1 MINOR · 3 NIT**

- Auditor: role `i18n-auditor`, session `8323a7f995cd`, served model **deepseek/deepseek-flash**
  (session model header; no fallback pinned or used). Independent of the translator
  (`i18n-translator`, `openai/gpt-6.1-sol`) and of every earlier auditor of this slice.
  Method: reasoning only — no translation/MT service, no back-translation. Read-only lane:
  nothing edited, committed, pushed or posted.
- Shipped head audited: `3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a` (PR #236), worktree
  `~/local-operator-mobile/.worktrees/i18n-m2-scanner`, tree clean at read time.
- Keys: the 33 added vs `fa2bc5e0` in `src/i18n/catalogues/fr/mobile.{computers,session,settings}.json`
  (4 + 15 + 14); English source `src/i18n/catalogues/en/*`, sidecars `en/*.context.json`,
  bundle `i18n/audits/evidence/fr/m2-expression-literals/`.

## 1. Hashes (SHA-256, this session)

Sorted-key JSON of the 33 key/value pairs:

| Input | SHA-256 |
|---|---|
| fr shipped values (`target33`) | `9aecf8f17941b4a1a7dac4c363ba40d7ad82572b61a05f41b8ad1f9d9c18ae0f` |
| en source values (`source33`) | `008f9a49490adbde68808c0db487a471f87d3236b79ab9282205796964ad8b98` |
| en context sidecars for those keys | `c08984e3269537e6c35bde77aff0d3754dd46ecb974c8e9d108df7c315dce2d4` |

File-level SHA-256: fr `mobile.computers.json` `c3015755e033b3fca2236ffee8d967df3c25ccff96ee85aad0bd9457cd5b6135`,
fr `mobile.session.json` `62ea762bca7f9b47a2c5fa02bdc30e97dc9f2755c00b5c6a7d4a6588875f8aa7`,
fr `mobile.settings.json` `cc56f6e0cd9193ef03076bca1b88842cfd3005528319a012680ac93408c19826`;
en `mobile.computers.json` `713827837aab9d75611441155d50522ccce9d8b410d88c1b7bd27e528776aff3`,
en `mobile.session.json` `8df14a0d12ef0386a3115c55dcdf7976e7234b9e82a79279741985e11aa716d3`,
en `mobile.settings.json` `d7e1d85b68773871a578791ad57e0a08e421a220738e561b9e09ce22f9aee23d`.

## 2. Shipped bytes == the audited text (established, not assumed)

- The pairs hash of the tracked `m2-expression-literals/final.json`
  (`1db648167ce217cbacc3cc35a805ffece233627141180c2813dd2a525ab7c0bf`, matching the NOTE manifest) equals
  `target33` (`9aecf8f17941b4a1a7dac4c363ba40d7ad82572b61a05f41b8ad1f9d9c18ae0f`) — **byte-identical, zero diff over all 33 keys**, no key added or dropped.
- Last round that read values: `round2.md` (33 keys, served model `anthropic/claude-sonnet-5-5`) on candidate v3.
  30 of the 33 shipped values appear verbatim somewhere in the bundle and each equals the audited text. The three
  that are never quoted in full are still covered: `wait.answering` and `route_direct` are named as OK in
  `round1-B.md:16`, and `wait.host_answering` was adjudicated in `round2.md` (B-F4, declined/upheld, quoting
  "configuré … fonctionne"); all three are unchanged since v1 per the translator change notes. I re-judged all
  three on their merits here.
- **Where final differs from audited text: nowhere.** The one thing no tracked fr round read is the four
  *key names* (section 4), not the text — so no unaudited wording ships; what ships unaudited-as-names is
  covered here.

## 3. Mechanical (repo validator run, then verified independently)

- `node scripts/i18n/generate.ts --check` → exit **0**:
  `src/i18n/catalogue.gen.ts is current (684 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`
  (only the known `MODULE_TYPELESS_PACKAGE_JSON` warning). 651 en keys at `fa2bc5e0` + 33 = 684. ✓
- Key set/order (python3, this session): fr == en for all 684 keys (`en keys missing in fr: []`, `fr extra: []`);
  the 33 added keys sit in the same relative order as in English, per file. ✓
- Placeholders: name and multiplicity identical per key (`{percent}`, `{labels}`, `{host}`, `{baseUrl}`, `{name}`);
  no `%s`-style drift, no renamed arguments. ✓
- ICU plural/select: none in this group in either language; no CLDR-arm question arises (fr one/many/other n/a).
  The `#`/`plural` message that already existed in `mobile.computers.wait.relay_sessions` is untouched. ✓
- Glyphs and punctuation: `·` and `↑ ↓` kept in every key that has them in English; apostrophes U+2019 only
  (no ASCII `'`); U+202F before `%` in all four tray values, matching shipped fr (`text_size.*`) and the guide. ✓
- Empties / padding / NFC / JSON validity: none / none / all NFC / all parse. ✓
- English left in place: only `Local Operator` (product name) and the two cognates `session`, `agents` — the
  three the NOTE records as IDENTICAL_BY_DESIGN for fr. `ctx` is an English abbreviation (n2); `estim.` is the
  French form of `est.` and is correct. ✓

## 4. The four renamed region-label keys (the gap no fr round covered)

`git grep -n` at HEAD: the shipped names are `mobile.session.region.label_working|_subagents|_todos|_strip`
(underscore leaf) and they are what everything else uses —
call site `app/(app)/session/[id].tsx:1100-1103`, the test `src/i18n/__tests__/expression-literals.test.ts:109`
(`label_${k}`), the generated union/typed map `src/i18n/catalogue.gen.ts:398-401,1034-1037,1673-1676`,
the English catalogue and its sidecar `src/i18n/catalogues/en/mobile.session.context.json:290-303`.
The fr bundle never once spells them (0 occurrences of `label_working` in `fr/m2-expression-literals/*.md`;
`round2.md:23` writes the dotted `region.label.working`, which is the sidecar naming error the ru round 2
caught as a blocker). So: **values were read, names were not** — I verified the names myself, and the
value→English mapping is right in all four (`activity→activité`, `agents→agents`, `tasks→tâches`,
`status→statut`), with `catalogue.gen.ts` carrying the same fr strings. The rename is correct and complete.

Fit of these four in the call site: the cue is a free-wrapping `text-meta` line (`[id].tsx:1393-1405`), the
labels joined with ` · `; worst case (all four hidden) fr is 56 cells vs en 51 — same shape, no maxCells hint
in the sidecar, wraps as English does.

## 5. Judgement per key

| Key | en | fr (shipped) | Judgement |
|---|---|---|---|
| `mobile.computers.added.connected_to` | `Connected to {name}.` | `Connecté à {name}.` | OK — masc. « ordinateur »; full stop matches source. Reads with a real name and with « votre ordinateur ». |
| `mobile.computers.added.fallback_name` | `your computer` | `votre ordinateur` | OK — noun phrase, lower case, fits « Connecté à … ». |
| `mobile.computers.wait.answering` | `Waiting for your computer to answer.` | `En attente d’une réponse de votre ordinateur.` | OK — idiomatic, full stop kept. |
| `mobile.computers.wait.host_answering` | `Waiting for your computer at {host} to answer. A provisioned route is not the same as a machine that is up.` | `En attente d’une réponse de votre ordinateur à l’adresse {host}. Un acheminement configuré ne garantit pas que l’ordinateur fonctionne.` | NIT n3 — « Un acheminement configuré » collocation slightly off (one configures a route/tunnel, not an acheminement); meaning and negative polarity correct; « acheminement » is the shipped term (diagnostics.route). |
| `mobile.session.back_to` | `Back to {name}` | `Retour à {name}` | OK — « Retour à {name} » with a name (« Retour à Orion »); unnamed parents now route to back_to_session. |
| `mobile.session.back_to_session` | `Back to session` | `Retour à la session` | OK — natural full phrase, sentence case, 19 cells. |
| `mobile.session.fallback_name` | `session` | `session` | OK — cognate, deliberately identical; bare header noun per sidecar. |
| `mobile.session.region.below_labels` | `{labels} below · scroll ↓` | `{labels} plus bas · défiler ↓` | OK — {labels} first, list joined by « · », arrow kept; reads as « activité · agents · tâches plus bas · défiler ↓ ». |
| `mobile.session.region.end` | `end · scroll ↑` | `fin · défiler ↑` | OK — « fin · défiler ↑ », lower case, glyph kept. |
| `mobile.session.region.label_strip` | `status` | `statut` | OK — « statut », shipped term. |
| `mobile.session.region.label_subagents` | `agents` | `agents` | OK — cognate and the glossary fr rendering of *agent*; source word is « agents ». |
| `mobile.session.region.label_todos` | `tasks` | `tâches` | OK — matches shipped « Tâches ». |
| `mobile.session.region.label_working` | `activity` | `activité` | OK — matches shipped « ligne d’activité ». |
| `mobile.session.region.more_below` | `more below · scroll ↓` | `la suite plus bas · défiler ↓` | OK — idiomatic noun phrase, dot and arrow kept. |
| `mobile.session.tray.context` | `{percent}% context` | `{percent} % du contexte` | OK — U+202F before % per fr guide and shipped convention. |
| `mobile.session.tray.context_estimate` | `{percent}% context (est.)` | `{percent} % du contexte (estim.)` | OK — « (estim.) » is the fr abbreviation, parentheses kept. |
| `mobile.session.tray.context_short` | `{percent}% ctx` | `{percent} % ctx` | NIT n2 — « ctx » is an English abbreviation not on the fr kept-English list; sidecar authorises it and the <340 pt slot needs it; 8 cells vs 16. |
| `mobile.session.tray.context_short_estimate` | `{percent}% ctx (est.)` | `{percent} % ctx (estim.)` | NIT n2 (same decision) — 17 cells vs 25. |
| `mobile.session.video.title_fallback` | `Video` | `Vidéo` | OK — « Vidéo », agrees with shipped « Lire la vidéo ». |
| `mobile.settings.account.app_name` | `Local Operator` | `Local Operator` | OK — product name, must not translate. |
| `mobile.settings.account.not_signed_in` | `Not signed in with Radient` | `Non connecté à Radient` | OK — « connecté » is the settled fr word for signed in (shipped signed_in = « Connecté »). |
| `mobile.settings.account.route_direct` | `Connected directly to {baseUrl}` | `Connecté directement à {baseUrl}` | OK — natural; {baseUrl} untouched, line is numberOfLines=1 like its English twin. |
| `mobile.settings.account.route_radient` | `Through your Radient tunnel` | `Via votre tunnel Radient` | OK — « tunnel Radient » matches shipped diagnostics wording. |
| `mobile.settings.diagnostics.stream_connecting` | `connecting` | `connexion` | NIT n1 — noun among adjectives (« inactif / connexion / actif »), but it is the shipped badge word for the same state; keep. |
| `mobile.settings.diagnostics.stream_degraded` | `degraded` | `Ne répond pas` | MINOR m1 — capitalised three-word phrase in a lower-case one-word monospace column, and byte-identical to status.not_answering; see finding. |
| `mobile.settings.diagnostics.stream_idle` | `idle` | `inactif` | OK — lower case, pairs with « actif ». |
| `mobile.settings.diagnostics.stream_live` | `live` | `actif` | OK — « actif » (shipped computers.badge.active / projects.status.active). |
| `mobile.settings.diagnostics.stream_offline` | `offline` | `hors ligne` | OK — « hors ligne »; two words but fr has no one-word form. |
| `mobile.settings.status.connected` | `Connected` | `Connecté` | OK. |
| `mobile.settings.status.no_connection` | `No connection yet` | `Pas encore de connexion` | OK — keeps « yet », distinct from Hors ligne and Non connecté. |
| `mobile.settings.status.not_answering` | `Not answering` | `Ne répond pas` | OK — verbatim match with relay.chrome.session.subtitle.not_answering. |
| `mobile.settings.status.not_connected` | `Not connected` | `Non connecté` | OK — distinct from the account line « Non connecté à Radient » by surface and context. |
| `mobile.settings.status.offline` | `Offline` | `Hors ligne` | OK. |

## 6. Findings

### m1 — MINOR — `mobile.settings.diagnostics.stream_degraded`
Current: `Ne répond pas` (en: `degraded`). Sidecar: "Lower-case diagnostic word, shown in a monospace line; one
word, no final full stop." Every sibling in that same monospace column is one lower-case word
(`inactif`, `connexion`, `actif`, `hors ligne`), so the capitalised three-word phrase is the visible outlier, and
it is byte-identical to `mobile.settings.status.not_answering`, so the Diagnostics "Flux" row and the Status row
now say the same words for two different English states. Meaning itself is defensible (es/vi/ru/zh/ur made the
same call; only hi kept a distinct word), so this is register/format, not accuracy. Note this is fr round 2's
F1, shipped unapplied. Not gating.
Suggested: `ne répond pas` (minimal — restores the column's casing), or `dégradé` (one lower-case word, mirrors
the English and keeps the Diagnostics-vs-Status distinction the source draws; the manager owns the cross-locale
consistency call).

### n1 — NIT — `mobile.settings.diagnostics.stream_connecting` = `connexion`
A noun in a column of adjectives (en is the gerund `connecting`), but it is the shipped word for the same state
(`mobile.computers.badge.connecting`) and the same Settings screen uses that badge. Keep.

### n2 — NIT — `mobile.session.tray.context_short` / `_short_estimate` = `{percent} % ctx` / `… ctx (estim.)`
`ctx` is an English abbreviation and is not on the fr guide's kept-English list; the sidecar explicitly permits
"the language's own short form or the full word if none exists", French has no settled short form, and the narrow
slot needs it (8/17 cells vs 16/25 for the wide form). Keep, or record `ctx` as a fr width exception.

### n3 — NIT — `mobile.computers.wait.host_answering`, second sentence
Current: `Un acheminement configuré ne garantit pas que l’ordinateur fonctionne.` Meaning and negative polarity
are right and `acheminement` is the shipped term, but French configures a *route*/*tunnel*, not an
*acheminement*; the collocation reads slightly translated. Suggested (only if another round is already open):
`Une route configurée ne garantit pas que l’ordinateur soit en marche.` Otherwise keep — fr round 2 upheld it.

## 7. Negative control — the checker bites

Same checker, mutation in memory (nothing written). Flagged: `{name}→{nom}` → `PLACEHOLDER_MISMATCH`;
dropping `{host}` → `PLACEHOLDER_MISMATCH` (+ `PAD`); dropping `↓` → `GLYPH_LOST ↓`; `back_to` left in
English → `IDENTICAL_TO_EN`; trailing space → `PAD`. Note-driven layer (constraints parsed from each sidecar
note) on the shipped set flags exactly one key, `stream_degraded`, for `lower` and `one_word` (plus
`hors ligne` for `one_word`, which French cannot satisfy). Two mutants stay unflagged by design —
`% du context` (a typo) and a stray final stop — are semantic, and were caught by reading, not by the script.

## 8. Process notes for the manager (not copy findings)

1. This is the first tracked pass to read the four underscore key names; the fr bundle should carry it.
2. Bundle integrity: in the NOTE manifest, `fr/m2-expression-literals/translator-v2-changes.md` records
   `7f50e10b…` but the tracked file hashes `b5bd9230c256d5aa5c507c6d58cb70a8f4b0b4854398b735b8cb843d5f17e525`;
   every other fr row matches. Same class of mismatch exists for `ur/round1-B.md` and `zh-CN/translator-v4-changes.md`.
3. Pre-existing, outside the 33 keys, and therefore not gating: `src/ui/components/connection-pill.tsx:49-57`
   still carries English `DEFAULT_MESSAGE` (`"Reconnecting…"`, `"Offline. Messages will send when you're back."`,
   `"Not answering"`, `"No computer connected"`). Settings always passes a translated `message`; the
   conversations pane passes `message={staleNote(...) ?? undefined}`, so a state without a stale note would
   render English in fr. Worth a look against the "no English anywhere" acceptance — as its own change, not this PR.

## 9. Proposed record (manager to write — my lane is read-only)

`status: passed` (0 blocker / 0 major) · auditor `i18n-auditor` / session `8323a7f995cd` /
model `deepseek/deepseek-flash` (session header, no fallback) · source `source33=008f9a49490adbde…` ·
target `target33=9aecf8f17941b4a1…` · note (<=280):
"fr M2 33 keys re-audited on shipped bytes 3af477ee (PR 236); values == R2-audited final.json; 4 region-label names verified vs sidecar/gen.ts/call sites; 0B/0M/1m/3n; report: fr/m2-expression-literals/<this file>"
