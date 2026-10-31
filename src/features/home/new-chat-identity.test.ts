import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* Regression guard for the QA MAJOR: `New session` in the drawer did nothing on
 * web once a conversation was active. The drawer keeps the New-chat intent across
 * the close and consumes it in `onDismiss`, and its effect cancels that intent
 * when the `onNewChat` prop's identity changes. Home re-renders for
 * `setPanelOpen(false)` between those two moments, so an inline closure — a fresh
 * function on every render — cancelled the very request the tap had made.
 *
 * This repository's test toolchain has no React renderer, so the identity cannot
 * be rendered here. These assertions pin the mechanical half: the callback is
 * created once by `useCallback`, it reads the coordinator through a ref (so it is
 * stable without being frozen to a stale one), and both hosts receive the same
 * binding. `drawer-focus.test.ts` carries the behavioural half. */

const home = readFileSync(resolve(import.meta.dirname, "home.tsx"), "utf8");

const newChatBlock = () => {
	const start = home.indexOf("const newChat = useCallback(");
	expect(start).toBeGreaterThan(-1);
	const end = home.indexOf("}, []);", start);
	expect(end).toBeGreaterThan(start);
	return home.slice(start, end);
};

describe("home New-chat callback identity", () => {
	it("is memoised, so the drawer's close cannot cancel its own request", () => {
		// The shape that shipped the bug: rebuilt on every render.
		expect(home).not.toContain("const newChat = () => {");
		expect(newChatBlock()).toContain("newConversationRef");
	});

	it("calls the latest coordinator through a ref rather than a captured one", () => {
		expect(home).toContain(
			"newConversationRef.current = startup.newConversation;",
		);
		expect(newChatBlock()).toContain(".current()");
	});

	it("hands the same binding to the docked pane and the phone drawer", () => {
		const bindings = home.match(/onNewChat=\{newChat\}/g) ?? [];
		expect(bindings).toHaveLength(2);
	});
});
