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
 *  - RENDER_TREE_PINS / RENDER_FILE_PINS: the rendering environment the proof was
 *    authored against — the design tokens and vendored
 *    faces the styling layer is generated from, the web shell and its fonts,
 *    package.json (its `main` and `export:web` decide what the bundle is, and the
 *    proof renders a prebuilt dist), and dependency identity.
 *  - INPUT_TREE_PINS: the scene the proof is fed — the relay corpus, the turn
 *    supplement fixtures read by the relay, and the positive-control canary.
 *    Reader-shaped selection excludes corpus documentation and unused records.
 *    Editing transcript text in `fixtures/relay/**` moves line boxes while
 *    RECORD.pinnedScenario still names the same scenario.
 *
 * A FOURTH IDENTITY IS RECORDED, NOT PINNED: RUN_DERIVED_ROOTS (`app`, `src`),
 * the application under measurement. See the block at RUN_DERIVED_ROOTS for why
 * a committed digest of them was the wrong tool.
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
 * line in a reviewable diff, not that the tool catches its own author.
 *
 * WHO RE-PINS WHAT. The executable proof (u08-geometry-proof.ts, dispatch-only,
 * including `--preflight-only`) is the one gate that compares the live tree with
 * the committed RENDER_TREE/INPUT_TREE/RENDER_FILE tables, and it refuses on any
 * difference. The unit suite does NOT: it proves the admission logic against a
 * baseline derived from its own fixture (pinTablesFrom), so an ordinary feature
 * PR that edits `src/`, `app/`, fixtures or dependencies does not re-pin here.
 * Re-pin those roots deliberately, with --print, when a U-08 proof is about to
 * be dispatched against the new scene — that line is the reviewed decision. The
 * suite still holds INSTRUMENT_PINS to the live files (an edit to the measuring
 * code re-pins in the same PR) and holds the table KEYS to the drivers' import
 * closure. `app` and `src` are never re-pinned at all: no PR edits this file for
 * an app change (RUN_DERIVED_ROOTS).
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

/* Background push refresh: re-derived with --print after the register fixture
 * and warm-sync source changed. These hashes prove SOURCE IDENTITY ONLY, not
 * rendered/native/device/battery evidence; no assertion or exemption changed. */
