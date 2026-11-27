/** Runs the real tap resolver/coordinator with injected React/router/relay seams.
 * This verifies navigation ownership, not a native screen or OS delivery. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
	effects: [] as Array<() => unknown>,
	revision: 1,
	resolve: vi.fn(async (_handle: string) => ({ session_id: "session-a" })),
	navigate: vi.fn(),
	replace: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("react", () => ({
	useCallback: <T>(fn: T) => fn,
	useEffect: (effect: () => unknown) => seam.effects.push(effect),
	useMemo: (read: () => unknown) => read(),
	useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-router", () => ({
	router: { navigate: seam.navigate },
	useRouter: () => ({ navigate: seam.navigate, replace: seam.replace }),
	useNavigationContainerRef: () => ({
		isReady: () => false,
		getRootState: () => undefined,
		dispatch: () => undefined,
	}),
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({
		relay: () => ({ resolveConversation: seam.resolve }),
	}),
	useConnectionState: (select: (value: object) => unknown) =>
		select({ phase: "live", computers: [], tunnelId: null }),
	connectionStore: { getState: () => ({ revision: seam.revision }) },
}));
vi.mock("@/state/ui-store", () => ({
	useUiStore: (select: (value: object) => unknown) =>
		select({ showToast: seam.toast }),
}));

import { warmSync } from "@/state/warm-sync";
import { clearPendingDestination, noteConversationPush } from "./pending";
import { useDeepLinkResolution } from "./use-deep-link-resolution";

let retire: (() => void) | undefined;
beforeEach(() => {
	vi.clearAllMocks();
	seam.effects = [];
	seam.revision = 1;
	clearPendingDestination();
	seam.resolve.mockResolvedValue({ session_id: "session-a" });
});
afterEach(() => {
	retire?.();
	clearPendingDestination();
});
const flush = async () => {
	for (let tick = 0; tick < 12; tick++) await Promise.resolve();
};
const route = () => {
	useDeepLinkResolution();
	for (const effect of seam.effects) {
		effect();
		effect();
	}
};
describe("completion tap prefetch wiring", () => {
	it("receipt plus tap shares one seed and navigates once even if effects replay", async () => {
		let done!: (saved: boolean) => void;
		const seed = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					done = resolve;
				}),
		);
		retire = warmSync.register({
			isActive: () => true,
			seed,
			resolve: async (handle) => (await seam.resolve(handle)).session_id,
		});
		const received = warmSync.received("opaque-handle");
		await flush();
		noteConversationPush({
			computer: "opaque-computer",
			conversation: "opaque-handle",
		});
		route();
		await flush();
		expect(seed).toHaveBeenCalledTimes(1);
		expect(seam.navigate.mock.calls).toEqual([["/session/session-a"]]);
		expect(seam.replace).not.toHaveBeenCalled();
		done(true);
		expect(await received).toBe(true);
	});
	it("foreign handle refusal never prefetches or navigates to another computer", async () => {
		const seed = vi.fn(async () => true);
		retire = warmSync.register({
			isActive: () => true,
			seed,
			resolve: async () => "session-a",
		});
		seam.resolve.mockRejectedValue({ status: 404 });
		noteConversationPush({
			computer: "other-computer",
			conversation: "foreign-handle",
		});
		route();
		await flush();
		expect(seed).not.toHaveBeenCalled();
		expect(seam.navigate).not.toHaveBeenCalled();
		expect(seam.replace.mock.calls).toEqual([["/"]]);
		expect(seam.resolve).toHaveBeenCalledTimes(1);
	});
	it("route/account switch while tap resolves discards navigation and prefetch", async () => {
		let done!: (value: { session_id: string }) => void;
		seam.resolve.mockImplementation(
			() =>
				new Promise((resolve) => {
					done = resolve;
				}),
		);
		const seed = vi.fn(async () => true);
		retire = warmSync.register({
			isActive: () => true,
			seed,
			resolve: async () => "session-a",
		});
		noteConversationPush({
			computer: "opaque-computer",
			conversation: "opaque-handle",
		});
		route();
		seam.revision++;
		done({ session_id: "session-a" });
		await flush();
		expect(seed).not.toHaveBeenCalled();
		expect(seam.navigate).not.toHaveBeenCalled();
	});
});
