import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useModalStackEntry } from "@/ui/components/modal-stack-entry";

/**
 * THE HOOK, not the store — and the distinction is the whole point of this file.
 *
 * `modal-stack.test.ts` asserts `modal-stack`'s own rule (`dimmer()`, `readModalStack`)
 * and CANNOT see the hook: R34 regressed twice in the hook while that file stayed 12/12
 * green — once by a `!visible` branch writing `dims: false` over the reading the close
 * had just produced, once by dropping the handle the reading needs at cleanup. Neither
 * mutation moves the store's answer; both change what a mounted renderer is told.
 *
 * So this file renders the REAL hook and asserts, at every step of a dismissal, the
 * contract a renderer depends on: the element that owns the dim KEEPS it for as long as
 * its content is mounted, and stops the moment another modal registers — exactly one
 * dimmer per frame, never none and never two. The fade is simulated the way the real
 * `Modal` behaves: the component stays MOUNTED with `visible={false}` while its content
 * is still on screen, which is the state round 9 got wrong.
 *
 * IT RUNS IN NODE WITH NO DOM PACKAGE. `react-dom`'s client renderer is pure JS; what it
 * needs is a container and a document to create nodes in — the small shim below. No
 * `jsdom`, no `happy-dom`, no renderer dependency, nothing added to the lockfile. It is
 * written with `createElement` rather than JSX on purpose: `vitest.config.ts` includes
 * `src/**\/*.test.ts`, so a `React.ReactElement` built by hand is what keeps this file
 * inside the suite without touching the shared config or any tsconfig.
 *
 * If the shim is ever the reason this stops working, fix the shim — it is the only
 * automated guard on the hook, and the capture harness cannot see a mid-fade dim.
 */
type StubNode = {
	nodeType: number;
	/* react-dom reads the container's NAME to pick a namespace context. */
	nodeName: string;
	tagName: string;
	parentNode: StubNode | null;
	childNodes: StubNode[];
	style: Record<string, string>;
	ownerDocument: StubDocument;
	appendChild(child: StubNode): StubNode;
	removeChild(child: StubNode): StubNode;
	insertBefore(child: StubNode, ref: StubNode | null): StubNode;
	addEventListener(): void;
	removeEventListener(): void;
	setAttribute(): void;
	getBoundingClientRect(): {
		top: number;
		left: number;
		width: number;
		height: number;
	};
};
type StubDocument = {
	createElement(tag: string): StubNode;
	createTextNode(text: string): StubNode;
	createComment(text: string): StubNode;
	/* react-dom listens for events on the DOCUMENT as well as on the container, so the
	 *  stub needs both — this is the line that costs an hour if it is missing. */
	activeElement: unknown;
	addEventListener(): void;
	removeEventListener(): void;
	nodeType: number;
};

/* `Class`, not a plain object: react-dom tests nodes with `instanceof` against the
 *  constructors on `window` below, so a bare object literal is rejected as "not a
 *  DOM element" however complete it looks. */
class StubNodeBase {}
class StubElement extends StubNodeBase {}
class StubText extends StubNodeBase {}
class StubComment extends StubNodeBase {}
class StubDocumentBase {}

function makeNode(doc: StubDocument, nodeType: number, name = "DIV"): StubNode {
	const children: StubNode[] = [];
	const proto =
		nodeType === 3 ? StubText : nodeType === 8 ? StubComment : StubElement;
	const node: StubNode = Object.assign(new proto(), {
		nodeType,
		nodeName: nodeType === 3 ? "#text" : name,
		tagName: nodeType === 3 ? undefined : name,
		parentNode: null,
		childNodes: children,
		style: {},
		ownerDocument: doc,
		appendChild(child: StubNode) {
			child.parentNode = node;
			children.push(child);
			return child;
		},
		removeChild(child: StubNode) {
			const at = children.indexOf(child);
			if (at !== -1) children.splice(at, 1);
			child.parentNode = null;
			return child;
		},
		insertBefore(child: StubNode, ref: StubNode | null) {
			child.parentNode = node;
			const at = ref === null ? children.length : children.indexOf(ref);
			children.splice(at === -1 ? children.length : at, 0, child);
			return child;
		},
		addEventListener() {},
		removeEventListener() {},
		setAttribute() {},
		getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
	}) as unknown as StubNode;
	return node;
}

let container: StubNode;

