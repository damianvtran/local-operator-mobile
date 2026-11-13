# Independent i18n audit — fr / `mobile.computers` + `mobile.signin` (M3 slice S2a, 37 keys)

- Auditor: `i18n-auditor` (lopdev team), session `3434906ff93a`
- Model: **`anthropic/claude-opus-5-5`** (session runtime model from the system header; no fallback observed)
- Translator: translator job 6fef051df5f7 (notes: session `7da932f15a0f`, same model family) — different instance; I did not translate and did not edit the draft
- Date: 2026-11-12 · Source commit `59ec51843f05f93706492756b1a89ef53004179a`
- Brief `brief-59ec5184.json` sha256 `e64f41af7e262a49a92ddf6a2f9fe519bc046c771833ca58a2d622dfeeeba563` (recomputed, matches)
- Draft `fr/draft-fr-s2a.json` sha256 `b266a87a22185a96e1eb7987a2790d765486af7345a16f1c396573cf91380504` (recomputed, matches)
- Keys read: **37 / 37**, order and key set identical to the brief
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable. Redaction-marker hits: 0 (brief, draft, all 6 repo files read).
- References: fr style guide `~/local-operator` origin/main `i18n/style-guides/fr.md` (sha256 5315e1ac…), glossary `i18n/glossary.md` (0eb34437…), shipped fr catalogues @59ec5184. The mobile repo has no fr style guide of its own.

## Verdict: `changes_requested` — 0 BLOCKER, 1 MAJOR, 4 MINOR, 3 NIT

## Mechanical (all 37 pass)
- Repo parser: `parseMessage`/`formatMessage` from `src/i18n/messages.ts`@59ec5184 (copied to my scratch, not executed in the repo) parsed every en and fr value; param sets identical; `{name}`, `{command}`, `{module}` render; 0 failures. No ICU plural/select in this slice → no CLDR branches required.
- Script checks: backticks, `http://`, `https://`, Radient, HTTPS, URL preserved; U+2019 apostrophes only (30), no straight `'`; `…` U+2026 where English has it; U+202F before every `:` (7) and no `; ! ?` needing one; final stops match English; valid JSON, no added/dropped keys.
- The repo `i18n:check` scripts validate in-tree catalogues, not this scratch draft, so they were not run.

## Findings
### F-01 MAJOR — `mobile.computers.title.set_up`
- Current: « Configurer un ordinateur »
- Problem: Overflow risk. Header fit is decided by computersHeaderStackWidth (src/ui/size-class.ts:457-476 @59ec5184), which uses the ENGLISH title advance (227 pt) and does not measure translations (its own comment). With a back button and no cluster the header computes 32+227+60=319 → stays inline at 390 pt; 24 fr chars vs 17 en ≈ 320 pt by proportional estimate (not rendered) → ≈412 pt → title clips in the exact 'chose Add a computer' path.
- Suggested: « Nouvel ordinateur »
- Why: 17 chars, same length as the English, so it fits the reviewed English budget; nominal screen titles are the upheld fr precedent (S1 audit frs1r1: « Connexion »). « Ajouter un ordinateur » (21) is still over budget and repeats the button.

### F-02 MINOR — `mobile.computers.own_tunnel.step_computer_help`
- Current: « Le relais n’accepte que les connexions locales : c’est donc cet ordinateur qui doit l’exécuter. Empêchez sa mise en veille tant que vous utilisez l’app. »
- Problem: « connexions locales » is ambiguous in French networking: commonly read as local-network (LAN) connections, but the note says loopback = same computer only. A reader may think another machine on the LAN can run the relay.
- Suggested: « Le relais n’accepte que les connexions venant de la même machine : c’est donc cet ordinateur qui doit l’exécuter. Empêchez sa mise en veille tant que vous utilisez l’app. »

### F-03 MINOR — `mobile.computers.own_tunnel.step_test`
- Current: « Testez-le »
- Problem: The note fixes the antecedent of 'it' as the connection (feminine); « Testez-le » points back to the relay of step 2. Defensible, but drifts from the source and « Testez-la » would have no visible antecedent.
- Suggested: « Testez la connexion »
- Why: Avoids the pronoun, names what the button below tests (« Tester la connexion ») and matches need_test « Testez d’abord la connexion ». 19 chars in a step heading that wraps.

### F-04 MINOR — `mobile.computers.own_tunnel.public_host`
- Current: « Cette adresse n’est pas privée — n’importe quel intermédiaire entre ce téléphone et elle peut lire le mot de passe. »
- Problem: « entre ce téléphone et elle » — a stressed pronoun for an inanimate address reads clumsy in product copy.
- Suggested: « Cette adresse n’est pas privée — n’importe quel intermédiaire entre ce téléphone et cette adresse peut lire le mot de passe. »

