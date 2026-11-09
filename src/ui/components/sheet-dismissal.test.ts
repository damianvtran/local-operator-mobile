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
	it("retains web focus return then ledger settlement then the caller", () => {
		const events: string[] = [];
		const body = {};
		const callback = runInNewContext(expression, {
			Platform: { OS: "web" },
			visible: false,
			returnFocusTestID: "home-chip",
			document: {
				body,
				activeElement: body,
				querySelector: () => ({ focus: () => events.push("focus") }),
			},
			dismissed: () => events.push("ledger"),
			onDismiss: () => events.push("caller"),
		});
		callback();
		expect(events).toEqual(["focus", "ledger", "caller"]);
	});
});
