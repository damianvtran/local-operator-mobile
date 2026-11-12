# Hindi M2 remediation v2 — 2026-11-11

Translator: i18n-translator, session `7051988689fd`, ACTUAL served model `openai/gpt-6.1-sol` (session header); no fallback, no MT service. Lane: bounded fix (<2 h). Translation work and mechanical validation only; this is NOT an independent audit or a passed-ledger receipt. No repository catalogue, ledger, or code was edited or committed.

## Output

`hi.v2.json`: exactly 32 keys in keys32.json order, 12 of the previous 27 values changed, 5 new values added. SHA-256: `14a3d4b36c3fd2f09ef0ba7602251c4a2347a7acf650d965caf3cd490aa68510`.

Inputs: keys32.json, hi.v1.json, r1/audit-hi-A.md, r1/audit-hi-B.md in this directory; core i18n/style-guides/hi.md and i18n/glossary.md; core docs/I18N.md, docs/design/i18n.md; mobile docs/i18n.md. Read both audit reports before changing the candidate.

## Per finding

Counts below count A's six numbered findings and B's eight finding bullets (two B bullets cover multiple keys): **12 fixed, 2 declined**. These are candidate-file resolutions, not committed remediation claims.

| Finding | Decision | Evidence / response |
|---|---|---|
| A H-A-01, stream_connecting | fixed | `कनेक्ट हो रहा`, matching mobile.computers.badge.connecting verbatim; mobile.computers.connecting and mobile.chrome.home.connecting use this phrase with है…; core uses it 10 times by substring occurrence. |
| A H-A-02, host_answering | fixed | `{host} पर मौजूद आपके कंप्यूटर…` binds the host to the computer, not the waiting action. `रूट बन जाने का मतलब यह नहीं है कि कंप्यूटर चालू है।` restores है and states that route creation alone does not mean the machine is running. The wait panel's host-dependent branch is explanatory help, not a status enum. |
| A H-A-03, route_radient | fixed | `आपकी Radient टनल से कनेक्ट है` supplies the connection clause while retaining the source's possessive and feminine टनल agreement. The sibling directly connected clause already uses कनेक्ट है. |
| A H-A-04, below_labels / more_below | fixed | `नीचे: {labels} · स्क्रॉल करें ↓` has one नीचे, uses a colon to avoid agreement with arbitrary joined noun lists, preserves the placeholder and glyphs. `नीचे और भी है · स्क्रॉल करें ↓` adds idiomatic भी without inventing a row-specific noun. Call site builds labels from REGION_LABEL and joins with ` · `. |
| A H-A-05, narrow context pair | fixed | Both narrow forms now use the familiar reference abbreviation `संद.` for संदर्भ; narrow estimate uses `(अनुमान)` rather than a possibly ambiguous अनु. Widths measured below. Full-width forms unchanged. |
| A H-A-06, stream_idle | fixed | `आइडल` matches shipped relay.chrome.session.subtitle.idle verbatim; the former निष्क्रिय is used by mobile.schedules.state.dormant, a different state. Manager requests shipped state terms. |
| B bullet 1, more_below | fixed | Uses `नीचे और भी है`, idiomatic without requiring an explicit noun; rejected the suggested narrowing to पंक्तियाँ because the source merely says more. The clipped और है is gone. |
| B bullet 2, repeated direction / end | fixed | Removed second नीचे and removed ऊपर from end: `अंत · स्क्रॉल करें ↑`. Direction remains explicit via the arrow, as the source requires. |
| B bullet 3, connecting | fixed | Same resolution and independently recounted shipped keys as A H-A-01. |
| B bullet 4, idle / live | fixed | आइडल and ऑनलाइन, matching relay.chrome.session.subtitle.idle and relay.health.live. Live no longer borrows सक्रिय from the computer's active badge. All five stream enum values are distinct. |
| B bullet 5, narrow context | fixed | Both forms genuinely narrower, not merely the estimate. `संद.` is a recognizable standard abbreviation of संदर्भ, not an invented identifier. `(अनुमान)` retains estimate meaning without ambiguous अनु. |
| B bullet 6, provisioned / locative | fixed | रूट बन जाने replaces loose तैयार, and मौजूद binds host to the machine. Same combined revision as A H-A-02. |
| B bullet 7, stream_degraded no-change recommendation | declined | Binding manager decision and verified code path override the no-change recommendation: Settings statusFor health=`degraded` returns `Not answering`; source note says stream is open but not answering. Both it and status.not_answering now equal shipped relay.chrome.session.subtitle.not_answering `उत्तर नहीं दे रहा` verbatim. बाधित describes a disruption rather than this specific non-response state. |
| B bullet 8, English Back-to wiring | declined (code edit outside translator scope) | Read current worktree video.tsx and agent/[jobId].tsx: both still contain `Back to ${parentName}`. This is real on that checked worktree, not a defect in the Hindi fallback noun. Added the newly authorized back_to translation so the manager/coder can wire it; no claim that this translation-only file changes those callers. |

## Binding manager decisions / grammar probes

