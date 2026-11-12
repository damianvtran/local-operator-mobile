# M2 expression-literal slice — audit table and bundle manifest

PR scope: the 33 newly keyed strings (4 `mobile.computers`, 15 `mobile.session`,
14 `mobile.settings`) translated into the seven shipped locales. Translator for every
row: `i18n-translator`, `openai/gpt-6.1-sol`. Every auditor was `i18n-auditor`,
independent of the translator; the served model is the one each report states about itself.
Counts are B(locker)/M(ajor)/m(inor)/n(it), taken from the **reports themselves**, not
from a relayed summary.

| Locale | Round 1 (two independent auditors) | Candidate versions | Last round | Final-round verdict |
| --- | --- | --- | --- | --- |
| fr | A deepseek/deepseek-flash: changes-requested (0B/2M/2m/2n); B anthropic/claude-sonnet-5-5: changes-requested (0B/1M/3m/3n) | v1→v2→v3 (v3 addendum) | R2 anthropic/claude-sonnet-5-5 | clean-with-findings 0B/0M/1m/0n |
| es | A deepseek/deepseek-flash: changes-requested (0B/1M/3m/2n); B anthropic/claude-sonnet-5-5: clean-with-findings (0B/0M/3m/2n) | v1→v2→v3 | R2 anthropic/claude-sonnet-5-5 | clean-with-findings 0B/0M/1m/2n |
| zh-CN | A deepseek/deepseek-flash: changes-requested (0B/1M/0m/3n); B anthropic/claude-sonnet-5-5: clean-with-findings (0B/0M/2m/2n) | v1→v2→v3→v4 | R2 deepseek/deepseek-flash: changes-requested (1B key names/1M/2m/2n; fixed in v4) → R3 anthropic/claude-sonnet-5-5 | R3 clean-with-findings 0B/0M/1m/2n |
| ru | A deepseek/deepseek-flash: clean-with-findings (0B/0M/5m/3n); B anthropic/claude-sonnet-5-5: clean-with-findings (0B/0M/5m/4n) | v1→v2→v3 | R2 deepseek/deepseek-flash | changes-requested: 1B (four region-label key names, sidecar origin) / 0M / 3m / 1n. Values accepted; the report says the group is passed once the four names are renamed with values byte-identical. final.json carries exactly that rename (verified: the other 29 keys and the 4 values are byte-identical to v3). NO later round re-read the renamed file. |
| vi | A deepseek/deepseek-flash: changes-requested (0B/1M/1m/2n); B anthropic/claude-sonnet-5-5: changes-requested (0B/1M/3m/3n) | v1→v2→v3 | R2 anthropic/claude-sonnet-5-5 | clean-with-findings 0B/0M/1m/1n |
| ur | A deepseek/deepseek-flash: changes-requested (0B/1M/7m/1n); B anthropic/claude-sonnet-5-5: changes-requested (0B/1M/4m/3n) | v1→v2→v3 | R2 anthropic/claude-sonnet-5-5 | clean-with-1-NIT 0B/0M/0m/1n |
| hi | A deepseek/deepseek-flash: clean-with-findings (0B/0M/4m/2n); B anthropic/claude-sonnet-5-5: clean-with-findings (0B/0M/4m/3n) | v1→v2→v3→v4 | R2 deepseek/deepseek-flash: changes-requested (1B key names/1M stream_degraded/1m/3n; fixed in v4) → R3 anthropic/claude-sonnet-5-5 | R3 clean 0B/0M/0m/0n |

## Where this differs from the manager's summary

The reports win. Differences: ur R2 is 0 minor / 1 nit (summary: 1m/1n); zh-CN R3 is 1 minor / 2 nit
(summary: 1m/1n); hi round-1 B is 4 minor / 3 nit (summary: 5m/3n).

## ru has no post-rename round

ru's last audit, round 2, returned `changes-requested`; its only blocker was the four region-label
key names (`label.working` against the shipped `label_working`), which is a sidecar naming error, not
a wording error. The report states the group passes once those four names are corrected with values
byte-identical. `ru/m2-expression-literals/final.json` is that file. No auditor read the renamed file.
The same four-name rename was applied to fr, es, vi and ur, whose last audit also read the old names;
for those the values are byte-identical to the audited v3 (checked key by key). zh-CN and hi were
audited in their final form (v4 = final).

## IDENTICAL_BY_DESIGN entries this slice adds (each named by the audits)

