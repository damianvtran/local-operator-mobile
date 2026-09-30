# Store metadata

Listing copy for the App Store and Google Play, in the directory layouts the
`fastlane` tools expect, so the copy is reviewed in a pull request instead of
being typed into a console.

**Everything in this directory is DRAFT.** None of it has been submitted, and
none of it describes shipped functionality: this repository is at the research
and design stage and the app does not exist yet. Every feature named below is
planned. The copy therefore makes no claim about what the app currently does —
it describes what the app is being built to do, in the voice the product uses.

## The `DRAFT:` marker

Every `.txt` file in this directory starts with this line:

```
DRAFT — not submitted. Remove this line before uploading to a store.
```

It is a marker, **not copy**. Whoever wires the upload must strip it (a `head -n
+3` or an equivalent line filter before `deliver`/`supply`), and the character
counts in this README are counted **without** it. The marker exists because a
listing that ships draft copy is worse than a listing that is late.

## Layout

```
store/
├── README.md                                  this file
├── ios/
│   └── metadata/
│       └── en-US/                             fastlane `deliver`
│           ├── name.txt                        App Store name
│           ├── subtitle.txt
│           ├── keywords.txt                    comma-separated
│           ├── promotional_text.txt
│           ├── description.txt
│           ├── release_notes.txt               "What's New in this Version"
│           ├── support_url.txt
│           ├── marketing_url.txt
│           └── privacy_url.txt
└── android/
    └── metadata/
        └── en-US/                             fastlane `supply`
            ├── title.txt
            ├── short_description.txt
            ├── full_description.txt
            └── changelogs/
                └── default.txt                "What's new" fallback
```

`changelogs/default.txt` is the fallback Play uses when no file matches the
version code. Once version codes are fixed, add `changelogs/<versionCode>.txt`
alongside it — the filename must equal the version code **exactly**, with no
padding (see `docs/publishing/other-channels.md` § 4 for the F-Droid equivalent,
which reads the same directory).

## Character limits, and what the draft currently uses

Limits are from
<https://developer.apple.com/help/app-store-connect/reference/app-information/app-information>
(App name 30, subtitle 30, keywords 100 **bytes**, promotional text 170,
description 4,000, "What's New" 4,000) and
<https://support.google.com/googleplay/android-developer/answer/9859152>
(title 30, short description 80, full description 4,000), both read 2026-09-29.
Play's changelog limit is 500 characters; F-Droid reads the same directory and
caps its changelog at 500.

| File | Limit | Draft | Headroom |
| --- | --- | --- | --- |
| `ios/name.txt` | 30 | 14 | 16 |
| `ios/subtitle.txt` | 30 | 28 | 2 |
| `ios/keywords.txt` | 100 bytes | 84 | 16 |
| `ios/promotional_text.txt` | 170 | 162 | 8 |
| `ios/description.txt` | 4,000 | 2,295 | 1,705 |
| `ios/release_notes.txt` | 4,000 | 368 | 3,632 |
| `android/title.txt` | 30 | 14 | 16 |
| `android/short_description.txt` | 80 | 65 | 15 |
| `android/full_description.txt` | 4,000 | 2,049 | 1,951 |
| `android/changelogs/default.txt` | 500 | 366 | 134 |

Two of those numbers move as the copy is finished:

- **keywords** is measured in **bytes**, not characters, and the limit is 100.
  The draft is plain ASCII, so bytes and characters agree; the moment an accent
  or a non-Latin keyword is added they stop agreeing.
- **subtitle** has 2 characters of headroom. Treat it as full.

## Placeholders, and the URLs that are real

| Field | Value | Status |
| --- | --- | --- |
| `ios/privacy_url.txt` | `https://radienthq.com/privacy-policy` | **Real, verified live 2026-09-29.** It covers "the Radient software, applications and services". Legal must confirm it covers this mobile client by name before submission — see item A7 in `docs/publishing/checklist.md` |
| `ios/support_url.txt` | `https://github.com/damianvtran/local-operator-mobile/issues` | Placeholder-shaped but real once the repository is public. **Apple requires the support URL to lead to actual contact information** (a legal address, an email address or a telephone number), so a GitHub issue tracker alone is a review risk; a support page with a contact address is the safe answer |
| `ios/marketing_url.txt` | `https://local-operator.com` | Real, verified live 2026-09-29 |
| Android equivalents | — | Play takes the privacy policy URL and the support contact in Play Console rather than as files, so there is nothing to place here |

## The voice these strings are written in

The copy follows the product's own voice rules —
`~/local-operator-site/docs/design-kit/voice.md`, which is the derived form of
`docs/copy.md` § 0 — because a store listing is the most-read surface the
product has, and the fastest place for a claim to become a liability.

In practice that means:

- **Second person, present tense, active.** "Drive the agent sessions running on
  your computer", not "a powerful solution for agent orchestration".
- **One idea per sentence.** Short sentences, full stops.
- **No adjectives doing a verb's job.** Every claim is checkable against a
  feature or a file. Nothing is called seamless, robust, effortless or
  intelligent.
- **No exclamation marks, no em-dash-and-colon headlines, no triplets.**
- **Honesty about state.** The copy says what the app needs (a computer running
  Local Operator, a relay, a tunnel) rather than presenting the happy path only.
- **No testimonials, no customer names, no download counts, no star counts, no
  benchmark numbers, nothing about being the best.** None of those are verifiable
  and all of them are banned by the voice rules.
- **No store-claim the product cannot keep.** Nothing promises a feature that is
  not on the planned list in the repository README.

Checked mechanically before committing: zero banned words from the voice rules'
banned lists, zero exclamation marks, zero em dashes in the copy itself.

## What is deliberately not in the copy

- **No prices, no trial, no subscription language.** The app sells nothing; the
  tunnel is set up on the computer. See item A9 in
  `docs/publishing/checklist.md` and Guideline 3.1.3(f) in
  `docs/publishing/apple-app-store.md` § 3.6 — the moment the listing or the app
  points at a purchase, that exemption stops applying.
- **No "coming soon"** in the shipped fields. A store listing describes the app
  being submitted, not the roadmap; the roadmap lives in the repository.
- **No mention of Radient credits or pricing.**
