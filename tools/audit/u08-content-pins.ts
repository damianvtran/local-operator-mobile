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
	"tools/audit/u08-fragment-verification.ts":
		"21e0c079b0572599e10bef7f640214835dbe30ee96c0710104e702caad6d8055",
	// PR #207 CI remediation: same `m-conv-…` fixture-id rename as above.
	"tools/audit/u08-geometry-proof.ts":
		"dac279b1e8d6fbe728d44d96505c9a2c72c192c2be71c950bcffc23ba5ffef49",
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
	"tools/mock-relay/relay.ts":
		"375535169c6988971e31dd5a537d3907da6bbd050714fb8bb713c7b8caf65671",
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
	"tools/mock-relay/scenarios.ts":
		"cf2d3918ac43b711a31ed96188a695b3082eeaa18c9e5441c6422c5281759573",
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
	"tools/mock-relay/wire.ts":
		"08bf0c314c525ecaaf04f5404bf573ed6335774769b4d36cddb4eb2b93754a00",
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
		"9f753d7aad6b191c8bc59af98e85adac897234a9734f60376b4bf9db3767777e",
	"e2e/fixtures/audit-canary/index.html":
		"96085343f6aaa34a3162c979d536208a32f897beba9bbc3633d6f3d0e37a5403",
};

/* Regenerated with --print from the fully staged composer-reliability tree:
 * native commit awaiting, platform UUID, repeat paste, honest Return and
 * session-only clear/dismiss plus keyboard budget. Identity admission only,
 * not rendered or native-device evidence; instrument/original pins unchanged. */