app_name `Local Operator` (all seven; product name); fr `mobile.session.fallback_name` (`session`) and
`mobile.session.region.label_subagents` (`agents`), both cognates; vi `mobile.session.video.title_fallback`
(`Video`). (es and vi `mobile.session.tray.context_short` (`ctx`) were listed here when audited and are NOT any
more: see "Post-review remediation" below; the entries were removed from `catalogues.test.ts`.)

## Files

Per locale, `<locale>/m2-expression-literals/`: `round1-A.md`, `round1-B.md`, the later rounds, the translator's
`translator-vN-changes.md` dispositions, and `final.json` (the 33 values as applied). Home-directory prefixes
were normalised to `~` as in `ur/NOTE-paths.md` and trailing whitespace was stripped from the Markdown (so `git diff --check` is clean); no prose was rewritten. The table gives the SHA-256 of the
original file and of the committed bytes.

| File | original sha256 | committed sha256 |
| --- | --- | --- |
| `es/m2-expression-literals/final.json` | `7141a06ff9921b541db5a9cd61af53a6da8aacb1347cb843199dcd4a3ff84388` | `7141a06ff9921b541db5a9cd61af53a6da8aacb1347cb843199dcd4a3ff84388` |
| `es/m2-expression-literals/round1-A.md` | `b7280911befef6c3e4a4e29ab15921830a110ff220c4732ca07e5f73c784d9f3` | `b7280911befef6c3e4a4e29ab15921830a110ff220c4732ca07e5f73c784d9f3` |
| `es/m2-expression-literals/round1-B.md` | `e04c9c4dc453f631aac01fa0b8e25b7e67fdb8868fe39a0c681ca3c2222cc0c6` | `e04c9c4dc453f631aac01fa0b8e25b7e67fdb8868fe39a0c681ca3c2222cc0c6` |
| `es/m2-expression-literals/round2.md` | `e6a2d9a2d65e7b030dd33199857b699517f00a00746c75864d6148b5d9cf2e6c` | `e6a2d9a2d65e7b030dd33199857b699517f00a00746c75864d6148b5d9cf2e6c` |
| `es/m2-expression-literals/translator-v2-changes.md` | `a2199adefa762b8c63d9776dc13dbb64fa8c51b18012ab972d57b348cdf7e4db` | `a2199adefa762b8c63d9776dc13dbb64fa8c51b18012ab972d57b348cdf7e4db` |
| `es/m2-expression-literals/translator-v3-changes.md` | `c8d95d3f42d8f25b6dc5f8397f6a7bc3cd95b804c72f07dd4fd39e71cc443b65` | `c8d95d3f42d8f25b6dc5f8397f6a7bc3cd95b804c72f07dd4fd39e71cc443b65` |
| `fr/m2-expression-literals/final.json` | `1db648167ce217cbacc3cc35a805ffece233627141180c2813dd2a525ab7c0bf` | `1db648167ce217cbacc3cc35a805ffece233627141180c2813dd2a525ab7c0bf` |
| `fr/m2-expression-literals/round1-A.md` | `75536bffdd482e7109cb1a574c571b2922ad9bbbe19a2716804478c9c76a50f9` | `75536bffdd482e7109cb1a574c571b2922ad9bbbe19a2716804478c9c76a50f9` |
| `fr/m2-expression-literals/round1-B.md` | `7b4f50abb3dfd26580c86c12fd92b7390ad630e00a0ccdf85fe25f6965ee790a` | `7b4f50abb3dfd26580c86c12fd92b7390ad630e00a0ccdf85fe25f6965ee790a` |
| `fr/m2-expression-literals/round2.md` | `73392fe598bdd5baf0530ba67d45d3f149761681c257d36224aaf3b983f78fcd` | `73392fe598bdd5baf0530ba67d45d3f149761681c257d36224aaf3b983f78fcd` |
| `fr/m2-expression-literals/translator-v2-changes.md` | `7f50e10bd75cf0137f4e013f800ed3ed7ee25aabaec74626f49fbd240fef25c1` | `b5bd9230c256d5aa5c507c6d58cb70a8f4b0b4854398b735b8cb843d5f17e525` |
| `fr/m2-expression-literals/translator-v3-changes.md` | `b97b17255742a466d5d6547d84e6485dc64fd04da0f5cf742f883024f2f85ced` | `b97b17255742a466d5d6547d84e6485dc64fd04da0f5cf742f883024f2f85ced` |
| `hi/m2-expression-literals/final.json` | `86311dcd4ae93be093bf2e87f873ba33fc57e1a27d2e615df621606488a748cf` | `86311dcd4ae93be093bf2e87f873ba33fc57e1a27d2e615df621606488a748cf` |
| `hi/m2-expression-literals/round1-A.md` | `8b7b67c3dfc31a13b23652dd108660dd026dd0223b3f81f221978c54c1c08bf7` | `8b7b67c3dfc31a13b23652dd108660dd026dd0223b3f81f221978c54c1c08bf7` |
| `hi/m2-expression-literals/round1-B.md` | `1a347c87872cc6c9144f78948dcb46eeddf3b68e299deb0f781372d3cb91c3ed` | `1a347c87872cc6c9144f78948dcb46eeddf3b68e299deb0f781372d3cb91c3ed` |
| `hi/m2-expression-literals/round2.md` | `885a2de3c5330b4f3ea0e1c49803d9f1e96922a1dd10f0f3fea1e8574344bff5` | `885a2de3c5330b4f3ea0e1c49803d9f1e96922a1dd10f0f3fea1e8574344bff5` |
| `hi/m2-expression-literals/round3.md` | `44cc0a1d694261892ef1b208b6925b1649af33801ddb07ed039bd0de2a00d264` | `44cc0a1d694261892ef1b208b6925b1649af33801ddb07ed039bd0de2a00d264` |
| `hi/m2-expression-literals/translator-v2-changes.md` | `a636b87e094c6bc49b01839648fc060128ca5cd8e1a1cfba53a68675a3ee87bb` | `a636b87e094c6bc49b01839648fc060128ca5cd8e1a1cfba53a68675a3ee87bb` |
| `hi/m2-expression-literals/translator-v3-changes.md` | `866fe0a93082221098b044cd154193e30194ebf6d48f31dee6671dbda89feea6` | `866fe0a93082221098b044cd154193e30194ebf6d48f31dee6671dbda89feea6` |
| `hi/m2-expression-literals/translator-v4-changes.md` | `2eb270a085fd67de6f968a2f33c87f028b6418faaaf99c45421ff3079be44a29` | `2eb270a085fd67de6f968a2f33c87f028b6418faaaf99c45421ff3079be44a29` |
| `ru/m2-expression-literals/final.json` | `b6b8afeb87ec8f94d038628eaadabed1b2e1084ea09b9ac5cd2583025ab6f93d` | `b6b8afeb87ec8f94d038628eaadabed1b2e1084ea09b9ac5cd2583025ab6f93d` |
| `ru/m2-expression-literals/round1-A.md` | `eb39f4acc2a8620068e5322a6148dffd6a0a98c4efda89b38ef1bef65c95ddf6` | `eb39f4acc2a8620068e5322a6148dffd6a0a98c4efda89b38ef1bef65c95ddf6` |
| `ru/m2-expression-literals/round1-B.md` | `26c645f9c4c9048779b0bd3656f92adc959bb9788c08c48158bdd30fa0f8eac8` | `26c645f9c4c9048779b0bd3656f92adc959bb9788c08c48158bdd30fa0f8eac8` |
| `ru/m2-expression-literals/round2.md` | `9dc975c003f7189eb937356f6d472632e6305e6347f7b87c19da1b3f2aa83ceb` | `74552351b54985aa3063df346c877bfa44387b181de69ce6f7d9f773645f9e27` |
| `ru/m2-expression-literals/translator-v2-changes.md` | `92958a6efa2212373056eaf3ff931fbfc5a1bf2fe9b4a5a0168d5cd2984f5bbe` | `92958a6efa2212373056eaf3ff931fbfc5a1bf2fe9b4a5a0168d5cd2984f5bbe` |
| `ru/m2-expression-literals/translator-v3-changes.md` | `c78a4b694ea45dc9ca458bd95e74ea24773264b2b6bf4fd5e76e54fbf62c532e` | `c78a4b694ea45dc9ca458bd95e74ea24773264b2b6bf4fd5e76e54fbf62c532e` |
| `ur/m2-expression-literals/final.json` | `0e2d233310ad774bc2da4beafa6ca34da46d16f641772e93768e359191f1dc2b` | `0e2d233310ad774bc2da4beafa6ca34da46d16f641772e93768e359191f1dc2b` |
| `ur/m2-expression-literals/round1-A.md` | `0d1d5648127af3af0a5eac2af1407785dcb36f73e17a22e16b0e7fb511d427ad` | `0d1d5648127af3af0a5eac2af1407785dcb36f73e17a22e16b0e7fb511d427ad` |
| `ur/m2-expression-literals/round1-B.md` | `27bb215982e5a451ce612d5c12ab3a23e92fbadf33afb7eb962e19d8c5f7ff82` | `fb651e2bcf8d1729a3319171f28cba8c8aaef76835a24c8c4365542f61fb68c8` |
| `ur/m2-expression-literals/round2.md` | `4fb8b5bc5f65646cc6024afbe161dab1a440beed37104210624cfe7079701959` | `4fb8b5bc5f65646cc6024afbe161dab1a440beed37104210624cfe7079701959` |
| `ur/m2-expression-literals/translator-v2-changes.md` | `7eb906363d16564c75856da4503b10513f14281f90ad6caa78244649a64dfca4` | `7eb906363d16564c75856da4503b10513f14281f90ad6caa78244649a64dfca4` |
| `ur/m2-expression-literals/translator-v3-changes.md` | `1d788b6bc6b6fba284ffc7670793dd36a1f6fa26ac1016803f8cbc3a6d53868a` | `1d788b6bc6b6fba284ffc7670793dd36a1f6fa26ac1016803f8cbc3a6d53868a` |
| `vi/m2-expression-literals/final.json` | `8c2000826acfd005134aef377931167c362fdca5a16f717a0d32abbc2b9ec97f` | `8c2000826acfd005134aef377931167c362fdca5a16f717a0d32abbc2b9ec97f` |
| `vi/m2-expression-literals/round1-A.md` | `03a293cd875a6fd67892ea9882dcc223528c3efc5926cd6ac465385cb799f15d` | `03a293cd875a6fd67892ea9882dcc223528c3efc5926cd6ac465385cb799f15d` |
| `vi/m2-expression-literals/round1-B.md` | `8db1e6c2bcb7208f5a9482de40c7f66b5ebea819658f102c262598d7c5add4dc` | `8db1e6c2bcb7208f5a9482de40c7f66b5ebea819658f102c262598d7c5add4dc` |
| `vi/m2-expression-literals/round2.md` | `08c824ff8fe7a905b13401e649c2feb60f5573fb808712a4b8b6ddae486ad5d8` | `08c824ff8fe7a905b13401e649c2feb60f5573fb808712a4b8b6ddae486ad5d8` |
| `vi/m2-expression-literals/translator-v2-changes.md` | `ce4023af8c175fb679213bd8a0231c03b2bd9606d2c6db17cec5a2538967a8c3` | `ce4023af8c175fb679213bd8a0231c03b2bd9606d2c6db17cec5a2538967a8c3` |
| `vi/m2-expression-literals/translator-v3-changes.md` | `19f06607dbd4dfa44d388e9b7e9be8afbc271a1e9a39f512341533e8a46a97b7` | `19f06607dbd4dfa44d388e9b7e9be8afbc271a1e9a39f512341533e8a46a97b7` |
| `zh-CN/m2-expression-literals/final.json` | `14902070cb57b05d0cf776adabe1a3d74198391c837eb7be91b85633faaba739` | `14902070cb57b05d0cf776adabe1a3d74198391c837eb7be91b85633faaba739` |
| `zh-CN/m2-expression-literals/round1-A.md` | `2485be14de0ecdddcd7b15870a1a05eb2617b8ae1be8331784a6d383999d1566` | `2485be14de0ecdddcd7b15870a1a05eb2617b8ae1be8331784a6d383999d1566` |
| `zh-CN/m2-expression-literals/round1-B.md` | `980c87d5b7cee232842bae847134f0b13e4a4b84bcc5f5427ac5238c41aea980` | `980c87d5b7cee232842bae847134f0b13e4a4b84bcc5f5427ac5238c41aea980` |
| `zh-CN/m2-expression-literals/round2.md` | `eaf283503740d6bbb3a6a7d96c2ba886e21723aac90199862fa8c7f3194ccdb7` | `eaf283503740d6bbb3a6a7d96c2ba886e21723aac90199862fa8c7f3194ccdb7` |
| `zh-CN/m2-expression-literals/round3.md` | `9e41c7cc9c9d0aa761288d0b96c539fdcf97f88bff885f805b2f54b739740f25` | `9e41c7cc9c9d0aa761288d0b96c539fdcf97f88bff885f805b2f54b739740f25` |
| `zh-CN/m2-expression-literals/translator-v2-changes.md` | `14f52ad475d56956899ca5af3406ad8c5e742ca6784e0f8f27f6989f04f034bb` | `14f52ad475d56956899ca5af3406ad8c5e742ca6784e0f8f27f6989f04f034bb` |
| `zh-CN/m2-expression-literals/translator-v3-changes.md` | `0ae00581180175abd30f8954417f15a32833126d1842b957ca5c1374e83964e2` | `0ae00581180175abd30f8954417f15a32833126d1842b957ca5c1374e83964e2` |
| `zh-CN/m2-expression-literals/translator-v4-changes.md` | `e38e351049d1b504c4a5cc16e52ebe0cf65e42a6ca9334f3c15c2fa140e3f2ef` | `616a03192efb66c80cf7af017063c86ddb26bfa60d7b16f69a76464137459043` |

