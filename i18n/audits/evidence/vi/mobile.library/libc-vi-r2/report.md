# libc-vi-r2 - mobile.library (vi) - DELTA audit of libc-vi-r1

**Verdict: passed** - 0 BLOCKER, 0 MAJOR (BLOCKER+MAJOR = 0). 31/31 keys rendered. Delta of `libc-vi-r1` (round-1 verdict: passed, 0 unresolved BLOCKER/MAJOR). Auditor: i18n-auditor, session c1967ad9dd38, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text (AS SHIPPED NOW): `src/i18n/catalogues/vi/mobile.library.json` sha256 `3e3099d83c23237193d2ecb55b9f36a7fb169974b041a17c5e0f2c4fa12aa00e`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. Round-1 bundle recorded `fa3c0d94b6c639cf7297d925c2fa714fe16cf028cd2395278786f39738994e5e` - it does NOT attest the shipped bytes; this bundle does. The target was hashed at the start and as the last command of the scripted run in audit.log - unchanged.

## Why this bundle exists
Review round 1 (R1-1): the findings of `libc-vi-r1` were applied after that bundle was written, so its recorded hash no longer matches the file as it ships. This delta attests the current bytes and verifies each applied change against the finding that asked for it.

## Keys changed since round 1 (derived, not asserted)
- `mobile.library.detail.message_label`: «Nhắn về tài nguyên này» → «Tin nhắn về tài nguyên này» (round-1 finding libc-vi-r1-1, NIT) - byte-exact: True

Proof the list is complete and exact: `tools/delta.py` reverts exactly these keys to the round-1 text inside the shipped raw bytes and hashes the result; it equals the sha256 recorded by `libc-vi-r1` (audit.log: "== recorded round-1 sha256 : True"). No other byte of the file differs from what round 1 judged.

## Judgment of the changed text
- `detail.message_label` «Tin nhắn về tài nguyên này» — noun-phrase label as the sidecar asks ("a fragment, no final full stop"); «Tin nhắn» is the same noun used in mobile.home.queue.* («Tin nhắn trong hàng đợi»). It is an accessible label of the composer field, read in isolation: now a noun, not an imperative.

## What was checked (audit.log)
- `generate.ts --check` current (180 keys, 12 namespaces); key set = en = sidecar (31); valid JSON; every value non-empty string; NFC-stable; no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; no mojibake; placeholders `{limit}` / `{count}` identical to source, no plural/select arms (sidecar: labelled counts); sentence-final punctuation matches the source's full stops in the locale's own stop.
- `new_tag_placeholder` still the ASCII server-grammar example.
- Every value re-rendered through the repo's `parseMessage`/`formatMessage` (src/i18n/messages.ts) at its real arguments (`limit`=12 = MAX_ASSET_TAGS; `count`=1,2,5), plus the six mobile.common verbs the Library screens render. The rendered text, not the template, was judged: all 31 render without error and without a leftover brace.
- Wiring: `discard_not_saved`, `discard_confirm` and `editor.discard_title` are passed by library-detail.tsx; the Dialog's Cancel is `t("mobile.common.cancel")` (grep in audit.log), and `discard_confirm` differs from `common.cancel` in this locale.

## Findings
None. No BLOCKER, MAJOR, MINOR or NIT on the current text.
