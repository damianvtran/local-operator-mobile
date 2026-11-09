import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	attachmentCacheSize,
	cachedAttachment,
	loadAttachment,
} from "@/team-bridge/attachments";
import type { TeamBridgeStore } from "@/team-bridge/store";

/*
 * R1-01: the image cache must not survive a DIRECT account replacement (A→B
 * with no signed-out state between). Only the account-keyed provider remount
 * marks it; its teardown must reset the cache AND retire store publications. So
 * this mounts the real `TeamBridgeProvider` and changes `radientAccountId`
 * under it, the same way `holdRadientTokens` → `radientAccess.replace` does.
 *
 * Mocked: the connection context (its account id is the input), the router,
 * native notifications/push registration and the Expo-only fixture probe.
 * Production code: both providers, the account key, the store and the cache.
 * Mounted with ReactDOM's client renderer on a minimal Node DOM host, like
 * `connection-provider.test.ts`: lifecycle proof, not native-device proof.
 */

const connection = vi.hoisted(() => ({
	radientAccountId: "acct_a" as string | null,
}));

vi.mock("react-native", () => ({
	Platform: { OS: "web" },
	AppState: {
		currentState: "active",
		addEventListener: () => ({ remove() {} }),
	},
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push() {} }) }));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({
		radientAccountId: connection.radientAccountId,
		// Not settled: the provider's status/push effect stays idle, so the only
		// thing that can clear the cache is the account boundary under test.
		coldStartSettled: false,
		radientSignedIn: connection.radientAccountId !== null,
		radientAccessToken: async () =>
			connection.radientAccountId
				? `h.${Buffer.from(JSON.stringify({ sub: connection.radientAccountId })).toString("base64url")}.s`
				: null,
		radientRetirementAccessToken: async () => null,
	}),
}));
vi.mock("@/notifications/native", () => ({
	loadNotifications: async () => null,
}));
vi.mock("@/team-bridge/push", () => ({
	installTeamBridgeNotifications: async () => undefined,
	registerTeamBridgeDevice: async () => undefined,
	subscribeTeamBridgeTaps: async () => () => undefined,
	unregisterTeamBridgeDevice: async () => undefined,
}));
vi.mock("@/testing/team-bridge-fixture", () => ({
	teamBridgeFixture: () => null,
}));

const { TeamBridgeProvider, useTeamBridge } = await import(
	"@/team-bridge/provider"
);
let held: TeamBridgeStore | null = null;
function Capture() {
	held = useTeamBridge();
	return null;
}

let root: ReturnType<typeof createRoot> | null = null;

function host() {
	const doc = {
		nodeType: 9,
		activeElement: null,
		addEventListener() {},
		removeEventListener() {},
	};
	vi.stubGlobal("window", {
		document: doc,
		HTMLIFrameElement: class {},
		HTMLElement: class {},
		addEventListener() {},
		removeEventListener() {},
	});
	vi.stubGlobal("document", doc);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	return {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		ownerDocument: doc,
		addEventListener() {},
		removeEventListener() {},
	} as unknown as Element;
}

const render = async () => {
	await act(async () => {
		root?.render(
			createElement(TeamBridgeProvider, null, createElement(Capture)),
		);
	});
};

afterEach(async () => {
	await act(async () => {
		root?.unmount();
		root = null;
	});
	vi.unstubAllGlobals();
});

describe("Team Bridge provider account boundary", () => {
	it("a retired account's final upload 401 cannot clear the replacement's images or replay as it", async () => {
		connection.radientAccountId = "acct_a";
		let finish!: (response: Response) => void;
		const transport = vi.fn(async () => new Response("{}", { status: 401 }));
		transport.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				}),
		);
		vi.stubGlobal("fetch", transport);
		root = createRoot(host());
		await render();
		const old = held;
		if (!old) throw new Error("Expected mounted Bridge context");
		old.store.setState({ gate: "open", selfAccountId: "acct_a" });
		const pending = old.actions.uploadAttachment(
			"ten_example",
			"c1",
			new Uint8Array([1]),
		);
		await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
		connection.radientAccountId = "acct_b";
		await render();
		await loadAttachment("b-private-image", async () => "data:b");
		finish(new Response("{}", { status: 401 }));
		await expect(pending).rejects.toMatchObject({ kind: "sign_in" });
		expect(transport).toHaveBeenCalledTimes(1);
		expect(cachedAttachment("b-private-image")).toBe("data:b");
		expect(held).not.toBe(old);
	});
	it("a direct A→B account switch clears A's images and fences A's in-flight loads", async () => {
		connection.radientAccountId = "acct_a";
		root = createRoot(host());
		await render();

		// Account A has rendered images and one still loading.
		await loadAttachment("ten/conv/msg/att_a", async () => "data:a");
		let finishLate: (uri: string) => void = () => undefined;
		const late = loadAttachment(
			"ten/conv/msg/att_late",
			() => new Promise<string>((resolve) => (finishLate = resolve)),
		);
		expect(attachmentCacheSize()).toBe(1);

		// Replacement login: the account id changes with no signed-out between.
		connection.radientAccountId = "acct_b";
		await render();

		expect(attachmentCacheSize()).toBe(0);
		expect(cachedAttachment("ten/conv/msg/att_a")).toBeUndefined();
		// A's load lands after the switch: its caller gets it, B's cache does not.
		finishLate("data:late");
		await late;
		expect(cachedAttachment("ten/conv/msg/att_late")).toBeUndefined();
		expect(attachmentCacheSize()).toBe(0);
	});

	it("re-rendering the SAME account keeps its cache (no needless refetch)", async () => {
		connection.radientAccountId = "acct_a";
		root = createRoot(host());
		await render();
		await loadAttachment("ten/conv/msg/att_keep", async () => "data:k");
		await render();
		expect(cachedAttachment("ten/conv/msg/att_keep")).toBe("data:k");
	});
});