// Recomputed with --print at the staged #106 integration: attachment localization,
// hardened byte reads and exact-lock image-manipulator dependency. Identity only;
// rendered and real-path evidence is recorded separately, not inferred from hashes.
export const RENDER_TREE_PINS: Readonly<Record<string, string>> = {
	/* Re-pinned 2026-11-09 for PR #211's UX round-1 remediation, with --print from
	 * the staged tree. `app` moves: the session screen tags the composer box with
	 * the window it was measured in (U1). `src` moves: `heldComposerLimit`, the
	 * extras floor, and the failure notice's actions on their own lines (U2/U4).
	 * Source admission only, NOT a rendered geometry proof. */
	/* Reprinted with --print after the LAST app/src edit for PR #202 round-1
	 * remediation: shared drawer navigation changes both render trees, including
	 * the opt-in current-chat check, RN-web-safe aria-hidden and regression tests. This admits the
	 * geometry instrument to the new source; it is NOT rendered/native proof.
	 * ORIGINAL_*, instrument, file and input pins remain unchanged. */
	/* Re-pinned 2026-11-07 for PR #187's round-2 remediation, with --print from
	 * the staged tree. Only `src` moves: a resting voice outcome is no longer
	 * line-capped, start/permission failures rest on the dictation row, ✓ moves to
	 * the trailing slot while recording on a dictation-only card, and the paste
	 * denial copy names the paperclip. Source admission only, NOT a rendered
	 * geometry proof. */
	/* Re-pinned 2026-11-07 for PR #187's round-1 remediation, with --print from
	 * the staged tree. Only `src` moves: the set-up line wraps and is shorter,
	 * the toolbar mic hides while recording, the mic keeps the trailing slot when
	 * only dictation opens the card, the recording word is visually hidden, the
	 * spinner leaves the accessibility tree, the chip's denial copy, and the
	 * catalogue keys. Source admission only, NOT a rendered geometry proof. */
	/* Re-pinned 2026-11-07 for the composer paste + voice PR, with --print from
	 * the staged tree. Only `src` moves: the native paste chip, the set-up mic,
	 * the home mic, the rolling waveform and the recording row's ✕/✓, plus their
	 * catalogue keys. `app`, `design/tokens`, fonts, `public`, instrument and
	 * input pins are untouched. Source admission only, NOT evidence that U-08's
	 * rendered geometry proof passed. */
	/* Re-pinned 2026-11-06 for PR #176 review round 4's remediation, with --print
	 * from the staged tree. Only `src` moves: the frozen initial scroll index is
	 * keyed on the session it was frozen for (M-r4-1), its comment states what a
	 * frozen 0 keeps mounted (m-r4-1), and tests. `app`, `design/tokens`, fonts,
	 * `public`, instrument and input pins are untouched. Source admission only,
	 * NOT evidence that U-08's rendered geometry proof passed. */
	/* Re-pinned 2026-11-06 for PR #176 review round 3's remediation, with --print
	 * from the staged tree. `design/tokens` moves for the `trace` step's
	 * description only (D13: the tool name no longer uses it). `src` moves for
	 * the folded row drawn as a quiet line instead of a card (D4), the frozen
	 * initial scroll index (Q-RF1), the landing keyed on `reveal` (U14) and
	 * tests. `app`, fonts, `public`, instrument and input pins are untouched.
	 * Source admission only, NOT evidence that U-08's rendered geometry proof
	 * passed: it must be re-captured against this tree. */
	/* Re-pinned 2026-11-06 for PR #176 review round 2's remediation, with --print
	 * from the staged tree. `design/tokens` moves because the `meta-read` step is
	 * folded back into `meta` (D9: 12/1.45 vs 12/1.4 was its only difference) and
	 * the type `$note` is corrected to say a step DOES set its family (D8), with
	 * the generated preset/preview CSS. `src` moves for the remediation: the tool
	 * name on the `mono` step, the find landing recorded in a layout effect and
	 * closable, the resize mark only on a real change, a caught glide ending on a
	 * new drag, the folded `open` control as a named 48 pt button, the new i18n
	 * keys, and tests. `app`, fonts, `public`, instrument and input pins are
	 * untouched. Source admission only, NOT evidence that U-08's rendered
	 * geometry proof passed: it must be re-captured against this tree. */
	/* Re-pinned 2026-11-06 for PR #176 review round 1's remediation, with --print.
	 * `design/tokens` moves for three new type steps (`body-read` 14/1.55,
	 * `trace` 13/1.5, `meta-read` 12/1.45 — the relay's transcript steps) and
	 * the generated preset/preview CSS; `src` moves for the remediation itself
	 * (fade stop order, the sent-message and error folds removed, list-owned fold
	 * state, gesture-only rail presence, the reuse fix and the type steps
	 * applied). Fixture bytes, fonts, instrument modules and input pins are
	 * untouched. As with the round-0 re-pin below, this is source admission, NOT
	 * evidence that U-08's rendered geometry proof passed: it must be re-captured
	 * against this tree. */
	/* Re-pinned 2026-11-06 for the transcript design pass: type parity, collapsing,
	 * edge fades, the held-scroll rail and row-level memoisation. `src` moves
	 * because the transcript slice itself changed — the message body steps from
	 * `body-lg` 17 to `body-sm` 14, peer/sent/notice rows gain a one-line fold, the
	 * scroller gains two 24 pt gradient bands, the checkpoint rail becomes
	 * transient, and rows are memoised behind a row-identity pass. `app` moves only
	 * for the session screen's wiring of the presence object to the list and the
	 * rail. Fixture bytes, design tokens, instrument modules and input pins are
	 * untouched and the scene is unchanged, so this is source admission for a
	 * typography-and-layout change: U-08's rendered geometry proof must be
	 * RE-CAPTURED against this tree, and this re-pin is NOT evidence that it passed.
	 * Historical ORIGINAL_* pins are never re-pinned. */
	/* Reprinted 2026-11-04 for PR #164's theme pipeline and picker: `app`
	 * gains only the /theme route; `design/tokens` extracts the contrast maths
	 * and per-palette rules; `src` gains the theme catalogue, preference and
	 * picker, changes keyboard appearance and passes the selected palette to
	 * supplement frames. The default dark palette is intentionally re-lit:
	 * U-08's colour pixels therefore are NOT byte-compatible with the old
	 * scene, while typography, layout classes, transcript fixture bytes and
	 * measurement instruments are unchanged. This re-pin admits running the
	 * geometry instrument against the new scene; it is source admission, NOT
	 * evidence that the new scene passed or a reuse of old rendered proof.
	 * Historical ORIGINAL_* pins, instrument and input pins remain untouched. */

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
	/* Re-pinned 2026-11-03 for PR #159 with --print: `app` moved only by the
	 * session screen's one-line `loadSound` client wiring. */
	/* Re-pinned 2026-11-06 with --print for the home-defaults fix: `app` moves by ONE
	 * line in `app/(app)/session/[id].tsx` — the session screen's model reading is now
	 * `reportedModel(projection?.model_label)` instead of a bare nullable string, the
	 * same values in the same chip. It renders the same two outputs it always did (a
	 * selector, or the rung-less/unreported `n/a`); only the REASON the home could be
	 * wrong changes, and U-08's scene is a session transcript with no home surface in
	 * it. This is source admission for the geometry instrument, NOT fresh rendered
	 * evidence. */
	/* Re-printed 2026-11-06 with --print at the staged merge of origin/main into PR #176
	 * (transcript pass): the digest covers both lines of history — the transcript
	 * pass's own moves (pinned in the PR #176 notes earlier in this file) and the
	 * home-defaults changes described just above. Neither side's tree shipped alone
	 * after this merge, so neither side's previous digest is kept. */
	/* Re-pinned 2026-11-07 for feat/home-chrome with --print from the staged tree:
	 * `app` (the session screen hands the composer its glass decision) and `src`
	 * (header chip, home hero, inset notices, composer H5 padding and glass
	 * wiring) move; tokens, fonts and public do not. */
	/* Re-pinned 2026-11-07 for fix/smooth-steering with --print from the staged
	 * tree: `app` moves by one line (the session header's "Working" reads the
	 * composer's `turnRunning` instead of the working label alone) and `src` by
	 * the steer/prompt decision, its race reconciliation and the steer failure
	 * copy. No layout, token or glyph changes; U-08's scene renders the same
	 * frames for any projection where `streaming` and `activity` agree. Source
	 * admission, NOT fresh rendered evidence. */
	/* Re-pinned 2026-11-07 for fix/session-chips-rail with --print from the
	 * staged tree: the session screen feeds its chips from the list row as well
	 * as the projection (ended sessions, TestFlight 578); round-1 remediation
	 * re-printed it again for the chip-command error line. Source admission
	 * only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for feat/thinking-indicator with --print from the
	 * staged tree: the session screen mounts the pinned working line (spinner,
	 * activity, clock, Stop) in the dock above the chips on tray layouts and drops
	 * the duplicate line from the status sheet. Source admission only, NOT
	 * rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for PR #189's round-1 remediation with --print from
	 * the staged tree: the header subtitle ticks on the shared phase clock, the
	 * pinned line yields to the short-landscape tray (whose sheet keeps the line),
	 * and both Stops read one latch. Source admission only, NOT rendered U-08
	 * evidence. */
	/* Re-pinned 2026-11-07 for the merge of origin/main (smooth steering) into
	 * feat/thinking-indicator, with --print from the merged tree: `app` carries
	 * both sides (the header reads `runtime.streaming` on the ticking subtitle).
	 * Source admission only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for feat/pending-echo with --print from the staged
	 * tree: the session screen hands the transcript list its pending-echo rows
	 * (a new `pending` prop, painted ahead of the unchanged notice footer) and
	 * drops its empty state while a first message is in flight. Source admission only, NOT
	 * rendered U-08 evidence. Re-printed with --print for the round-1 remediation:
	 * the screen hands the rows the composer's put-back, and the hook-call comment
	 * moves to its own line. */
	/* Re-printed 2026-11-07 with --print at the merge of origin/main (b5a2f4a1,
	 * PR #190 smooth steering) into feat/pending-echo (PR #191): both lines of
	 * history above stand, the value is the merged tree's own, and neither
	 * side's previous digest is kept. Source admission, not rendered evidence. */
	/* Re-printed 2026-11-07 with --print at the final tree of the TestFlight 578
	 * merge train (chore/merge-train-578: #183 #186 #188 #185 #187 #189 #191 #192
	 * merged --no-ff onto origin/main 56303c83). Every PR's history note above
	 * stands; the value is the train tree's own and no PR's digest is kept. Only
	 * `app` and `src` move.
	 * Source admission only, NOT rendered U-08 evidence. */ /* Re-pinned 2026-11-08 at the merge of origin/main 2c99a014 into PR #105 with
	 * `--print` from the merged tree. `app` and `src` move because the Team Bridge
	 * surface is new source in both trees (its screens under `app/(app)`, its
	 * modules under `src/team-bridge` and the auth accessor); the proof's plan,
	 * probe, thresholds and scene inputs did not move, so this is CONTENT identity,
	 * not a measured-pixel change. Neither side's previous digest is kept. */

	/* QA round-3 Q3: the session screen passes the composer's `capped` report to
	 * `composerLimit`, so the portrait ceiling cannot oscillate. Recomputed with
	 * --print from the staged tree; `app` and `src` moved. Identity only. */
	// PR #207 remediation: the session screen threads the history retry action
	// and its failure scope to the list. Staged LIVE source admission only.
	// Round 3 adds the gap position prop (`historyGapBefore`); same scope.
	// PR #207 merge-gate convergence with main 235db698 (#206): the merged
	// app tree has neither parent's digest; re-pinned with --print over the
	// staged merged tree. Source admission only, no rendered or native proof
	// refreshed.
	// Re-pinned with --print over the staged tree for PR B's round-1
	// remediation (the session screen memoises the counts element and derives
	// one activity-line flag). Source admission only.
	// PR #211 build-753 feedback: the session screen feeds the composer
	// More sheet's Questions row from any ask. Re-pinned with --print over the
	// staged tree; source admission only, no rendered or native proof.
	// Bridge drawer switch: the root layout mounts the Team Bridge drawer
	// adapter; source identity only, no rendered or native proof.
	// PR #211 merged with main a563a6f3 (#212): the merged tree carries #212's
	// Team Bridge drawer switch and this PR's composer work, so it has neither
	// parent's digest; re-pinned with --print over the staged merged tree.
	// Source admission only, no rendered or native proof refreshed.
	// TestFlight 753 keyboard fix: the session screen caps the composer against
	// the keyboard-aware visible height; re-pinned with --print over the staged
	// tree. Source admission only, no rendered or native proof refreshed.
	// Resume gap heal (#217): the session screen threads `healHistory` (the
	// quiet gap row's Load) instead of the destructive reload. Merged with main
	// 2faead90 (#211): re-derived with --print over the staged merged tree;
	// source identity only, no rendered or native proof.
	// PR #216 merged with main 5fb51be0 (#214 user bubble, #217 transcript
	// self-heal): the merged tree carries healHistory and the keyboard-aware
	// cap, so it has neither parent's digest; re-derived with --print over the
	// staged merged tree. Source admission only, no rendered or native proof.
	// Transcript condensing polish (Tier A fold bar, idle completed-turn
	// condensing): the startup and subagent screens pass `turnLive` to the
	// list. Re-derived with --print over the staged tree; source identity
	// only, no rendered or native proof.
	/* Re-pinned 2026-11-11 for PR #227 (i18n app-scan English closure) rebased
	 * onto main d458ecdf (#224, #226, #228, #229). Re-derived with
	 * `--print` over the converged tree. `app` and `src` move because user-visible
	 * literals in the session, subagent, not-found, computers and settings
	 * screens are now keyed `t()` calls (English catalogue values are the same
	 * words), plus the catalogues and generated projection under `src/i18n`. No
	 * layout, token, instrument or fixture input changed. Source admission only,
	 * NOT rendered U-08 evidence. */
	// Composer growth / paste / Bridge gap (TestFlight 836): the session
	// screen measures its transcript for the composer's ceiling. Re-derived
	// with --print; source identity only, no rendered or native proof.
	// PR #230 round-2 remediation (M2): the session screen holds the
	// transcript slack through a keyboard lift (`onLift`). Re-derived with
	// --print; source identity only, no rendered or native proof.
	/* Re-pinned 2026-11-11 for integrate/mobile-batch-1111 (#230, #232, #233,
	 * #234 and #235 merged onto main fa2bc5e0): #230's session-screen change is
	 * carried with #227's, so this is neither parent's digest; re-derived with
	 * `--print` over the staged integrated tree. Source admission only, NOT
	 * rendered U-08 evidence. */
	/* Re-pinned 2026-11-12 for PR #236 (M2 expression literals) rebased onto main
	 * 2b508d9d (#237 integration of #231, #235, #239 and the session-screen work):
	 * the session route's keyed literals (context tray, scroll cues, video title,
	 * fallback names, region labels, back-to labels) are carried with main's
	 * session-screen change, so neither parent's digest. Re-derived with `--print`
	 * over the committed rebased tree. Source admission only, NOT rendered U-08
	 * evidence. */
	/* --print re-pin for feat/background-push-clear: the background notification
	 * task (module-scope `defineTask` imported first in app/_layout.tsx, the
	 * signed-in scope registration in the Team Bridge provider) and the `body`
	 * payload envelope read. No rendered component, style or token changed;
	 * re-derived over the staged tree. Source identity only, NOT rendered U-08
	 * evidence. */
	app: "be8f661a9e6f8103946ae3a1cd083c07a68c3fff7638b2c6f5aeb979d81637d4",

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
	"design/tokens":
		"505afe475a6bd4f05c9673940f123fd273e18c98171f3d676a9fb7e037ba2291",
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
	/* Re-pinned 2026-10-31 for merging main into PR #105 (Team Bridge): `app`
	 * gains `TeamBridgeProvider` inside main's `DirectionRoot`, `src` carries the
	 * merged connection provider, drawer route count and a11y ids, and
	 * `tools/audit/checks.ts` is the auto-merged union of both sides. Recomputed
	 * with `--print` from the staged merged tree. */
	/* Re-pinned 2026-10-31 for #105 M1/M2 remediation: stored credentials refuse
	 * tombstone authority, explicit durable replacement is lifecycle-fenced,
	 * Settings shows local signing-out feedback, and all eight locales include
	 * its keys. `src` only; no instrument or fixture changes. --print recomputed
	 * after the final source edit; this is identity, not rendered visual proof. */
	/* Main convergence 2026-10-31: #143 adds avatar rendering in app/src and
	 * two catalogue keys; #105 retains Team Bridge and M1/M2 security/pending
	 * behavior. Digests below identify the mechanical union only. They are NOT
	 * a review refresh or rendered evidence; convergence QA is still pending. */
	/* #105 localization 2026-10-31: the same four Team Bridge screens now read
	 * 86 complete messages from all eight catalogues (233 total keys). Runtime
	 * copy and generated source moved; auth/lifecycle/Settings bytes did not.
	 * Source identity only — fresh independent language and rendered review owed. */
	/* I1/I2 lexical delta: VI software-agent glossary and three UR unread
	 * messages, their projection and regressions only. Component/auth bytes
	 * unchanged; updated Urdu labels still require fresh rendered evidence. */
	/* Re-pinned 2026-10-31 for incoming Bridge grouping (#146), deliberately:
	 * optional wire/parser facts, positive receipt classification and material
	 * ownership move src. The exact 520-row long-transcript U-08 scene parses
	 * and produces identical condense/group plans against b51f098a in collapsed,
	 * first-expanded and all-expanded states (SHA256 93b57ecb3c0caf8b...). This
	 * is source-plan equivalence, not a new rendered/native proof. --print finds
	 * only this current render-tree identity changed; instrument/input pins and
	 * historical ORIGINAL_* incident identities are not altered. */
	/* DIRTY convergence with main239cada4 (#145 Library i18n): recomputed
	 * with --print over the combined tree, not either side's isolated digest.
	 * Old head83b6 and this tree still parse the exact 520-row scene and yield
	 * identical plans in the three states above (same SHA256); Library labels
	 * do not enter that measured scene. All other pin tables stay unchanged. */
	/* Recompute from the actual union: endpoint-owned avatar retirement and
	 * localized profile controls plus current delivery/help/schema/fixtures.
	 * Neither parent digest proves this merged corpus; runtime pins stay exact. */
	/* Re-pinned 2026-11-03 for PR #154, deliberately, using --print: only OAuth
	 * callback transport/state validation and provider cancellation bookkeeping
	 * changed under src. U-08 measures the long-transcript custom-relay session
	 * (u08-geometry-proof.ts RECORD/createRelay), not Radient sign-in. No transcript
	 * component, layout/style, token, corpus, scene or instrument changed. These
	 * auth/connection edits therefore do not alter the measured geometry inputs;
	 * historical ORIGINAL_* identities and every other pin remain unchanged. */
	/* Re-pinned 2026-11-03 for PR #157 (right-sized agent avatar variants), with
	 * --print: `src` only. `agentAvatar` gains an optional `size` query, the avatar
	 * cache key gains the variant, and the hook picks it from dp x PixelRatio when
	 * the relay advertises `features.agent_avatar_sizes`. The U-08 mock relay
	 * advertises no such flag and its scene rows carry no agent picture, so the
	 * measured transcript renders the same; no layout, style, token, corpus,
	 * scene or instrument file changed, and every other pin is untouched. */
	/* Re-pinned 2026-11-03 for PR #159 with --print: `src` carries the supplement
	 * block's sounds/video/withheld rendering, its parser and 12 catalogue keys.
	 * All of it renders only for a beat carrying sounds, a video file or withheld
	 * entries, and the U-08 long-transcript scene has zero supplement beats (same
	 * world hash on main and head), so no measured transcript row changes.
	 * Converged onto main 24a3d30f (#157 above): recomputed over the combined tree. */
	/* Re-pinned 2026-11-03 with --print for the real-app sign-in fix: account
	 * admission, progress/errors/diagnostics and the brand-title lockup. U-08 is
	 * a custom-relay transcript, not OAuth. Its Screen supplies a custom titleNode
	 * (session/[id].tsx), so the Local Operator-only default brand title is not
	 * selected; Heading's new optional metrics callback is undefined there. No
	 * transcript layout, corpus or instrument changed. This is source-boundary
	 * judgment, not new rendered U-08 proof; historical identities stay intact. */
	// Includes the newly tracked sign-in source files (print after staging).
	/* Round-1 remediation: reprinted after staging all new source files.
	 * Welcome/re-auth navigation and disclosure copy, plus the explicit brand
	 * lockup's first-line metrics, do not enter U-08's custom session titleNode.
	 * Button's optional expanded state is omitted for existing transcript
	 * controls. No transcript/corpus/instrument change; historical pins retained. */
	/* Reprinted with --print after the unified error-writer/copy remediation
	 * and relocation of the HTTP integration test. The healthy custom-relay
	 * U-08 transcript selects no tunnel-refusal, diagnostic-details or protected
	 * Radient-row branches. Existing custom-route carriers and transcript geometry
	 * inputs are unchanged; historical/corpus/instrument pins remain untouched.
	 * This is source compatibility judgment, not fresh geometry evidence. */
	/* Reprinted after rebasing Android onto shipped f98eb185 and regenerating
	 * the merged catalogues. Android adapter selection/return-page messages do
	 * not enter U-08's healthy custom-relay transcript; no transcript, layout,
	 * style, token, corpus or instrument input changes. Historical pins retained. */
	/* Recomputed again for the required DIRTY convergence with Android #155:
	 * both catalogues are retained; the Android-only adapter path does not
	 * affect the iOS theme walk. This is the combined source admission hash,
	 * never either side's stale hash or a claim of rendered equivalence. */
	/* Recomputed 2026-11-05 after the mechanical merge with main ab7e3fa9 and the
	 * removal of the out-of-scope native auth-probe layer (saved-route
	 * diagnostics, transport XCTest carrier, auth-save contract): the theme work
	 * is the only source delta left on this branch, and main's notification
	 * settings moved `app.config.ts`. `--print` produced both digests; this is
	 * source admission for the geometry instrument, not rendered evidence.
	 *
	 * Recomputed again for the 2026-11-05 convergence with the merged native
	 * chrome PR (#163, main a21aa8d2): the composer and session geometry below
	 * is main's verbatim, the theme work is the only source delta, and the one
	 * `src` digest at the end of this block is the combined tree. */
	/* Deliberate --print re-pin (notification sounds, M1, re-printed after
	 * merging main's Android OAuth change above): the Android
	 * notification-channel set (src/notifications/native.ts, sound-catalog.ts),
	 * its unit test, and new mobile.notifications.channel.* catalogue keys. None
	 * is rendered on the web target: channels are created only on Android, and
	 * the keys are read only by that call. No transcript/corpus/instrument
	 * change; historical pins retained. */
	/* Deliberate --print re-pin (M2): native custom-sound cache, relay routes,
	 * lifecycle invalidation and tests. The new root hook returns on web before
	 * IO; its store subscriptions render nothing. Config changedKeys is data
	 * for that hook, not a transcript rendering change. No tokens, styles,
	 * transcript components, corpus or instrument changed. Native filesystem
	 * proof is separate; this retains only the unchanged U08 web geometry. */
	/* Deliberate re-pin for PR #166 (native session persistence, operator incident
	 * #389), after review round 1: `src` renews an expiring account token and the
	 * five-minute tunnel grant in place, and the provider's discovery pass reports
	 * those outcomes through the connection store. No screen, layout, style, token
	 * or transcript input is added or renamed, and U-08's healthy custom-relay
	 * transcript selects none of the renewed branches — this is a source-
	 * compatibility re-pin, not fresh geometry evidence. `app` untouched;
	 * historical pins retained. Recomputed with `--print` after the merge with
	 * main (#162 notification-store changes).
	 *
	 * Re-pinned 2026-11-05, still deliberately: the round-6 composer work is inside
	 * BOTH trees — `src/features/session/components/composer.tsx` (one seed per
	 * morph state, the radius from the measured pill, the landscape duplicate More
	 * removed) and `src/ui/a11y.ts` (the retired compact-context identifier). The
	 * app tree moves with the screen that mounts them. Values are `--print` output
	 * from the merged head, not hand-written.
	 *
	 * Re-pinned 2026-11-05 for round 7, src only: `composer.tsx` lost the
	 * `!compactSingle` guard on the collapsed seed (a landscape pill now measures
	 * itself and is floored), the overflow clip follows the animation's own
	 * progress instead of a timer, and `composer-presentation.ts` gained
	 * `seedFor` plus a floor-aware presentation. `app` untouched.
	 *
	 * Re-pinned 2026-11-05 for the round-4 minors, `src` only: the Appearance mode
	 * control's accessible name changed in all eight catalogues (`Theme mode`
	 * instead of repeating the section header) and the generated catalogue moved
	 * with it. No rendered string, layout or palette changed; frames unaffected.
	 *
	 * Re-pinned 2026-11-06, `src` only (the composer shell boundary): `composer.tsx`
	 * gained one absolutely positioned, `pointerEvents="none"` ring child on the
	 * composer shell, and `composer-presentation.ts` gained `composerShellRadius` —
	 * the single helper both the shell and the ring read. The ring is out of flow, so
	 * no painted box moves: `composerPaintedHeight` is still 56/112 (60/120 on the 48
	 * floor) and the resting radius is still `morphPillRadius(base)`. This is source
	 * admission for the geometry instrument, not fresh rendered evidence — the U-08
	 * frames predate the edge and the rendered re-capture is tracked separately.
	 * `--print` produced the digest; `app`, `design/fonts`, `design/tokens`, `public`,
	 * the corpus and the instrument modules are unchanged.
	 *
	 * Re-pinned 2026-11-06 again, `src` only (review round 1 remediation of the same
	 * PR): `a11y.ts` declares `CONTROL.composerShellRing` and `composer.tsx` renders it
	 * as the ring's `testID`, so the guard that locates the ring can anchor on an id the
	 * shell never carries; the ring's own comment was also corrected to the mechanism
	 * the code has (a shell border costs the interior, the radii do not move). A
	 * `testID` paints nothing and a comment paints nothing — `borderWidth`, the colour,
	 * the four insets and the radius are byte-identical to the digest above, so no
	 * pixel of the U-08 scene moves. `--print` produced the digest; `app`,
	 * `design/fonts`, `design/tokens`, `public`, the corpus and the instrument modules
	 * are unchanged.
	 *
	 * Re-pinned 2026-11-06, `src` only (the launch-crash fix, PR #168): exactly two
	 * files moved. `composer-presentation.ts` gained `"worklet"` as the first
	 * statement of `morphPillRadius`, `morphHeight` and `composerShellRadius` — the
	 * three pure helpers `shellMotion`/`ringMotion` call from the UI runtime — plus
	 * the comments stating why each must stay pure arithmetic; and
	 * `composer-worklets.test.ts` is new (a static guard over those directives). A
	 * directive changes which JS context compiles a body, not what the body computes:
	 * each helper's expression is unchanged (`base / 2`, the clamped lerp, and
	 * `morphHeight(progress, morphPillRadius(base), 24)`), and the only edit is the
	 * arrow becoming a block body so the directive can be its first statement. A test
	 * file is never bundled into the render tree. So no pixel of the U-08 scene moves
	 * and `composerPaintedHeight` is still 56/112 (60/120 on the 48 floor). This is
	 * source admission for the geometry instrument, not fresh rendered evidence; the
	 * native lane (nightly 42156335030) is what proves the directive actually
	 * prevents the synchronous-call crash. `--print` produced the digest; `app`,
	 * `design/fonts`, `design/tokens`, `public`, the corpus and the instrument modules
	 * are unchanged.
	 *
	 * Re-pinned 2026-11-06, `src` only (review round 1 remediation of the same PR):
	 * the same two files moved again, and nothing painted. `composer-worklets.test.ts`
	 * gained a presence assertion ahead of the directive check — `bodyOf` answers `""`
	 * for a helper it cannot find and `declaresWorklet("")` is false, so deleting
	 * `composerPresentation` outright used to leave the whole suite green — and both
	 * that test's comment and the `composerPresentation` doc comment were corrected to
	 * the real mechanism: it calls `composerOuterGap`, `composerPaintedHeight` and
	 * `composerShellPadding`, none of which are worklets, so marking it would carry
	 * three remote functions onto the UI runtime and move the crash one call deeper. An
	 * assertion and a comment change no executable geometry: the three directives, every
	 * helper's expression and `composer.tsx` are byte-identical to the digest above, so
	 * no pixel of the U-08 scene moves. This is source admission for the geometry
	 * instrument, not fresh rendered evidence. `--print` produced the digest; `app`,
	 * `design/fonts`, `design/tokens`, `public`, the corpus and the instrument modules
	 * are unchanged. */
	/* Re-pinned 2026-11-06 with `--print` for the home-defaults fix, `src` (with
	 * `app`, above): the composer home no longer takes the model catalogue's first
	 * entry as a default model, keeps both reads' failures as failures, starts in the
	 * computer's own default folder and offers its recent directories. The U-08
	 * scene is the long-transcript custom-relay session — no home surface is
	 * rendered in it, and the chips' only changed cases ("nothing chosen", "list
	 * unread") cannot occur there, so this is source admission rather than a claim
	 * that the measured geometry moved. Historical ORIGINAL_* identities, the
	 * instrument modules, the corpus and every other pin are untouched. */
	/* Re-printed 2026-11-06 at the STAGED round-1 remediation tree (the committed pin
	 * above was captured before the two new `home-defaults` files were tracked, so it
	 * described no tree that ever shipped — review R1 / QA Q1). What moved: the folder
	 * read now fills only an unfilled slot, the two reads have their own effects and
	 * retries, the restored-record supersede no longer waits for a resolved folder, the
	 * options sheet gained the two "back to the computer's default" rows and per-row
	 * recent ids, and two catalogue keys were added. `app` is untouched by this round.
	 * The U-08 scene renders no home surface, so this is still source admission rather
	 * than a claim that any measured geometry moved. */
	/* Re-printed 2026-11-06 at the STAGED round-2 remediation tree: the home's folder
	 * state is tagged per computer (R2-1), the restored-home rewrite waits on "no
	 * Apply yet in this mount" (R2-2), and the startup coordinator drops a restored
	 * model before `resume()` can replay it (R2-3). Logic only — no rendered surface,
	 * copy or catalogue key changed, `app` is untouched, and U-08's scene still renders
	 * no home surface: source admission, not a claim that measured geometry moved. */
	/* Re-printed 2026-11-06 at the STAGED design/UX round-1 remediation tree: the
	 * options sheet's "computer's default model" row stays mounted and is the selected
	 * row while nothing is chosen (D1/U3), the sheet rows announce selection through a
	 * new optional `Button` `selected` prop (U5), the chip keeps "Default" when the
	 * models read failed (D2/U1), and the models Retry shows `loading` (U2). No token,
	 * catalogue key or `app` change, and U-08's scene still renders no home surface:
	 * source admission, not a claim that measured geometry moved. */
	/* Re-printed 2026-11-06 with --print at the staged merge of origin/main into PR #176
	 * (transcript pass): the digest covers both lines of history — the transcript
	 * pass's own moves (pinned in the PR #176 notes earlier in this file) and the
	 * home-defaults changes described just above. Neither side's tree shipped alone
	 * after this merge, so neither side's previous digest is kept. */
	/* Re-printed 2026-11-06 for the U-42/U-01 spacing fix (#163 regressions): the
	 * composer's disc seams and the sidebar destinations' icon-to-label step move
	 * from `gap-0.5` (2 pt, off the 4 pt scale) to `gap-1`, the dock's bottom inset
	 * moves from its margin to a carrier's padding (same painted position), and the
	 * queued-message chip gains a `TOUCH_FLOOR` height. U-08's scene is the session
	 * screen, so the composer IS in it: this is source admission only — the 2 pt
	 * seam shift is not claimed geometry-neutral here; `u08-geometry-proof` measures
	 * that. No token, catalogue key or `app` change; no other pin moved. */
	/* Re-printed 2026-11-06 with --print at the staged merge of origin/main (PR #176,
	 * transcript pass, d5d096f8) into PR #177 (U-42 spacing fix): both notes above stand,
	 * and the digest covers both lines of history. Neither side's tree ships alone after
	 * this merge, so neither previous digest is kept. */
	/* Re-pinned 2026-11-07 for feat/home-chrome round-1 remediation with --print
	 * from the staged tree: `src` only (resting-row centring, glass layer radius,
	 * strip capsules, brand mark inside the header chip, hero hold/first frame,
	 * alert action placement, folder Retry loading and focus); `app` unchanged. */
	/* Re-pinned 2026-11-07 for feat/home-chrome round-2 remediation with --print
	 * from the staged tree: `src` only, focus logic with no layout change (the
	 * splash's mount-seeded focus latch, the native composer guard, Retry focus
	 * tied to the pressed attempt, a moved import in `variants.ts`); `app`
	 * unchanged. */
	/* Re-pinned 2026-11-07 for feat/home-chrome round-3 remediation with --print
	 * from the staged tree: `src` only (the home's notice stack is a capped
	 * ScrollView so the composer never moves — Q-R2-1; the hero's centring
	 * offset is a spacer's height, not a padding — Q-R2-3; one new SURFACE
	 * id); `app` unchanged. */
	/* Re-printed 2026-11-06 with --print at PR #178's staged tree (the fix for the
	 * TestFlight 453 reports, not the 453 build's own tree), including its round-1
	 * remediation: the Radient token exchange and tunnel discovery gained a request
	 * deadline that also refuses an already-aborted caller, a route that supersedes
	 * an in-flight sign-in settles its pending state, a control-plane 5xx on the
	 * tunnel grant renewal is typed transient (`unavailable`), the conversation
	 * stream reconnects through that class, and the list stream's restart uses the
	 * conversation stream's backoff/Retry-After, floored by the curve so a
	 * `Retry-After: 0` cannot loop (round 2). Connection logic and tests only —
	 * no rendered surface, copy, catalogue key or `app` change, and U-08's
	 * transcript scene renders none of it: source admission, not a geometry claim. */
	/* Re-printed 2026-11-06 with --print at the merge of origin/main (d5d096f8,
	 * PR #176) into PR #178: neither side's digest describes the merged `src`, so
	 * both notes above stand and this value is the merged tree's own. Re-printed
	 * again for round-3 M1: `reconnectDelay` caps at setTimeout's 2^31-1 ms
	 * ceiling. Logic only; no rendered surface. */
	/* Re-printed 2026-11-07 with --print at the merge of origin/main (e541a904,
	 * PR #177) into PR #178: both lines of history, so the value is the merged
	 * tree's own and neither side's previous digest is kept.
	 *
	 * Re-printed 2026-11-07 with --print at the merge of origin/main 56840161
	 * (`fix/tf-reports`, `docs/ship-vitest-config`) into PR #156: this is the
	 * harness-split re-print plus main's moves, so neither prior digest is kept.
	 * The split removed exactly three proof-only instrument modules —
	 * `src/testing/stage-b-draft-bootstrap.ts`, `stage-b-draft-transport.ts`,
	 * `stage-b-route-trace.ts` — and their own test
	 * `src/testing/__tests__/stage-b-draft-bootstrap.test.ts`. Nothing under `app/`,
	 * `design/`, `public/`, the corpus or the geometry instruments moved, and no file
	 * the shipping bundle loads was touched: those modules were reached only by the
	 * native lane's scripts, never by an `src/app` entry or a rendered screen, and a
	 * test file is never bundled. So no pixel of the U-08 scene moves and the composer
	 * geometry is byte-identical to main's digest above. This is source admission for
	 * the geometry instrument, not fresh rendered evidence. --print produced the digest. */
	/* Re-printed 2026-11-07 with --print at the STAGED sidebar-density tree (design spec
	 * 2026-11-06 § 4, with review round 1's remediation): the drawer's width rule moves
	 * to `min(400, vw − TOUCH_FLOOR)` (the page sliver is the platform touch floor), the
	 * conversation row drops its fixed 56 pt floor for `TOUCH_FLOOR` with `py-2`/`gap-1`
	 * and a `label` title, and the panel's header/footer tighten (fixed 60 → `py-1`,
	 * destination slots 52 → `TOUCH_FLOOR`, workspace row above the strip at `gap-2`).
	 * The drawer's "Close conversations" label moves into the catalogue
	 * (`mobile.chrome.close_conversations`, all eight locales). U-08's scene is the
	 * session screen, not the drawer: source admission only, not a claim that measured
	 * geometry moved. No token or `app` change. */
	/* Re-printed 2026-11-07 with --print at the merge of origin/main (56840161 PR #178,
	 * f36e0e32 PR #156) into PR #180 (sidebar density): both lines of history stand, so
	 * every note above is kept and the value is the merged tree's own; neither side's
	 * previous digest is kept. Source admission, not a geometry claim. */
	/* Re-printed 2026-11-07 with --print at the merge of origin/main (f36e0e32:
	 * PR #178's sign-in/connection timeouts and tunnel-grant retry, PR #156's
	 * encrypted draft recovery) into feat/home-chrome (PR #181): both lines of
	 * history above stand, the value is the merged tree's own, and neither side's
	 * previous digest is kept. */
	/* Re-printed 2026-11-07 with --print at the STAGED merge of origin/main (c14ca1a6,
	 * PR #181 home chrome: header/hero/alerts/composer, notice stack, glass wiring) into
	 * PR #180 (sidebar density): both lines of history stand, so every note above is
	 * kept and the value is the merged tree's own; neither side's previous digest is
	 * kept. Source admission, not a geometry claim. */
	/* Re-pinned 2026-11-07 for feat/home-pickers with --print from the staged
	 * tree. Only `src` moves: the home's three pickers (folder, model, effort)
	 * replace the options sheet, the strip gains its folder and effort chips, the
	 * contracts gain the v0.101.9 `default`/`efforts`/`session_start.effort`
	 * fields, the new i18n keys, and tests. `app`, `design/tokens`, fonts and
	 * `public` are untouched. Source admission only, NOT evidence that U-08's
	 * rendered geometry proof passed: it must be re-captured against this tree. */
	/* Re-pinned 2026-11-07 for PR #182's round-1 remediation with --print from
	 * the staged tree. Only `src` moves: the folder chip's real name, glyph, cap
	 * and yield order in the composer strip, centred picker badges, the effort
	 * rows' dot/checked state, the effort "this computer's level" row, the new
	 * i18n keys and the catalogue invariants they move, and tests. Source
	 * admission only, NOT rendered U-08 evidence. */
	/* Re-printed 2026-11-07 with --print at the STAGED merge of origin/main
	 * (bec917d3, PR #180 sidebar density) into feat/home-pickers (PR #182): both
	 * lines of history above stand, the value is the merged tree's own, and
	 * neither side's previous digest is kept. Source admission, not a geometry
	 * claim. */
	/* Re-pinned 2026-11-07 for feat/startup-restore-computer with --print from the
	 * staged tree. Only `src` moves: the cold start reopens the last computer used
	 * (or the only one) through `src/features/auth/cold-start-computer.ts`, wired in
	 * `connection-provider.tsx`, plus tests. No copy, styling or layout changes;
	 * `app`, `design/tokens`, fonts and `public` are untouched. Source admission
	 * only, NOT rendered U-08 evidence.
	 * Re-pinned again for the round-1 remediation, --print from the staged tree:
	 * `cold-start-computer.ts` narrows "last" to usable Radient entries and
	 * `saved-computers.ts` stops stamping a use on a never-used Remove. Logic and
	 * tests only; no copy, styling or layout. */
	/* Re-printed 2026-11-07 with --print at the STAGED merge of origin/main
	 * (b5a2f4a1, PR #190 smooth steering: steer/prompt decision, race
	 * reconciliation, steer failure copy) into feat/startup-restore-computer
	 * (PR #184): both lines of history above stand, the value is the merged
	 * tree's own, and neither side's previous digest is kept. Source admission,
	 * not a geometry claim. */
	/* Re-pinned 2026-11-07 for fix/asks-pending-parity with --print from the
	 * staged tree. Only `src` moves: the ask bar and sheet title count only
	 * `open` asks as waiting and draw a lapsed-only queue quietly as "timed out"
	 * (local-operator #2388's outstanding rule), plus tests.
	 * Source admission only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for the same PR (#183) with --print from the staged
	 * tree. Only `src` moves: a timed-out ask is read-only in the asks sheet
	 * (no Answer/Decline, Dismiss only, `settle` refuses respond/decline) and its
	 * state line uses the desktop/relay copy (D10), plus tests. Source admission
	 * only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for #183 round-1 remediation with --print from the
	 * staged tree. Only `src` moves: the sheet's walk advances to the next ask
	 * with a verb (Dismiss included), timed-out rows and the quiet bar's excerpt
	 * use muted ink, an older daemon's tally is reconciled, plus tests. Source
	 * admission only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for fix/session-chips-rail with --print from the
	 * staged tree: `src` moves for the ended-session chip fallback (new
	 * `session-chips.ts`, the `—` that replaces `n/a`, three i18n keys, an
	 * optional `SessionSummary.effort`) and the subtler checkpoint rail (speed
	 * gate, 1 s linger, decimation, hairline marks in an outer gutter). U-08's
	 * scene is a long transcript whose rail is transient and aria-hidden; this
	 * is source admission only, NOT rendered U-08 evidence. Round-1 remediation
	 * re-printed it for the pre-frame disabled chip, the hidden live rungless
	 * effort chip, the 12 pt rail gap and the 7 pt rail edge. */
	/* Re-pinned 2026-11-07 for feat/switcher-sheet-style with --print from the
	 * staged tree. Only `src` moves: the computer switcher sheet restyled as a
	 * grouped list (rounded rows, trailing check, "Radient · Online" second
	 * line, add row in the body instead of the pinned footer), the new
	 * `mobile.computers.transport.radient` key, its catalogues and the catalogue
	 * invariants it moves, and tests.
	 * Source admission only, NOT rendered U-08 evidence.
	 * Re-pinned again the same day with --print for the design round 1
	 * remediation (D1 address-titled rows: "Your address" line 2, middle-
	 * truncated title, new `mobile.computers.transport.custom` key; D2 no `·`
	 * before the health dot). Source admission only. */
	/* Re-printed 2026-11-07 for feat/home-polish (TestFlight 578 feedback) with
	 * --print from the staged tree. Only `src` moves: the home hero becomes a
	 * centred mark + one-step-smaller greeting, the composer strip packs its chips
	 * left (More takes the free width), the ☰ count moves inside its box with a
	 * lead before the computer selector, the drawer panel loses its right border,
	 * and tests. Round-1 remediation re-printed it again: the session strip's
	 * effort holds, suggestion rows start-align at large text, and the hero mark
	 * gains a border-control ring. Round-2 remediation (R2-M1) re-printed it once
	 * more: the session strip's model and effort take a weighted shrink pair
	 * (SESSION_STRIP_SHRINK) so the trailing controls never clip. Round-3
	 * remediation (R3-M1) re-printed it again: effort is rigid under a measured
	 * JS cap (sessionEffortMaxWidth), because native Yoga 0.86.3 mis-resolves the
	 * weighted pair (yoga#2006). Source admission only, NOT rendered U-08
	 * evidence. (History: that strip is gone. Polish PR B moved the chips onto
	 * the composer card and removed both names; `composerChipPlan` in
	 * composer-layout.ts is the rule that replaced them.) */
	/* Re-printed 2026-11-07 with --print at the STAGED merge of origin/main
	 * (b5a2f4a1, PR #190 smooth steering) into feat/composer-paste-voice
	 * (PR #187, round-2 head 875cebf7): both lines of history stand, the value is
	 * the merged tree's own, neither side's digest is kept. Source admission, not
	 * a geometry claim. */
	/* Re-pinned 2026-11-07 for feat/thinking-indicator with --print from the
	 * staged tree. Only `src` and `app` move: `PinnedWorkingLine` and the Stop on
	 * the working line, `pinnedWorkingLine` derivation, the mirrored
	 * `relay.composer` stop keys (8 locales) and their generated catalogue, one
	 * control id, and tests. Source admission only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for PR #189's round-1 remediation with --print from
	 * the staged tree: the per-session stop latch (`turn-stop.ts`) shared by the
	 * composer's ■ and the line's Stop, the shared phase clock, the line's row
	 * sizing / hitSlop / rest glyph, and tests. Source admission only, NOT
	 * rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for the merge of origin/main (smooth steering) with
	 * --print from the merged tree: `turnRunning` beside `pinnedWorkingLine`, both
	 * sides' composer, runtime and relay changes, and tests. Source admission
	 * only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for PR #189 Q1/U2/D3 with --print from the staged
	 * tree: `pinnedWorkingLine` gates on `turnRunning` (so a lowered `streaming`
	 * under a live label keeps the line and its Stop), with its frame test and a
	 * hook-level `runtime.streaming` assertion. `app` does not move. Source
	 * admission only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for feat/pending-echo with --print from the staged
	 * tree. Only `app` and `src` move: the pending-echo store, row and tests, the
	 * composer's `onHeld` paint/unpaint, the send path's `onHeld` hook, the
	 * transcript list's `pending` slot in its footer host, one
	 * identifier family and five i18n keys in every shipped locale. Source
	 * admission only, NOT rendered U-08 evidence. Re-printed with --print for the
	 * round-1 remediation: failed rows kept in place with put-back, the composer
	 * hook test, `items-end` on the row's box, the footer host's single shape,
	 * four more i18n keys per locale and the vi/zh-CN caption fixes. */
	/* Re-printed 2026-11-07 with --print at the merge of origin/main (b5a2f4a1,
	 * PR #190 smooth steering) into feat/pending-echo (PR #191): both lines of
	 * history above stand, the value is the merged tree's own, and neither
	 * side's previous digest is kept. Source admission, not rendered evidence.
	 * Re-printed with --print for the round-2 follow-up: the send failure path
	 * hands back the envelope's body, the row uses ROLE.button, and two tests. */
	/* Re-pinned 2026-11-07 for fix/i18n-home-audit with --print from the staged
	 * tree. Only `src` moves, and only translation values: the independent
	 * post-merge audit's fixes to the es/ru/ur/vi/zh-CN/hi `mobile.home` and ru
	 * `mobile.chrome` catalogues, the regenerated catalogue projection, and the
	 * vi «Home» badge's entry in the identical-by-design test allowlist. No key,
	 * en string, component or token changed. Source admission only, NOT
	 * rendered U-08 evidence. */
	/* Re-pinned 2026-11-07 for PR #189's avatar test anchor with --print from the
	 * staged tree. Only `src` moves, for one test file
	 * (`agent-avatar.test.ts` searches for the title control from the back
	 * control). No shipped source changes. Source admission only, NOT rendered
	 * U-08 evidence. */
	/* Re-printed 2026-11-07 with --print at the final tree of the TestFlight 578
	 * merge train (chore/merge-train-578: #183 #186 #188 #185 #187 #189 #191 #192
	 * merged --no-ff onto origin/main 56303c83). Every PR's history note above
	 * stands; the value is the train tree's own and no PR's digest is kept. Only
	 * `app` and `src` move.
	 * Re-printed again after merging #189's test anchor fix (c8ad2bb2, one
	 * test file under `src`).
	 * Re-printed again after merging #189's U-01 audit fix (c73da8fd: the
	 * Stop's real touch-floor box). Source admission only, NOT rendered U-08
	 * evidence.
	 * Re-printed 2026-11-07 for fix/session-effort-null: `src/contracts` reads a
	 * null `effort` and the degraded unread block, the list frame drops a bad row
	 * instead of failing whole, and `session-chips.ts` widens its row type.
	 * Source admission only, NOT rendered U-08 evidence.
	 * Re-printed again for the PR's round-1 remediation, after the LAST `src`
	 * edit: db90c782's wire-repro citation fix and the session-chips comment
	 * re-wrap (R1/R4). Source admission only, NOT rendered U-08 evidence. */
	/* Re-printed 2026-11-08 with --print at the merge of origin/main (437cac5a,
	 * PR #105 Team Bridge direct hub messaging) into feat/team-bridge-avatars
	 * (PR #119): both sides' history above stands and the value is this merged
	 * tree's own — neither parent digest is kept. The endpoint-owned avatar
	 * profile and photo cache, the localized profile card and the mobile port's
	 * auth provider all land under `src` beside #105's hub messaging; the app,
	 * design, public and instrument roots did not move. Source admission only,
	 * NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-08 for the checkpoint rail's component suite:
	 * `src/features/session/components/checkpoint-rail.test.tsx` is new, so the
	 * `src` root moves while every other root stands — the guard working on a
	 * source addition, not a rendering change. No component, token or catalogue
	 * was touched: the rail's drawing code is byte-identical and the file adds
	 * only assertions. Recomputed with `--print` AFTER that file landed. Source
	 * admission only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-09 for the project-creation i18n rebase onto main: the
	 * create sheet, the project catalogue projections and the chip primitive all
	 * land under `src`, so the root moves while every other root in this table
	 * stands. Recomputed with `--print` on the REBASED tree — neither branch's
	 * earlier digest describes this corpus. Source admission only, NOT rendered
	 * U-08 evidence: no instrument, fixture or render-file pin moved and no frame
	 * was re-captured. The chip is a rendering input that does change — it gains
	 * an opt-in `labelTypography` prop that swaps the label's type class
	 * (`text-mono-sm` -> `text-body-sm`), which `project-create.tsx` asks for under
	 * `ur` for script shaping. This proof does not measure that surface, so the
	 * re-pin admits the source; it is not evidence about the prose chip. */
	/* Recomputed with --print after PR #201 Q1's literal-inline fast path and
	 * allocation regressions. The original capture fixture's AST and unchanged
	 * component markup remain byte-identical against 64c0d71d. Source admission
	 * only: no new U-08 pixels, instrument, input or render-file changes. */

	/* Re-printed 2026-11-09 for PR #199's U1 remediation: composer retry
	 * preparation copy and feedback projection retain the original command's
	 * uncertainty, with active/ended hook regressions and all eight catalogues.
	 * Only the src root moves; no instrument, fixture or other pin changes.
	 * Source admission only, NOT rendered U-08 or native storage evidence. */
	/* Recomputed with --print at PR #201's merge of origin/main 953a00a7:
	 * both approved source streams above survive unchanged. Their combined src
	 * tree has neither parent's digest. This admits source identity only; it
	 * does not refresh historical U-08 pixels, instrument or input evidence. */
	/* Convergence with PR #199 preserves both reviewed product sources. Recomputed
	 * from the combined LIVE tree after the catalogue-count conflict was resolved.
	 * Admission only: this does not refresh historical render or native evidence. */
	/* Integration of reviewed PRs #201 and #202 retains both convergence notes
	 * above. Recompute LIVE src/app only after both histories are merged: source
	 * admission does not refresh historical pixels or native interaction proof. */
	/* The bounded trace-display privacy fix imports only reviewed disclosure /
	 * typed-metadata filtering sources from #200, plus one merged locale key.
	 * Recomputed LAST after generation; no activity/layout/native-harness claim,
	 * and no historical instrument, input or original evidence is refreshed. */
	/* Q-tablet: recomputed LAST after the focused Home drawer-ownership fix and
	 * its regressions. Only LIVE src identity changes; no historical pin, input,
	 * instrument or activity/native-layout evidence is refreshed by admission. */
	// #106 + landed main d9073ebc union and synthetic source adapter: all pin
	// declarations derived with --print LAST. Source admission only, not refreshed
	// historical pixels, native picker/EXIF or remote-push evidence.
	// PR #106 batched remediation: account-owned upload/retirement and wrapping
	// attachment toolbar change the rendered app. Derived with --print after
	// staging the new regression files (src identity includes tests); proof
	// instruments, thresholds, corpus and historical ORIGINAL_* remain unchanged.
	// PR #106 post-disposal remediation: permanent provider/store/draft admission
	// and stale acquisition release, with focused regressions. Derived by --print
	// from the staged source; this is admission identity, not rendered/native proof.
	/* PR #205: --print admits the reviewed activity fallback and intrinsic-clock
	 * source, including its regressions. This updates source identity only;
	 * it is not proof of native visibility or compact D3 geometry. Historical,
	 * instrument and input pins remain unchanged. */
	// #108 + main bdc043ff union: source admission only, not refreshed pixels.
	/* PR #206 Q1/CI-T1: --print includes tracked test bytes under src, so the
	 * type-only createRoot return-type repair changes this combined live digest.
	 * Production app/src runtime bytes are unchanged; admission only, not new
	 * rendered, native or historical evidence. */
	/* CI-A1: centralize the two existing composer selectors without changing their
	 * values. Recomputed with --print from staged source; identity, not visual proof. */
	/* QA round-2 Q2: the web file picker's input is attached to the document
	 * (hidden) for the pick and removed on every settle path, plus its lifecycle
	 * tests. Recomputed with --print from the staged tree; only `src` moved.
	 * Identity admission only, not rendered or native evidence. */
	/* QA round-3 Q3: `composerLimit` decides overflow from the composer's
	 * intrinsic `capped` fact (fixed point, not the capped box), plus its
	 * regression tests. Recomputed with --print from the staged tree; `app` and
	 * `src` moved. Identity admission only, not rendered or native evidence. */
	/* Recomputed with --print after merging approved #108 (d9073ebc): the
	 * combined src tree has neither parent's digest. Source admission only;
	 * historical pixels, native visibility and compact D3 remain unproved. */
	// #106 + main 8705a953: combined staged source identity only, not new pixels.
	/* PR #206 merge-gate convergence with main 3e759dac: src re-derived with
	 * --print over the staged merged tree; identity admission only. */
	/* Re-pinned 2026-11-09 for feat/polish-transcript-rows with --print from the
	 * staged tree: the transcript's rows lose their borders, rules and state
	 * fills (user bubble, peer/hub/parent block, tool row, image-generation
	 * card), tool names take the sans `trace` step, images render at the
	 * relay's 160 pt from a cached file/Blob source through `expo-image`
	 * (`session/image-cache.ts`), and the skeleton pulses opacity on the native
	 * driver (`ui/shared-loop.ts`). `src` and `design/tokens` moved; `app`,
	 * fonts, `public`, fixtures and the instrument files did not. This DOES
	 * change what the U-08 scenes paint, so the digest is source admission
	 * only, NOT rendered U-08 evidence: the frames are CI's audit run's. */
	// Native history paging: staged LIVE source admission only; historical
	// rendered frames, native anchor and interaction proof are not refreshed.
	// PR #207 remediation (gap detection, retry targeting, refresh copy) re-pinned
	// with --print over the staged tree; same scope as above.
	// Q3: biome reformatted the two synthetic history wire fixtures (whitespace
	// only, JSON deep-equal before/after); re-pinned with --print, same scope.
	// PR #207 round 3 (Q5-Q7, U1/U2, D1-D6): web prepend anchor, gap marker and
	// newest-edge notice, copy; re-pinned with --print over the staged tree, same
	// scope (no rendered frame or native proof refreshed).
	// PR #207 merge-gate convergence with main 3e759dac (#106): the merged src
	// tree has neither parent's digest; re-pinned with --print over the staged
	// merged tree. Source admission only, no rendered or native proof refreshed.
	// PR #207 merge-gate convergence with main 235db698 (#206): the merged
	// src tree has neither parent's digest; re-pinned with --print over the
	// staged merged tree. Source admission only, no rendered or native proof
	// refreshed.
	// PR #207 CI remediation (visual gate): the history reader keeps a cold
	// page's rows, substitutes live bodies by occurrence, and displays every
	// row of an accepted frame (only a cap-sized frame's opener detaches); re-pinned with --print over the staged
	// tree. Source admission only, no rendered or native proof refreshed.
	// PR #207 round 5: cold disjoint pages precede live rows, explicit pinned
	// context survives flagless frames, and HTTP reader-world tests live beside
	// the app reader. Re-derived with --print, staged; source admission only.
	// PR #207 merge-gate convergence with main 828c9b50 (#209): the merged src
	// tree carries both #209's borderless rows / cached images and this PR's
	// history reader, so it has neither parent's digest; re-pinned with --print
	// over the staged merged tree. Source admission only, no rendered or native
	// proof refreshed.
	// Polish PR B (single activity line, chips inside the composer card, one
	// borderless failure notice, no shell ring at rest) merged with main 519db4e6
	// (#207): the merged src tree has neither parent's digest; re-pinned with
	// --print over the staged merged tree. This DOES change what the session
	// scenes paint; the digest is source admission only, NOT rendered U-08
	// evidence — the frames are CI's audit run's.
	// Re-pinned with --print over the staged tree for PR B's round-1
	// remediation: the queued count stays on the card where the host has no
	// activity line, the counts keep one edge and drop the held line, and the
	// dead strip exports are removed. Source admission only.
	/* PR #210 merge-gate convergence with main 519db4e6 (#207): the merged src
	 * tree carries both #207's history pager and this PR's header/drawer polish,
	 * so it has neither parent's digest; every pin re-derived with --print over
	 * the staged merged tree. Source admission only, no rendered or native proof
	 * refreshed. */
	// PR #211 merged with main aef9b7b2 (#210): the merged src tree carries both
	// #210's header/drawer/sheet-exit polish and this PR's composer work, so it
	// has neither parent's digest; re-pinned with --print over the staged merged
	// tree. Source admission only, no rendered or native proof refreshed.
	// #208 merge with main aef9b7b2: thread title, viewport and icon-only
	// Notifications on top of the above; source identity only, not new pixels.
	/* Re-pinned 2026-11-09 for fix/user-message-bubble with --print from the
	 * staged tree: the user row's fill is `bg-user-bubble` (was `bg-surface`),
	 * and `theme.css` / `tokens.gen.ts` carry the new role for every theme. The
	 * user bubble's FILL colour therefore differs in a frame; its box, type and
	 * every other row are unchanged. Source admission only, NOT rendered or
	 * native proof.
	 *
	 * Re-pinned again the same day with --print from the staged round-1
	 * remediation tree: the bubble box moves to `features/session/user-bubble.ts`
	 * and also carries an explicit native `backgroundColor` from the active
	 * palette (design D1); the pending echo takes the same box with its caption
	 * below it (M1, D2); an image on the bubble is framed `hairline-strong`
	 * (m1). Source admission only, NOT rendered or native proof. */
	// PR #211 merged with main 6d36c22a (#208): the merged src tree carries
	// #208's Team Bridge thread titles/tail landing and this PR's composer work
	// (round-4 remediation c7f7b474 included), so it has neither parent's
	// digest; re-pinned with --print over the staged merged tree. Source
	// admission only, no rendered or native proof refreshed.
	// PR #211 build-753 feedback: the activity line's measured slot wrappers
	// are absolute (native slot never opened), the ask bar is a borderless row
	// that paints nothing for timed-out-only asks, and More gains a Questions
	// row (one i18n key). Re-pinned with --print over the staged tree; source
	// admission only, no rendered or native proof.
	// Bridge drawer switch: the Team Bridge adapter for the workspace drawer's
	// labelled mode switch; round-1 remediation (wrapping mode row, failed
	// unread read, pane help line) re-derived with --print. Source identity
	// only, no rendered or native proof.
	// PR #211 merged with main a563a6f3 (#212): the merged tree carries #212's
	// Team Bridge drawer switch and this PR's composer work, so it has neither
	// parent's digest; re-pinned with --print over the staged merged tree.
	// Source admission only, no rendered or native proof refreshed.
	// feat/bridge-thread-chrome (#213): the bridge thread header reuses the
	// session title style (`sessionHeaderTitle`) and the composer the agent
	// composer's field/disc tokens.
	// PR #211 merged with main 0ae5fe28 (#213): the merged tree carries both,
	// so src re-derived with --print over the staged merged tree. Source
	// identity only, no rendered or native proof.
	// TestFlight 753 keyboard fix (shared keyboard frame, keyboard-aware held
	// box, end-of-lift re-measure, paste offer while composing) and its tests;
	// re-pinned with --print over the staged tree. Admission only.
	// PR #216 round 1 remediation (keyboard-frame seed, the composer's lift
	// seed and mid-lift publish guard, the capped box's bound through the lift)
	// and its tests; re-pinned with --print over the staged tree. Admission only.
	// PR #216 merged with main 8fec5440 (#211 squash, #213): the merged tree
	// carries #213's thread chrome and this PR's keyboard work, so src
	// re-derived with --print over the staged merged tree. Admission only.
	// Resume gap heal: HistoryWindow fills a reconnect/foreground hole by
	// walking before= pages, a debounced resume gate, and the quiet gap row
	// copy in all locales. --print over the staged tree; source identity only,
	// no rendered or native proof.
	// Round-1 remediation (#217 Q1/R1-1..R1-4): every hole tracked, newest
	// reads merged against the block above the newest hole, web anchor held
	// on Load, gap copy reworded. --print over the staged tree; source
	// identity only, no rendered or native proof.
	// Merged with main 2faead90 (#211 asks/notice/activity copy): src carries
	// both sides, re-derived with --print over the staged merged tree. Source
	// identity only, no rendered or native proof.
	// PR #214 merged with main 8fec5440 (#211, #212, #213): the merged src tree
	// carries the user bubble fill and #211's activity line/composer work, so it
	// has neither parent's digest; re-pinned with --print over the staged merged
	// tree. Source admission only, no rendered or native proof refreshed.
	// #217 merged with main d46e8535 (#214 user bubble squash): src carries
	// both sides, re-derived with --print over the staged merged tree. Source
	// identity only, no rendered or native proof.
	// PR #216 merged with main 5fb51be0 (#214 user bubble, #217 transcript
	// self-heal): the merged tree carries healHistory and the keyboard-aware
	// cap, so it has neither parent's digest; re-derived with --print over the
	// staged merged tree. Source admission only, no rendered or native proof.
	// Bridge composer + drawer nav (TestFlight 773): the Bridge composer rests as
	// the agent's one-row pill, Bridge threads lead with the drawer button, and
	// Bridge opens replace; one Team Bridge key retired in all locales. --print
	// over the staged tree; source identity only, no rendered or native proof.
	// Round-1 remediation (#219): the composer's edge becomes a focus ring and
	// the drawer's "Open Team Bridge" replaces on Bridge routes. --print over the
	// staged tree; source identity only, no rendered or native proof.
	// PR #216 merged with main 580fcde9 (#219 bridge composer + drawer nav):
	// disjoint src files, so the merged tree has neither parent's digest;
	// re-derived with --print over the staged merged tree. Source identity
	// only, no rendered or native proof.
	// fix/refused-connect-feedback: own-tunnel stays on the form with the reason
	// when Save and connect is refused, the keystore refusal's sanitised cause,
	// seven catalogue keys and tests; only `src` moves, re-derived with --print
	// over the staged tree. Source identity only, no rendered or native proof.
	// PR #220 round-1 remediation (R1-m1/m2, D1-D3, U1/U2/U4, Q1): own-tunnel
	// clears stale state on edit, keeps the refusal up during Retry, new copy
	// and keys; only `src` moves, re-derived with --print over the staged tree.
	// Source identity only, no rendered or native proof.
	// PR #220 merged with main becb972b (#216, #219, #221): both sides'
	// src carried, so neither parent's digest; re-derived with --print over the
	// staged merged tree. Source identity only, no rendered or native proof.
	// Re-pinned 2026-11-10 for PR #224 (markdown table columns + code faces)
	// with its round-1 remediation (M1, m1/D2 seeded table width, m2/D1 chip
	// wash, D4 native ligatures, n1; the width estimate lives in `ui/column.ts`
	// so the node-loaded `markdown.ts` stays import-free), merged with main
	// 56831114: only `src` moves, re-derived with --print over the merged
	// tree. Source admission only, NOT a rendered geometry proof.
	// fix/bridge-composer-keyboard-glass (TestFlight 800): the Bridge composer
	// docks above the keyboard from #216's store (new composer-dock.tsx, no
	// KeyboardAvoidingView) and its shell draws the agent's ChromeSurface glass
	// layer. --print over the staged tree; source identity only, no rendered or
	// native proof. Round-1 remediation: the dock test mounts with JSX (Biome
	// noChildrenProp) and pins the thread's glass={chromeGlass} prop; a test
	// file only, but `src` covers tests, so it moves. --print over the staged
	// tree; source identity only, no rendered or native proof.
	// PR #225 merged with main 56831114 (#220 refused-connect feedback): both
	// sides' src carried, so neither parent's digest; re-derived with --print
	// over the staged merged tree. Source identity only, no rendered or native
	// proof.
	// PR #224 merged with main 240362a6 (#225 composer keyboard glass): both
	// sides' src carried, so neither parent's digest; re-derived with --print
	// over the staged merged tree. Source identity only, no rendered or native
	// proof.
	// feat/bridge-nav-polish: minimal sunken WorkspaceModeBar + unified top close
	// row, shared WorkspaceSidebarFooter across drawer modes, and Team Bridge
	// directory/thread/delivery/sheet polish. Re-derived with --print over the
	// staged src tree; source identity only, no rendered or native proof.
	// #222 round-1 remediation: one-row mode bar below large text, docked
	// Bridge footer, raised directory skeletons/row fills, full-width profile
	// rows, author touch box. --print over the staged tree; source identity
	// only, no rendered or native proof.
	// #222 round-2 remediation: out-of-flow Team Bridge count below large
	// text, content-proportioned segments and whole-word labels above it,
	// docked directory on its canvas ground. --print over the staged tree;
	// source identity only, no rendered or native proof.
	// Converged #222 onto main becb972b (#216): src re-derived with --print over
	// the merged tree. Source identity only, no rendered or native proof.
	// Converged #222 onto main 56831114 (#220) and moved WorkspaceModeBar onto
	// space.scale (U-42); src re-derived with --print over the merged tree.
	// Source identity only, no rendered or native proof.
	// Converged #222 onto main 240362a6 (#225 Bridge composer keyboard dock +
	// glass shell): both sides' src carried, so neither parent's digest;
	// re-derived with --print over the staged merged tree. Source identity
	// only, no rendered or native proof.
	// PR #224 merged with main 98e53308 (#222 bridge nav polish): both sides'
	// src carried, so neither parent's digest; re-derived with --print over the
	// staged merged tree. Source identity only, no rendered or native proof.
	// PR #224 CI audit fix (run 42948464285): inline-code chip loses its
	// off-scale 2pt web padding (U-42/U-39) and the table cue reads the laid-out
	// row against its viewport (U-40). --print over the staged tree; source
	// identity only, no rendered or native proof.
	// Transcript condensing polish: Tier A `FoldBar`, idle completed-turn
	// condensing, the shared 16/40 pt trace rail, spacing tiers, hub and Team
	// Bridge receipt rows, `relay.transcript.*` catalogues. --print over the
	// staged tree; source identity only, no rendered or native proof.
	// PR #223 round-1 remediation: `user_run` default under list overrides,
	// session-certified peer cycles, no fold inside an open quiet group, the
	// continuation latch, bar/fold glyph and copy face, the large-text receipt
	// stack. --print over the staged tree; source identity only.
	// PR #223 round-2 remediation: label-less `CollapsedRow` keeps `flex-1` at
	// large text, composed `dir` on the bar summaries, the newest-turn fold
	// latch through a `!live` dip. --print over the staged tree; source
	// identity only.
	// PR #223 merged with main 56831114 (#220): both sides' src carried, so
	// neither parent's digest; re-derived with --print over the staged merged
	// tree. Source identity only.
	// PR #223 merged with main 240362a6 (#225): both sides' src carried, so
	// neither parent's digest; re-derived with --print over the staged merged
	// tree. Source identity only.
	// PR #223 CI fix (U-41/U-42): the trace-row glyph stands outside its
	// pressable in a baseline-aligned slot, the press wash lifts to the row,
	// the assistant/parent image strips go on-scale, `pt-0.5` is gone; tests
	// with it. --print over the staged tree; source identity only.
	// PR #223 merged with main 98e53308 (#222): both sides' src carried, so
	// neither parent's digest; re-derived with --print over the staged merged
	// tree. Source identity only.
	// 2026-11-10 fix/composer-ios-wrap (TestFlight 800): native Textarea no
	// longer pins `height` from onContentSizeChange (iOS Fabric emits it only on
	// a layout change); it bounds the self-measured box with min/max instead.
	// --print over the staged tree; source identity only, no rendered or native
	// proof.
	// PR #226 merged with main 98e53308 (#220, #225, #222): both sides' src
	// carried, so neither parent's digest; re-derived with --print over the
	// staged merged tree. Source identity only, no rendered or native proof.
	// PR #226 merged with main d78ca861 (#223): both sides' src carried, so
	// neither parent's digest; re-derived with --print over the staged merged
	// tree. Source identity only, no rendered or native proof.
	// PR #224 merged with main 9fe002f3 (#223, #226): both sides' src
	// carried, so neither parent's digest; re-derived with --print over the
	// staged merged tree. Source identity only, no rendered or native proof.
	// feat/bridge-last-target: the last-target memory, the message-anchored
	// thread open and its Jump to newest copy (8 locales). --print over the
	// committed tree; source identity only.
	// PR #228 merged with main 9fe002f3 (#226): both sides' src carried, so
	// neither parent's digest; re-derived with --print over the staged merged
	// tree. Source identity only.
	// PR #228 round-1 remediation: the anchor/viewport hand-off, highlight
	// edge and fade, walk bound, placement, drawer a11y split, restore race and
	// `thread.anchor_missing` (8 locales). --print over the remediation tree;
	// source identity only.
	// PR #228 round-2 QA remediation (Q2-1): an anchored landing's own scroll
	// no longer resumes following. --print over this tree; source identity only.
	// PR #228 merged with main eee80204 (#224): both sides' src carried, so
	// neither parent's digest; re-derived with --print over the merged tree.
	// Source identity only.
	// fix/running-tool-indicator: the running tool glyph and a closed fold over
	// an executing call draw `LiveGlyph` (relay `lo-pulse`, static accent tick
	// under Reduce Motion) instead of the text `Shimmer`; a fold with only a
	// composing/queued call stays dim. Tests with it. --print over the staged
	// tree; source identity only, no rendered or native proof. Re-printed
	// after the live-glyph test ids moved into `SURFACE` (src/ui/a11y.ts): the
	// same two strings, now declared once — no rendered change.
	// PR #229 merged with main 502945a6 (#228): both sides' src carried, so
	// neither parent's digest; re-derived with --print over the staged merged
	// tree. Source identity only, no rendered or native proof.
	/* Re-pinned 2026-11-11 for PR #227 (i18n app-scan English closure) rebased
	 * onto main d458ecdf: #224, #226, #228 and #229 src changes (and #223) are
	 * carried with #227's, so this is no parent's digest; re-derived with
	 * `--print` over the converged tree. Source admission only, NOT rendered
	 * U-08 evidence. */
	// Composer growth / paste / Bridge gap (TestFlight 836): heldComposerLimit's
	// transcript slack, the 8-line composer cap, the icon-only paste control
	// and the Bridge follower re-pin. Re-derived with --print; source
	// identity only, no rendered or native proof.
	// PR #230 round-1 remediation: the Bridge list's bottom padding (D1,
	// pb-4 -> pb-2) and three unit tests. Re-derived with --print; source
	// identity only, no rendered or native proof.
	// PR #230 round-2 remediation (M2, m4): the through-the-lift branch
	// ignores the slack, the composer reports `onLift`, and the lift tests.
	// Re-derived with --print; source identity only, no rendered or native
	// proof.
	// fix/silent-resume-reconnect: the session stream's resume hold
	// (`resume-hold.ts`) and the Team Bridge thread's silent `unreachable`
	// retries, with tests. Timers and state only — no rendered change. --print
	// over the staged tree; source identity only.
	// Re-pinned 2026-11-11 for fix/native-text-selection with --print: the
	// transcript's drag-to-select wrapper (`selectable-message.tsx`) — on web
	// it renders its children unchanged and the leaf Text keeps `selectable`,
	// so no measured web pixel moves. Source identity only. Re-printed for the
	// PR #233 round-1 remediation (uncontrolled iOS selection, wrapper out of
	// VoiceOver, memoised output joins): web renders the same children and
	// leaves, so again source identity only. Re-printed for the PR #233 design
	// R1 remediation (Android highlight derived per theme, diff selection ink,
	// scroll keeps the iOS mode): the web leaf's `selectionColor` is ignored by
	// RNW `Text`, and the rest is iOS-mode or touch wiring, so again source
	// identity only.
	// fix/fold-group-spacing: blank live assistant rows paint nothing and skip
	// the rhythm; rows inside an opened turn bar or fold are indented one
	// 24 pt step per level beside a hairline guide (`group-containment.ts`,
	// `group-guides.tsx`). Tests with it. --print over the staged tree; source
	// identity only, no rendered or native proof. Re-printed for PR #234 R1:
	// blank rows pass through fold runs (live/reload parity), a table's seed
	// loses the group inset, and the blank-row test renders. Same caveat.
	// fix/user-message-show-more: a long user message clamps to eight lines
	// under a bubble-fill fade with Show more / Show less (8 locales), on
	// condensed turns too, replacing the condensed prompt's one-line clamp.
	// --print over the staged tree; source identity only, no rendered proof.
	// PR #235 round-1 remediation (R1-M1): the pending echo's prompt text
	// rides the same clamp; re-printed with --print over the staged tree.
	/* Re-pinned 2026-11-11 for integrate/mobile-batch-1111 (#230, #232, #233,
	 * #234 and #235 merged onto main fa2bc5e0): all five PRs' src changes are
	 * carried with #227's, plus the regenerated `catalogue.gen.ts` (653 keys)
	 * and the user-row integration of #233's selectable text inside #235's
	 * clamp, and the blank-row test's clamp stub, so this is no parent's digest;
	 * re-derived with `--print` over the staged integrated tree. Source
	 * admission only, NOT rendered U-08 evidence. Re-printed again after the
	 * user-message toggle's testID moved behind `userMessageMoreId` in
	 * `src/ui/a11y.ts` (the integrated tree's literal-testID fix). */
	// fix/steer-bubble: a steer takes the user bubble and its clamp, in flight
	// and settled (operator report, iOS 2026-11-11), plus its rendered test.
	// Re-derived with --print over the staged tree; source identity only.
	// fix/ended-session-placeholder: an ended session's composer shows the
	// standard placeholder; `mobile.session_health.ended_placeholder` retired
	// from all 8 locales. --print over the staged tree; source identity only,
	// no rendered or native proof.
	/* #231 (Team Bridge push readiness: icon-badge owner, badge source,
	 * received-push listener, localized Settings permission sentences) merged
	 * with main fa2bc5e0 (#227): both sides' src carried, so no parent's digest;
	 * re-derived with --print over the merged tree. Source identity only, NOT a
	 * rendered geometry proof. */
	/* integrate/mobile-batch-1111 + #240, #239, #238 and main ecfa6987 (#231):
	 * every side's src carried plus the regenerated `catalogue.gen.ts` (657
	 * keys), so no parent's digest; re-derived once with --print over the
	 * converged tree. Source identity only, NOT rendered U-08 evidence. */
	/* fix/show-more-polish (D1, D2, R1-m1 deferred from #235/#237): the
	 * clamp's lighter collapsed control, keep-in-view on Show less, and
	 * expand-before-select; the collapse context moved to the RN-free module.
	 * Re-derived with --print over the staged tree;
	 * source identity only, NOT rendered U-08 evidence. */
	/* Re-pinned 2026-11-12 for PR #236 (M2 expression literals) rebased onto main
	 * 2b508d9d: the 33 expression-literal keys (657 -> 690 in the regenerated
	 * `catalogue.gen.ts`), the scanner and its tests, the es/vi short-context and
	 * `stream_degraded` remediation and `useComposedDir()` spreads are carried with
	 * main's #237 integration, so neither parent's digest. Re-derived once with
	 * `--print` over the committed rebased tree. Source admission only, NOT
	 * rendered U-08 evidence. */
	/* #241 (fix/show-more-polish) merged with main 9e193b57 (#236): both
	 * sides' src carried, so neither parent's digest; re-derived once with
	 * --print over the merged tree. Source identity only, NOT rendered U-08
	 * evidence.
	 *
	 * Re-pinned for PR #243 (M3 S1 sign-in/computers keys, 44 translations, Urdu
	 * direction fix) merged with main e24de6cd (#241 show-more polish): both sides' src
	 * carried, so neither parent's digest; re-derived last with --print. Source
	 * identity only, NOT rendered U-08 evidence. */
	/* fix/ola-feedback-1112 (#1): the Team Bridge provider no longer keys the
	 * router on the account, and the own-tunnel guide's and sign-in's Back leave
	 * for Home with no history (`leave-screen.ts`). Re-derived once with --print
	 * over the staged tree. Source identity only, NOT rendered U-08 evidence. */
	/* fix/ola-feedback-1112 (#2/#3): the Computers row and Team Bridge entry as
	 * nav cards, computerDisplayName, the drawer row's one-line state + meta,
	 * hanging indicator, row-owned gutter and single-ellipsis selector. Re-derived
	 * once with --print over the staged tree. Source identity only, NOT rendered
	 * U-08 evidence. */
	/* fix/ola-feedback-1112: an interactive Radient sign-in opens the reader's
	 * computer by the cold start's rule. Re-derived once with --print over the
	 * staged tree. Source identity only, NOT rendered U-08 evidence. */
	/* #245 (fix/ola-feedback-1112) merged with main d33c46af (#243): both
	 * sides' src carried, so neither parent's digest; re-derived once with
	 * --print over the merged tree. Source identity only, NOT rendered U-08
	 * evidence. */
	/* #245 CI remediation: the Team Bridge destination's title/caption gap
	 * uses the minimum 4 pt token instead of 2 pt (U-42). Re-derived with
	 * --print after the final source edit; instrument and input pins unchanged.
	 * Source identity only, NOT rendered U-08 evidence. */
	/* --print re-pin for feat/background-push-clear: the background notification
	 * task (module-scope `defineTask` imported first in app/_layout.tsx, the
	 * signed-in scope registration in the Team Bridge provider) and the `body`
	 * payload envelope read. No rendered component, style or token changed;
	 * re-derived over the staged tree. Source identity only, NOT rendered U-08
	 * evidence. */
	/* --print re-pin for PR #244 review remediation round 1: lazy
	 * expo-task-manager load, the background-launch restore retry in the
	 * connection provider, and the store's `unreadReads` counter. No rendered
	 * component, style or token changed. Source identity only, NOT rendered
	 * U-08 evidence. */
	/* PR #244 merged with main d33c46af (#243): both sides' src carried, so
	 * neither parent's digest; re-derived once with --print over the merged
	 * tree. Source identity only, NOT rendered U-08 evidence. */
	/* PR #245 convergence with #244 (14557e09): retain account-local state
	 * isolation without remounting the router, background scope registration,
	 * foreground restore retry and interactive sign-in auto-open. Re-derived
	 * once with --print; source identity only, NOT new rendered evidence. */
	/* M3 S2a (feat/i18n-m3-s2a): the Computers titles/banners, own-tunnel and
	 * loopback-detail keys with their seven audited translations (771 keys in the
	 * regenerated `catalogue.gen.ts`), the ur composed-direction spreads and
	 * `Input.placeholderDir`, and the ur scheme-isolate bidi test. Re-derived
	 * last with --print over the committed tree; only `src` moved. Source
	 * identity only, NOT rendered U-08 evidence.
	 * PR #251 round 1 remediation: `Screen.rowTitleLines` and
	 * `rowTitleLinesFor` (translated Computers/own-tunnel titles wrap instead of
	 * clipping), the single `ComputersTitleKey`, and the bidi test's header
	 * sentence. Re-derived with --print; again only `src` moved.
	 * PR #251 CI fix: biome formatting of the switcher transport `Text` and the
	 * refusal-surface import order (no logic change). Re-derived with --print;
	 * only `src` moved. */
	/* fix/computers-drawer-polish-d11-d13: the Computers facts line without a
	 * separator, the drawer row's word beside its name, and the inline cwd that
	 * yields to the marks. Re-derived once with --print over the staged tree;
	 * re-derived again for the round-1 remediation (no drawer spacer, the
	 * inline cwd's 0.01 shrink). Source identity only, NOT rendered U-08
	 * evidence. */
	/* Merge of origin/main (#251, fb224cfe) into #252: both comments kept,
	 * re-derived once with --print over the merged tree. */
	/* M3 S2b-1 (feat/i18n-m3-s2b1): the own-tunnel command, verdict and
	 * Settings-section keys (English-first, then the seven audited translations;
	 * 812 keys in the regenerated `catalogue.gen.ts`), `Alert.bodyDir` with the
	 * ur `{detail}`-initial offline-verdict spreads and their tests. Re-derived last with --print over the committed tree (b98f5395);
	 * only `src` moved. Source identity only, NOT rendered U-08 evidence. */
	/* Convergence of #254 onto main b254ae63 (#252): both comments kept;
	 * re-derived once with --print over the merged tree. */
	/* M3 S2b-2a (feat/i18n-m3-s2b2): the refusal surface's keys (English-first;
	 * `catalogue.gen.ts` is regenerated with the translations), the remedy line
	 * via `own_tunnel.remedy`, `verdictSentence`'s caller-supplied action label
	 * and their tests. Re-derived last with --print over the committed tree
	 * (b3af2b96); only `src` moved. Source identity only, NOT rendered U-08
	 * evidence. */
	/* M3 S2b-2a translations: the six LTR locales' and ur's 24 refusal values,
	 * the regenerated `catalogue.gen.ts`, the ur UR-C1 `labelDir` on the
	 * refusal surface's console button and its tests. Re-derived last with
	 * --print over the committed tree (6efad9e8); only `src` moved. Source
	 * identity only, NOT rendered U-08 evidence. */
	/* #257 round-1 remediation: the native `writingDirection` channel of
	 * `composedDirection` (D1), the refusal headline/next spreads (D2), the
	 * shared DIAGNOSTIC_FALLBACK module (N2) and their tests. Re-derived last
	 * with --print over the committed tree (3121fd36); only `src` moved. Source
	 * identity only, NOT rendered U-08 evidence. */
	/* #257 CI fix: the verdict-Alert site scan in ur-latin-initial-sites.test.ts
	 * anchors on the call opening. Re-derived last with --print over the
	 * committed tree (c1e52685); only `src` moved. Source identity only, NOT
	 * rendered U-08 evidence. */
	/* feat/sidebar-recency-order (TestFlight 906): the drawer's desktop-parity
	 * arrangement, its View options sheet and Settings → Sidebar. Re-derived once
	 * with --print over the committed tree. Source identity only, NOT rendered
	 * U-08 evidence. */
	/* PR #255 review round 1 (pinned divider, hidden-sections line, emptied-by-
	 * view state, customised trigger fill): re-derived once with --print over the
	 * staged tree. Source identity only, NOT rendered U-08 evidence. */
	/* Merge of origin/main (#254, d5831603) into #255: both comments kept,
	 * re-derived once with --print over the merged tree. */
	/* Convergence of #257 onto main f8d0d8dd (#255): both comment chains kept;
	 * re-derived once with --print over the merged tree. */
	/* fix/session-push-register: the app now POSTs /api/push/register for the
	 * routed computer (session-push-registration*, use-session-push-registration),
	 * Settings › Notifications gains one registration sentence (+6
	 * mobile.notifications keys in every locale, 818 in `catalogue.gen.ts`) and
	 * a REGION id. Re-derived with --print over the staged tree; only `src`
	 * moved. Source identity only, NOT rendered U-08 evidence. */
	/* PR #259 review round 1 remediation: the registration hook keyed on
	 * routeKey/live/revision with the relay accessor read through a ref, a
	 * per-computer attempt queue, sign-out reset, the install-id.ts docstring.
	 * No rendered surface changed. Re-derived with --print over the staged
	 * tree; only `src` moved. Source identity only. */
	/* Merge of origin/main (#255, f8d0d8dd) into #259: both comments kept,
	 * re-derived once with --print over the merged tree. */
	/* Convergence of #257 onto main 9ef19ccd (#259): both comment chains kept;
	 * re-derived once with --print over the merged tree. */
	/* fix/settings-signin-status-badge: the signed-out account card as a
	 * Radient sign-in nav card, the connection pill's one-line fit in the
	 * Settings Status row and the drawer header (`status-pill-layout.ts`), and
	 * the Diagnostics `reason:` row with its provider plumbing and the one new
	 * mobile.settings key (813 keys). Re-derived with --print over the staged
	 * tree; only `src` moved. Source identity only, NOT rendered U-08 evidence:
	 * the Settings and drawer cells must be re-captured against this tree. */
	/* PR #258 agent review round-1 remediation: the account card moves to
	 * `account-card.tsx`, gated on `radientSignedIn` with a confirm before it
	 * ends a working direct route; Diagnostics' reason row ignores a past
	 * `lastError` beside a live stream; the dot leaves the identifier rule; four
	 * mobile.settings keys (817). Re-derived with --print over the staged tree;
	 * only `src` moved. Source identity only, NOT rendered U-08 evidence. */
	/* Merge of origin/main (#255, f8d0d8dd) into #258: both comments kept,
	 * re-derived once with --print over the merged tree. */
	/* Merge of origin/main (#259, 9ef19ccd) into #258: both comments kept,
	 * re-derived once with --print over the merged tree. */
	/* Convergence of #257 onto main 8ca71d54 (#258): both comment chains kept;
	 * re-derived once with --print over the merged tree. */
	src: "451351f4038a1c0947a6d7f62538350756a2125dd8b90ca589d5047fe41a7cf7",
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
	"app.config.ts":
		"c4b2be52f8a2802eda590a10971a2a624128b86e363f49bfd14ffe611a607d49",
	"metro.config.js":
		"8969b35b1269818e746e2a8e854f94995f0adbc54b18e8e80c95e90aca1aa707",
	// --print re-pin (feat/background-push-clear): adds the native module
	// `expo-task-manager` ~57.0.22, which the web bundle never renders.
	"package.json":
		"c9011119d489c35125f16e87abbd0db196a3dabbca646dfc5c5d6aa3e47ebb0a",
	"pnpm-lock.yaml":
		"c9ef7b9d08ab6f4389036570907591411b6104a9bfb2e6ae75bb101399348540",
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
