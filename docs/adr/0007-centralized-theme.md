# ADR 0007 — One source of truth for the brand theme

- **Status:** Proposed (for implementation)
- **Date:** 2026-10-11
- **Deciders:** the maintaining team; the extraction moves a document the site repository owns
  today, so the new home and its licence are the operator's call (see "Coordination items")
- **Depends on:** [ADR 0001 — Framework](0001-framework.md) (its styling sub-decision is why the
  token layer lives in this repository at all), [ADR 0003 — E2E and audit harness](0003-e2e-and-audit-harness.md)
- **Related:** [`docs/design/brand-kit.md`](../design/brand-kit.md) (§ 0.1 provenance, § 2.1 the
  accent divergence), [`docs/design/styling-layer.md`](../design/styling-layer.md),
  [`design/README.md`](../../design/README.md); the site's `docs/design-kit/`; the desktop app's
  `docs/branding.md`; the core's `local_operator/tui/theme.py`
- **Amends:** [`docs/design/brand-kit.md`](../design/brand-kit.md) § 0.1's "Three artefacts already
  exist" table — the registration of a fourth upstream (the kit repository itself) supersedes the
  hand-port it describes. The table is otherwise unchanged; § 2.1's mapping decision stands, and the
  `$meta.accentDivergence` measurement moves into the kit's divergence register when phase 2 lands
  (referenced from here, not restated).

**Provenance.** Every cross-repository citation below is stated at a named revision and was resolved
with `git show <ref>:<path>`, never from a working tree — the shared checkouts on the reference
machine drift (two of the three sibling checkouts sat on feature branches or hundreds of commits
behind when this was written, and one of them reads differently at its branch than at `main`). The
refs: site `b936429d`, desktop UI `0196797f`, core `bad42845`; this repository `10143be8`. Line
numbers are a receipt of one reading; re-resolve before relying on any.

## Context

### Five surfaces, and where each one's theme is written

| Surface | Repository | Where its theme lives | Visibility |
|---|---|---|---|
| Marketing site | `local-operator-site` | `src/index.css` `@theme` block; the distillation in `docs/design-kit/` | **private** |
| Desktop app | `local-operator-ui` | `src/renderer/src/shared/themes/palettes/*.ts` → generated `themes.generated.css` | public |
| TUI | `local-operator` (core) | `local_operator/tui/theme.py` (`BRAND_TOKENS`) + `local_operator/tui/palettes/*.py` | public |
| Phone web client | `local-operator` (core) | `local_operator/mobile/web/src/themes/*.ts` | public |
| **Mobile app** | **this repository** | `design/tokens/tokens.json` → generated preset, `theme.css` and `tokens.gen.ts` | public |

Each repository correctly calls its own file the source of truth — in-repo. `design/README.md:9`
calls `tokens.json` "The source of truth"; the desktop's `docs/branding.md:46` says
`palettes/*.ts` is "the single source of truth" under a heading that reads "One source, two
consumers. Do not add a third." (`:36`); the TUI's `theme.py:1` says `BRAND_TOKENS` is "the single
source of truth". The problem this ADR addresses is not any one of those statements. It is that
between the five, the brand register is re-written by hand five times, and nothing checks a single
one of the hops.

### Every hop is a hand-port

| Hop | Form | What holds it |
|---|---|---|
| site → desktop app | Values copied into two TS palettes | `palettes/local-operator.ts:59`, "Verified 2026-08-04 against docs/design-kit/tokens.json in the site repo", and `:226` (light); the two sanctioned deviations are written out at `:14-29`. The file's own precedence: "a brand colour changes in the kit and is followed here, never the other way round." |
| site → TUI | Values copied into `BRAND_TOKENS` | `theme.py:5-6` — "Values are the island palette from the brand kit"; `:22-23` — "Hex values are exact brand kit values and are asserted by tests — do not round or re-solve them." The tests assert the ramps against *themselves*. |
| desktop app → this app | Values copied into `tokens.json` | `$meta.derivedFrom` (three upstreams, versions and dates) and `$meta.accentDivergence`. The most careful provenance in the family — and a receipt, not a mechanism. |
| TUI → desktop app (the community set) | The TUI's curated palette families re-expressed in the desktop's palette files | `docs/branding.md:473` — "These palettes are ports of the TUI's token set". |
| desktop app → core phone client | A verbatim copy of the file, docstring included | `local_operator/mobile/web/src/themes/local-operator.ts` at the pinned ref. |

