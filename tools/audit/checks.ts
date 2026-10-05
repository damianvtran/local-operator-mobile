/**
 * The mechanical half of the audit rubric, as executable checks.
 *
 * Each check takes one extracted state (geometry + colours + the accessibility
 * tree) and returns rows of `{check, verdict, measured, detail}`. The check ids
 * are the rubric's own (`U-01`…`U-10` in `docs/ux/audit-rubric.md` §3), so a
 * report row and a rubric row are the same thing.
 *
 * Three rules this file follows, because they are what make the numbers usable
 * in a review round:
 *
 * 1. **A pass states its measurement.** "PASS" with no number is not a result.
 * 2. **An exception is recorded, never assumed.** The rubric allows a control
 *    below the touch floor in a dense list with ≥ 8 pt of spacing — so that is
 *    measured and reported as `EXCEPTION`, not silently folded into PASS.
 * 3. **A check that cannot be evaluated says so** (`BLOCKED`) instead of
 *    passing. A frame with no interactive nodes at all is not evidence that
 *    every interactive node has a name.
 */

import { LEVEL_BARS } from "../../src/stt/levels.ts";
import type { Floors } from "./color.ts";
import { composite, contrastRatio, parseCssColor } from "./color.ts";
import { INTERACTIVE_AX_ROLES } from "./probe.ts";

const round = (n: number, dp = 2): number | null =>
	Number.isFinite(n) ? Number(n.toFixed(dp)) : null;

/**
 * A colour reduced to a comparable key. The probe reports computed colours as
 * `rgb(r, g, b)` while the tokens are `#rrggbb`, so comparing the raw strings
 * would miss every match — the semantic set must be normalised the same way the
 * measured values are.
 */
const colourKey = (value: unknown): string | null => {
	const parsed = typeof value === "string" ? parseCssColor(value) : null;
	return parsed
		? parsed
				.slice(0, 3)
				.map((c) => Math.round(c * 255))
				.join(",")
		: null;
};

/** The semantic palette as a set of comparable colour keys. */
export function semanticSet(
	/** Either the palette object or an already-built colour-key set. */
	semantic: Set<string> | Record<string, string | null> | null | undefined,
): Set<string> {
	const out = new Set<string>();
	for (const value of Object.values(semantic ?? {})) {
		const key = colourKey(value);
		if (key !== null) out.add(key);
	}
	return out;
}

/**
 * The dense-list window the rubric's U-01 exception describes, in CSS pixels:
 * a neighbour at least this far away (the ≥ 8 pt spacing it names) and no
 * further than this (which is what makes the neighbours a list rather than two
 * unrelated controls on a screen).
 */
const DENSE_LIST_MIN_GAP_PT = 8;
const DENSE_LIST_MAX_GAP_PT = 24;

/** Interactive-but-too-small is the exception the rubric names, so measure the gap. */
function nearestNeighbourGap(
	node: AuditNode,
	others: AuditNode[],
): number | null {
	let best = Infinity;
	for (const other of others) {
		if (other === node) continue;
		const gapX = Math.max(
			other.rect.x - (node.rect.x + node.rect.w),
			node.rect.x - (other.rect.x + other.rect.w),
		);
		const gapY = Math.max(
			other.rect.y - (node.rect.y + node.rect.h),
			node.rect.y - (other.rect.y + other.rect.h),
		);
		const gap = Math.max(gapX, gapY, 0);
		if (gap < best) best = gap;
	}
	return Number.isFinite(best) ? best : null;
}

/* ------------------------------------------------------------------ checks -- */

/** U-01 — every control a thumb aims at is at least 44 pt (48 dp on Android). */
function u01TouchTargets(state: AuditState, floors: Floors): CheckRow[] {
	const floor =
		state.platform === "android" ? floors.touch.ios + 4 : floors.touch.minimum;
	const slopFloor = Math.min(floors.touch.minimumVisualWithSlop ?? 24, 24);
	const controls = state.nodes.filter((n) => n.interactive && !n.disabled);
	if (controls.length === 0) {
		return [
			{
				check: "U-01",
				verdict: "BLOCKED",
				// The frame has no control to measure: the instrument could not answer a
				// question it was asked, so it reports a gap rather than a pass.
				blockedKind: "unmeasurable",
				measured: null,
				detail: "no interactive nodes in this frame",
			},
		];
	}
	const rows: CheckRow[] = [];
	for (const node of controls) {
		const size = Math.min(node.rect.w, node.rect.h);
		if (size >= floor) continue;
		const gap = nearestNeighbourGap(node, controls);
		// The rubric's exception is "24 pt is the hard floor **only for controls in
		// a dense list with ≥ 8 pt spacing**", so BOTH halves must be met: a
		// neighbour close enough to make the list dense, and at least the stated
		// separation from it. A lone control satisfies neither — it has no list to
		// be dense in and no spacing to measure — and granting it the exception is
		// how a real touch-target failure used to pass: measured on a page holding
		// one 30x30 button and nothing else, this returned EXCEPTION and the run
		// exited 0.
		const denseException =
			size >= slopFloor &&
			gap !== null &&
			gap >= DENSE_LIST_MIN_GAP_PT &&
			gap <= DENSE_LIST_MAX_GAP_PT;
		rows.push({
			check: "U-01",
			verdict: denseException ? "EXCEPTION" : "FAIL",
			measured: `${size}pt (floor ${floor}${state.platform === "android" ? "dp" : "pt"}), gap ${gap === null ? "n/a (no other controls)" : `${gap}pt`}`,
			detail: denseException
				? `${node.tag} ${node.rect.w}x${node.rect.h} at ${node.rect.x},${node.rect.y} — below the floor with ${gap === null ? "no neighbouring control" : `${gap}pt of separation`}, recorded as the rubric's exception`
				: `${node.tag} ${node.rect.w}x${node.rect.h} at ${node.rect.x},${node.rect.y} — ${node.path}${offscreenNote(node, state)}`,
		});
	}
	if (rows.length === 0) {
		const smallest = Math.min(
			...controls.map((n) => Math.min(n.rect.w, n.rect.h)),
		);
		rows.push({
			check: "U-01",
			verdict: "PASS",
			measured: `smallest ${smallest}pt vs floor ${floor}`,
			detail: `${controls.length} controls`,
		});
	}
	return rows;
}

/**
 * U-02 — body text ≥ 4.5:1 and large text ≥ 3:1, against its *effective* ground.
 *
 * ONE KNOWN LIMIT OF THIS CHECK'S SCOPE, stated here rather than only in a review
 * thread: it reads text NODES, so a control's `::placeholder` — a pseudo-element,
 * absent from the DOM walk — is never directly measured. What IS measured is the
 * field's stand-in copy, the zero-height node `src/ui/components/textarea.tsx`
 * renders to measure the placeholder's wrapped height, and that copy is the only
 * placeholder-shaped node in the frame. **U-02 is therefore proxy coverage for a
 * placeholder, not direct coverage**: a placeholder whose own ink is unreadable
 * while the copy's is fine would pass here (measured: forcing the placeholder's
 * colour to its surface leaves this check green). Closing it needs the extract
 * probe to read `getComputedStyle(el, "::placeholder")` alongside `color`; until
 * then, the pair itself is asserted in design/tokens/contrast-contract.mjs
 * (`input/placeholder`) and the field's use of it is pinned by
 * src/ui/components/textarea.test.ts.
 */
function u02Contrast(state: AuditState, floors: Floors): CheckRow[] {
	const textNodes = state.nodes.filter(
		(n) => n.ownText && n.ownText.length > 0,
	);
	if (textNodes.length === 0) {
		return [
			{
				check: "U-02",
				verdict: "BLOCKED",
				blockedKind: "unmeasurable",
				measured: null,
				detail: "no text nodes in this frame",
			},
		];
	}
	const rows: CheckRow[] = [];
	let worst: { ratio: number; node: AuditNode | null } = {
		ratio: Infinity,
		node: null,
	};
	for (const node of textNodes) {
		const ground = parseCssColor(node.background);
		const fg = composite(parseCssColor(node.color), ground);
		const ratio = contrastRatio(fg, ground);
		if (ratio === null) continue;
		const large =
			node.fontSize >= 24 ||
			(node.fontSize >= 18.66 && Number(node.fontWeight) >= 700);
		const needed = large ? floors.largeText : floors.bodyText;
		if (ratio < worst.ratio) worst = { ratio, node };
		if (ratio < needed) {
			rows.push({
				check: "U-02",
				verdict: "FAIL",
				measured: `${ratio}:1 (needs ${needed}:1, ${round(node.fontSize, 1)}px)`,
				detail: `${node.path} text ${JSON.stringify(node.ownText.slice(0, 40))} on ${node.background}${offscreenNote(node, state)}`,
			});
		}
	}
	if (rows.length === 0) {
		rows.push({
			check: "U-02",
			verdict: "PASS",
			measured: `worst ${worst.ratio}:1 across ${textNodes.length} text nodes`,
			detail: worst.node ? `tightest: ${worst.node.path}` : "",
		});
	}
	return rows;
}

/**
 * U-03 — colour is never the only carrier of a status. Mechanical form: a node
 * whose only distinguishing feature is a semantic colour, with no word, glyph,
 * shape or accessible name, is a colour-only status.
 *
 * The parameter order is the whole registry's: `(state, floors, semantic)`. It is
 * taken as `(state, semantic)` before, so this check silently received the
 * *floors* object as its palette and threw — a signature drift the registry
 * could not catch, and one worth keeping the comment for.
 */
