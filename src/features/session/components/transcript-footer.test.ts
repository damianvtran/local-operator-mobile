import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import { TAIL_CLAMP_OFFSET_PT } from "@/features/session/windowing";
import { TranscriptList } from "./transcript-list";

// Exercise the actual list hooks and event handlers with a null native host,
// just like the provider's mounted wire tests. This proves reconciliation/prop
// and tail-policy contracts, NOT native pixels, focus, keyboard or IME behavior.
const host = vi.hoisted(() => ({
	props: null as unknown,
	scroll: vi.fn(),
	mounts: 0,
	unmounts: 0,
}));
vi.mock("react-native", async () => {
	const React = await import("react");
	return {
		Platform: { OS: "web" },
		View: ({ children }: { children?: React.ReactNode }) => children ?? null,
		FlatList: React.forwardRef(
			(props: { ListFooterComponent?: React.ReactElement }, ref) => {
				React.useImperativeHandle(
					ref,
					() => ({ scrollToOffset: host.scroll }),
					[],
				);
				host.props = props;
				return props.ListFooterComponent ?? null;
			},
		),
	};
});
vi.mock("@/features/session/components/transcript-row", () => ({
	TranscriptRow: () => null,
}));
vi.mock("@/features/session/components/turn-bar", () => ({
	TurnBar: () => null,
}));
vi.mock("@/features/session/components/quiet-group-bar", () => ({
	QuietGroupBar: () => null,
}));
vi.mock("@/features/session/components/supplement-block", () => ({
	SupplementBlock: () => null,
}));

interface ListProps {
	data: unknown[];
	initialScrollIndex?: number;
	ListFooterComponent: React.ReactElement<{ children?: React.ReactNode }>;
	onContentSizeChange: (width: number, height: number) => void;
	onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
	onScroll: (event: {
		nativeEvent: {
			contentOffset: { y: number };
			contentSize: { height: number };
			layoutMeasurement: { height: number };
		};
	}) => void;
}
const props = () => host.props as ListProps;
let root: ReturnType<typeof createRoot> | null = null;
let serial = 0;
let session = "";
function Notice({ visible }: { visible: boolean }) {
	useEffect(() => {
		host.mounts += 1;
		return () => {
			host.unmounts += 1;
		};
	}, []);
	// The real ConnectionBanner likewise remains the same component when it
	// renders null for C1. No host DOM/native nodes are fabricated in this test.
	return visible ? null : null;
}
const seed = JSON.parse(
	readFileSync(
		new URL("../../../../fixtures/relay/http/history-ok.json", import.meta.url),
		"utf8",
	),
).body.entries[0] as TranscriptEntry;
const rows = (count: number): TranscriptEntry[] =>
	Array.from({ length: count }, (_, i) => ({
		...seed,
		id: `footer-row-${i}`,
		kind: "user",
		text: `message ${i}`,
	}));
async function render(entries: TranscriptEntry[], visible: boolean | null) {
	await act(async () =>
		root?.render(
			createElement(TranscriptList, {
				sessionId: session,
				entries,
				streamingRowId: null,
				anchorId: entries.at(-1)?.id ?? null,
				footer:
					visible === null ? undefined : createElement(Notice, { visible }),
				testID: "test-transcript",
			}),
		),
	);
}
beforeEach(() => {
	session = `footer-test-${++serial}`;
	host.mounts = 0;
	host.unmounts = 0;
	host.scroll.mockClear();
	const doc = {
		nodeType: 9,
		activeElement: null,
		addEventListener() {},
		removeEventListener() {},
	};
	vi.stubGlobal("window", {
		document: doc,
		HTMLIFrameElement: class {},
		HTMLElement: class {},
		addEventListener() {},
		removeEventListener() {},
	});
	vi.stubGlobal("document", doc);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
	root = createRoot({
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		ownerDocument: doc,
		addEventListener() {},
		removeEventListener() {},
	} as unknown as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	vi.unstubAllGlobals();
});

describe("permanent transcript notice footer", () => {
	it.each([0, 1, 520])(
		"keeps notice outside the actual %i rows and preserves its host",
		async (count) => {
			const entries = rows(count);
			await render(entries, false);
			const before = props();
			const footerType = before.ListFooterComponent.type;
			const data = before.data;
			const initialIndex = before.initialScrollIndex;
			await render(entries, true);
			expect(props().ListFooterComponent.type).toBe(footerType);
			expect(props().data).toBe(data);
			expect(props().initialScrollIndex).toBe(initialIndex);
			expect(host.mounts).toBe(1);
			expect(host.unmounts).toBe(0);
			await render(entries, false);
			expect(host.mounts).toBe(1);
			expect(host.unmounts).toBe(0);
		},
	);
	it("accepts no optional footer without introducing a fake row", async () => {
		await render([], null);
		expect(props().data).toEqual([]);
		expect(props().ListFooterComponent.props.children).toBeUndefined();
		expect(host.mounts).toBe(0);
	});
	it.each([true, false])(
		"notice growth follows only a reader already at tail: %s",
		async (atTail) => {
			const entries = rows(20);
			await render(entries, false);
			await act(async () => {
				props().onLayout({ nativeEvent: { layout: { height: 100 } } });
				props().onContentSizeChange(320, 1000);
				// A real initial tail scroll establishes the previous geometry.
				// The next event can then represent an actual reader move UP;
				// a first-ever offset300 from offset0 is down, not relinquishment.
				props().onScroll({
					nativeEvent: {
						contentOffset: { y: 900 },
						contentSize: { height: 1000 },
						layoutMeasurement: { height: 100 },
					},
				});
				props().onScroll({
					nativeEvent: {
						contentOffset: { y: atTail ? 900 : 300 },
						contentSize: { height: 1000 },
						layoutMeasurement: { height: 100 },
					},
				});
			});
			host.scroll.mockClear();
			await render(entries, true);
			await act(async () => props().onContentSizeChange(320, 1235));
			if (atTail)
				expect(host.scroll).toHaveBeenCalledWith({
					offset: TAIL_CLAMP_OFFSET_PT,
					animated: false,
				});
			else expect(host.scroll).not.toHaveBeenCalled();
		},
	);
});

const source = readFileSync(
	new URL("../../../../app/(app)/session/[id].tsx", import.meta.url),
	"utf8",
);
// TypeScript 7 ships the CLI but no compiler AST API. Reuse Expo's existing
// Metro parser instead of installing/depending on another compiler tree.
const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve("expo/package.json"));
const metroRequire = createRequire(
	expoRequire.resolve("@expo/metro-config/package.json"),
);
type Ast = { type: string; [key: string]: unknown };
const parser = metroRequire("@babel/parser") as {
	parse: (input: string, options: object) => Ast;
};
const tree = parser.parse(source, {
	sourceType: "module",
	plugins: ["typescript", "jsx"],
});
function ast(value: unknown): Ast {
	if (!value || typeof value !== "object" || !("type" in value))
		throw new Error("Expected AST node");
	return value as Ast;
}
const jsx = (node: Ast) => node.type === "JSXElement";
const opening = (node: Ast) => ast(node.openingElement);
const tag = (node: Ast) =>
	node.type === "JSXFragment"
		? "Fragment"
		: String(ast(opening(node).name).name);
