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

import { composite, contrastRatio, parseCssColor } from "./color.mjs";
import { INTERACTIVE_AX_ROLES } from "./probe.mjs";

const round = (n, dp = 2) => (Number.isFinite(n) ? Number(n.toFixed(dp)) : null);

/**
 * A colour reduced to a comparable key. The probe reports computed colours as
 * `rgb(r, g, b)` while the tokens are `#rrggbb`, so comparing the raw strings
 * would miss every match — the semantic set must be normalised the same way the
 * measured values are.
 */
const colourKey = (value) => {
	const parsed = typeof value === "string" ? parseCssColor(value) : null;
	return parsed ? parsed.slice(0, 3).map((c) => Math.round(c * 255)).join(",") : null;
};

/** The semantic palette as a set of comparable colour keys. */
export function semanticSet(semantic) {
	const out = new Set();
	for (const value of Object.values(semantic ?? {})) {
		const key = colourKey(value);
		if (key) out.add(key);
	}
	return out;
}

/** Interactive-but-too-small is the exception the rubric names, so measure the gap. */
function nearestNeighbourGap(node, others) {
	let best = Infinity;
	for (const other of others) {
		if (other === node) continue;
		const gapX = Math.max(other.rect.x - (node.rect.x + node.rect.w), node.rect.x - (other.rect.x + other.rect.w));
		const gapY = Math.max(other.rect.y - (node.rect.y + node.rect.h), node.rect.y - (other.rect.y + other.rect.h));
		const gap = Math.max(gapX, gapY, 0);
		if (gap < best) best = gap;
	}
	return Number.isFinite(best) ? best : null;
}

/* ------------------------------------------------------------------ checks -- */

/** U-01 — every control a thumb aims at is at least 44 pt (48 dp on Android). */
function u01TouchTargets(state, floors) {
	const floor = state.platform === "android" ? floors.touch.ios + 4 : floors.touch.minimum;
	const slopFloor = Math.min(floors.touch.minimumVisualWithSlop ?? 24, 24);
	const controls = state.nodes.filter((n) => n.interactive && !n.disabled);
	if (controls.length === 0) {
		return [{ check: "U-01", verdict: "BLOCKED", measured: null, detail: "no interactive nodes in this frame" }];
	}
	const rows = [];
	for (const node of controls) {
		const size = Math.min(node.rect.w, node.rect.h);
		if (size >= floor) continue;
		const gap = nearestNeighbourGap(node, controls);
		// The rubric's exception is "a dense list *with* ≥ 8 pt spacing". A single
		// control with nothing to crowd satisfies the spacing half vacuously, so it
		// is recorded as an exception rather than failed for a gap that does not
		// exist — and the `n/a` is printed so the reader can see why.
		const gapOk = gap === null || gap >= 8;
		const denseException = size >= slopFloor && gapOk;
		rows.push({
			check: "U-01",
			verdict: denseException ? "EXCEPTION" : "FAIL",
			measured: `${size}pt (floor ${floor}${state.platform === "android" ? "dp" : "pt"}), gap ${gap === null ? "n/a (no other controls)" : `${gap}pt`}`,
			detail: denseException
				? `${node.tag} ${node.rect.w}x${node.rect.h} at ${node.rect.x},${node.rect.y} — below the floor with ${gap === null ? "no neighbouring control" : `${gap}pt of separation`}, recorded as the rubric's exception`
				: `${node.tag} ${node.rect.w}x${node.rect.h} at ${node.rect.x},${node.rect.y} — ${node.path}`,
		});
	}
	if (rows.length === 0) {
		const smallest = Math.min(...controls.map((n) => Math.min(n.rect.w, n.rect.h)));
		rows.push({ check: "U-01", verdict: "PASS", measured: `smallest ${smallest}pt vs floor ${floor}`, detail: `${controls.length} controls` });
	}
	return rows;
}

