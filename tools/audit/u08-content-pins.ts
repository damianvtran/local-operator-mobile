/** Content-identity admission for the U-08 proofs.
 *
 * WHY NOT PATH DIFFS. Both proofs used to admit themselves with `git diff`
 * rules: "every path between REPAIR_BASE/ORIGINAL_HEAD and HEAD is in a fixed
 * allowlist", and "nothing under app/src/assets/design/config differs from
 * ORIGINAL_HEAD at all". Both ask "has anything changed since a fixed commit?",
 * which is not the question a proof asks, and both go stale the moment unrelated
 * work merges. Measured: hosted run 40179237342 died in preflight with "Source
 * differs outside the reviewed diagnostic-only scope" before it launched a
 * browser, because PR #109 added a test file and touched the instrument while PR
 * #110 added listing frames under design/store-screenshots. Neither changes a
 * measured pixel, and both are permanently outside such an allowlist.
 *
 * THE QUESTION WORTH ASKING is "is this still the same measurement of the same
 * scene?". Three content identities answer it and nothing else:
 *
 *  - INSTRUMENT_PINS: every module either proof loads at run time — the static
 *    value-import closure of both drivers, per file. That is the drivers
 *    themselves, the in-page probe, the canonical checks and U-08 policy, the
 *    paint and colour maths, the cell extractor, the browser/page/readiness
 *    helpers (they pick the binary, its flags and the emulated metrics), and the
 *    mock relay that builds the DOM. A test recomputes the closure and fails if
 *    this table drifts from it.
 *  - RENDER_TREE_PINS / RENDER_FILE_PINS: the app the proof was authored
 *    against — the source that builds the bundle, the design tokens and vendored
 *    faces the styling layer is generated from, the web shell and its fonts,
 *    package.json (its `main` and `export:web` decide what the bundle is, and the
 *    proof renders a prebuilt dist), and dependency identity.
 *  - INPUT_TREE_PINS: the scene the proof is fed — the relay corpus, the turn
 *    supplement fixtures read by the relay, and the positive-control canary.
 *    Reader-shaped selection excludes corpus documentation and unused records.
 *    Editing transcript text in `fixtures/relay/**` moves line boxes while
 *    RECORD.pinnedScenario still names the same scenario.
 *
 * OUT OF SCOPE by construction (reader-shaped fixture selection below): the design kit's
 * documentation captures (`design/store-screenshots`), its preview page, app
 * icons, native config plugins, `docs/`, test files, and fixtures no proof reads.
 * Merging or editing any of those cannot refuse a run.
 *
 * GRANULARITY. Modules are pinned per file so a refusal names them; render and
 * input roots are one digest each, because pinning ~500 files by hand is not
 * reviewable and a mismatch names the root. `--print` emits paste-ready
 * declarations for the whole table.
 *
 * TRUST ROOT. These tables are it: editing them is how a re-pin happens, and that
 * edit is visible in review like any other source change. Say the uncomfortable
 * part plainly: a pull request that edits an instrument file and its pin in the
 * same commit passes this guard. The table cannot pin the file that contains it,
 * and nothing outside the repository checks the pair. That is inherent to a
 * same-repo tripwire — what protects the proof is that the re-pin is a visible
 * line in a reviewable diff, not that the tool catches its own author. The suite
 * proves the pins match the tree they were committed with, and nothing more.
 * The ORIGINAL_* constants in u08-geometry-proof.ts are a different thing and are
 * never re-pinned — they identify the captured historical packet, not the
 * instrument that runs today.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

const sha256 = (content: string | Uint8Array) =>
	createHash("sha256").update(content).digest("hex");

/* --------------------------------------------------------------- the table -- */

