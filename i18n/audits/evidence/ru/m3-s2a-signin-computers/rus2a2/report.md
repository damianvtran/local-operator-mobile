# Independent i18n DELTA re-audit — ru, M3 S2a, round 2
- Auditor: i18n-auditor (lopdev), session b2fc5336cf25, model **anthropic/claude-opus-5-5** (runtime header; no fallback observed). Not the translator (68e31088b1a1/9c3158b5dcb8) nor round-1 auditor (50d71c33ecdf).
- Hashes recomputed, all match: brief e64f41af…a563, v1 f7aa4fb6…33f6, v2 b92e8628…16d7.
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable.
- Redaction: 0 marker bytes in v2; `[redacted]` in display of step_computer_help is harness masking (bytes are «Ретранслятор»).

## Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT

## (1) Equality proof
Flattened v1/v2: 37 keys each, symmetric key difference empty; 32 values byte-equal; exactly 5 differ, the 5 listed in notes-ru-s2a-v2.md.

## (2) Changed keys
- `mobile.computers.own_tunnel.step_computer_help` — resolves M-01, **pass**. «Ретранслятор принимает подключения только с того же компьютера, поэтому запускать его нужно именно на нём. Не давайте компьютеру уснуть, пока пользуетесь приложением.» — «именно на нём» binds to «того же компьютера» (его = ретранслятор, нём = компьютер); the phone/computer ambiguity is gone. Loopback meaning kept; "Leave it awake" kept. вы register.
- `mobile.computers.own_tunnel.insecure_hint` — resolves N-01, **pass**. «Нужно только для адресов http — по ним пароль передаётся открытым текстом» — Plural «адресов http» + «по ним» agree; dash spaced; no final stop, matching English; "http" kept.
- `mobile.computers.own_tunnel.insecure_on_help` — resolves M-02, **pass**. «Включено: пароль от ретранслятора и всё, что вы отправляете, передаются по этой сети без шифрования. Делайте так только в сети, которой доверяете.» — Plural «передаются» agrees with compound subject; verb now matches siblings; warning stays direct.
- `mobile.computers.own_tunnel.insecure_off_help` — resolves N-02, **pass**. «Через http:// пароль от ретранслятора передаётся по сети открытым текстом, поэтому по умолчанию такие адреса запрещены. Используйте https:// везде, где адрес это поддерживает.» — «Через http://» removes doubled «по»; schemes kept unchanged; still no nudge to enable.
- `mobile.signin.panel.unavailable_detail` — resolves M-03, **pass**. «Для входа через Radient нужен локальный приёмник ответа браузера ({module}), которого нет в этой сборке.» — ({module}) now follows the listener term; «которого» still refers to «приёмник» (masc. gen.); {module} exact, parenthesised; Radient kept.

Mechanical: repo `parseMessage`/`formatMessage` @59ec5184 on all 5 — parse OK, params equal English, `{module}` renders inside parentheses (audit-parser output in audit.log).

## (3) Round-1 rulings
M-01, M-02, M-03, N-01, N-02 resolved. N-03 rejection accepted: a nit cannot gate, and the reasoning is factually sound apart from the count.

### R2-N1 NIT — `security_heading` (notes only)
Notes say the suggested heading is 37 chars; it is 38 (190% of 20). Conclusion unaffected; no change requested.
