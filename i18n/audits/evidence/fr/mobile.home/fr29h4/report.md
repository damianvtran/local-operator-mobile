# Independent French audit, round 4 — mobile.home, delta of one key (fr29h4)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 1 MINOR (H4-01), 0 NIT. Unresolved blocker/major count = 0.**
`mobile.home.options.fixed` is passing at the bytes reviewed here; the MINOR is a polish, not a gate.

Round 4 is a **delta re-audit of one key** (`mobile.home.options.fixed`), the third wording this
sentence has carried. The other 26 keys of the namespace are **not** re-audited and are not
re-judged: `git diff daa46f6..HEAD` shows this file changed on exactly one line, and the same
one-substring revert reproduces the round-3 bytes by hash (`audit.log` §4–§5).

- **Auditor:** `i18n-auditor`, team child session `78c640379596`.
- **Actual model in force: `radient/auto`**, after a provider-quota descent observed in this
  transcript — `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` →
  `radient/auto`; every switch was reported as `provider failure: quota`, not chosen. The pinned
  Sonnet model did not run this audit. Recorded in `record.json`.
- **No human native-speaker review, no rendered frame, and no translation service is claimed or
  used anywhere in this bundle.**

## What the file actually says (the brief quoted a wording that is not in it)

The brief asked whether the value reads `… pour accéder à ses commandes en direct` or
`… pour accéder à ses commandes en conversation`. Neither is in the file. The bytes are:

Concretely (`src/i18n/catalogues/fr/mobile.home.json`, sha256 `124a5de3…`, 2017 bytes):

> `Les options initiales de cette conversation sont figées. Utilisez Détails de la conversation pour accéder aux commandes de la conversation en cours.`

148 UTF-16 characters (English 95), two sentences, no placeholder, a single `text` node.

