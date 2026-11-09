import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* Stable callback identity is still required: shared drawer close re-renders Home.
 * The phone now consumes a provider-owned intent rather than receiving a second
 * local callback. Pin both halves, with the mounted consumed-once behaviour in
 * workspace-drawer.test.tsx and dismissal ordering in drawer-focus.test.ts. */

const home = readFileSync(resolve(import.meta.dirname, "home.tsx"), "utf8");
const drawerOwner = readFileSync(
	resolve(import.meta.dirname, "use-home-drawer.ts"),
	"utf8",
);

const GUARDED_INTENT =
	/if \(consumeNewChatRequest\(newChatRequest\)\) newChat\(\);/;
const NEW_CHAT_BINDING = /onNewChat=\{newChat\}/g;

const newChatBlock = () => {
	const start = home.indexOf("const newChat = useCallback(");
	expect(start).toBeGreaterThan(-1);
	const end = home.indexOf("}, [closeDrawer]);", start);
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

	it("uses the shared controller for open and consumes each phone draft intent once", () => {
		// The mounted owner regressions exercise this hook with the real provider;
		// bind Home to the SAME split decision that renders its persistent pane.
		expect(home).toContain("const split = layout.split;");
		expect(home).toContain("useHomeDrawer(forcePanelOpen, split);");
		expect(drawerOwner).toContain(
			"const { open, close } = useWorkspaceDrawer();",
		);
		expect(home).toContain("<WorkspaceDrawerButton />");
		expect(home).not.toContain("setPanelOpen");
		expect(newChatBlock()).toContain("closeDrawer()");
		expect(home.match(NEW_CHAT_BINDING)).toHaveLength(1);
		expect(home).toMatch(GUARDED_INTENT);
		// An unconditional effect must fail: route focus alone is not a new draft.
		expect(
			home.replace("if (consumeNewChatRequest(newChatRequest)) ", ""),
		).not.toMatch(GUARDED_INTENT);
	});
});