- `status.no_connection` is now `अभी तक कनेक्शन नहीं`, explicitly preserving “yet”; it differs from `status.offline` and `stream_offline` (`ऑफ़लाइन`).
- `status.not_answering` and `stream_degraded` are both exactly `उत्तर नहीं दे रहा`, copied from the shipped Hindi relay.chrome key after reading it; no different stream condition was found.
- Stream values: आइडल / कनेक्ट हो रहा / ऑनलाइन / उत्तर नहीं दे रहा / ऑफ़लाइन. No two states share a value.
- Connected-to: `{name} से कनेक्ट हो गया।` + fallback `आपके कंप्यूटर` → `आपके कंप्यूटर से कनेक्ट हो गया।`; real name `Atlas` → `Atlas से कनेक्ट हो गया।`. Hindi oblique plural/possessive form fits से.
- Back-to: `{name} पर वापस जाएँ` + session fallback `सत्र` → `सत्र पर वापस जाएँ`; real name `Atlas` → `Atlas पर वापस जाएँ`. सत्र is unchanged before पर; a quoted/proper session name remains unchanged. Polite imperative conforms to hi guide. The computer fallback belongs only to connected_to; the session fallback belongs to back_to/header. **No split-key request for Hindi.**
- video.title_fallback remains वीडियो, matching shipped mobile.session.highlights.video_open (`वीडियो {name} चलाएँ`).
- New inline label nouns: गतिविधि / उप-एजेंट / कार्य / स्थिति. Shipped session hints use कार्य and उप-एजेंट; settings.connection.status uses स्थिति. `नीचे: गतिविधि · उप-एजेंट · कार्य · स्थिति · स्क्रॉल करें ↓` avoids singular/plural copula or oblique inflection problems across joined lists.

## Shipped vocabulary recount (derived here, not copied audit counts)

Read every immediate *.json in mobile `src/i18n/catalogues/hi/` (22 files) and core `local_operator/i18n/catalogues/hi/` (37 files). Counts below are literal substring occurrences inside string values, not number of keys. Mobile/core respectively:

- कनेक्ट हो रहा: 4 / 10; जुड़ रहा: 1 / 0.
- आइडल: 1 / 8; निष्क्रिय: 1 / 1.
- ऑनलाइन: 1 / 1; सक्रिय: 7 / 5.
- उत्तर नहीं दे रहा: 1 / 3; वीडियो: 1 / 1; संदर्भ: 2 / 22.

The A report's core संदर्भ count of 8 is not the all-catalogue literal occurrence count measured here (22). This does not change terminology: mobile.chrome.composer.row_usage explicitly uses संदर्भ for the context window. A key-count probe also found core कनेक्ट हो रहा in 8 keys; counting occurrences rather than keys gives 10 because plural arms repeat it. These distinctions explain why a first count may surprise; no claim of audit error is needed.

## Width measurements

Executed `~/local-operator/.venv/bin/python` with `from rich.cells import cell_len` (the style guide requests cell measurement, not codepoint counts). At percent=42:

| Form | Measured cells |
|---|---:|
| full `42% संदर्भ` | 8 |
| short `42% संद.` | 7 |
| full estimate `42% संदर्भ (अनुमानित)` | 16 |
| short estimate `42% संद. (अनुमान)` | 14 |

Control `中` measured 2 cells. Narrow forms save 1 and 2 cells, respectively; neither equals its wide counterpart. No width exception needed. These are cell metrics, not RN pixel-layout or rendered proof; that remains an independent design/QA task.

## Glossary proposals / ambiguities

- Add narrow-display abbreviation: context संदर्भ → `संद.` only where the wide form is available in the same UI; keep संदर्भ everywhere else. This is the common citation abbreviation adapted to the established context term. Keep estimate `(अनुमान)` in narrow displays; avoid अनु. because it can be read as a different abbreviation.
- Activity → गतिविधि for the inline region noun. Shipped session hint कार्यरत पंक्ति describes the working row rather than naming activity as a noun; the source here explicitly asks for the noun.
- Preserve `सत्र` for title and back-navigation fallback; no oblique conflict here. No new glossary term for “not answering”: reuse the shipped phrase exactly.

## Validation actually executed

Candidate Python checks: 32 keys, exact source order, same ICU placeholder names per key, no empty values, NFC, no manual bidi/zero-width controls, and only English-identical value `Local Operator` (protected product name). None of these source messages contains plural/select ICU, so no plural arms were invented.

Repository baseline command, executed from the manager's mobile worktree: `npm run -s i18n:check`, exit 0:

```
src/i18n/catalogue.gen.ts is current (649 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
scanner sha256: base=fd5946dfe556d9f0161b6093ab9792ae2049758d1870a56a0d888e4d95154d5c head=cf05770fe3fa0ff57d974806f5eb48e0278e8e8785c7d785817548b7ce95b813
check-strings: 212 finding(s), all baselined; 0 new; verified historical debt vs d78ca8616286
```

Node emitted MODULE_TYPELESS_PACKAGE_JSON warnings, not validation errors. This repo command validates the existing worktree baseline, NOT this scratch candidate's integration: the manager must install the candidate, regenerate and rerun the catalogue check on the integrated head. No rendered evidence, release, independent audit, ledger passed status, or committed integration is claimed.
