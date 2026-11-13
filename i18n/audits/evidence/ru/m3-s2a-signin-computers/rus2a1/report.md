# Independent i18n audit — ru / `mobile.computers` + `mobile.signin` (M3 slice S2a, 37 keys)
- Auditor: `i18n-auditor` (lopdev team), session `b42780e9df74`
- Model: **`anthropic/claude-opus-5-5`** (session runtime model from the system header; no fallback observed)
- Translator: translator job 68e31088b1a1 (same model family, different agent instance). I did not translate and did not edit the draft.
- Date: 2026-11-12 · Source commit `59ec51843f05f93706492756b1a89ef53004179a`
- Brief `brief-59ec5184.json` sha256 `e64f41af7e262a49a92ddf6a2f9fe519bc046c771833ca58a2d622dfeeeba563` (recomputed, matches)
- Draft `ru/draft-ru-s2a.json` sha256 `f7aa4fb6c19541145a8c74abf4a55088d443aaf31b2a240b30e8d3f4d08633f6` (recomputed, matches)
- Keys read: **37 / 37** (mobile.computers 36, mobile.signin 1); key set and order identical to the brief
- Read route: ordinary git/scratchpad reads; read_public_copy not used: mobile catalogue paths are refused by the core route; context sidecars are nested JSON and not routable.
- Redaction: 0 marker bytes in any file (`grep -ci redact`). The tool display showed `[redacted]` twice — draft `step_computer_help` (bytes begin U+0420 «[redacted]», confirmed with unicode_escape) and ru catalogue `connect_refused.password` — harness masking, not a defect.
- References: ru style guide and glossary at `~/local-operator` origin/main 73dc4157; shipped ru catalogues @59ec5184 (ретранслятор, туннель, аккаунт Radient, «пароль от ретранслятора»). The mobile repo has no ru style guide; the core one governs.

## Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 3 MINOR, 3 NIT

The MINORs are cheap one-line fixes; I recommend applying them before landing. They do not gate.

## Mechanical (all 37 pass)
- Repo parser `parseMessage`/`formatMessage` from `src/i18n/messages.ts`@59ec5184 (read-only copy in my scratch, node 24 `--experimental-strip-types`): every en and ru value parses; param sets identical; `{name}`, `` `{command}` `` (backticks kept), `{module}` render. 0 failures. No ICU plural/select in this slice, so no one/few/many/other branches are needed.
- Protected tokens identical per key: Radient, HTTPS, URL, `http://`, `https://`, `http`, backticked command. Typography: «ёлочки» only (no straight quotes), spaced em dash, U+2026 where English has it, final stops match English, no double/edge spaces, ё used consistently. Valid JSON; no keys added or dropped.

## Findings

### M-01 MINOR — `mobile.computers.own_tunnel.step_computer_help`
- Current: «Ретранслятор принимает подключения только с этого же компьютера, поэтому запускать его нужно здесь. Не давайте компьютеру уснуть, пока пользуетесь приложением.»
- Problem: Deixis: the reader is on the PHONE, so «запускать его нужно здесь» can read as 'run it here, on this phone'. «с этого же компьютера» is also deictic. Loopback meaning (same machine, not LAN) is otherwise correct.
- Suggested: «Ретранслятор принимает подключения только с того же компьютера, поэтому запускать его нужно на этом компьютере. Не давайте компьютеру уснуть, пока пользуетесь приложением.»

### M-02 MINOR — `mobile.computers.own_tunnel.insecure_on_help`
- Current: «Включено: пароль от ретранслятора и всё, что вы отправляете, идёт по этой сети без шифрования. Делайте так только в сети, которой доверяете.»
- Problem: Translator's flag confirmed: compound subject «пароль … и всё, что вы отправляете» with a following predicate takes the plural by the standard norm; singular «идёт» reads as a slip. «идти по сети» is also colloquial next to «передаётся» used in insecure_hint/insecure_off_help.
- Suggested: «Включено: пароль от ретранслятора и всё, что вы отправляете, передаются по этой сети без шифрования. Делайте так только в сети, которой доверяете.»