### F-05 MINOR — `mobile.signin.panel.unavailable_detail`
- Current: « La connexion avec Radient nécessite un écouteur local, absent de cette version ({module}). »
- Problem: « absent de cette version ({module}) » attaches the module id to « version », so it reads as the build's identifier; in the source {module} names the missing listener module.
- Suggested: « La connexion avec Radient nécessite un écouteur local ({module}), absent de cette version. »

### N-01 NIT — `mobile.computers.own_tunnel.insecure_allow`
- Current: « Autoriser le http:// en clair »
- Problem: « le http:// » nominalises the scheme; acceptable, slightly clipped. Optional pair if changed: insecure_allowed « Adresse http:// en clair autorisée ».
- Suggested: « Autoriser une adresse http:// en clair »

### N-02 NIT — `mobile.computers.own_tunnel.private_host`
- Current: « Cette adresse se trouve sur votre propre réseau : l’exposition s’y limite. »
- Problem: « l’exposition s’y limite » is terse/literary for a warning line.
- Suggested: « Cette adresse se trouve sur votre propre réseau : l’exposition reste limitée à ce réseau. »

### N-03 NIT — `mobile.computers.own_tunnel.save_connect`
- Current: « Enregistrer et connecter »
- Problem: Objectless « connecter » is acceptable button French; the reflexive is the more natural reading. Width is NOT at risk: the buttons are stacked full-width (own-tunnel.tsx:250-277).
- Suggested: « Enregistrer et se connecter »

## Rulings on the translator's flagged keys

| key | ruling |
|---|---|
| `mobile.computers.title.set_up` | +41% — MAJOR F-01 → « Nouvel ordinateur ». |
| `own_tunnel.password_label` | +57% — accepted: field label (full width), no shorter correct form; matches catalogue « mot de passe du relais » (signin.panel.unavailable_alt). |
| `own_tunnel.save_connect` | +50% — accepted for width: stacked full-width Button (own-tunnel.tsx:267); optional NIT N-03. |
| `own_tunnel.testing` | +75% — accepted: replaces the 19-char « Tester la connexion » in the same full-width button; « Test… » alone is not idiomatic; matches catalogue « … en cours… » pattern. |
| `own_tunnel.saving` | +114% — accepted: replaces a 24-char label in the same button; identical to the fr style-guide recorded width exception relay.chrome row.saving « Enregistrement… ». |
| `own_tunnel.verdict_not_yet` | +43% — accepted: 10 chars absolute, box title that wraps; calm and idiomatic. |
| `own_tunnel.step_computer_help` | +37% — accepted for width (wrapping help); wording MINOR F-02. |
| `own_tunnel.step_test` | uncertain — MINOR F-03 → « Testez la connexion ». |
| `own_tunnel.verdict_ok` | uncertain — upheld « Connecté »: same flow already ships « Connecté, mais non enregistré » (computers.save_refused.title) and signin.stage_signed_in « Connecté »; one word per note. |
| `mobile.signin.panel.unavailable_detail` | uncertain « écouteur local » — upheld: « écouteur » is settled fr dev vocabulary for listener; plain per note. Placement MINOR F-05. |

## Upheld without finding (checked, not assumed)
- Register: vous throughout, imperatives for steps, infinitives for buttons — matches catalogue (« Réessayer », « Se déconnecter »).
- Glossary: relay → relais (glossary §1), tunnel, l’app, mot de passe, piloter les sessions (welcome.body), appareil for device, « en clair »/« sans chiffrement » consistent across the four plain-http keys.
- Security copy keeps its force: insecure_on_help « À n’activer que sur un réseau de confiance », public_host strong, security_body faithfully renders the awkward « use a tunnel that offers its own authentication where yours does » as « activez l’authentification propre à votre tunnel s’il en propose une ».
- Banners never promise an automatic retry; Radient untouched.

## Non-gating observation (code, not translation)
`computersHeaderStackWidth` uses English advances for both title keys, so fr « Ordinateurs » (+2 chars) can also clip beside the switcher+refresh cluster at 390 pt (32+138+8+119+72=369 < 390 inline). « Ordinateurs » has no shorter form; this needs a rendered fr check or measured widths, owned by the manager/coder, not the translator.

No rendered-frame or native-speaker claim is made; widths are proportional estimates from character counts, not renders.
