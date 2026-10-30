# Delta re-audit — `mobile.schedules` (`vi30s1r2`)

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. All three round-1 findings
(`VI-B-S1` MINOR, `VI-B-S2` and `VI-B-S3` NITs) are resolved **byte-exactly**; the fix
introduced no new finding.

- **Audited head:** `fb4d8bcbc50c68301af624407e09b1789896e571` on `feat/i18n-vietnamese` (round 1 audited `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b`).
- **Worktree:** `/Users/damian/workspace/vi-wave`. The vi catalogue is **tracked** at this
  head (it was untracked scratch at round 1), so the audited bytes are now identified by
  both the commit and the SHA-256 below.
- **Auditor:** `i18n-auditor` (lopdev team), session `bb04cc6cb19a`; **actual model
  `radient/auto`** after three provider-quota fallbacks
  (`anthropic/claude-sonnet-5-5 -> openai/gpt-6-astra -> kimi/k3.1-pro -> radient/auto`),
  all before this round's first command. Independent of the translator (agent/session; the
  translator's model is not visible, so model diversity is not claimed). No human
  native-speaker review; no rendered UI frame.
- **Round-1 record:** `i18n/audits/evidence/vi/mobile.schedules/vi30s1/record.json`.

## Delta scope — proved, not assumed

| Step | Command | ACTUAL result |
|---|---|---|
| Round-1 target hash | `sha256(src/i18n/catalogues/vi/mobile.schedules.json)` at `vi30s1` | `2981717f…b5154f8` |
| Shipped target hash | same file at `fb4d8bcbc50c68301af624407e09b1789896e571` | `69ad8d48…987e9ec` |
| Only the prescribed keys changed | restore the three findings' round-1 `current` values, re-serialise, hash | `2981717f…b5154f8` — **equal to the round-1 audited hash** |
| Which bytes differ | unified diff of the two serialisations | exactly 4 JSON lines: `empty.body`, `head.next`, `show_less.wakes`, `show_less.monitors` |
| English source + sidecar | `sha256(en/mobile.schedules.json)`, `(…context.json)` | `0459a048…abc575f` / `d3f0d3bb…839aa92` — unchanged since round 1 |
| Other group-B namespaces | `sha256(vi/<ns>.json)` vs round 1 | `mobile.computers`, `mobile.notifications`, `mobile.projects` all byte-identical |
| Code in the render path | `git diff --stat 31f2ae4..fb4d8bc -- src/features/schedules` | empty — no clause or screen change |
| Render-level delta | `renders.r2.tsv` vs round 1's `renders.tsv` schedules section | **39 shared rows compared, exactly 6 changed** — the 2 `show_less` rows, `empty.body`, and the 3 `head.next` rows. Nothing else moved. |

Because the reconstruction hash lands on the round-1 hash, the claim is not "the diff looks
small": it is that removing the three fixes reproduces the audited file bit for bit.

## Findings, resolved

| ID | Key | Round-1 prescription | Shipped bytes | Byte-exact |
|---|---|---|---|---|
| VI-B-S1 (MINOR) | `empty.body` | the corrected second sentence (see report `vi30s1`) | identical | yes |
| VI-B-S2 (NIT) | `head.next` | `{head} · {label}` | `{head} · {label}` | yes |
| VI-B-S3 (NIT) | `show_less.wakes` / `.monitors` | `Ẩn bớt lần thức dậy` / `Ẩn bớt giám sát` | identical to both | yes |

## Re-rendered head line (production path, `vi` shipped)

`vi` is in `SHIPPED_LOCALES` at this head, so `t()` resolves the Vietnamese catalogue
directly — no scratch copy and no harness flip. The clause functions are the shipped ones.

| State | Call | ACTUAL rendered string |
|---|---|---|
| future due, 3 wakes | `nextDueClause(wakeCountClause(3), 240)` | `3 lần thức dậy · sau 4m` |
| future due, 1 wake | `nextDueClause(wakeCountClause(1), 240)` | `1 lần thức dậy · sau 4m` |
| future due, 2 wakes | `nextDueClause(wakeCountClause(2), 5400)` | `2 lần thức dậy · sau 1h` |
| overdue, 3 wakes | `nextDueClause(wakeCountClause(3), -7200)` | `3 lần thức dậy · trễ 2h` |
| overdue, 1 wake | `nextDueClause(wakeCountClause(1), -60)` | `1 lần thức dậy · trễ 60s` |

**Judgement.** The doubled future marker is gone: the line now reads "3 wakes · in 4m", one
future marker, which is how a Vietnamese status line states a count and a coming instant.
The overdue line is untouched and still distinct — `sau` (in) against `trễ` (late) — and
both words are the CLI's own, byte-identical to core's committed
`tui.schedule.due_in` = `sau {duration}` and `tui.schedule.due_overdue` =
`trễ {age}` (verified against `~/local-operator/local_operator/i18n/catalogues/vi`).
The future/overdue distinction now rests entirely on those two words inside `{label}`,
which is exactly what the round-1 NIT argued and what the English source does by dropping
"next" when the instant passes. No information is lost: `{head}` still carries the count
and `{label}` still carries both the distance and the tense.

## `empty.body` — re-read for a new calque, and measured

Shipped: *"Nhờ tác nhân trong cuộc trò chuyện làm một việc theo định kỳ, việc đó sẽ hiện ở
đây. Lần thức dậy gửi một prompt vào cuộc trò chuyện đúng thời điểm đã hẹn; mỗi giám sát
theo dõi một thứ và báo lại những gì thay đổi."*