/** U-02 — body text ≥ 4.5:1 and large text ≥ 3:1, against its *effective* ground. */
function u02Contrast(state, floors) {
	const textNodes = state.nodes.filter((n) => n.ownText && n.ownText.length > 0);
	if (textNodes.length === 0) {
		return [{ check: "U-02", verdict: "BLOCKED", measured: null, detail: "no text nodes in this frame" }];
	}
	const rows = [];
	let worst = { ratio: Infinity, node: null };
	for (const node of textNodes) {
		const ground = parseCssColor(node.background);
		const fg = composite(parseCssColor(node.color), ground);
		const ratio = contrastRatio(fg, ground);
		if (ratio === null) continue;
		const large = node.fontSize >= 24 || (node.fontSize >= 18.66 && Number(node.fontWeight) >= 700);
		const needed = large ? floors.largeText : floors.bodyText;
		if (ratio < worst.ratio) worst = { ratio, node };
		if (ratio < needed) {
			rows.push({
				check: "U-02",
				verdict: "FAIL",
				measured: `${ratio}:1 (needs ${needed}:1, ${round(node.fontSize, 1)}px)`,
				detail: `${node.path} text ${JSON.stringify(node.ownText.slice(0, 40))} on ${node.background}`,
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
function u03ColourOnlyStatus(state, floors, semantic) {
	// A dot is not a colour-only status when a *word* sits beside it: "Failed" next
	// to a red dot is a word carrier, and flagging it would make this check noise.
	// So the node's nearest container's text is part of the question, and a glyph
	// in the label is accepted the same way the rubric's own wording allows.
	const hasWord = (node) => {
		const container = (node.containerText ?? "").trim();
		return /[A-Za-z]{3,}/.test(container);
	};
	const suspects = state.nodes.filter((n) => {
		if (n.interactive) return false;
		if (n.ownText || n.ariaLabel || n.childImages > 0) return false;
		const draws = [n.semanticBackground, n.semanticBorder, n.semanticColour];
		if (!draws.some((c) => c && semantic.has(colourKey(c)))) return false;
		return !hasWord(n);
	});
	if (suspects.length === 0) {
		return [{ check: "U-03", verdict: "PASS", measured: `0 colour-only status nodes of ${state.nodes.length}`, detail: "" }];
	}
	return suspects.slice(0, 8).map((node) => ({
		check: "U-03",
		verdict: "FAIL",
		measured: `colour ${node.semanticBackground || node.semanticBorder || node.semanticColour}, no word/glyph/name`,
		detail: `${node.path}`,
	}));
}

/** U-05 — nothing sits under a notch, a home indicator or an Android gesture bar. */
function u05SafeAreas(state) {
	const insets = state.insets;
	if (!insets || (insets.top === 0 && insets.bottom === 0 && insets.left === 0 && insets.right === 0)) {
		return [{ check: "U-05", verdict: "BLOCKED", measured: "insets 0", detail: "this device class declares no unsafe edges, so it cannot answer the question" }];
	}
	const vw = state.viewport.width;
	const vh = state.viewport.height;
	// A node only *counts* here if it draws something: text, a control, a
	// background or a border. An empty layout wrapper inside the band is not
	// content, and flagging it is how this check becomes noise nobody reads.
	const draws = (n) =>
		Boolean(n.ownText) || n.interactive || n.childImages > 0
		|| (n.ownBackground && n.ownBackground !== "rgba(0, 0, 0, 0)") || n.borderWidth > 0;
	const pinned = (n) => n.position === "fixed" || n.position === "sticky";
	const rows = [];
	const considered = state.nodes.filter(draws);
	for (const node of considered) {
		const { y, h, x, w } = node.rect;
		// TOP: anything drawing inside the notch/Dynamic Island band. Content below
		// the fold has y > inset.top, so this only fires at the top of the page —
		// which is exactly where a full-bleed header or banner lives.
		// A container that spans most of the viewport is not content drawn under the
		// notch: every app root sits at y=0 by construction, and flagging it buried
		// the real signal under 200 identical rows on the first run against a real
		// build. The children of such a container are what the rule is about, and
		// they are judged on their own.
		const containerLike = h >= vh * 0.6 && w >= vw * 0.9;
		if (insets.top > 0 && !containerLike && y < insets.top && y + h > 0 && y >= 0) {
			rows.push({
				check: "U-05",
				verdict: "FAIL",
				measured: `top edge ${y}pt is inside the ${insets.top}pt unsafe top inset`,
				detail: `${node.path}${node.ownText ? ` (${JSON.stringify(node.ownText.slice(0, 30))})` : ""}`,
			});
			continue;
		}
		// BOTTOM: only *pinned* content is judged here. On a scrolling page every
		// control passes through the bottom band on its way past, so judging unpinned
		// nodes would flag the whole document; the defect that matters is a composer
		// or action bar pinned flush to the home indicator.
		if (insets.bottom > 0 && pinned(node) && node.rect.bottom <= vh + 1) {
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
		if (insets.left > 0 && x < insets.left && x + w > 0) {
			rows.push({ check: "U-05", verdict: "FAIL", measured: `left edge ${x}pt inside the ${insets.left}pt inset`, detail: node.path });
			continue;
		}
		if (insets.right > 0 && vw - (x + w) < insets.right && x < vw) {
			rows.push({ check: "U-05", verdict: "FAIL", measured: `right edge is inside the ${insets.right}pt inset`, detail: node.path });
		}
	}
	if (rows.length === 0) {
		rows.push({
			check: "U-05",
			verdict: "PASS",
			measured: `top ${insets.top}pt and bottom ${insets.bottom}pt respected across ${considered.length} drawing nodes`,
			detail: "",
		});
	}
	return rows;
}

/** U-06 — nothing exceeds the viewport at 100 %, and only a scroll region at 200 %. */
function u06HorizontalOverflow(state) {
	const rows = [];
	const docOverflow = state.document.scrollWidth - state.document.clientWidth;
	if (docOverflow > 1) {
		rows.push({
			check: "U-06",
			verdict: "FAIL",
			measured: `document ${state.document.scrollWidth}px wide in a ${state.document.clientWidth}px viewport (+${docOverflow}px)`,
			detail: "",
		});
	}
	// A node wider than the viewport is only acceptable inside something that
	// scrolls horizontally *on purpose*; anything else pushes the layout.
	const offenders = state.nodes.filter((n) => n.rect.x + n.rect.w > state.viewport.width + 1 && n.rect.w > 8);
	for (const node of offenders.slice(0, 8)) {
		rows.push({
			check: "U-06",
			verdict: "FAIL",
			measured: `right edge ${node.rect.x + node.rect.w}px vs viewport ${state.viewport.width}px`,
			detail: node.path,
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
function u07ClippedText(state) {
	const rows = [];
	for (const node of state.nodes) {
		if (!node.ownText) continue;
		const clipsY = node.scrollHeight > node.clientHeight + 1 && /hidden|clip/.test(node.overflowY);
		const clipsX = node.scrollWidth > node.clientWidth + 1 && /hidden|clip/.test(node.overflowX);
		if (!clipsY && !clipsX) continue;
		// One line of visually truncated text is allowed only when the full value
		// is still reachable — either the element is a real control (so the label
		// is announced) or the ellipsis is the platform's own truncation idiom.
		const ellipsis = node.textOverflow === "ellipsis" && node.whiteSpace === "nowrap";
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
			measured: clipsY
				? `content ${node.scrollHeight}px in a ${node.clientHeight}px box (${node.overflowY})`
				: `content ${node.scrollWidth}px in a ${node.clientWidth}px box (${node.overflowX})`,
			detail: `${node.path} ${JSON.stringify(node.ownText.slice(0, 40))}`,
		});
	}
	if (rows.length === 0) {
		rows.push({ check: "U-07", verdict: "PASS", measured: `${state.nodes.filter((n) => n.ownText).length} text nodes, none clipped`, detail: "" });
	}
	return rows;
}

/** U-08 — meaningful boxes must not overlap. */
function u08Overlap(state) {
	// The rubric's rule is pairwise over *text and interactive* boxes, so a label
	// drawn under a control is caught as well as two controls on top of each
	// other. Ancestor/descendant pairs are excluded: a container overlaps its own
	// child by construction, and counting those would fail every nested layout.
	const meaningful = state.nodes.filter((n) => n.ownText || n.interactive);
	const rows = [];
	for (let i = 0; i < meaningful.length; i += 1) {
		for (let j = i + 1; j < meaningful.length; j += 1) {
			const a = meaningful[i];
			const b = meaningful[j];
			// Ancestry, not path prefixes: a container does not overlap its own
			// child, and a truncated CSS path cannot be trusted to say which is which.
			if (a.ancestors.includes(b.index) || b.ancestors.includes(a.index)) continue;
			// A pinned overlay over scrolling content is the intended design, not an
			// overlap: a composer rides above a transcript every frame. Its safe-area
			// clearance is U-05's question, so it is excluded here — except against
			// another pinned element, where two bars on top of each other really is a
			// defect.
			const pinnedA = a.position === "fixed" || a.position === "sticky";
			const pinnedB = b.position === "fixed" || b.position === "sticky";
			if (pinnedA !== pinnedB) continue;
			const overlapW = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
			const overlapH = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
			if (overlapW <= 1 || overlapH <= 1) continue;
			const area = overlapW * overlapH;
			const smaller = Math.min(a.rect.w * a.rect.h, b.rect.w * b.rect.h);
			if (area / smaller < 0.25) continue;
			rows.push({
				check: "U-08",
				verdict: "FAIL",
				measured: `${overlapW}x${overlapH}pt overlap (${round((area / smaller) * 100, 0)}% of the smaller box)`,
				detail: `${a.path} ∩ ${b.path}`,
			});
		}
	}
	if (rows.length === 0) {
		rows.push({ check: "U-08", verdict: "PASS", measured: `${meaningful.length} text/control boxes, no pair overlapping >25%`, detail: "" });
	}
	return rows.slice(0, 8);
}

/** U-09 — every interactive node in the accessibility tree carries a name. */
function u09AccessibleName(state) {
	const controls = (state.ax ?? []).filter((n) => INTERACTIVE_AX_ROLES.has(n.role));
	if (controls.length === 0) {
		return [{ check: "U-09", verdict: "BLOCKED", measured: "0 interactive AX nodes", detail: "no interactive nodes to name" }];
	}
	const unnamed = controls.filter((n) => !n.name || n.name.trim() === "");
	if (unnamed.length === 0) {
		return [{ check: "U-09", verdict: "PASS", measured: `${controls.length} interactive AX nodes, all named`, detail: "" }];
	}
	return unnamed.slice(0, 10).map((n) => ({
		check: "U-09",
		verdict: "FAIL",
		measured: `role=${n.role} has no accessible name`,
		detail: `AX node ${n.backendDOMNodeId ?? n.nodeId}`,
	}));
}

/** U-10 — the accessible name contains the visible label, so "tap approve" works. */
function u10LabelInName(state) {
	// The guard is on the *DOM's* interactive nodes, because the pairing below is
	// done there; a page whose AX tree is empty but whose DOM has controls would
	// otherwise be reported BLOCKED instead of checked.
	const controls = state.nodes.filter((n) => n.interactive);
	if (controls.length === 0) {
		return [{ check: "U-10", verdict: "BLOCKED", measured: "0 interactive nodes in this frame", detail: "" }];
	}
	const rows = [];
	// Pairing happens in the DOM, on the control's *own* label. The AX tree gives
	// names but not the node identity a visible label can be attached to, and
	// pairing every AX control with the first labelled element on the page is how
	// this check reported a mismatch on a page where no control was wrong.
	for (const control of controls) {
		const visible = (control.ownText || "").toLowerCase().replace(/\s+/g, " ").trim();
		if (visible.length < 2) continue;
		if (!control.hasAccessibleName) continue;
		const name = (control.accessibleName ?? "").toLowerCase().replace(/\s+/g, " ");
		if (name.includes(visible)) continue;
		rows.push({
			check: "U-10",
			verdict: "FAIL",
			measured: `accessible name ${JSON.stringify(name.slice(0, 40))} does not contain the visible label ${JSON.stringify(visible.slice(0, 40))}`,
			detail: control.path,
		});
	}
	if (rows.length === 0) {
		rows.push({ check: "U-10", verdict: "PASS", measured: "every labelled control's accessible name contains its visible label", detail: "" });
	}
	return rows.slice(0, 8);
}

/**
 * The check registry. `needs` declares what a check requires so the runner can
 * mark it BLOCKED rather than pass it when a state cannot answer.
 */
export const CHECKS = {
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
export function u04Report(state, { scaleIsLive }) {
	if (state.scale !== "200") {
		return [{ check: "U-04", verdict: "BLOCKED", measured: `scale ${state.scale}`, detail: "the large-text check reads the 200% frames only" }];
	}
	const clipped = u07ClippedText(state).filter((r) => r.verdict === "FAIL");
	if (!scaleIsLive) {
		return [{
			check: "U-04",
			verdict: "BLOCKED",
			measured: "the 200% frames are not distinguishable from the 100% frames",
			detail: "the text-scale dimension is inert in this build, so no large-text verdict can be drawn from it",
		}];
	}
	if (clipped.length === 0) {
		return [{ check: "U-04", verdict: "PASS", measured: "no clipped text at 200%", detail: "" }];
	}
	return clipped.map((row) => ({ ...row, check: "U-04" }));
}

/** Run every selected check over one extracted state. */
export function runChecks(state, { floors, semantic, checks, scaleIsLive }) {
	// Accept either the palette object or an already-built set, so a caller cannot
	// hand this a plain object and get a `TypeError` from inside a check.
	const semanticKeys = semantic instanceof Set ? semantic : semanticSet(semantic);
	const rows = [];
	for (const id of checks) {
		if (id === "U-04") {
			rows.push(...u04Report(state, { scaleIsLive }));
			continue;
		}
		const check = CHECKS[id];
		if (!check) {
			rows.push({ check: id, verdict: "BLOCKED", measured: null, detail: "unknown check id" });
			continue;
		}
		const produced = check.run(state, floors, semanticKeys);
		rows.push(...(Array.isArray(produced) ? produced : [produced]));
	}
	return rows;
}
