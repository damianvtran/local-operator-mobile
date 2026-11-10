import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("./sheet.tsx", import.meta.url), "utf8");
const start = source.indexOf("onDismiss={") + "onDismiss={".length;
const end = source.indexOf("// The covered application", start);
if (start < 11 || end < 0)
	throw Error("Sheet's native Modal dismissal missing");
const raw = source.slice(start, end).trim();
const expression = stripTypeScriptTypes(
	`const callback = (${raw.slice(0, -1)}); callback;`,
);
describe("Sheet dismissal platform contract", () => {
	it.each(["ios", "android"])(
		"forwards only the caller on %s, never the web ledger",
		(OS) => {
			const onDismiss = vi.fn(),
				dismissed = vi.fn();
			const callback = runInNewContext(expression, {
				Platform: { OS },
				onDismiss,
				dismissed,
			});
			expect(callback).toBe(onDismiss);
			callback();
			expect(onDismiss).toHaveBeenCalledTimes(1);
			expect(dismissed).not.toHaveBeenCalled();
		},
	);
	/** A document whose nodes accept or refuse focus the way the browser does:
	 *  `focus()` on a hidden or inert node is a silent no-op. */
	const dom = (nodes: Record<string, { focusable: boolean }[]>) => {
		const events: string[] = [];
		const body = {};
		const document = {
			body,
			activeElement: body as unknown,
			querySelectorAll: (selector: string) =>
				(nodes[selector.slice('[data-testid="'.length, -2)] ?? []).map(
					(node, index) => {
						const element = {
							focus: () => {
								const id = selector.slice('[data-testid="'.length, -2);
								events.push(`try:${id}#${index}`);
								if (node.focusable) document.activeElement = element;
							},
						};
						return element;
					},
				),
		};
		return { events, document };
	};
	const dismiss = (
		returnFocusTestID: string | readonly string[],
		host: ReturnType<typeof dom>,
	) =>
		runInNewContext(expression, {
			Platform: { OS: "web" },
			visible: false,
			returnFocusTestID,
			document: host.document,
			dismissed: () => host.events.push("ledger"),
			onDismiss: () => host.events.push("caller"),
		})();

	it("retains web focus return then ledger settlement then the caller", () => {
		const host = dom({ "home-chip": [{ focusable: true }] });
		dismiss("home-chip", host);
		expect(host.events).toEqual(["try:home-chip#0", "ledger", "caller"]);
	});

	/* UX round 1, U2: a session screen has no Home chip (absent, or mounted but
	 *  hidden under the stack), and the drawer row that opened the sheet is gone
	 *  or inert. Focus must reach the first candidate that TAKES it. */
	it("walks a fallback list past absent and unfocusable candidates", () => {
		const host = dom({
			// Home's chip: still mounted under the session screen, hidden.
			"home-chip": [{ focusable: false }],
			// The drawer row: unmounted.
			// The drawer's opener: Home's hidden copy first, then the session's.
			"session-back": [{ focusable: false }, { focusable: true }],
			"home-sidebar": [{ focusable: true }],
		});
		dismiss(["home-chip", "drawer-row", "session-back", "home-sidebar"], host);
		expect(host.events).toEqual([
			"try:home-chip#0",
			"try:session-back#0",
			"try:session-back#1",
			"ledger",
			"caller",
		]);
	});

	it("still settles the ledger and the caller when nothing takes focus", () => {
		const host = dom({});
		dismiss(["home-chip", "session-back"], host);
		expect(host.events).toEqual(["ledger", "caller"]);
	});
});