function u03ColourOnlyStatus(
	state: AuditState,
	floors: Floors,
	semantic: Set<string>,
	paletteMissingReason: string | null,
): CheckRow[] {
	// With no palette loaded there is nothing to match against, so no suspect can
	// be found — and "no suspects" must never read as PASS. The canary's own
	// defect page passed U-03 on all 16 cells this way.
	if (semantic.size === 0) {
		return [
			{
				check: "U-03",
				verdict: "BLOCKED",
				blockedKind: "unmeasurable",
				measured: null,
				detail: `no semantic palette to measure against: ${paletteMissingReason ?? "not supplied"}`,
			},
		];
	}
	// A dot is not a colour-only status when a *word* sits beside it: "Failed" next to a
	// red dot is a word carrier, and flagging it would make this check noise. "Beside"
	// is the whole question, and it has exactly two honest scopes:
	//
	//   - the node's own container text, for a node that belongs to no control (a dot in
	//     a paragraph, where the paragraph IS the composition); and
	//   - the CONTROL the node belongs to, for a node inside one — a status indicator is
	//     drawn in an empty 12 pt slot while its word sits in a sibling branch of the
	//     same row. The app's `ListRow` is that shape, and reading only the slot made one
	//     redundant marker report as a colour-only status in 8 cells.
	//
	// WHY THE WALK CANNOT SIMPLY GO FURTHER. The tempting fix is "nearest ancestor with
	// any text", and it is wrong: on every real screen the next ancestor holding text is
	// a heading, a page title or the screen root, so every dot would find a word above it
	// and U-03 could never fire again — a rule narrowed until it cannot fail. The canary's
	// `#status-dot` is exactly that trap (a bare dot in a paragraph, inside a panel that
	// carries a heading) and it stays a FAIL under this rule, while `#status-row-dot` is
	// the control-scoped shape beside it and stays silent. `e2e/run-canary.ts` asserts
	// that pair in both directions.
	//
	// The row's accessible NAME is the other candidate, and it is rejected for a reason
	// that matters: it is U-09's channel, not a visible carrier, and it lives on the
	// control, so a labelled row would clear any dot inside it — a red dot in a "Send"
	// button carries no status, but its name would say otherwise.
	const hasWord = (node: AuditNode): boolean => {
		const carrier = `${node.containerText ?? ""} ${node.controlText ?? ""}`;
		return /[A-Za-z]{3,}/.test(carrier);
	};
	const suspects = state.nodes.filter((n) => {
		if (n.interactive) return false;
		if (n.ownText || n.ariaLabel || n.childImages > 0) return false;
		const draws = [n.semanticBackground, n.semanticBorder, n.semanticColour];
		if (
			!draws.some(
				(c) => typeof c === "string" && semantic.has(colourKey(c) ?? ""),
			)
		)
			return false;
		return !hasWord(n);
	});
	if (suspects.length === 0) {
		return [
			{
				check: "U-03",
				verdict: "PASS",
				measured: `0 colour-only status nodes of ${state.nodes.length}`,
				detail: "",
			},
		];
	}
	// The suspects this repository DECLARES as exceptions rather than FAILs are split
	// out here and returned as EXCEPTION rows of their own, in the same shape U-08
	// uses for a pair its painted-region rule sets aside: RECORDED with a reason,
	// never folded into a pass and never dropped. `declaredColourException` says what
	// each shape is and why it is narrow.
	const byIndex = new Map(state.nodes.map((n) => [n.index, n]));
	const failures: CheckRow[] = [];
	const declared: CheckRow[] = [];
	for (const node of suspects) {
		const reason = declaredColourException(node, state, byIndex);
		if (reason !== null) {
			declared.push({
				check: "U-03",
				verdict: "EXCEPTION",
				measured: `declared exception: ${reason}`,
				detail: node.path,
			});
			continue;
		}
		failures.push({
			check: "U-03",
			verdict: "FAIL",
			measured: `colour ${node.semanticBackground || node.semanticBorder || node.semanticColour}, no word/glyph/name`,
			detail: `${node.path}`,
		});
	}
	// Both caps independently, like U-08: a cell with more than eight suppressions
	// still states the reason on every row it does print.
	return [...failures.slice(0, 8), ...declared.slice(0, 8)];
}

/**
 * The U-03 declared-exception reasons, exported so the canary asserts the rule's
 * own wording rather than a copy of it — the same contract `U08_SUPPRESSION` has.
 * A drifted reason string would otherwise leave the canary asserting a sentence
 * the audit no longer writes, which is a green run proving nothing.
 */
export const U03_SUPPRESSION = {
	/**
	 * Branch (1), a control's own painted surface. The reason names the two carriers
	 * the branch actually requires (`childImages > 0 || hasAccessibleName`), so the
	 * prose and the predicate cannot drift apart (review round 3, R3-2).
	 */
	CONTROL_FILL:
		"the control's own painted surface — its glyph or accessible name carries the affordance, so its fill is not a colour-only status",
	/**
	 * Branch (2), one bar of the level meter's repeated series. The row appends the
	 * measured count and colour, so this is the stable prefix the canary asserts.
	 */
	METER_SERIES:
		"one bar of the level meter's repeated series, not a single status indicator",
} as const;

/**
 * The two shapes U-03 DECLARES as exceptions rather than FAILs, each with its
 * measured reason — the shape a reviewer agreed is a false positive in substance.
 *
 * WHY A PREDICATE OVER THE EXTRACTED NODE, and not a list of CSS paths: a path list
 * would pin one page's hashed class names and rot on the next build; a predicate
 * states the SHAPE. Neither branch can widen to a real colour-only status — see the
 * geometry in each.
 *
 * Returning a reason (rather than suppressing silently) is the point: a declared
 * exception is a recorded statement a reader can audit, which is what makes it
 * different from a prose rationale in a review comment and from a rule narrowed
 * until it cannot fail.
 *
 * Both branches are exercised by a canary fixture (review round 3, R3-1): the
 * `#filled-control` and `#meter-series` shapes must come back EXCEPTION with the
 * reason below, and `#three-dot-a` must come back FAIL. Without those fixtures,
 * "the predicates are narrow" was a claim no run could test — the round-2 comment
 * asserted it against a fixture that exercised neither new branch.
 */
function declaredColourException(
	node: AuditNode,
	state: AuditState,
	byIndex: Map<number, AuditNode>,
): string | null {
	// (1) A CONTROL'S OWN PAINTED SURFACE. The composer's send button paints its accent
	// fill on a direct child that covers the control's box exactly (measured 44×44 over
	// a 44×44 button); the affordance is the control's — its glyph, and its accessible
	// name (U-09 passes on the control). The rule's `controlText` scope already accepts a
	// WORD in the control; this is that same case with a glyph instead of a word.
	//
	// The branch REQUIRES one of those two carriers on the control, because that is
	// what the reason claims and what makes the fill not a status: a wordless,
	// glyph-less control fully painted one semantic colour is exactly the colour-only
	// state U-03 exists to report, and exempting it would reopen the hole this branch
	// is meant to be a narrow cut in (review round 3, R3-2).
	//
	// The geometry reads `visibleRect` (what is PAINTED), not the layout `rect`: this
	// file's convention for "what does the reader see" is `visibleRect`, so a fill
	// clipped to a sliver against its control must not count as covering it.
	const control = node.ancestors
		.map((i) => byIndex.get(i))
		.find((n) => n?.interactive);
	const controlBox = control === undefined ? null : paintedBox(control);
	const fillBox = paintedBox(node);
	if (
		control !== undefined &&
		controlBox !== null &&
		fillBox !== null &&
		fillBox.w >= controlBox.w * 0.9 &&
		fillBox.h >= controlBox.h * 0.9 &&
		(control.childImages > 0 || control.hasAccessibleName)
	) {
		return U03_SUPPRESSION.CONTROL_FILL;
	}
	// (2) ONE BAR OF THE LEVEL METER'S REPEATED SERIES. The recording meter is exactly
	// `LEVEL_BARS` sibling bars drawing one semantic colour — a visualisation of level,
	// not a single status indicator — and the row's status word (`Recording`) sits
	// BESIDE the meter, outside both of the rule's bounded scopes (its own container is
	// the empty meter box).
	//
	// THE FLOOR IS THE METER'S OWN BAR COUNT, NOT "a handful" (QA round 1, Q1; review
	// round 3, R3-1). The earlier `>= 3` was satisfied by ANY short row of same-colour
	// siblings, and QA reproduced the consequence: three bare colour-only dots — a real
	// U-03 violation — came back EXCEPTION, so the audit could no longer fail on a
	// 3-dot colour-only status. Tying the count to `LEVEL_BARS` (imported from the
	// meter's own module, so it cannot drift) is the narrowest rule that keeps the flat
	// meter exempt: the meter is 16 bars and a status row is a handful of indicators,
	// so a 3-dot status row can no longer match.
	//
	// THE RESIDUAL, stated rather than hidden: a run of >= LEVEL_BARS identical
	// same-colour siblings WOULD still be exempted. That is the bound of a shape
	// predicate that must not fire on a flat (silent-take) meter — a size-varying
	// requirement was rejected because a real meter at rest is 16 equal bars. At that
	// cardinality a uniform same-colour run reads as a meter, not as a status row, and
	// the canary's `#three-dot-a` fixture fails the moment this floor is widened back
	// below `LEVEL_BARS` again, so the direction cannot drift unnoticed.
	//
	// `aria-hidden` is NOT the discriminator even though the meter carries it: an
	// aria-hidden node can still paint a colour-only status, so exempting that attribute
	// wholesale would be the rule narrowing it must not.
	const parent = node.ancestors[0];
	if (parent !== undefined && node.semanticBackground !== "") {
		const series = state.nodes.filter(
			(n) =>
				n.ancestors[0] === parent &&
				n.tag === node.tag &&
				n.semanticBackground === node.semanticBackground,
		);
		if (series.length >= LEVEL_BARS) {
			return `${U03_SUPPRESSION.METER_SERIES} (${series.length} bars drawing ${node.semanticBackground})`;
		}
	}
	return null;
}

