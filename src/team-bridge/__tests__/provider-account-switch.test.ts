import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAttachmentDraft } from "@/features/team-bridge/attachment-draft";
import {
	attachmentCacheSize,
	cachedAttachment,
	loadAttachment,
} from "@/team-bridge/attachments";

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
	accessCalls: 0,
	forcedRefreshes: 0,
	waitForAccess: null as Promise<void> | null,
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
		radientAccessToken: async (options?: { force?: boolean }) => {
			connection.accessCalls += 1;
			if (options?.force) connection.forcedRefreshes += 1;
			await connection.waitForAccess;
			return connection.radientAccountId
				? `h.${Buffer.from(JSON.stringify({ sub: connection.radientAccountId })).toString("base64url")}.s`
				: null;
		},
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
let held: ReturnType<typeof useTeamBridge> | null = null;
function captured() {
	if (!held) throw new Error("Expected mounted Bridge context");
	return held;
}
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

const uploaded = () =>
	new Response(
		JSON.stringify({
			msg: "ok",
			result: {
				attachment: {
					id: "late-id",
					mime: "image/jpeg",
					size: 1,
					width: 1,
					height: 1,
					sha256: "synthetic",
					state: "staged",
					expires_at: "2026-11-10T00:00:00Z",
				},
			},
		}),
		{ status: 201 },
	);

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
	connection.accessCalls = 0;
	connection.forcedRefreshes = 0;
	connection.waitForAccess = null;
});

