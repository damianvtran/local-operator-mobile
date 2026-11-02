# Delta audit — mobile.home (es), round 2

- **Audit ID:** es29a3r2 · **Date:** 2026-10-29 · **Locale:** `es` · **Namespace:** `mobile.home`
- **Auditor:** `i18n-auditor` (lopdev team); session `3ef3aad1f731`; **served model `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (provider quota; from this session's model-switch headers)
- **Head audited:** `f1c782f22a1f4a3f31f025282849cc62ba41b8c6` (branch `feat/i18n-spanish`)
- **Previous round:** `es29a3` at `c5f491ec`, `changes_requested` — 4 MAJOR (H-01…H-04), 1 MINOR (H-05), 1 NIT (H-06)
- **This round's verdict:** **passed** — 0 unresolved BLOCKER/MAJOR. One new MINOR (a code comment, no user-visible copy), four NIT.
- **Second independent pass:** job `ac1915638e4e` (`reviewer`, read-only), served `radient/auto` (pinned `anthropic/claude-sonnet-5-5`, quota fallback). It read the nine changed values without my analysis and returned **clean: 0 BLOCKER, 0 MAJOR, 2 MINOR, 2 NIT**. It agreed the five round-1 findings are fixed, reproduced my stale-comment note and my `tip.search` noun note independently, and raised two items I rate NIT (`phone_access` connotation, «en vivo»); both are recorded below with the reason.

## What changed in this namespace

Eight of the 27 values differ from the round-1 bytes (`1f693998e869…` → `9d6d5966c6ce…`). The other 19 did not move: 17 are byte-identical to the value the round-1 report quotes for them (16 per-key table rows plus `startup_queue.blocked` from H-06), compared as strings in `audit.log`, and two — `connect_disabled_reason` and `folders_read_failed` — have no unambiguous full-value quote in that report but keep their round-1 character counts (32 and 62) and match its prose on reading. All 27 keys are accounted for; no key outside the eight moved. The unchanged keys are not re-audited here (round 1 cleared them on identical bytes), and none of them is disturbed by the eight that did move.

| Key | Round 1 | Now | Round-1 finding |
|---|---|---|---|
| `suggestion.linear_mcp` | Configurar Linear MCP | **Configura Linear MCP** | H-01 |
| `suggestion.phone_access` | Activar acceso desde el teléfono | **Activa el acceso telefónico** | H-01 |
| `suggestion.review_repo` | Revisar este repo | **Revisa este repo** | H-01 |
| `suggestion.team_of_agents` | Crear un equipo de agentes | **Crea un equipo de agentes** | H-01 |
| `tip.parallel` | pide trabajo en paralelo entre varios subagentes | **pide varios subagentes en paralelo** | H-04 |
| `tip.schedule` | programa un prompt para que se ejecute periódicamente | **programa un prompt para que se repita** | H-02 |
| `tip.search` | busca conversaciones pasadas para reabrir una sesión | **busca una conversación pasada y reábrela** | H-03 |
| `options.fixed` | …para ver sus controles en vivo. | **…para los controles en vivo.** | H-05 |

`startup_queue.blocked` (H-06, NIT, optional in round 1) is unchanged, as the manager said.

## Verdict per round-1 finding

### H-01 — RESOLVED (mixed register in the chip pool)

All six chips are now second-person `tú` imperatives with six distinct verbs — «Muéstrame · Configura · Activa · Revisa · Crea · Despiértame» — which is the right grammar for a pool whose tap *replaces the composer draft* (`home.tsx:523` wires `onPick={setDraft}`). Each imperative names an action the agent performs, and no chip re-uses another's verb, so the round-1 note for `team_of_agents` ("keep the agent-making verb on this one and no other") still holds. Spanish resolves the enclitic forms correctly («Muéstrame», «Despiértame») beside the plain imperatives.

Fit, measured at the row's own type role (`body-sm` 14 px/400 per `tokens.gen.ts`, chip text box ~254 pt inside the 288 pt column on a 320 pt phone): 106.6–189.4 pt, i.e. 26 % to 58 % headroom. All six are inside `SUGGESTION_CHAR_BUDGET.es = 32` (16–27 characters), including the one that used to be exactly at the ceiling.

### H-02 — RESOLVED (`tip.schedule` fit)

«programa un prompt para que se repita» — 37 chars, **242.6 pt** at `meta` 12 px/500, row 260.6 pt with the 12 pt icon + 6 pt gap. Inside the 270 pt text box, the 288 pt content column and the 320 pt screen; it passes `TIP_CHAR_BUDGET = 48`, which now actually executes against `es` because `SHIPPED_LOCALES` includes it. It still says what the tip is for — a prompt on a schedule — and «para que se repita» carries "on a timer" without the countdown-device reading of «temporizador» that round 1 rejected.

### H-03 — RESOLVED (`tip.search` fit)

«busca una conversación pasada y reábrela» — 40 chars, **262.9 pt**, row 280.9 pt: the tightest of the nine, 7.1 pt inside the 270 pt box, and inside the column and the screen under both measurement instruments (see the calibration note below). «reábrela» is correctly accented (esdrújula). The two-step "search, then reopen" reads better in Spanish than a calqued purpose clause. Two NITs on this key's wording are recorded below; neither is a fit problem.

### H-04 — RESOLVED (both halves: fit and the «entre» proposition)

«pide varios subagentes en paralelo» — 34 chars, **216.3 pt**, row 234.3 pt (85.7 pt inside the screen edge). The old wording's proposition error is gone: parallel work no longer reads as shared *among* subagents, and "en paralelo" is idiomatic. The noun «trabajo» is dropped, but the tip still says what it is for — ask for several subagents in parallel.

### H-05 — RESOLVED (`options.fixed` narrowed "live controls" to viewing them)

Now «…Usa Detalles de la conversación para los controles en vivo.» — the controls are named as controls rather than as something to look at, so the sentence points the reader at the screen where they act on them. The destination name is **byte-identical** to `mobile.session.conversation_details` («Detalles de la conversación», verified by string containment, not by eye), and that label is keyed at `startup-transcript.tsx:52`. One NIT on «en vivo» is recorded below.

### H-06 — unchanged, as expected

`startup_queue.blocked` «Reintenta para enviar los mensajes en cola» still carries the round-1 NIT (purpose clause where Spanish wants the retried object; «Reintenta el envío de los mensajes en cola»). It was optional in round 1 and is optional here; the string wraps in a full-width row, so there is no fit problem. Not a gate item.

## New findings in this delta

### D-1 — MINOR — stale measurement in the `es` budget comment (`src/features/home/home-copy.ts`, `SUGGESTION_CHAR_BUDGET`)

- **Current comment:** "the widest shipped Spanish chip is 32 characters and 236.8 pt against a ~254 pt text box — the same 1.30 headroom the French budget records, so the ceiling follows the measurement."
- **Problem:** after this commit no Spanish chip is 32 characters, and none measures 236.8 pt. The widest shipped chip is «Despiértame con un resumen» (26 characters, **189.4 pt** at the row's own `body-sm` 14 px/400 — 75 % of the box). The 236.8 pt figure belongs to the *pre-fix* 32-character chip measured at 16 pt, i.e. at a size the row does not use (236.8 pt in round 1; 235.4 pt when re-measured here at 16 pt). Both cited facts are stale in the same commit that introduced them, and the comment is the recorded justification for a shipped constant.
- **Suggested:** "the widest shipped Spanish chip is 26 characters and 189.4 pt against a ~254 pt text box; 32 leaves the pool six characters of slack, matching the ~1.30 ratio the French budget records."
- **Why MINOR, not NIT:** it is the "why" record for a constant the wave deliberately made per-locale; a future reader measuring 189.4 pt cannot reproduce the stated 236.8. Nothing user-visible turns on it and the constant's value is safe, so it does not gate. The second independent pass reached the same finding and rated it NIT; the substance is identical.

### D-2 — NIT — `suggestion.phone_access`, «Activa el acceso telefónico» (connotation)

«Acceso telefónico» is the settled Spanish collocation for access *through the telephone channel* (telephone banking/healthcare). In a phone app about driving your computer, it reads acceptably as "phone access", and the action is preserved; but «Activa el acceso desde el teléfono» is the more precise form. Cost: 34 characters (**2 over the 32 budget**) and 219.7 pt of the 254 pt box — it would need `SUGGESTION_CHAR_BUDGET.es` raised and a 320 pt frame check. **Recommendation: keep the shipped string.** The French sibling took the same compact route («Activez l'accès mobile»), so this is the wave's register rather than a translation defect. The second pass raised it as MINOR and also advised keeping the shipped string.

### D-3 — NIT — `tip.search` margin

Row 280.9 pt of the 288 pt content column (7.1 pt). It fits, and it is inside the 320 pt screen by 39 pt under either instrument, but it is the pool's tightest string; if the tip row's type role ever gains tracking or the column loses padding, this is the first entry to clip. No change requested — recorded because the manager asked whether the rewritten tips still fit.

### D-4 — NIT — `tip.search` noun

«una conversación pasada … reábrela» follows the English noun ("search past conversations"), while this app's Spanish calls the resumable unit *sesión* everywhere (`resume_refused`, `resume_gone`, `resume_no_route`, `ended_placeholder`), and the French sibling wrote «retrouvez une session passée pour la rouvrir». The singular also narrows English's plural to one conversation. Accepted as shipped: the English source itself pairs "conversations" with "a session", and the singular is the more natural fragment. «busca una sesión pasada y reábrela» (34 chars, **220.6 pt** on this run's instrument — 206.0 pt on the second pass's) would align the noun and gain 42 pt of width if the wave wants it. The second pass reached the same note independently.

### D-5 — NIT — `options.fixed`, «para los controles en vivo» (idiom only)

«En vivo» is Spanish for live/real-time (and standard in software copy: *vista previa en vivo*, *datos en vivo*), so the meaning is right and nothing misdirects the action; the phrase is nonetheless a literal rendering of English "live controls" where a Spanish copywriter would more likely write «los controles de la conversación en curso» — which is also what the French sibling shipped («les commandes de la conversation en cours»). The second pass rated this MINOR and proposed «controles actuales», which I did not adopt: *actuales* drops the live/real-time sense the English carries. No change requested; recorded because two independent passes disagreed and the manager should see the divergence rather than a silent choice.

## Mechanical evidence (executed — see `audit.log`)

- `npm run -s i18n:check` → exit 0; `catalogue.gen.ts is current (143 keys, 10 namespaces, argument types from en, es, fr)`; `check-strings: 284 finding(s), all baselined; 0 new; no growth vs c5f491ec`.
- `npx vitest run src/i18n/__tests__/ src/features/home/` → 9 files, **121 tests passed**, including `TIP_CHAR_BUDGET = 48` and `SUGGESTION_CHAR_BUDGET.es = 32`, which now run against `es` because `SHIPPED_LOCALES` is `["en","fr","es"]`. That is the gate round 1 predicted would fail on the old tips; it now passes on the new ones.
- 27 en / 27 es / 27 context keys; no missing or extra key; context parity true. **No placeholders, plurals or selects exist in this namespace**, so there is no ICU category set to check.
- Typography across all 27 values: U+2026 for every ellipsis, no ASCII `...`, no ASCII apostrophe, no NBSP/U+202F, no double space, no edge whitespace, no control character, no guillemet, no em dash at all in this namespace, `¿…?` only on the greeting.
- `SUGGESTION_CHAR_BUDGET.es = 32`: all six chips 16–27 characters. `TIP_CHAR_BUDGET = 48`: all three tips 34–40 characters.
- `options.fixed` contains `mobile.session.conversation_details` **byte-identically** (containment test on the JSON values).

## Fit evidence (executed — see `audit.log`)

Geometry from the code, not assumed: `home-splash.tsx` content column is `px-4`, so 288 pt on a 320 pt phone; the chip is `buttonClasses("quiet","md")` (16 pt padding, 1 pt border) → **254 pt** text box; the tip row is a 12 pt icon plus a 6 pt gap ahead of `text-meta`, so its text box is **270 pt** and the row ≤ 288 pt. Widths are CoreText advance widths with the system font (SF Pro) at the token sizes (`body-sm` 14/400, `meta` 12/500, `letterSpacing: 0` in `tokens.gen.ts`). React Native dp == pt on iOS.

| Key | Chars | Measured | Box | Headroom |
|---|---|---|---|---|
| `suggestion.last_turn` | 25 | 169.4 pt | 254 | 33 % |
| `suggestion.linear_mcp` | 20 | 141.4 pt | 254 | 44 % |
| `suggestion.phone_access` | 27 | 172.1 pt | 254 | 32 % |
| `suggestion.review_repo` | 16 | 106.6 pt | 254 | 58 % |
| `suggestion.team_of_agents` | 25 | 173.5 pt | 254 | 32 % |
| `suggestion.wake_summary` | 26 | **189.4 pt** | 254 | 25 % |
| `tip.parallel` | 34 | 216.3 pt | 270 | 20 % |
| `tip.schedule` | 37 | 242.6 pt | 270 | 10 % |
| `tip.search` | 40 | 262.9 pt | 270 | 2.6 % |

**Calibration correction to round 1 (recorded, not a finding against this commit).** Re-measuring the round-1 strings in this run reproduces the round-1 numbers only at sizes the rows do not use: the French calibration chip «Créez une équipe d'agents» is 194.5 pt at 16 pt (round 1: 194.3) and 173.2 pt at the row's 14 pt; the round-1 32-character Spanish chip is 235.4 pt at 16 pt (round 1: 236.8); the old `tip.search` is 347.8 pt at 12.33 pt (round 1: 348.8) and 339.5 pt at the token's 12 pt. So round 1's chip widths over-read by ~13 % and its tip widths by ~2.7 %. Consequences, stated plainly: **H-02 and H-03 stand and are stronger** under the corrected metric (old rows 370.7 pt and 357.5 pt against 320 pt); **H-04's fit half was borderline rather than a 6.5 pt overflow** (old row 318.1 pt — 1.9 pt inside the screen edge, 30 pt outside the padding box), so that finding rests on the «entre» proposition error, which was the stronger half and is fixed. The verdict does not change.

## Second independent pass

Reviewer job `ac1915638e4e`, read-only, served `radient/auto` (pinned `anthropic/claude-sonnet-5-5`; same three-step quota fallback as this session). It read the nine changed values with no sight of my analysis and returned **clean, 0 BLOCKER / 0 MAJOR**. Agreement: all five round-1 findings fixed; the pool's register is uniform and imperative is correct because a chip's text is the message sent; every string inside its character gate and its box; «reábrela» correctly accented; `options.fixed`'s destination byte-identical; the stale budget comment (D-1) and the `tip.search` noun (D-4) as follow-ups. Disagreement: it rated `phone_access` connotation and «en vivo» MINOR (recorded as D-2 and D-5, rated NIT here with reasons) and proposed «para controlar la conversación en curso» for the latter — a workable alternative I record without adopting, since neither gates. Its widths differ from mine by ~7 % on the tips (same stated tokens), which changes no verdict: both runs put every tip inside its box, with `tip.search` tightest in both.

## Limits

- No human native-speaker review. No rendered frame was captured; the fit claims are executed text metrics against the geometry read from the code, and no pixel, truncation or screenshot claim is made.
- The auditor is not independent *by model*: both passes and the translator were served `radient/auto`. Independence here is process, context and agent — disclosed, not closed.
- Translator provenance is as supplied by the requesting manager; this auditor did not observe the translator's run.
- No translation API, SDK, MT service or back-translation was used anywhere in this audit.
- This repository has no `i18n/ledger.json` and no audit-ledger command at this head; a ledger-ready row is proposed in `record.json`, explicitly unwritten, and this bundle is the durable record.

## Context the manager should have (not findings — no catalogue key is involved)

- `src/features/past/past.tsx` still renders English literals on the surface this namespace's `tip.search` points at: `title="Past sessions"` (line 119), `label="Back"`, and the refusal `"This session is no longer saved."` (line 109, already noted in round 1). A Spanish reader who taps a tip about past conversations lands on an English screen title. Code-side localisation gap outside a translation audit's authority.
- `es` is now in `SHIPPED_LOCALES` and projected by `generate.ts`, so the per-locale character budgets execute; they are character counts, not widths, which is why the measured table above exists.
