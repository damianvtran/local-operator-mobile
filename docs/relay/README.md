# Relay mapping (`docs/relay/`)

The relay-facing contract the native client is built against, plus the captured
wire samples its tests can use.

| File | What it is |
| --- | --- |
| [`contract.md`](contract.md) | Every daemon route, the SSE streams, the command vocabulary, idempotency, states and errors — cited to the local-operator source. **Start here.** |
| [`types.ts`](types.ts) | A TypeScript declaration draft of every request/response/event type, annotated with its source line. |
| [`feature-map.md`](feature-map.md) | Every feature and every session state the client must cover, each with a priority and the routes it uses, plus a traceability table for QA. |
| [`tunnel-edge.md`](tunnel-edge.md) | What a native client sees through the Radient tunnel edge and the local gateway: headers, cookies, the 60-second stream cap, and every failure shape. |
| [`../../fixtures/relay/`](../../fixtures/relay/) | Real and synthetic wire samples, with their provenance and reproduction steps. |

The relay is defined by the local-operator repository (`docs/mobile.md`,
`docs/tunnels.md`); this directory does not redefine it. Where the shipped mobile
web client and the relay's own documentation disagree, both are recorded and the
code is taken as the truth — see `feature-map.md` §5.
