# Independent i18n delta re-audit — es / M3 S2a (`mobile.computers` + `mobile.signin`), round 2

- Auditor: `i18n-auditor` (lopdev), session `f0770d338369`; model **anthropic/claude-opus-5-5** (from the session header; no fallback observed). Not the translator (jobs 651120615896 / b4cdc1ca4d11) and not the round-1 auditor (job 0fb6ee83f154, session 8e69a6afebfa).
- Date 2026-11-13 UTC · source `59ec51843f05f93706492756b1a89ef53004179a`
- Hashes recomputed, all match: brief `e64f41af…ba563`, v1 `4ae37771…03432`, v2 `4cca2d62…8e6e8`.
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable. Redaction hits: 0.
- Scope: delta only — equality proof for the 30 unchanged keys, a judgment on the 7 changed keys, and a ruling on each round-1 finding. Unchanged keys were not re-audited.

## Verdict: **PASS** (BLOCKER 0, MAJOR 0, MINOR 1, NIT 1)

## 1. Mechanical delta proof
- v1 and v2 both have 37 keys, in the same order, with no keys added or dropped. Exactly 7 values differ, and they are the 7 keys listed in `notes-es-s2a-v2.md`. The other 30 are byte-equal.
- Changed keys: the `{command}` placeholder and its backticks, `http://`/`https://`, `HTTPS` and `URL` all match English. The repo's `parseMessage` (copied from `src/i18n/messages.ts` at 59ec5184) parses all 37 v2 values: 37 ok, 0 failed. Full stops follow the brief: the title has none, the help text has them.

## 2. Changed keys
| Key | v2 | Ruling |
|---|---|---|
| `title.set_up` | Añade una máquina | **pass (fit: see R2-01)**. It is a tú imperative as the note asks, and it still names the set-up screen: it echoes the shipped entry button `mobile.computers.add` “Añadir una máquina”, and it also reads correctly when Radient lists no machines. Glossary term *máquina* is used. Width is an estimate: 240.7 pt from the bundled Figtree SemiBold advances, 28 dp, −0.02 em, no kerning. I reproduced the 137.8 and 226.2 calibration myself. The text was not rendered; the rendered check is a separate open row. |
| `own_tunnel.step_computer_help` | El relé solo acepta conexiones desde la propia máquina (loopback), así que tiene que ejecutarse en ella. Evita que entre en reposo mientras usas la app. | pass. It now says "same machine" correctly. “en ella” refers back to the machine, so the old “esta máquina” (read on the phone) ambiguity is gone. Glossary *relé* is used. |
| `own_tunnel.insecure_off_help` | … así que esta opción está desactivada salvo que la actives. … | pass. The subject is explicit, the gender agrees with “opción”, and the polarity is correct (off unless you turn it on). Both schemes are intact. |
| `own_tunnel.unencrypted_body` | Activa la opción de arriba para usar esta dirección o indica una dirección https:// — los túneles suelen mostrar una. | pass. The object is now the address, and “de arriba” matches the note (“the plain-http toggle just above”). See N-01. |
| `own_tunnel.public_host` | … cualquier intermediario entre este teléfono y ella puede leer la contraseña. | pass. It covers people and network hops alike, and the warning stays strong. |
| `own_tunnel.step_test_help` | Esta prueba envía una solicitud real a través de tu túnel antes de guardar nada. | pass. Idiomatic, and the calque is gone. |
| `own_tunnel.security_body` | … activa la autenticación propia de tu túnel si la ofrece y cambia la contraseña con `{command}` si se ha compartido. … | pass. The meaning matches “use your tunnel's own authentication where it offers it”, and “si se ha compartido” is agentless, like the English. The translator's wording is accepted. The placeholder and backticks are exact. |

All 7 keep the tú register and use the shipped glossary terms (máquina, relé, túnel, contraseña del relé). The spaced dash in `unencrypted_body` is unchanged from v1 and was already accepted in round 1.

## 3. Round-1 findings
| ID | Ruling |
|---|---|
| F-01 MAJOR title.set_up width | **Resolved** for the case it raised (Back shown, no switcher). The title needs 32+52+8+240.7 = 332.7 pt, which is under the 354 pt stack floor, so it fits at every inline width. There is a residual case in a different state: see R2-01. |
| F-02 step_computer_help | Resolved. |
| F-03 insecure_off_help | Resolved. |
| F-04 unencrypted_body | Resolved. |
| F-05 security_body | Resolved (the translator's own wording is equivalent to the suggestion). |
| N-01 public_host | Resolved. |
| N-02 step_test_help | Resolved. |

## 4. New findings (delta only)
| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| R2-01 | MINOR | `mobile.computers.title.set_up` | Añade una máquina | **Residual fit risk (estimate).** In set-up, Refresh is hidden. When the switcher shows and Back does not (`showSwitch = !empty \|\| phoneKnowsComputers`; `backAction` is null only when `!canGoBack && !routed`), `computersHeaderStackWidth` stacks the header below 32+227+8+119 = 386 pt, a budget built from the English width. Inline, the title needs 32+8+119+240.7 = 399.7 pt, and the inline title has `numberOfLines={1}`. So the estimate is an ellipsis at 386–399 pt, which includes the 390/393 pt iPhones. v1 was worse in the same state (it needed 442.8 pt), and round 1 did not raise it. I rate this MINOR, not MAJOR, because the estimate is unrendered and I could not prove the state is reachable (no route, nothing to pop, saved computers on the phone, and the set-up title shown). **It becomes MAJOR if the open rendered-check row shows that state clipping.** | Fix in code first: measure the translated title, or stack it per locale. If the copy has to fit instead, use “Nueva máquina” (190.6 pt est.; it fits in every state, but it is a label rather than an imperative). |
| N-01 | NIT | `mobile.computers.own_tunnel.unencrypted_body` | … para usar esta dirección o indica una dirección https:// … | “dirección” appears twice in quick succession. | … para usar esta dirección o indica una con https:// — los túneles suelen mostrar una. |

No BLOCKER or MAJOR finding is open, so the verdict is **passed**. The rendered width check for `title.set_up` stays a separate open row, and its result decides R2-01.