export const INSTRUMENT_PINS: Readonly<Record<string, string>> = {
	/* Re-pinned 2026-11-07 for PR #189 (audit fix 2) with --print: `auditCell` now
	 *  brackets the unchanged `EXTRACT_PROBE` with `SPACING_REST_PROBE` and retakes
	 *  an extraction a spacing tween moved across. What is measured and every
	 *  threshold are unchanged; only WHEN the reading is taken moved. */
	"tools/audit/audit.ts":
		"10429edbe5a43c4e214ddfeb6408d88c4c4f9cf8ff80e7ea7d6610e084fe57a0",
	/* Re-printed 2026-11-07 with --print at the staged sidebar-density tree: the two
	 * U-42 allowances keyed on the list row's `min-h-[56px]` class were removed with
	 * that class (the row now pads `py-2`/`gap-1`, both on the 4 pt scale), so they
	 * matched nothing. No check logic changed. */ /* Re-pinned 2026-11-08 at the merge of origin/main 2c99a014 into PR #105 with
	 *  `--print`: this file merged both sides' edits, so its digest is neither
	 *  side's. No check logic, rule id or exemption moved — the sidebar-density
	 *  allowances above and main's own re-pin both stand. */

	"tools/audit/checks.ts":
		"8b995491008690b3e2f0885e124e81eb5079cdf275103bee9ea1928dc8c3b1f7",
	"tools/audit/color.ts":
		"a005d29b4eca066a0f4418e4ef66cdbed471898a2307c76a6ccfe83e7dded0ef",
	"tools/audit/paint-fragments.ts":
		"d65894ba1fb463eaad8c7e66b4145378f13316d707436d3eec2594cc1224d42a",
	/* Re-pinned 2026-11-07 for PR #189 (audit fix 2) with --print: one ADDED
	 *  export, `SPACING_REST_PROBE`; `EXTRACT_PROBE`'s source is byte-unchanged. */
	"tools/audit/probe.ts":
		"44ea427fefb9775fe5d8c2694f4c8788a9c5ec9eb19eefa8b7b5e7eac36ba2a6",
	/* Re-pinned for PR #207's CI remediation: the long-conversation fixture's
	 * row ids moved from `tc-conv-…` to `m-conv-…` (`tc-` is the relay's
	 * live-fold prefix, which the history pager refuses as a cursor), so the
	 * fixture-control ids this instrument names moved with them. A rename of
	 * the same rows; what the proof measures is unchanged. `--print`, staged. */
	/* PR #250: --print admits affirmative readiness and current-scene admission,
	 * reviewed in Agent review round 1 (6841333661). The exact historical matcher
	 * is retained; absent/ambiguous historical evidence stays NOT-REPRODUCED. */
	/* Re-pinned with --print for the run-derived app identity: the driver now
	 * writes `renderedSource` (the admitted app/src digests) into its receipts.
	 * What is measured, every threshold and every exemption are unchanged. */
	"tools/audit/u08-fragment-verification.ts":
		"c1b1bf72a5c4313776a7534cb26d9e5c52b00e296e2d3ac6e348943469cc6e53",
	// PR #207 CI remediation: same `m-conv-…` fixture-id rename as above.
	// Same run-derived app identity change as above; --print.
	"tools/audit/u08-geometry-proof.ts":
		"2af67ad3a39b02a0f168e878a522fd67f3323727704a3a98fc8d615fb43dc848",
	/* Re-pinned for PR #175: `skipped` is now a terminal affordance answer, so
	 *  a conditional opener whose control is already on the page stops polling its
	 *  settled answer for the full `waitMs`. The proof still drives the SAME presses
	 *  and reads the SAME outcomes — `skipped` was already a pass in both the
	 *  capture's verdict and `outcomeFailed` — so what changed is how long the
	 *  instrument waits, not what it measures. Derived with `--print`. */
	"tools/lib/affordance.ts":
		"da7441e18f3878e411b8e5e096f2fe387347dae00272256a64577a4ce96a5de3",
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
		"fdbe2094ec86ca60b9c5e81d1a34927acd4a395cb8b62db736c88ff4209fcb5d",
	"tools/mock-relay/account-routing-gate.ts":
		"2388f03adfea61dd69bcf397428fb899ab5d5977f47574727d81087d8d597379",
	"tools/mock-relay/account-routing-identity.ts":
		"0d56a3cde84ebb8fdba12aaa2e96bf0435ea100ac4366b426ed842084fd74501",
	"tools/mock-relay/account-routing.ts":
		"0baaedd970b4729bf3692cd9b3354666a9c2670e48be5016edd23429e5649163",
	/* Kept from the branch (restored 2026-11-08 at the merge of origin/main
	 *  2c99a014): the merged `relay.ts` still loads this module for the
	 *  `__mock/avatar-capture` control routes the closure test named, and main
	 *  never had it. The digest is the branch's own, so no re-pin happened —
	 *  only the table rebuild dropped the row. */
	"tools/mock-relay/avatar-capture.ts":
		"81b1b37dac428519520855828e661aa4698855740f79ba24016811ccae9cd998",
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
	/* Re-pinned 2026-11-03 for PR #159 (highlights deliverables) with --print: the
	 * relay gained a digest-scoped `/sound` route and `.mp4` on the supplement file
	 * route; scenarios gained `supplement-deliverables`. U-08's pinned scene
	 * (`long-transcript`) builds a byte-identical world on main and on this head
	 * (JSON SHA256 prefix 967777106c5eff28, 0 supplement beats), so the measured
	 * input is unchanged. */
	/* Re-pinned 2026-11-07 for feat/home-pickers with --print from the staged
	 * tree: the mock relay serves `GET /api/models`'s v0.101.9 `default` when a
	 * scenario names one (the new `home-pickers` scenario), validates the start
	 * body's `effort` as the relay does (`startEffortAdmitted`, in `wire.ts`) and
	 * advertises `session_start: {effort: true}`. No existing scenario's bytes or
	 * the corpus moved. */
	/* Re-pinned 2026-11-07 for PR #182's round-1 remediation with --print from
	 * the staged tree: `GET /api/directories` serves a scenario's own folder
	 * answer when it names one (`world.directories`), else the corpus capture as
	 * before. No existing scenario names one, so their bytes are unchanged. */
	/* Re-pinned 2026-11-07 for PR #191's round-1 remediation with --print from
	 * the staged tree: an admitted command's user row is written under the bare
	 * command id, as the daemon writes it, and an IDLE world pushes the
	 * projection once its version moves past what the stream last sent. No
	 * streaming or keepalive-only scenario's frames change. */
	/* Re-pinned 2026-11-07 for fix/session-effort-null with --print from the
	 * staged tree: the list frame's `unread` block takes the daemon's degraded
	 * shape (`{degraded}` alone, no revision/count) whenever the listing is
	 * degraded. Healthy scenarios' frames are unchanged. */ /* Re-pinned 2026-11-08 at the merge of origin/main 2c99a014 into PR #105 with
	 *  `--print`: the merged relay carries both sides' routes, so its digest is
	 *  neither side's. The U-08 scene the proof is fed did not move. */

	/* PR #207 CI remediation: `/history?before=<oldest row>` answers the empty
	 * terminal page instead of re-serving the newest one. `--print`, staged. */
	/* Re-pinned 2026-11-15 for PR #271 with --print: the remote-conversation
	 * mock scenarios (relay/scenarios) and the long-press S15 openers (matrix). */
	/* PR #251 D1: 24d93a0d (fixture-only) taught the mock relay to publish
	 *  language config changes but left this pin at 99594b71's bytes (9bec3b7e…).
	 *  This is sha256 of relay.ts exactly as committed in 24d93a0d, unchanged at
	 *  this head; the tool's own reader (snapshotContent) reports the same value.
	 *  The fixture moved, the U-08 scene did not. Not rendered evidence. */
	/* Re-pinned 2026-11-21 for PR #358 (new-chat identity picker) with --print:
	 *  the mock relay gains the `start-targets*` worlds, `GET /api/start-targets`
	 *  and the start route's `agent`/`team` handling. Source identity only — no
	 *  U-08 scene, assertion or threshold changed here; not rendered evidence. */
	/* Re-pinned 2026-11-22 for PR #372 (`$skill` autocomplete): the mock relay
	 *  advertises the top-level `skill_invocation` capability, serves
	 *  `GET /api/skills` and answers `expand_skills` with a receipt, and the
	 *  `skills*` scenarios exist. Source identity only — no U-08 scene,
	 *  assertion or threshold changed; not rendered evidence. */
	/* PR #376: negotiate chart fixture sidecars on every projection. Re-pin
	 * the changed sources and the chart dataset module the registry now loads;
	 * the U-08 scene, checks and thresholds are unchanged. */
	"tools/mock-relay/relay.ts":
		"53ba7d083d6e3c5fae20cc20b4ecc591c3793e6f4660625fdae87ac4f10b8f9e",
	/* Inline-chart redesign: the chart dataset gains the operator's Datadog
	 * series, a 32-day line, a long-label bar and a 12-slice pie; round-1
	 * remediation ends the 32-day line on a real date (Nov 1, not Oct 32). Data
	 * only — the U-08 scene, checks and thresholds are unchanged. */
	"tools/mock-relay/inline-charts.ts":
		"69b74c0e42d072537da066c64b79a1d15daba6395bfc956165ca87e5e6a3c13e",
	/* Re-pinned 2026-10-29 after merging main's session-health work into the French
	 * wave: `src` and `app` carry that surface plus the French catalogues and the
	 * per-render copy modules, and the readiness/matrix/scenario helpers moved with
	 * it. All are content the proof measures, so the pins follow the reviewed
	 * change; nothing else in the table moved and no exemption was added. */
	/* Re-pinned 2026-11-07 for PR #182's round-1 remediation with --print: only
	 * the `home-pickers` world moved (a folder answer with default/recents and two
	 * not-connected model rows, UX U6); no other scenario's world changed. */
	/* Re-pinned 2026-11-07 for fix/session-effort-null with --print: `rowFrom`
	 * emits the daemon's real-shaped nulls (`effort`, `opened_by`, `agent_id`,
	 * `avatar_sha256`) and the always-present receipts/tags pair. Row DATA only;
	 * no projection, transcript or layout input moved. */
	/* PR #207 CI remediation: long-conversation ids are journal-addressable
	 * (`m-conv-…`) and `long-transcript` declares `transcript_head_pinned:
	 * false`. `--print`, staged. */
	/* PR #207 round 5: omit the false head-pin flag, matching Core's wire.
	 * Re-derived with --print from the staged tree; no capture assertion moved. */
	/* Re-pinned 2026-11-18 for issue #325 with --print: two NEW scenarios
	 *  (`run-settings`, `run-settings-streaming`) with no cell; no existing
	 *  scenario's world moved. */
	/* Re-pinned 2026-11-18 for issue #322 with --print: one ADDED world,
	 *  `peer-tail-history`, and its builder. Existing worlds are byte-identical
	 *  to main (JSON SHA256 prefixes: long-transcript 11bfa6d3e7b72831,
	 *  long-transcript-history 0d14585cb17662c9, idle 1d1ed4063acae06d on
	 *  both), so the U-08 scene did not move. */
	/* Re-pinned 2026-11-21 for PR #358 (new-chat identity picker) with --print:
	 *  the mock relay gains the `start-targets*` worlds, `GET /api/start-targets`
	 *  and the start route's `agent`/`team` handling. Source identity only — no
	 *  U-08 scene, assertion or threshold changed here; not rendered evidence. */
	/* Re-pinned 2026-11-24 with --print when #335 converged with main a7293e87:
	 *  the union of #325's `run-settings*` worlds and main's `start-targets*`
	 *  worlds. Source identity only — no U-08 scene moved. */
	"tools/mock-relay/scenarios.ts":
		"0acc19a1cc13ec9b6d026a1bcb7e5a85238a8a23a3910f359636617736a32b9e",
	"tools/mock-relay/shape.ts":
		"0ef0c342578ffaf4a7067d4427f10a999740152d6a56ec2da63d75697f08fb5b",
	/* The startup evidence helper the fixture's relay imports. It has been loaded by
	 * the driver since the auth-fence work on this branch and was never pinned — the
	 * coverage test caught it as a gap rather than a drift, so the entry is added
	 * here (same batch) instead of leaving a module the driver runs unguarded. */
	/* Re-pinned with the D9 capacity fix (4c67362): the ledger's byte ceiling is a
	 * guard the driver's own evidence path depends on, so its bytes are pinned like
	 * the rest of the instrument. Only the constant moved. */
	/* Re-pinned 2026-11-07 for PR #191's round-1 remediation: the image route
	 * resolves an entry by the bare command id the row now carries. */
	"tools/mock-relay/startup.ts":
		"cc51e9866607ea4d97bef75d2179fbed2c65e75389e12d5957b7643db10f98c1",
	"tools/mock-relay/transcribe.ts":
		"59d078b6838376b15af5efa7815221684755b917a9992a0e1dac663da1e4c945",
	/* Re-pinned 2026-11-21 for PR #358 (new-chat identity picker) with --print:
	 *  the mock relay gains the `start-targets*` worlds, `GET /api/start-targets`
	 *  and the start route's `agent`/`team` handling. Source identity only — no
	 *  U-08 scene, assertion or threshold changed here; not rendered evidence. */
	"tools/mock-relay/wire.ts":
		"4845a78e359da33ac28e5b2886d372641dfb5c33e4e5db552eb8ea05f62d8c66",
	/* Re-pinned 2026-11-08 for PR #195's round-1 remediation with --print from the
	 * staged tree: one cell name added to the iphone-15-landscape
	 * IDENTICAL_FRAME_EXEMPTIONS entry (`S5/rail-building`) and that entry's reason
	 * rewritten to what nightly 42442578427 measured — the same entry the 2026-11-07
	 * re-pin above extended on the coincidence side. No rule, probe, matcher or
	 * plan input moved: the class is imported only by the capture's identity verdict
	 * (`identical-states.ts`, `matchDeclared`), never by the plan or a readiness
	 * probe, so no cell and no planned frame changes. */
	// PR #207 CI remediation: the `m-conv-…` fixture-id rename, nothing else.
	"tools/visual/matrix.ts":
		"c94eea1f1fbdcb18835ea3d8fa98b408ab705f66142c30f42654c993f01c25e4",
	"e2e/fixtures/audit-canary/index.html":
		"96085343f6aaa34a3162c979d536208a32f897beba9bbc3633d6f3d0e37a5403",
};