export const INSTRUMENT_PINS: Readonly<Record<string, string>> = {
	"tools/audit/audit.ts":
		"fba140d23f79b9d312c805bb441234f6d7e4dfe159a0ae17b8f265407d246270",
	"tools/audit/checks.ts":
		"3b49282a11c21ec0437e80d4feb00a481d544c3554dd7dcfcb42793f85926ed9",
	"tools/audit/color.ts":
		"a005d29b4eca066a0f4418e4ef66cdbed471898a2307c76a6ccfe83e7dded0ef",
	"tools/audit/paint-fragments.ts":
		"d65894ba1fb463eaad8c7e66b4145378f13316d707436d3eec2594cc1224d42a",
	"tools/audit/probe.ts":
		"4ed608393c78474ce7dd152a7c57637fdacb8ec23fbb9b3abfd9879330c0ab66",
	"tools/audit/u08-fragment-verification.ts":
		"bcec0b75b00bbeeb51c1b8a989086c922072a64635a92ff6972a782f18b37908",
	"tools/audit/u08-geometry-proof.ts":
		"59358b798485dcb7662cd52a952bf988f24bd90fc5fb522d70f790260c326d00",
	"tools/lib/affordance.ts":
		"06902d73d4a59043084c223897c45dbc55c6e89014aa57b4204904e4b19e3208",
	"tools/lib/args.ts":
		"9cc6b888e20f8bebb4d1b5d87db406af45b8385901514c401381da68c2612726",
	"tools/lib/cdp.ts":
		"7875028a68f933c98dcb8df664427f167945e21dce514030ee268a20ce7fbd7e",
	"tools/lib/chrome.ts":
		"e635a8cf6460e397eaaebdce4a6e459d6d1ff62b4866fb4c56cc4dcb91927162",
	"tools/lib/json.ts":
		"24e4229a1af05da10dddf95dfbcabcdde564dbe97269d0974a25f0c32b8656a0",
	"tools/lib/page.ts":
		"904bc7539a366a4e76f642e6ac534eb109f827ca5e4c645dbb52673677197b8f",
	"tools/lib/readiness.ts":
		"f8f7fe0804801759475f074591ae42e64573cd4de466803a13361e9b4f477030",
	/* Re-pinned 2026-10-29 by the stacked QA-harness PR for #127 after rebasing
	 * onto its new head: the base owns the render and package identities, while
	 * this PR adds only the relay driver's scoped fault and request-ledger
	 * controls. Recomputed with `--print`; no U-03 exemption or skipped check. */
	"tools/lib/relay.ts":
		"a4d87797069162240c01f58868b7df37154112c8cb9fdf964904df54a53a1311",
	"tools/lib/static-server.ts":
		"dd7312406f3b0fe2a4c47e94fe1d9d49abc414d382b43c3c0ee8fea71517e917",
	"tools/mock-relay/account-routing-gate.ts":
		"2388f03adfea61dd69bcf397428fb899ab5d5977f47574727d81087d8d597379",
	"tools/mock-relay/account-routing-identity.ts":
		"0d56a3cde84ebb8fdba12aaa2e96bf0435ea100ac4366b426ed842084fd74501",
	"tools/mock-relay/account-routing.ts":
		"0baaedd970b4729bf3692cd9b3354666a9c2670e48be5016edd23429e5649163",
	"tools/mock-relay/faults.ts":
		"813657253a6dcf107c3b905d8a246b828c7ca8aa29bbc018762bfebd8a528d2b",
	"tools/mock-relay/fixtures.ts":
		"1641e6e2b3b424a2143ea6c3b8e69f3f2fc5ca02f8418429ca0835e54cf8bb4e",
	"tools/mock-relay/library.ts":
		"e33cd28ff3c0fb72bc8088cb06c0290993c115ceaf3b4d6bb2773ec89b3fd304",
	"tools/mock-relay/notifications.ts":
		"33712084ac78c1b2cfb489861d19b8586327a5916f5d453f79589013e140d532",
	"tools/mock-relay/projects.ts":
		"24db74688d1f5b6ac12975a00d48399a64ec0bec2e9d019f8cc11f00923b85ea",
	/* Re-pinned 2026-10-29 by the French-locale wave, deliberately: `src` now carries the
	 * French catalogues and the copy modules that resolve per render, and the mock relay and
	 * its scenario registry gained `/api/config/events` plus a selectable language so a
	 * browser run can render a non-English catalogue at all. Those are exactly the files
	 * these pins exist to freeze: the guard is doing its job, not failing. Recomputed with
	 * `--print`; no other file moved and no U-08 exemption or skipped check is involved. */
	"tools/mock-relay/relay.ts":
		"813e5a0fae9ded1aa872246b554d0598dd390c5ad2cefc79dd549ead2cb8c505",
	/* Re-pinned 2026-10-29 after merging main's session-health work into the French
	 * wave: `src` and `app` carry that surface plus the French catalogues and the
	 * per-render copy modules, and the readiness/matrix/scenario helpers moved with
	 * it. All are content the proof measures, so the pins follow the reviewed
	 * change; nothing else in the table moved and no exemption was added. */
	"tools/mock-relay/scenarios.ts":
		"0be0b00d9451014fd45dc3aa989f3f3882f7e15731d8c77fee6ea60e63529bc3",
	"tools/mock-relay/shape.ts":
		"0ef0c342578ffaf4a7067d4427f10a999740152d6a56ec2da63d75697f08fb5b",
	/* The startup evidence helper the fixture's relay imports. It has been loaded by
	 * the driver since the auth-fence work on this branch and was never pinned — the
	 * coverage test caught it as a gap rather than a drift, so the entry is added
	 * here (same batch) instead of leaving a module the driver runs unguarded. */
	/* Re-pinned with the D9 capacity fix (4c67362): the ledger's byte ceiling is a
	 * guard the driver's own evidence path depends on, so its bytes are pinned like
	 * the rest of the instrument. Only the constant moved. */
	"tools/mock-relay/startup.ts":
		"e51390abdcec9e3e88d674304f1b236bc0b991e12e65f166e8f89567c1bd38ca",
	"tools/mock-relay/transcribe.ts":
		"59d078b6838376b15af5efa7815221684755b917a9992a0e1dac663da1e4c945",
	"tools/mock-relay/wire.ts":
		"17d9b8a2c5f66d681d4fa11e12abe242e29d1a21c91ebb279948bb5dd83106e6",
	"tools/visual/matrix.ts":
		"83ed3f7fb2d7f76d0b2149e4349522832873dc3ec1b1534883b02ca365b197b0",
	"e2e/fixtures/audit-canary/index.html":
		"96085343f6aaa34a3162c979d536208a32f897beba9bbc3633d6f3d0e37a5403",
};

