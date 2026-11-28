# Radient Guard M1 (mobile) — rendered evidence

Frames are real renderings of the Expo **web export** of this branch in headless
Chrome (390x844 @ 2x-ish CSS viewport, `--use-mock-keychain`, one browser reaped
by process group), driven against the repo's mock relay with its Guard twin
(`tools/mock-relay/guard.ts`). `capture-frames.ts` is the driver; `report.json`
holds the request-ledger checks. These are NOT iOS/Android simulator frames and
the relay twin is a mock: no host serves `/api/guard*` yet (see `docs/guard.md`).

Checks recorded in `report.json` (host-side ledger from `/__mock/guard-log`, plus
the browser's own network log):
- answer pressed inside the 500 ms debounce: 0 accept/decline requests;
- "Decide later": row still pending, 0 answer requests;
- Share: GET /api/guard, GET /api/guard/consents/{id}, POST .../accept with ONLY
  `request_digest` + `disclosure_digest`, then a status re-read; no `/v1/guard`;
- non-Team owner: only `GET /api/guard` and `GET /api/guard/non-team-card`; no write;
- older relay (no `features.guard`): the browser made zero Guard requests.
