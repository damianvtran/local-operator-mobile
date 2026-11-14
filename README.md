# Evidence — fix/no-terminal-refusals (M1)

Rendered frames for the PR, base `d5831603` (`before__*`) vs head `dc89dbd7`
(`after__*`; head `b4ea8442` adds only the U-08 pin re-derivation).
390x844 CSS px at 2x, light and dark, real web build served by Metro
(`expo start --web`), captured by headless Chrome through the repo's own
launcher (`tools/lib/chrome.ts`: mock keychain, own process group, reaped).

How: `rig/zz-m1-evidence.tsx` was dropped UNTRACKED into `app/(auth)/` in each
tree, so the real root layout (theme, i18n, direction, text scale) renders the
tree's own `refusalFromError` -> `RefusalSurface` (and `SetupComputer`) from the
same inputs; `/own-tunnel` is the real screen. `rig/capture.ts` drove it.
`*__innerText.md` is each frame's `document.body.innerText`.

The 403 rows use a session-mint `TunnelSessionError("disabled")` with the
chosen computer's discovery row: active=false (phone access off),
active+!eligible (balance out), suspended+eligible, status disabled, status
reconciling.

## Scope additions (head 58b41133, re-pinned at aef48d84)

`*reason-*`, `*kind-*` and `*settings-diagnostics*` frames: gateway 503 bodies in
core C1's shape (`{detail, reason, kind, error}`) through each tree's
`relayErrorFromResponse` → `refusalFromError` → `RefusalSurface`, and the real
Settings screen with only `route`/`tunnelId` seeded into the connection store.
`rig/capture-additions.ts` drove them; the scratch route in `rig/` is the
updated one.
