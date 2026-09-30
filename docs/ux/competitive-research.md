# Competitive research: driving coding agents from a phone

Status: research, read 2026-09-29. Everything below is either **[read]** (I opened
the source on that date), **[reported]** (a third-party write-up of a vendor
claim), or **[inferred]** (my reading; not stated by the source). Vendor
behaviour changes monthly in this category, so treat any single row as a
snapshot and re-check before copying a pattern.

The question this document answers: *what do the best phone clients for
coding/AI agents do at each moment of the loop, and which of that should the
Local Operator app copy, improve, or avoid?* The loop is: **connect → see what
is running → be pulled back when needed → decide (approve/answer) → steer or
stop → review the result.**

## 0. Summary table

| Product | Runs where | Connection / pairing | Native app | Push | Diff review on phone | Steer vs queue |
|---|---|---|---|---|---|---|
| Codex in ChatGPT mobile | Your Mac/PC (or SSH host) | Scan QR shown by desktop app; same ChatGPT account/workspace; relay | iOS + Android (inside ChatGPT) | Yes (task done / needs attention) | Yes; inline review comments since 2026-06-09 | Steer active work; edit last prompt |
| Claude Code Remote Control / Claude app "Code" tab | Your machine (RC) or Anthropic cloud | Run `claude remote-control`; QR / URL / session list; outbound-only HTTPS | iOS + Android (inside Claude app) | Yes, two opt-in toggles | Diff pane on connected device | Send messages any time; stop subagents |
| Happy (open source) | Your computer | `happy` CLI wrapper; scan QR; E2E encrypted relay | iOS, Android, web, macOS | Yes (permission, errors) | Limited; experimental file browser | Switch control phone⇄terminal with a keypress |
| Omnara | Laptop or their cloud | `omnara` wrapper; account login; SSE | iOS (+ Watch), web | Yes | Yes (diffs) | Send input; voice mode |
| Cursor for iOS / cursor.com/agents | Cursor cloud, team pool, or "My Machines" | Account sign-in; `/remote-control` hand-off for a local agent | iOS native; Android via PWA | Yes + Live Activities (up to 8 agents) | Full diffs, checks, merge | Follow-ups to running agent |
| GitHub Mobile + Copilot cloud agent | GitHub cloud | GitHub login (already in app) | iOS + Android | GitHub notifications | Diff + PR review, create PR | Prompt → session → PR |
| Replit mobile | Replit cloud | Account | iOS + Android | Live Activities | Task "ready for review" then apply | **Steer or Queue**, explicit |
| Devin Mobile | Cloud or your machine | Account | iOS beta (waitlist) | Slack + app | PR-oriented | Ask/Agent modes |
| Warp Oz web app | Warp cloud agents | Account | Responsive web only | n/a | n/a | n/a |

Local Operator's position: it is the **"your own computer, reached over a
private tunnel"** shape (Codex Remote, Claude Remote Control, Happy, Omnara),
not the cloud-agent shape (Cursor cloud, Copilot, Replit, Devin). Sections 1-4
are therefore the primary comparators; 5-8 are sources for *task-list, review
and notification* patterns.

## 1. OpenAI Codex in the ChatGPT mobile app