export const RENDER_TREE_PINS: Readonly<Record<string, string>> = {
	/* Re-pinned 2026-10-26 by this PR, deliberately: the two trees below contain the
	 * polish work itself (new status-tray module, one-row session chrome, Home splash
	 * mark and suggestion rows, 22 pt chrome glyphs), so their digests MUST move —
	 * the guard is doing its job, not failing. `tools/mock-relay/relay.ts` moved with
	 * them because its fixture semantics changed for the same screens.
	 *
	 * A re-pin is only legitimate when the reader can see WHY from this diff; a pin
	 * bumped to make CI green earns nothing, and the suite still refuses every other
	 * file's drift (`--print` is the only way to produce these values).
	 *
	 * Re-pinned again 2026-10-26, still deliberately, for two later source commits on
	 * this branch: `987e2fb` (the status layout predicate moved the phone/landscape
	 * decision into `src/ui/size-class.ts` and wired it in `app/(app)/session/[id].tsx`
	 * — hence BOTH trees move) and `46bd248` (Home's New-chat callback became a
	 * memoised callback reading a refreshed ref; src only). Neither commit adds or
	 * removes a file under these roots; the digests move because those files' bytes do.
	 *
	 * Third re-pin in the same batch, for the UX U1 remediation: the stranded-queue
	 * escape (coordinator enqueue gate, `restoreQueueToDraft`/`discardQueue`, the
	 * fresh-draft rotation in `startup-runtime.ts`, the Home row and its help), all
	 * under `src/` only — `app` is unchanged this time and keeps its previous digest.
	 * Fourth in the batch, for R11-1 and the five UX minors (queue surgery refused
	 * during a flight, merge computed in-transaction, late-SID mapping, row copy);
	 * again `src` only. Fifth, for the final audit's two geometry defects: the
	 * composer chip's cap moved onto its own flex item (`src/ui/components/chip.tsx`,
	 * U-08's 48×41 overlap at 320 pt / 200 %) and the field's painted height now adds
	 * its border (`src/ui/variants.ts` `fieldBoxHeight`, wired in `textarea.tsx`,
	 * U-07's "content 88px in a 86px box"); `src` only once more. Sixth, for code
	 * R14: organized imports in `textarea.tsx`/`variants.test.ts` and the border
	 * reserved once in `composerBudget` (`size-class.ts`); `src` only. Seventh, for
	 * design recheck D-c: the portrait composer is bounded by the window through
	 * `composerLimit` and a self-measured top (`composer.tsx` and the session screen
	 * `app/(app)/session/[id].tsx`), so BOTH trees move. Eighth, lint-only: the
	 * composer's re-measure effect reads `measurementKey` so the dependency the
	 * ceiling contract needs is a real one (`src` only, no geometry change).
	 *
	 * Re-pinned 2026-10-27 for the saved-computers registry (M1): new non-rendering
	 * modules (`src/connection/saved-computers.ts` and its test,
	 * `src/features/auth/use-saved-computers-hydration.ts`), the connection store's
	 * hidden-computer filter, the Computers screen's Remove handler, and a
	 * render-nothing hydration component in `app/_layout.tsx` — so BOTH trees move.
	 * No markup, style or copy changes; no proof scene renders differently.
	 *
	 * Re-pinned again 2026-10-27 for the M1 review round 1 (`src` only; `app` is
	 * unchanged): the registry no longer copies the custom slot and lets a
	 * throwing read propagate, sign-out clears it, and the Remove handler and
	 * startup merge moved into `src/features/auth/saved-computers-sync.ts` (plus
	 * its test) so they can be tested. The screen's `onConfirm` now calls that
	 * helper; no markup, style or copy changes.
	 *
	 * Re-pinned again 2026-10-27 for the M1 review round 2 N1/N2 (`src` only):
	 * read-only registry paths skip an entry whose read throws, writes keep its
	 * id, and sign-out writes the empty index past an unreadable index. Registry
	 * internals and their test only; nothing renders differently.
	 *
	 * Re-pinned 2026-10-27 by PR #121, deliberately, `src` only (`app` unchanged):
	 * `f41245c` lets Radient discovery record the account's computers before a route
	 * exists (`src/state/connection-store.ts`), and the round-1 remediation commit
	 * on top of it keeps that list through a pick and a failed Refresh (the store,
	 * `computers.tsx` + new `computers-view.ts`, the provider's discovery arms and
	 * refusal subject, Settings' failure line, the `retry` refusal's copy). Picker
	 * and refusal screens only; nothing on the U-08 proofs' measured scenes.
	 * Again, `src` only, for the PR's round-2 remediation: a cold-start pick lands
	 * on Home, the 401 sign-in state and its button, the generation-fenced
	 * `discovering` flag, network mint failures on `retry`, and Settings' row
	 * state (`computers.tsx`, `computers-view.ts`, the provider, `settings.tsx`,
	 * a store comment). Same screens; no U-08 scene.
	 *
	 * Re-pinned 2026-10-27 for merging main (#120) into PR #121: both branches
	 * edited `src/state/connection-store.ts` (the hidden-computer filter and the
	 * route-free `setComputers`/Radient carry-over now live in one file), so the
	 * merged `src` digest is neither side's; recomputed with `--print` from the
	 * staged merge tree. `app` is #120's, which #121 never touched. Store and its
	 * tests only; nothing renders differently.
	 *
	 * Re-pinned 2026-10-27 for the computer switcher (M2a), deliberately, `app` and
	 * `src`: `app/_layout.tsx` mounts the one switcher sheet's provider around the
	 * stack, and `src` adds the sheet and its view model, the store's unfiltered
	 * discovery list and live computer id, the provider's remember-on-live, the
	 * probe-at-origin, the own-address `?url=` prefill, and the Switch entry points
	 * on Computers and Settings. Computer screens and an overlay that is closed by
	 * default; no U-08 scene. Recomputed with `--print` from the staged tree.
	 *
	 * Re-pinned 2026-10-27 for PR #122's round-1 remediation, `src` only: the
	 * switcher's probe lifecycle, failed-pick close, account-scoped Radient entries
	 * (the grant's account id), kept names, the stored-grant load before a pick,
	 * the registry-id own-address hand-off and its password-first entry, the active
	 * row's accent bar, and the Computers header's "Switch computer". Same screens;
	 * no U-08 scene. `app` unchanged. Recomputed with `--print` from the staged tree.
	 *
	 * Re-pinned 2026-10-27 for PR #122's round-2 remediation, `src` only: Settings'
	 * refusal surface, the refusal surface's live region, the Computers header's
	 * measured stack width and add mode, the switcher's per-open account state and
	 * Add a computer target, and the password-entry copy. No U-08 scene changes;
	 * `app` unchanged. Recomputed with `--print` from the staged tree.
	 *
	 * Re-pinned 2026-10-27 for PR #122's round-3 remediation, `src` only: the
	 * Computers add-mode wait finding the new computer, Settings scrolling its
	 * refusal into view and dropping the Diagnostics retry, the sheet's Add a
	 * computer deciding from `computersView`, and the Computers console remedy. No
	 * U-08 scene changes; `app` unchanged. Recomputed with `--print` from the staged
	 * tree.
	 *
	 * Re-pinned 2026-10-27 for PR #122's round-4 remediation, `src` only: the sheet
	 * primitive forwarding the web modal's completed dismissal, Settings revealing
	 * its refusal on that dismissal and disarming its retry on failure, and Computers
	 * replacing the answered panel with a connected confirmation once the pick is
	 * live. No U-08 scene changes; `app` unchanged. Recomputed with `--print` from
	 * the staged tree.
	 *
	 * Re-pinned 2026-10-27 for the S8 short-landscape overlap fix (BOTH trees move):
	 * `statusTrayVisible` in `src/ui/size-class.ts` and its one use in
	 * `app/(app)/session/[id].tsx` hide the one-row status tray while a pending
	 * approval/ask is on screen in short landscape, and bottom-anchor that cluster
	 * so the freed height does not become a band under the composer (design D1).
	 * It changes no other state or viewport: the proofs' scene is a 390x844 portrait
	 * `long-transcript` cell with no pending decision (`tray` stays visible there,
	 * `compact` is false), so nodes 64/65/66 of the four original cells measure what
	 * they measured before. Re-pinned a second time in the same PR for that round-1
	 * remediation, after the LAST `src`/`app` edit (`native-polish.test.ts`).
	 *
	 * Re-pinned 2026-10-27 for merging main (#123) into PR #122: the two branches'
	 * digests are both stale on the merge, because `src` now carries PR #122's
	 * round-4 Settings/Computers changes AND PR #123's `statusTrayVisible`, and
	 * `app` carries #123's `app/(app)/session/[id].tsx` tray wiring. Both are
	 * recomputed here from the merged tree with `--print`. Neither proof's scene
	 * moves: PR #122 renders computer screens and an overlay that is closed by
	 * default, and #123's tray is visible in every captured combination (its own
	 * note below records the same reading).
	 *
	 * Re-pinned 2026-10-27 for PR #122's round-5 remediation, `src` only: the
	 * switcher provider counting closes alongside dismissals, Settings revealing a
	 * refusal once no dismissal is owed, and the Try now focus move owned by the
	 * retry's start state. No U-08 scene changes; `app` unchanged. Recomputed with
	 * `--print` from the staged tree.
	 *
	 * Re-pinned 2026-10-27 for PR #122's round-7 remediation, `src` only and a test
	 * file only: `modal-dismissal-ledger.test.ts` types the Sheet's required
	 * `children` (CI tsc) and adds the sibling-Sheet close-ordering case (R7-m1).
	 * No runtime source and no U-08 scene changes; `app` unchanged. Recomputed with
	 * `--print` from the staged tree.
	 *
	 * Re-pinned 2026-10-28 for M2b (the switcher's Home chip and drawer row), `src`
	 * only: `computer-entry.ts`/`computer-entry-points.tsx`, the Home header slot,
	 * the drawer footer, the `CONTROL` doc comments, and `native-polish.test.ts`
	 * following the D3 one-line rule into the chip. The proofs' scene is a
	 * session transcript, which renders neither the Home header nor the drawer, so
	 * no U-08 scene changes; `app` unchanged. Recomputed with `--print` from the
	 * staged tree.
	 *
	 * Re-pinned 2026-10-28 for PR #126 round-1 remediation: registry-backed entry
	 * names, slot fitting, refusal remedies and opt-in picker focus, plus tests.
	 * The transcript proofs do not render these navigation entry points. Sheet's
	 * new focus behavior is opt-in (only the computer picker enables it), and
	 * middleFit preserves its mono default (26 focused fit tests). This is a source
	 * identity update, NOT a claim of new rendered proof; independent visual/QA
	 * validation remains required on this head. app/instrument/input pins unchanged.
	 * Recomputed with --print after staging the complete remediation.
	 *
	 * Re-pinned 2026-10-28 for the M2b round-2 remediation on PR #126, deliberately:
	 * the switcher's two navigation entry points moved their health marks into an
	 * alias-free module (`src/features/auth/entry-health-marks.ts`, which the frame
	 * audit's own test must import so `tools/tsconfig.json` stops failing on `@/`),
	 * put the kit's control-edge role on both affordances, and made the mark and the
	 * drawer row's health word follow the text scale. `design/tokens` moves with them
	 * because two CONTROLS rows were added to `contrast-contract.mjs` for that edge.
	 * `app/` keeps its previous digest - no route, layout or shell changed. This pin
	 * is content identity, not a geometry claim: the U-08 cell rows are re-measured
	 * when the proof runs, and it refuses on its own findings on this number.
	 *
	 * Re-pinned 2026-10-28 by the merge refresh of PR #112 (`feat/i18n`), `src`
	 * only: the branch's runtime, its four keyed copy modules, its generated
	 * projection and its strings baseline all live under `src/i18n/**` and
	 * `src/features/**`, so the merged `src` digest is neither side's. The keyed
	 * modules resolve to the same English bytes they carried as literals (their
	 * tests assert the sentences verbatim), so no scene's paint or geometry
	 * moves; `app`, the design inputs and the proof's fixtures keep their
	 * digests. Recomputed with `--print` from the merged tree.
	 *
	 * Re-pinned 2026-10-28 for PR #112's round-1 remediation, `src` and
	 * `package.json`: the 40 literals main introduced are keyed (same English
	 * bytes, rendered through `t()`), the ICU apostrophe/plural-count guards in
	 * `messages.ts`, and the `i18n:*` scripts added to package.json (scripts only;
	 * `main` and `export:web` are unchanged). No scene's paint or geometry moves;
	 * `app` and the design inputs keep their digests.
	 *
	 * Re-pinned 2026-10-28 for merging main's i18n extraction into PR #126, `src`
	 * only: the merged tree now contains both the runtime/catalogue extraction and
	 * the switcher's Home and drawer entry points. The ratchet removed the replaced
	 * drawer literal and added no baseline entries; existing switcher copy is
	 * already keyed. Neither proof renders those navigation entry points, and `app`,
	 * `design/tokens`, fixtures and package identity keep their existing digests.
	 * Recomputed with `--print` from the staged merged tree.
	 *
	 * Re-pinned 2026-10-28 for PR #127 (inbox re-reads on return), `src` only: the
	 * notifications inbox refetches on focus and fences writes by route
	 * (`src/features/notifications/*`), the list store's `applyFrame` takes the
	 * connection generation it was read under so a stale frame cannot land
	 * (`src/state/list-store.ts`, `src/features/auth/connection-provider.tsx`), and
	 * their tests. The U-08 scene is a `long-transcript` session cell: it renders no
	 * inbox, and the generation fence only drops frames from a retired connection,
	 * which the proof's single mock-relay connection never produces. `app` unchanged.
	 * Recomputed with `--print` from the staged tree.
	 *
	 * Re-pinned 2026-10-29 for rebasing PR #127 onto main (`8eedcb6`, carrying
	 * PR #112's i18n extraction and PR #126's switcher entry points), `src` only:
	 * main keyed the copy under `src/features/notifications/*` that PR #127 also
	 * rewrites, so the rebased `src` digest is neither side's; recomputed with
	 * `--print` from the rebased tree and no U-08 scene changes. `design/tokens` is
	 * #126's (its two CONTROLS rows), `package.json` is main's `i18n:*` scripts,
	 * which PR #127 never touched, and `app`, `public` and the proof's fixtures keep
	 * their digests. */
	app: "80e1501d11893f35d0d7e27e4f1c1dfb40165adaa7e1de3c2fda9483f530580b",
	"design/fonts":
		"4d6a0f23c57ed6adff8ef353abe22c2208e802b70a961d4c8996aff3bae6b2fb",
	"design/tokens":
		"6a00f9f431085fce5af6eb4039906fb2a792fb6f35f775fa422a787bd8bb9c53",
	public: "fffab05c9f1bcb5a820ec6fc62f853d005db87e152bca97fe3e22337aa85851b",
	/* Re-pinned 2026-10-29 for the i18n policy PR itself: this branch changes only
	 * `src/i18n/locale.ts` (the SUPPORTED/SHIPPED split), adds `src/i18n/key-shape.ts`
	 * and `src/i18n/__tests__/locales.test.ts`, so `src` MUST move and the guard is
	 * working. The same digest also covers main's advances merged in to resolve this
	 * branch's conflicts; `app`, `public`, `design/*` and the instrument files did not
	 * move. A doc under `docs/` cannot trip this guard — `docs/` is out of scope by
	 * construction — so only `src` was re-pinned. */
	/* Re-pinned 2026-10-29 for the Spanish wave: `src` now carries the Spanish
	 * catalogues and the per-locale budget, exactly the content these pins exist to
	 * freeze. Recomputed with `--print`; nothing else in the table moved. */
	/* Re-pinned 2026-10-30 for the Hindi wave: `src` carries the hi catalogues,
	 * the shipped flip, the hi chip budget and the zero-count assertion that
	 * moved when hi stopped being a fallback locale. Recomputed with `--print`
	 * AFTER the last `src` edit. */
	src: "8fc262139bc658dbf30e7477ab70bb8a622c44110a914575059813303728002b",
};

