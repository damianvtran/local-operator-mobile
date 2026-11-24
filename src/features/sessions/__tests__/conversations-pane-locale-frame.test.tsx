/**
 * The mounted conversations pane repaints its section headers on a late
 * backend language frame (PR #302 design review, D2).
 *
 * THE DEFECT. `ConversationsPane` keeps its list items — section headers
 * included — in `useMemo(() => buildItems(groups), [groups])`. The header label
 * is a `t()` reading taken inside that memo, and `t()` reads the locale at CALL
 * time, so a re-render alone is not enough: the memo has to re-run. Nothing in
 * its dependency list moves on a language frame, and the pane did not subscribe
 * to one, so "Running"/"Older" kept the previous language until the minute tick
 * moved `now` (and with it `groups`).
 *
 * WHY A MOUNTED TEST, AND WHY FAKE TIMERS. Only a real render through the memo
 * proves a frame moves the painted words. The language moves ONLY through the
 * config store's real reducer; the timers are fake so the pane's 60 s tick
 * cannot fire and hand the memo an unrelated reason to re-run, which would
 * mask the defect. Everything Node cannot load, and every child this contract
 * does not read, is a boundary stub: react-native's primitives (recorded;
 * `FlatList` calls the pane's own `renderItem`), the connection provider's
 * hooks (a fixed list, and `useLocaleFrame` bound to this test's config store
 * as `session-row-locale-frame.test.tsx` does), the drawer chrome, the sheets
 * and the rows themselves — the ROW's repaint is proved in that sibling test.
 * The pane, `arrangeSidebar`, `buildItems` and the real `SectionHeader` run.
 */
import {
	act,
	createElement,
	Fragment,
	isValidElement,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "zustand";
import type { SessionSummary } from "@/contracts";
import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";
import { createConfigStore } from "@/state/config-store";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

const NOW_MS = 1_800_000_000_000;

const host = vi.hoisted(() => ({
	texts: [] as string[],
	sessions: [] as unknown[],
	store: null as unknown as ReturnType<
		typeof import("@/state/config-store").createConfigStore
	>,
}));

function strings(node: unknown): string[] {
	if (typeof node === "string") return [node];
	if (Array.isArray(node)) return node.flatMap(strings);
	return [];
}

/** Records every string prop and string child it is handed. */
function Recorder(props: Record<string, unknown>): ReactNode {
	const nested: ReactNode[] = [];
	for (const [name, value] of Object.entries(props)) {
		if (name === "children") continue;
		if (typeof value === "string") host.texts.push(value);
		else if (isValidElement(value)) nested.push(value);
	}
	const children =
		typeof props.children === "function"
			? (props.children as (state: { pressed: boolean }) => ReactNode)({
					pressed: false,
				})
			: (props.children as ReactNode);
	host.texts.push(...strings(children));
	return createElement(Fragment, null, ...nested, children ?? null);
}

/** The list primitive renders each item through the pane's own `renderItem`,
 *  the one place the section headers are drawn. */
function FlatList(props: {
	data: readonly unknown[];
	renderItem: (info: { item: unknown; index: number }) => ReactNode;
	keyExtractor?: (item: unknown, index: number) => string;
	ListHeaderComponent?: unknown;
	ListFooterComponent?: unknown;
	ListEmptyComponent?: unknown;
}): ReactNode {
	return createElement(
		Fragment,
		null,
		...props.data.map((item, index) =>
			createElement(
				Fragment,
				{ key: props.keyExtractor?.(item, index) ?? String(index) },
				props.renderItem({ item, index }),
			),
		),
	);
}

vi.mock("react-native", () => ({
	View: Recorder,
	Text: Recorder,
	Pressable: Recorder,
	TextInput: () => null,
	RefreshControl: () => null,
	FlatList,
	Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios },
	PixelRatio: { getFontScale: () => 1 },
	Dimensions: {
		get: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
		addEventListener: () => ({ remove: () => undefined }),
	},
	useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
	StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
}));
vi.mock("lucide-react-native", () => {
	const Icon = () => null;
	return {
		ArrowRightLeft: Icon,
		CalendarClock: Icon,
		ChevronRight: Icon,
		FolderKanban: Icon,
		History: Icon,
		Inbox: Icon,
		Library: Icon,
		MessageSquare: Icon,
		Pin: Icon,
		PinOff: Icon,
		Search: Icon,
		Settings: Icon,
		SquarePen: Icon,
		Tag: Icon,
		X: Icon,
	};
});
vi.mock("expo-router", () => ({
	useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000000",
	useReducedMotion: () => true,
	useKeyboardAppearance: () => "light",
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useLocaleFrame: () => useStore(host.store, (state) => state.language),
	useConnection: () => ({
		refreshList: () => undefined,
		// A function, not null: since 9e1a2ac3 the pane calls relay() during render.
		relay: () => null,
		busy: false,
		streamHealth: "live",
		lastError: null,
	}),
	useConnectionState: (
		selector: (state: { route: unknown }) => unknown,
	): unknown => selector({ route: { kind: "lan" } }),
	useListState: (selector: (state: Record<string, unknown>) => unknown) =>
		selector({
			sessions: host.sessions,
			degraded: [],
			frameCount: 1,
			stale: false,
			lastFrameAt: null,
			capabilities: {},
			notifications: null,
		}),
}));
vi.mock("@/features/sessions/use-sidebar-view", async () => {
	const { DEFAULT_SIDEBAR_VIEW } = await import(
		"@/features/sessions/sidebar-view"
	);
	return {
		useSidebarView: () => ({
			view: DEFAULT_SIDEBAR_VIEW,
			setView: () => undefined,
		}),
	};
});
vi.mock("@/features/sessions/session-row", () => ({ SessionRow: () => null }));
vi.mock("@/features/sessions/sidebar-view-sheet", () => ({
	SidebarViewButton: () => null,
}));
vi.mock("@/features/sessions/tags-sheet", () => ({
	SessionTagsSheet: () => null,
}));
vi.mock("@/features/sessions/move-sheet", () => ({
	SessionMoveSheet: () => null,
}));
vi.mock("@/features/sessions/workspace-drawer-context", () => ({
	useOptionalWorkspaceDrawer: () => null,
}));
vi.mock("@/features/sessions/workspace-mode-bar", () => ({
	WorkspaceModeBar: () => null,
}));
vi.mock("@/features/auth/computer-entry-points", () => ({
	DrawerComputerRow: () => null,
	switcherFocusReturn: () => undefined,
}));
vi.mock("@/features/auth/computer-switcher-sheet", () => ({
	useComputerSwitcher: () => ({ open: () => undefined }),
}));
vi.mock("@/features/notifications/notifications-off-row", () => ({
	NotificationsOffRow: () => null,
}));
vi.mock("@/team-bridge/navigation", () => ({ TeamBridgeEntry: () => null }));
vi.mock("@/ui/components/connection-pill", () => ({
	ConnectionPill: () => null,
}));
vi.mock("@/ui/components/sheet", () => ({ Sheet: () => null }));
vi.mock("@/ui/components/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/ui/components/skeleton", () => ({ Skeleton: () => null }));