Sources: OpenAI, "Work with Codex from anywhere", 2026-05-14
<https://openai.com/index/work-with-codex-from-anywhere/> **[read]**; Codex
docs, "Remote connections" <https://developers.openai.com/codex/remote-connections>
(redirects to <https://learn.chatgpt.com/docs/remote-connections.md>) **[read]**;
Verdent guide, last verified 2026-05-15 <https://www.verdent.ai/guides/codex-in-chatgpt-mobile>
**[reported]**; Daniel Vaughan, "Codex Mobile in ChatGPT iOS…", 2026-06-12
<https://codex.danielvaughan.com/2026/06/12/codex-mobile-chatgpt-ios-branch-worktree-goal-inline-review-cli-companion/>
**[reported]**, citing the Codex changelog entry for ChatGPT iOS 1.2026.153
(2026-06-09).

- **Onboarding / connection.** On the host: Settings › Connections › *Control
  this Mac or PC* › Set up. The host shows a **QR code**; the phone scans it,
  opens ChatGPT, confirms same account + workspace, then any MFA/SSO/passkey.
  "Pair every phone … with every host you want it to control." The host then
  appears under **Codex** (iOS) in the app. A "secure relay layer" keeps hosts
  reachable without exposing them; the host must be awake and online.
- **Session list.** All threads across connected hosts, with a host switcher
  ("Switch between connected hosts and chats"). Start new chats in a host's
  projects.
- **Transcript / tool output.** "Updates flow back to your phone in real time,
  including screenshots, terminal output, diffs, test results, and approvals."
- **Approvals.** Approve commands and "other actions" from the phone; answer
  clarifying questions.
- **Steering.** Send follow-ups, "steer active work", change model, start a new
  thread. 2026-06-09 build added branch/worktree selection at thread start,
  `/goal` management, **inline review comments on changed files**, and editing
  the last prompt **[reported]**.
- **Notifications.** "Get notified when ChatGPT completes a task or needs your
  attention." **[read]**
- **Offline / reconnect.** "When the host sleeps or loses connectivity, the
  mobile session pauses until the connection is restored." Troubleshooting
  page: host doesn't appear → check same account/workspace; approval doesn't
  appear → rescan QR. Signing out turns off Remote Control but keeps pairings.
  **[read]**
- **Great:** the host list *is* the home screen (the mental model is "my
  computers"); QR pairing is one gesture; parity of threads with desktop and
  CLI (same App Server).
- **Avoid:** pairing every phone with every host by hand; the host must be a
  specific desktop app (no CLI/IDE origin); no explicit "why is my host
  missing" diagnosis in-app - the docs make the user guess between sleep,
  account and workspace.

## 2. Claude: Remote Control, Claude Code on the web, Claude app "Code" tab

Sources: Claude Code docs, "Continue local sessions from any device with Remote
Control" <https://code.claude.com/docs/en/remote-control> **[read]**; "Use
Claude Code in the cloud" <https://code.claude.com/docs/en/claude-code-on-the-web>
**[read]**; Anthropic, "Claude Code on the web" (iOS research preview)
<https://www.anthropic.com/news/claude-code-on-the-web> **[read via search
snippet]**; Simon Willison, 2026-02-25 <https://simonwillison.net/2026/Feb/25/claude-code-remote-control>
**[snippet]**.

- **Connection model.** Run `claude remote-control` (server mode, many
  sessions) or `/remote-control` in a running session. Session URL + **QR code
  (spacebar toggles it)**; or open the Claude app › **Code** tab and find the
  session by name: "Remote Control sessions show a computer icon with a green
  status dot when online." Security: "outbound HTTPS requests only and never
  opens inbound ports … multiple short-lived credentials, each scoped to a
  single purpose." Needs a claude.ai login; not for API-key or Bedrock users.
- **Session list.** Named sessions (title precedence: `--name` › `/rename` ›
  last meaningful message › `hostname-adjective-noun`), archive/filter, cloud
  and local mixed in one list.
- **Transcript.** Conversation and subagent/workflow progress "stay in sync
  across all connected devices". On connect, the device shows subagents already
  running; **stopping one from the phone stops it on the machine**.
- **Approvals.** Permission prompts and `AskUserQuestion` stay open until
  answered; other forwarded dialogs (e.g. model choice) **expire after five
  minutes** and take the no-action default. Cloud sessions expose permission
  modes.
- **Steering / slash commands.** Messages from terminal, browser and phone
  interchangeably; images and files attach from the phone. Terminal-only
  commands (`/plugin`, `/resume`) are refused on mobile; `/model`, `/effort`,
  `/rename`, `/mcp` take **arguments in place of the terminal's picker**.
- **Diff review.** Diff indicator (`+42 -18`) opens a diff view with **inline
  comments sent to Claude with the next message**; "Compare against" any
  branch. Auto-fix PR watches CI/review comments.
- **Notifications.** Opt-in push: *Push when Claude decides* and *Push when
  actions required*. Suppressed while you are typing in the connected
  terminal (presence file for "at the machine"). iOS Focus / Android battery
  optimisation are called out as delivery hazards.
- **Reconnect.** "If your laptop sleeps or your network drops, Claude Code
  reconnects automatically." Named failure reasons ("Another connection took
  over this session", "ended or archived from another device") with a single
  remedy (`/remote-control`).
- **Great:** *named, specific failure reasons* with one remedy each; push
  gated on presence (no buzz while you sit at the machine); computer icon +
  green dot as the online affordance; outbound-only security story that fits
  in one paragraph.
- **Avoid:** the setup is a *terminal ritual* (run a command, toggle a QR with
  spacebar); slash commands degrade to text output with no discoverability on
  phone; third-party commentary calls the mobile Claude Code experience "a
  remote desktop view from 2005" (Nimbalyst, <https://nimbalyst.com/blog/claude-code-on-ios-manage-agent-sessions>,
  **[snippet; vendor of a competing product]**).