export const INPUT_TREE_PINS: Readonly<Record<string, string>> = {
	"fixtures/relay":
		"c4c1d6f26a45764241473a0b9a4491763697f976ca2c1cf349f8ab9c9adec5ab",
	"fixtures/supplements":
		"29bad98e91e6e29bd8148505f06058c24ff6682b3b4ba62bd43575a6a94d19cc",
};

export const RENDER_FILE_PINS: Readonly<Record<string, string>> = {
	"app.config.ts":
		"81e92f5315dbc9df56c603c4ac58b54f90f52a64d20f6c0f4f4ab8d3c7cd0332",
	"metro.config.js":
		"8969b35b1269818e746e2a8e854f94995f0adbc54b18e8e80c95e90aca1aa707",
	"package.json":
		"8ff9b983c45bb3d696d76baeb510731a54ebd6815332f2c05c832025ab221df6",
	"pnpm-lock.yaml":
		"4e09ec8a05cdbd6c27defe1337088fd4fcc08e17ddbfc88da0d693695fe1ce05",
	"pnpm-workspace.yaml":
		"1457b9b1a5ad6f9f7adf765d6b3adbaca44c8c938f4e9ccd525579dadae34ba3",
};

/** The re-pin an operator runs after reviewing a deliberate change. */
export const REPIN_COMMAND = "node tools/audit/u08-content-pins.ts --print";