/**
 * The independent rule inside a multi-rule check, recognised by its own words.
 *
 * `U-05` has four directions and `U-07` two axes; each is a separate rule that can
 * die alone, and each reports the same check id. Two things depend on telling them
 * apart, and both read this table rather than a second copy of the patterns:
 *
 *   - the audit's `--blind <check>:<rule>` mutation hook, and
 *   - the canary's per-defect assertion, which requires a row for THIS rule naming
 *     the defective element — matching only the check id and the element let a
 *     blinding of one direction pass, because another direction flagged the same
 *     element.
 *
 * A rule added here without a pattern makes `--blind` refuse the spec, which is the
 * failure mode that is visible rather than silent.
 */
export const SUB_RULE_TEXT: Record<string, RegExp> = {
	"U-05:top": /^top edge/,
	// The top rule's second shape — content INSIDE a modal dialog raised into
	// the band, the boundary of the modal-surface set-aside below. Separate
	// words so each shape is separately blindable: one text for both made a
	// blind of either report two missed fixtures, which the mutation self-test
	// correctly reads as "not exactly the named rule" — the same finding U-08's
	// escape branches were split for (review round 4).
	"U-05:top-dialog": /^dialog content/,
	"U-05:bottom": /^pinned content/,
	"U-05:left": /^left edge/,
	"U-05:right": /^right edge/,
	"U-07:x": /overflow-x/,
	"U-07:y": /overflow-y/,
	// U-08's escape branches: a reported overlap where one of the two boxes has a clipping
	// ancestor that is not on its containing-block chain. They have their own patterns
	// because the canary asserts a rule, not a check — every other U-08 fixture is a plain
	// overlap, so without these a clip test that swallowed the escape case would still find
	// some other U-08 row on the page and pass (review round 3).
	//
	// Split by the escaping node's own `position` so each shape is separately blindable
	// (review round 4): one rule covering both made a blind report two missed defects, which
	// the audit's mutation self-test correctly reads as "not exactly the named rule".
	"U-08:escape-absolute": /^painted over a clipping ancestor \(absolute\)/,
	"U-08:escape-fixed": /^painted over a clipping ancestor \(fixed\)/,
	"U-08:escape-sticky": /^painted over a clipping ancestor \(sticky\)/,
};