/* `app` and `src` are NOT here: they are run-derived (RUN_DERIVED_ROOTS below).
 * The comment chains that used to sit on those two keys — one note per re-pin,
 * every one of them "source identity only, NOT rendered evidence" — live in git
 * history (`git log -p -- tools/audit/u08-content-pins.ts`). */
export const RENDER_TREE_PINS: Readonly<Record<string, string>> = {
	"design/fonts":
		"4d6a0f23c57ed6adff8ef353abe22c2208e802b70a961d4c8996aff3bae6b2fb",
	/* Re-pinned 2026-11-09 for feat/polish-transcript-rows with --print from the
	 * staged tree: `tokens.json` changes two `use` DESCRIPTIONS only (the `trace`
	 * step now names the tool name as well as its headline; `mono-sm` no longer
	 * lists tool names) — no size, face, colour or role moved, and `theme:check`
	 * and `preset:check` both report the generated layers current. Identity
	 * only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-09 for fix/user-message-bubble with --print from the
	 * staged tree: `tokens.json` gains ONE colour role, `user-bubble` (the fill
	 * of the reader's own transcript turn, solved >= 1.25:1 on canvas), with its
	 * rule in `palette-rules.mjs` and the regenerated preset. No existing role's
	 * value moved. Identity only, NOT rendered U-08 evidence. */
	/* Merge of origin/main b9cc5ce5 into PR #305: main's #292 (Pele diagrams)
	 * added a rule to `palette-rules.mjs` but left this pin at its parent's
	 * digest, so main itself fails the identity check. Re-derived with --print
	 * over the staged merge tree; #305 does not touch design/tokens. Identity
	 * only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-18 with --print from main: PR #292's diagram viewer added
	 * its rows to `palette-rules.mjs` (`CONTROLS`, components.md § 14) and the
	 * preset/preview layers regenerate from them. No existing role's value moved.
	 * Identity only, NOT rendered or native evidence. */
	"design/tokens":
		"42025bdc49dcf5c92bd8a8690d509cdfedd8c1b72133532aa247088e8d04bbe0",
	public: "fffab05c9f1bcb5a820ec6fc62f853d005db87e152bca97fe3e22337aa85851b",
};

