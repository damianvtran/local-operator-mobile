/**
 * A DOM just large enough for `react-dom` to render into, for the tests that
 * mount a real component tree in Node.
 *
 * WHY IT EXISTS. This repository's unit tests run in Node with no jsdom (see
 * `vitest.config.ts`: anything worth asserting lives in a plain module, and a
 * test that needs a real renderer belongs in the native E2E layer). The two
 * exceptions are component trees whose whole contract is what re-renders or what
 * a press does — the modal hook's fade and the transcript's row identity — and
 * those need `react-dom`'s client, which insists on real nodes: it tests them
 * with `instanceof` against constructors on `window` and calls
 * `createTextNode` for any string a component renders. Without this it answers
 * "not a DOM element" and throws.
 *
 * WHERE IT CAME FROM. `src/ui/components/modal-stack-entry.test.ts` grew the
 * same shim first; that copy is left alone rather than refactored, so this file
 * is the version the transcript tests share. If the shim ever stops working, fix
 * it here — it is not testing React DOM, it is letting a real reconciler run.
 *
 * WHAT IT DOES NOT DO: layout, focus, events. Every node is blank and every
 * listener is a no-op, so a test that needs geometry or a real press is in the
 * wrong layer.
 */
type StubNode = {
	nodeType: number;
	nodeName: string;
	/** A text node's own string. `createTextNode` is handed it and react-dom
	 *  reads it back through `nodeValue`, so a shim that drops it renders an empty
	 *  tree that still LOOKS populated. */
	nodeValue?: string | null;
	textContent?: string | null;
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
	activeElement: unknown;
	addEventListener(): void;
	removeEventListener(): void;
	nodeType: number;
};

/* `Class`, not a plain object: react-dom tests nodes with `instanceof` against
 *  the constructors on `window`, so a bare object literal is rejected as "not a
 *  DOM element" however complete it looks. */
class StubNodeBase {}
class StubElement extends StubNodeBase {}
class StubText extends StubNodeBase {}
class StubComment extends StubNodeBase {}
class StubDocumentBase {}

function makeNode(
	doc: StubDocument,
	nodeType: number,
	name = "DIV",
	text = "",
): StubNode {
	const children: StubNode[] = [];
	const proto =
		nodeType === 3 ? StubText : nodeType === 8 ? StubComment : StubElement;
	const node: StubNode = Object.assign(new proto(), {
		nodeType,
		nodeName: nodeType === 3 ? "#text" : name,
		nodeValue: nodeType === 3 ? text : null,
		textContent: nodeType === 3 ? text : null,
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

export type DomShim = {
	/** The container `createRoot` mounts into. */
	container: unknown;
	/** Restore the globals this shim took over. */
	dispose(): void;
};

/** Install the shim on `globalThis` and return the container to render into. */
export function installDomShim(): DomShim {
	const doc = Object.assign(new StubDocumentBase(), {
		nodeType: 9,
		activeElement: null,
		addEventListener() {},
		removeEventListener() {},
	}) as unknown as StubDocument;
	doc.createElement = () => makeNode(doc, 1);
	doc.createTextNode = (text: string) => makeNode(doc, 3, "#text", text);
	doc.createComment = () => makeNode(doc, 8);
	const container = makeNode(doc, 1);
	const globals = globalThis as unknown as Record<string, unknown>;
	const previous = {
		window: globals.window,
		document: globals.document,
		IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
	};
	globals.window = {
		document: doc,
		Element: StubElement,
		HTMLElement: StubElement,
		Node: StubNodeBase,
		Text: StubText,
		Comment: StubComment,
		Document: StubDocumentBase,
		/* The names react-dom asks `instanceof` about while walking focus. They
		 *  have no behaviour here — nothing is focusable — but they must EXIST, or
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
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	return {
		container,
		dispose() {
			globals.window = previous.window;
			globals.document = previous.document;
			globals.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
		},
	};
}
