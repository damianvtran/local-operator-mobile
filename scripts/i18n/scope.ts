import { parse, parseExpression } from "@babel/parser";

export const HOME_KEYS = {
	GREETING: "mobile.home.greeting",
	STARTING: "mobile.home.starting",
	CONNECT_DISABLED_REASON: "mobile.home.connect_disabled",
	REFUSED_START_FALLBACK: "mobile.home.start_refused",
	FOLDERS_READ_FAILED: "mobile.home.folders_failed",
	CONNECT_COMPUTER: "mobile.home.connect",
} as const;

export interface HomeSources {
	copy: string;
	splash: string;
	home: string;
}
interface Node {
	type: string;
	[key: string]: unknown;
}
const isNode = (value: unknown): value is Node => value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";
function child(node: Node, key: string): Node | undefined {
	const value = node[key];
	return isNode(value) ? value : undefined;
}
function list(node: Node, key: string): Node[] {
	const value = node[key];
	return Array.isArray(value) ? value.filter(isNode) : [];
}
const options = { sourceType: "module", plugins: ["typescript", "jsx"] } as const;
const parseSource = (source: string): Node => parse(source, { ...options, plugins: [...options.plugins] }) as unknown as Node;
const parseValue = (source: string): Node => parseExpression(source, { ...options, plugins: [...options.plugins] }) as unknown as Node;
const METADATA = new Set(["start", "end", "loc", "extra", "leadingComments", "trailingComments", "innerComments", "comments", "tokens", "errors"]);
function shape(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(shape);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !METADATA.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, shape(item)]));
	return value;
}
const equalExpression = (node: Node | undefined, expected: string) => !!node && JSON.stringify(shape(node)) === JSON.stringify(shape(parseValue(expected)));
const expectExpression = (node: Node | undefined, expected: string, label: string) => {
	if (!equalExpression(node, expected)) throw new Error(`six-slot scope: non-keyed ${label}`);
};
function descendants(root: Node, matches: (node: Node) => boolean): Node[] {
	const found: Node[] = [];
	const walk = (node: Node) => {
		if (matches(node)) found.push(node);
		for (const value of Object.values(node)) {
			if (isNode(value)) walk(value);
			else if (Array.isArray(value)) for (const item of value) if (isNode(item)) walk(item);
		}
	};
	walk(root);
	return found;
}
function requireOne(nodes: Node[], label: string): Node {
	if (nodes.length !== 1 || !nodes[0]) throw new Error(`six-slot scope: expected exactly one ${label}`);
	return nodes[0];
}
const identifier = (node: Node | undefined, name: string) => node?.name === name;
const attributes = (node: Node): Node[] => {
	const opening = node.type === "JSXElement" ? child(node, "openingElement") : undefined;
	return opening ? list(opening, "attributes") : [];
};
const attribute = (node: Node, name: string) => attributes(node).find((prop) => prop.type === "JSXAttribute" && identifier(child(prop, "name"), name));
function element(root: Node, id: string): Node {
	return requireOne(descendants(root, (node) => {
		const value = child(attribute(node, "testID") ?? { type: "missing" }, "value");
		return value?.type === "JSXExpressionContainer" && equalExpression(child(value, "expression"), id);
	}), id);
}
function rejectAdditionalCopy(node: Node, label: string) {
	for (const name of ["accessibilityLabel", "accessibilityHint", "aria-label", "children", "text", "title"]) {
		if (attribute(node, name)) throw new Error(`six-slot scope: unreviewed extra copy attribute ${label}.${name}`);
	}
	if (attributes(node).some((prop) => prop.type === "JSXSpreadAttribute")) throw new Error(`six-slot scope: unbounded props in ${label}`);
}
function keyedAttribute(root: Node, id: string, name: string, expected: string) {
	const node = element(root, id);
	rejectAdditionalCopy(node, id);
	const value = child(attribute(node, name) ?? { type: "missing" }, "value");
	if (value?.type !== "JSXExpressionContainer") throw new Error(`six-slot scope: hardcoded ${id}.${name}`);
	expectExpression(child(value, "expression"), expected, `${id}.${name}`);
}
function keyedBody(node: Node, expected: string, label: string) {
	const children = list(node, "children").filter((item) => !(item.type === "JSXText" && typeof item.value === "string" && !item.value.trim()) && !(item.type === "JSXExpressionContainer" && child(item, "expression")?.type === "JSXEmptyExpression"));
	const body = requireOne(children, `${label} body`);
	if (body.type !== "JSXExpressionContainer") throw new Error(`six-slot scope: hardcoded ${label} text`);
	expectExpression(child(body, "expression"), expected, label);
}
function keyedText(root: Node, id: string, expected: string) {
	const node = element(root, id);
	rejectAdditionalCopy(node, id);
	keyedBody(node, expected, id);
}
const declaration = (root: Node, name: string) => requireOne(descendants(root, (node) => node.type === "VariableDeclarator" && identifier(child(node, "id"), name)), name);
const tag = (node: Node, name: string) => node.type === "JSXElement" && identifier(child(child(node, "openingElement") ?? { type: "missing" }, "name"), name);