const text = (node: Ast) => source.slice(Number(node.start), Number(node.end));
const parent = new WeakMap<Ast, Ast>();
const all: Ast[] = [];
function walk(node: Ast) {
	if (jsx(node)) all.push(node);
	for (const value of Object.values(node)) {
		for (const item of Array.isArray(value) ? value : [value]) {
			if (item && typeof item === "object" && "type" in item) {
				const child = ast(item);
				parent.set(child, node);
				walk(child);
			}
		}
	}
}
walk(tree);
const column = all.find((node) =>
	text(opening(node)).includes("testID={SURFACE.sessionColumn}"),
);
if (!column) throw new Error("Missing column");
const children = (column.children as Ast[]).filter((node) =>
	node.type === "JSXText"
		? String(node.value).trim().length > 0
		: node.type !== "JSXExpressionContainer" ||
			ast(node.expression).type !== "JSXEmptyExpression",
);
function slot(name: string) {
	const node = all.find((candidate) => tag(candidate) === name);
	if (!node) throw new Error(`Missing ${name}`);
	let direct = node;
	while (parent.get(direct) !== column && parent.has(direct))
		direct = parent.get(direct) as Ast;
	const attributes = opening(node).attributes as Ast[];
	return {
		index: children.indexOf(direct),
		key: attributes.find(
			(prop) => prop.type === "JSXAttribute" && ast(prop.name).name === "key",
		),
	};
}
describe("session banner-only relocation structure", () => {
	it("leaves composer and documented pinned controls at their original sibling slots", () => {
		// PR92 adds a permanent close-panel conditional before FindBar; these
		// are the original PR92 slots, not main's pre-integration indices.
		expect(slot("Composer")).toEqual({ index: 8, key: undefined });
		expect(slot("FindBar").index).toBe(4);
		expect(slot("PendingCard").index).toBe(5);
		expect(slot("AskBar").index).toBe(7);
		// PR92's already-reviewed secondary region keeps working/panel nodes
		// inside one permanently mounted scroller. It is not the composer host.
		const secondary = children[1];
		expect(secondary && jsx(secondary) ? tag(secondary) : null).toBe(
			"ScrollView",
		);
		expect(secondary && text(secondary)).toContain("regionItems.map");
		const composer = all.find((node) => tag(node) === "Composer");
		if (!composer) throw new Error("Missing pinned composer");
		expect(parent.get(composer)).toBe(column);
		expect(children[6] && jsx(children[6]) ? tag(children[6]) : null).toBe(
			"View",
		);
		expect(all.filter((node) => tag(node) === "Composer")).toHaveLength(1);
	});
	it("binds only the notice to the list footer, never the composer or completion anchor", () => {
		const list = all.find((node) => tag(node) === "TranscriptList");
		if (!list) throw new Error("Missing list");
		const attrs = text(opening(list));
		expect(attrs).toContain("footer={connectionBanner}");
		expect(attrs).toContain("entries={runtime.entries}");
		expect(attrs).toContain(
			"anchorId={attentionRecord(runtime.projection)?.anchor_id ?? null}",
		);
		expect(attrs).not.toContain("Composer");
	});
	it("keeps non-list notices in bounded disconnected/recovery/loading content", () => {
		let initializer = "";
		function find(node: Ast) {
			if (
				node.type === "VariableDeclarator" &&
				ast(node.id).name === "transcript"
			)
				initializer = text(ast(node.init));
			for (const value of Object.values(node))
				for (const item of Array.isArray(value) ? value : [value])
					if (item && typeof item === "object" && "type" in item)
						find(ast(item));
		}
		find(tree);
		expect(initializer.match(/connectionBanner/g)).toHaveLength(4);
		expect(initializer.match(/<ScrollView/g)).toHaveLength(3);
		expect(initializer).not.toContain("<Composer");
	});
});
