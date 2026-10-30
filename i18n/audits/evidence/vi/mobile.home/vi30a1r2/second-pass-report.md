### Agent review — round 1 (blind vi second pass)

**Reviewer:** independent vi auditor — `radient/auto` (session opened on `anthropic/claude-sonnet-5-5`; provider-quota fallbacks ran it through `openai/gpt-6-astra` and `kimi/k3.1-pro`; this pass was performed on `radient/auto`).
**Scope:** `31f2ae4..fb4d8bc` (`/Users/damian/workspace/vi-wave`, worktree clean) — `src/i18n/catalogues/vi/mobile.home.json`, all 28 values (the six named plus every same-file neighbour), against `en/mobile.home.json` + `en/mobile.home.context.json`; plus the `home-copy.ts` budget hunk in the same commit.
**Blind:** I did not open `i18n/audits/evidence/vi/mobile.home/vi30a1/*` or its second-pass report.

**Verdict: clean — no BLOCKER, no MAJOR, no MINOR in the catalogue; TERMINAL for the six-value set.** One MINOR sits in the accompanying code comment (non-shipping, answerable without touching the catalogue); no NIT worth a round.

#### Findings

**MINOR-1 — code comment, not a catalogue value: `src/features/home/home-copy.ts:94-97` and the commit message**
Current text: “its longest chip is 29 characters (`suggestion.wake_summary`, 212.8 pt in a ~256 pt box)… runs longer per character than Latin because of stacked diacritics”.
Problem: 212.8 pt does not reproduce for the chip at the role it paints. `SuggestionRow`’s `Text` carries `text-body-sm` (`home-splash.tsx:134-141`; preset `body-sm` = 14 px / 400 / 0), and “Đánh thức tôi kèm bản tóm tắt” measures **196.22 pt**. 212.8 pt is exactly a 15 pt / 600 / −0.005em measurement (212.77) — the Button `label` role the row’s `View` names via `buttonClasses("quiet","md")`, which the `Text` does not use (RN text styles do not inherit from a View; the component’s own note at `:130` says the row paints 14/400). The per-character rationale also fails on this chip: 6.8 pt/char vi vs 7.5 pt/char en.
Suggested wording: cite **196.2 pt at 14 pt/400 (body-sm)**, or name the role measured. The fit conclusion is unchanged (196.22 ≤ 256), and `SUGGESTION_CHAR_BUDGET.vi = 32` still covers the 29-char chip.

**NITs: none.** `tip.parallel`’s “tách” is acceptable dev register (“tách” ≈ fork/split off child agents, same family as “tách tiến trình”); if a spawn verb were preferred, “sinh tác nhân con” fits (262.31/270) while “tách ra” does not (278.58/270). I would not spend a round on it.

#### The six values — each clean

- **starting** “Đang bắt đầu…” — correct present-continuous state, U+2026, one line (110.73 pt of 288).
- **startup_queue.not_started** “Chưa bắt đầu” — correct, two words, same verb as *starting*.
- **startup_queue.unconfirmed** “Chưa xác nhận bắt đầu” — correct state semantics (start not confirmed; implies neither waiting nor retry); keeps the family’s one verb. I would keep it; “Chưa rõ đã bắt đầu” is slightly softer but adds nothing.
- **options.fixed** — meaning complete (“Tùy chọn khởi đầu … đã cố định” = the starting options are fixed). Action/destination verified: “Mở Chi tiết cuộc trò chuyện” is byte-identical to the destination screen’s own title (`mobile.session.conversation_details` = “Chi tiết cuộc trò chuyện”, whose context note requires identity), and “các điều khiển trực tiếp” is an acceptable rendering of “live controls”.
- **suggestion.wake_summary** “Đánh thức tôi kèm bản tóm tắt” — correct “wake me”: the chip is a prompt the *user* sends, so the object is the user — exactly the transitive case the vi guide’s “đánh thức = waking someone else” note carves out. The self-waking feature noun stays “lần thức dậy” everywhere else (`mobile.schedules.*`), so the two do not collide.
- **suggestion.review_repo** “Rà soát repo này” — agrees with core’s code-review term.

