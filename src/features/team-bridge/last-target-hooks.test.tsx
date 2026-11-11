import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ADA,
	conversation,
	OTHER_TENANT,
	SELF,
	TENANT,
} from "@/team-bridge/__tests__/fixtures";
import {
	clearTeamBridgeTargets,
	recallTeamBridgeTarget,
	rememberTeamBridgeTarget,
} from "@/team-bridge/last-target";
import {
	initialTeamBridgeState,
	type OrgData,
	type TeamBridgeState,
} from "@/team-bridge/store";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The list route's restore and the thread's record/fallback, driven from the
 * outside: a real reconciler, the router and Team Bridge state stubbed at
 * their seams, and the assertion is where the router was told to go.
 */
const host = vi.hoisted(() => ({
	pathname: "/team-bridge",
	replace: vi.fn(),
	push: vi.fn(),
	state: null as unknown as TeamBridgeState,
	listeners: new Set<() => void>(),
}));
vi.mock("expo-router", () => ({
	usePathname: () => host.pathname,
	useRouter: () => ({ replace: host.replace, push: host.push }),
}));
vi.mock("@/team-bridge/provider", () => ({
	useTeamBridgeState: <T,>(selector: (s: TeamBridgeState) => T): T =>
		useSyncExternalStore(
			(listener) => {
				host.listeners.add(listener);
				return () => host.listeners.delete(listener);
			},
			() => selector(host.state),
		),
}));

const { useRestoreLastTarget, useRememberedThread } = await import(
	"./last-target-hooks"
);

const org = (
	ids: string[],
	conversationsState: OrgData["conversationsState"] = "ready",
): OrgData => ({
	conversations: ids.map((id) => conversation({ id })),
	conversationsState,
	conversationsError: null,
	people: [],
	peopleIncomplete: false,
	peopleState: "ready",
	peopleError: null,
	refreshedAt: 1,
});
const setState = (next: Partial<TeamBridgeState>) => {
	host.state = { ...host.state, ...next };
	for (const listener of host.listeners) listener();
};
const openState = (orgs: Record<string, OrgData>, tenantId = TENANT) => ({
	...initialTeamBridgeState(),
	gate: "open" as const,
	selfAccountId: SELF,
	selectedTenantId: tenantId,
	orgs,
});

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
function Restore() {
	useRestoreLastTarget();
	return null;
}
const threadOpen = (conversationId: string) => ({
	pathname: "/team-bridge/[tenantId]/[conversationId]",
	params: { tenantId: TENANT, conversationId, restored: "1" },
});