## 3. Happy (open source, MIT)

Sources: <https://github.com/slopus/happy> README (main, read 2026-09-29;
~24k stars); <https://happy.engineering/>; Google Play listing "Happy Coder"
<https://play.google.com/store/apps/details?id=com.ex3ndr.happy> (updated
2026-03-26, 4.9★ / 3.16K reviews, 10K+ installs, read 2026-09-29);
docs <https://slopus-happy-9.mintlify.app/introduction>. All **[read]**.

- **Connection.** Install app; `npm i -g happy`; run `happy` instead of
  `claude`; **scan the QR** printed in the terminal. The QR carries a one-time
  challenge for E2E-encrypted (TweetNaCl) sync through Happy's server.
  "When you want to control … from your phone, it restarts the session in
  remote mode. To switch back … press any key."
- **New session composer** (Play notes): pick machine, agent, model,
  permissions and worktree in one place; **drafts persist across navigation;
  offline machines stay visible with a "last seen" time.**
- **Push:** permission requests and errors. **Voice:** realtime voice mode.
- **What users complain about** (Play reviews, read 2026-09-29): "when the agent
  is giving you options to choose from, this tool simply displays the JSON
  with a yes and no choice which is out of context"; wants a proper file
  browser (only an experimental changed-files view); Codex permission taps
  sometimes do nothing.
- **Great:** offline machines shown with last-seen rather than vanishing;
  persistent drafts; one-key handoff between phone and terminal; zero-knowledge
  story.
- **Avoid:** rendering an agent's question as raw JSON with generic yes/no.
  The single most quoted UX failure in this category, and Local Operator's
  `ask` card (question + options with consequences + free-text/secret) is
  already better; the native app must not regress it.

## 4. Omnara

Sources: Show HN, 2025-08-12 <https://news.ycombinator.com/item?id=44878650>;
App Store listing (v2.0.5, 2026-04-07; 4.4★ / 36 ratings)
<https://apps.apple.com/us/app/omnara-claude-codex-mobile/id6748426727>;
Google Play <https://play.google.com/store/apps/details?id=com.omnara.app>;
docs <https://omnaradocs.com/task/blog/responding-claude-code-questions-omnara-push-notifications>
**[snippet]**. Rest **[read]**.

- **Model.** A CLI wrapper parses the agent's session file + terminal output and
  streams messages to a hosted backend, shown "in real time via SSE" on web and
  mobile - the same transport family Local Operator uses. Free for 10 sessions
  a month, $9/month unlimited (2025-08).
- **Positioning.** Founders argue SSH/tmux clients (Termius, VibeTunnel) "lack
  push notifications, clean UIs for answering questions or viewing git diffs,
  and easy setup" - i.e. the bar a native client must clear over a terminal.
- **Notable v2 additions** (App Store version history): pinning sessions,
  speech-to-text, UI revamp (2026-03), Apple Watch (2026-04), "live localhost
  previews", voice coding mode, "more information in the chat input box, and
  tooltips for different features" (2026-02).
- **Great:** tapping a push notification lands on the exact question; pinning;
  Watch complication for "agent needs you".
