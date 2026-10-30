# vi — mobile.home — delta A, round 2

**Verdict: PASSED.** 0 BLOCKER, 0 MAJOR, 0 unresolved. 6/6 round-1 findings fixed
byte-exactly. 1 MINOR and 2 NIT remain, none in the shipped copy.

- Locale: `vi` · Namespace: `mobile.home` · Audit: `vi30a1r2`
- Audited revision: `fb4d8bcbc50c68301af624407e09b1789896e571` (branch `feat/i18n-vietnamese`)
- Round 1: `vi30a1` at `31f2ae4` — `changes_requested` (2 MAJOR, 4 MINOR)
- Auditor: i18n-auditor (lopdev team), session `3fd3fed80964`, **actual model `radient/auto`**
  (the session opened on `anthropic/claude-sonnet-5-5` and fell back through
  `openai/gpt-6-astra` and `kimi/k3.1-pro` on provider quota; the audit commands in
  this bundle ran on `radient/auto`)
- Source: `src/i18n/catalogues/en/mobile.home.json` `4ebba126…` (unchanged since round 1),
  context sidecar `db18b25d…` (unchanged), target `src/i18n/catalogues/vi/mobile.home.json`
  `023141681a91d49bc481597c77c9bce2ae53f99c771d7ec4434db18d264d342c` (round 1)
  → `c418df1e9f81ec9c30ee17745ec5f2391615ce99a621082b2c1ceddec28e6913` (this round)

## Round-1 findings, disposition

"Byte-exact" below means: the shipped value equals the round-1 `replacement`
string under a plain `===` of the two code-point strings (both sides NFC), as run
in `D1` of the audit log, and the round-1 text is absent (`D2`). A comparison,
not a reading.

| ID | Key(s) | Sev | Disposition | Evidence |
|---|---|---|---|---|
| H-01 | `options.fixed` | MAJOR | **fixed** | `Mở … để dùng các điều khiển trực tiếp.` — the narrowing `xem` is gone; the destination is byte-identical to `mobile.session.conversation_details` (`Chi tiết cuộc trò chuyện`), which the context note requires |
| H-02 | `tip.parallel` | MAJOR | **fixed** | re-measured below: 278.6 → **263.7 pt** in a 270 pt box |
| H-03 | `greeting` | MINOR | **fixed** | re-measured: 315.8 → **240.2 pt**, one line in 288 pt; widow gone |
| H-04 | `starting`, `startup_queue.unconfirmed` | MINOR | **fixed** | `Đang bắt đầu…` / `Chưa xác nhận bắt đầu`; all three start states now use `bắt đầu` (`D5`) |
| H-05 | `suggestion.wake_summary` | MINOR | **fixed** | `Đánh thức tôi kèm bản tóm tắt` — classifier present; 196.2 pt in the 256 pt row |
| H-06 | `suggestion.review_repo` | MINOR | **fixed** | `Rà soát repo này` — core's term; `đánh giá` absent from core `tui.review` (`D5`) |

## H-02 and H-03 re-measured — same method, same boxes

Method identical to round 1: `measure.swift` (CoreText / `NSAttributedString.size(withAttributes:)`,
the SF system font the iOS build paints) driven from the catalogue, at the same
sizes/weights/kerning round 1 used, against the same boxes read again from
`home-splash.tsx` at this revision (`contentContainerClassName` `px-4` → 288 pt at a
320 pt viewport; tip row `flex-row items-center gap-1.5` with `Info size={12}` →
270 pt text box, `numberOfLines={1}`; greeting `text-title`, full 288 pt).

| Value | Role | Box | Round 1 | Now | Result |
|---|---|---|---|---|---|
| `tip.parallel` | meta 12/500 | 270 pt text box (row 288 pt, icon 12 + gap 6) | 278.6 pt — **8.6 pt over** | **263.7 pt** | fits, 6.3 pt slack; text+icon+gap = 281.7 ≤ 288 |
| `greeting` | title 20/600/−0.24 | 288 pt, one line | 315.8 pt — wrapped, `bạn?` stranded | **240.2 pt** | one line, 47.8 pt slack |
| English controls | | | `tip.parallel` 240.4 · `greeting` 281.9 | unchanged | the vi strings now sit *below* their English counterparts |

Negative controls in the same run: `control:tip_over` (deliberate filler) reads
408.7 pt and is reported OVER; `fix:tip_search` — a candidate considered and
**not** shipped — reads 281.8 pt and is reported OVER, so the box arithmetic is
proved able to fail, not merely able to pass.

## Regressions from the fixes — checked, none material

**Start verbs (H-04 follow-through).** The three states now read
`Đang bắt đầu…` (13 ch, 136.2 pt at title 20/600, 110.7 pt at the body 16/400 the
splash actually paints), `Chưa bắt đầu` (86.9 pt), `Chưa xác nhận bắt đầu`
(148.6 pt). One verb, one English verb, and it agrees with the noun: `Tùy chọn
khởi đầu` keeps `khởi đầu`, which is the **adjective** "initial", and core uses
exactly that split — `wire.slash.new` "Bắt đầu cuộc trò chuyện mới" for the act,
`wire.settings.agents.description` "các vai trò khởi đầu" for the adjective. No
neighbour introduces a competing verb (`D5` checks the six queue/transcript
values too), and `khởi động` no longer appears anywhere in `mobile.home`.