**No script, test or CI job in any of the five repositories reads another repository's theme
values.** The cross-references that do exist between these repositories read behaviour or cite
documents (the desktop's `docs/evidence/tui-parity/` pages, its `tool-row` and `ask-options`
scripts), not colours. Parity today is held by prose provenance with dates, "verified on
<date>" audit comments, and the reviewers who remember them.

### The mobile app's fork specifically

This app is the newest surface, and it did the documentary half of this right: `tokens.json`'s
`$meta.derivedFrom` names all three upstreams, and `$meta.accentDivergence` records the one value
where two of them disagree and measures why. But the app's three gates — `preset:check`,
`theme:check`, `contrast:check` — compare the app's generated artefacts against the app's own
`tokens.json`, and nothing else. `scripts/build-theme.ts:28-35` makes the app's own palettes
incapable of disagreeing with the kit's preset *inside this repository*; no check here can see a
change in any other repository. When the desktop palette next moves — its own file records a
legibility pass that re-seated eleven roles in one go — the mobile copy goes stale silently, which
is the failure `scripts/build-theme.ts:23-26` names one level down: "a colour changed in the tokens
and not in the app ships as a theme that half applies."

### The visibility seam

The site is **private**; this app, the desktop app and the core are **public**. A public
repository's CI cannot fetch a private one — no credentials belong in public CI, and workflows on
fork pull requests must never hold them — so the site cannot be the mechanically consumable home
for any of the other four surfaces. And the one artefact in the family written to travel lives
inside that private repository: the site's kit is "a portable distillation … written so that a
team on a **different stack, in a different repository, with none of this repo's context** can
rebuild the register faithfully" (`docs/design-kit/README.md:3-6` at the pinned ref — note it is
also the site's *portable* copy: the site's shipped stylesheet is `src/index.css`, and the kit
files were "generated by hand from the shipped theme block" on 2026-08-03, `tokens.css:7`).

### What "one source" would mean, precisely

Not one file for everything. The surfaces share a **register** and legitimately differ in three
other layers:

- **Shared (the register):** the role contract (names and meaning — the app family's 38 roles,
  `palette-contract.ts:43`); the brand colour values for the two ramp families; the contrast
  floors; the measurement conventions (ratio method, L\* ladder rules).
- **Local (stays per surface):** this app's touch geometry, type ramp, safe areas and motion
  budgets; the site's marketing-only grounds (`band`, the always-dark islands); the TUI's raw
  token vocabulary; the community palette sets; and each surface's contrast-contract enumeration —
  the mobile contract already states that its tables are "SHARED in spirit with the site's" and
  that the enumeration is the local part (`contrast-contract.mjs:11-17`).
