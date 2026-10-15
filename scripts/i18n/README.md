# Home i18n seed

This is an English-only seed, not complete mobile localization. It follows the
[accepted core contract](https://github.com/damianvtran/local-operator/blob/2115d3e1949889aed42f7b2afe65ffe4c81ed82b/docs/design/i18n.md)
and [contributor guidance](https://github.com/damianvtran/local-operator/blob/2115d3e1949889aed42f7b2afe65ffe4c81ed82b/docs/I18N.md).
No machine translation or new language setting is introduced. The backend's
existing configStore is the only connected-locale owner; route reset falls back
to English. Pre-connection copy is English in this seed, not device-localized.

## Author and check

- English source: `i18n/catalogues/en/mobile.home.json`.
- Per-key context: matching `.context.json`. `params` maps each argument to
  `string`, `number`, or `date`; `placeholders` gives each argument a translator
  explanation. Empty objects mean there are no arguments, not missing context.
  Role, tone, actual layout constraints and state/safety notes remain per-key.
- `node scripts/i18n/generate.ts` emits the typed map, source/context/config hash
  and two-overload Translator from that declared schema. It never parses ICU.
- `node scripts/i18n/generate.ts --check` detects drift without writing files.
- `node --test scripts/i18n/self-test.ts` runs dependency-free schema/eligibility
  counterfactuals. These checks alone do **not** establish ICU validity.
- `node scripts/i18n/check.ts` requires the exact installed FormatJS parser and
  Babel TS/JSX parser. It parses every source/enabled message, cross-checks real
  ICU arguments/types against context, rejects rich-text tags, verifies enabled
  namespaces/keys, and checks the six actual Home sinks through Babel's TS/JSX AST.
  Missing dependencies are a failure, never a reason to skip the AST gate.
- In an already-installed environment, `pnpm i18n:check` composes all three gates;
  CI runs it unconditionally in the existing Checks job after frozen install.
  Normal typecheck and unit tests additionally cover the adapter, generated type
  rejection matrix through the pinned TypeScript 7 CLI, and real configStore
  baseline/live/reset/unsubscribe behavior. TypeScript 7's root export is version
  metadata, not the legacy TypeScript 5 compiler API.

The runtime uses `intl-messageformat` 12.1.3, not a second ICU implementation.
Generation validation uses `@formatjs/icu-messageformat-parser` 3.5.21; the source
scope guard directly declares `@babel/parser` 7.29.9, already present in Expo's
locked dependency closure (no additional resolved packages).
Missing locale/namespace/key selects English **source, formatting locale and
LTR direction metadata**;
a key absent even in English degrades to its code. It does not swallow formatting
or missing-parameter errors as a successful translation. No catalogue downloads,
cache protocol or wire-envelope translation is added by this slice.

## Truthful enforcement boundary

Exactly six slots are completed: greeting, starting, disconnected composer reason,
refused-start **fallback body**, folders-read failure body, and connect-computer
button. `scope.ts` binds key declarations and render sinks, rejecting novel literal
replacements/extra content rather than maintaining a list of old English text.
It also checks live subscription hookup, splash translator propagation and the
composer memo's translator dependency. It has no mutable ceiling/baseline.

Suggestions remain model-facing English. Tips, other Home controls, alert titles,
retry action, auth/settings/session screens, native metadata, backend-provided
messages and the rest of the app are **not extracted or enforced** here. Tests
explicitly preserve outside-scope controls; do not report this as global coverage.

Only `en` is enabled/bundled. Urdu's `rtl` metadata is a held scaffold, not
I18nManager activation, native mirroring or RTL proof. Other locale activation
requires a later translation + independent audit/native evidence change; this
seed's full check intentionally rejects enabling another locale. It does not
consume or certify any core/relay/UI translation ledger as a native-mobile audit.
