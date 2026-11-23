# Community mobile client: evidence (PR #317)

Captured 2026-11-18. The real exported web bundle (`EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES=1 EXPO_PUBLIC_COMMUNITY=1 expo export --platform web`) ran in the Local Operator browser tab at 390×844, served by `tools/mock-team-bridge.ts`. Its `/mock-community/*` route passed through to a **local agent-server in `SERVER_MODE=community`** (`feat/community-dm` @ `5cd324ec`). That server used `COMMUNITY_CLASSIFIER=fake`, a fake introspection endpoint, and a local Mongo replica set and Redis. Every community answer in these frames is the real server's; the private Team Bridge rows come from the hub fixture.

| Frame | What it shows |
| --- | --- |
| 01-directory-light | "Browse communities…": featured, not joined |
| 02 / 03-join-*-light | Join sheet: guidelines 2026-11 and the agreement, unchecked (Join disabled) and then ticked |
| 04-home-light | After the real join: the 5 provisioned channels, Browse, Requests, and an empty DM section |
| 05-refused-light | `FAKE-DENY-SPAM` → 422 shown to the sender only: "Not posted: Spam or undisclosed promotion", reference `MOD-…`, draft kept |
| 06-published-light | A clean send: published, in history, draft cleared |
| 07-limited-light | Probation 429 `retry_after: 60`: countdown, Retry disabled until it ends, draft kept |
| 08-requests-dm-dark | An incoming DM request (sent by another member) with Accept / Decline / Block at 48 px. Accept here was confirmed server-side (request `accepted`, DM conversation created) |
| 09-approval-stub-dark | Content-free agent approval stub (M6): "Review on your computer" and "Don't post" |
| 10-switcher-groups-light | Amendment A: Organizations (private, with the private unread total), then a separate Communities group and "Browse communities…" |

`real-server-transcript.md` covers the client and store run directly against the same server (Node, no UI), request by request. Tokens are omitted; idempotency keys are truncated.

The left-hand JSON in each frame is the `__phone` geometry readout: viewport, root size, and each control's box.

## Review round 1 remediation (captured 2026-11-18, head `0d9cafdb` plus this evidence)

Same rig, rebuilt: web export of `0d9cafdb` (`EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES=1 EXPO_PUBLIC_COMMUNITY=1`), `tools/mock-team-bridge.ts` with `MOCK_COMMUNITY_UPSTREAM` → a fresh local agent-server `SERVER_MODE=community` (`feat/community-dm` @ `ffe175ad`, `COMMUNITY_CLASSIFIER=fake`), a disposable single-node Mongo replica set, Redis and a loopback stand-in for the private introspection/profile routes. Four members joined through the real API; their Radient names passed the real (fake-classifier) name screen, so authors show approved names. All of it was torn down by pid afterwards.

| Frame | Finding | What it shows |
| --- | --- | --- |
| 11-conversation-avatars-light | D1, D5, R1-7 | Initials avatar per author run (Bob's two posts share one header); each avatar is a 48×48 "View profile for …" target (geometry pane) |
| 12-conversation-avatars-dark | D1 | The same, dark |
| 13-attach-images-note-dark | D3 | The attach control beside Send; tapping it shows "Images can't be posted in communities yet" and opens no picker |
| 14-conversation-ur | D1, D2 | Urdu: avatars on the leading (right) edge |
| 15-home-ur | D2 | Urdu home: each Latin channel name sits next to its `#`, unread pills on the trailing edge |
| 16-people-ur | D1, D2 | Urdu People: avatar, name and title per member |
| 17-switcher-community-checked-dark | R1-3, D4 | The switcher opened from the community header: one heading style, one column, pill then check; the community is the single checked row |
| 18-requests-days-title-light | R1-9, D6 | DM request with avatar and the sender's title (tap opens the profile); "Expires in 7 days" |
| 19-opening-community-only-light | R1-3 | `case=plan_required` (no private org) opening `/team-bridge` lands in the joined community (Amendment A rule 7) |
| 20-deleted-message-gone-light | R1-2 | Bob deleted "Release notes are in…" through the real API while this screen was open; the events refresh removed it (compare frame 11) |
| 21-home-load-failure-light | D7 | Server stopped: a read failure says "Couldn't load this right now. Check your connection and try again." |

R1-1 against the same server (no UI: a long-press cannot be driven by the browser tool): a DM message reported as `message` → **400** "report a direct message with target_kind dm and your consent to share it"; as `dm` with `dm_consent: true` and a stale `revision` → **409** `revision_changed`; with the read revision → **201** `CASE-EKDG-UV6V`; the same idempotency key again → **201** the same `CASE-EKDG-UV6V`, and `community_cases` holds 1 row. `client.test.ts` pins that the client sends exactly that body.
| 22-general-ur-nonlatin-avatars-light | D11 | Urdu #general: ثنا ملک shows ث, प्रिया शर्मा shows प्रि (the whole character cluster), Анна Петрова shows А; Latin names unchanged (BO, AL, DT). Contrast 6.41:1. Rendered by the round-3 designer at `b7fc6302`. |
| 23-general-ur-nonlatin-avatars-dark | D11 | The same, dark (6.13:1). |
| 24-people-ur-nonlatin-avatars-light | D11 | Urdu People list: non-Latin marks centred in their circles; rows mirrored right-to-left. |
| 25-switcher-community-only-light | D12 | Reader with no private org: no empty "ORGANIZATIONS" heading; only the Communities group, with the community checked. |
| 26-switcher-community-only-dark | D12 | The same, dark. |