- **Two ramp families, not one.** The register carries both, because the differences are
  functional and measured: the light accent (`#177b45` on the page family vs `#137742` on the app
  family — the page value fails this app's ground ramp: 4.27 on `sunken`, 4.29 on `row-selected`,
  both under the 4.5 floor, `brand-kit.md` § 2.1); the light ground ramps (the app family's is
  deliberately wider — this app stacks four grounds where a page renders one); `info` (an app-family
  role the page family does not have, `local-operator.ts:27`); and the dark grounds (the island
  `#14110c` on the site and TUI, the app's warm near-black `#22201c` on the desktop and here).
  A centralisation that flattens these into one palette would fail the app's own contrast contract
  on the day it lands.

## Decision

**Extract the site's design kit into a new public repository — `damianvtran/local-operator-design`
(name open to the operator) — as the home of record for the shared brand register, and switch every
surface to a pinned vendored slice with a parity gate. This app's generators and committed
artefacts do not change shape; only the provenance of its brand layer does.**

In full:

1. **The repository carries** the kit as it exists (provenance preserved with a
   `git filter-repo` split so history follows the files), plus two additions: an **app-family
   file** carrying the two brand palettes' values and the 38-role contract as data (sourced from
   the desktop's `local-operator.ts` / `palette-contract.ts` at the pinned ref), and a
   **divergence register** promoting the sanctioned differences from the three prose sites that
   record them today (`brand-kit.md` § 2.1, `local-operator.ts:14-29`, `tokens.json
   § accentDivergence`) into one checked list. The kit keeps its defining property: plain files,
   no build step, no dependencies — the one thing you run is the contract script.
2. **Consumption is a pinned slice plus a parity gate, never a build-time import.** Each consumer
   commits the kit files it consumes (byte copies under its own tree) and a lock naming the kit
   version, git ref and SHA-256 per file. Its CI proves two things: the slice equals the kit at
   the locked ref (a public→public fetch — no credentials, fork-safe), and the consumer's own
   token file derives from the slice (local, cheap). Builds stay hermetic; the app can still be
   built offline from committed files.
3. **This app, concretely.** Unchanged: `tailwind-preset.js`, `theme.css` and `tokens.gen.ts`
   stay committed generated artefacts, and the three `--check` gates keep failing on drift.
   Added: `design/tokens/upstream/` (the slice), `design-kit.lock.json`, one CI step in the
   design-kit job, and a parity check asserting the brand roles in `tokens.json` equal the slice's
   app-family values. `$meta.derivedFrom`'s token upstreams collapse into the kit; the phone
   client's entry stays the behavioural baseline it was, not a token source; `accentDivergence` moves into the kit's divergence register and is referenced from
   here, not restated.
4. **The site becomes a consumer of its own publication.** `docs/design-language.md` remains the
   editorial spec; the register's *values* live in the kit; the site's `src/index.css` gains the
   same parity check against the slice (a private repository may fetch a public one), and
   `docs/design-kit/` becomes a pointer. The precedence rule at `docs/design-kit/README.md:27` ("Where the two
   disagree, the spec wins for the website") stops being a silent precedence and becomes a named
   failing check when the two actually disagree — which is the same rule, made executable.
5. **No npm package in this pass.** The kit is consumed as files because that is what all five
   consumers can use (two are Python/CSS, two are JS with build pipelines that keep committed
   artefacts by convention). A package can be added later without moving anything; nothing in this
   decision blocks it.
6. **Versioning** continues the `tokens.json` lineage: v1.1.0 → v1.2.0 as the first release
   carrying the app family. Consumers pin tags; a pin bump is a deliberate PR in the consumer,
   with its reason recorded — the same discipline the dependencies section of `AGENTS.md` asks of
   any dependency.

### The mechanism, and why vendoring rather than fetching at build time

A build-time fetch would make every surface's build depend on network reachability of one
repository — including `pnpm theme:build` locally — which contradicts this repository's build-host
assumption ("Local iteration should work on a machine with only Node.js and pnpm", `AGENTS.md`)
and the pattern every generator here already follows: inputs committed, drift made a failing
`--check`. The pinned slice keeps that shape exactly. The parity gate is deliberately two checks,
because they fail for different reasons and a reviewer needs to know which one fired: *slice ≠
kit* is "the pin is lying"; *tokens.json ≠ slice* is "someone edited brand values in this
repository".

## What breaks first if this is skipped

1. **The first brand edit after today, whichever surface it lands on.** Nothing fails anywhere;
   the surfaces silently diverge until a human notices in a screenshot. The hot spot is the
   desktop palettes, whose own history is a sequence of legibility passes that each moved a
   handful of roles — every one of those is a change this app must mirror by hand, and the
   mirror is only as good as the person who remembers the `derivedFrom` table exists.
2. **The light-accent special case metastasises.** Three documents already carry a dissertation
   about one hex pair (`brand-kit.md` § 2.1, `tokens.json § accentDivergence`, `local-operator.ts`
   :14-29, plus the desktop branding doc). Without a home of record for sanctioned differences,
   the next deviation joins them, and the next reconciliation conversation starts from zero.
3. **The next palette-shaped feature.** `brand-kit.md` § 2.3 records the temptation: if a later
   pass wants the community themes, the current architecture invites a 59-palette hand-port. The
   migration should land before that feature is scoped, so the port becomes "consume the kit's
   next release" instead of 59 more hand-checks.

## Options considered

| # | Option | Verdict |
|---|---|---|
| A | **Status quo, documented harder.** Keep the five copies; add nothing executable. | **Rejected.** This is today, plus more prose. The operator's ask ("share the centralised theme … rather than carry its own fork") is exactly a request to stop relying on prose. |
| B | **The site kit stays the home of record** (private), public consumers keep vendoring by hand. | **Rejected.** A public repository cannot import from a private one. Any automated check would need credentials in public CI — fork-unsafe — or in a private sync runner, which is the least accountable component available. |
| C | **The desktop app's repository becomes the home.** It is public, already carries the role contract and the two brand palettes, and this app already copies from it. | **Rejected.** It holds only one family (the app family); the page/island family and the register's editorial parts are not there and would have to move *into* an application repository. Its release cadence is the app's, and a new consumer of the register would have to reach into `src/renderer/…` — an internal tree, not an interface. The desktop file's own "Do not add a third" rule (`branding.md:36`) is about the app's internal MUI/Tailwind pipeline, but its spirit — one home per concern — argues against stacking a product-wide register onto an app. |
| D | **The core repository becomes the home.** It is public, and it already declares the TUI's ramps canonical and hosts a shipped surface. | **Rejected.** The same layering argument: the core is the product's engine repository; a design register there inherits engine release cadence and Python-centric packaging, and the brand's editorial home (the site's `design-language.md`) still would not move. |
| E | **A new public repository, extracted from the site's kit** — the kit is already written as the portable distillation for exactly this use. | **Recommended.** It is reachable by every consumer (public and private alike), owned by none of the applications, and its extraction is a move of existing material, not an invention. |
| F | **An npm package from a new repository** (i.e. E with publishing). | **Deferred, not rejected.** It serves the two JS consumers and neither the Python nor the CSS-only ones, which would vendor anyway. Add it later if pinning proves to be friction; nothing in E forecloses it. |
| G | **Generate each consumer from the site at the operator's machine** (a local sync job opens PRs). | **Rejected as the primary mechanism.** It requires the operator's machine in the loop for every brand change, and it still leaves an uncheckable window between generations. It remains a fallback shape if the extraction stalls: it can only shrink the gap, and everything built for E (the slice shape, the parity check) is exactly what a local sync job would write. |

## Migration plan

| Phase | Who | Touch | Proves |
|---|---|---|---|
| 0 | operator | Sign-off on the home and licence (below) | The extraction is authorised |
| 1 | new repository | `git filter-repo` split of the site's `docs/design-kit/`; add the app-family file and the divergence register; CI = the kit contract + byte-consistency of `tokens.json`/`tokens.css`/`tokens.md` + the slice digests. Tag v1.2.0 | The kit is a working, gated artefact |
| 2 | this repository | `design/tokens/upstream/` slice + `design-kit.lock.json` + a parity check + the design-kit CI step; `brand-kit.md` § 0.1 and `tokens.json § $meta` updated to name the new upstream | A public consumer can hold the pin |
| 3 | desktop app | Same slice mechanism for the two brand palettes; `check-themes` gains the parity step; `branding.md` § 1's diagram updated | The largest surface follows |
| 4 | core | TUI: a test asserting `BRAND_TOKENS` equals the slice — replacing the self-assertion at `theme.py:22-23`; phone client: same as phase 3 | Both core surfaces follow |
| 5 | site | The same parity check on `src/index.css`'s register values; `docs/design-kit/` becomes a pointer; the editorial flow (below) is written into the kit's README | The origin consumes its own publication |
| 6 (later) | — | Community-set consolidation, fonts/mark/icons, and npm packaging if wanted | Separate changes, each with its own record |

Estimates (order-of-magnitude, not commitments): phase 1 is about a day including CI; phases 2-5
are hours each — a vendored file, a check and a CI step per repository, with the generators
otherwise untouched.

## Risks to watch during rollout

- **The pin becomes the new fork.** A parity gate makes the copy *checked*, but the version can
  still lag — a consumer staying pinned two kit releases back is a deliberate, visible state, not
  drift. Watch for pins that go stale *without* a recorded reason; the lock file's version is what
  makes that legible.
- **Scope creep into per-surface files.** The kit must not absorb touch geometry, marketing
  grounds or community palettes; the reverse flow (TUI community set → desktop) stays as it is.
  The register is colours, the role contract, the floors and the conventions — nothing else.
- **The editorial flow needs a stated direction.** Proposed: a register change starts in the kit
  (with its measurement and the divergence register updated if it adds a sanctioned difference);
  the site and every other consumer follow in the same wave, each behind its check. If the brand
  work prefers to start in the site's spec, the rule inverts cleanly — both directions work as
  long as the site's parity check exists, because that is the only hop the kit's own CI cannot
  see.
- **The divergence register must stay exhaustive.** A new sanctioned difference that lands in a
  consumer without a register entry is how option A's failure mode comes back. The parity check's
  failure message should name the register, so the escape hatch is documented at the point of
  failure.
- **Licence and history move is a real one-off.** The site repository carries no `LICENSE` file
  (`package.json` is `private`); the new repository needs an explicit licence before it is
  public. `local-operator-ui` and this repository are MIT, and the kit's content is written for
  external readers — MIT is the obvious proposal, but it is the owner's call, not this ADR's.
  Until sign-off, phases 2-5 cannot start and the drift window stays open — which is the cost of
  not doing this, not a reason to widen someone's rights by assumption.

## What this ADR does not decide

- **The community palette sets** (the TUI's 52 curated palettes, the desktop's 57 non-brand
  palettes, the phone client's copy, this app's future picker). They are ports in documented
  directions already; consolidating them is a larger change with its own measurements. Phase 6.
- **Fonts, the mark and the icon families.** The same one-source pattern applies (the kit already
  carries the typefaces; the mark is already traced from the site's `LogoMark`), but each needs
  its own provenance and licence work. Separate record.
- **The TUI's runtime theme system** (including the host-terminal-derived theme) — a consumer of
  the register, not part of it.
- **The desktop app's internal MUI/Tailwind split** — `branding.md:36`'s rule stands; this ADR
  adds a parity consumer *beside* `palettes/*.ts`, not a third colour pipeline inside the app.

## Coordination items

1. **Operator:** the home's name and licence (§ Risks, last item). Proposal:
   `damianvtran/local-operator-design`, MIT.
2. **Operator:** once phase 1 lands, the site's `docs/design-kit/` is removed there (history
   preserved by the split). The site's `design-language.md` stays where it is.
3. **The accent reconciliation stays a brand decision.** This ADR gives the divergence a home and
   a check; it does not reconcile `#177b45` / `#137742`, and the recorded measurement says
   reconciliation means changing one of the two ramps, not shipping the page value into the app.
