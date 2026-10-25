import type { AuditAxNode } from "./checks.ts";

/**
 * The in-page extraction the audit runs over each captured state.
 *
 * One `Runtime.evaluate` returns everything the geometry, colour, clipping,
 * overflow and safe-area checks need, and one `Accessibility.getFullAXTree`
 * returns the roles and names for the label checks. Why one evaluate rather
 * than a CDP call per node: at ~500 nodes a frame and a few hundred frames, a
 * call per node is thousands of round trips, and a probe is also *reproducible*
 * in a way that a sequence of live DOM queries is not.
 *
 * The probe deliberately reports *measurements*, never verdicts. Deciding what a
 * number means belongs in `checks.ts`, where the floors live and where a
 * reviewer can read the rule; a probe that decides is a probe nobody can audit.
 */

/** Shared by canonical U-08 extraction and diagnostic telemetry. Text belongs
 * inside the owner's overflow viewport; the ancestor helper intentionally starts
 * above the owner because it also serves element border/layout boxes. */
/** Fragments are an optimization only after proving there is no other paint.
 * Generated boxes have no AuditNode; background-only children are not necessarily
 * meaningful U-08 nodes either. Do not certify arbitrary subtrees from a media
 * selector: any element descendant stays conservative, including unproven paint.
 * Unreadable generated styles also return no decision rather than lose a real
 * collision. A generated box exists whenever `content` is not `none`/`normal` —
 * even the empty string — and that box can paint a background and a border, so it
 * keeps the node conservative.
 *
 * WHY THIS IS A LIST AND NOT A CHAIN OF `&&`: when the four session nodes came
 * back certified-conservative with no fragment measurement, the verification
 * could only say "missing measurement" — the reason a node was NOT pure lived
 * nowhere. The fix for that is a recorded reason, never a looser rule: two review
 * rounds each caught a real false negative from a permissive gate (a
 * pseudo-element's paint, a background-only child element), and the conditions
 * below are what keep those excluded. So the conditions are declared ONCE, each
 * with a name, an expected value and an observation, and BOTH consumers read
 * that one list: `pure` is `every(ok)` and `blockedBy` is the first probe that
 * said no, with what it observed and what it expected. A second implementation
 * of the rule would drift from the gate, and the drift would be invisible until
 * a node was certified from a condition the report never showed. */
