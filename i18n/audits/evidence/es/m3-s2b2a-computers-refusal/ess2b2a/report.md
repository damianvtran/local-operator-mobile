# es audit — m3-s2b2a computers.refusal (24 keys)

Verdict: **passed** (0 BLOCKER, 0 MAJOR, 1 MINOR, 2 NIT). Auditor: i18n-auditor, anthropic/claude-opus-5-5, session 57d45b0513a4; translator job ba7a91cef29d.

Brief sha256 d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40 · draft sha256 d1d9734623f37ee5b093c1d6cad4904d5f348b605e84dcd7fb5191049f17fdb9 · redaction hits 0.

## Mechanical
24/24 keys, all parse with messages.ts, placeholders identical, es plural one/many/other present with #, no bidi controls.

## Findings
- **ES-1 MINOR** `mobile.computers.refusal.open_console` — current: “Abrir consola de Radient” → suggested: “Abrir la consola de Radient”. Dropped article reads telegraphic; the es catalogue always writes 'la consola de Radient' (mobile.computers.billing_help, disabled_help, 'No se pudo abrir la consola de Radient.') and articled button labels ('Abrir la cola', 'Abrir el menú de navegación'). The 24-char hint is not a clip: Button sets no labelLines (wraps, min-h grows) and a full-width md button (px-4) on 320 pt has ~256 pt of label width, so 27 chars fits one line.
- **ES-2 NIT** `mobile.computers.refusal.try_now` — current: “Probar ahora” → suggested: “Reintentar ahora”. Acceptable and matches mobile.computers.try_now, but here the button retries a connection after '… aún no está disponible.'; 'Probar' leans toward 'test'. Optional sharper wording (16 chars).
- **ES-3 NIT** `mobile.computers.refusal.relay_stopped_title` — current: “El relé no está en ejecución en {subject}.” → suggested: “El relé no se está ejecutando en {subject}.”. Double 'en … en' is slightly heavy; optional smoother verb form. Keeping 'en ejecución' for catalogue consistency is also fine.

## Rulings
- retry_title_disponible: ACCEPT — '{subject} aún no está disponible.' keeps the temporary, reassuring sense ('aún'), avoids gender agreement with a name/URL subject that listo/lista would force; no added cause.
- wait_seconds_one_vs_other: ACCEPT — arms are mutually exclusive (es one = 1 only); 'unos 1 segundo' is ungrammatical, so 'aproximadamente' in one and the more natural 'unos' in many/other is correct. many '# de segundos' matches style guide and catalogue (verdict_timeout).
- try_again_equals_common: ACCEPT — 'Reintentar' is the right label for a connection retry; identical copy to mobile.common.try_again and mobile.computers.retry is fine, keys stay distinct.
- sign_in_title_two_sentences: ACCEPT — English source is two sentences and the note says 'Two short sentences'; the trailing 'keep it one sentence' is boilerplate width text. Mirrors the source.
- button_widths: open_console 24 and sign_in_again 23 both fit: Button (src/ui/components/button.tsx) sets numberOfLines only when labelLines=1, which refusal-surface never passes, so labels WRAP, never clip; md size is min-h-11 px-4. 'Volver a iniciar sesión' accepted as is; open_console: see ES-1 (restore article, 27 chars, still fits).

## Per key
- offline_title: OK
- relay_stopped_title: OK (ES-3 nit)
- tunnel_gone_title: OK
- console_title: OK
- password_title: OK — identical to own_tunnel.verdict_password head
- sign_in_title: OK
- retry_title: OK
- certificate_title: OK — = verdict_tls head
- host_title: OK — = verdict_host head
- offline_next: OK — 'Despierta' matches style-guide wake → despertar; 'más arriba' keeps the 'above' pointer
- relay_stopped_next: OK — no command added
- tunnel_gone_next: OK
- console_next: OK — plainly says signing in on the phone won't change it
- password_next: OK
- sign_in_next: OK — 'queda en cuarentena y no se enviará' keeps the not-sent promise, not softened
- retry_next: OK — no automatic retry promised
- certificate_next: OK — mirrors verdict_tls; firm 'no se saltará la comprobación'; em dash with spaces per style guide
- host_next: OK — = verdict_host remedy
- wait_seconds: OK — one/many/other, # in every arm, advice only
- try_now: OK (ES-2 nit)
- try_again: OK
- sign_in_again: OK
- open_console: ES-1 minor
- another_address: OK

## Out of scope (not gating)
- messages.ts formats # without locale grouping ('1000000', '1.5') whereas the es style guide expects '1.000.000' — parser behaviour, not this draft
- refusal-surface.tsx testIDs look swapped (retry button carries CONTROL.refusalSignIn, sign-in button CONTROL.refusalRetry) — code, not copy