export const INPUT_TREE_PINS: Readonly<Record<string, string>> = {
	"fixtures/relay":
		"c4c1d6f26a45764241473a0b9a4491763697f976ca2c1cf349f8ab9c9adec5ab",
	"fixtures/supplements":
		"29bad98e91e6e29bd8148505f06058c24ff6682b3b4ba62bd43575a6a94d19cc",
};

export const RENDER_FILE_PINS: Readonly<Record<string, string>> = {
	// Deliberate --print re-pin: only the native Info.plist export-compliance
	// declaration changed; it is not a U-08 web layout or rendered-geometry input.
	// --print re-pin: the Android `softwareKeyboardLayoutMode: "resize"` (Expo's
	// default, stated with its why); not a U-08 web layout input.
	// --print re-pin (PR #238): the native home-screen label (`LAUNCHER_LABEL`,
	// `CFBundleDisplayName` and the Android launcher-label plugin entry); `name`
	// and every web input are unchanged, so not a U-08 web layout input.
	// --print re-pin (#231): the optional Android `googleServicesFile` (FCM for
	// Team Bridge push); native build config, not a U-08 web layout input.
	// --print re-pin (integration of #238 with #231): both sides' native
	// config carried — the home-screen label plugin and `googleServicesFile`.
	// --print re-pin (feat/background-push-clear): iOS `UIBackgroundModes:
	// ["remote-notification"]` for the silent attention wake; native Info.plist
	// config, not a U-08 web layout input.
	// --print re-pin (PR #244 remediation round 1): comment-only edits — the
	// Android warm-only claim and the exact-set native-config guard.
	// --print re-pin (ADR 0010 S2): registers the Android-only
	// `with-android-team-bridge-push` config plugin (notification receiver
	// swap); native build config, not a U-08 web layout input.
	// Merge of origin/main b9cc5ce5 into PR #305: main's #292 (Pele diagrams)
	// added one dependency (package.json + pnpm-lock.yaml) without re-pinning
	// them, so main itself fails this check; re-derived with --print over the
	// staged merge tree. #305 touches neither file. Not a U-08 web layout input.
	// --print re-pin (PR #354): the expo-image-picker `cameraPermission`
	// (NSCameraUsageDescription), the Android CAMERA permission and the
	// optional-camera `uses-feature` plugin for Take Photo; native build
	// config, not a U-08 web layout input.
	"app.config.ts":
		"6110454ab30ab65bd5971c1325699557051ff09df32bd6d342509963b264c3b0",
	"metro.config.js":
		"8969b35b1269818e746e2a8e854f94995f0adbc54b18e8e80c95e90aca1aa707",
	// --print re-pin (feat/background-push-clear): adds the native module
	// `expo-task-manager` ~57.0.22, which the web bundle never renders.
	// Re-pinned 2026-11-18 with --print: since the last pin of these two the only
	// dependency move is PR #292's `pele` in `package.json` and its resolver
	// entries in the lockfile. Identity only, not a U-08 web layout input.
	"package.json":
		"065ddef424dc993a53265d5374d99be43072ec0bc6b9aee062e6c6ac2b4024ca",
	"pnpm-lock.yaml":
		"6d2fd091ae30a21f5c70cc40d212e7f2bd41de9ad9b5b86960fe7e98f21d47f9",
	"pnpm-workspace.yaml":
		"1457b9b1a5ad6f9f7adf765d6b3adbaca44c8c938f4e9ccd525579dadae34ba3",
};