export const PURE_OWN_TEXT_VERDICT_SOURCE = String.raw`(() => {
 // Built once per page: the probes close over the shared context object, never
 // over one node, so a few hundred frames do not rebuild the rule per node.
 const probes = [
  ['own-text', 'non-empty', (c) => c.ownText.length, (v) => v > 0],
  ['interactive', false, (c) => Boolean(c.interactiveNode), (v) => v === false],
  ['display', 'set', (c) => c.display, (v) => v.length > 0],
  ['display-not-list-item', 'not list-item', (c) => c.display, (v) => !v.includes('list-item')],
  ['content', 'none|normal', (c) => c.s.content, (v) => ['none','normal'].includes(v)],
  ['background-color', 'rgba(0, 0, 0, 0)|transparent', (c) => c.s.backgroundColor, (v) => ['rgba(0, 0, 0, 0)','transparent'].includes(v)],
 ];
 for (const condition of [
  ['background-image', 'none', (c) => c.s.backgroundImage, (v) => v === 'none'],
  ['border-image-source', 'none', (c) => c.s.borderImageSource, (v) => v === 'none'],
  ['box-shadow', 'none', (c) => c.s.boxShadow, (v) => v === 'none'],
  ['text-shadow', 'none', (c) => c.s.textShadow, (v) => v === 'none'],
  ['text-decoration-line', 'none', (c) => c.s.textDecorationLine, (v) => v === 'none'],
  ['filter', 'none', (c) => c.s.filter, (v) => v === 'none'],
  ['backdrop-filter', 'none', (c) => c.s.backdropFilter, (v) => v === 'none'],
  ['mask-image', 'none', (c) => c.s.maskImage, (v) => v === 'none'],
  ['text-emphasis-style', 'none', (c) => c.s.textEmphasisStyle, (v) => v === 'none'],
  ['border-top-width', 0, (c) => c.px(c.s.borderTopWidth), (v) => v === 0],
  ['border-right-width', 0, (c) => c.px(c.s.borderRightWidth), (v) => v === 0],
  ['border-bottom-width', 0, (c) => c.px(c.s.borderBottomWidth), (v) => v === 0],
  ['border-left-width', 0, (c) => c.px(c.s.borderLeftWidth), (v) => v === 0],
 ]) probes.push(condition);
 probes.push(
  ['outline-width', 0, (c) => c.px(c.s.outlineWidth), (v) => v === 0],
  ['column-rule-width', 0, (c) => c.px(c.s.columnRuleWidth), (v) => v === 0],
  ['-webkit-text-stroke-width', 0, (c) => c.s.webkitTextStrokeWidth, (v, c) => !v || c.px(v) === 0],
  ['-webkit-box-reflect', 'none', (c) => c.s.webkitBoxReflect, (v) => !v || v === 'none'],
  ['svg-ancestor', false, (c) => Boolean(c.el.closest('svg')), (v) => v === false],
  ['replaced-content', false, (c) => Boolean(c.el.matches('img,canvas,video,audio,iframe,object,embed')), (v) => v === false],
  ['element-descendants', 0, (c) => c.el.querySelectorAll('*').length, (v) => v === 0],
 );
 for (const pseudo of ['::before','::after','::marker'])
  probes.push([pseudo + '-content', 'none|normal', (c) => getComputedStyle(c.el, pseudo).content,
   (v) => typeof v === 'string' && ['none','normal'].includes(v), 'generated']);
 return (el, style, ownText, interactiveNode, px, collect) => {
  const rows = [];
  // Generated and descendant reads can throw on an element the browser will not
  // resolve a pseudo for. That is a lack of a paint proof, not observed empty
  // text, so it is recorded as 'unreadable' and the node stays conservative.
  const attempt = (read) => {
   try { return {value: read(), read: true}; } catch (error) { return {value: 'unreadable', read: false}; }
  };
  // Artifact bytes are bounded: a value is truncated, never a condition name, so
  // every row stays identifiable in the failure receipt.
  const compact = (value) => value === undefined ? null
   : typeof value === 'string' && value.length > 48 ? value.slice(0, 45) + '...' : value;
  const s = style || {};
  const context = {el: el, s: s, ownText: ownText, interactiveNode: interactiveNode, px: px,
   display: typeof s.display === 'string' ? s.display : ''};
  for (const probe of probes) {
   const read = attempt(() => probe[2](context));
   const verdict = read.read ? attempt(() => probe[3](read.value, context)) : {value: false};
   const ok = read.read && verdict.value === true;
   rows.push({name: probe[0], expected: probe[1], observed: compact(read.value), ok: ok});
   // The hot path asks only "is it pure": once a probe fails, later probes cannot
   // change that answer, and the two expensive ones (descendant census, generated
   // styles) are then skipped exactly as the old chain skipped them. Generated
   // styles are the exception: they were always read as one group (all three
   // pseudos, then a conjunction), so the group is finished even when its first
   // member fails — a classifier that stops reading is a different classifier, and
   // the pseudo-read assertions pin that. A recorded verdict asks for the whole
   // map, and only own-text candidates do that — a handful per frame, so the
   // census is affordable there.
   if (!ok && !collect && probe[4] !== 'generated') break;
  }
  const blocked = rows.find((row) => row.ok === false) || null;
  return {pure: rows.every((row) => row.ok), blockedBy: blocked ? blocked.name : null,
   expected: blocked ? blocked.expected : null, observed: blocked ? blocked.observed : null,
   conditions: rows};
 };
})()`;
/** The boolean the canonical probe and the policy have always consumed. It is the
 * SAME evaluator with the whole-map recording off, never a parallel rule. */
export const PURE_OWN_TEXT_SOURCE = String.raw`(el,style,ownText,interactiveNode,px) => (${PURE_OWN_TEXT_VERDICT_SOURCE})(el,style,ownText,interactiveNode,px,false).pure`;

export const OWN_TEXT_GEOMETRY_SOURCE = String.raw`(el,clip) => {
 const box=r=>({x:r.left,y:r.top,w:r.right-r.left,h:r.bottom-r.top});
 const style=getComputedStyle(el),self=el.getBoundingClientRect();
 const applies=style.display!=='inline'&&style.display!=='contents';
 const selfX=applies&&style.overflowX!=='visible',selfY=applies&&style.overflowY!=='visible';
 const fragments=[];
 for(const text of el.childNodes){
  if(text.nodeType!==3||!text.textContent.trim())continue;
  const range=document.createRange();range.selectNodeContents(text);
  for(const r of range.getClientRects()){
   const owned={left:selfX?Math.max(r.left,self.left):r.left,top:selfY?Math.max(r.top,self.top):r.top,right:selfX?Math.min(r.right,self.right):r.right,bottom:selfY?Math.min(r.bottom,self.bottom):r.bottom};
   const clipped=owned.right>owned.left&&owned.bottom>owned.top?clip(el,owned):null;
   fragments.push({rect:box(r),clipped:clipped?box(clipped):null});
  }
 }
 return {textFragments:fragments,selfClipping:{display:style.display,overflowX:style.overflowX,overflowY:style.overflowY,textOverflow:style.textOverflow,appliesX:selfX,appliesY:selfY,rect:box(self)}};
}`;

