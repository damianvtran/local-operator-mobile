# Mobile community client → local agent-server community mode

Run 2026-11-18T13:10:26.536Z

## 1. Not a member yet: list, bootstrap, stale-version join
- [ada] GET /community/v1/communities → **200** {"joined":[],"featured":[{"id":"local-operator-community","slug":"local-operator","name":"Local Operator Community","state":"active"}]} 
> joined=0 featured=local-operator-community
- [ada] GET /community/v1/communities/local-operator-community/bootstrap → **200** {"community_id":"local-operator-community","community":{"id":"local-operator-community","slug":"local-operator","name":"Local Operator Community","state":"active"},"guidelines":{"version":"2026-11","text":"Be kind and co
> guidelinesStep=join
- [ada] POST /community/v1/communities/local-operator-community/join → **409** {"code":"guidelines_changed","message":"guidelines version is no longer current","guidelines_version":"2026-11"} 
- [ada] GET /community/v1/communities/local-operator-community/bootstrap → **200** {"community_id":"local-operator-community","community":{"id":"local-operator-community","slug":"local-operator","name":"Local Operator Community","state":"active"},"guidelines":{"version":"2026-11","text":"Be kind and co
> join(2026-10) → changed

## 2. Explicit join with the current version
- [ada] POST /community/v1/communities/local-operator-community/join → **200** {"community_id":"local-operator-community","community":{"id":"local-operator-community","slug":"local-operator","name":"Local Operator Community","state":"active"},"guidelines":{"version":"2026-11","text":"Be kind and co
> join(2026-11) → joined
- [ada] GET /community/v1/communities → **200** {"joined":[{"id":"local-operator-community","slug":"local-operator","name":"Local Operator Community","state":"active"}],"featured":[]} 
- [ada] GET /community/v1/communities/local-operator-community/direct-conversations → **200** {"items":[]} 
- [ada] GET /community/v1/communities/local-operator-community/directory/channels?filter=joined → **200** {"items":[{"id":"6afd9bebbb873631820af5e1","name":"welcome-and-rules","purpose":"Start here (read-only)","visibility":"public","locked":false,"archived":false,"member":true,"unread":0,"posting":"staff","channel_admin":fa
- [ada] GET /community/v1/communities/local-operator-community/directory/channels?filter=joined → **200** {"items":[{"id":"6afd9bebbb873631820af5e1","name":"welcome-and-rules","purpose":"Start here (read-only)","visibility":"public","locked":false,"archived":false,"member":true,"unread":0,"posting":"staff","channel_admin":fa
> joined channels: #welcome-and-rules(staff) #general #help #feedback #show-and-tell
- [ada] GET /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/messages → **200** {"items":[{"id":"6afd9dd21146cad3ca4fa8bf","conversation_id":"6afd9bebbb873631820af5e3","seq":4,"revision":1,"author":{"kind":"human","public_id":"myiichjwzjz9d","display_name":"New member · 1164","agent_handle":null},"t

## 3. Published
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key e0Ih9XIE…) → **200** {"idempotency_key":"e0Ih9XIE4ZVk2AIOqkaJsDtIP5l7SIxn","state":"published","message_id":"6afda3c21146cad3ca4fa8d2","refusal":null} 
> send "Hello from the phone rig" → attempt=none (published) draft=""
> history: "Hello from the phone rig", "fourth post within the minute", "replay me", "Welcome, Ada!"

## 4. Refused (sender-only category + reference; draft kept)
- [ada] GET /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/messages → **200** {"items":[{"id":"6afda3c21146cad3ca4fa8d2","conversation_id":"6afd9bebbb873631820af5e3","seq":5,"revision":1,"author":{"kind":"human","public_id":"muw9ivyqyvwu6","display_name":"New member · 4941","agent_handle":null},"t
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key uLRijj2S…) → **422** {"status":"refused","category":"spam_or_promotion","reference":"MOD-J5ZL-ZKD4"} 
> send "FAKE-DENY-SPAM buy now" → attempt={"kind":"refused","category":"spam_or_promotion","reference":"MOD-J5ZL-ZKD4"} draft="FAKE-DENY-SPAM buy now"
- [bob] GET /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/messages → **200** {"items":[{"id":"6afda3c21146cad3ca4fa8d2","conversation_id":"6afd9bebbb873631820af5e3","seq":5,"revision":1,"author":{"kind":"human","public_id":"muw9ivyqyvwu6","display_name":"New member · 4941","agent_handle":null},"t
> bob's view of #general: "Hello from the phone rig", "fourth post within the minute", "replay me", "Welcome, Ada!", "Hello from the phone rig"

## 5. Moderation unavailable, Retry reuses the key
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key KfCEFPsg…) → **503** {"message":"moderation is unavailable; nothing was published","code":"moderation_unavailable","retry_after":null} 
> send "FAKE-UNAVAILABLE please" → attempt={"kind":"unavailable","retryAt":null} draft="FAKE-UNAVAILABLE please"
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key KfCEFPsg…) → **503** {"message":"moderation is unavailable; nothing was published","code":"moderation_unavailable","retry_after":null} 
> after Retry: state={"kind":"unavailable","retryAt":null} sameKey=true
- [ada] GET /community/v1/communities/local-operator-community/submissions/KfCEFPsgJBYNCLbCLqH-iMU34Ni6fGaH → **200** {"idempotency_key":"KfCEFPsgJBYNCLbCLqH-iMU34Ni6fGaH","state":"expired","message_id":null,"refusal":null} 
> GET submission(KfCEFPsg…) → {"idempotency_key":"KfCEFPsgJBYNCLbCLqH-iMU34Ni6fGaH","state":"expired","message_id":null,"refusal":null}

## 6. Probation limit (3/min for a new member), Retry after retry_after reuses the key
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key UsgKLTao…) → **429** {"message":"you're sending faster than the community allows; try again shortly","retry_after":60,"scope":"probation"} 
> send "second post" → attempt={"kind":"limited","retryAt":1795007486778} draft="second post"
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key 3Nfqers_…) → **429** {"message":"you're sending faster than the community allows; try again shortly","retry_after":60,"scope":"probation"} 
> send "third post" → attempt={"kind":"limited","retryAt":1795007486791} draft="third post"
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key kSLMP-lG…) → **429** {"message":"you're sending faster than the community allows; try again shortly","retry_after":60,"scope":"probation"} 
> send "fourth post within the minute" → attempt={"kind":"limited","retryAt":1795007486805} draft="fourth post within the minute"
> waiting 60 s for the window
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key kSLMP-lG…) → **200** {"idempotency_key":"kSLMP-lGoQYi_D7efk5f9qbp_ohTIUD_","state":"published","message_id":"6afda4001146cad3ca4fa8d4","refusal":null} 
> Retry with key kSLMP-lG… → published

## 7. Replay of a published key returns the stored outcome (no second message)
- [ada] GET /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/messages → **200** {"items":[{"id":"6afda4001146cad3ca4fa8d4","conversation_id":"6afd9bebbb873631820af5e3","seq":6,"revision":1,"author":{"kind":"human","public_id":"muw9ivyqyvwu6","display_name":"New member · 4941","agent_handle":null},"t
- [ada] GET /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/messages → **200** {"items":[{"id":"6afda4001146cad3ca4fa8d4","conversation_id":"6afd9bebbb873631820af5e3","seq":6,"revision":1,"author":{"kind":"human","public_id":"muw9ivyqyvwu6","display_name":"New member · 4941","agent_handle":null},"t
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key replayke…) → **200** {"idempotency_key":"replaykey-rig-000000000001","state":"published","message_id":"6afda4001146cad3ca4fa8d6","refusal":null} 
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key replayke…) → **200** {"idempotency_key":"replaykey-rig-000000000001","state":"published","message_id":"6afda4001146cad3ca4fa8d6","refusal":null} 
- [ada] GET /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/messages → **200** {"items":[{"id":"6afda4001146cad3ca4fa8d6","conversation_id":"6afd9bebbb873631820af5e3","seq":7,"revision":1,"author":{"kind":"human","public_id":"muw9ivyqyvwu6","display_name":"New member · 4941","agent_handle":null},"t
> first={"idempotency_key":"replaykey-rig-000000000001","state":"published","message_id":"6afda4001146cad3ca4fa8d6","refusal":null} second={"idempotency_key":"replaykey-rig-000000000001","state":"published","message_id":"6afda4001146cad3ca4fa8d6","refusal":null} messages 6→7

## 8. Staff-only channel refuses a member
- [ada] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e1/submissions (Idempotency-Key v2389Ixd…) → **403** {"message":"only staff and moderators post here"} 
> send "can I post here?" → attempt={"kind":"forbidden","reference":null} draft="can I post here?"

## 9. Events: Bob posts, Ada's open thread refreshes from conversation_changed
- [ada] GET /community/v1/communities/local-operator-community/events → **200** {"events":[],"next":"rXbhhKwYefhBvP-47gJQNkppB74ybIIxMzBEZ5pLiRV7InYiOiIwODI0ZWNjNWFiYjBiZDBjY2EzYjZhZWZlZDA1ZDZjYmEzNjBlY2NkYTMxMjczZmQ0YjE1OGJhN2Y0NzgyZGE5IiwiciI6ImV2ZW50czpsb2NhbC1vcGVyYXRvci1jb21tdW5pdHkiLCJzIjo4LCJ
- [bob] POST /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/submissions (Idempotency-Key 8MUnft0F…) → **200** {"idempotency_key":"8MUnft0FzbY40arJZOxorqi8QbxW3lje","state":"published","message_id":"6afda4011146cad3ca4fa8d8","refusal":null} 
> send "Welcome, Ada!" → attempt=none (published) draft=""
- [bob] GET /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/messages → **200** {"items":[{"id":"6afda4011146cad3ca4fa8d8","conversation_id":"6afd9bebbb873631820af5e3","seq":8,"revision":1,"author":{"kind":"human","public_id":"myiichjwzjz9d","display_name":"New member · 1164","agent_handle":null},"t
- [ada] GET /community/v1/communities/local-operator-community/events?after=rXbhhKwYefhBvP-47gJQNkppB74ybIIxMzBEZ5pLiRV7InYiOiIwODI0ZWNjNWFiYjBiZDBjY2EzYjZhZWZlZDA1ZDZjYmEzNjBlY2NkYTMxMjczZmQ0YjE1OGJhN2Y0NzgyZGE5IiwiciI6ImV2ZW50czpsb2NhbC1vcGVyYXRvci1jb21tdW5pdHkiLCJzIjo4LCJlIjp0cnVlfQ → **200** {"events":[{"type":"conversation_changed","conversation_id":"6afd9bebbb873631820af5e3"}],"next":"Vbdf34DQZYWbGyLhZMTgCydvJgR-5Jw93LGe_7llC_Z7InYiOiIwODI0ZWNjNWFiYjBiZDBjY2EzYjZhZWZlZDA1ZDZjYmEzNjBlY2NkYTMxMjczZmQ0YjE1OGJ
- [ada] GET /community/v1/communities/local-operator-community/conversations/6afd9bebbb873631820af5e3/messages → **200** {"items":[{"id":"6afda4011146cad3ca4fa8d8","conversation_id":"6afd9bebbb873631820af5e3","seq":8,"revision":1,"author":{"kind":"human","public_id":"myiichjwzjz9d","display_name":"New member · 1164","agent_handle":null},"t
> ada's thread 6→8; newest="Welcome, Ada!"

## 10. People directory, profile card, DM request accept, block
- [bob] GET /community/v1/communities/local-operator-community/directory/people?q=Ada → **200** {"items":[],"next_cursor":null} 
> bob searches "Ada" → 0 result(s)
- [ada] GET /community/v1/communities/local-operator-community/directory/people?q=Bob → **200** {"items":[],"next_cursor":null} 
- [ada] GET /community/v1/communities/local-operator-community/profiles/ → **404** {"message":"Not Found"} 
> ada reads bob's card → {"name":"CommunityError","kind":"not_found","status":404,"code":null,"retryAfterMs":null,"scope":null,"refusal":null,"guidelinesVersion":null,"reference":null}
- [ada] GET /community/v1/communities/local-operator-community/requests?kind=dm → **200** {"items":[],"next_cursor":null} 
> ada incoming: 
- [ada] GET /community/v1/communities/local-operator-community/direct-conversations → **200** {"items":[]} 
> ada DMs: []
> ada pending after: 0

## 11. Agent approval stub (opened by the computer), answered Don't post from the phone
- [setup, as the computer would] POST agent-approvals → 201 {"approval_id":"6afda4021146cad3ca4fa8da","target_kind":"channel","channel_id":"6afd9bebbb873631820af5e3","state":"pending","answered_surface":null,"created_at":"2026-11-18T13:11:30.420643Z","expires_
- [ada] GET /community/v1/communities/local-operator-community/agent-approvals → **200** {"items":[{"approval_id":"6afda4021146cad3ca4fa8da","target_kind":"channel","channel_id":"6afd9bebbb873631820af5e3","state":"pending","answered_surface":null,"created_at":"2026-11-18T13:11:30.42Z","expires_at":"2026-11-1
> ada approvals: [{"state":"pending","channel_id":"6afd9bebbb873631820af5e3","expires_at":"2026-11-19T13:11:30.42Z"}]
- [ada] POST /community/v1/communities/local-operator-community/agent-approvals/6afda4021146cad3ca4fa8da:answer → **200** {"approval_id":"6afda4021146cad3ca4fa8da","target_kind":"channel","channel_id":"6afd9bebbb873631820af5e3","state":"declined","answered_surface":"mobile","created_at":"2026-11-18T13:11:30.42Z","expires_at":"2026-11-19T13:
- [ada] GET /community/v1/communities/local-operator-community/agent-approvals → **200** {"items":[{"approval_id":"6afda4021146cad3ca4fa8da","target_kind":"channel","channel_id":"6afd9bebbb873631820af5e3","state":"declined","answered_surface":"mobile","created_at":"2026-11-18T13:11:30.42Z","expires_at":"2026
> declineApproval → null
> after: [{"state":"declined","answered_surface":"mobile"}]

## 12. Report a message
- [ada] POST /community/v1/communities/local-operator-community/reports (Idempotency-Key sWXVaBrc…) → **201** {"case_reference":"CASE-RMC7-NWWV","state":"submitted"} 
> report(6afda4011146cad3ca4fa8d8) → {"reference":"CASE-RMC7-NWWV"}

Done.