beforeEach(() => {
	const doc = Object.assign(new StubDocumentBase(), {
		nodeType: 9,
		activeElement: null,
		addEventListener() {},
		removeEventListener() {},
	}) as unknown as StubDocument;
	doc.createElement = () => makeNode(doc, 1);
	doc.createTextNode = () => makeNode(doc, 3);
	doc.createComment = () => makeNode(doc, 8);
	container = makeNode(doc, 1);
	const globals = globalThis as unknown as Record<string, unknown>;
	globals.window = {
		document: doc,
		Element: StubElement,
		HTMLElement: StubElement,
		Node: StubNodeBase,
		Text: StubText,
		Comment: StubComment,
		Document: StubDocumentBase,
		/* The names react-dom asks `instanceof` about while walking focus. They have no
		 *  behaviour here — the page has no focusable nodes — but they must EXIST, or
		 *  the check throws instead of answering "no". */
		HTMLIFrameElement: class {},
		SVGElement: class {},
		DocumentFragment: class {},
		Event: class {},
		MouseEvent: class {},
		addEventListener() {},
		removeEventListener() {},
		navigator: { userAgent: "node" },
	};
	globals.document = doc;
});

afterEach(() => {
	const globals = globalThis as unknown as Record<string, unknown>;
	delete globals.window;
	delete globals.document;
});

/** What a renderer is told about its own place in the stack. */
type Reading = { dims: boolean; covered: boolean } | undefined;

/**
 * A modal that behaves like the real ones: it stays MOUNTED with `visible={false}`
 * while its content is on screen, and reports what the hook decided.
 */
function FadeModal({
	visible,
	report,
}: {
	visible: boolean;
	report: (r: Reading) => void;
}) {
	const { dims, covered } = useModalStackEntry(visible);
	report({ dims, covered });
	return createElement("div", null);
}

const mount = () => {
	const root = createRoot(container as unknown as Element);
	return {
		render: async (element: ReturnType<typeof createElement>) => {
			await act(async () => {
				root.render(element);
			});
		},
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
		},
	};
};

describe("the modal stack hook", () => {
	it("keeps the dim on a dismissing modal while its content is mounted, and hands it over once", async () => {
		let a: Reading;
		let b: Reading;
		const { render, unmount } = mount();
		const aModal = (visible: boolean) =>
			createElement(FadeModal, { visible, report: (r: Reading) => (a = r) });
		const bModal = (visible: boolean) =>
			createElement(FadeModal, { visible, report: (r: Reading) => (b = r) });

		// open A: A is the dimmer
		await render(aModal(true));
		expect(a?.dims).toBe(true);

		// dismiss A: its Modal keeps the content mounted through the fade, so the dim
		// must stay — this is the reading round 9's `!visible` branch overwrote
		await render(aModal(false));
		expect(a?.dims).toBe(true);

		// B opens DURING A's fade: B takes the dim and A stops drawing it — one, not two
		await render(createElement(Fragment, null, aModal(false), bModal(true)));
		expect(a?.dims).toBe(false);
		expect(b?.dims).toBe(true);

		// B dismisses with nothing else registered: B keeps its own dim through its fade
		await render(createElement(Fragment, null, aModal(false), bModal(false)));
		expect(b?.dims).toBe(true);
		expect(a?.dims).toBe(false);

		await unmount();
	});

	it("survives StrictMode, which mounts, unmounts and mounts again", async () => {
		let a: Reading;
		let b: Reading;
		const { render, unmount } = mount();
		const strict = (child: ReturnType<typeof createElement>) =>
			createElement(StrictMode, null, child);
		const aModal = (visible: boolean) =>
			createElement(FadeModal, { visible, report: (r: Reading) => (a = r) });
		const bModal = (visible: boolean) =>
			createElement(FadeModal, { visible, report: (r: Reading) => (b = r) });

		await render(strict(aModal(true)));
		expect(a?.dims).toBe(true);

		await render(strict(aModal(false)));
		expect(a?.dims).toBe(true);

		await render(
			strict(createElement(Fragment, null, aModal(false), bModal(true))),
		);
		expect(a?.dims).toBe(false);
		expect(b?.dims).toBe(true);

		await render(
			strict(createElement(Fragment, null, aModal(false), bModal(false))),
		);
		expect(b?.dims).toBe(true);
		expect(a?.dims).toBe(false);

		// reopen A after everything has dismissed — the kept handle must not confuse it
		await render(strict(aModal(true)));
		expect(a?.dims).toBe(true);

		await unmount();
	});
});
