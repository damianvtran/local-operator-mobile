# Independent i18n delta re-audit — fr / S2a, round 2

- Auditor: `i18n-auditor` (lopdev), session `00e59c341341`, model **anthropic/claude-opus-5-5**. Source: the session header; no fallback observed. I am not the translator (jobs 6fef051df5f7/db13a4ce1741) or the round-1 auditor (job 429cade82cf1).
- Hashes recomputed. All three match the brief: brief `e64f41af…a563`, v1 `b266a87a…0504`, v2 `ce805e01…1f91`.
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable. Redaction-marker hits: 0.

## Verdict: **PASSED** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 2 NIT

## Mechanical
- v1 and v2 each have the brief's 37 keys, in the same order. Both are valid JSON.
- Exactly 7 values differ, and the raw line diff shows exactly 7 changed lines: `mobile.computers.title.set_up`, `mobile.computers.own_tunnel.step_computer_help`, `mobile.computers.own_tunnel.private_host`, `mobile.computers.own_tunnel.public_host`, `mobile.computers.own_tunnel.step_test`, `mobile.computers.own_tunnel.save_connect`, `mobile.signin.panel.unavailable_detail`. This is the same set as the 7 listed in the notes. The other 30 keys are byte-identical.
- `{module}` appears exactly once and is unaltered. No other placeholders are in the changed keys.
- Typography:
  - U+202F before « : » is kept, matching the catalogue majority.
  - Apostrophes are typographic ’.
  - The em dash keeps the same plain-space style as v1 and catalogue `wait.tunnel_status`.

## Round-1 findings
| ID | Ruling |
|---|---|
| F-01 MAJOR title.set_up | **Resolved.** « Nouvel ordinateur » is 17 chars, the same as the English, so it fits the English header budget. It is a nominal title in the same pattern as « Nouveau contact », and it still names the set-up screen on both entry paths. It does not repeat the « Ajouter un ordinateur » button. |
| F-02 step_computer_help | **Resolved.** « venant de la même machine » removes the LAN reading. |
| F-03 step_test | **Resolved.** Matches the button and `need_test`. |
| F-04 public_host | **Resolved** with the translator's own wording. The pronoun « elle » is gone and the warning stays strong. See R2-N2. |
| F-05 unavailable_detail | **Resolved.** `({module})` is now attached to « écouteur local ». |
| N-01 insecure_allow | **Rejection acceptable.** It is a nit and cannot gate. +31% is verified (38 vs 29 chars). « le http:// en clair » is understandable developer usage, and the pair with `insecure_allowed` stays consistent. |
| N-02 / N-03 | Applied. Both read idiomatically. |

## New nits (non-gating)
### R2-N1 NIT — `mobile.computers.own_tunnel.private_host`
- Current: « Cette adresse se trouve sur votre propre réseau : l’exposition reste limitée à ce réseau. »
- Problem: « réseau » appears twice in one short line.
- Suggested: « Cette adresse se trouve sur votre propre réseau : l’exposition reste limitée à celui-ci. »

### R2-N2 NIT — `mobile.computers.own_tunnel.public_host`
- Current: « Cette adresse n’est pas privée — tout intermédiaire sur le trajet depuis ce téléphone peut lire le mot de passe. »
- Problem: « sur le trajet depuis ce téléphone » leaves the destination open. Accuracy and the warning's strength are intact.
- Suggested: « Cette adresse n’est pas privée — tout intermédiaire sur le réseau entre ce téléphone et le relais peut lire le mot de passe. »

## Claims not made
- No rendered frames. Width is judged by character count against the round-1 header arithmetic.
- No re-audit of unchanged keys beyond byte equality.
- No MT service was used.