## Post-review remediation, round 1 (after the audits above)

The `final.json` files and audit reports above are the AUDITED record and are not edited. Design review and the
shipped-bytes re-audits then found English tokens or a case slip in the following shipped values. Each change is a
mechanical copy of an already-audited string (or a case change); no new wording was written.

| Locale | Key | Was (audited) | Now (shipped) | Why |
| --- | --- | --- | --- | --- |
| es | `mobile.session.tray.context_short` | `{percent}% ctx` | `{percent}% de contexto` | English `ctx` left (design D1); copy of the audited full form |
| es | `mobile.session.tray.context_short_estimate` | `{percent}% ctx (aprox.)` | `{percent}% de contexto (aprox.)` | same; copy of the audited full estimate form |
| vi | `mobile.session.tray.context_short` | `{percent}% ctx` | `{percent}% ngữ cảnh` | same (also closes the vi re-audit F1/F2 about 2-digit widths) |
| vi | `mobile.session.tray.context_short_estimate` | `{percent}% ctx (ước tính)` | `{percent}% ngữ cảnh (ước tính)` | same |
| fr | `mobile.settings.diagnostics.stream_degraded` | `Ne répond pas` | `ne répond pas` | sidecar prescribes a lower-case word and its siblings are lower-case |
| es | `mobile.settings.diagnostics.stream_degraded` | `No responde` | `no responde` | same |
| ru | `mobile.settings.diagnostics.stream_degraded` | `Не отвечает` | `не отвечает` | same |
| vi | `mobile.settings.diagnostics.stream_degraded` | `Không phản hồi` | `không phản hồi` | same |