/** The application under measurement: hashed by the run that renders it and
 * written into that run's receipt, never compared with a committed constant.
 *
 * WHAT THE OLD `src`/`app` PINS ACTUALLY GUARANTEED. The dispatch preflight
 * refused unless the checkout's app source hashed to the committed digest, and
 * the same job then exported `dist` from that checkout and rendered it. So a
 * proof's frames were known to come from exactly the source the digest names.
 * That is the guarantee worth keeping, and it holds just as well when the
 * run derives the digest itself: the preflight hashes the checkout, the export
 * builds from that checkout, and the receipt (geometry.json, NOT-REPRODUCED.json,
 * the fragment-verification receipts) carries `renderedSource` beside `head`.
 * A reader ties the frames to the exact bytes without trusting anything in this
 * file. The hash is of the bytes on disk, not of HEAD, so a dirty checkout is
 * recorded as what it is.
 *
 * WHAT THE COMMITTED CONSTANT ADDED, AND WHY IT IS GONE. On top of that it
 * demanded a "reviewed decision" that this is the app to measure. In practice
 * that decision was never made: `src` changes in ~75% of merges to main (141 of
 * 188 first-parent merges 2026-10-18..2026-11-18; `app` 42), so every app PR
 * ran `--print` and pasted the line, and every merge then left every other open
 * PR CONFLICTING on that same line (#305 needed four convergences in one day).
 * The paste reviewed nothing — every note on it said "source identity only, NOT
 * rendered evidence" — while a committed value that ordinary merges make stale
 * kept being "fixed" by follow-up re-pins (#316, #318). The app being different
 * is the reason to measure again, not a reason to refuse; which app gets
 * measured is decided by the ref someone dispatches, and the receipt names it.
 *
 * WHAT STAYS PINNED, AND WHY THE SAME ARGUMENT DOES NOT APPLY. The instrument
 * (it must not change between a failure and its re-measurement without review),
 * the scene inputs (a fixture edit moves line boxes under an unchanged scenario
 * name), and the rendering environment — tokens, fonts, web shell,
 * package.json, lockfile, bundler config. Those change in a handful of merges
 * each (design/tokens 7, package.json 5, pnpm-lock.yaml 4 of the same 188), so
 * the tripwire costs almost nothing and still catches a styling-layer or
 * dependency move nobody meant to measure.
 *
 * THE FOUR `src/` MODULES IN THE INSTRUMENT'S IMPORT CLOSURE (`src/ui/a11y.ts`,
 * `src/i18n/locale.ts`, `src/features/session/markdown.ts`, `src/stt/levels.ts`)
 * are no longer covered by a pin either. They are contracts the instrument
 * shares with the app on purpose (its readiness markers, locales, the table
 * cap), so they move WITH the app and a refusal would fire on exactly the
 * consistent case; their bytes are inside the recorded `src` digest, and an
 * edit to them is reviewed as the app change it is. The suite's closure test
 * still fails on any import from outside `tools/` and `src/`. */