It was applied by commit `49f79b3` ("fix(i18n): render project receipts from action codes, not
English verbs"), which also records why the previous wording was rejected:

- round 2 (`fr29h2`, H-01) rejected `commandes en cours` — settled French for *commands in
  progress*, a state rather than a place to act;
- round 3 (`fr29h3`) passed `ses commandes en direct`;
- a later review rejected `en direct` as the broadcast / live-stream idiom.

The applied text is therefore the third attempt, and it is neither of the two strings the brief
named. This report judges the bytes above, not the proposed wording.

## What was checked, and the executed result

Full command output is in `audit.log` (§1–§7). Summary of what each found:

1. **Repository gate.** `npm run -s i18n:check` → exit 0: `src/i18n/catalogue.gen.ts is current
   (120 keys, 7 namespaces, argument types from en, fr)`; `check-strings: 284 finding(s), all
   baselined; 0 new`. Valid JSON, no duplicate keys, 27 en / 27 context / 27 fr keys.
2. **App's own parser.** `parseMessage` → `params: []` on both locales, one `text` node, no braces,
   no backticks, no double space. Nothing interpolates, so nothing can break by interpolation.
3. **Production render.** `renderFor(key, {}, "fr")` — the function `t()` calls — returns the French
   sentence (not an English fallback) and equals the raw value byte-for-byte; `en` returns the
   English source.
4. **The cross-reference.** `mobile.session.conversation_details` is `Détails de la conversation` in
   fr and `Conversation details` in en; the fr label occurs **byte-for-byte, once**, inside the
   sentence, capital `D` and lowercase `conversation` intact. The context note on the label key says
   it "must stay identical wherever that screen is named, including the sentence in
   mobile.home.options.fixed" — satisfied.
5. **Typography.** Non-ASCII is `U+00E9` ×3 only. No bidi/control character, no `U+00A0`, no ASCII
   apostrophe, quote or `...`. No `: ; ! ?` in the string, so no `U+202F` site exists. Two sentences,
   each closed with a full stop.
6. **Fit.** No `maxCells`/`maxChars` in the sidecar for this key; it is `role: help` prose in a sheet
   that wraps. No button, chip or status budget applies. No pixel claim is made.
7. **Tests.** `npx vitest run src/i18n src/features/projects` → 6 files, 97 tests passed.

## Judgement

**Accuracy.** Every element of the English survives. "starting options" → `options initiales`;
"are fixed" → `sont figées`; "Use Conversation details" → `Utilisez Détails de la conversation`;
"for its live controls" → `pour accéder aux commandes de la conversation en cours`. Nothing added,
nothing dropped, no polarity or negation shift, and nothing unsafe — this is non-destructive help
text either way.

The rejected readings are genuinely gone: `en cours` attaches to **conversation**, not to
**commandes**, so the sentence no longer says "commands in progress"; and `en direct` (broadcast) is
absent. The reading is "the controls of the conversation that is running", which is what "live
controls" means on this screen: the folder/model fields are read-only once `selectionEditable` goes
false (`home.tsx:209` defines it; `:797` and `:808` disable the folder and model controls, `:831`
shows this note), and the controls that still act on the running conversation live on
the details screen.

**Idiom and register.** `vous` imperative `Utilisez`, sentence case, no `Veuillez`, no title case, no
em dash or guillemets needed — matches `style-guides/fr.md`. The one weakness is repetition, which
is H4-01 below.

**Terminology.** No glossary row governs *commande*, *contrôle*, *détail* or *live* (checked in
`i18n/glossary.md`). `commande` occurs nowhere else in the fr catalogues, so it collides with no
existing term and no slash-command sense. `Détails de la conversation` is the shipped label, not a
new coinage.

## Findings

### H4-01 — MINOR — `mobile.home.options.fixed` (idiom: the same referent named three times)

Current: `Les options initiales de cette conversation sont figées. Utilisez Détails de la conversation pour accéder aux commandes de la conversation en cours.`

The word *conversation* appears three times in two sentences — once as `cette conversation`, once
inside the destination label, and again in `de la conversation en cours`, where an anaphor would do.
The trailing five-word complement is heavier than the rest of the fr corpus, and the construct reads
more like a rendering of "of the conversation in progress" than like native copy. The meaning is
right; this is a fluency finding, and the sentence is comprehensible as shipped.

Suggested (144 characters, parses, keeps the destination label byte-exact, no placeholder):
`Les options initiales de cette conversation sont figées. Utilisez Détails de la conversation pour accéder aux commandes qui restent disponibles.`

This keeps the noun *commandes* and states the live/available contrast without naming the
conversation a third time. The second pass proposes a shorter alternative —
`… pour la piloter.` (109) — which drops the noun *controls*; recorded, not adopted, because the
English names controls specifically.

Severity rationale: not MAJOR. The sentence preserves the meaning, carries no ambiguity a reader
would keep, and its register and typography are correct; a native reader would polish it, not reject
it. It is recorded so the polish is not lost, not to hold the namespace.

## Second independent pass

Requested for this delta because the sentence has been contested twice. A `reviewer` subagent — job
`e4c88d8f7509`, launched on this session's model selection after the primary's quota failure, actual
model `radient/auto` (self-reported) — read the same style guide, glossary, sidecars and bytes
without being shown my analysis. It returned **PASS** for this key, with one optional NIT for the
same repetition H4-01 records, proposing `… pour la piloter.` (109).

**Where we agree:** meaning preserved, both rejected idioms absent, label byte-exact, register and
typography correct. **Where we differ:** it rates the repetition a NIT ("would not spend a round on
this"); I record it as a MINOR. The difference is severity, not substance, and both of us would ship
this sentence. The disagreement is stated rather than smoothed over.

## Recording boundary

This repository has **no `i18n/ledger.json` and no audit-ledger command** (`docs/i18n.md` records the
report in the pull request; `i18n/audits/evidence/` has no README contract file). The durable record
is this bundle. No keyed public-copy receipt is claimed: the wave's one credential-shaped key
(`mobile.computers.password_placeholder`) had its clean-core route refused, and this namespace has no
credential-shaped key at all.

**No native-speaker review and no rendered frame are claimed.** Fit statements rest on executed
character counts, never on pixels.