/** U-05 — nothing sits under a notch, a home indicator or an Android gesture bar. */
function u05SafeAreas(state: AuditState): CheckRow[] {
	const insets = state.insets;
	if (
		!insets ||
		(insets.top === 0 &&
			insets.bottom === 0 &&
			insets.left === 0 &&
			insets.right === 0)
	) {
		return [
			{
				check: "U-05",
				verdict: "BLOCKED",
				// Not-applicable when the device declares no unsafe edge at all (there is
				// nothing for content to sit under); unmeasurable when the insets could
				// not be published, which is a gap in the instrument.
				blockedKind:
					state.insetsOverride?.applied === false
						? "unmeasurable"
						: "not-applicable",
				measured: "insets 0",
				detail:
					state.insetsOverride?.applied === false
						? `the safe-area override could not be applied: ${state.insetsOverride.reason ?? "unknown"}`
						: "this device class declares no unsafe edges, so it cannot answer the question",
			},
		];
	}
	const vw = state.viewport.width;
	const vh = state.viewport.height;
	// A node only *counts* here if it draws something: text, a control, a
	// background or a border. An empty layout wrapper inside the band is not
	// content, and flagging it is how this check becomes noise nobody reads.
	const draws = (n: AuditNode): boolean =>
		Boolean(n.ownText) ||
		n.interactive ||
		n.childImages > 0 ||
		(n.ownBackground && n.ownBackground !== "rgba(0, 0, 0, 0)") ||
		n.borderWidth > 0;
	const pinned = (n: AuditNode): boolean =>
		n.position === "fixed" || n.position === "sticky";
	const rows: CheckRow[] = [];
	/**
	 * Nodes this rule saw and did not judge, by reason.
	 *
	 * GHOSTS ARE NOT CONTENT. A node clipped to nothing, or hidden from the
	 * accessibility tree with no ink of its own, is not "sitting under the notch": it
	 * is not sitting anywhere. The filter is U-08's own `isGhost`, and it is what the 38
	 * rows this rule signed on the 2026-10-04 `main` manifest were: every one of them a
	 * node whose layout box reached into the band while NOTHING of it was painted (22 on
	 * CI's own run of the same head).
	 *
	 * The painted box below is the other half of the same rule, and it catches the shape
	 * the filter cannot: a node clipped only PART of the way paints, so the filter keeps
	 * it, and it is the painted box that stops it being reported for where its LAYOUT box
	 * reaches. That shape does not occur on the app manifest this change was measured
	 * against — the canary's `#inset-clipped` is it, and the canary fails if the rule goes
	 * back to measuring layout boxes.
	 *
	 * The count is REPORTED rather than silent: a rule that stops firing has to say what
	 * it stopped judging and why, or a narrowed rule is indistinguishable from a dead
	 * one.
	 */
	const setAside = new Map<string, number>();
	const bump = (reason: string): void => {
		setAside.set(reason, (setAside.get(reason) ?? 0) + 1);
	};
	const drawing = state.nodes.filter(draws);
	const considered = drawing.filter((n) => {
		if (!isGhost(n)) return true;
		bump(
			n.clippedAway
				? "clipped to nothing by an ancestor on its containing-block chain"
				: "aria-hidden with no ink of its own",
		);
		return false;
	});
	/**
	 * Node indices that sit on the ancestor chain of something inside an
	 * `aria-modal` dialog — i.e. the layers a modal is wrapped in.
	 *
	 * U-05's dismiss-layer set-aside below reads this: react-native-web paints
	 * every open modal inside its own fixed, viewport-covering layer (the
	 * conversations drawer's host), and that layer is a fact about the modal,
	 * not about the app that opened it — so the rule is keyed to the
	 * `aria-modal` declaration rather than to any app-specific shape.
	 */
	const modalCarriers = new Set<number>();
	for (const n of state.nodes) {
		if (!n.inModalDialog) continue;
		for (const ancestor of n.ancestors) modalCarriers.add(ancestor);
	}
	let painted = 0;
	for (const node of considered) {
		// Measured on the PAINTED box, not the layout box, for the same reason the ghosts
		// are dropped: a node whose painted part starts below the inset is not under the
		// inset however far its layout box reaches up. A node clipped only PART of the way
		// paints, so the ghost filter does not drop it, and this is the rule that keeps it
		// from being reported for where its layout box reaches — the canary's
		// `#inset-clipped` is exactly that shape.
		const box = paintedBox(node);
		if (box === null) {
			// Unreachable while `isGhost` above already excludes on the same field, and kept
			// because the two read it through different helpers: if they ever disagree, this
			// rule must stay quiet rather than measure a layout box the user cannot see.
			bump("nothing painted");
			continue;
		}
		painted += 1;
		const { y, h, x, w } = box;
		// TOP: anything drawing inside the notch/Dynamic Island band. Content below
		// the fold has y > inset.top, so this only fires at the top of the page —
		// which is exactly where a full-bleed header or banner lives.
		// A container that spans most of the viewport is not content drawn under the
		// notch: every app root sits at y=0 by construction, and flagging it buried
		// the real signal under 200 identical rows on the first run against a real
		// build. The children of such a container are what the rule is about, and
		// they are judged on their own.
		const containerLike = h >= vh * 0.6 && w >= vw * 0.9;
		// THE DIALOG'S OWN SURFACE IS NOT CONTENT UNDER THE NOTCH. A modal dialog's
		// ground spans the viewport by construction (the conversations drawer's
		// panel, top to bottom), so it is the `containerLike` exemption at the shape
		// that test misses: a panel narrower than 90% of the viewport but full
		// height, inside an `aria-modal` dialog. Only a node that carries no text
		// and is not a control qualifies — anything a reader can read or press
		// inside the band keeps failing exactly as before — the count is reported
		// with the PASS like every other set-aside here, and the canary's
		// `#dialog-surface` holds the silent direction while `#dialog-band-control`
		// keeps the failing one.
		if (
			node.inModalDialog &&
			!node.ownText &&
			!node.interactive &&
			y <= 1 &&
			y + h >= vh - 1
		) {
			bump(
				"a modal dialog's own full-height surface (no text or control of its own)",
			);
			continue;
		}
		// THE MODAL'S OWN FULL-VIEWPORT LAYER IS NOT CONTENT UNDER THE SAFE AREA
		// EITHER. react-native-web wraps every open modal in a fixed,
		// viewport-covering layer that carries no text and no control of its own
		// (the conversations drawer's host at iphone-15, design round 4); its band
		// occupant is whatever the dialog draws there, and for that drawer it is
		// the dialog's full-bleed dismiss layer — a CONTROL role, but one that
		// dismisses from anywhere, so the band holds no target a reader must reach
		// (unlike the pinned action bar this rule exists to catch, #footer-flush).
		// Content raised into the band still fails on its own row (the canary's
		// #dialog-band-control), so this set-aside cannot read as a blanket.
		if (
			modalCarriers.has(node.index) &&
			!node.ownText &&
			!node.interactive &&
			node.position === "fixed" &&
			x <= 1 &&
			y <= 1 &&
			x + w >= vw - 1 &&
			y + h >= vh - 1
		) {
			bump(
				"a modal's own full-viewport layer whose band holds the dialog's full-bleed dismiss layer (a control role, dismissal from anywhere)",
			);
			continue;
		}
		if (
			insets.top > 0 &&
			!containerLike &&
			y < insets.top &&
			y + h > 0 &&
			y >= 0
		) {
			rows.push({
				check: "U-05",
				verdict: "FAIL",
				// Two shapes, two wordings, because they are separately blindable
				// rules: page content under the inset (#full-bleed) and content
				// inside a modal dialog raised into the band (#dialog-band-control,
				// the boundary of the modal set-asides above). One wording for both
				// made a blind of either report BOTH fixtures as missed, which the
				// mutation self-test reads as "not exactly the named rule" (the same
				// finding U-08's escape branches were split for, review round 4).
				measured: node.inModalDialog
					? `dialog content sits at ${y}pt, inside the ${insets.top}pt unsafe top inset`
					: `top edge ${y}pt is inside the ${insets.top}pt unsafe top inset`,
				detail: `${node.path}${node.ownText ? ` (${JSON.stringify(node.ownText.slice(0, 30))})` : ""}`,
			});
			continue;
		}
		// BOTTOM: only *pinned* content is judged here. On a scrolling page every
		// control passes through the bottom band on its way past, so judging unpinned
		// nodes would flag the whole document; the defect that matters is a composer
		// or action bar pinned flush to the home indicator.
		if (insets.bottom > 0 && pinned(node) && box.bottom <= vh + 1) {
			const gap = vh - (y + h);
			if (gap < Math.max(insets.bottom, 8) - 1) {
				rows.push({
					check: "U-05",
					verdict: "FAIL",
					measured: `pinned content is ${gap}pt from the bottom, inside the ${insets.bottom}pt band (needs ≥ ${Math.max(insets.bottom, 8)}pt)`,
					detail: `${node.path} — a control there is unreachable`,
				});
				continue;
			}
		}
		// THE SIDE BANDS. In landscape the notch moves to an edge, so these two rules
		// ask the top rule's question on the other axis, and they carry the same
		// exemptions expressed for a side band. Both are counted with their own
		// reason (`bump`), never dropped in silence.
		const entersLeft = insets.left > 0 && x < insets.left && x + w > 0;
		const entersRight =
			insets.right > 0 && vw - (x + w) < insets.right && x < vw;
		if (entersLeft || entersRight) {
			// A MODAL'S OWN FULL-BLEED DISMISS LAYER IS NOT A TARGET UNDER AN UNSAFE
			// EDGE. An open react-native-web modal paints a dismiss layer across the
			// whole viewport: a CONTROL, and one that dismisses from anywhere — no
			// reader has to reach a target inside the band, which is the shape these
			// rules exist to catch (the canary's #side-left and #side-both-edges
			// bars). It is the side band's half of the top rule's dismiss-layer
			// set-aside, and it is the only interactive full-bleed shape exempted:
			// the container branch below is restricted to nodes that are NOT
			// controls, so removing this branch puts the scrim back on a FAIL row
			// instead of leaving it silently covered — a branch that cannot change an
			// outcome must not look like a second condition.
			if (node.inModalDialog && node.interactive && containerLike) {
				bump(
					"a modal's own full-bleed dismiss layer (a control role that dismisses from anywhere, so the band holds no target a reader must reach)",
				);
				continue;
			}
			// A FULL-BLEED CONTAINER IS NOT CONTENT UNDER AN UNSAFE EDGE, for the
			// same reason the top rule exempts it: every app root and full-bleed
			// wrapper sits flush to the edge by construction, and `draws` counts a
			// background as content, so without this the rules report the whole
			// ancestor chain for the background sitting under the band — the Screen
			// root that correctly applies `padding-left: 59` among them. What a
			// reader can actually read or reach is judged on its own row, which is
			// what keeps a real intrusion — the conversations drawer's title and
			// rows, at x = 16…56 — named.
			//
			// `!interactive` is load-bearing rather than a detail: the rubric's own
			// words are "no control within 8 pt of an unsafe edge", so a
			// container-scale CONTROL is content here and is left to the dismiss
			// branch above, or to its own FAIL row.
			if (containerLike && !node.interactive) {
				bump(
					"a full-bleed container or surface (its background paints into the band; its own content is judged on its own rows)",
				);
				continue;
			}
			// A MODAL DIALOG'S OWN GROUND IS NOT CONTENT UNDER A SIDE EDGE EITHER.
			// This is the top rule's modal-surface set-aside (`inModalDialog &&
			// !ownText && !interactive`) with its extent expressed for a side band:
			// the fragment of the dialog that reaches the unsafe edge, carrying no
			// word and no control of its own. The extent test is the one place the
			// side band has to differ, and it has to be WEAKER rather than stricter
			// — the top rule asks the surface to reach the far edge (`y + h >= vh -
			// 1`), while the conversations drawer's own ground stops at the bottom
			// inset on landscape (measured 369 pt of a 390 pt viewport), so that
			// test is silent on the very surface its comment names.
			//
			// Nothing further is needed to keep this from reading as a blanket: a
			// node with a word of its own is content, and a node that is a control is
			// content, so the drawer's title, its rows, its icons and its row buttons
			// all keep failing on their own rows. An earlier revision ALSO required
			// the surface to span 0.6 vh, and that left the drawer's own shorter
			// full-width regions (w = 279, h = 48…200 pt) reporting as if they were
			// findings; the height bar was there to distinguish a ground from a row,
			// and `!ownText && !interactive` already does that.
			if (
				node.inModalDialog &&
				!node.ownText &&
				!node.interactive &&
				(x <= 1 || x + w >= vw - 1)
			) {
				bump(
					"a modal dialog's own ground (no text or control of its own, reaching the unsafe edge)",
				);
				continue;
			}
		}
		if (entersLeft) {
			rows.push({
				check: "U-05",
				verdict: "FAIL",
				measured: `left edge ${x}pt inside the ${insets.left}pt inset`,
				detail: node.path,
			});
		}
		// The right rule used to sit AFTER the left rule's `continue`, so a node that
		// reached into BOTH side insets was reported for the left edge and the right
		// edge was never evaluated for it — a rule that could not fail for any
		// full-width node, which in landscape is most of them. The two edges are
		// independent questions about the same node, so both are asked and both rows
		// are emitted; the canary's #side-right keeps a bounded right-edge violation
		// load-bearing.
		if (entersRight) {
			rows.push({
				check: "U-05",
				verdict: "FAIL",
				measured: `right edge is inside the ${insets.right}pt inset`,
				detail: node.path,
			});
		}
	}
	if (rows.length === 0) {
		// The set-aside count, with its reason, is part of the PASS: these are the nodes
		// this rule used to report, and a reader has to be able to see that it still saw
		// them and why it stayed quiet — not infer it from two numbers that differ.
		const aside = [...setAside.entries()]
			.map(([reason, count]) => `${count} set aside (${reason})`)
			.join("; ");
		const notes = [
			`${considered.length} drawing node(s) considered`,
			aside,
		].filter((note) => note !== "");
		rows.push({
			check: "U-05",
			verdict: "PASS",
			measured: `top ${insets.top}pt and bottom ${insets.bottom}pt respected across ${painted} painted node(s)`,
			detail: notes.join("; "),
		});
	}
	return rows;
}

