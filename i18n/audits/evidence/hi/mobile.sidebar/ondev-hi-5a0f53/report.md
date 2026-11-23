# Translation audit ondev-hi-5a0f53 — mobile.sidebar (hi), slice on-device

Auditor: translation-auditor, session 5a0f53e88def, model anthropic/claude-opus-5-5 (independent of translator session a74b1eaff17c). Source d1ed0e2a. Draft sha256 c4e1b0c914a400f936cb2a3bd8153dd0c106539a75d044e931db550858fe4c62.

## Keys

### `mobile.sidebar.row.on_device`

- en: `On {device}`
- hi: `{device} पर`

'{device} पर' → "Studio Mac पर". Accurate: पर is the locative postposition, so the name correctly comes first. Byte-identical to the existing hi row_label.on_device. Devanagari has no case, there's no danda, and the register is neutral. Placeholder set {device} is exact. Width: 2 graphemes after the name versus English's 'On ' before it, so no overflow. Tail ellipsis on a very long name drops पर, but the start of the name stays visible, as the brief requires. That trade-off comes from the postposition grammar, not a defect. The longer '{device} डिवाइस पर' was rightly rejected. Hindi is LTR, so there's no bidi concern. Clean.

### `mobile.sidebar.row_label.join`

- en: `{first}, {second}`
- hi: `{first}, {second}`

'{first}, {second}' uses the Latin comma U+002C plus a space, which modern Hindi UI uses for enumeration. Identical to hi withheld_reasons_join, with no 'और'/'तथा' and no danda. Clean.

## Findings

None.

## Verdict

mobile.sidebar (hi): **PASSED**. 2 keys read, 0 findings (none), 0 blocker/major. Mechanical evidence: audit.log.
