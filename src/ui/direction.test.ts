import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	DirectionProvider,
	DirectionView,
	LTR_TEXT,
	TEXT_END_CLASS,
	useDirection,
	useIsRTL,
} from "@/ui/direction";

/**
 * The direction seam, at the three places it can silently stop working.
 *
 * Everything renders through the same react-native-web the web export ships (the
 * vitest alias maps `react-native` to it), so the markup asserted here is what a
 * browser is given. Native cannot be rendered in Node: the native half of each
 * decision is pinned by the source it cites (see the comments in `direction.tsx`).
 */

/** `createElement` cannot see a third-argument child as the required `children`
 *  prop, so the provider is built through this one place. */
const provide = (
	direction: "ltr" | "rtl",
	children: ReactNode,
	locale = "en",
) => h(DirectionProvider, { direction, locale, children });

const Probe = () =>
	h("i", { "data-dir": useDirection(), "data-rtl": String(useIsRTL()) }, null);

describe("the direction context", () => {
	it("is ltr outside a provider, so a component rendered alone behaves as the app does before a config frame", () => {
		expect(renderToStaticMarkup(h(Probe))).toBe(
			'<i data-dir="ltr" data-rtl="false"></i>',
		);
	});

	it("publishes the direction it is given, to both hooks", () => {
		const markup = (direction: "ltr" | "rtl") =>
			renderToStaticMarkup(provide(direction, h(Probe)));
		expect(markup("rtl")).toBe('<i data-dir="rtl" data-rtl="true"></i>');
		expect(markup("ltr")).toBe('<i data-dir="ltr" data-rtl="false"></i>');
	});
});

describe("the document attributes (web half of the provider)", () => {
	/* The provider's effect writes `dir`/`lang` on `<html>`. react-dom's client
	 * renderer needs a container and a document; a tree that renders NO host node
	 * needs nothing else, so this stub is just an attribute bag. */
	type Attrs = Map<string, string>;
	let attrs: Attrs;
	const globals = globalThis as unknown as Record<string, unknown>;

	beforeEach(() => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		attrs = new Map();
		const documentElement = {
			getAttribute: (name: string) => attrs.get(name) ?? null,
			setAttribute: (name: string, value: string) => attrs.set(name, value),
			removeAttribute: (name: string) => attrs.delete(name),
		};
		class Stub {}
		const doc = Object.assign(new Stub(), {
			nodeType: 9,
			documentElement,
			activeElement: null,
			addEventListener() {},
			removeEventListener() {},
		});
		const container = Object.assign(new Stub(), {
			nodeType: 1,
			nodeName: "DIV",
			tagName: "DIV",
			ownerDocument: doc,
			childNodes: [],
			addEventListener() {},
			removeEventListener() {},
			appendChild() {},
			removeChild() {},
		});
		globals.document = doc;
		globals.window = {
			document: doc,
			Element: Stub,
			HTMLElement: Stub,
			Node: Stub,
			Document: Stub,
			/* The names react-dom asks `instanceof` about while it walks focus: they
			 * have no behaviour here but must EXIST or the check throws. */
			HTMLIFrameElement: class {},
			SVGElement: class {},
			DocumentFragment: class {},
			Event: class {},
			MouseEvent: class {},
			addEventListener() {},
			removeEventListener() {},
			navigator: { userAgent: "node" },
		};
		globals.__container = container;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete globals.document;
		delete globals.window;
		delete globals.__container;
	});

	const mount = (direction: "ltr" | "rtl" | null, locale = "en") => {
		const root = createRoot(globals.__container as never);
		const render = (next: "ltr" | "rtl" | null, nextLocale = locale) =>
			act(async () => {
				root.render(next === null ? null : provide(next, null, nextLocale));
			});
		return { root, render, first: render(direction) };
	};

	it("writes dir and lang, follows a change, and puts back what was there on unmount", async () => {
		attrs.set("dir", "ltr");
		attrs.set("lang", "xx");
		const view = mount("rtl");
		await view.first;
		expect(attrs.get("dir")).toBe("rtl");
		expect(attrs.get("lang")).toBe("en");

		await view.render("ltr");
		expect(attrs.get("dir")).toBe("ltr");

		await view.render(null);
		/* The ORIGINAL values return, not a default: a provider that cleaned up by
		 * writing `ltr` would still leave `lang="en"` where the page had `xx`. */
		expect(attrs.get("dir")).toBe("ltr");
		expect(attrs.get("lang")).toBe("xx");
	});

	it('follows a LOCALE change that keeps the direction (QA Q1: French under lang="en")', async () => {
		/* The defect this pins: the effect depended on `direction` alone, so a
		 * shipped LTR locale never re-ran it and a French screen announced itself
		 * as English. Language and direction move independently, which is the whole
		 * point of two attributes. */
		const view = mount("ltr", "en");
		await view.first;
		expect(attrs.get("dir")).toBe("ltr");
		expect(attrs.get("lang")).toBe("en");

		await view.render("ltr", "fr");
		expect(attrs.get("dir")).toBe("ltr");
		expect(attrs.get("lang")).toBe("fr");

		/* and it can fail: a locale that writes the same tag leaves the old one,
		 * so the assertion above is not passing on an unconditional write. */
		await view.render("ltr", "hi");
		expect(attrs.get("lang")).toBe("hi");
	});

	it("removes an attribute the document did not have, rather than leaving the provider's value", async () => {
		const view = mount("rtl");
		await view.first;
		expect(attrs.get("dir")).toBe("rtl");
		await view.render(null);
		expect(attrs.has("dir")).toBe(false);
		expect(attrs.has("lang")).toBe(false);
	});
});

