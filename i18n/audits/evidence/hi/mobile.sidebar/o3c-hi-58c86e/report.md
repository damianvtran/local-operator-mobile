# O3-c hi audit — mobile.sidebar (o3c-hi-58c86e)

Verdict: **passed** — 0 BLOCKER/MAJOR, 1 MINOR. Keys: 9. Auditor: i18n-auditor, session 58c86e4852a5, anthropic/claude-opus-5-5 (independent of translator b541c2efda5b; no fallback observed).
Inputs: draft sha256 769b65ff02a1f0d267c2ec62ee6c85a44c74674337f3355b5961ef4aeda2bd7e, brief e88beb09366b9ff795bf0ac916f30cef1c9a93c35fa4617575e904c7a6f5fd17, source e7ebc391. Redaction marker hits: 0 (draft, brief minus its pattern field, en + context).

## Findings

### HI-C1 — MINOR — `mobile.sidebar.row_label.working`
- Current: `काम जारी`
- Problem: Terminology drift: the shipped hi word for this same state ('Working', the agent's turn running) is कार्यरत (relay.chrome.session.subtitle.working_plain, and working = 'कार्यरत · {elapsed}'). A reader who hears 'काम जारी' on the row then reads कार्यरत in the opened conversation's header. कार्यरत is shorter, ungendered, and needs no agreement with बातचीत. 'काम जारी' is not wrong, only inconsistent.
- Proposed: `कार्यरत`

## Checked and accepted (no finding)
- Mechanical: keyset = brief's 9; `{device}` and `{kind}` kept; select arms `approval|other` identical to en; parseMessage accepts all; no trailing danda/punctuation, no Devanagari digits, no ZWJ/ZWNJ, no stray Latin. 9/9 negative controls caught (audit.log).
- Glossary/style: approval → स्वीकृति (style guide singular); nukta (इंतज़ार) and chandrabindu (पहुँच) as shipped; आप register not applicable (fragments).
- Reuse verified in shipped hi: सवाल = row.asks; समाप्त = relay.chrome.session.subtitle.ended; पहुँच से बाहर = remote_sessions.health_dropped; इंतज़ार = notifications.section.waiting; `{owner} पर` pattern for on_device.
- Agreement: feminine दे रही / खुली with बातचीत, matching row.new = नई (brief rule). Shipped status `उत्तर नहीं दे रहा` (settings, relay subtitle) is masculine for a different subject; the row-level feminine is correct, not drift.
- उत्तर vs जवाब: health_quiet says `जवाब नहीं दे रही`, the waiting arm uses जवाब; the draft's उत्तर matches the two shipped status words and renders narrower (5.42 em vs 6.07 em). Both acceptable; no change.
- Waiting arms are whole, natural phrases (`स्वीकृति का इंतज़ार`, `सवाल के जवाब का इंतज़ार`), genitive agreement correct (इंतज़ार m. → का).
- Fit: measured with CoreText rather than counting code points. `उत्तर नहीं दे रही` is 5.42 em in Kohinoor Devanagari Medium vs 6.39 em for en `not answering` in Figtree Medium; `पहुँच से बाहर` 4.79 vs 6.17; `स्वीकृति` 2.89 vs 3.88. Every hi chip is narrower than its English source, so the 17-code-point count against the 14 hint is not an overflow. Correction to the translator note: ी/ि/ा are spacing marks (Mc) and do take advance; only ् ं ँ े ृ do not. The conclusion still holds on measurement. Android's Noto Sans Devanagari was not measured.
- Screen-reader joins render sensibly: `Payments, स्वीकृति का इंतज़ार, खुली`; `Payments, काम जारी, उत्तर नहीं दे रही, Studio Mac पर, पहुँच से बाहर, खुली`.
