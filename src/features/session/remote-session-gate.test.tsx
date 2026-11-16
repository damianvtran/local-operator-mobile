import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesSchema } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

const host = vi.hoisted(() => ({
	state: {
		capabilities: {} as unknown,
		liveFrameAt: null as number | null,
		detail: null as string | null,
	},
	presses: new Map<string, () => void>(),
	texts: [] as string[],
	refreshList: vi.fn(async () => undefined),
	back: vi.fn(),
	mounts: 0,
	unmounts: 0,
	backButtons: [] as string[],
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ back: host.back }) }));
vi.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({ refreshList: host.refreshList }),
	useListState: (selector: (state: typeof host.state) => unknown) =>
		selector(host.state),
	useConnectionState: (selector: (state: typeof host.state) => unknown) =>
		selector(host.state),
}));
vi.mock("react-native", () => ({
	View: ({ children }: { children: import("react").ReactNode }) => children,
	Text: ({ children }: { children: string }) => {
		host.texts.push(children);
		return children;
	},
}));
vi.mock("@/ui/components/button", () => ({
	Button: ({
		label,
		testID,
		onPress,
	}: {
		label: string;
		testID: string;
		onPress: () => void;
	}) => {
		host.presses.set(testID, onPress);
		return label;
	},
}));
/* The gate's Back is the kit's one back control (design D2), not a text Button. */
vi.mock("@/ui/components/back-button", () => ({
	BackButton: ({
		testID,
		onPress,
	}: {
		testID: string;
		onPress: () => void;
	}) => {
		host.presses.set(testID, onPress);
		host.backButtons.push(testID);
		return null;
	},
}));
const { RemoteSessionGate } = await import("./remote-session-gate");
const baseline = {
	available: true,
	version: 1,
	view: true,
	history: true,
	supported_command_ops: ["prompt", "steer"],
	supported_media_kinds: ["image", "video", "file"],
	file_sources: ["retained_document"],
	document_upload: false,
	audio_upload: false,
	skill_invocation: false,
	supplements: false,
	media: true,
};
function Reader() {
	useEffect(() => {
		host.mounts++;
		return () => {
			host.unmounts++;
		};
	}, []);
	return "ordinary transcript and composer";
}
let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const paint = async (remote = true, key = "session-owner") => {
	host.texts = [];
	await act(async () =>
		root.render(
			<RemoteSessionGate remote={remote} key={key}>
				<Reader />
			</RemoteSessionGate>,
		),
	);
};
beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as never);
	host.state = {
		capabilities: capabilitiesSchema.parse({}),
		liveFrameAt: 1,
		detail: null,
	};
	host.presses.clear();
	host.texts = [];
	host.mounts = 0;
	host.unmounts = 0;
	host.refreshList.mockReset().mockResolvedValue(undefined);
	host.back.mockReset();
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("remote session route admission", () => {
	it("does not mount readers/composer against an older relay; back and refresh are real controls", async () => {
		await paint();
		expect(host.mounts).toBe(0);
		expect(host.texts.join(" ")).toContain(
			"Opening remote conversations needs a newer Local Operator",
		);
		await act(async () => {
			host.presses.get("remote-session-retry")?.();
		});
		expect(host.refreshList).toHaveBeenCalledTimes(1);
		host.presses.get("remote-session-back")?.();
		expect(host.back).toHaveBeenCalledTimes(1);
		expect(host.backButtons).toContain("remote-session-back");
		/* D3: the gate names what the reader did (opened a conversation), not
		 *  an "operation" — that sentence is for per-operation refusals. */
		expect(host.texts.join(" ")).not.toContain("remote operation");
	});
	it("distinguishes pending capabilities and offline failures from an empty transcript", async () => {
		host.state.liveFrameAt = null;
		await paint();
		expect(host.texts.join(" ")).toContain("Checking this computer");
		host.state.detail = "Synthetic connected computer is offline.";
		await paint();
		expect(host.texts).toContain(host.state.detail);
		expect(host.mounts).toBe(0);
	});
	it("retains a mounted conversation when a peer/list capability disappears, but never carries admission to another owner", async () => {
		host.state.capabilities = capabilitiesSchema.parse({
			remote_sessions: baseline,
		});
		await paint();
		expect(host.mounts).toBe(1);
		host.state.capabilities = capabilitiesSchema.parse({});
		await paint();
		expect(host.mounts).toBe(1);
		expect(host.unmounts).toBe(0);
		await paint(true, "another-session-owner");
		expect(host.mounts).toBe(1);
		expect(host.unmounts).toBe(1);
	});
	it("does not treat cached capabilities from a previous daemon as live admission", async () => {
		host.state.capabilities = capabilitiesSchema.parse({
			remote_sessions: baseline,
		});
		host.state.liveFrameAt = null;
		await paint();
		expect(host.mounts).toBe(0);
		expect(host.texts.join(" ")).toContain("Checking this computer");
		host.state.capabilities = capabilitiesSchema.parse({});
		host.state.liveFrameAt = 2;
		await paint();
		expect(host.mounts).toBe(0);
		expect(host.texts.join(" ")).toContain(
			"Opening remote conversations needs a newer Local Operator",
		);
	});
	it("does not gate local conversations", async () => {
		await paint(false);
		expect(host.mounts).toBe(1);
	});
});
