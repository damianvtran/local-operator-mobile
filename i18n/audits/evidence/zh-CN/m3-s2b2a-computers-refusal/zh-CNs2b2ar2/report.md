# zh-CN audit — round 2 (delta) — m3-s2b2a-computers-refusal (24 keys)

Verdict: **passed** — 0 BLOCKER, 0 MAJOR open; 0 new findings.
Auditor: i18n-auditor, session ace3569ca688, model anthropic/claude-opus-5-5 (no fallback). Independent of translator sessions 67e397a5ab7f/26a9563a2aca and of round-1 auditor e1685cdf64ae (job 93350949de5b).
Hashes recomputed: brief d151df76aab223cc1b5f481813b7256977338a8c7cdcfb5bce68106faa8a0e40; v1 04cc9ee2e3237467c9e542bf708820196bfd8a8308e3172f6592cff790f57bdd; v2 4b5cd4b6c1b532d9921c1d847b8b4caeaf12ec8e60da2d1eedfeb166827c2cbd; notes a0d409f1cc0f56fbd25fd3caaac59dcc208724c5f173836bc88b673906dc9384. Redaction markers: brief 0, v1 0, v2 0.

## Delta check
- v1→v2 changes exactly 6 keys = the 6 listed in the notes: relay_stopped_title, tunnel_gone_title, sign_in_title, offline_next, console_next, another_address.
- Other 18 values byte-identical; key order == brief in v1 and v2; 26/26 lines.
- All 24 v2 values parse with messages.ts (worktree cd249ed1); params equal English; zh CLDR [other]; wait_seconds formats n=0/1/2/30; 0 bidi controls; NFC.

## Round-1 findings
| ID | Sev | Key | v2 | Status |
|---|---|---|---|---|
| F1 | MAJOR | tunnel_gone_title | {subject}已不再对应任何隧道。 | fixed — round-1 suggested wording applied verbatim |
| F2 | MAJOR | sign_in_title | 你的Radient登录已过期。请登录以重新连接到{subject}。 | fixed — round-1 suggested wording applied verbatim |
| F3 | MINOR | offline_next | 请唤醒那台电脑，并确认连接器正在运行。上方显示的是它最后已知的状态。 | fixed — round-1 suggested wording applied verbatim |
| F4 | MINOR | console_next | 请打开Radient控制台进行处理。在此手机上重新登录也无法解决这个问题。 | fixed — round-1 suggested wording applied verbatim |
| F5 | NIT | relay_stopped_title | {subject}上的中继没有运行。 | fixed — round-1 suggested wording applied verbatim |
| F6 | NIT | another_address | 改用其他地址 | fixed — round-1 suggested wording applied verbatim |

No rejections to adjudicate. F2: 登录 matches the catalogue (退出登录, 登录会话, 未登录Radient账户) and removes the 会话 collision. F6: 6 chars, far under ~24.

## Delta read (no new findings)
- sign_in_title repeats 登录 ("登录已过期。请登录以…"): standard zh product pattern for an expired sign-in, mirrors the English; no finding.
- tunnel_gone_title with a computer-name subject ("my-mac已不再对应任何隧道。") still reads correctly; terminal meaning kept, one sentence, fits heading.
- offline_next 上方 keeps "shown earlier on this screen" per the note; console_next now says plainly re-signing in does not help.

## Write location
The requested directory /Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/m3s2b2/audits/zh-CN-r2/ was refused by guardrail dangerous-delete (ancestor-session scratchpad). Artifacts live at /Users/damian/.local-operator/sessions/ace3569ca688/scratchpad/audits/zh-CN-r2/; copy them across from the lane session if they must sit beside round 1.
