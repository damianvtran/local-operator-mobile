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

**All thirteen `.txt` files in this directory carry this first line**, including
the ones whose whole content is a single field value:

```
DRAFT — not submitted. Remove this line before uploading to a store.
```

It is a marker, **not copy**, followed by one blank line and then the value.

Stripping it is **conditional, never positional**, and the two positional
spellings that look obvious are both wrong. Measured on this host (macOS 26,
`/usr/bin/head`, and GNU coreutils via `ghead`), on the now-marked
`android/metadata/en-US/title.txt`:

```
head  -n +3  ->  DRAFT — not submitted. … | | Local Operator    # keeps the marker
GNU head -n +3  ->  DRAFT — not submitted. … | | Local Operator   # same
tail  -n +3  ->  Local Operator                                # right here, until a file has no marker
conditional  ->  Local Operator                                # right always
```

- **`head -n +3` never strips anything.** Neither BSD nor GNU `head` reads `+3`
as "start at line 3"; both parse it as a count, so the filter prints the first
three lines and ships the marker line into the listing. (The "from line N" form
is `tail -n +N`, not `head`.)
- **`tail -n +3` is unconditional**, so it silently deletes the first two lines of
any file that carries no marker. Measured on an unmarked one-line `title.txt` it
returns an empty string, which would publish a Play listing with no app name.
That failure needs no marked file to happen: it is waiting for the next file
someone adds without the marker.

The filter therefore has to look at the first line and remove the marker only
when it is there. This awk program does that, and is the spelling the upload step
must use:

```sh
# Remove the DRAFT marker (and its blank separator) only when present.
strip_draft() {
  awk 'NR == 1 && /^DRAFT/ { dropped = 1; next }
       dropped && /^[[:space:]]*$/ { dropped = 0; next }
       { dropped = 0; print }' "$1"
}
```

The same rule is `strip_draft()` in the verification snippet below, so the
documented filter and the audited one cannot drift.

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

## Verification

Run this from the repository root. It prints, for every metadata file, the
marker state and the effective character count against the documented limit —
the counts in the table below are that script's output, not a hand count:

```sh
python3 - <<'PY'
import pathlib

LIMITS = {
    "ios/metadata/en-US/name.txt": 30,
    "ios/metadata/en-US/subtitle.txt": 30,
    "ios/metadata/en-US/keywords.txt": 100,        # bytes, not characters
    "ios/metadata/en-US/promotional_text.txt": 170,
    "ios/metadata/en-US/description.txt": 4000,
    "ios/metadata/en-US/release_notes.txt": 4000,
    "android/metadata/en-US/title.txt": 30,
    "android/metadata/en-US/short_description.txt": 80,
    "android/metadata/en-US/full_description.txt": 4000,
    "android/metadata/en-US/changelogs/default.txt": 500,
}

def strip_draft(text):
    lines = text.split("\n")
    if lines and lines[0].startswith("DRAFT"):
        lines = lines[1:]
        if lines and lines[0].strip() == "":
            lines = lines[1:]
    return "\n".join(lines)

store = pathlib.Path("store")
for rel, limit in LIMITS.items():
    raw = (store / rel).read_text(encoding="utf-8")
    marked = raw.splitlines()[0].startswith("DRAFT") if raw else False
    body = strip_draft(raw).rstrip("\n")            # effective copy, no trailing newline
    n = len(body.encode()) if "keywords" in rel else len(body)
    unit = "bytes" if "keywords" in rel else "chars"
    print(f"{'OK  ' if n <= limit else 'OVER'} {rel:48s} "
          f"marker={'yes' if marked else 'NO '} {n:5d}/{limit} {unit}")
PY
```

## Character limits, and what the draft currently uses

Limits are from
<https://developer.apple.com/help/app-store-connect/reference/app-information/app-information>
(App name 30, subtitle 30, keywords 100 **bytes**, promotional text 170,
description 4,000, "What's New" 4,000) and
<https://support.google.com/googleplay/android-developer/answer/9859152>
(title 30, short description 80, full description 4,000), both read 2026-09-29.
Play's changelog limit is 500 characters; F-Droid reads the same directory and
caps its changelog at 500.

**Counting convention:** a count is the copy **after** stripping the marker and
its blank separator, with the trailing newline removed — so a count matches
`wc -m` on the stripped file, and nothing is off by the final newline. Keywords
are counted in **bytes**, because that is what Apple limits.

| File | Limit | Draft | Headroom |
| --- | --- | --- | --- |
| `ios/name.txt` | 30 | 14 | 16 |
| `ios/subtitle.txt` | 30 | 28 | 2 |
| `ios/keywords.txt` | 100 bytes | 84 | 16 |
| `ios/promotional_text.txt` | 170 | 162 | 8 |
| `ios/description.txt` | 4,000 | 2,633 | 1,367 |
| `ios/release_notes.txt` | 4,000 | 367 | 3,633 |
| `android/title.txt` | 30 | 14 | 16 |
| `android/short_description.txt` | 80 | 65 | 15 |
| `android/full_description.txt` | 4,000 | 2,381 | 1,619 |
| `android/changelogs/default.txt` | 500 | 365 | 135 |

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

## Two copy rules this directory enforces

Both of these are the reason a sentence is worded the way it is, and both would
be easy to undo by accident in a later edit.

**1. The transcript travels; the project does not.** The relay is not
content-blind — it serves the session transcript, and on the Radient route that
traffic terminates at the Radient edge before it reaches the user's computer. So
no file here may say that nothing is uploaded. What *is* true, and what both
descriptions say, is that the agents and the user's files stay on the user's own
computer and no copy of the project goes anywhere. The section headed "What
travels to the phone" states the transcript path plainly, including which tunnel
it went through. Store metadata is read against the privacy policy by App Review
under 2.3.1 ("marketing your app in a misleading way"), so an unqualified
"nothing is uploaded" is a compliance risk, not just an inaccuracy.

**2. Every field's markup is its platform's, and only that.** The App Store
renders `description.txt` as **plain text**: `##` and `**bold**` would appear
literally on the product page, and would spend characters against the 4,000
limit for no effect. Play's `full_description.txt` takes the same treatment —
capitalised headings and blank lines, no markup. Line breaks survive on both.
Any future edit keeps the two files' wording in step but their formatting
platform-native.

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
