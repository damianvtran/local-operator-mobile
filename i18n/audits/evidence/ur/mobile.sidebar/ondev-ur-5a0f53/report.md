# Translation audit ondev-ur-5a0f53 — mobile.sidebar (ur), slice on-device

Auditor: translation-auditor, session 5a0f53e88def, model anthropic/claude-opus-5-5 (independent of translator session a74b1eaff17c). Source d1ed0e2a. Draft sha256 1f670ee1ffae1456fa0be14ce16cb7351f7f13dc1c62b78c43aedc436cf21fdf.

## Keys

### `mobile.sidebar.row.on_device`

- en: `On {device}`
- ur: `ڈیوائس {device} پر`

'ڈیوائس {device} پر' → logical 'ڈیوائس Studio Mac پر', read right to left as 'device Studio Mac on'. Accurate and natural Urdu: apposition plus the postposition پر. Byte-identical to the existing ur row_label.on_device, and ڈیوائس is the term the ur catalogues already use (e.g. 'اس ڈیوائس' in mobile.community/computers/notifications). Arabic script has no case, there's no ۔ full stop, and the register is neutral. Placeholder set {device} is exact, with ASCII braces. Bidi: 0 control characters (U+200E/F, U+202A-E, U+2066-9, U+061C), and the mechanical scan confirms it. The first strong character is U+0688 (AL), so the paragraph resolves RTL under first-strong detection. That matters because the device-line Text carries no writingDirection style (verified in list-row.tsx at d1ed0e2a and direction.tsx's account of RN 0.86.3). Reading order with a Latin name, from the right edge: ڈیوائس, then the LTR run 'Studio Mac', then پر at the left end. In RTL, tail ellipsis removes پر and then the end of the name, so the start of the name stays visible. Width: see A-ur-1.

Translator's trailing-punctuation flag: this is a renderer issue, not a translation defect. With 'Pixel!' the classes around the end of the name are L, ON, WS, AL. The neutral '!' sits between an L run and an AL run, so under the UBA (N1/N2) it takes the embedding direction (R) and is drawn on the left of 'Pixel' ('!Pixel'). 'Mac (2)' behaves the same way: EN, ON, WS, AL. Any placement of {device} in an RTL sentence has this problem, including the shorter '{device} پر' (followed by AL). Policy forbids catalogue bidi controls (docs/i18n.md L107), so only the renderer can fix it, by isolating the argument at format time (FSI…PDI around {device}, or a nested Text). Recorded as observation R-ur-1 for engineering. It does not count against this translation.

### `mobile.sidebar.row_label.join`

- en: `{first}, {second}`
- ur: `{first}، {second}`

'{first}، {second}' uses the Arabic comma U+060C plus a space, the Urdu enumeration separator. It has no 'اور', no ۔, and {first} comes before {second} in logical order. Byte-identical to ur withheld_reasons_join. Spoken only, so width and bidi don't apply; a screen reader reads logical order. The fold gives 'Payments، <waiting>، <on device>، <open>'. Clean.

## Findings

- **A-ur-1** MINOR `mobile.sidebar.row.on_device`: current `ڈیوائس {device} پر`. Proposed: Keep the text. Flag the row for a rendered RTL check on a ~200 dp row with a long Latin name. Reason: 10 characters of words around the name versus 3 in English. The leading ڈیوائس (6 letters plus a space) costs visible name width. It is still the right choice: list-row.tsx gives this Text no writingDirection, so iOS (NSWritingDirectionNatural) and Android (FIRSTSTRONG_LTR) both take the paragraph base from the first strong character (src/ui/direction.tsx:177-200). The shorter '{device} پر' would start with a Latin name, lay out with an LTR base and put پر on the wrong reading side. Not gating.

## Observation (not a translation finding)

- **R-ur-1** renderer: A device name ending in a neutral ('Pixel!', 'Mac (2)') has that neutral resolved to the RTL embedding direction and drawn on the wrong side of the name. Any catalogue placement has this problem, and policy forbids catalogue bidi controls. Fix at format time by isolating {device} (FSI/PDI or a nested Text). The device-line Text also carries no writingDirection style.

## Verdict

mobile.sidebar (ur): **PASSED**. 2 keys read, 1 findings (A-ur-1), 0 blocker/major. Mechanical evidence: audit.log.