/** U-06 — nothing exceeds the viewport at 100 %, and only a scroll region at 200 %. */
function u06HorizontalOverflow(state: AuditState): CheckRow[] {
	const rows: CheckRow[] = [];
	const docOverflow = state.document.scrollWidth - state.document.clientWidth;
	if (docOverflow > 1) {
		rows.push({
			check: "U-06",
			verdict: "FAIL",
			measured: `document ${state.document.scrollWidth}px wide in a ${state.document.clientWidth}px viewport (+${docOverflow}px)`,
			detail: "",
		});
	}
	// A node wider than the viewport is acceptable ONLY inside something that scrolls
	// horizontally *on purpose* — the rubric's own clause: "at 200 % overflowing only
	// inside an explicitly scrollable region". That region is the ANCESTOR (a code
	// block's `ScrollView`, rendered `overflow-x: auto` by react-native-web), so the
	// probe answers it on the chain rather than from the node's own style; a code line
	// long by design is content, not a layout defect. It is recorded as an EXCEPTION,
	// never folded into PASS, so the run still says what it let through and where.
	//
	// ONE KNOWN LIMIT, measured by QA on this head rather than argued (and recorded
	// rather than silently fixed, since what width this rule MEANS is a separate
	// decision): the comparison is against `state.viewport.width`, and in this harness
	// that reading is the emulated layout viewport, which grows to the document's
	// scroll width when the DOCUMENT itself overflows (measured: 511 on a 320 pt
	// iphone-se cell). A node that overflows on a page that also overflows therefore
	// never reaches this loop — the document-level row above is the only row that
	// fires — so the EXCEPTION cannot be emitted in that case. The verdict is still
	// FAIL there, so nothing false passes; and the app's own U-06 rows are unaffected,
	// because its overflow is contained by the scroller and the reading stays 320.
	const offenders = state.nodes.filter(
		(n) => n.rect.x + n.rect.w > state.viewport.width + 1 && n.rect.w > 8,
	);
	for (const node of offenders.slice(0, 8)) {
		const overflow = node.rect.x + node.rect.w - state.viewport.width;
		rows.push({
			check: "U-06",
			verdict: node.scrollsX ? "EXCEPTION" : "FAIL",
			measured: `right edge ${node.rect.x + node.rect.w}px vs viewport ${state.viewport.width}px (+${overflow}px)`,
			detail: node.scrollsX
				? `${node.path} — inside an ancestor with overflow-x: auto|scroll, the explicitly scrollable region the rubric allows`
				: node.path,
		});
	}
	if (rows.length === 0) {
		rows.push({
			check: "U-06",
			verdict: "PASS",
			measured: `document ${state.document.scrollWidth}px ≤ viewport ${state.document.clientWidth}px, widest node within bounds`,
			detail: "",
		});
	}
	return rows;
}

/** U-07 — no clipped text, except deliberate single-line ellipsis with a full value. */
function u07ClippedText(state: AuditState): CheckRow[] {
	const rows: CheckRow[] = [];
	for (const node of state.nodes) {
		if (!node.ownText) continue;
		const clipsY =
			node.scrollHeight > node.clientHeight + 1 &&
			/hidden|clip/.test(node.overflowY);
		const clipsX =
			node.scrollWidth > node.clientWidth + 1 &&
			/hidden|clip/.test(node.overflowX);
		if (!clipsY && !clipsX) continue;
		// One line of visually truncated text is allowed only when the full value
		// is still reachable — either the element is a real control (so the label
		// is announced) or the ellipsis is the platform's own truncation idiom.
		const ellipsis =
			node.textOverflow === "ellipsis" && node.whiteSpace === "nowrap";
		if (ellipsis && node.clientHeight <= node.fontSize * 1.8) {
			rows.push({
				check: "U-07",
				verdict: "EXCEPTION",
				measured: `single-line ellipsis (${node.scrollWidth}px in ${node.clientWidth}px)`,
				detail: `${node.path} — recorded, needs the full value on tap or in an accessible name`,
			});
			continue;
		}
		rows.push({
			check: "U-07",
			verdict: "FAIL",
			// The axis is named, not just repeated from the computed style: the two
			// branches of this check are independent rules (a box can clip one axis
			// and not the other), and a message that reads `(hidden)` for both makes
			// them indistinguishable in a report — and unblindable in the mutation
			// self-test, which is how one of them silently died once already.
			measured: clipsY
				? `content ${node.scrollHeight}px in a ${node.clientHeight}px box (overflow-y: ${node.overflowY})`
				: `content ${node.scrollWidth}px in a ${node.clientWidth}px box (overflow-x: ${node.overflowX})`,
			detail: `${node.path} ${JSON.stringify(node.ownText.slice(0, 40))}${offscreenNote(node, state)}`,
		});
	}
	if (rows.length === 0) {
		rows.push({
			check: "U-07",
			verdict: "PASS",
			measured: `${state.nodes.filter((n) => n.ownText).length} text nodes, none clipped`,
			detail: "",
		});
	}
	return rows;
}

/**
 * Whether a node is a PINNED OVERLAY, whatever CSS keyword produced it.
 *
 * `position: fixed | sticky` was the first test, and it missed the real case that
 * mattered: react-native-web renders a pinned footer `absolute`, so a
 * pin-over-scroll composer was paired with the transcript beneath it and produced
 * 32 overlap rows on a screen that is correct. The design is not a defect — the
 * content passes *under* an opaque bar — so the keyword cannot be the test.
 *
 * An absolutely-positioned element counts as pinned when it is anchored to a
 * viewport edge (top or bottom) and is OPAQUE. Opacity is part of the definition
 * rather than a separate exception: a translucent bar over content IS a visible
 * overlap, and the caller reports that case.
 */
function isPinnedOverlay(node: AuditNode, state: AuditState): boolean {
	if (node.position === "fixed" || node.position === "sticky") return true;
	if (node.position !== "absolute") return false;
	// The band, not the raw edge: a pinned overlay CLEARS the safe-area inset, so
	// its rect starts at `inset.top` (or ends at `height - inset.bottom`) rather
	// than at 0. Testing against the raw edge read every correctly-inset pinned bar
	// as unpinned — which is what re-introduced the false positives this rule
	// exists to remove.
	const anchoredTop = node.rect.y <= state.insets.top + 1;
	const anchoredBottom =
		node.rect.y + node.rect.h >=
		state.viewport.height - state.insets.bottom - 1;
	return anchoredTop || anchoredBottom;
}

/** Whether a node paints an opaque background of its own (so it can occlude). */
function isOpaque(node: AuditNode): boolean {
	const parsed = parseCssColor(node.ownBackground);
	return parsed !== null && parsed[3] >= 0.999;
}

/** Whether `inner` sits entirely inside `outer` (a control under a pinned bar). */
function encloses(outer: AuditNode, inner: AuditNode, slack = 1): boolean {
	return (
		inner.rect.x >= outer.rect.x - slack &&
		inner.rect.y >= outer.rect.y - slack &&
		inner.rect.x + inner.rect.w <= outer.rect.x + outer.rect.w + slack &&
		inner.rect.y + inner.rect.h <= outer.rect.y + outer.rect.h + slack
	);
}

/**
 * The note a row carries when its measured region is not in the captured frame.
 *
 * A clean-looking frame and a failing row are not a contradiction: the audit
 * measures the live DOM, which is taller than the viewport, so a finding below the
 * fold is real and invisible at the same time. Saying so in the row is what stops
 * a reader concluding the row is wrong.
 */
function offscreenNote(node: AuditNode, state: AuditState): string {
	const { height } = state.viewport;
	if (node.rect.y >= height) {
		return ` — the measured region is BELOW THE FOLD (y=${round(node.rect.y, 0)}pt in a ${round(height, 0)}pt viewport), so no frame can show it`;
	}
	if (node.rect.y + node.rect.h <= 0) {
		return " — the measured region is ABOVE the viewport";
	}
	if (node.rect.h > height) {
		return ` — the measured region is taller than the viewport (${round(node.rect.h, 0)}pt in ${round(height, 0)}pt)`;
	}
	return "";
}

/**
 * Whether an element can be SEEN, which is not the same as having been laid out.
 *
 * U-08 measures overlap between boxes, and a box is not a drawing. Pairing the
 * composer's measuring stand-in — full-size geometry inside a zero-height
 * `overflow: hidden` wrapper, `aria-hidden`, painting nothing — against the
 * placeholder it measures produced 40 U-08 rows for an overlap nobody could look
 * at, and the rule that settles it is the one a user would state: **a node that
 * cannot be seen cannot overlap.**
 *
 * Applied only here, and deliberately: the stand-in exists to measure the wrapped
 * height of the placeholder (a real defect it fixes), so removing it from the app
 * would be the wrong repair, and the other checks that legitimately measure a
 * clipped node (U-07 measures clipping itself) must keep seeing it.
 */
function isGhost(node: AuditNode): boolean {
	if (node.clippedAway) return true;
	return node.ariaHidden && !node.ownInk;
}

/**
 * The box a rule about PAINTED geometry measures, or `null` when nothing is painted.
 *
 * A check that measures a layout box measures a claim about a drawing that may not
 * exist: see `AuditNode.visibleRect`. `null` is not a fallback to `rect` — the whole
 * point of the field is that an unpainted node paints nowhere, and reading `rect`
 * there reinstates the phantom the field exists to remove.
 */
function paintedBox(node: AuditNode): AuditNode["rect"] | null {
	return node.visibleRect;
}

/**
 * Why a pair that the LAYOUT boxes stack on top of each other is not an overlap a
 * user can see. Exported so the canary can assert the wording instead of copying it.
 */
export const U08_SUPPRESSION = {
	/**
	 * One of the two paints at most a 1pt sliver of its box.
	 *
	 * NOT "nothing is painted": a node that paints nothing at all is excluded from this
	 * rule's pair set before pairing (`isGhost`), so what reaches this branch is the
	 * rounded-to-a-line case, and the wording says what was measured.
	 */
	SLIVER: "paints at most a 1pt sliver of its box",
	/** Both paint, but not on top of each other: the painted regions are disjoint. */
	DISJOINT: "the painted regions do not intersect",
	/** Both paint on top of each other, but by less than the rule's 25% of the smaller box. */
	BELOW_THRESHOLD: "the painted overlap is below the 25% the rule needs",
	/** The pair straddles a MODAL DIALOG's boundary: one side is inside an
	 *  `aria-modal` dialog and the other is the application it covers. `aria-modal`
	 *  is the standard declaration that everything outside the dialog is inert while
	 *  it is open — the browser's own statement that the covered side is COVERED,
	 *  not colliding. */
	MODAL_LAYER:
		"one side is inside an aria-modal dialog and the other is the covered app",
	/** Both sides are inside the dialog, and the dialog's own opaque surface — an
	 *  ancestor of one side, painted over the region the two share — covers the
	 *  pair (the drawer's panel ground over the scrim beneath it). */
	MODAL_SURFACE:
		"the dialog's own opaque surface covers the pair where it overlaps",
} as const;

