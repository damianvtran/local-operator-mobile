# Independent i18n audit — es / `mobile.computers` + `mobile.signin` (M3 slice S2a, 37 keys)

- Auditor: `i18n-auditor` (lopdev), session `8e69a6afebfa`; model **anthropic/claude-opus-5-5** (session header; no fallback observed)
- Translator: translator job 651120615896 — different instance; I did not translate or edit the draft
- Date 2026-11-12 · source `59ec51843f05f93706492756b1a89ef53004179a`
- Brief sha256 `e64f41af…ba563`, draft `es/draft-es-s2a.json` sha256 `4ae37771…03432` — both recomputed, match
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable. Redaction hits: 0.
- References: es style guide + glossary (`~/local-operator` origin/main 73dc4157), shipped es `mobile.computers`/`mobile.signin` @59ec5184.

## Verdict: **FAIL — changes_requested** (BLOCKER 0, MAJOR 1, MINOR 4, NIT 2)

Mechanical clean: repo `parseMessage` parses all 37 en/es pairs; param sets, `{name}`, `` `{command}` ``, `({module})`, brand/scheme tokens and `…` identical; 37/37 keys, brief order, valid JSON; no plurals. Register tú throughout; glossary máquina/relé/túnel/compilación consistent with shipped copy.

## Findings
| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| F-01 | MAJOR | `mobile.computers.title.set_up` | Configura una máquina | Width. computersHeaderStackWidth (src/ui/size-class.ts:457-476) budgets the ENGLISH 227 pt title. es measures 283.8 pt (Figtree SemiBold 28 dp, -0.02 em, from the bundled TTF's advances; calibration: 'Computers' 137.8 vs measured 138; not rendered). Set-up view hides Refresh; with Back and no switcher the header stays inline from 354 pt and needs 32+52+8+284=376 pt: fits at 390 (≈14 pt spare) but clips at 360-375 pt (iPhone SE/mini, common Android). With switcher it stacks at 390, no clip. | Añade una máquina |
| F-02 | MINOR | `mobile.computers.own_tunnel.step_computer_help` | El relé solo acepta conexiones locales (loopback), así que tiene que ejecutarse en esta máquina. Evita que entre en reposo mientras usas la app. | Ruling on translator's uncertainty: “conexiones locales” is readily read as local-network (cf. “red local”), the opposite of the note (same computer only); “(loopback)” helps only technical readers. Also “esta máquina” is read on the phone, where “esta” can point at the phone. | El relé solo acepta conexiones desde la propia máquina (loopback), así que tiene que ejecutarse en ella. Evita que entre en reposo mientras usas la app. |
| F-03 | MINOR | `mobile.computers.own_tunnel.insecure_off_help` | Con http://, la contraseña del relé cruza la red sin cifrar, así que está desactivado salvo que lo actives. Usa https:// siempre que la dirección lo admita. | Subjectless masculine “está desactivado … lo actives” has no antecedent (English “it” = the opt-in) and can read as “http:// is disabled”; unencrypted_body calls the toggle “la opción” (feminine), so gender also disagrees. | Con http://, la contraseña del relé cruza la red sin cifrar, así que esta opción está desactivada salvo que la actives. Usa https:// siempre que la dirección lo admita. |
| F-04 | MINOR | `mobile.computers.own_tunnel.unencrypted_body` | Activa la opción para usarla o indica una dirección https:// — los túneles suelen mostrar una. | “usarla” attaches to the nearest feminine noun, “la opción” (“turn the option on to use the option”); the intended object is the address. | Activa la opción de arriba para usar esta dirección o indica una dirección https:// — los túneles suelen mostrar una. |
| F-05 | MINOR | `mobile.computers.own_tunnel.security_body` | … elige un túnel con autenticación propia si el tuyo la ofrece y cambia la contraseña con `{command}` si la has compartido. … | “choose a tunnel with its own authentication if yours offers it” is self-contradictory (if yours offers it, no choosing is needed); intent is to use your tunnel’s own authentication where available. “si la has compartido” narrows “if it has been shared” to sharing by the reader. | Estás poniendo tu propia máquina en internet, y la contraseña del relé es lo único que la protege. Usa HTTPS siempre que puedas, activa la autenticación propia de tu túnel si la ofrece y cambia la contraseña con `{command}` si se ha compartido. Cualquiera con esa contraseña y tu URL puede controlar las sesiones de esa máquina. |
| N-01 | NIT | `mobile.computers.own_tunnel.public_host` | Esta dirección no es privada: cualquiera entre este teléfono y ella puede leer la contraseña. | Colon instead of dash: accepted (idiomatic; ruling for translator). “cualquiera” reads as a person; English “anything” includes routers/networks. | Esta dirección no es privada: cualquier intermediario entre este teléfono y ella puede leer la contraseña. |
| N-02 | NIT | `mobile.computers.own_tunnel.step_test_help` | Esto hace una solicitud real a través de tu túnel antes de guardar nada. | “Esto hace una solicitud” is a calque of “This makes a request”. | Esta prueba envía una solicitud real a través de tu túnel antes de guardar nada. |

## Width (title.set_up / title.list)
Estimates from the bundled Figtree SemiBold advances (28 dp, −0.02 em), calibrated against the code's 138/227; not rendered. `Máquinas` 116.7 pt < 138 budget — fine. `Configura una máquina` 283.8 pt vs 227 budget: at 390 pt with Back (no switcher; Refresh is hidden in set-up) the inline title has 298 pt → fits; it clips at 354–375 pt because the stack threshold is computed from English (319 → floor 354). With the switcher, the header stacks at 390 → no clip.

## Translator's uncertain keys — rulings
- `mobile.computers.own_tunnel.step_computer_help`: changes requested (F-02)
- `mobile.computers.own_tunnel.public_host`: colon accepted; NIT N-01 on “cualquiera”
- `mobile.computers.own_tunnel.insecure_allowed`: accepted: “Dirección http:// permitida” is a clear state label, mirrors the toggle; “plain” is carried by the literal scheme
- `mobile.computers.own_tunnel.password_label`: accepted at 1.36x: full-width field label; “Contraseña del relé” is the shipped glossary form (paths.radient_body, signin.panel.unavailable_alt)
- `mobile.computers.own_tunnel.saving`: accepted at 1.43x: shares the button with “Guardar y conectar” (18 chars), so no new overflow; identical to shipped mobile.account_routing.saving
- `mobile.computers.title.list`: pass: “Máquinas” 116.7 pt vs English 137.8 pt budget

## Per-key results
| Key | Result | Ruling |
|---|---|---|
| `mobile.computers.title.list` | pass | pass: “Máquinas” 116.7 pt vs English 137.8 pt budget |
| `mobile.computers.title.set_up` | finding F-01 |  |
| `mobile.computers.banner.unreachable_stale` | pass |  |
| `mobile.computers.banner.unreachable_empty` | pass |  |
| `mobile.computers.banner.unreadable_stale` | pass |  |
| `mobile.computers.banner.unreadable_empty` | pass |  |
| `mobile.computers.own_tunnel.title` | pass |  |
| `mobile.computers.own_tunnel.password_for` | pass |  |
| `mobile.computers.own_tunnel.password_label` | pass | accepted at 1.36x: full-width field label; “Contraseña del relé” is the shipped glossary form (paths.radient_body, signin.panel.unavailable_alt) |
| `mobile.computers.own_tunnel.intro` | pass |  |
| `mobile.computers.own_tunnel.step_computer` | pass |  |
| `mobile.computers.own_tunnel.step_computer_help` | finding F-02 | changes requested (F-02) |
| `mobile.computers.own_tunnel.step_publish` | pass |  |
| `mobile.computers.own_tunnel.step_app` | pass |  |
| `mobile.computers.own_tunnel.url_label` | pass |  |
| `mobile.computers.own_tunnel.insecure_allow` | pass |  |
| `mobile.computers.own_tunnel.insecure_allowed` | pass | accepted: “Dirección http:// permitida” is a clear state label, mirrors the toggle; “plain” is carried by the literal scheme |
| `mobile.computers.own_tunnel.insecure_hint` | pass |  |
| `mobile.computers.own_tunnel.insecure_on_help` | pass |  |
| `mobile.computers.own_tunnel.insecure_off_help` | finding F-03 |  |
| `mobile.computers.own_tunnel.unencrypted_title` | pass |  |
| `mobile.computers.own_tunnel.unencrypted_body` | finding F-04 |  |
| `mobile.computers.own_tunnel.private_host` | pass |  |
| `mobile.computers.own_tunnel.public_host` | finding N-01 | colon accepted; NIT N-01 on “cualquiera” |
| `mobile.computers.own_tunnel.step_test` | pass |  |
| `mobile.computers.own_tunnel.step_test_help` | finding N-02 |  |
| `mobile.computers.own_tunnel.security_heading` | pass |  |
| `mobile.computers.own_tunnel.security_body` | finding F-05 |  |
| `mobile.computers.own_tunnel.test` | pass |  |
| `mobile.computers.own_tunnel.testing` | pass |  |
| `mobile.computers.own_tunnel.save_connect` | pass |  |
| `mobile.computers.own_tunnel.saving` | pass | accepted at 1.43x: shares the button with “Guardar y conectar” (18 chars), so no new overflow; identical to shipped mobile.account_routing.saving |
| `mobile.computers.own_tunnel.need_address` | pass |  |
| `mobile.computers.own_tunnel.need_test` | pass |  |
| `mobile.computers.own_tunnel.verdict_ok` | pass |  |
| `mobile.computers.own_tunnel.verdict_not_yet` | pass |  |
| `mobile.signin.panel.unavailable_detail` | pass |  |

## Disclosures
- Bundle written to `/Users/damian/.local-operator/sessions/8e69a6afebfa/scratchpad/m3s2a-es-audit/` because the guardrail blocked creating `/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/m3s2a/audits/es/` (another session's scratchpad).
- Before the block, I created and removed my own temp file `m3s2a/audits_es_view.txt`; nothing else was written under m3s2a.
- No ledger row recorded (writes restricted to the bundle by the task).
