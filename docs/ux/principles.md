# Principles

Twelve principles this app holds to. Each one is a decision that costs something
— a feature not shipped, a smoother animation dropped, a sentence rewritten —
and each one traces to either the competitive research
(`competitive-research.md`), the audit of the client we are replacing
(`current-relay-audit.md`), or a constraint in the Local Operator relay
(`docs/mobile.md`, `docs/tunnels.md`, `local_operator/tunnels/gateway.py`).

They are ordered so the earlier ones outrank the later ones when they conflict.
Both back-links are real and were checked: `flows.md` §0 carries a flow →
principle index, and `audit-rubric.md` names the governing principle on every
check.

**Citation ref.** Line citations are against the committed refs **by SHA**:
`~/local-operator` at `5bfff4a61` (2026-09-29), `~/radient-ml/agent-server` at
`dcafe852349ebad3421010b06cfc36e61ac9c5bf`. Read them with
`git show <sha>:<path>` — not `git show origin/main:<path>`, because `main` moves
under the pin (it is `c2bd09ea0` now, tens of lines away in several of these files),
and the working tree is a third state again.

## P-1. The phone is a remote control, not an IDE

Everything the app does is *reach*: see state, decide, steer, stop. It does not
edit files, it does not run terminals, it does not browse the filesystem. This
is not a limitation we apologise for; it is the reason the app is usable with one
thumb on a train.

*Consequence:* file browsing, a code editor and a terminal are out of scope, and
the copy never apologises for their absence. A screen that only makes sense with
a keyboard is not built.

*Evidence:* every product surveyed draws the same line — Codex ("you are not
hand-editing code on a phone"), Cursor ("it isn't an IDE"), Claude (commands that
need a terminal are refused with a pointer). Cursor ships *no* terminal or editor
on mobile at all.

## P-2. Reach is one-handed and bottom-anchored

Primary actions live in the bottom third of the screen. The single most
important control in the app — the composer — sits above the home indicator and
grows with its content. Nothing destructive is reachable only at the top-right.

*Consequence:* the model/effort control, the slash sheet, the attach button and
send all bind to the composer cluster, not to the header. The header carries
identity and navigation only.

*Evidence:* a live measurement on the current web client puts its model/effort
affordance in the far bottom-right corner as a 36×32 px monospaced word — the
least reachable spot on the screen and the only path to changing model
(`current-relay-audit.md` R16, **[measured]**).

## P-3. Status is glanceable without opening the session

A phone user's first question is "does anything need me?". It must be answerable
from the list, from the app icon badge, and from a notification — without
reading a transcript.

*Consequence:* session rows carry state in words, not only colour
(`approval`, `question`, `working`, `ended`); the app badge counts sessions
waiting on a decision; a notification names the session and the kind of decision.

*Evidence:* the strongest pattern across every comparator; the weakest is a
status that needs the session opened to interpret (`competitive-research.md` §5,
Cursor's kanban and GitHub's Agent Tasks are list-level answers).

## P-4. Never lose a typed instruction

A typed instruction is the user's work. It survives a dropped connection, an app
kill, a re-auth, and an OS reclaim. When delivery is *unknown*, the app says so
and offers to retry — it does not silently drop, and it does not double-send.

*Consequence:* drafts persist per session; an ambiguous send keeps a retry
envelope with a stable id so the relay de-duplicates; the UI distinguishes
"rejected" (fix your input) from "unknown" (retry is safe) from "sent".

*Evidence:* the current client already gets this right (drafts under
`lo-mobile-draft:` keys, `web/src/store.ts` L405 `DRAFT_PREFIX`);
the retry envelope, `docs/mobile.md` L257-294) and it is one of the few things a
redesign must not regress; Happy advertises offline machines with last-seen and
persistent drafts for the same reason.

## P-5. Connection state is stated, never implied

The app knows which computer it is talking to, whether that computer is
reachable, why it is not, and how stale the picture on screen is. It says so in
words a user can act on. "Loading…" forever, a silently frozen list, or a spinner
where a reason belongs are all defects.

*Consequence:* three distinct states are always separable — *connecting*
(nothing yet), *degraded* (a snapshot, with its age), *lost* (with a cause and a
remedy). The cause is specific: asleep, connector stopped, wrong account,
tunnel revoked, console-side billing, phone offline.

*Evidence:* the relay and edge already produce typed reasons
(`RELAY_DETAIL` in `gateway.py`: `control_plane_unreachable`,
`authorization_refused`, `tunnel_not_authorized`, `authorization_lease_pending`,
`login_required`) and the tunnel's control-plane status is typed too
(`active`/`disabled`/`suspended`/`pending`/`revoking`/`deleted`). **No surveyed
competitor exposes anything this specific**, which makes it our differentiator
rather than an obligation.

## P-6. Errors name a cause and a remedy, in the user's words

Every failure message answers three questions: what happened, where it happened
(on which machine), and what to do next. Exactly one action is offered where an
action exists on the phone. No status codes, no stack traces, no internal ids, no
`~`.