function dialogSeparator(
	a: AuditNode,
	b: AuditNode,
	state: AuditState,
): AuditNode | null {
	// The region both boxes claim, in LAYOUT terms: this branch decides before the
	// painted-region gates run, and the separator must cover whatever region the
	// pair shares at all.
	const x = Math.max(a.rect.x, b.rect.x);
	const y = Math.max(a.rect.y, b.rect.y);
	const right = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w);
	const bottom = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h);
	if (right - x <= 1 || bottom - y <= 1) return null;
	for (const candidate of state.nodes) {
		// The separator is a SURFACE of the dialog, not a pair member and not a
		// descendant of one: it is opaque, it paints over the shared region, and it
		// belongs to exactly ONE side's subtree. A shared ancestor of both members
		// (the dialog's own ground behind both) paints BEHIND them and separates
		// nothing, so the exactly-one test is what keeps a real same-layer collision
		// — two controls inside one dialog — reported.
		if (candidate.index === a.index || candidate.index === b.index) continue;
		if (!candidate.inModalDialog) continue;
		if (!isOpaque(candidate)) continue;
		const box = paintedBox(candidate);
		if (box === null) continue;
		if (
			box.x > x + 1 ||
			box.y > y + 1 ||
			box.x + box.w < right - 1 ||
			box.y + box.h < bottom - 1
		)
			continue;
		const insideA =
			candidate.index === a.index || a.ancestors.includes(candidate.index);
		const insideB =
			candidate.index === b.index || b.ancestors.includes(candidate.index);
		if (insideA === insideB) continue;
		return candidate;
	}
	return null;
}

/** U-08 — meaningful boxes must not overlap. */
function u08Overlap(state: AuditState): CheckRow[] {
	// The rubric's rule is pairwise over *text and interactive* boxes, so a label
	// drawn under a control is caught as well as two controls on top of each
	// other. Ancestor/descendant pairs are excluded: a container overlaps its own
	// child by construction, and counting those would fail every nested layout.
	//
	// The rule is over boxes the user can SEE, which is `visibleRect` and not `rect`:
	// see `AuditNode.visibleRect` for why a layout box is the wrong question.
	const meaningful = state.nodes.filter(
		(n) => !isGhost(n) && (n.ownText || n.interactive),
	);
	const failures: CheckRow[] = [];
	/**
	 * Pairs the layout geometry would report, whose PAINTED regions do not overlap.
	 *
	 * These are the rows this rule used to emit: on CI's run of the 2026-10-04 `main`
	 * manifest every one of its 114 U-08 rows was such a pair, and the four geometry
	 * rules accounted for all 148 of that run's FAIL rows (U-08 114, U-05 22, U-06 8,
	 * U-03 4). The paired local re-drive of the same manifest moves together: 126 U-08
	 * rows of its 176 FAILs.
	 *
	 * They are recorded, one row each with its reason, and never dropped — a rule that
	 * narrows until it cannot fail is the failure mode this whole instrument series has
	 * been about, so what it sets aside has to be as readable as what it reports. The
	 * ROWS ARE CAPPED at eight per cell, like the failures and independently of them, so
	 * a cell with more than eight suppressions shows eight reason-tagged rows and states
	 * the true count and the whole per-reason breakdown on every one of them (the cap
	 * never bit on this manifest: the largest cell count was 8).
	 */
	const suppressed: CheckRow[] = [];
	const reasons = new Map<string, number>();
	const suppress = (
		a: AuditNode,
		b: AuditNode,
		reason: string,
		layoutNote = "",
	): void => {
		reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
		suppressed.push({
			check: "U-08",
			verdict: "EXCEPTION",
			measured: `suppressed: ${reason}${layoutNote}`,
			detail: `${a.path} ∩ ${b.path}`,
		});
	};
	for (let i = 0; i < meaningful.length; i += 1) {
		for (let j = i + 1; j < meaningful.length; j += 1) {
			const a = meaningful[i];
			const b = meaningful[j];
			// A hole in the list (an element that left the DOM between the probe and
			// this loop) is skipped rather than reported as an overlap against
			// `undefined`, which would name no element in the finding.
			if (a === undefined || b === undefined) continue;
			// Ancestry, not path prefixes: a container does not overlap its own
			// child, and a truncated CSS path cannot be trusted to say which is which.
			if (a.ancestors.includes(b.index) || b.ancestors.includes(a.index))
				continue;
			// A pinned overlay over scrolling content is the intended design, not an
			// overlap: a composer rides above a transcript every frame. Its safe-area
			// clearance is U-05's question, so it is excluded here — except against
			// another pinned element, where two bars on top of each other really is a
			// defect.
			//
			// Three cases are excluded or reported, and the rule is stated in
			// docs/e2e/README.md:
			//   - pinned (any keyword) AND opaque, over non-interactive content:
			//     excluded, the content simply passes under it;
			//   - pinned but TRANSLUCENT: reported, because a translucent bar over
			//     text is a visible overlap whoever painted it;
			//   - pinned and opaque, but the covered element is a CONTROL entirely
			//     inside it: reported, because a control the user cannot reach is a
			//     defect no matter how the overlay was positioned.
			const pinnedA = isPinnedOverlay(a, state);
			const pinnedB = isPinnedOverlay(b, state);
			if (pinnedA !== pinnedB) {
				const overlay = (pinnedA ? a : b) as AuditNode;
				const under = (pinnedA ? b : a) as AuditNode;
				const coversControl = under.interactive && encloses(overlay, under);
				if (!coversControl && isOpaque(overlay)) continue;
			}
			// THE PAIR IS A CANDIDATE ONLY IF ITS LAYOUT BOXES STACK. Deciding that on
			// layout geometry, and the verdict on painted geometry, is what makes a
			// suppression count mean something: every suppressed pair is one the rule
			// would otherwise have reported, and none of them is a pair that never
			// touched.
			const layoutW =
				Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) -
				Math.max(a.rect.x, b.rect.x);
			const layoutH =
				Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) -
				Math.max(a.rect.y, b.rect.y);
			if (layoutW <= 1 || layoutH <= 1) continue;
			const layoutArea = layoutW * layoutH;
			const layoutSmaller = Math.min(a.rect.w * a.rect.h, b.rect.w * b.rect.h);
			const layoutPct = layoutSmaller > 0 ? layoutArea / layoutSmaller : 0;
			if (layoutPct < 0.25) continue;
			const layoutNote = ` (layout boxes overlap ${layoutW}x${layoutH}pt, ${round(layoutPct * 100, 0)}% of the smaller box)`;
			// THE PAIR STRADDLES A MODAL BOUNDARY, OR IS SEPARATED BY THE DIALOG'S OWN
			// SURFACE. `aria-modal` declares that everything outside the dialog is inert
			// while it is open: the covered app against the dialog's surface is the
			// layering the dialog exists to draw, not two things colliding, and the same
			// fact one layer down explains a pair inside the dialog whose shared region
			// is covered by an opaque surface of the dialog itself (the panel ground
			// over the scrim beneath it). Both are recorded with the layout note,
			// never silently dropped, and both are keyed to the `aria-modal`
			// declaration rather than to any app-specific shape — a page that never
			// opens a modal dialog reaches neither branch. The canary asserts both
			// directions: the covered shapes stay silent, and a collision between two
			// controls of the SAME dialog still fails.
			if (a.inModalDialog !== b.inModalDialog) {
				suppress(a, b, U08_SUPPRESSION.MODAL_LAYER, layoutNote);
				continue;
			}
			if (a.inModalDialog && b.inModalDialog) {
				const separator = dialogSeparator(a, b, state);
				if (separator !== null) {
					suppress(a, b, U08_SUPPRESSION.MODAL_SURFACE, layoutNote);
					continue;
				}
			}
			// From here the pair would be a finding on layout geometry. Whether it IS one
			// is decided on what is painted.
			const paintedA = paintedBox(a);
			const paintedB = paintedBox(b);
			const unpainted =
				paintedA === null
					? a
					: paintedB === null
						? b
						: paintedA.w <= 1 || paintedA.h <= 1
							? a
							: paintedB.w <= 1 || paintedB.h <= 1
								? b
								: null;
			if (unpainted !== null || paintedA === null || paintedB === null) {
				suppress(
					a,
					b,
					`${unpainted?.path ?? "one of the pair"} ${U08_SUPPRESSION.SLIVER}`,
					layoutNote,
				);
				continue;
			}
			const overlapW =
				Math.min(paintedA.x + paintedA.w, paintedB.x + paintedB.w) -
				Math.max(paintedA.x, paintedB.x);
			const overlapH =
				Math.min(paintedA.y + paintedA.h, paintedB.y + paintedB.h) -
				Math.max(paintedA.y, paintedB.y);
			if (overlapW <= 1 || overlapH <= 1) {
				suppress(a, b, U08_SUPPRESSION.DISJOINT, layoutNote);
				continue;
			}
			const area = overlapW * overlapH;
			const smaller = Math.min(
				paintedA.w * paintedA.h,
				paintedB.w * paintedB.h,
			);
			const pct = smaller > 0 ? area / smaller : 0;
			if (pct < 0.25) {
				suppress(
					a,
					b,
					U08_SUPPRESSION.BELOW_THRESHOLD,
					`${layoutNote}, painted ${overlapW}x${overlapH}pt, ${round(pct * 100, 0)}% of the smaller painted box`,
				);
				continue;
			}
			// Whichever of the pair escaped a clipping ancestor, if either did.
			const escaped = a.escapedClip ? a : b.escapedClip ? b : null;
			failures.push({
				check: "U-08",
				verdict: "FAIL",
				// The rule's own words come first when the pair includes a node the browser
				// paints through a clipping ancestor that is off its containing-block chain: it
				// is the escape the every-ancestor walk swallowed, and `SUB_RULE_TEXT` reads it
				// (with the escaping node's position) to tell this branch — and each of its
				// shapes — apart from a plain overlap.
				measured: `${escaped === null ? "" : `painted over a clipping ancestor (${escaped.position}): `}${overlapW}x${overlapH}pt overlap (${round(pct * 100, 0)}% of the smaller painted box)`,
				detail: `${a.path} ∩ ${b.path}${offscreenNote(a, state)}`,
			});
		}
	}
	if (failures.length === 0 && suppressed.length === 0) {
		return [
			{
				check: "U-08",
				verdict: "PASS",
				measured: `${meaningful.length} text/control boxes, no pair overlapping >25%`,
				detail: "",
			},
		];
	}
	// The cell's own breakdown, on every suppression row: a per-cell count that is
	// only visible when the cap happens to let a row through is the silence this
	// whole branch exists to remove.
	const breakdown = [...reasons.entries()]
		.map(([reason, count]) => `${count}× ${reason}`)
		.join("; ");
	for (const row of suppressed)
		row.detail = `${row.detail} — ${suppressed.length} pair(s) suppressed in this cell: ${breakdown}`;
	// FAIL rows first, and each kind capped in its OWN right (8), so a real painted overlap
	// can never be crowded out of a cell's eight by the rows that explain what the rule set
	// aside — and so the rows it set aside are not invisible in precisely the cells that used
	// to report eight of them. Every suppression row names its pair and its reason.
	return [...failures.slice(0, 8), ...suppressed.slice(0, 8)];
}

