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
 * number means belongs in `checks.mjs`, where the floors live and where a
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
      // The nearest ancestor's full text, so a status *word* carried by a sibling
      // counts as a carrier and a bare dot beside it is not a colour-only status.
      containerText: ((el.closest('p, li, div, section, header, footer, td, button') || el.parentElement || el).textContent || '').trim().slice(0, 200),
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
export function flattenAxTree(nodes) {
	const out = [];
	for (const node of nodes ?? []) {
		if (node.ignored) continue;
		const role = node.role?.value ?? "";
		const name = node.name?.value ?? "";
		const props = Object.fromEntries(
			(node.properties ?? []).map((p) => [p.name, p.value?.value]),
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
