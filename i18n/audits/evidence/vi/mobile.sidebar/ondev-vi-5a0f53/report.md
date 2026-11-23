# Translation audit ondev-vi-5a0f53 — mobile.sidebar (vi), slice on-device

Auditor: translation-auditor, session 5a0f53e88def, model anthropic/claude-opus-5-5 (independent of translator session a74b1eaff17c). Source d1ed0e2a. Draft sha256 d2fdfbf02a71715c7756a8d4ef5a5db1e094d668e7bbf650d508c0549abc27d5.

## Keys

### `mobile.sidebar.row.on_device`

- en: `On {device}`
- vi: `Trên {device}`

'Trên {device}' → "Trên Studio Mac". Accurate: 'trên' is the idiomatic Vietnamese preposition for something running on a device/machine (cf. 'trên máy tính'), not a calque of a physical 'on top of'. It is the existing spoken fragment row_label.on_device 'trên {device}' with only the first letter capitalised for sentence case; the mechanical check confirms that byte for byte. Register is neutral, there's no pronoun and no T/V issue, and there's no full stop. Placeholder set {device} is exact and keeps the English order. Width: 4 letters before the name versus English's 2 ('On'), so +2 characters and no material overflow. The name begins the visible run, so tail ellipsis cuts the end of the name, as in English. Clean.

### `mobile.sidebar.row_label.join`

- en: `{first}, {second}`
- vi: `{first}, {second}`

'{first}, {second}' uses the Latin comma U+002C plus a space, which is the Vietnamese enumeration separator. It is identical to vi mobile.session.highlights.withheld_reasons_join and contains no 'và' and no full stop. The fold over 4 parts gives "Payments, <waiting>, <on device>, <open>". Clean.

## Findings

None.

## Verdict

mobile.sidebar (vi): **PASSED**. 2 keys read, 0 findings (none), 0 blocker/major. Mechanical evidence: audit.log.