/** U-09 — every interactive node in the accessibility tree carries a name. */
function u09AccessibleName(state: AuditState): CheckRow[] {
	const controls = (state.ax ?? []).filter((n) =>
		INTERACTIVE_AX_ROLES.has(n.role ?? ""),
	);
	if (controls.length === 0) {
		return [
			{
				check: "U-09",
				verdict: "BLOCKED",
				blockedKind: "unmeasurable",
				measured: "0 interactive AX nodes",
				detail: "no interactive nodes to name",
			},
		];
	}
	const unnamed = controls.filter((n) => !n.name || n.name.trim() === "");
	if (unnamed.length === 0) {
		return [
			{
				check: "U-09",
				verdict: "PASS",
				measured: `${controls.length} interactive AX nodes, all named`,
				detail: "",
			},
		];
	}
	return unnamed.slice(0, 10).map((n) => ({
		check: "U-09",
		verdict: "FAIL",
		measured: `role=${n.role} has no accessible name`,
		detail: `AX node ${n.backendDOMNodeId ?? n.nodeId}`,
	}));
}

/**
 * The U-10 declared-exception reason, exported for the same contract as
 * `U03_SUPPRESSION`: the canary asserts the wording the rule writes rather than a
 * copy that could drift.
 */
export const U10_DECLARATION = {
	TEXT_ENTRY_VALUE: "a text-entry VALUE, not a label",
} as const;

/** U-10 — the accessible name contains the visible label, so "tap approve" works. */
function u10LabelInName(state: AuditState): CheckRow[] {
	// The guard is on the *DOM's* interactive nodes, because the pairing below is
	// done there; a page whose AX tree is empty but whose DOM has controls would
	// otherwise be reported BLOCKED instead of checked.
	const controls = state.nodes.filter((n: AuditNode) => n.interactive);
	if (controls.length === 0) {
		return [
			{
				check: "U-10",
				verdict: "BLOCKED",
				blockedKind: "unmeasurable",
				measured: "0 interactive nodes in this frame",
				detail: "",
			},
		];
	}
	const rows: CheckRow[] = [];
	const declared: CheckRow[] = [];
	// Pairing happens in the DOM, on the control's *own* label. The AX tree gives
	// names but not the node identity a visible label can be attached to, and
	// pairing every AX control with the first labelled element on the page is how
	// this check reported a mismatch on a page where no control was wrong.
	for (const control of controls) {
		const visible = (control.ownText || "")
			.toLowerCase()
			.replace(/\s+/g, " ")
			.trim();
		if (visible.length < 2) continue;
		if (!control.hasAccessibleName) continue;
		const name = (control.accessibleName ?? "")
			.toLowerCase()
			.replace(/\s+/g, " ");
		if (name.includes(visible)) continue;
		// A TEXT-ENTRY control's visible text is its VALUE, not a label. U-10 compares
		// the accessible name with the visible LABEL, so that voice control ("tap
		// approve") works; a typed draft is not a label and the comparison cannot pass
		// by construction. RECORDED as a declared exception — an EXCEPTION row with the
		// measured name and value — rather than dropped or turned into a PASS; the rule
		// itself is unchanged, and the shape is narrow (input/textarea only: a button or
		// link whose visible text disagrees with its name is still a FAIL).
		//
		// The `input` half is UNREACHABLE today and is kept deliberately (review round 3,
		// R3-4): `ownText` is built from DIRECT CHILD text nodes (`probe.ts`), and an
		// `<input>` is a void element, so it can never carry one — `visible` is always
		// "" and the `visible.length < 2` guard above `continue`s first. A `<textarea>`
		// does carry its value as a child text node, which is the shape the canary's
		// `#draft-value` fixture exercises. The tag is listed anyway because it shares
		// the branch's meaning (a text-entry VALUE) and a future probe that reports an
		// input's value as `ownText` must inherit the exemption rather than silently
		// start failing on it.
		if (control.tag === "input" || control.tag === "textarea") {
			declared.push({
				check: "U-10",
				verdict: "EXCEPTION",
				measured: `declared exception: ${U10_DECLARATION.TEXT_ENTRY_VALUE} — name ${JSON.stringify(name.slice(0, 40))} vs value ${JSON.stringify(visible.slice(0, 40))}`,
				detail: control.path,
			});
			continue;
		}
		rows.push({
			check: "U-10",
			verdict: "FAIL",
			measured: `accessible name ${JSON.stringify(name.slice(0, 40))} does not contain the visible label ${JSON.stringify(visible.slice(0, 40))}`,
			detail: control.path,
		});
	}
	if (rows.length === 0 && declared.length === 0) {
		rows.push({
			check: "U-10",
			verdict: "PASS",
			measured:
				"every labelled control's accessible name contains its visible label",
			detail: "",
		});
	}
	return [...rows.slice(0, 8), ...declared.slice(0, 8)];
}

/**
 * The check registry. `needs` declares what a check requires so the runner can
 * mark it BLOCKED rather than pass it when a state cannot answer.
 */
/** The check registry, keyed by rubric id. */
export const CHECKS: Record<
	string,
	{
		label: string;
		/** Checks take what they need; a check that ignores `floors` simply omits it. */
		run: (
			state: AuditState,
			floors: Floors,
			semantic: Set<string>,
			paletteMissingReason: string | null,
		) => CheckRow[];
	}
> = {
	"U-01": { label: "Touch-target size", run: u01TouchTargets },
	"U-02": { label: "Contrast, body text", run: u02Contrast },
	"U-03": { label: "Contrast, non-text carriers", run: u03ColourOnlyStatus },
	"U-05": { label: "Safe areas", run: u05SafeAreas },
	"U-06": { label: "Horizontal overflow", run: u06HorizontalOverflow },
	"U-07": { label: "Clipped text", run: u07ClippedText },
	"U-08": { label: "Overlap", run: u08Overlap },
	"U-09": { label: "Accessible name", run: u09AccessibleName },
	"U-10": { label: "Label-in-name", run: u10LabelInName },
};

/**
 * U-04 is reported from two facts rather than one, because either alone
 * misleads: the harness measures whether the *scale dimension is live* (a run
 * whose 200 % frames are byte-identical to its 100 % frames cannot say anything
 * about large-text clipping), and U-07 on the 200 % frames says whether anything
 * clips when it is.
 */
export function u04Report(
	state: AuditState,
	{ scaleIsLive }: { scaleIsLive: boolean },
): CheckRow[] {
	if (state.scale !== "200") {
		return [
			{
				check: "U-04",
				verdict: "BLOCKED",
				blockedKind: "not-applicable",
				measured: `scale ${state.scale}`,
				detail: "the large-text check reads the 200% frames only",
			},
		];
	}
	if (!scaleIsLive) {
		// The clipping comparison is computed *after* the guard: on an inert scale
		// dimension the two samples are identical by construction, so the work ran
		// and was discarded on every 200% frame of every cell.
		return [
			{
				check: "U-04",
				verdict: "BLOCKED",
				// Unmeasurable on purpose: the app's text genuinely does not scale, so
				// there is no clipping verdict to draw. This is the case that must not
				// read green — it is a measured app property, not a missing frame.
				blockedKind: "unmeasurable",
				measured:
					"the 200% frames are not distinguishable from the 100% frames",
				detail:
					"the text-scale dimension is inert in this build, so no large-text verdict can be drawn from it",
			},
		];
	}
	const clipped = u07ClippedText(state).filter((r) => r.verdict === "FAIL");
	if (clipped.length === 0) {
		return [
			{
				check: "U-04",
				verdict: "PASS",
				measured: "no clipped text at 200%",
				detail: "",
			},
		];
	}
	return clipped.map((row) => ({ ...row, check: "U-04" }) as CheckRow);
}

