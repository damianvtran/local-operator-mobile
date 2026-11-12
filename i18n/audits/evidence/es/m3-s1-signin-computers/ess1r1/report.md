# Audit — es · mobile.computers + mobile.signin (M3 S1)

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 5 NIT across all 44 keys.
Auditor: `i18n-auditor` instance `967cada7d16e`, model **deepseek/deepseek-flash** (session
header; no fallback used). Independent of the translator instance `e8b188dd15b9`.
Head audited: `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce`. Draft sha256
`9ff88b2c3df3b4ce24a7a9ff615b48aa7002ee9160ae0ca4fea5a3745de125a3`.
No translation/MT service or back-translation was used, and the worktree was never written to.

## Term ruling on "computer" (the question put to this audit)

**`máquina` is correct; the draft must keep it.** Derived here, not taken from the
translator's note:

| Corpus | máquina | ordenador | computadora |
|---|---|---|---|
| shipped mobile `es` (all namespaces) | **54** occ / 10 files | 7 occ / 5 files | 3 occ / 1 file |
| the two namespaces this slice extends | 16 | 1 (`connect_refused.generic`) | 0 |
| core `es` (`local_operator/i18n/catalogues/es/*`, origin/main) | **77** | 4 | 0 |

Whole product: 131 `máquina` vs 11 minority. Beyond the majority, the style guide's
neutral-Spanish rule decides it — `ordenador` is Peninsular, `computadora` is LatAm, so
neither is the neutral choice, while `equipo` is unavailable (glossary §2 assigns it to
*team*). `máquina` is the only term that is both neutral and already dominant.

Two consequences worth recording, neither of which gates this slice:

1. `i18n/glossary.md` has no row for *computer* and `i18n/style-guides/es.md` records no
   locale call for it. Recommend adding `computer → máquina` to the es guide (in the shape
   of the existing `caché` / `daemon` amendments) so a later wave cannot reopen the split.
2. The 10 minority occurrences are **pre-existing and outside these 44 keys** — they do not
   gate this audit and the draft must not be held to them. The most visible is
   `mobile.chrome.home.connect` = "Conectar un ordenador" (home CTA, read next to
   "Añadir una máquina"), and the one inside this namespace is
   `mobile.computers.connect_refused.generic`. Worth one follow-on copy pass, not this PR.

The translator's note understates the drift slightly: it says `ordenador` 6 and
`máquina` 55 in 11 files; I measure 7 and 54 in 10 files. Immaterial to the ruling, and the
notes are not shipped copy; recorded so the next reader uses the measured numbers.

## Mechanical (repo's own parser, not a lookalike)

`parseMessage` from `src/i18n/messages.ts` @1796c3a, imported read-only by
`audit-es-s1.mts` run from this scratchpad:

```
keys in brief: 44 · keys in draft: 44
ICU/params/order: OK (44/44)
byte-identical to English: mobile.computers.row.a11y
plural-carrying keys: (none)
```

- Placeholder names **and kinds** identical to English on all 44; the brief's declared
  `placeholders` arrays agree with the English parse; brief order == draft order; nothing
  added or dropped; valid UTF-8 JSON, tab-indented like its neighbours.
- No plural arm exists in this slice, so no CLDR category question arises for `es`
  (`one`/`many`/`other` are untested here, not wrong).
- Technical tokens untouched: `Local Operator`, `Radient`, `URL`, `harness`, `lop mobile`,
  `{status}`, `{name}`, `{reach}`. `{status}` is inserted verbatim by the caller, and
  "Radient ya tiene el túnel — active." stays grammatical around that English token.
- No manual bidi controls, no ASCII `...`, no straight quotes, no space before `? : ; !`,
  `¿…?` present on the one whole question (`remove.title`), em dash spaced as the guide says.
- `row.a11y` ({name}, {status}, {reach}) is byte-identical to English; I agree with the
  translator's "judged identical" call and checked it myself: a placeholder-only
  comma-separated template has nothing to translate, and reordering or adding a conjunction
  would change the announced structure at the call site.