/* ------------------------------------------------------------- the reading -- */

/** Tracked content the pins describe: sha256 per file, plus the tracked paths
 * that are gone from the working tree. `git ls-files` enumerates so .gitignore,
 * node_modules and dist never enter a digest. */
export interface RepositoryContent {
	readonly files: ReadonlyMap<string, string>;
	/** Tracked in the index, unreadable on disk — a deletion nobody staged. */
	readonly missing: ReadonlySet<string>;
}

/** Every path handed to `git ls-files`: pinned files and pinned roots, sorted. */
export function pinnedScopes(): string[] {
	return [
		...new Set([
			...Object.keys(INSTRUMENT_PINS),
			...Object.keys(RENDER_TREE_PINS),
			...Object.keys(INPUT_TREE_PINS),
			...Object.keys(RENDER_FILE_PINS),
		]),
	].sort();
}

/** Match the readers, not the directory names: fixtures.ts loads direct HTTP /
 * synthetic JSON, every direct SSE entry, and two named gateway/probe records;
 * scenarios.ts reads supplement rows and relay.ts serves one HTML document.
 * A README at either root (or an unused probe/message record) cannot move a
 * measured line box. SSE has deliberately NO extension exclusion: its reader
 * consumes even a prose-named entry, so such a file must remain pinned. */
