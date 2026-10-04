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

export const EXTRACT_PROBE = `
(() => {
  const px = (value) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
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
    nodes.push({
      index,
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
      hasGlyph: /[\\u2190-\\u2BFF\\u2000-\\u206F!?]|\\b(error|failed|pending|waiting|done|running|warning)\\b/i.test(el.textContent || ''),
      // A colour-only status: draws with a semantic colour but carries no word,
      // glyph or shape and no accessible name — the thing U-03 exists to catch.
      semanticColour: style.color,
      semanticBackground: style.backgroundColor,
      semanticBorder: style.borderTopColor,
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
    nodeCount: nodes.length,
    nodes,
  };
})();
`;

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