### Key-delta check (verified, so the coder's merge is unambiguous)

**All 44 keys are new to `es`** — none of them exists in `es/mobile.computers.json` or
`es/mobile.signin.json` today (checked key by key with `jq has($k)`; zero hits). So this is a
pure append in both files, not a replacement of anything shipped:

| namespace | en keys | es keys today | brief keys | expected es keys after |
|---|---|---|---|---|
| `mobile.computers` | 75 | 45 | 30 | 75 |
| `mobile.signin` | 32 | 18 | 14 | 32 |

The counts are the cheap assertion for the coder: after applying, `es` must match the English
count in both files, and `npm run -s i18n:generate` + `i18n:check` will fail if a key was
dropped or duplicated. Note the English-first worktree already ships these strings, so the
`es` app will fall back to English for exactly these 44 keys until the draft lands.

## Findings

| ID | Sev | Key | Problem → suggestion |
|---|---|---|---|
| E-01 | MINOR | `mobile.signin.welcome.body` | "…Tu código nunca sale de **ella**." — `ella` can resolve to *la app* (the sentence subject) or *máquina*; the context note fixes the promise to the machine. The same sentence also renders the source's *on your machine* as *de tu máquina*. → **"Esta app dirige las sesiones en tu propia máquina y muestra lo que hizo. Tu código nunca sale de tu máquina."** |
| E-02 | MINOR | `mobile.computers.paths.radient_body` | One English verb (*run a tunnel*) becomes `gestiona` here and `ejecutas` in the card directly below on the same screen, and `gestiona` turns Radient into the manager rather than the runner. → **"…Radient ejecuta el túnel por ti y te da una URL privada y autenticada…"** |
| E-03 | NIT | `mobile.computers.wait.tunnel_status` | `ya` adds *already*; defensible as step-2 progress. → **"Radient tiene el túnel — {status}."** |
| E-04 | NIT | `mobile.computers.own_tunnel_instead` | `en su lugar` is the English *instead* in English order; stiff on a quiet text button. → **"Usar mi propio túnel en vez de Radient"** (+4 glyphs) — or keep, since `own_action` already owns the bare label and a collision would be worse. |
| E-05 | NIT | `mobile.computers.status.route_ready` | `ruta lista` can flicker as *route list* (`lista` as noun) before the adjective reading lands. Keep it — the source forces the noun *route* into the badge — with `ruta preparada` (+4) as the escape hatch if a reviewer dislikes it. |
| E-06 | NIT | `mobile.computers.remove.body` | Sentence-initial `La` is briefly ambiguous between article and object pronoun, `quita` between noun and verb; both readings mean the same, so nothing is at stake. → **"Esto la quita de la lista de este teléfono. …"** |
| E-07 | NIT | `mobile.computers.paths.own_body` | Three person-emphases in two sentences is heavy in neutral es, though the source carries all three (*yourself*, *you run*, *you keep*). Keep; if the card is tight, drop the last. |

Nothing else. **All 44 keys are accurate, correctly polarised and safe:**

- `not_harness` keeps the negation; `remove.body` keeps all three negations (computer,
  tunnel, account) and its promise that nothing else is touched, with `quitar` honestly
  distinct from the shipped `eliminar` for account deletion;
- `billing_inactive` states the refusal ("se denegará el acceso remoto") without softening it;
- the three privacy/permission claims are preserved exactly — `intro` (*never sees your
  password*), `welcome.body` (*code never leaves*), `cancelled_help` (*nothing was changed*);
- `radient_body` / `own_body` keep the honest costs (an account is needed / no account
  needed at any point, you keep the password);
- register is `tú` throughout with infinitive action labels (`Usar`, `Empezar`, `Actualizar`,
  `Probar`, `Reintentar`, `Quitar`), sentence case, no `!`, fragments lowercase;