Clause by clause against *"Ask an agent in chat to do something on a regular basis and it
will appear here. Wakes fire a prompt into a conversation at a time; monitors watch one
thing and report what changes."*:

- `Nhờ … làm một việc theo định kỳ` — "ask … to do something on a regular basis" ✅
  (`theo định kỳ` is the settled word for periodic; not a calque of "on a regular basis").
- `việc đó sẽ hiện ở đây` — "it will appear here" ✅.
- `gửi một prompt vào cuộc trò chuyện` — "fire a prompt into a conversation" ✅ — `gửi`
  replaces the calque `đẩy`, and the duplicated `vào` is gone; `prompt` stays English per
  the vi guide's kept-English list.
- `đúng thời điểm đã hẹn` — "at a time" ✅, and `đã hẹn` (previously arranged) is the right
  sense for a schedule; it adds no claim the English does not make.
- `mỗi giám sát theo dõi một thứ` — "monitors watch one thing" ✅ — `mỗi` forces the noun
  reading of `giám sát`, which was the round-1 objection to the bare `giám sát theo dõi`.
- `báo lại những gì thay đổi` — "report what changes" ✅ — content, not the round-1
  `báo khi có thay đổi` ("reports when there is a change").

**No new calque, no new claim, and no lost claim.** The one construction worth recording is
that wake-side plurality stays unmarked (`Lần thức dậy gửi…` for English's generic plural
"Wakes fire…"), which is how Vietnamese states a class; it was the same in round 1 and is
not a defect.

**Length.** Code points (not font metrics — see the limitation below):

| String | Round 1 | Round 2 | English | Ratio r2/en |
|---|---|---|---|---|
| `empty.body` | 204 | **215** | 181 | 1.19 (was 1.13) |

The fix costs **+11 code points (+5.4 %)**: `mỗi ` (+4), `lại ` (+4), and `những gì ` for
`khi có ` (+3). In the rendered screen this is an `EmptyState` body — a centred wrapping
`Text` in a full-surface empty view with **no `numberOfLines` clamp** and no pinned footer
(`src/ui/components/empty-state.tsx`: `text-body-sm text-ink-dim`, wrapping, no line limit),
so the cost is at most one extra wrapped line on an otherwise empty screen, never a
truncation. It is a longer line than round 1's and it wraps one line earlier than English at
the same width — stated plainly rather than dressed up. If the wave wants the old length, the
only honest saving is `báo lại mọi thay đổi` (−5 code points, measured), which I do not recommend: it is
tighter but slightly more clipped than the shipped sentence.

## Mechanical (executed, in `audit.log`)

- **Repo validator:** `node scripts/i18n/generate.ts --check` → exit 0, projection current
  (143 keys, 10 namespaces, `vi` now among the argument-type sources).
- **Repo gate:** `node scripts/i18n/check-strings.ts` → exit 0, 284 findings all baselined,
  0 new.
- **Affected tests:** `vitest run src/i18n/__tests__` → 5 files, **99 passed**, exit 0.
- **Structural verifier** (my own `verify.mts`, repo parser): 77 group-B keys, 5 plural
  nodes, 5 select nodes, **0 problems**. Placeholder names, select arms and per-arm
  placeholders identical to English; every plural node carries exactly `other` (vi CLDR
  categories `["other"]`); key parity and key order; all strings NFC.
- **Typography:** 0 problems across the 77 keys; no word reaches 18 characters.
- **Negative control:** adding a `one` arm to `mobile.schedules.count.wakes` in a scratch
  copy makes the verifier fail (exit 1) — the gate is live on the file that changed.

## Terminology

Glossary counts on the four group-B files: `mốc` 4 (projects only), `giám sát` 11
(monitor noun, verb and the `bộ giám sát` supervisor), `bộ giám sát` 1 (sentence-initial
`Bộ giám sát` in `supervisor.not_running`), `lần thức dậy` 12 lower-case + 1 sentence-initial.
Core's committed vi holds the same split (`giám sát` 12, `bộ giám sát` 1, `lần thức dậy` 16);
**no divergence**, and the delta changed no term.

## What I did not verify

- **No font metrics and no rendered frame.** The width judgement is code-point arithmetic
  against the rendered slot, not CoreText pixels; this round did not capture a device frame.
  PyObjC is absent on this host and installing one is out of bounds, so the pixel figure the
  Russian wave recorded has no equivalent here.
- **No second independent pass for this delta.** `mobile.schedules` is not one of the named
  high-visibility groups (onboarding, errors, settings); the manager's delta scope named
  re-render and calque re-reading, which is what this report does. Round 1's second reading
  pass (job `4ac043e37ef7`) covered the whole file's semantics at the earlier bytes.
- **The English section labels stay hardcoded** at `schedules.tsx:214`/`:280` (the splice in
  the header rows above shows them). That is a pre-existing code-side gap, identical in the
  shipped fr/es/ru/zh waves, and not a catalogue finding — as recorded in `vi30s1`.

## Record

`i18n/audits/evidence/vi/mobile.schedules/vi30s1r2/record.json`. `audit.log` is the executed
transcript of this round and is identical in the four group-B delta bundles. Proposed ledger
row (no ledger command exists at this head; see `record.json` → `ledger`):

> vi / mobile.schedules / passed / i18n-auditor (lopdev team) / radient/auto /
> source `69ad8d48…` / `i18n/audits/evidence/vi/mobile.schedules/vi30s1r2/record.json`
