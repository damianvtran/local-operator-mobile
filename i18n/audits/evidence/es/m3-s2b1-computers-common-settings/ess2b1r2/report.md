# es delta re-audit — M3 S2b-1 — round 2 — audit id esS2b1r2

**Verdict: PASS (`passed`).** 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. Delta scope only.
Auditor: i18n-auditor (lopdev), session d85b1c3efea2, model anthropic/claude-opus-5-5 (session system header; no fallback observed). Independent from translator (jobs f0807e12fe32 / 718d61e6ffc9) and from round-1 auditor (job 34706765eb23). Source 254e6fba.
Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable.

## Mechanical (executed — audit.log)
- sha256 recomputed: brief d694b10a…, v1 6c11a31f…, v2 a4f22fb0… — all MATCH.
- 41/41/41 keys; v1 and v2 key order equal to brief. v1→v2 differs in exactly 5 keys, equal to the notes' list; the other 36 are byte-identical.
- Changed values parsed with repo `src/i18n/messages.ts` (`parseMessage`/`formatMessage`/`pluralCategory`, node `--max-old-space-size=256`): placeholder name+kind sets equal English for all 5; no bidi/zero-width controls; no `[redacted]` in any input.
- verdict_timeout plural rendered: 1→one “1 segundo”; 0/2/10/1500000→other; 1000000→many “1000000 de segundos”. CLDR es complete; `#` in every arm.

## Per-key (changed keys)
| Key | v2 change | Result |
|---|---|---|
| verdict_forbidden | “asegúrate de que el túnel **reenvíe**” | PASS — subjunctive is the correct mood for the directive; rest byte-identical. Resolves ES-02. |
| verdict_timeout | “no respondió **en un plazo de** {seconds…}” | PASS — reads as a time limit; plural intact. Resolves ES-04. (“Comprueba que … está” stays indicative, correct after *comprobar que*.) |
| verdict_local_network_ios | “y después toca **“{action}”**.” | PASS — “ ” per style guide §Punctuation; renders “Probar la conexión” (own_tunnel.test). Resolves ES-03. |
| verdict_local_network | “; después, pulsa **“{action}”**.” | PASS — consistent with _ios and copy_command_hint “{label}”. Resolves ES-03. |
| runtime_body | “el túnel solo **se conserva durante** esta ejecución” | PASS — fixes clipped “dura”; natural, accurate (“lasts for this run only”). Resolves ES-01. |

## Round-1 findings
- ES-01 MINOR — resolved.
- ES-02 NIT — resolved.
- ES-03 NIT — resolved (both keys). Note: the shipped catalogue sometimes names buttons unquoted (relay.health.ended_detail “toca Reanudar”); quoting a placeholder-inserted label is the safer choice and matches this draft's copy_command_hint. Not a finding.
- ES-04 NIT — resolved.
- ES-05 NIT — **rejection accepted.** The brief note defines the daemon as “a background service that is restarted if it stops”; “daemon supervisado, que se reinicia solo” renders that definition, adds no false claim, and helps a reader for whom “supervisado” is opaque. A NIT does not gate; trimming stays optional.

## Out-of-scope observation (source/code, pre-existing, non-gating)
- In Settings the retry button is `mobile.settings.own_tunnel.test_again` (“Probar de nuevo”), but tunnel-verdict.ts:176-191 always passes `own_tunnel.test` (“Probar la conexión”) as {action}, so the Settings failure box names a button label not shown there. Identical in English; not a translation issue.

## Claims not made
- Unchanged 36 keys not re-audited beyond byte-equality. No renders/screenshots. No MT/back-translation.
