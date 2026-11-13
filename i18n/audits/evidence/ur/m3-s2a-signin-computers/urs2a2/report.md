# Urdu (ur, RTL) — M3 S2a delta re-audit, round 2

- Auditor: lopdev `i18n-auditor`, session `878ef905a5e5`, model **anthropic/claude-opus-5-5** (session header; no fallback seen). Not the translator (jobs 0c099a230364 / 2d6ccc470551) and not the round-1 auditor (2789360243a7).
- Inputs (sha256 recomputed, all MATCH): brief `e64f41af7e262a49a92ddf6a2f9fe519bc046c771833ca58a2d622dfeeeba563` · v1 `c19ceeb75f6b3172046d0c00a3022eb9df54ff0127a4d8fe26d892378e4af464` · v2 `813cb4cddd2dadda568e57d42aae045874ccd9a20c6caf22f41e0ef4919455ff`.
- Scope: the delta v1→v2 only. I did not re-audit unchanged keys; the equality proof covers them. No MT or translation service used.

## Verdict
**Copy: PASSED.** 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. U1–U4 are resolved.
**Isolates:** they work technically and do no harm in this mobile app. They conflict with written policy, so this is a **policy question for the programme manager** (see §3). It is kept separate from the copy verdict.

## 1. Mechanical
- v1, v2 and brief are valid JSON with the same 37 keys in the same order. Exactly **8** values changed, and they are the 8 keys the notes list.
- Isolate keys: `insecure_allow`, `insecure_allowed`, `insecure_off_help`, `unencrypted_body`. With U+2066/U+2069 removed, each one equals v1 byte for byte. No other value contains a Cf or bidi control.
- The changed keys have no placeholders in either language. Latin-initial values: **0 of 37**. Redaction: 0 on any input. One harness display mask appeared on my own eval echo; the data is intact.

## 2. Copy changes (four keys)
| key | result | note |
|---|---|---|
| `mobile.computers.banner.unreachable_empty` | accept | «فہرست لانے کے لیے» supplies the purpose verb; meaning, آپ, Radient kept, ۔ terminal. |
| `mobile.computers.own_tunnel.intro` | accept | calque removed («اس میں کہیں بھی»); «اختیار» now only names the opt-in; single «کے ذریعے». 'you control'→'you run yourself' acceptable for a tunnel client. |
| `mobile.computers.own_tunnel.step_publish` | accept | says where («انٹرنیٹ پر»); no numeral, no full stop. |
| `mobile.computers.own_tunnel.insecure_allow` | copy equal to v1 (accepted R1); isolates only — see isolate_ruling | v1 copy + LRI/PDI only |
| `mobile.computers.own_tunnel.insecure_allowed` | copy equal to v1 (accepted R1); isolates only — see isolate_ruling | v1 copy + LRI/PDI only |
| `mobile.computers.own_tunnel.insecure_off_help` | copy equal to v1 (accepted R1); isolates only — see isolate_ruling | v1 copy + LRI/PDI only |
| `mobile.computers.own_tunnel.unencrypted_body` | copy equal to v1 (accepted R1); isolates only — see isolate_ruling | v1 copy + LRI/PDI only |
| `mobile.computers.own_tunnel.security_heading` | accept | object «اسے» restored; parallel with step_publish; no full stop. |

Glossary check: ریلے is used per the glossary. ٹنل, پتہ/پتے, چسپاں and دستیاب are each used consistently across the file. «اختیار» now refers only to the opt-in, so the U2 clash is gone. Every value uses آپ. Prose ends with ۔ and headings have no full stop.

## 3. Isolate ruling (technical; the policy is not decided here)
1. **Does the mobile app wrap whole strings in FSI/PDI? No.** `src/i18n` (runtime.ts, messages.ts, index.ts, direction.ts) never emits U+2066–2069. Direction is set as a Yoga `direction` style and an HTML `dir` attribute (`src/ui/direction.tsx`), and LTR content is isolated per component (`LTR_TEXT`/`LTR_WRITING`). The core guide's premise that strings are "double-applied" therefore does not hold in mobile.
2. **Is there double-application or harm? None in mobile.** I also tested an outer FSI…PDI around v2: the inner LRI…PDI nests correctly and the token stays `http://`.
3. **Do the isolates fix the reorder? Yes, measured.** I laid each string out in CoreText (CTLine with RTL base, macOS 27.2, Apple's text stack) and read back the visual order:
   - v1: the token renders as `//:http` / `//:https` in all 4 keys, which reproduces R2.
   - v2: the token renders as `http://` / `https://` in all 4 keys.
   - Wrapping v1 in a whole-string FSI does **not** fix it. A core-style wrapper would not cover this defect either.
   - Android was not measured. I expect platform ICU bidi to honour isolates there, but that is reasoned, not observed.
4. **Is there a cleaner render-side alternative? Yes.** Isolate URL-scheme and LTR runs with LRI…PDI in code, inside the RTL format path. That is one place, needs no catalogue change and no re-translation. A second option is a `{scheme}` placeholder that the call site fills with an isolated value; that means re-translating 4 keys in every locale. Nested `<Text dir="ltr">` only works on web (RNW emits `<span dir="ltr">`). It cannot reach Button's string `label`, and `writingDirection` applies per paragraph on native (reasoned, not measured).
5. **Policy conflict, for the programme manager to decide.** Two documents forbid controls in catalogue values: core `i18n/style-guides/ur.md` § RTL & bidi, and mobile `docs/i18n.md:107` ("No manual bidi control characters in a catalogue value, in any locale"). Nothing enforces this mechanically: there are no checks in `scripts/i18n` or `src/i18n/__tests__`. The choice is to (a) accept the isolates as a recorded exception, or (b) move isolation into the render path above and ship values identical to v1. In both cases the bytes the user sees are the same.

## 4. Round-1 items
U1–U4: resolved. R1 and R3 are code-side, and those values are unchanged. R2 is handled in the catalogue by the isolates; its policy question is open (§3).