*Consequence:* "Your computer isn't answering. Check that Local Operator is
running there." beats "ECONNREFUSED". An error with no phone-side remedy says so
plainly and names where the fix lives.

*Evidence:* the audit found refusals that echoed internal ids and used `~`
(R13); the current client's #1784 rounds fixed several of these by hand — this
principle makes it the default rather than a review finding.

## P-7. Approvals are first-class, unmissable, and answerable

A pending approval or question is the reason the app is opened. It is the most
prominent element on the session screen, it is never scrolled out of reach, and
its answer controls are pinned. When an approval *cannot* be answered from the
phone (a terminal-owned session, today), the app says which surface can answer it
instead of offering a dead button.

*Consequence:* approve/deny/(remember)/answer sit above the composer, in a card
capped against the *column* so the soft keyboard cannot push them off; the button
the user must press never scrolls.

*Evidence:* the current client's pending-card contract is its strongest
interaction (`current-relay-audit.md` §2.1) and was paid for with real defects
(options off-screen, a 1426 px card in an 844 px viewport, an unreachable
decision). The failure to avoid is Happy's raw-JSON yes/no.

## P-8. Do not interrupt a user who is already looking at the work

Notifications exist to bring someone back, not to narrate. If the user is
foregrounded on the session — or at the computer running it — the app stays
quiet.

*Consequence:* notifications are suppressed for the session in view; a
"don't notify while I'm at the computer" preference is honoured; repeated
notifications for the same session coalesce.

*Evidence:* Claude Code suppresses pushes while the connected terminal is focused
and offers a presence-file switch; Replit/Devin gate per-event and per-session.
Nothing is worse than a phone buzzing about a turn the user is reading on the
laptop in front of them.

## P-9. Honest state beats optimistic state

The app never shows a value it cannot state. No invented percentages, no `$0.00`
where spend is unknown, no "all good" while a stream is dead, no "sent" until the
relay has acknowledged it.

*Consequence:* floors are marked (`≥$2.00`), estimates are marked (`estimate`), a
missing reading is omitted rather than zeroed, and a send that has not been
acknowledged says "sending" — not "sent".

*Evidence:* the web client's session-status row already refuses to print `$0.0000`
or `0%` for a fresh session and marks floors and estimates explicitly
(`components/session-status.tsx`); the audit found the one place honesty is
missing is connection state (R1), which is the gap this principle closes.

## P-10. One vocabulary, shared with the terminal and the relay

Sessions, computers, turns, approvals, questions, steering, subagents and
projects mean exactly what they mean in the TUI and in the relay's own
copy. The same object has one name across every surface.

*Consequence:* the app does not invent "chat" for session or "agent" for
subagent; a string the relay already owns (a refusal reason, a status word) is
rendered, not reworded.

*Evidence:* the relay and TUI already maintain one vocabulary
(`gateway.py`'s comment on why `RELAY_DETAIL` and `lop tunnel status` share
strings, and why a command is never baked into copy that several surfaces
render).

## P-11. Accessible by construction, not by audit

Contrast in every theme, Dynamic Type to 200 %, VoiceOver/TalkBack labels and
order, reduced motion, and 44 pt targets are properties of each component. They
are verified per screen × state by the audit harness, not retrofitted per
release; a green contrast run is a floor, not a signing-off.

*Consequence:* every interactive element has a spoken label; every theme pair
passes 4.5:1 for body text; nothing overflows at 200 % text; motion collapses
under reduced-motion.

*Evidence:* the current client handles safe areas and reduced motion and passed a
touch-target audit after #1777, but at 200 % text the session title collapses to a
single glyph and the list overflows (R14, **[measured]**), and two controls have
no accessible name (R12, **[measured]**).

## P-12. Nothing leaves the phone that does not have to

The relay binds loopback only; the tunnel is the identity boundary; the phone
holds credentials in the platform keystore and talks **only to the relay the user
chose, and to the computer behind it** — no other server, and never a third-party
analytics endpoint. Telemetry is off by default, and a user can see and clear
everything the app stored locally.

*Consequence:* no analytics SDK in v1; the demo mode uses bundled data and touches
no network; *Clear local data* exists; the privacy screen states exactly what the
relay can see. That last one is the sentence to get right: on the Radient route
the phone's traffic terminates at the edge before it reaches the computer
(`edge/tunnel-worker/src/index.ts`: the 303/401 branch, then
`forward(request, url, id, grant, env)`), and the relay itself serves the
transcript, so the copy says **not end-to-end encrypted** plainly rather than
implying it. "Talks only to your own computer" would be false, and it is exactly
the kind of false comfort a privacy screen must not sell.

*Evidence:* Happy's zero-knowledge story is its central claim and its docs are
explicit about it; Local Operator's privacy copy must be equally explicit about
what is *not* encrypted end-to-end, which the relay's design already documents
(`docs/mobile.md` non-goals).