export const U08_GEOMETRY_SOURCE = String.raw`(indices, all, nodes, clip) => {
 const box = r => ({x:r.left,y:r.top,w:r.right-r.left,h:r.bottom-r.top});
 return indices.map(index => {
  const el = all[index], node = nodes.find(n => n.index === index);
  if (!el || !node) throw new Error('Diagnostic node missing');
  const {textFragments:fragments,selfClipping}=(${OWN_TEXT_GEOMETRY_SOURCE})(el,clip);
  const control = el.closest('button,[role="button"]');
  return {index, ownText:node.ownText, path:node.path, rect:node.rect, visibleRect:node.visibleRect, ancestors:node.ancestors,
   ownInk:node.ownInk,ariaHidden:node.ariaHidden,interactive:node.interactive,clippedAway:node.clippedAway,escapedClip:node.escapedClip,
   pressable:control ? {index:all.indexOf(control),testId:control.getAttribute('data-testid'),label:control.getAttribute('aria-label'),rect:box(control.getBoundingClientRect())} : null,
   selfClipping,
   font:getComputedStyle(el).font, lineHeight:getComputedStyle(el).lineHeight, position:getComputedStyle(el).position,
   clientRects:[...el.getClientRects()].map(r => ({rect:box(r),clipped:(c => c ? box(c) : null)(clip(el,r))})), textFragments:fragments,
   clippingAncestors:node.ancestors.map(i => all[i]).filter(a => a && /(hidden|clip|auto|scroll)/.test(getComputedStyle(a).overflowX+' '+getComputedStyle(a).overflowY)).map(a => ({index:all.indexOf(a),tag:a.tagName,testId:a.getAttribute('data-testid'),rect:box(a.getBoundingClientRect()),overflow:getComputedStyle(a).overflow}))};
 });
}`;

