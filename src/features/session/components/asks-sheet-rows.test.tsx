import type React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PendingAsk, SessionSummary } from "@/contracts";

/**
 * The asks sheet's LIST: its title, its state sections, and each row's anatomy
 * (issue #326).
 *
 * The reported sheet was titled "8 questions timed out" over rows that said
 * "Answered — the agent was told", and its rows ran together: each row drew its
 * conversation name, then its status, then a meta line holding the folder path
 * and the open button — with the same 4 pt gap inside a row and between rows —
 * so, scrolled, every path-and-button read as the header of the NEXT row.
 *
 * Rendered to static markup through a pass-through `react-native`, so the tree
 * the sheet builds is what is asserted: which element holds which part. The
 * sheet's seeded first paint (`seedRows`, drawn until the aggregate read lands)
 * is the render path, because static rendering runs no effects. Geometry is a
 * rendered-frame question (the PR's captures), not a unit one.
 */

vi.mock("react-native", async () => {
	const React = await import("react");
	const host =
		(tag: string) =>
		({
			children,
			className,
			testID,
			numberOfLines,
		}: {
			children?: React.ReactNode;
			className?: string;
			testID?: string;
			numberOfLines?: number;
		}) =>
			React.createElement(
				tag,
				{
					"data-cls": className ?? "",
					"data-testid": testID,
					"data-lines": numberOfLines,
				},
				children ?? null,
			);
	return {
		View: host("div"),
		Text: host("span"),
		TextInput: () => React.createElement("input"),
		Pressable: ({
			children,
			className,
			testID,
			style,
			hitSlop,
		}: {
			children?:
				| React.ReactNode
				| ((state: { pressed: boolean }) => React.ReactNode);
			className?: string;
			testID?: string;
			style?: { minHeight?: number };
			hitSlop?: { top?: number; bottom?: number };
		}) =>
			React.createElement(
				"div",
				{
					"data-cls": className ?? "",
					"data-testid": testID,
					"data-min-height": style?.minHeight,
					"data-slop": hitSlop
						? `${hitSlop.top ?? 0}/${hitSlop.bottom ?? 0}`
						: undefined,
				},
				typeof children === "function"
					? children({ pressed: false })
					: (children ?? null),
			),
	};
});
vi.mock("lucide-react-native", () => ({ ArrowUpRight: () => null }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000000" }));
vi.mock("@/ui/components/sheet", async () => {
	const React = await import("react");
	return {
		Sheet: ({
			title,
			children,
			footer,
		}: {
			title: string;
			children?: React.ReactNode;
			footer?: React.ReactNode;
		}) =>
			React.createElement(
				"section",
				{ "data-title": title },
				children,
				footer ?? null,
			),
	};
});
vi.mock("@/ui/components/button", async () => {
	const React = await import("react");
	return {
		Button: ({ label, testID }: { label: string; testID?: string }) =>
			React.createElement("button", { "data-testid": testID }, label),
	};
});
vi.mock("@/ui/components/icon-button", async () => {
	const React = await import("react");
	return {
		IconButton: ({
			accessibilityLabel,
			testID,
		}: {
			accessibilityLabel: string;
			testID?: string;
		}) =>
			React.createElement("button", {
				"data-testid": testID,
				"aria-label": accessibilityLabel,
			}),
	};
});

const { AsksSheet } = await import("@/features/session/components/asks-sheet");
const { CONTROL, askRowId, timedOutAskRowId } = await import("@/ui/a11y");

/* ------------------------------------------------- a static-markup tree */

type El = {
	tag: string;
	attrs: Record<string, string>;
	children: Node[];
	parent: El | null;
};
type Node = El | string;

const decode = (text: string) =>
	text
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");

/** React's static markup is well formed, so a tokenizer is enough. */
function parse(html: string): El {
	const root: El = { tag: "#root", attrs: {}, children: [], parent: null };
	let at = root;
	for (const token of html.matchAll(/<(\/?)([a-z]+)([^>]*?)(\/?)>|([^<]+)/g)) {
		const [, close, tag, rawAttrs, selfClose, text] = token;
		if (text !== undefined) {
			at.children.push(decode(text));
		} else if (close) {
			at = at.parent ?? root;
		} else {
			const attrs: Record<string, string> = {};
			for (const [, name, value] of (rawAttrs ?? "").matchAll(
				/([\w-]+)="([^"]*)"/g,
			)) {
				attrs[name as string] = decode(value as string);
			}
			const el: El = { tag: tag as string, attrs, children: [], parent: at };
			at.children.push(el);
			if (!selfClose && tag !== "input") at = el;
		}
	}
	return root;
}