#### Terminology vs core (found at `local_operator/i18n/catalogues/vi/` — the brief’s `i18n/catalogues/vi/` path does not exist)

- **Code review:** core `tui.review.title` = “Rà soát mã”, activity `rà soát` → mobile **agrees**.
- **Start:** core’s conversation-start verb is “bắt đầu” (`wire.slash.new` “Bắt đầu cuộc trò chuyện mới”) → mobile start family **agrees** (“Đang bắt đầu… / Chưa bắt đầu / Chưa xác nhận bắt đầu”). Core’s *session-boot* wording is different — “đang khởi động…” (`tui.status.json:3`), “đang khởi động phiên” (`relay.asks.json:26`) — but that is the runtime cold start, a different state; noted only in case the home’s “starting” is ever re-read as a session boot.
- **Starting options:** core uses the same adjective (“các vai trò khởi đầu”, `wire.settings.agents.description`) → “Tùy chọn khởi đầu” **agrees**.
- **Greeting:** differs from the desktop app’s committed vi (“Hôm nay tôi có thể giúp gì cho bạn?”, `local-operator-ui/src/i18n/catalogues/vi/ui.chat.composer.json:21`) **by necessity**: the desktop wording measures **315.83 pt** at the mobile title role against the 288 pt one-line box (it is what stranded “bạn?”), while the shipped “Hôm nay tôi có thể giúp gì?” measures **240.21 pt**. Verified, not a finding.

#### Neighbours — fine

Queue family: “tin nhắn trong hàng đợi” identical across discard/restore/sheet_title/view/blocked/sending; “Bỏ” vs “Chuyển … thành bản nháp” stay distinct; blocked is an instruction, sending present-continuous, waiting “Đang chờ cuộc trò chuyện…” — all match their notes. `options.apply/folder/title`, `connect_disabled_reason`, `folders_read_failed`, `refused_start_fallback`, `transcript.waiting`, `tip.schedule`, `tip.search` — accurate and idiomatic. Chip leading verbs are distinct (Xem / Thiết lập / Bật / Rà soát / Tạo / Đánh thức); “Tạo” only on the agent-making chip. No “!”, only U+2026, sentence case, NFC everywhere.

#### Width (measured — SF Pro via the mandated measurer, strings extracted from the catalogue, NFC verified)

| value | role | box | vi pt | % | result |
|---|---|---|---|---|---|
| greeting | title 20/600/−0.24 | 288 | **240.21** | 83.4 | fits, one line |
| starting | body 16/400 | 288 | 110.73 | 38.4 | fits |
| startup_queue.not_started | body-sm 14/400 | 288 | 86.90 | 30.2 | fits |
| startup_queue.unconfirmed | body-sm 14/400 | 288 | 148.62 | 51.6 | fits |
| suggestion.* (six) | body-sm 14/400 | 256 | 108.33–196.22 | 42.3–76.6 | all fit |
| **tip.parallel** | meta 12/500 | 270 | **263.71** | 97.7 | fits, 6.29 pt slack (icon+gap+text = 281.71 ≤ 288) |
| tip.schedule | meta 12/500 | 270 | 210.81 | 78.1 | fits |
| tip.search | meta 12/500 | 270 | 239.94 | 88.9 | fits |

No value overflows its box. The desktop greeting variant would (315.83/288).

#### Gates run

- `node scripts/i18n/generate.ts --check` → catalogue current (143 keys, 10 namespaces).
- `node scripts/i18n/check-strings.ts` → 284 findings, all baselined, 0 new (no growth vs `31f2ae4`).
- `vitest run src/features/home/home-copy.test.ts` → 29 passed (includes each shipped locale’s chip/tip budget, vi included).

**No value in this file — the six or their neighbours — rates MAJOR or worse.** Round is TERMINAL; the remaining MINOR is a comment-figure correction, not a reason for another round.