const probeWithGeometry = (extra = "") => `
(() => {
  const px = (value) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  // U-38's leak needle, at the IIFE's top level because BOTH sweeps read it
  // (the node loop's escapeInText and the table cells'). The 200-character
  // slices in the record cannot see an escape deeper in a long paragraph
  // (review round 1, nit). Built from a char code because this source is
  // embedded in a TS template where a literal backslash would be re-escaped.
  const escapeNeedle = String.fromCharCode(92) + '|';
  const isVisible = (el, style, rect) => {
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (px(style.opacity) === 0) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  };
  // Is the node RENDERED, which is a different question from "is it laid out"?
  // Its own style can say visible while an ANCESTOR clips it away: a zero-height
  // 'overflow: hidden' wrapper leaves its child a full-size getBoundingClientRect
  // and not one painted pixel, and the per-node test above cannot see that because
  // the clipping is not on the node.
  //
  // WHICH ANCESTORS COUNT is the part that has to be right, and walking all of them
  // is wrong: CSS clips the descendants that are laid out INSIDE the clipper, so an
  // ancestor clips this node only if it sits on the node's containing-block chain. A
  // 'position: fixed' node, or an 'absolute' node whose containing block is ABOVE the
  // clipper (a static zero-height wrapper is not one), is painted by the browser —
  // and calling it clipped-away would hide exactly the pinned-over-content defect
  // this rule exists to report: a toast, a sheet, a floating composer.
  const establishesContainingBlock = (s) =>
    (s.transform && s.transform !== 'none')
    || (s.filter && s.filter !== 'none')
    || (s.backdropFilter && s.backdropFilter !== 'none')
    || (s.perspective && s.perspective !== 'none')
    || (s.willChange && /transform|filter|perspective/.test(s.willChange))
    || (s.contain && /paint|layout|strict|content/.test(s.contain));
  // The element this node is positioned and laid out against, or null for the
  // viewport. Walking from here upward is the chain, and it is what the clip test
  // follows — every element on it can clip the node; nothing above it can.
  const containingBlock = (el) => {
    const style = getComputedStyle(el);
    if (style.position === 'fixed') {
      let node = el.parentElement;
      while (node && node.nodeType === 1) {
        if (establishesContainingBlock(getComputedStyle(node))) return node;
        node = node.parentElement;
      }
      return null;
    }
    if (style.position === 'absolute') {
      let node = el.parentElement;
      while (node && node.nodeType === 1) {
        const s = getComputedStyle(node);
        if (s.position !== 'static' || establishesContainingBlock(s)) return node;
        node = node.parentElement;
      }
      return null;
    }
    // Static, relative and sticky content is laid out in its parent, which is
    // therefore on the chain; the walk continues from there.
    return el.parentElement;
  };
  // THE PAINTED REGION of a node: its box intersected with every clipping ancestor on
  // its containing-block chain, or the word null when that intersection is empty
  // (nothing of it is painted at all).
  //
  // Both facts come from ONE walk on purpose. "Is any of it painted" and "which part is
  // painted" are the same question asked to different precision, and two walks that
  // answer them are two walks that can disagree — which is precisely the defect this
  // function exists to close: a node clipped only PART of the way keeps its FULL layout
  // box, so a check pairing layout boxes reports an overlap between a node and a
  // sibling sitting outside the clipper that no user can see.
  const clipIntersection = (el, rect) => {
    let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    let node = containingBlock(el);
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node);
      // 'overflow: visible' on both axes paints outside the box; anything else
      // clips (auto/scroll clip too, and a child scrolled out of its container is
      // no more visible than a hidden one).
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const r = node.getBoundingClientRect();
        left = Math.max(left, r.left);
        top = Math.max(top, r.top);
        right = Math.min(right, r.right);
        bottom = Math.min(bottom, r.bottom);
        if (right <= left || bottom <= top) return null;
      }
      node = containingBlock(node);
    }
    return { left, top, right, bottom };
  };
  // Whether the node is laid out inside an ancestor that scrolls horizontally ON
  // PURPOSE. No per-node fact can answer this: the element that scrolls is the
  // ANCESTOR (a code block's ScrollView, which react-native-web renders with
  // overflow-x: auto), while the node that overflows the viewport is the text inside
  // it. The rubric allows the overflow there and nowhere else, so the answer has to
  // come from the chain.
  const ownTextGeometry = ${OWN_TEXT_GEOMETRY_SOURCE};
  // The explainable evaluator, so the record can say WHY a text node kept the
  // conservative envelope. One list backs both this and the policy's boolean;
  // see PURE_OWN_TEXT_VERDICT_SOURCE for why that matters.
  const pureOwnTextView = ${PURE_OWN_TEXT_VERDICT_SOURCE};
  const insideHorizontalScroller = (el) => {
    let node = el.parentElement;
    while (node && node.nodeType === 1) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
      node = node.parentElement;
    }
    return false;
  };
  // The same walk as it stood BEFORE the chain, kept for one reason: to NAME the nodes
  // the two walks disagree about. A node that only the every-ancestor walk calls clipped
  // has a clipping ancestor that is NOT on its chain, so the browser paints it — the
  // shape (a pinned node escaping a clipped container) this rule's costliest false
  // negative lives in, and U-08 says so out loud in the row. It never filters anything:
  // 'clippedAway' alone decides that.
  const clippedByAnyAncestor = (el, rect) => {
    let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    let node = el.parentElement;
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const r = node.getBoundingClientRect();
        left = Math.max(left, r.left);
        top = Math.max(top, r.top);
        right = Math.min(right, r.right);
        bottom = Math.min(bottom, r.bottom);
        if (right <= left || bottom <= top) return true;
      }
      node = node.parentElement;
    }
    return false;
  };
  // 'aria-hidden' is inherited, so it is answered over the chain and not per node.
  const ariaHiddenIn = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.getAttribute('aria-hidden') === 'true') return true;
      node = node.parentElement;
    }
    return false;
  };
  // Whether the node sits inside a MODAL DIALOG's subtree: the node itself or any
  // ancestor carries aria-modal="true", the standard declaration that everything
  // outside the dialog is inert while it is open. react-native-web paints its
  // Modal this way (the conversations drawer), and the accessibility tree reads
  // the same attribute. Reported as a measurement — U-05 and U-08 are where it
  // becomes a rule.
  const inModalDialogIn = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.getAttribute('aria-modal') === 'true') return true;
      node = node.parentElement;
    }
    return false;
  };
  // The effective background: the nearest ancestor with a non-transparent
  // background colour, composited down to opaque. A colour on a parent *is* the
  // text's ground, which is exactly the case a per-element check misses.
  const effectiveBackground = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  // Interactive means interactive. A bare [role] selector matched every React
  // Native Web element with a role - including role="heading" on a Text - so
  // the touch-target check measured section headings and reported 34pt failures
  // for text that is not a control at all.
  const INTERACTIVE_TAGS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"]';
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'switch', 'slider', 'tab', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'combobox', 'listbox', 'searchbox', 'textbox', 'spinbutton', 'togglebutton',
  ]);
  const isInteractive = (el) =>
    el.matches(INTERACTIVE_TAGS)
    || INTERACTIVE_ROLES.has((el.getAttribute('role') || '').toLowerCase())
    || (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1');
  // The text of the CONTROL this node belongs to, which is the scope U-03's carrier
  // lookup needs: a status dot's word sits beside it in the same control (a 12pt
  // indicator slot has no text of its own), so the dot's nearest semantic container is
  // too near, and the whole ancestor chain is too far — walking to the page would let a
  // section heading stand in for a carrier and the rule could never fire on a real
  // screen. The nearest INTERACTIVE ancestor is the composition the status belongs to,
  // and it is a fact about the DOM, so it is measured here rather than re-walked in
  // checks.ts. Empty string when the node belongs to no control, which is what keeps a
  // bare dot in a paragraph reportable.
  const controlText = (el) => {
    let node = el.parentElement;
    while (node && node.nodeType === 1) {
      if (isInteractive(node)) return (node.textContent || '').trim().slice(0, 200);
      node = node.parentElement;
    }
    return '';
  };
  const labelFor = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const target = document.getElementById(labelled);
      if (target && target.textContent) return target.textContent.trim();
    }
    const title = el.getAttribute('title');
    if (title) return title.trim();
    const alt = el.querySelector('img[alt]');
    if (alt) return (alt.getAttribute('alt') || '').trim();
    return (el.textContent || '').trim();
  };

  const nodes = [];
  const all = [...document.querySelectorAll('body *')];
  // Real ancestry, by index. Comparing CSS-path strings for "is one of these the
  // other's ancestor" only works while both paths still share their leading
  // segments, and the path is truncated to six levels — so a nested control read
  // as overlapping its own container. An index chain cannot be truncated.
  const indexOfElement = new Map(all.map((el, i) => [el, i]));
  for (let index = 0; index < all.length; index += 1) {
    const el = all[index];
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, style, rect)) continue;
    // Computed once, so the two facts derived from it (is anything painted, and which
    // box that painted part occupies) cannot drift apart.
    const painted = clipIntersection(el, rect);
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    const interactiveNode = isInteractive(el);
    // Pure own text uses line fragments, never the envelope spanning wrapped
    // lines. Controls and mixed/non-text paint retain the conservative old box:
    // shrinking those to text would erase borders, backgrounds and hit areas.
    // Recording costs the whole-map census only on own-text candidates: those
    // are the nodes whose conservative verdict used to be unexplained, and they
    // are few per frame, so the descendant census is affordable on them alone.
    const purity = pureOwnTextView(el,style,ownText,interactiveNode,px,ownText.length > 0);
    const pureOwnText = purity.pure;
    const u08PaintFragments = pureOwnText ? ownTextGeometry(el,clipIntersection).textFragments.flatMap(f => f.clipped ? [f.clipped] : []) : undefined;
    nodes.push({
      index,
      u08PaintFragments,
      // Recorded, never interpreted: undefined means "not asked" (the node has no
      // own text), while an object is the gate's actual reason for keeping the
      // envelope. Serialized diagnostics stay bounded by per-row truncation and
      // by covering candidate text nodes only.
      u08PaintExclusion: !pureOwnText && ownText.length > 0 ? {blockedBy: purity.blockedBy, expected: purity.expected, observed: purity.observed, conditions: purity.conditions} : undefined,
      tag: el.tagName.toLowerCase(),
      path: (() => {
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && parts.length < 6) {
          const id = node.id ? '#' + node.id : '';
          const cls = node.classList.length ? '.' + [...node.classList].slice(0, 2).join('.') : '';
          parts.unshift(node.tagName.toLowerCase() + id + cls);
          node = node.parentElement;
        }
        return parts.join('>');
      })(),
      index,
      ancestors: (() => {
        const chain = [];
        let node = el.parentElement;
        while (node) {
          const i = indexOfElement.get(node);
          if (i !== undefined) chain.push(i);
          node = node.parentElement;
        }
        return chain;
      })(),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      hasAccessibleName: labelFor(el).length > 0,
      accessibleName: labelFor(el),
      visibleLabel: ownText,
      text: (el.textContent || '').trim().slice(0, 200),
      ownText: ownText.slice(0, 200),
      escapeInText: ownText.includes(escapeNeedle),
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height),
        right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      },
      fontSize: px(style.fontSize),
      fontWeight: style.fontWeight,
      color: style.color,
      background: effectiveBackground(el),
      ownBackground: style.backgroundColor,
      position: style.position,
      display: style.display,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      borderWidth: px(style.borderTopWidth),
      padding: { top: px(style.paddingTop), bottom: px(style.paddingBottom), left: px(style.paddingLeft), right: px(style.paddingRight) },
      // The spacing vocabulary U-42 scores, and the two scrolling facts U-40 reads.
      // Margin and the gaps are computed values like padding, so a class that
      // stops compiling shows up as a measurement, not as a missing field. RowGap
      // and columnGap read from the resolved computed style: React Native Web
      // writes gap as both row-gap and column-gap, and a flex container with no
      // gap computes "normal", which the px() helper folds to 0.
      margin: { top: px(style.marginTop), bottom: px(style.marginBottom), left: px(style.marginLeft), right: px(style.marginRight) },
      // WHICH MARGINS ARE AUTO, read through Typed OM because the string form
      // cannot say: Chrome's getComputedStyle resolves margin-left: auto to its
      // USED pixels (measured: 192px on a 200px flex row, exactly like a plain
      // margin), while computedStyleMap().get('margin-left') keeps the keyword.
      // U-42 skips these sides: an auto margin is layout — where the content
      // happened to land — not a spacing decision a scale can hold.
      marginAuto: (() => {
        const map = el.computedStyleMap ? el.computedStyleMap() : null;
        const side = (name) => {
          try {
            const value = map ? map.get(name) : null;
            return value ? value.toString() === 'auto' : false;
          } catch {
            return false;
          }
        };
        return { top: side('margin-top'), right: side('margin-right'), bottom: side('margin-bottom'), left: side('margin-left') };
      })(),
      rowGap: px(style.rowGap),
      columnGap: px(style.columnGap),
      scrollLeft: el.scrollLeft || 0,
      // The machine-readable name the table checks anchor on (the md-table family
      // of the design pass section 4.3). Null when the node carries none.
      testId: el.getAttribute('data-testid'),
      interactive: interactiveNode,
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      isControl: /^(input|select|textarea)$/.test(el.tagName.toLowerCase()),
      childImages: el.querySelectorAll('img,svg').length,
      // The facts a box does not tell you: WHERE the node is painted (its box
      // intersected with every clipping ancestor on its chain), whether an ancestor
      // clips it to nothing at all, whether an ancestor clips it ONLY off its
      // containing-block chain (so the browser paints it anyway), and whether it draws
      // ink of its own at all. Reported as measurements — U-05 and U-08 are where they
      // become rules.
      visibleRect:
        painted === null
          ? null
          : {
              x: Math.round(painted.left),
              y: Math.round(painted.top),
              w: Math.round(painted.right - painted.left),
              h: Math.round(painted.bottom - painted.top),
              right: Math.round(painted.right),
              bottom: Math.round(painted.bottom),
            },
      clippedAway: painted === null,
      escapedClip: clippedByAnyAncestor(el, rect) && painted !== null,
      scrollsX: insideHorizontalScroller(el),
      ariaHidden: ariaHiddenIn(el),
      inModalDialog: inModalDialogIn(el),
      ownInk:
        ownText.length > 0
        || (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent')
        || px(style.borderTopWidth) > 0
        || el.querySelectorAll('img,svg').length > 0,
      // The nearest ANCESTOR container's full text, so a status *word* carried beside
      // the node counts as a carrier and a bare dot does not become one.
      //
      // The walk starts at the PARENT, never at the node: closest() matches the
      // element itself when it is a div or a p, and the node's own subtree is not "a
      // word beside it" — reading it as one exempted exactly the nodes this check
      // exists to find.
      containerText: ((el.parentElement && el.parentElement.closest('p, li, div, section, header, footer, td, button') || el.parentElement || el).textContent || '').trim().slice(0, 200),
      // The same question asked at the scope a carrier actually lives at: the control
      // the node belongs to, or nothing when it belongs to no control. See controlText.
      controlText: controlText(el),
      hasGlyph: /[\\u2190-\\u2BFF\\u2000-\\u206F!?]|\\b(error|failed|pending|waiting|done|running|warning)\\b/i.test(el.textContent || ''),
      // A colour-only status: draws with a semantic colour but carries no word,
      // glyph or shape and no accessible name — the thing U-03 exists to catch.
      semanticColour: style.color,
      semanticBackground: style.backgroundColor,
      semanticBorder: style.borderTopColor,
    });
  }
  // ---- the markdown tables (U-38/U-39/U-40) -----------------------------
  //
  // A word's box is not a node's box: a token that wrapped occupies TWO line
  // rects inside one text node, and the only way to ask which is a Range per
  // whitespace run. The walk is per CELL, not per node, so a table with fifty
  // cells costs fifty short walks rather than one walk of every text node in
  // the document.
  const measureBrokenRuns = (el) => {
    const broken = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent || '';
      const runs = /\\S+/g;
      let match;
      while ((match = runs.exec(text))) {
        const range = document.createRange();
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + match[0].length);
        const rects = range.getClientRects();
        const tops = new Set();
        for (let r = 0; r < rects.length; r += 1) {
          const rect = rects[r];
          if (rect.width <= 0 && rect.height <= 0) continue;
          tops.add(Math.round(rect.top));
        }
        if (tops.size > 1) broken.push({ token: match[0].slice(0, 48), length: match[0].length });
      }
    }
    return broken;
  };
  // Whether a node's box reaches past the content rail it sits in: the nearest
  // ancestor that declares a right padding is the rail's owner, and the scroll
  // viewport "bleeds" when it runs past that ancestor's content box (U-40's
  // criterion, and the half that makes a cut edge a cue rather than an accident).
  const bleedsPastRail = (el) => {
    const box = el.getBoundingClientRect();
    let node = el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      const paddingRight = px(style.paddingRight);
      if (paddingRight > 0) {
        const rect = node.getBoundingClientRect();
        const borderRight = px(style.borderRightWidth);
        return box.right > rect.right - paddingRight - borderRight + 0.5;
      }
      node = node.parentElement;
    }
    return false;
  };
  const tables = [];
  for (const wrapper of document.querySelectorAll('[data-testid="md-table"]')) {
    // A wrapper the page does not paint is not a table the reader sees. Without
    // this, the canary's OWN mode gating (a .bad fixture hidden on /clean, a
    // .good one hidden on /defects) makes every hidden fixture fire on the
    // other page, and a rule that reports tables nobody can see lies about both.
    if (wrapper.getClientRects().length === 0) continue;
    const wrapperIndex = indexOfElement.get(wrapper);
    if (wrapperIndex === undefined) continue;
    const cells = [];
    for (const cell of wrapper.querySelectorAll('[data-testid="md-table-cell"]')) {
      const cellIndex = indexOfElement.get(cell);
      cells.push({
        index: cellIndex === undefined ? -1 : cellIndex,
        text: (cell.textContent || '').trim().slice(0, 200),
        escapeInText: (cell.textContent || '').includes(escapeNeedle),
        broken: measureBrokenRuns(cell),
      });
    }
    const scrollEl = wrapper.querySelector('[data-testid="md-table-scroll"]');
    let scroll = null;
    if (scrollEl) {
      const scrollIndex = indexOfElement.get(scrollEl);
      scroll = {
        index: scrollIndex === undefined ? -1 : scrollIndex,
        scrollWidth: scrollEl.scrollWidth,
        clientWidth: scrollEl.clientWidth,
        scrollLeft: scrollEl.scrollLeft || 0,
        overflow: scrollEl.scrollWidth > scrollEl.clientWidth + 1,
        bleeds: bleedsPastRail(scrollEl),
        cues: wrapper.querySelectorAll('[data-testid="md-table-scroll-cue"]').length,
      };
    }
    tables.push({
      index: wrapperIndex,
      headRows: wrapper.querySelectorAll('[data-testid="md-table-head"]').length,
      bodyRows: wrapper.querySelectorAll('[data-testid="md-table-row"]').length,
      cells,
      scroll,
    });
  }
  // ---- the disclosure rows (U-41) ---------------------------------------
  //
  // The row is found by its SHAPE — an interactive element carrying a caret
  // glyph — because the check it feeds reads geometry, not a class name. Each
  // text line inside the row is a Range's client rect grouped by top (one line
  // may hold several rects: the label, its count, the caret's neighbours), and
  // the caret is measured separately so its box cannot pollute a line's left
  // edge.
  const findCaret = (el) => {
    const candidates = [el].concat([...el.querySelectorAll('*')]);
    for (const candidate of candidates) {
      if (!/^[\\u25B8\\u25BE]$/.test((candidate.textContent || '').trim())) continue;
      // The DEEPEST match: a wrapper whose only text is the glyph reports the
      // same string, and its box is the whole row — which would make the caret
      // measurement a measurement of everything.
      if (candidate.querySelector('*') === null) return candidate;
    }
    return null;
  };
  const summaries = [];
  for (const el of all) {
    if (!isInteractive(el)) continue;
    // The tables rule's own visibility skip, for the same reason: a row the
    // page does not paint must not be judged on rails and carets it has not.
    if (el.getClientRects().length === 0) continue;
    const caret = findCaret(el);
    if (caret === null) continue;
    const fragments = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (caret.contains(textNode)) continue;
      if ((textNode.textContent || '').trim().length === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = range.getClientRects();
      for (let r = 0; r < rects.length; r += 1) {
        const rect = rects[r];
        if (rect.width <= 0 && rect.height <= 0) continue;
        fragments.push({ left: rect.left, top: rect.top, bottom: rect.bottom });
      }
    }
    const lines = [];
    for (const fragment of fragments) {
      const line = lines.find((l) => Math.abs(l.top - fragment.top) < 6);
      if (line) {
        line.left = Math.min(line.left, fragment.left);
        line.bottom = Math.max(line.bottom, fragment.bottom);
      } else {
        lines.push({ left: fragment.left, top: fragment.top, bottom: fragment.bottom });
      }
    }
    lines.sort((a, b) => a.top - b.top);
    const caretRect = caret.getBoundingClientRect();
    const rowRect = el.getBoundingClientRect();
    summaries.push({
      index: indexOfElement.get(el) ?? -1,
      rowLeft: rowRect.left,
      lines,
      caret: { left: caretRect.left, top: caretRect.top, bottom: caretRect.bottom },
    });
  }
  return {
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
    },
    insets: (() => {
      const style = getComputedStyle(document.documentElement);
      return {
        top: px(style.getPropertyValue('--lo-inset-top')),
        bottom: px(style.getPropertyValue('--lo-inset-bottom')),
        left: px(style.getPropertyValue('--lo-inset-left')),
        right: px(style.getPropertyValue('--lo-inset-right')),
      };
    })(),
    textScale: getComputedStyle(document.documentElement).getPropertyValue('--lo-text-scale').trim(),
    theme: document.documentElement.dataset.loTheme || '',
    canvas: (() => {
      const root = document.querySelector('#root') || document.body;
      return { root: getComputedStyle(root).backgroundColor, body: getComputedStyle(document.body).backgroundColor };
    })(),
    u08GeometryVersion: 1,
    nodeCount: nodes.length,
    nodes,
    tables,
    summaries,${extra}
  };
})();
`;