Why the short context form may equal the full one: the designer measured that it only renders in full-width rows
(More sheet Context row, status sheet; value cell 318 pt at 390 pt), so the "narrow" brevity the sidecar once
described is not needed. The sidecar note now says so. **fr keeps `ctx`** (`{percent} % ctx`): it reads as the French
abbreviation of « contexte » and the designer did not gate it — recorded as an allowed exception. hi, ru, ur and
zh-CN already carry native short forms (no Latin token). zh-CN's estimate short form (`（约）`) differs from its full
form (`（估算）`); that audit MINOR is deferred, not changed.

`stream_degraded` in hi, zh-CN and ur is not an issue: those scripts have no letter case.

### Manifest column note

In the table above, `original sha256` and `committed sha256` differ for exactly four files —
`fr/…/translator-v2-changes.md` (7f50e10b… → b5bd9230…), `ru/…/round2.md` (9dc975c0… → 74552351…),
`ur/…/round1-B.md` (27bb2159… → fb651e2b…) and `zh-CN/…/translator-v4-changes.md` (e38e3510… → 616a0319…) — which is consistent with
the `~` path normalisation and trailing-whitespace strip described under "Files" (I could not re-derive the originals, which are not in the tree), not a corrupted copy. The
**committed** column was recomputed against the tracked bytes of every row at this commit and matches all of them; an
auditor comparing the *original* column to the tracked file will see a mismatch for those four rows by construction.
(The two `es` translator files lost their `.md` extension when first committed; they are renamed here, bytes unchanged.)