const RELAY_JSON = /^fixtures\/relay\/(?:http|synthetic)\/[^/]+\.json$/;
const RELAY_SSE = /^fixtures\/relay\/sse\/[^/]+$/;
const SUPPLEMENT_ROWS = /^fixtures\/supplements\/rows\/[^/]+\.json$/;

export function isPinnedContentPath(path: string): boolean {
	if (path.startsWith("fixtures/relay/"))
		return (
			RELAY_JSON.test(path) ||
			RELAY_SSE.test(path) ||
			path === "fixtures/relay/gateway/gateway-refusal-constants.json" ||
			path === "fixtures/relay/probes/wedged-row-signal.json"
		);
	if (path.startsWith("fixtures/supplements/"))
		return (
			SUPPLEMENT_ROWS.test(path) ||
			path === "fixtures/supplements/documents/populated.html"
		);
	return true;
}

export function snapshotContent(root: string = REPO_ROOT): RepositoryContent {
	const listed = execFileSync(
		"git",
		["ls-files", "-z", "--", ...pinnedScopes()],
		{ cwd: root, encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	const files = new Map<string, string>();
	const missing = new Set<string>();
	for (const path of listed) {
		if (!isPinnedContentPath(path)) continue;
		try {
			files.set(path, sha256(readFileSync(resolve(root, path))));
		} catch (error) {
			// A tracked file removed without staging is absence, not a crash: the
			// operator needs the path in the refusal, not a readFileSync stack.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			missing.add(path);
		}
	}
	return { files, missing };
}

/** Order-independent digest of one root, so directory traversal order cannot
 * change a verdict. */
export function treeDigest(content: RepositoryContent, root: string): string {
	const prefix = `${root}/`;
	return sha256(
		[...content.files]
			.filter(([path]) => path.startsWith(prefix) && isPinnedContentPath(path))
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([path, digest]) => `${digest}  ${path}\n`)
			.join(""),
	);
}

/* ------------------------------------------------------------ the verdict -- */

export type DriftKind =
	| "missing"
	| "instrument"
	| "render-tree"
	| "input-tree"
	| "render-file";
export interface Drift {
	kind: DriftKind;
	/** The pinned file or root that differs. */
	scope: string;
	pinned: string;
	/** Re-hashed content, or "absent" when the pinned path is gone. */
	actual: string;
}

/** A vanished member is reported once by path, not also as a failed root digest:
 * one deletion should not read as two verdicts. */
const hasMissingUnder = (content: RepositoryContent, root: string) =>
	[...content.missing].some(
		(path) => path.startsWith(`${root}/`) && isPinnedContentPath(path),
	);

export function contentDrift(content: RepositoryContent): Drift[] {
	const drift: Drift[] = [];
	for (const path of [...content.missing].filter(isPinnedContentPath).sort())
		drift.push({
			kind: "missing",
			scope: path,
			pinned: "tracked",
			actual: "absent",
		});
	for (const [path, pinned] of Object.entries(INSTRUMENT_PINS)) {
		if (content.missing.has(path)) continue;
		const actual = content.files.get(path) ?? "absent";
		if (actual !== pinned)
			drift.push({ kind: "instrument", scope: path, pinned, actual });
	}
	const roots: [Record<string, string>, DriftKind][] = [
		[RENDER_TREE_PINS, "render-tree"],
		[INPUT_TREE_PINS, "input-tree"],
	];
	for (const [table, kind] of roots)
		for (const [root, pinned] of Object.entries(table)) {
			if (hasMissingUnder(content, root)) continue;
			const actual = treeDigest(content, root);
			if (actual !== pinned) drift.push({ kind, scope: root, pinned, actual });
		}
	for (const [path, pinned] of Object.entries(RENDER_FILE_PINS)) {
		if (content.missing.has(path)) continue;
		const actual = content.files.get(path) ?? "absent";
		if (actual !== pinned)
			drift.push({ kind: "render-file", scope: path, pinned, actual });
	}
	return drift;
}

/** Refuse before any browser work; the message must let an operator act. */
export function assertPinnedContent(
	content: RepositoryContent = snapshotContent(),
) {
	const drift = contentDrift(content);
	if (drift.length === 0) return;
	throw new Error(
		[
			"U08 content identity differs from the pinned baseline; refusing approximate proof:",
			...drift.map(
				(entry) =>
					`  ${entry.kind} ${entry.scope} pinned=${entry.pinned} actual=${entry.actual}`,
			),
			`A deliberate re-pin is required: review that change against what the proof measures, then run \`${REPIN_COMMAND}\` and update the pin table in tools/audit/u08-content-pins.ts. Historical ORIGINAL_* incident hashes are never repinned.`,
		].join("\n"),
	);
}

/* ------------------------------------------------------------ the printing -- */

/** Paste-ready declarations for the whole table. A pinned path that no longer
 * exists prints as a comment with an instruction, never as a value, and makes the
 * command exit non-zero: a deletion is not a re-pin. */
export function pinDeclarations(content: RepositoryContent): {
	declarations: string;
	missing: string[];
} {
	const missing: string[] = [];
	const declaration = (
		name: string,
		keys: readonly string[],
		digestOf: (key: string) => string | null,
	) =>
		[
			`export const ${name}: Readonly<Record<string, string>> = {`,
			...keys.map((key) => {
				const digest = digestOf(key);
				if (digest === null) {
					missing.push(key);
					return [
						`\t// MISSING ${key} — tracked in the table, gone from the tree.`,
						"\t// Restore the file, or delete this key deliberately; never pin a deletion.",
					].join("\n");
				}
				return `\t${JSON.stringify(key)}: ${JSON.stringify(digest)},`;
			}),
			"};",
		].join("\n");
	const fileDigest = (path: string) => content.files.get(path) ?? null;
	// A root digest is meaningful only when every tracked member is readable.
	const rootDigest = (root: string) =>
		hasMissingUnder(content, root) ? null : treeDigest(content, root);
	return {
		declarations: [
			declaration("INSTRUMENT_PINS", Object.keys(INSTRUMENT_PINS), fileDigest),
			declaration(
				"RENDER_TREE_PINS",
				Object.keys(RENDER_TREE_PINS),
				rootDigest,
			),
			declaration("INPUT_TREE_PINS", Object.keys(INPUT_TREE_PINS), rootDigest),
			declaration(
				"RENDER_FILE_PINS",
				Object.keys(RENDER_FILE_PINS),
				fileDigest,
			),
		].join("\n\n"),
		missing,
	};
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	// `--root=` exists so the suite can exercise this command against a throwaway
	// fixture, and so an operator can re-pin a clean clone without cd-ing into it.
	const rootArg = args.find((arg) => arg.startsWith("--root="));
	const content = snapshotContent(
		rootArg ? resolve(rootArg.slice("--root=".length)) : REPO_ROOT,
	);
	if (args.includes("--print")) {
		const { declarations, missing } = pinDeclarations(content);
		console.log(declarations);
		if (missing.length > 0) {
			console.error(
				`${missing.length} pinned path(s) are gone from the tree: ${missing.join(", ")}. Nothing was printed as a value for them — restore each file, or delete its key deliberately.`,
			);
			process.exitCode = 1;
		}
	} else {
		try {
			assertPinnedContent(content);
			console.log("U08 content identity matches the pinned baseline");
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}
}