- **Avoid:** hosted-backend dependency for a private-machine product;
  transcript parsing from terminal output is brittle (their own admission that
  SDK hooks don't cover permissions/mode switching).

## 5. Cursor: agents on web/mobile, Cursor for iOS

Sources: Cursor docs "Cursor for iOS" <https://cursor.com/docs/cloud-agent/mobile>
**[read]**; blog "Cursor on web and mobile" <https://cursor.com/blog/agent-web>
(2025) **[read]**; Learn Cursor, Android status <https://www.learncursor.dev/guides/cursor-android>
**[snippet]**.

- **Onboarding:** download › sign in (SSO if required) › choose repository and
  branch › send a task. Four steps and no computer setup for cloud agents.
- **Local machines:** `/remote-control` in the desktop Agents Window hands a
  session to a worker on your computer; it appears in the phone inbox; "your
  computer must stay awake and online" with a **Keep this computer awake**
  setting.
- **Inbox + live follow:** watch the chat stream, send follow-ups, **tap a
  subagent card to read its child transcript**. iPad layout keeps chats and
  changes side by side.
- **Review:** full diffs, commits, deployments, comments, checks; merge with
  squash, mark ready, auto-merge, close.
- **Notifications:** push when a turn finishes; **Live Activities on lock
  screen and Dynamic Island for up to eight agents**.
- **Cache-first:** "It reads from local data so the inbox and conversations
  open fast, then syncs once your connection returns."
- **Input:** voice dictation with live transcription; attach photos/camera;
  "Design Mode" to tap a point or draw on a screenshot as instruction.
- **Explicit non-goals:** no editor, terminal, or file browser on mobile - "you
  see changed files in the diff view, not a full workspace."
- **Great:** cache-first cold start; Live Activities; a stated non-goal list
  that keeps the app about directing and reviewing.
- **Avoid:** iOS-only native (Android is PWA; push and Remote Control stay iOS)
  - our brief is cross-platform parity.

## 6. GitHub Mobile + Copilot cloud agent

Sources: GitHub Docs "Using Copilot cloud agent on GitHub Mobile"
<https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-mobile>;
changelogs 2025-06-04, 2025-09-24, 2026-04-08
(<https://github.blog/changelog/2026-04-08-github-mobile-research-and-code-with-copilot-cloud-agent-anywhere>).
**[read]**

- **New session:** Copilot icon › New Session › choose **repository** from the
  prompt field's dropdown › prompt › optional base branch, custom agent, model,
  reasoning level. All optional controls live *in the prompt field's
  dropdowns*, so the default path is prompt-and-send.
- **Tracking:** Home › Agents › **Agent Tasks** = list of your agent-generated
  PRs with Open/Merged filters.
- **Since 2026-04:** research and plan-first modes, work on a branch **without
  opening a PR**, review the diff, create the PR when ready.
- **Great:** progressive disclosure on the start form (prompt first, everything
  else optional); reuses GitHub's PR vocabulary the user already knows.
- **Avoid:** session = PR, so non-code work has no natural home; the list is
  PR-shaped, not conversation-shaped.

## 7. Replit mobile agent

Sources: Replit docs "Steer or queue follow-up messages"
<https://docs.replit.com/features/agent/steer-and-queue-messages> **[read]**;
"Task lifecycle" <https://docs.replit.com/features/agent/task-lifecycle>
**[read]**; mobile-app reference (Live Activities) <https://docs.repl.it/references/platforms/mobile-app.md>
**[snippet]**.

- **Steer vs Queue is an explicit, per-message choice.** *Steer* sends to the
  active turn; *Queue* waits for the turn to finish. Default is a preference;
  a modifier key sends the opposite. The **queue is a visible drawer above the
  input** where messages can be **edited, reordered, deleted, or "steer now"**.
  **Stop** is a status-bar control that interrupts the active turn, after
  which you can immediately send.
- **Task lifecycle:** planned › running › **ready for review** › finished, as
  board columns; Archive (reversible, drafts only) vs **Cancel (irreversible,
  labelled so)**.
- **Live Activities** on iOS 18+ show Agent progress on the lock screen.
- **Great:** the queue drawer - *never lose a typed instruction* made
  visible; naming irreversible vs reversible in the control label.
- **Avoid:** cloud-project-shaped mental model; no equivalent of "my computer".

## 8. Devin, Warp (light coverage)

- **Devin Mobile:** waitlist page (read 2026-09-29) <https://devin.ai/ios>:
  "Runs in the cloud or on your machine … won't stop until the PR is ready to
  merge"; app shows recent sessions and a prompt box **[read]**. Slack is the
  mature notification channel: opt-in per session, and a setting for whether
  Devin waits for plan approval before starting (Cognition, Dec 2024
  <https://cognition.com/blog/dec-24-product-update-2>) **[snippet]**. Lesson:
  **plan approval is a per-user setting, not a global behaviour.**
- **Warp Oz web app:** documented as working "on mobile devices for monitoring
  from anywhere" (Warp docs, oz-web-app page) **[snippet; no native app]**.
  Lesson: monitoring-only is a viable v0 - but not our bar.

## 9. Cross-cutting findings

1. **Pairing converges on "scan a QR shown by the computer".** Codex, Claude,
   Happy all do it; it is one gesture and needs no typed secret. Local
   Operator's equivalent is *Sign in with Radient*, which needs no QR because
   the account already knows the user's computers - **strictly better if
   discovery is reliable**, worse when the user hasn't set up a tunnel yet
   (no QR to fall back on). The no-tunnel path (flows.md §2) is the highest
   leverage onboarding work.
2. **Push is table stakes and is opt-in, presence-aware, and reason-specific.**
   Claude distinguishes "needs action" from "Claude decides"; suppress while
   the user is at the machine. Local Operator's relay has no push today
   (`docs/mobile.md` non-goals); the native app should ship *local
   notifications driven by the SSE stream while foregrounded/background-fetch*
   first and design for server push later (open decision D-2 in flows.md).
3. **Approvals are the reason people open the app.** Every product treats the
   pending decision as the top item. The failure pattern to avoid is Happy's
   raw JSON yes/no.
4. **Steer/queue/stop semantics must be explicit.** Replit is the reference.
   Local Operator already has `prompt`/`steer`/`abort`; the native composer
   should show which one a send will do and expose the queue.
5. **Diff review is table stakes for cloud agents but secondary for
   local-computer agents.** Codex and Claude both added phone diff review with
   inline comments *late* (2026-06 / earlier). Local Operator's transcript
   already carries per-tool diff counts and lines; a dedicated review surface
   is a v1.1 candidate, not launch scope.
6. **Offline/asleep host is the #1 support burden** (Codex troubleshooting is
   mostly this). Best practice: show the computer with last-seen and a named
   reason. Local Operator's gateway already emits typed 503 reasons
   (`RELAY_DETAIL`); no competitor exposes anything that specific.
7. **Cache-first cold start** (Cursor) and **Live Activities** (Cursor,
   Replit) are the iOS-native differentiators over PWAs. Android equivalents:
   ongoing notification / foreground service (policy risk; see store docs).

## 10. What to copy / improve / avoid (feeds principles.md)

| Copy | Improve on | Avoid |
|---|---|---|
| Host list as home (Codex, Claude) | Explain *why* a computer is unavailable (typed reasons) | Raw JSON approvals (Happy) |
| Cache-first cold start (Cursor) | Show cache age honestly | Terminal ritual for pairing (Claude spacebar QR) |
| Visible message queue (Replit) | Make steer/stop a one-tap, thumb-zone control | Vendor-account lock-in for a private machine |
| Named failure + single remedy (Claude) | Offer the remedy as a button where the phone can act | Silent pause when the host sleeps (Codex) |
| Presence-aware push (Claude) | Group by computer | Hidden mode switches |
| Persistent drafts, offline machines with last-seen (Happy) | Survive app kill and ambiguous send | iOS-only features on a cross-platform promise (Cursor) |
| Prompt-first start form, options in dropdowns (Copilot) | Folder picker with recents | PR-shaped session list (Copilot) |