### Shipped-bytes re-audit records (added with the round-1 remediation)

Seven independent re-audits of the bytes that shipped at PR head `3af477ee`, copied from each auditor's session scratch unchanged except for trailing-whitespace stripping. The `target` hashes quoted in them cover the 33 values as shipped AT THAT HEAD; the remediation table above changes es, fr, ru and vi, so the current hashes are listed below (computed here; `sorted-key JSON of the 33 pairs`, compact, UTF-8 — fr's auditor used default `json.dumps` separators).

| File | original sha256 | committed sha256 |
| --- | --- | --- |
| `es/m2-expression-literals/reaudit-shipped-3af477ee.md` | `6812059386d93f3978b3432680ffa4a2a8040c64b5ea7992d79f60e4f344bdb4` | `6812059386d93f3978b3432680ffa4a2a8040c64b5ea7992d79f60e4f344bdb4` |
| `fr/m2-expression-literals/reaudit-shipped-3af477ee.md` | `63fdc027bc368c39f27c43496a158d26348c29420e3063f18df5a080048c7c62` | `63fdc027bc368c39f27c43496a158d26348c29420e3063f18df5a080048c7c62` |
| `hi/m2-expression-literals/reaudit-shipped-3af477ee.md` | `88901e2e6345318279431d50144dc414cc40d8adf50231349a6c814bd9ecb14b` | `88901e2e6345318279431d50144dc414cc40d8adf50231349a6c814bd9ecb14b` |
| `ru/m2-expression-literals/reaudit-shipped-3af477ee.md` | `658ff66a7b264f07b5b4c378aed817d3f7eeb77ddfacff12ed0015402d8bc971` | `658ff66a7b264f07b5b4c378aed817d3f7eeb77ddfacff12ed0015402d8bc971` |
| `ur/m2-expression-literals/reaudit-shipped-3af477ee.md` | `fb8503fd0ee2d0963cda865072af5f725a0989eeed2842fbb3fe9ec27f5b97f6` | `fb8503fd0ee2d0963cda865072af5f725a0989eeed2842fbb3fe9ec27f5b97f6` |
| `vi/m2-expression-literals/reaudit-shipped-3af477ee.md` | `dd827681c41d481912f510f4381953f53e767c4da80e28ae16d2343fc420b93e` | `dd827681c41d481912f510f4381953f53e767c4da80e28ae16d2343fc420b93e` |
| `zh-CN/m2-expression-literals/reaudit-shipped-3af477ee.md` | `4e55d72fbb85ce75e2f9c26631b6730a62a86a70e7f997e9d995fb067238b8e7` | `4e55d72fbb85ce75e2f9c26631b6730a62a86a70e7f997e9d995fb067238b8e7` |