describe("Team Bridge provider account boundary", () => {
	it.each(["A→B", "A→null→A"])(
		"%s refuses work admitted AFTER disposal, including retained store/client references",
		async (transition) => {
			connection.radientAccountId = "acct_a";
			const transport = vi.fn(async () => uploaded());
			vi.stubGlobal("fetch", transport);
			root = createRoot(host());
			await render();
			const old = captured();
			old.store.setState({ gate: "open", selfAccountId: "acct_a" });
			const releaseSource = vi.fn();
			const prepare = vi.fn(async () => ({
				bytes: new Uint8Array([1]),
				mime: "image/jpeg" as const,
				width: 1,
				height: 1,
			}));
			const publication = vi.fn();
			const draft = createAttachmentDraft({
				maxCount: 4,
				prepare,
				upload: (bytes) =>
					old.actions.uploadAttachment("ten_example", "c1", bytes),
				discard: (id) => old.hub.deleteAttachment("ten_example", "c1", id),
				releaseSource,
				onChange: publication,
			});
			draft.dispose();
			connection.radientAccountId = transition === "A→B" ? "acct_b" : null;
			await render();
			if (transition === "A→null→A") {
				connection.radientAccountId = "acct_a";
				await render();
			}
			const current = captured();
			current.store.setState({
				gate: "open",
				selfAccountId: connection.radientAccountId,
			});
			await loadAttachment("replacement-private", async () => "data:b");
			const state = current.store.getState();
			const retiredState = old.store.getState();
			draft.add(["post-disposal-picker", "post-disposal-paste"]);
			await expect(
				old.actions.uploadAttachment("ten_example", "c1", new Uint8Array([1])),
			).rejects.toMatchObject({ kind: "sign_in" });
			await expect(
				old.hub.uploadAttachment("ten_example", "c1", new Uint8Array([1])),
			).rejects.toMatchObject({ kind: "sign_in" });
			expect(cachedAttachment("replacement-private")).toBe("data:b");
			expect(connection.accessCalls).toBe(0);
			await old.actions.checkStatus();
			await old.actions.refreshUnread();
			old.actions.reset();
			old.actions.retire();
			await Promise.resolve();
			expect(releaseSource.mock.calls).toEqual([
				["post-disposal-picker"],
				["post-disposal-paste"],
			]);
			expect(prepare).not.toHaveBeenCalled();
			expect(publication).not.toHaveBeenCalled();
			expect(draft.chips()).toEqual([]);
			expect(connection.accessCalls).toBe(0);
			expect(connection.forcedRefreshes).toBe(0);
			expect(transport).not.toHaveBeenCalled();
			expect(current.store.getState()).toBe(state);
			expect(old.store.getState()).toBe(retiredState);
			expect(cachedAttachment("replacement-private")).toBe("data:b");
		},
	);

	it.each(["A→B", "A→null→A"])(
		"%s disowns an accessor already pending at retirement before transport",
		async (transition) => {
			connection.radientAccountId = "acct_a";
			let finish!: () => void;
			connection.waitForAccess = new Promise<void>((resolve) => {
				finish = resolve;
			});
			const transport = vi.fn();
			vi.stubGlobal("fetch", transport);
			root = createRoot(host());
			await render();
			const old = captured();
			const pending = old.hub.uploadAttachment(
				"ten_example",
				"c1",
				new Uint8Array([1]),
			);
			await vi.waitFor(() => expect(connection.accessCalls).toBe(1));
			connection.radientAccountId = transition === "A→B" ? "acct_b" : null;
			await render();
			if (transition === "A→null→A") {
				connection.radientAccountId = "acct_a";
				await render();
			}
			finish();
			await expect(pending).rejects.toMatchObject({ kind: "sign_in" });
			expect(transport).not.toHaveBeenCalled();
			expect(connection.accessCalls).toBe(1);
			expect(connection.forcedRefreshes).toBe(0);
		},
	);

	it.each(["A→B", "A→null→A"])(
		"%s disowns pre-retirement late success without spending cleanup grants",
		async (transition) => {
			connection.radientAccountId = "acct_a";
			let finish!: (response: Response) => void;
			const transport = vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						finish = resolve;
					}),
			);
			vi.stubGlobal("fetch", transport);
			root = createRoot(host());
			await render();
			const old = captured();
			const pending = old.actions.uploadAttachment(
				"ten_example",
				"c1",
				new Uint8Array([1]),
			);
			await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
			connection.radientAccountId = transition === "A→B" ? "acct_b" : null;
			await render();
			if (transition === "A→null→A") {
				connection.radientAccountId = "acct_a";
				await render();
			}
			await loadAttachment("replacement-success", async () => "data:b");
			const state = captured().store.getState();
			finish(uploaded());
			await expect(pending).rejects.toMatchObject({ kind: "sign_in" });
			expect(connection.accessCalls).toBe(1);
			expect(connection.forcedRefreshes).toBe(0);
			expect(transport).toHaveBeenCalledTimes(1);
			expect(captured().store.getState()).toBe(state);
			expect(cachedAttachment("replacement-success")).toBe("data:b");
		},
	);
	it.each(["A→B", "A→null→A"])(
		"%s: a retired account's final upload 401 cannot clear the replacement's images or replay as it",
		async (transition) => {
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
			connection.radientAccountId = transition === "A→B" ? "acct_b" : null;
			await render();
			if (transition === "A→null→A") {
				connection.radientAccountId = "acct_a";
				await render();
			}
			await loadAttachment("b-private-image", async () => "data:b");
			finish(new Response("{}", { status: 401 }));
			await expect(pending).rejects.toMatchObject({ kind: "sign_in" });
			expect(transport).toHaveBeenCalledTimes(1);
			expect(connection.accessCalls).toBe(1);
			expect(connection.forcedRefreshes).toBe(0);
			expect(cachedAttachment("b-private-image")).toBe("data:b");
			expect(held).not.toBe(old);
		},
	);
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
		const before = captured();
		await loadAttachment("ten/conv/msg/att_keep", async () => "data:k");
		await render();
		expect(held).toBe(before);
		expect(before.isActive()).toBe(true);
		expect(cachedAttachment("ten/conv/msg/att_keep")).toBe("data:k");
		const transport = vi.fn(async () => uploaded());
		vi.stubGlobal("fetch", transport);
		expect(
			await before.hub.uploadAttachment(
				"ten_example",
				"c1",
				new Uint8Array([1]),
			),
		).toMatchObject({ id: "late-id" });
		expect(connection.accessCalls).toBe(1);
		expect(transport).toHaveBeenCalledTimes(1);
	});
});