**Greeting shape (H-03 follow-through).** The addressee is gone and that does
not matter here: the vi style guide *permits* the pronoun at first contact but
does not require it, and its default is that plain verbs carry the sentence —
`giúp gì?` is a complete predicate in Vietnamese — and the string keeps the word
that carries the sentence's meaning (`Hôm nay`). The desktop app's committed vi (`local-operator-ui`
`ui.chat.composer.welcome`) is `Hôm nay tôi có thể giúp gì cho bạn?` and measures
**315.83 pt** at the mobile title role — the exact string that stranded `bạn?`,
so byte-identity with the desktop is unreachable at 320 pt. The alternative that
keeps the addressee, `Tôi có thể giúp gì cho bạn?`, measures 235.8 pt and drops
`Hôm nay` instead; both fit, and the shipped one follows the guide's pronoun
rule. Recorded as C-03, no change.

## Role corrections this round (disclosed, no verdict change)

Two of round 1's measurements used a type role the component does not paint.
Both over-measured, so every round-1 *fit* conclusion stands — the shipped
strings have more room than round 1 reported:

| Value | Round 1 role | Painted role | Round 1 pt | Actual pt |
|---|---|---|---|---|
| suggestion rows (all six) | label 15/600/−0.075 (the `View`'s `buttonClasses("quiet","md")`) | `Text` `text-body-sm` = 14/400/0 | `wake_summary` 212.8 | `wake_summary` **196.2** (max of six) |
| `starting` | title 20/600/−0.24 | `text-body` = 16/400 | 136.2 | **110.7** |

The two findings this round had to re-measure — the tip (meta 12/500) and the
greeting (title 20/600) — used the correct roles in round 1, so their
before/after numbers are directly comparable.

## Findings this round

**C-01 — MINOR — `src/features/home/home-copy.ts` (vi budget comment), not copy.**
The `vi` entry says the longest chip is "29 characters (`suggestion.wake_summary`,
212.8 pt in a ~256 pt box)". 212.8 pt is the 15/600 `label` measurement; the row
paints 14/400, where it is **196.2 pt**. The budget is right (32 ≥ 29; 196.2 ≤ 256)
and the conclusion is unchanged — only the cited figure is from a role the row does
not use. Suggested: cite 196.2 pt at 14/400, or name the role measured. The
independent second pass reached the same finding separately.

**C-02 — NIT — cross-surface start wording, no action.**
Core renders a *session boot* as `đang khởi động…` (`tui.status.band.starting`) and
`đang khởi động phiên` (`relay.asks.card.cold_wait`), while the phone's first-send
state says `Đang bắt đầu…`. Core does not settle one term: its own renderings for
"starting…"/"new session" span three verbs (`khởi động`, `tạo`, `mới`), and its
conversation-start verb is `bắt đầu`. So this is not a glossary or core-term
violation, and the mobile file's internal consistency wins. Recorded for a future
wave that unifies the two surfaces.

**C-03 — NIT — greeting addressee, no action.** See above: the desktop variant
cannot fit, the guide drops pronouns, meaning is preserved.

## Mechanical

- `npm run -s i18n:check` → exit 0; `catalogue.gen.ts` current (143 keys, 10
  namespaces, argument types from en, es, fr, ru, vi, zh-CN); `check-strings`
  284 findings, all baselined, 0 new, no growth vs `31f2ae4`.
- Repository parser (`parseMessage` / `formatMessage` / `pluralCategory` /
  `renderFor`, imported from the worktree): 27/27 key parity, 27/27 context
  parity, placeholder surface, ICU arms, code spans and flags, NFC, no combining
  marks, punctuation — 346 PASS, 0 FINDING, 0 CONTROL-FAIL (log §1–§7).
- `vitest run src/features/home/home-copy.test.ts src/i18n/__tests__/catalogues.test.ts`
  → 77 passed.
- Harness provenance: the round-1 harness is reused unchanged except **one**
  control, which round 1 pointed at tag `vi` because `vi` was then unshipped; at
  `fb4d8bc` `vi` *is* shipped, so that control now asks a shipped locale to fall
  back. Re-pointed at `hi`, still unshipped. The `diff -u` of the two harnesses is
  in the log; the run of the *unpatched* harness is preserved in
  `audit-original-harness.log` so the premise change is visible rather than
  smoothed over.

## Second independent pass

A blind second pass (reviewer subagent, job `587726fed18f`, pinned
`anthropic/claude-sonnet-5-5`, actually served `radient/auto`) read the six values
and every neighbour without access to this audit's findings: **clean — no
BLOCKER, no MAJOR, no MINOR in the catalogue**, terminal for the six-value set. It
reproduced this round's numbers independently (tip 263.71 / 270; greeting 240.21 /
288; longest chip 196.22 / 256; desktop greeting variant 315.83 / 288) and reached
C-01 separately as a MINOR on the comment. It also supplied two facts this audit
then verified itself rather than accepting: core's `wire.slash.new` and
`wire.settings.agents.description` split, and the desktop's committed vi greeting
in `local-operator-ui`. Its verbatim report is `second-pass-report.md`.

## Ledger

Not written. This repository has no `i18n/ledger.json` and no ledger command at
`fb4d8bc` (`i18n/` holds `audits/` only; `package.json` scripts and `scripts/i18n/`
have generate/check only; `docs/i18n.md` records the report in the pull request).
Core's `i18n/ledger.json` does hold one `mobile.*` row (`zh-CN` /
`mobile.setup`, 2026-10-24) with evidence under core's tree, so a row is possible —
but that is an edit in a different repository, outside this read-only delta. The
proposed row is in `record.json` under `ledger.ledger_row_proposed`.

## Limits

No human native-speaker review. No rendered frame and no screenshot: the width
claims are measured text advances compared against row boxes, not pixels. The
translator's run and the remediation author's run were not observed by this
auditor. Nothing in `src/` was edited; only this evidence directory was written.