export const RUN_DERIVED_ROOTS: readonly string[] = ["app", "src"];

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
			// Still read: the run hashes them for its receipt, and a tracked file
			// missing beneath them still refuses (contentDrift's `missing` pass).
			...RUN_DERIVED_ROOTS,
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

/** The four tables as one value, so a caller can judge content against a
 * baseline other than the committed one.
 *
 * WHY THIS EXISTS. Until this was split out, the unit suite judged its fixture
 * against the committed tables, which made "committed `src` pin == the PR's
 * `src`" a PR-time gate: every PR that touched app source had to re-pin, and
 * concurrent PRs collided on that one line (98 of the 116 first-parent merges to
 * main between 2026-10-18 and 2026-11-17 edited this file). The suite's question
 * is "does the admission logic admit and refuse the right edits?", which needs
 * a baseline it controls, not today's tree. The proof's question is "is this the
 * scene that was reviewed?", which needs the committed tables — so the default
 * below stays COMMITTED_PINS and the dispatch preflight is unchanged. */
export interface PinTables {
	readonly instrument: Readonly<Record<string, string>>;
	readonly renderTree: Readonly<Record<string, string>>;
	readonly inputTree: Readonly<Record<string, string>>;
	readonly renderFile: Readonly<Record<string, string>>;
}