const session = (
	id: string,
	overrides: Partial<Record<string, unknown>>,
): SessionSummary =>
	({
		session_id: id,
		section: "active",
		pinned: false,
		conversation_name: id,
		cwd: `/home/me/${id}`,
		model_label: "anthropic/claude-opus-5",
		streaming: false,
		needs_attention: false,
		unseen: false,
		pending_kind: "",
		leaving: "",
		updating: "",
		subagents_running: 0,
		subagents_queued: 0,
		todos_open: 0,
		mtime: NOW_MS / 1000 - 60,
		completion_kind: "",
		tags: [],
		...overrides,
	}) as unknown as SessionSummary;

/** The headers this fixture draws: one running row, one 60-day-old row. */
const HEADERS = [
	"mobile.sidebar.section.running",
	"mobile.sidebar.section.older",
] as const;

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	vi.useFakeTimers({ now: NOW_MS });
	host.store = createConfigStore({ now: () => 1 });
	host.texts = [];
	host.sessions = [
		session("running-one", { streaming: true }),
		session("older-one", { mtime: NOW_MS / 1000 - 60 * 86_400 }),
	];
	setLocaleSource(() => host.store.getState().language);
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	resetLocaleSource();
	vi.useRealTimers();
});

const frame = (language: string, at: number): void =>
	host.store
		.getState()
		.applyFrame({ changed_keys: ["language"], language }, at);

const painted = (text: string): boolean => host.texts.includes(text);

describe("the mounted conversations pane repaints its headers on a language frame", () => {
	it("follows fr → ur without the minute tick", async () => {
		const { ConversationsPane } = await import(
			"@/features/sessions/conversations-pane"
		);
		for (const key of HEADERS) {
			// Guard: a header whose fr and ur (or ur and English) read the same
			// could pass without any repaint.
			expect(renderFor(key, {}, "fr")).not.toBe(renderFor(key, {}, "ur"));
			expect(renderFor(key, {}, "ur")).not.toBe(renderFor(key, {}, "en"));
		}
		frame("fr", 2);
		await act(async () =>
			root.render(
				createElement(ConversationsPane, {
					onClose: () => undefined,
					onNavigate: () => undefined,
					onNewChat: () => undefined,
					homeDirectory: "/home/me",
				} as unknown as Parameters<typeof ConversationsPane>[0]),
			),
		);
		for (const key of HEADERS) {
			expect(painted(renderFor(key, {}, "fr"))).toBe(true);
		}

		host.texts = [];
		await act(async () => frame("ur", 3));
		for (const key of HEADERS) {
			expect(painted(renderFor(key, {}, "ur"))).toBe(true);
			expect(painted(renderFor(key, {}, "fr"))).toBe(false);
		}
	});
});