/** Run every selected check over one extracted state. */
/**
 * Why a row is BLOCKED — and the distinction is load-bearing, because the two
 * cases must not share an exit code.
 *
 * `not-applicable`: the check does not apply to this cell by design (U-04 reads
 * the 200% frames only, so on a 100% cell there is nothing to answer). This is
 * expected, and a run made entirely of these is still a pass.
 *
 * `unmeasurable`: the check *could not* answer something it should have — no
 * semantic palette to compare against, no interactive node in the frame, CDP
 * refusing the inset override. A run with one of these has a gap, and reporting
 * it as green is the failure the review round found.
 */
export type BlockedKind = "not-applicable" | "unmeasurable";

export interface CheckRow {
	check: string;
	verdict: "PASS" | "FAIL" | "EXCEPTION" | "BLOCKED";
	measured: string | null;
	detail: string;
	/** Present only on BLOCKED rows, so the report can tell the two apart. */
	blockedKind?: BlockedKind;
}

/**
 * One rendered node the extract probe reports.
 *
 * Every field the probe emits is declared, with the type it actually carries:
 * a field left to the index signature becomes `unknown`, and every read then
 * needs a fallback that can never run — a *document width* of 0 because a field
 * was missing would pass an overflow check it should fail. `null` is used where
 * the probe genuinely reports a missing computed value (`getAttribute` for an
 * absent role), which is a different thing from a field that is not there.
 */
export interface AuditNode {
	index: number;
	tag: string;
	path: string;
	ancestors: number[];
	role: string | null;
	ariaLabel: string | null;
	hasAccessibleName: boolean;
	accessibleName: string;
	visibleLabel: string;
	text: string;
	ownText: string;
	rect: {
		x: number;
		y: number;
		w: number;
		h: number;
		right: number;
		bottom: number;
	};
	/**
	 * Where the node actually PAINTS, or `null` when no part of it is painted.
	 *
	 * `rect` is a layout box, and a box is not a drawing: a node clipped only part of
	 * the way keeps its full layout box, so a check that pairs layout boxes reports an
	 * overlap between this node and a sibling sitting outside the clipping ancestor
	 * that no user can see. The probe answers this from the SAME sweep that decides
	 * `clippedAway` (see its `clipIntersection`), so the two can never disagree — and
	 * every geometry rule that asks "what does the user see here" reads this, never
	 * `rect`.
	 */
	visibleRect: {
		x: number;
		y: number;
		w: number;
		h: number;
		right: number;
		bottom: number;
	} | null;
	/**
	 * Whether an ancestor scrolls horizontally on purpose (`overflow-x: auto|scroll`).
	 *
	 * The rubric allows content wider than the viewport inside an explicitly scrollable
	 * region — a code block is the real case — and the fact lives on the ANCESTOR: the
	 * element that scrolls is the `ScrollView`, the element that overflows is the text
	 * inside it. Measured per node because that is where the rule asks.
	 */
	scrollsX: boolean;
	fontSize: number;
	fontWeight: string;
	color: string;
	background: string | null;
	ownBackground: string;
	position: string;
	display: string;
	overflowX: string;
	overflowY: string;
	textOverflow: string;
	whiteSpace: string;
	scrollWidth: number;
	scrollHeight: number;
	clientWidth: number;
	clientHeight: number;
	borderWidth: number;
	padding: { top: number; bottom: number; left: number; right: number };
	/**
	 * Whether an ancestor clips this node away, and whether it draws ink of its own.
	 *
	 * A box is not a drawing. `clippedAway` is true when the node's rectangle
	 * intersects none of its clipping ancestors' boxes, which the probe answers over
	 * the chain because the clipping that hides a node is usually not on the node:
	 * the composer's measuring stand-in is a full-size box inside a zero-height
	 * `overflow: hidden` wrapper, 262×18pt of geometry that paints not one pixel.
	 * `ownInk` is whether it paints anything at all (text, a background, a border or
	 * an image), and `ariaHidden` is `aria-hidden="true"` on the node or any ancestor.
	 */
	clippedAway: boolean;
	/**
	 * An ancestor clips this node only off its containing-block chain, so the browser paints
	 * it: the shape a clip test walking every ancestor swallows (see U-08's escape branch).
	 */
	escapedClip: boolean;
	ariaHidden: boolean;
	/** Whether the node sits inside a MODAL DIALOG's subtree — its own element or any
	 *  ancestor carries `aria-modal="true"`. U-05 and U-08 read it: a modal dialog's
	 *  own surface is not content under a safe-area edge, and pairs that straddle the
	 *  dialog's boundary (or are separated by its opaque surface) are its layering,
	 *  not a collision. */
	inModalDialog: boolean;
	ownInk: boolean;
	interactive: boolean;
	disabled: boolean;
	isControl: boolean;
	childImages: number;
	/**
	 * The text of the node's nearest semantic ancestor container (`p, li, div, …`), or
	 * of its parent when it has none.
	 *
	 * One of U-03's two carrier scopes. It is the right scope for a node that belongs to
	 * no control, where the composition is the local container itself.
	 */
	containerText: string;
	/**
	 * The text of the nearest INTERACTIVE ancestor — the control the node belongs to —
	 * or `""` when there is none.
	 *
	 * U-03's other carrier scope, and the one a status indicator needs: the word that
	 * carries the status sits beside the dot in the same control, while the dot's own
	 * container is the empty 12 pt indicator slot it is drawn in. Both scopes are
	 * bounded *downwards* on purpose — see `hasWord` in `u03ColourOnlyStatus` for why the
	 * walk must not simply continue to the page.
	 */
	controlText: string;
	hasGlyph: boolean;
	semanticColour: string;
	semanticBackground: string;
	semanticBorder: string;
}

/**
 * The extracted state of one audited cell.
 *
 * The fields the probe always emits are required here rather than optional, and
 * that is deliberate: an optional field makes every use site invent a fallback
 * (`?? 0`) that can never run, and a check reading a *document width* of 0
 * because a field was absent would pass an overflow check it should fail.
 */
export interface AuditState {
	nodes: AuditNode[];
	platform: string;
	scale: string;
	url: string;
	viewport: { width: number; height: number; dpr: number };
	document: {
		scrollWidth: number;
		clientWidth: number;
		scrollHeight: number;
		clientHeight: number;
		bodyScrollWidth: number;
	};
	insets: { top: number; bottom: number; left: number; right: number };
	textScale: string;
	theme: string;
	canvas: { root: string; body: string };
	nodeCount: number;
	ax: AuditAxNode[];
	/** Injected by the audit runner rather than by the probe. */
	frame?: string | null;
	requestedUrl?: string;
	screen?: string;
	state?: string;
	device?: string;
	medianTextHeight?: number | null;
	insetsOverride?: { applied: boolean; reason: string | null };
	/**
	 * The readiness reading of the RE-DRIVEN page, injected by the audit runner from
	 * `READINESS_PROBE`. It is compared with the record's own reading so a page that is
	 * not the cell cannot contribute rows under the cell's name — see
	 * `lib/readiness.ts` `reDriveMismatch`.
	 */
	reading?: {
		path: string;
		testIds: readonly string[];
		visibleTestIds: readonly string[];
	} | null;
}

/** One node from the accessibility tree, as `flattenAxTree` reports it. */
export interface AuditAxNode {
	role?: string;
	name?: string;
	interactive?: boolean;
	ignored?: boolean;
	[key: string]: unknown;
}

/** What `runChecks` needs. `paletteMissingReason` is not optional in spirit: a
 *  missing palette must be visible in the report rather than silently skipped. */
export interface RunChecksOptions {
	floors: Floors;
	semantic: Set<string> | Record<string, string | null>;
	checks: string[];
	scaleIsLive: boolean;
	paletteMissingReason?: string | null;
}

export function runChecks(
	state: AuditState,
	{
		floors,
		semantic,
		checks,
		scaleIsLive,
		paletteMissingReason = null,
	}: RunChecksOptions,
): CheckRow[] {
	// Accept either the palette object or an already-built set, so a caller cannot
	// hand this a plain object and get a `TypeError` from inside a check.
	const semanticKeys =
		semantic instanceof Set ? semantic : semanticSet(semantic);
	const rows: CheckRow[] = [];
	for (const id of checks) {
		if (id === "U-04") {
			rows.push(...u04Report(state, { scaleIsLive }));
			continue;
		}
		if (id === "U-03") {
			rows.push(
				...u03ColourOnlyStatus(
					state,
					floors,
					semanticKeys,
					paletteMissingReason,
				),
			);
			continue;
		}
		const check = CHECKS[id];
		if (!check) {
			rows.push({
				check: id,
				verdict: "BLOCKED",
				measured: null,
				detail: "unknown check id",
			});
			continue;
		}
		const produced = check.run(
			state,
			floors,
			semanticKeys,
			paletteMissingReason,
		);
		rows.push(...(Array.isArray(produced) ? produced : [produced]));
	}
	return rows;
}