/** The trust root: the only tables the executable proof ever checks against. */
export const COMMITTED_PINS: PinTables = {
	instrument: INSTRUMENT_PINS,
	renderTree: RENDER_TREE_PINS,
	inputTree: INPUT_TREE_PINS,
	renderFile: RENDER_FILE_PINS,
};

/** Tables with the committed KEYS and digests read from `content`, using the
 * same per-file and per-root digests the verdict uses. Test-only by intent: it
 * gives the suite a baseline equal to its own fixture. Re-pinning stays
 * `--print` plus a reviewed edit; nothing writes these values back. A path with
 * no readable content keeps the sentinel "absent" so it can never match. */
export function pinTablesFrom(content: RepositoryContent): PinTables {
	const files = (keys: Readonly<Record<string, string>>) =>
		Object.fromEntries(
			Object.keys(keys).map((path) => [
				path,
				content.files.get(path) ?? "absent",
			]),
		);
	const roots = (keys: Readonly<Record<string, string>>) =>
		Object.fromEntries(
			Object.keys(keys).map((root) => [root, treeDigest(content, root)]),
		);
	return {
		instrument: files(INSTRUMENT_PINS),
		renderTree: roots(RENDER_TREE_PINS),
		inputTree: roots(INPUT_TREE_PINS),
		renderFile: files(RENDER_FILE_PINS),
	};
}