/** This corrected extraction intentionally differs from the historical instrument.
 * The historical hash guard must refuse it. Diagnostics reuse its
 * private containing-block-aware clipIntersection, never a second clip model. */
export const EXTRACT_PROBE = probeWithGeometry();
export function u08GeometryProbe(indices: readonly number[]): string {
	return probeWithGeometry(`
    u08Geometry: (${U08_GEOMETRY_SOURCE})(${JSON.stringify(indices)}, all, nodes, clipIntersection),`);
}

/** Interactive roles, per the rubric's U-09: a control with no name is a defect. */
export const INTERACTIVE_AX_ROLES = new Set([
	"button",
	"link",
	"textbox",
	"searchbox",
	"checkbox",
	"radio",
	"switch",
	"slider",
	"combobox",
	"listbox",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"tab",
	"option",
	"spinbutton",
]);

/**
 * Flatten `Accessibility.getFullAXTree` into the small shape the checks use.
 * Ignored nodes are dropped because Chrome marks decorative content
 * `ignored: true` — which is precisely how the rubric wants a decorative icon
 * treated, and a check that counted ignored nodes would flag every one of them.
 */
export function flattenAxTree(nodes: unknown[]): AuditAxNode[] {
	const out: AuditAxNode[] = [];
	for (const raw of nodes ?? []) {
		// The AX tree is a CDP payload: each node is narrowed here rather than
		// assumed, so a protocol change shows up as a missing field rather than as
		// `undefined` reaching a check.
		if (typeof raw !== "object" || raw === null) continue;
		const node = raw as {
			ignored?: boolean;
			nodeId?: number;
			backendDOMNodeId?: number;
			role?: { value?: unknown };
			name?: { value?: unknown };
			properties?: Array<{ name?: string; value?: { value?: unknown } }>;
		};
		if (node.ignored) continue;
		const role = typeof node.role?.value === "string" ? node.role.value : "";
		const name = typeof node.name?.value === "string" ? node.name.value : "";
		const props = Object.fromEntries(
			(node.properties ?? []).map(
				(p: { name?: string; value?: { value?: unknown } }) => [
					p.name,
					p.value?.value,
				],
			),
		);
		out.push({
			nodeId: node.nodeId,
			backendDOMNodeId: node.backendDOMNodeId,
			role,
			name,
			level: props.level,
			focusable: props.focusable,
			disabled: props.disabled,
			checked: props.checked,
			expanded: props.expanded,
		});
	}
	return out;
}