beforeEach(() => {
	vi.clearAllMocks();
	clearTeamBridgeTargets();
	host.pathname = "/team-bridge";
	host.state = openState({ [TENANT]: org(["conv_general", "conv_ops"]) });
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("useRestoreLastTarget (target-less entry onto the list)", () => {
	it("goes straight to the remembered thread, replacing the list", async () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		await act(async () => root.render(<Restore />));
		expect(host.replace).toHaveBeenCalledTimes(1);
		expect(host.replace).toHaveBeenCalledWith(threadOpen("conv_ops"));
		expect(host.push).not.toHaveBeenCalled();
	});

	it("stays on the list with nothing remembered", async () => {
		await act(async () => root.render(<Restore />));
		expect(host.replace).not.toHaveBeenCalled();
	});

	it("waits for the conversation list, then restores", async () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		host.state = openState({ [TENANT]: org([], "loading") });
		await act(async () => root.render(<Restore />));
		expect(host.replace).not.toHaveBeenCalled();
		await act(async () =>
			setState({ orgs: { [TENANT]: org(["conv_general", "conv_ops"]) } }),
		);
		expect(host.replace).toHaveBeenCalledWith(threadOpen("conv_ops"));
	});

	it("Back from a push that landed while the list was loading does not bounce into it (R1-1 / U1-5)", async () => {
		// The reviewer's sequence: a memory exists, the list mounts and waits for
		// the organization, a push or deep link opens X over it, X becomes the
		// memory, the list turns ready underneath, and the reader presses Back.
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		host.state = openState({ [TENANT]: org([], "loading") });
		await act(async () => root.render(<Restore />));
		host.pathname = `/team-bridge/${TENANT}/conv_general`;
		await act(async () => root.render(<Restore />));
		rememberTeamBridgeTarget(SELF, TENANT, "conv_general");
		await act(async () =>
			setState({ orgs: { [TENANT]: org(["conv_general", "conv_ops"]) } }),
		);
		host.pathname = "/team-bridge";
		await act(async () => root.render(<Restore />));
		expect(host.replace).not.toHaveBeenCalled();
		expect(host.push).not.toHaveBeenCalled();
	});

	it("a stale target falls back to the list and is cleared", async () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_removed");
		await act(async () => root.render(<Restore />));
		expect(host.replace).not.toHaveBeenCalled();
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
	});

	it("switching org restores THAT org's last target, or its list", async () => {
		rememberTeamBridgeTarget(SELF, OTHER_TENANT, "conv_other_ops");
		host.state = openState({
			[TENANT]: org(["conv_general"]),
			[OTHER_TENANT]: org(["conv_other_ops"]),
		});
		await act(async () => root.render(<Restore />));
		expect(host.replace).not.toHaveBeenCalled(); // TENANT has no memory
		await act(async () => setState({ selectedTenantId: OTHER_TENANT }));
		expect(host.replace).toHaveBeenCalledWith({
			pathname: "/team-bridge/[tenantId]/[conversationId]",
			params: {
				tenantId: OTHER_TENANT,
				conversationId: "conv_other_ops",
				restored: "1",
			},
		});
	});

	it("never overrides an explicit target: only the focused list route restores", async () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		host.pathname = `/team-bridge/${TENANT}/conv_general`;
		await act(async () => root.render(<Restore />));
		expect(host.replace).not.toHaveBeenCalled();
	});

	it("decides once per mount: returning to the list does not bounce back", async () => {
		await act(async () => root.render(<Restore />));
		// The reader opens a thread (memory recorded), then comes Back.
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		host.pathname = `/team-bridge/${TENANT}/conv_ops`;
		await act(async () => root.render(<Restore />));
		host.pathname = "/team-bridge";
		await act(async () => root.render(<Restore />));
		expect(host.replace).not.toHaveBeenCalled();
	});

	it("another account's memory is invisible to this one", async () => {
		rememberTeamBridgeTarget(ADA, TENANT, "conv_ops");
		await act(async () => root.render(<Restore />));
		expect(host.replace).not.toHaveBeenCalled();
	});
});

describe("useRememberedThread (the thread records and handles a gone target)", () => {
	type Input = Parameters<typeof useRememberedThread>[0];
	let gone: () => void = () => {};
	function Thread(props: Input) {
		gone = useRememberedThread(props);
		return null;
	}
	const input = (over: Partial<Input> = {}): Input => ({
		admitted: true,
		accountId: SELF,
		tenantId: TENANT,
		conversationId: "conv_general",
		restored: false,
		threadErrorStatus: null,
		...over,
	});

	it("an explicit open (push/deep link) overrides and updates the memory", async () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		await act(async () =>
			root.render(<Thread {...input({ conversationId: "conv_general" })} />),
		);
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBe("conv_general");
	});

	it("records only an admitted conversation", async () => {
		await act(async () =>
			root.render(<Thread {...input({ admitted: false })} />),
		);
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
	});

	it("a restored thread that answers 404 forgets it and falls back to the list", async () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_general");
		await act(async () =>
			root.render(
				<Thread
					{...input({
						admitted: false,
						restored: true,
						threadErrorStatus: 404,
					})}
				/>,
			),
		);
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
		expect(host.replace).toHaveBeenCalledWith("/team-bridge");
	});

	it("a metadata 403 on a restored thread does the same through gone()", async () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_general");
		await act(async () =>
			root.render(<Thread {...input({ admitted: false, restored: true })} />),
		);
		await act(async () => gone());
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
		expect(host.replace).toHaveBeenCalledWith("/team-bridge");
	});

	it("an explicit target that is gone keeps its error screen (no redirect)", async () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_general");
		await act(async () =>
			root.render(
				<Thread {...input({ admitted: false, threadErrorStatus: 403 })} />,
			),
		);
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
		expect(host.replace).not.toHaveBeenCalled();
	});
});