export function contentDrift(
	content: RepositoryContent,
	pins: PinTables = COMMITTED_PINS,
): Drift[] {
	const drift: Drift[] = [];
	for (const path of [...content.missing].filter(isPinnedContentPath).sort())
		drift.push({
			kind: "missing",
			scope: path,
			pinned: "tracked",
			actual: "absent",
		});
	for (const [path, pinned] of Object.entries(pins.instrument)) {
		if (content.missing.has(path)) continue;
		const actual = content.files.get(path) ?? "absent";
		if (actual !== pinned)
			drift.push({ kind: "instrument", scope: path, pinned, actual });
	}
	const roots: [Record<string, string>, DriftKind][] = [
		[pins.renderTree, "render-tree"],
		[pins.inputTree, "input-tree"],
	];
	for (const [table, kind] of roots)
		for (const [root, pinned] of Object.entries(table)) {
			if (hasMissingUnder(content, root)) continue;
			const actual = treeDigest(content, root);
			if (actual !== pinned) drift.push({ kind, scope: root, pinned, actual });
		}
	for (const [path, pinned] of Object.entries(pins.renderFile)) {
		if (content.missing.has(path)) continue;
		const actual = content.files.get(path) ?? "absent";
		if (actual !== pinned)
			drift.push({ kind: "render-file", scope: path, pinned, actual });
	}
	return drift;
}

/** Refuse before any browser work; the message must let an operator act.
 * `pins` exists only so the suite can prove admission against its fixture's own
 * baseline; the proof calls this with no arguments, i.e. the live tree against
 * COMMITTED_PINS, fail-closed. */
export function assertPinnedContent(
	content: RepositoryContent = snapshotContent(),
	pins: PinTables = COMMITTED_PINS,
): RenderedSource {
	const drift = contentDrift(content, pins);
	// Returned from the SAME snapshot that was admitted, so the identity a driver
	// writes into its receipt is the one this verdict was reached on.
	if (drift.length === 0) return renderedSource(content);
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

/** Root -> tree digest of the application a run renders (RUN_DERIVED_ROOTS).
 * Drivers record it in every receipt beside `head`. */
export type RenderedSource = Readonly<Record<string, string>>;

/** Same digest as a pinned root's, so a recorded value is comparable with any
 * historical `src`/`app` pin in git history. A root with a missing tracked
 * member has no meaningful digest; contentDrift has already refused that run. */
export function renderedSource(content: RepositoryContent): RenderedSource {
	return Object.fromEntries(
		RUN_DERIVED_ROOTS.map((root) => [
			root,
			hasMissingUnder(content, root) ? "absent" : treeDigest(content, root),
		]),
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
			const source = assertPinnedContent(content);
			console.log(
				`U08 content identity matches the pinned baseline; rendered source (recorded, not pinned): ${JSON.stringify(source)}`,
			);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}
}