### M-03 MINOR — `mobile.signin.panel.unavailable_detail`
- Current: «Для входа через Radient нужен локальный приёмник ответа браузера, которого нет в этой сборке ({module}).»
- Problem: Coined term «локальный приёмник ответа браузера» accepted: accurate to the note (receives the browser's sign-in reply on this device) and plainer than «loopback-слушатель». But «…нет в этой сборке ({module})» attaches the module id to «сборке», reading as the build's identifier; {module} names the missing listener module.
- Suggested: «Для входа через Radient нужен локальный приёмник ответа браузера ({module}), которого нет в этой сборке.»

### N-01 NIT — `mobile.computers.own_tunnel.insecure_hint`
- Current: «Нужно только для адреса по http, при котором пароль передаётся открытым текстом»
- Problem: «для адреса по http, при котором…» is slightly stiff (relative clause on «адреса» via «при котором»). Screen-reader only.
- Suggested: «Нужно только для адресов http — по ним пароль передаётся открытым текстом»

### N-02 NIT — `mobile.computers.own_tunnel.insecure_off_help`
- Current: «По http:// пароль от ретранслятора передаётся по сети открытым текстом, поэтому по умолчанию такие адреса запрещены. Используйте https:// везде, где адрес это поддерживает.»
- Problem: Double «по» («По http:// … по сети») is a little clumsy. Meaning is right and does NOT nudge toward enabling (states the default, recommends https://).
- Suggested: «Через http:// пароль от ретранслятора передаётся по сети открытым текстом, поэтому по умолчанию такие адреса запрещены. Используйте https:// везде, где адрес это поддерживает.»

### N-03 NIT — `mobile.computers.own_tunnel.security_heading`
- Current: «Прежде чем открыть доступ»
- Problem: «открыть доступ» leaves the object implicit; 'it' is the computer. Heading wraps, so the longer form fits.
- Suggested: «Прежде чем открыть доступ к компьютеру»

## Rulings on the translator's flagged keys and the brief's known cross-locale issues

- `mobile.computers.title.set_up`: «Новый компьютер» accepted (nominal title, fr precedent). Figtree has NO Cyrillic glyphs (cmap check), so Cyrillic renders in the system fallback; estimated by system-font ratio ≈234–241 pt vs the 227 pt English budget (+3–6%, ESTIMATE). Back-only header has ≥262 pt at the 354 floor: fits. No shorter natural form.
- `mobile.computers.title.list`: «Компьютеры» accepted; no shorter correct word. ESTIMATE ≈167–171 pt vs 138 pt budget (+21–24%) — see non-gating code observation.
- `mobile.computers.own_tunnel.step_computer_help`: 143% accepted for width (wrapping help paragraph); M-01 is about deixis, and its replacement is about the same length.
- `mobile.computers.own_tunnel.password_label`: 142% accepted: field label above a full-width input (own-tunnel.tsx:357/443); 20 chars, no shorter correct form. Genitive without «от» is the normal label form; body copy's «пароль от ретранслятора» (catalogue radient_body) is consistent enough.
- `mobile.computers.own_tunnel.save_connect`: 150% accepted: full-width stacked Button (own-tunnel.tsx:267-279); standard phrase.
- `mobile.computers.own_tunnel.saving`: 157% accepted: 11 chars on the same full-width Button; standard busy label.
- `mobile.computers.own_tunnel.unencrypted_body`: «переключатель выше» accepted: the warning box (own-tunnel.tsx:473) renders below the toggle (:452-467), so «выше» is literally true and names the visible control.
- `mobile.signin.panel.unavailable_detail`: Coined «локальный приёмник ответа браузера» accepted as a term; see M-03 for placeholder placement.
- `mobile.computers.own_tunnel.insecure_on_help`: Translator's self-flag verified: plural is the norm → M-02.

## Per-key results
| key | ru chars / en | result |
|---|---|---|
| `mobile.computers.title.list` | 10/9 | pass |
| `mobile.computers.title.set_up` | 15/17 | pass |
| `mobile.computers.banner.unreachable_stale` | 71/62 | pass |
| `mobile.computers.banner.unreachable_empty` | 101/84 | pass |
| `mobile.computers.banner.unreadable_stale` | 75/68 | pass |
| `mobile.computers.banner.unreadable_empty` | 74/74 | pass |
| `mobile.computers.own_tunnel.title` | 12/15 | pass |
| `mobile.computers.own_tunnel.password_for` | 25/29 | pass |
| `mobile.computers.own_tunnel.password_label` | 20/14 | pass |
| `mobile.computers.own_tunnel.intro` | 206/179 | pass |
| `mobile.computers.own_tunnel.step_computer` | 13/15 | pass |
| `mobile.computers.own_tunnel.step_computer_help` | 159/111 | finding M-01 |
| `mobile.computers.own_tunnel.step_publish` | 10/10 | pass |
| `mobile.computers.own_tunnel.step_app` | 12/10 | pass |
| `mobile.computers.own_tunnel.url_label` | 13/10 | pass |
| `mobile.computers.own_tunnel.insecure_allow` | 23/29 | pass |
| `mobile.computers.own_tunnel.insecure_allowed` | 24/24 | pass |
| `mobile.computers.own_tunnel.insecure_hint` | 79/75 | finding N-01 |
| `mobile.computers.own_tunnel.insecure_on_help` | 140/115 | finding M-02 |
| `mobile.computers.own_tunnel.insecure_off_help` | 172/149 | finding N-02 |
| `mobile.computers.own_tunnel.unencrypted_title` | 20/27 | pass |
| `mobile.computers.own_tunnel.unencrypted_body` | 107/89 | pass |
| `mobile.computers.own_tunnel.private_host` | 85/70 | pass |
| `mobile.computers.own_tunnel.public_host` | 92/93 | pass |
| `mobile.computers.own_tunnel.step_test` | 8/7 | pass |
| `mobile.computers.own_tunnel.step_test_help` | 73/71 | pass |
| `mobile.computers.own_tunnel.security_heading` | 25/20 | finding N-03 |
| `mobile.computers.own_tunnel.security_body` | 345/339 | pass |
| `mobile.computers.own_tunnel.test` | 21/19 | pass |
| `mobile.computers.own_tunnel.testing` | 9/8 | pass |
| `mobile.computers.own_tunnel.save_connect` | 24/16 | pass |
| `mobile.computers.own_tunnel.saving` | 11/7 | pass |
| `mobile.computers.own_tunnel.need_address` | 41/40 | pass |
| `mobile.computers.own_tunnel.need_test` | 98/83 | pass |
| `mobile.computers.own_tunnel.verdict_ok` | 10/9 | pass |
| `mobile.computers.own_tunnel.verdict_not_yet` | 8/7 | pass |
| `mobile.signin.panel.unavailable_detail` | 104/89 | finding M-03 |

## Non-gating observations (code/design, not translation)
- computersHeaderStackWidth (size-class.ts:457-476) uses English advances (138/227 pt). Figtree ships no Cyrillic glyphs, so ru titles render in the system fallback. ESTIMATE «Компьютеры» ≈167–171 pt: with Back+Switch, Refresh hidden (fit 357), a 375 pt phone leaves ≈156 pt → likely clipped «Компьют…»; also the 429–~462 band with Refresh. Code fix (measure localized title), not a translation finding.
- Mixed-font headings (Latin in Figtree, Cyrillic in system font) are a design observation, not a translation finding.

## What I did not do
No rendered frames; widths are font-metric estimates (Figtree hmtx for English, which reproduced the code's 137.8/226 pt; a system-font ratio for Cyrillic, which Figtree lacks). No human native-speaker review; no MT or translation service used for comparison or back-translation.