| Locale | target sha256 at `3af477ee` (as quoted by the re-audit) | target sha256 now |
| --- | --- | --- |
| es | `ecaca715387c48c447d1d98a6464337b4c25dd320ac8ee2a8116816978149417` | `987ad1d7457dfbf788d63c67ce77d4693cf79f397077806d4068d85da3422097` |
| fr | `9aecf8f17941b4a1a7dac4c363ba40d7ad82572b61a05f41b8ad1f9d9c18ae0f` | `b9b0983185785a946c134b60994062a76bab8dfbd19cda325c9450bebf892860` |
| hi | `e36177c90748fb8473929dd1f3aebbd2ba15850cb8712db94413b6c374cd8ea0` | `e36177c90748fb8473929dd1f3aebbd2ba15850cb8712db94413b6c374cd8ea0` (unchanged) |
| ru | `4e76a2e0f98de6ab309777dceddd9556979c71754f3894b511a50cc8bb7c7dae` | `794ce68d7fb53dbe4baf4ae77af896440915c1bc4a2447d986ce657f563f1469` |
| ur | `fe3e3520bcda0baa785a598f74974a8a7abd4bba06a306aa2dfa5e020f9df737` | `fe3e3520bcda0baa785a598f74974a8a7abd4bba06a306aa2dfa5e020f9df737` (unchanged) |
| vi | `3b48c60e64c1d896884a40dddd9d748e3bb3061d7bc15c4b45d4f9eaf570d009` | `582f144d164294a9723535a3c2808f828b165c33c9e23f4e2e97fa160c5c9e5f` |
| zh-CN | `7eb211fa65966ee1e15bb5ddd6457a84d43177fc51218f8c746c0bd5016e15fc` | `7eb211fa65966ee1e15bb5ddd6457a84d43177fc51218f8c746c0bd5016e15fc` (unchanged) |
