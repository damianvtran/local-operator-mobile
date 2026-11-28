import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { DURATIONS } from "@/ui/tokens.gen";

/**
 * UX U5 (PR #402): Share, Stop sharing and Share again each unmount the control
 * that was pressed, so keyboard focus fell to `<body>` and the next Tab restarted
 * at the top of the screen. The outcome line now takes focus — but ONLY when
 * focus was actually lost (a sheet that returned focus to a control that still
 * exists keeps its own return), and a phone moves the screen reader's cursor to
 * the same line. The primitives are stubbed (Node has no React Native host) with
 * a View that forwards its ref to a recorder, so the focus CALLS are the thing
 * measured.
 */
const host = vi.hoisted(() => ({
	platform: { OS: "web" as string },
	focused: [] as unknown[],
	a11yFocus: [] as unknown[],
	node: { focus: (options?: unknown) => host.focused.push(options) },
}));

vi.mock("react-native", async () => {
	const React = await import("react");
	return {
		Platform: host.platform,
		View: React.forwardRef(
			({ children }: { children?: ReactNode }, ref: unknown) => {
				React.useImperativeHandle(ref as never, () => host.node as never);
				return <>{children}</>;
			},
		),
		Text: ({ children }: { children?: ReactNode }) => <>{children}</>,
		Linking: {},
		AccessibilityInfo: {
			setAccessibilityFocus: (handle: unknown) => host.a11yFocus.push(handle),
		},
		findNodeHandle: () => 42,
	};
});
/* `guard-views` reaches the controller hooks (use-guard): their router and
 *  connection seams are not what is measured here. */
vi.mock("expo-router", () => ({ useIsFocused: () => true }));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({ relay: () => null, streamHealth: "live" }),
	useConnectionState: () => null,
	useListState: () => null,
	useLocaleFrame: () => null,
}));
vi.mock("@/ui/components/alert", () => ({
	Alert: ({ children }: { children: string }) => <>{children}</>,
}));
vi.mock("@/ui/components/button", () => ({ Button: () => null }));
vi.mock("@/ui/components/sheet", () => ({ Sheet: () => null }));

const { GuardOutcomeAlert } = await import("./guard-views");

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const body = { tagName: "BODY" };
const mount = (outcome: { kind: "revoked"; org: string }) =>
	act(async () => root.render(<GuardOutcomeAlert outcome={outcome} />));

beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as Element);
	host.focused = [];
	host.a11yFocus = [];
	host.platform.OS = "web";
	(globalThis as { document?: unknown }).document = {
		body,
		activeElement: body,
	};
	vi.useFakeTimers();
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	vi.useRealTimers();
});

const AFTER_EXIT = DURATIONS.fast + 40;

describe("the outcome takes focus after the member's own act", () => {
	it("web, focus lost to <body>: the outcome is focused once the sheet's exit has had its turn", async () => {
		await mount({ kind: "revoked", org: "Example Org" });
		await act(async () => vi.advanceTimersByTime(AFTER_EXIT - 1));
		expect(host.focused).toEqual([]);
		await act(async () => vi.advanceTimersByTime(1));
		expect(host.focused).toEqual([{ preventScroll: true }]);
	});

	it("web, focus already on a control that still exists: it is left alone", async () => {
		(document as unknown as { activeElement: unknown }).activeElement = {
			tagName: "BUTTON",
		};
		await mount({ kind: "revoked", org: "Example Org" });
		await act(async () => vi.advanceTimersByTime(AFTER_EXIT * 2));
		expect(host.focused).toEqual([]);
	});

	it("a phone moves the screen reader's cursor to the line instead", async () => {
		host.platform.OS = "ios";
		await mount({ kind: "revoked", org: "Example Org" });
		await act(async () => vi.advanceTimersByTime(AFTER_EXIT));
		expect(host.a11yFocus).toEqual([42]);
		expect(host.focused).toEqual([]);
	});

	it("a new result re-focuses, and an unmounted line never does", async () => {
		await mount({ kind: "revoked", org: "A" });
		await mount({ kind: "revoked", org: "B" });
		await act(async () => vi.advanceTimersByTime(AFTER_EXIT));
		// The first timer was cleared by the second outcome: one focus, not two.
		expect(host.focused).toHaveLength(1);
		await act(async () => root.render(null));
		await act(async () => vi.advanceTimersByTime(AFTER_EXIT * 2));
		expect(host.focused).toHaveLength(1);
	});
});
