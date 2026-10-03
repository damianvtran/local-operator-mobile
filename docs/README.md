# Documentation

Local Operator Mobile is past the research and design stage: the app is built and
exercised in this repository, though no build has been published yet. This index
lists the documentation sections.

| Path | What it holds | Status |
| --- | --- | --- |
| `docs/adr/` | Architecture decision records: the app toolchain, connection and authentication, the e2e and audit harness, the CI/CD pipeline, queued asks, and push notifications. | 0001–0006 written |
| `docs/relay/` | How the app talks to the Local Operator mobile relay and the Radient tunnel: auth, streaming, reconnects. | in progress |
| `docs/e2e/` | The mock relay, the frame harness and the audit checker, and what each one can prove. | written |
| `docs/ux/` | UX research, the target flows, principles, and the audit rubric the frames are scored against. | written |
| `docs/design/` | The design system the app's styling layer is generated from: brand kit, components, tokens and previews. | written |
| `docs/publishing/` | Requirements for the App Store, Google Play, and other stores, plus the release pipeline. | written; `checklist.md` tracks what each store still needs |
| `design/` | The design and brand kit, built from real Local Operator assets: tokens, fonts, app icons and previews. | written; the app's stylesheet and token module are generated from it |
| `store/` | Store listing copy, screenshots, and other store assets. | draft — nothing submitted |

Brand source files used by the README live in [`docs/assets/brand/`](./assets/brand/).

For the computer side — the `lop mobile` relay and `lop tunnel` connector — see the
Local Operator docs for [tunnels](https://github.com/damianvtran/local-operator/blob/main/docs/tunnels.md)
and the [mobile relay](https://github.com/damianvtran/local-operator/blob/main/docs/mobile.md).