- terminology matches the shipped `es`: `sesión` / `inicio de sesión`, `relé` (glossary §2,
  and `connect_refused.password` "El relé no aceptó esa contraseña"), `harness` kept English,
  `túnel`, `contraseña`, `teléfono`, `cuenta de Radient`, `facturación`, `acceso remoto`,
  `ruta`, and the badge set with shipped `badge.active` = "activa" / `badge.connecting` =
  "conectando" (so `row.a11y_active` "…, activa" and `a11y_connecting` "…, conectando" agree
  with the badges a screen reader sits beside);
- `compilación` in `panel.unavailable` follows the shipped precedent "Esta compilación no
  incluye notificaciones." rather than inventing a second word for *build*.

## Second pass (high-visibility: onboarding)

An **independent Spanish-only reader** was dispatched as a subagent (`deepseek/deepseek-flash`,
job `f324c81526ca`) with the English, the brief and the notes withheld, reading only the 16
welcome/sign-in/panel strings in screen order. Its suggestions were adjudicated here against
the shipped catalogue and glossary — not adopted wholesale:

**Accepted** (they became E-01, E-04, E-06): the `de ella` ambiguity in the privacy line;
`en su lugar` reading as English word order; sentence-initial `La` in the remove body.

**Rejected, with the shipped evidence:**
- *"dirección" → "correo"* — wrong for this product: it is the relay's host:port address, not
  an email (shipped: "Tu dirección y tu contraseña siguen aquí"). This one would have been a
  meaning error if applied.
- *"relé" → "relay"* — glossary §2 mandates `relé`; shipped `es` already says it.
- *"compilación" → "versión de la app"* — shipped `es` already says "Esta compilación no
  incluye notificaciones".
- *"esperar a" + browser called a calque* — `esperar a` with a thing is standard Spanish, and
  shipped `stage_browser` is exactly "Esperando a tu navegador".
- *"Reintentar" → "Intentar"* — *Try again* presupposes a prior attempt, and every shipped
  retry key in `es` is "Reintentar".
- *intro "tu navegador completa el inicio de sesión"* — faithful to the source and to shipped
  `stage_exchanging` "Finalizando el inicio de sesión en el navegador".

## Fit (measured, not eyeballed)

`Badge` renders `text-mono-label` = 11 pt, mono advance 0.6 em + 0.06 em tracking ≈ 7.26 dp per
glyph, `px-2` + 1 pt borders (18 dp) per badge, `gap-2` (8 dp) between the status and reach
badges; that flex-row has no `numberOfLines`, so it wraps rather than truncating.

| Worst pair | glyphs | width | available (screen − 2×16 dp gutter) |
|---|---|---|---|
| en `provisioning` + `answering` | 21 | 196.5 dp | 288 dp @320 · 358 dp @390 |
| es `aprovisionando` + `respondiendo` | 26 | 232.8 dp | 288 dp @320 |

No overflow at 100 % text scale, including the narrowest phone. At 150 % scale es reaches
327 dp (clips on a 320 dp screen, fits 358) where en is 273 dp; at 200 % both clip. The
longest es badge is 14 cells, matching the translator's own claim. Since no shorter accurate
word exists (`preparando` loses *provisioning*), this is recorded as a measured limit, not a
finding — but it is the row to re-capture in the screenshot pass, and the two badges worth
looking at are `status.provisioning` and `reach.answering`.

Button labels wrap (`Button` only clamps when a call site passes `labelLines={1}`, and none of
these do), so `Iniciar sesión con Radient` (26) and `Reintentar de todos modos` (25) grow
vertically instead of truncating.

## Where this is recorded

- Receipt: `receipt-es-s1.json` (status, hashes, findings, term ruling, second pass)
- Execution log, real commands and actual output: `audit-es-s1.log`
- Validator: `audit-es-s1.mts`
- All in `/Users/damian/.local-operator/sessions/89450c856fcf/scratchpad/`

The mobile repo carries no audit-ledger file (`docs/i18n.md` puts the audit report in the pull
request and gates the shipped set on it), so nothing was written into `~/local-operator-mobile`;
the coder/manager owns the PR-side record and any ledger flip for `es`.
