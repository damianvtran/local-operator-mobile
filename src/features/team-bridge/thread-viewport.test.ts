import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createThreadViewport } from "./thread-viewport";

const source = readFileSync(
	new URL("./thread-screen.tsx", import.meta.url),
	"utf8",
);
const INITIAL_ANCHOR = /maintainVisibleContentPosition=\{\s*positioned/;
const rig = () => {
	const move = vi.fn();
	const positioned = vi.fn();
	const viewport = createThreadViewport(move, positioned);
	return { viewport, move, positioned };
};
const open = () => {
	const r = rig();
	r.viewport.layout(500);
	r.viewport.content(4000, true);
	r.viewport.scroll(3500, 500, 4000);
	return r;
};

describe("thread viewport admission and reading ownership", () => {
	it("reproduces the old layout-scroll-before-content race as a negative control", () => {
		let followTail = true;
		const move = vi.fn();
		followTail = 0 + 500 >= 4000 - 44;
		if (followTail) move();
		expect(move).not.toHaveBeenCalled();
	});
	it("ignores pre-initial scroll intent and confirms the resulting tail geometry", () => {
		const { viewport, move, positioned } = rig();
		viewport.layout(500);
		viewport.scroll(0, 500, 4000);
		viewport.content(4000, true);
		expect(move).toHaveBeenCalledOnce();
		expect(viewport.pending).toBe(true);
		expect(positioned).not.toHaveBeenCalled();
		viewport.scroll(3500, 500, 4000);
		expect(viewport.pending).toBe(false);
		expect(positioned).toHaveBeenCalledOnce();
	});
	it("waits for both actual viewport and admitted data/content", () => {
		const { viewport, move } = rig();
		viewport.content(100, false);
		viewport.layout(500);
		expect(viewport.pending).toBe(true);
		viewport.content(4000, true);
		expect(move).toHaveBeenCalledOnce();
		const delayed = rig();
		delayed.viewport.content(4000, true);
		expect(delayed.move).not.toHaveBeenCalled();
		delayed.viewport.layout(500);
		expect(delayed.move).toHaveBeenCalledOnce();
	});
	it.each([0, 100, 500])(
		"admits measured short/empty content of %i without waiting for a scroll event",
		(content) => {
			const { viewport, positioned, move } = rig();
			viewport.layout(500);
			viewport.content(content, true);
			expect(viewport.pending).toBe(false);
			expect(positioned).toHaveBeenCalledOnce();
			expect(move).not.toHaveBeenCalled();
		},
	);
	it("does not admit an intermediate top event after a position request", () => {
		const { viewport } = rig();
		viewport.layout(500);
		viewport.content(4000, true);
		viewport.scroll(0, 500, 4000);
		expect(viewport.pending).toBe(true);
	});
	it("preserves a history reader across append, prepend, refresh and viewport resize", () => {
		const { viewport, move } = open();
		move.mockClear();
		viewport.userScroll();
		viewport.scroll(900, 500, 4000);
		viewport.content(4200, true);
		viewport.content(6000, true);
		viewport.content(6000, false);
		viewport.layout(400);
		viewport.content(6000, true);
		expect(move).not.toHaveBeenCalled();
	});
	it("does not treat post-admission virtualized layout drift as reader intent", () => {
		const { viewport, move } = open();
		move.mockClear();
		viewport.scroll(3400, 500, 4100);
		viewport.content(4300, true);
		expect(move).toHaveBeenCalledOnce();
	});
	it("follows new content and late media only while already following", () => {
		const { viewport, move } = open();
		move.mockClear();
		viewport.content(4200, true);
		viewport.content(4500, true);
		expect(move).toHaveBeenCalledTimes(2);
	});
	it("yields immediately when user intent precedes the next measured scroll", () => {
		const { viewport, move } = open();
		move.mockClear();
		viewport.userScroll();
		viewport.content(4200, true);
		expect(move).not.toHaveBeenCalled();
	});
	it("deliberately returning to the tail re-enables following", () => {
		const { viewport, move } = open();
		move.mockClear();
		viewport.userScroll();
		viewport.scroll(900, 500, 4000);
		viewport.scroll(3500, 500, 4000);
		viewport.content(4200, true);
		expect(move).toHaveBeenCalledOnce();
	});
	it("keeps separate account/org/conversation instances independent", () => {
		const first = open();
		first.viewport.userScroll();
		first.viewport.scroll(0, 500, 4000);
		const reopened = rig();
		reopened.viewport.layout(500);
		reopened.viewport.content(4000, true);
		expect(reopened.move).toHaveBeenCalledOnce();
		expect(first.viewport.pending).toBe(false);
	});
});

describe("actual FlatList callback bindings", () => {
	it("routes the real event handlers through admission instead of layout scroll follow state", () => {
		const { viewport, move } = rig();
		// Execute the actual inline callback bodies. This catches a controller
		// that is tested in isolation but never wired to the shipping list.
		const scrollBody = source
			.split("onScroll={(event) => {")[1]
			?.split("\n\t\t\t\t\t\t\t\t\t}}")[0];
		const contentBody = source
			.split("onContentSizeChange={(_width, height) => {")[1]
			?.split("\n\t\t\t\t\t\t\t\t\t}}")[0];
		expect(scrollBody).toBeTruthy();
		expect(contentBody).toBeTruthy();
		const onScroll = new Function(
			"viewport",
			`return event => {${scrollBody}}`,
		)({ current: viewport });
		const onContent = new Function(
			"viewport",
			"thread",
			"conversationId",
			`return (_width, height) => {${contentBody}}`,
		)({ current: viewport }, { state: "ready", messages: [] }, "bcv_humans");
		viewport.layout(500);
		onScroll({
			nativeEvent: {
				contentOffset: { y: 0 },
				layoutMeasurement: { height: 500 },
				contentSize: { height: 4000 },
			},
		});
		onContent(390, 4000);
		expect(move).toHaveBeenCalledOnce();
		onScroll({
			nativeEvent: {
				contentOffset: { y: 3500 },
				layoutMeasurement: { height: 500 },
				contentSize: { height: 4000 },
			},
		});
		expect(viewport.pending).toBe(false);
	});
	it("keeps heading semantic and scalable, list admission private, and identity account scoped", () => {
		expect(source).toContain("numberOfLines={2}");
		expect(source).toContain("min-w-0 flex-1 text-title text-ink");
		expect(source).not.toContain("allowFontScaling={false}");
		expect(source).not.toContain("adjustsFontSizeToFit");
		expect(source).toContain("accessibilityElementsHidden={initialRowsHidden}");
		expect(source).toContain("!viewport.current?.pending &&");
		expect(source).toContain(["key={`", "$", "{selfAccountId}/"].join(""));
		expect(source).toMatch(INITIAL_ANCHOR);
	});
});