describe("DirectionView: inline logical style props follow the direction on web", () => {
	/* The regression this exists for: react-native-web resolves `end`/`paddingStart`
	 * in an INLINE style from its locale context, which only a `dir` PROP sets — a
	 * `direction` style or `<html dir>` does not. A plain `View` with
	 * `style={{ direction: "rtl" }}` rendered `right:0px;padding-left:3px`. */
	const child = h(View, {
		style: { position: "absolute", end: 0, paddingStart: 3 },
	});
	const render = (direction: "ltr" | "rtl", plain = false) =>
		renderToStaticMarkup(
			provide(
				direction,
				plain
					? h(View, { style: { direction } }, child)
					: h(DirectionView, null, child),
			),
		);

	it("rtl: end resolves to the left and paddingStart to the right", () => {
		const markup = render("rtl");
		expect(markup).toContain('dir="rtl"');
		expect(markup).toContain("left:0px");
		expect(markup).toContain("padding-right:3px");
	});

	it("ltr: end resolves to the right and paddingStart to the left (unchanged)", () => {
		const markup = render("ltr");
		expect(markup).toContain('dir="ltr"');
		expect(markup).toContain("right:0px");
		expect(markup).toContain("padding-left:3px");
	});

	it("can fail: a View with only the direction STYLE leaves inline props unflipped", () => {
		const markup = render("rtl", true);
		expect(markup).not.toContain("dir=");
		expect(markup).toContain("right:0px");
		expect(markup).toContain("padding-left:3px");
	});

	it("keeps the caller's own style and merges the direction into it", () => {
		const markup = renderToStaticMarkup(
			provide(
				"rtl",
				h(DirectionView, { style: { opacity: 0.5 }, testID: "root" }),
			),
		);
		expect(markup).toContain("opacity:0.5");
		expect(markup).toContain('data-testid="root"');
	});
});

describe("the per-platform text constants", () => {
	it("TEXT_END_CLASS names the web utility and the native one, both literally", () => {
		/* Both tokens must be readable in source for Tailwind to generate them. */
		expect(TEXT_END_CLASS).toBe("web:text-end native:text-right");
	});

	it("LTR_TEXT is left on web (the vitest alias is the web target) and always writes ltr", () => {
		expect(LTR_TEXT).toEqual({ writingDirection: "ltr", textAlign: "left" });
	});
});

describe("the native half of the per-platform constants", () => {
	/* `Platform.OS` is fixed at import, so the native answer needs a fresh module
	 * graph with `react-native` reporting `ios`. Native text cannot be RENDERED in
	 * Node; what is pinned is the decision, whose reasoning (RN swaps left/right
	 * itself under an RTL layout, so `auto` + writingDirection:ltr is the left edge)
	 * is cited in `direction.tsx`. */
	it("LTR_TEXT is `auto` on native: a literal `left` would be swapped to the right by RN under an RTL layout", async () => {
		vi.resetModules();
		vi.doMock("react-native", async () => ({
			...(await vi.importActual<object>("react-native")),
			Platform: { OS: "ios" },
		}));
		const native = await import("@/ui/direction");
		expect(native.LTR_TEXT).toEqual({
			writingDirection: "ltr",
			textAlign: "auto",
		});
		vi.doUnmock("react-native");
		vi.resetModules();
	});
});