const textOf = (node: Node): string =>
	typeof node === "string" ? node : node.children.map(textOf).join("");

const all = (el: El): El[] =>
	el.children.flatMap((child) =>
		typeof child === "string" ? [] : [child, ...all(child)],
	);

const byTestId = (root: El, id: string): El => {
	const found = all(root).find((el) => el.attrs["data-testid"] === id);
	if (!found) throw new Error(`no element with test id ${id}`);
	return found;
};

/** The innermost element whose own text run equals `text`. */
const byText = (root: El, text: string): El => {
	const found = all(root)
		.filter((el) => textOf(el) === text)
		.pop();
	if (!found) throw new Error(`no element reads "${text}"`);
	return found;
};

const ancestors = (el: El): El[] =>
	el.parent ? [el.parent, ...ancestors(el.parent)] : [];

const contains = (outer: El, inner: El) => ancestors(inner).includes(outer);

/** The innermost element holding both. */
const commonAncestor = (a: El, b: El): El => {
	const of = new Set(ancestors(a));
	const found = ancestors(b).find((el) => of.has(el));
	if (!found) throw new Error("no common ancestor");
	return found;
};

/** The child of `container` that holds `el`. */
const childOf = (container: El, el: El): El => {
	const found = [el, ...ancestors(el)].find(
		(node) => node.parent === container,
	);
	if (!found) throw new Error("not inside the container");
	return found;
};

/* ------------------------------------------------------------- the list */

/** The spacing BETWEEN rows (16 pt); a row's own parts keep `gap-1` (4 pt). */
const BETWEEN_ROWS_GAP = /\bgap-4\b/;
const INSIDE_ROW_GAP = /\bgap-1\b/;
const TOP_ALIGNED = /\bjustify-start\b/;
const CENTRED = /\bjustify-center\b/;
const ONE_LINE = /\btruncate\b/;
const OUT_OF_FLOW = /\babsolute\b/;

const NOW = Date.now();
const MINUTE = 60_000;

const ask = (
	id: string,
	status: string,
	session: string | null,
	patch: Partial<PendingAsk> = {},
): PendingAsk => ({
	ask_id: id,
	...(session ? { session_id: session, cwd: `/synthetic/${session}` } : {}),
	created_at: NOW - 60 * MINUTE,
	expires_at: NOW - 30 * MINUTE,
	timeout_s: 1800,
	urgent: false,
	status,
	delivered: true,
	questions: [
		{
			id: "q1",
			question: `question ${id}`,
			options: [],
			multi: false,
			secret: false,
			persist: false,
		},
	],
	...patch,
});

const summary = (session_id: string, name: string): SessionSummary =>
	({ session_id, conversation_name: name }) as unknown as SessionSummary;

const SESSIONS = [
	summary("payments", "Reconcile the payments ledger"),
	summary("release", "Draft the release notes"),
	summary("catalogue", "Index the vendor catalogue"),
	summary("retries", "Audit every service for retries"),
];

/** The reported shape: timed-out and answered asks from several conversations,
 *  plus an open one elsewhere and one of the reader's own conversation. */
const ROWS = [
	ask("open-retries", "open", "retries", {
		created_at: NOW - MINUTE,
		expires_at: NOW + 20 * MINUTE,
	}),
	ask("timed-payments", "timed_out", "payments"),
	ask("timed-here", "timed_out", null),
	ask("answered-release", "answered", "release"),
	ask("answered-catalogue", "answered", "catalogue", { delivered: false }),
];