/** Exactly six completed slots, not a whole-Home ratchet. Bind declarations AND
 * actual render sinks: novel English replacements, concatenation, extra children,
 * accessibility copy or missing/renamed carriers fail without a baseline or a
 * list of yesterday's literals. Babel is already in the locked Expo closure;
 * its explicitly declared stable TS/JSX parser avoids TS7's native unstable API. */
export function checkHomeScope(sources: HomeSources): void {
	const copy = parseSource(sources.copy);
	for (const [name, key] of Object.entries(HOME_KEYS)) {
		const value = child(declaration(copy, name), "init");
		const initializer = value?.type === "TSSatisfiesExpression" ? child(value, "expression") : value;
		expectExpression(initializer, JSON.stringify(key), name);
	}
	const splash = parseSource(sources.splash);
	keyedText(splash, "SURFACE.homeGreeting", "t(GREETING)");
	keyedText(splash, "SURFACE.homeStarting", "t(STARTING)");
	keyedAttribute(splash, "CONTROL.homeConnect", "label", "t(CONNECT_COMPUTER)");
	const home = parseSource(sources.home);
	keyedAttribute(home, "CONTROL.homeFoldersBanner", "message", "t(FOLDERS_READ_FAILED)");
	const disabled = requireOne(descendants(home, (node) => node.type === "ObjectProperty" && identifier(child(node, "key"), "disabledReason")), "disabledReason");
	expectExpression(child(disabled, "value"), "connected ? null : t(CONNECT_DISABLED_REASON)", "disabledReason");
	const fallback = requireOne(descendants(home, (node) => node.type === "CallExpression" && identifier(child(node, "callee"), "setProblem") && list(node, "arguments")[0]?.type === "ConditionalExpression"), "refused-start state");
	expectExpression(list(fallback, "arguments")[0], 'error instanceof RelayError ? { kind: "relay", text: error.displayableMessage } : { kind: "fallback" }', "refused-start state");
	const refusalElement = requireOne(descendants(home, (node) => tag(node, "Alert")), "refusal alert");
	keyedBody(refusalElement, 'problem.kind === "fallback" ? t(REFUSED_START_FALLBACK) : problem.text', "refused-start render");
	// An otherwise keyed label still goes stale if the composer memo omits t.
	const controls = child(declaration(home, "controls"), "init");
	const dependencies = controls && list(controls, "arguments")[1];
	if (!dependencies || dependencies.type !== "ArrayExpression" || !list(dependencies, "elements").some((node) => identifier(node, "t"))) throw new Error("six-slot scope: composer memo missing translator dependency");
	expectExpression(child(declaration(home, "t"), "init"), "useI18n(configStore)", "live translator");
	const splashUse = requireOne(descendants(home, (node) => tag(node, "HomeSplash")), "HomeSplash translator");
	const translator = child(attribute(splashUse, "t") ?? { type: "missing" }, "value");
	if (translator?.type !== "JSXExpressionContainer") throw new Error("six-slot scope: missing splash translator");
	expectExpression(child(translator, "expression"), "t", "splash translator");
}