const draw = (initialOpenAsk: string | null = null) =>
	parse(
		renderToStaticMarkup(
			createElement(AsksSheet, {
				visible: true,
				onClose: () => undefined,
				client: null,
				currentSessionId: "here",
				onOpenConversation: () => undefined,
				sessions: SESSIONS,
				seedRows: ROWS,
				initialOpenAsk,
			}),
		),
	);

describe("the asks sheet's list (issue #326)", () => {
	it("titles the sheet with the neutral noun, not a state count", () => {
		const sheet = all(draw()).find((el) => el.tag === "section");
		expect(sheet?.attrs["data-title"]).toBe("Questions");
	});

	it("lists rows under a heading per state, in state order", () => {
		const tree = draw();
		const text = textOf(tree);
		const at = (needle: string) => {
			const index = text.indexOf(needle);
			expect(index, `"${needle}" is drawn`).toBeGreaterThan(-1);
			return index;
		};
		const waiting = at("Waiting on you");
		const timedOut = at("Timed out");
		const closed = at("Closed");
		expect(waiting).toBeLessThan(at("Audit every service for retries"));
		expect(at("Audit every service for retries")).toBeLessThan(timedOut);
		expect(timedOut).toBeLessThan(at("Reconcile the payments ledger"));
		expect(at("Reconcile the payments ledger")).toBeLessThan(closed);
		/* The answered rows sit under Closed, never under Timed out. */
		expect(closed).toBeLessThan(at("Draft the release notes"));
		expect(closed).toBeLessThan(at("Index the vendor catalogue"));
	});

	it("heads each foreign row with its name, its folder beneath, and the open button beside them", () => {
		const toggle = byTestId(draw(), askRowId("timed-payments"));
		/* The row: everything this one ask draws (two rows share the state
		 *  sentence, so every part is looked up inside it). */
		const row = toggle.parent as El;
		const name = byText(row, "Reconcile the payments ledger");
		const folder = byText(row, "/synthetic/payments");
		const state = byText(
			row,
			"Timed out — the agent goes ahead without your answer",
		);
		/* The header block: name and folder share one column… */
		const column = commonAncestor(name, folder);
		expect(
			column.children.filter((child) => typeof child !== "string"),
		).toHaveLength(2);
		/* …and the row's open button is that column's sibling, so it aligns to
		 *  the header rather than to the status line. */
		const header = column.parent as El;
		const openButtons = all(header).filter(
			(el) => el.attrs["data-testid"] === CONTROL.askOpenConversation,
		);
		expect(openButtons).toHaveLength(1);
		expect(header.attrs["data-cls"]).toContain("items-center");
		/* The status line (with its caret) is beneath the header, in the row's
		 *  own toggle — never beside the folder. */
		expect(contains(header, state)).toBe(false);
		expect(contains(toggle, state)).toBe(true);
		expect(contains(toggle, folder)).toBe(false);
		expect(textOf(toggle)).toContain("▸");
		const parts = row.children.filter((child) => typeof child !== "string");
		expect(parts.indexOf(childOf(row, header))).toBeLessThan(
			parts.indexOf(childOf(row, toggle)),
		);
	});

	it("separates rows by spacing alone: a wider gap between rows than inside one, and no rule (review R1)", () => {
		/* `native-interaction-guidelines.md` asks for spacing, not a rule around
		 *  every ordinary row. With the status top-aligned (D1) the 16 pt gap
		 *  plus the touch floor's spare height groups each row on its own. */
		const tree = draw();
		const first = byTestId(tree, askRowId("answered-release"));
		const second = byTestId(tree, askRowId("answered-catalogue"));
		const list = commonAncestor(first, second);
		const a = childOf(list, first);
		const b = childOf(list, second);
		expect(list.children.indexOf(b) - list.children.indexOf(a)).toBe(1);
		expect(
			all(list).some((el) =>
				(el.attrs["data-cls"] ?? "").includes("bg-hairline"),
			),
			"no hairline between rows",
		).toBe(false);
		expect(list.attrs["data-cls"]).toMatch(BETWEEN_ROWS_GAP);
		expect(a.attrs["data-cls"]).toMatch(INSIDE_ROW_GAP);
	});

	it("draws the reader's own conversation's row without a name header", () => {
		const tree = draw();
		const toggle = byTestId(tree, askRowId("timed-here"));
		const row = toggle.parent as El;
		expect(
			all(row).some(
				(el) => el.attrs["data-testid"] === CONTROL.askOpenConversation,
			),
		).toBe(false);
	});
	/* Agent review round 1 (design D1-D3, QA Q2): the measured spacing did not
	 *  group a row — the status line floated midway between its header and the
	 *  next hairline, long names were cut to one line, and timed-out rows carried
	 *  4 pt more than the rest. */
	it("puts the status line at the top of its touch floor, so the spare height falls below it (D1)", () => {
		const toggle = byTestId(draw(), askRowId("timed-payments"));
		expect(toggle.attrs["data-cls"]).toMatch(TOP_ALIGNED);
		expect(toggle.attrs["data-cls"]).not.toMatch(CENTRED);
	});

	it("lets a conversation name wrap to two lines and keeps the folder on one (D2)", () => {
		const row = byTestId(draw(), askRowId("timed-payments")).parent as El;
		const name = byText(row, "Reconcile the payments ledger");
		const folder = byText(row, "/synthetic/payments");
		expect(name.attrs["data-lines"]).toBe("2");
		expect(name.attrs["data-cls"]).not.toMatch(ONE_LINE);
		expect(folder.attrs["data-cls"]).toMatch(ONE_LINE);
	});

	it("keeps the timed-out anchor out of the row's gapped column (D3 / Q2)", () => {
		const anchor = byTestId(draw(), timedOutAskRowId("timed-payments"));
		/* An in-flow child of the `gap-1` column added 4 pt under every
		 *  timed-out row; out of flow it takes no gap. */
		expect(anchor.attrs["data-cls"]).toMatch(OUT_OF_FLOW);
	});
	/* Agent review round 2 (design D1, QA Q5): the round-1 touch box reserved
	 *  its spare height between an OPENED row's status line and its answer
	 *  form — a 33-46 pt blank band that pushed the field below the fold. */
	it("keeps the 44 pt box on a collapsed status control", () => {
		const toggle = byTestId(draw(), askRowId("timed-payments"));
		expect(toggle.attrs["data-min-height"]).toBe("44");
		expect(toggle.attrs["data-cls"]).toMatch(TOP_ALIGNED);
	});

	it("lets an opened row's form follow its status line: no reserved box, slop instead (round 2 D1 / Q5)", () => {
		const tree = draw("timed-payments");
		const toggle = byTestId(tree, askRowId("timed-payments"));
		expect(toggle.attrs["data-min-height"]).toBeUndefined();
		/* The target keeps reach on native through slop that stays inside the
		 *  row's own 4 pt gaps, so it never overlaps the open button above or
		 *  the form's controls below. */
		expect(toggle.attrs["data-slop"]).toBe("4/4");
		/* The form is the next in-flow part after the toggle, in the same row
		 *  block (the timed-out anchor between them is out of flow). */
		const row = toggle.parent as El;
		const parts = row.children.filter(
			(child): child is El =>
				typeof child !== "string" &&
				!OUT_OF_FLOW.test(child.attrs["data-cls"] ?? ""),
		);
		const next = parts[parts.indexOf(toggle) + 1];
		expect(next, "something follows the opened status").toBeDefined();
		expect(textOf(next as El)).toContain("question timed-payments");
		/* Other rows stay collapsed with their box. */
		expect(
			byTestId(tree, askRowId("answered-release")).attrs["data-min-height"],
		).toBe("44");
	});
});
