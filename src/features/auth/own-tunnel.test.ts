import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectCustomOutcome } from "@/features/auth/connection-provider";

/**
 * The own-tunnel screen's Save and connect, MOUNTED over react-dom with null
 * native adapters (the `computer-entry-points.test.ts` shape). It proves the
 * screen's decision — navigate home only for a live route, stay with the reason
 * and the draft otherwise (PR #216 evidence, diagnostic run 42855980853) — not
 * pixels; the rendered frames are QA's and design's.
 *
 * The UI components are recorders: each Alert, Button and Input reports its
 * props, so a test reads what the reader would see and presses what they would
 * press, by testID.
 */
type Props = Record<string, unknown>;
const host = vi.hoisted(() => ({
	alerts: [] as { testID?: string; title?: string; body: string }[],
	presses: new Map<string, () => void>(),
	inputs: new Map<
		string,
		{ value: string; onChangeText: (v: string) => void }
	>(),
	replaced: [] as string[],
	saved: [] as unknown[],
	connected: [] as unknown[],
	outcome: { status: "live" } as ConnectCustomOutcome,
	stored: { persistent: true, storageRefusal: null } as unknown,
}));

vi.mock("react-native", () => ({
	Platform: { OS: "ios" },
	View: (props: Props) => (props.children ?? null) as ReactNode,
	Text: () => null,
}));
vi.mock("expo-router", () => ({
	useRouter: () => ({
		replace: (path: string) => host.replaced.push(path),
		back: () => {},
	}),
	useLocalSearchParams: () => ({}),
}));
vi.mock("@/connection", () => ({ isPrivateHost: () => false }));
vi.mock("@/features/auth/tunnel-storage", () => ({
	readSavedComputers: async () => [],
}));
vi.mock("@/features/auth/tunnel-test", () => ({
	runTunnelTest: async () => ({ verdict: { kind: "ok" } }),
}));
vi.mock("@/features/auth/tunnel-verdict", () => ({
	verdictSentence: () => "It answered.",
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({
		savedTunnel: null,
		saveCustomRoute: async (input: unknown) => {
			host.saved.push(input);
			return host.stored;
		},
		connectCustomOutcome: async (input: unknown) => {
			host.connected.push(input);
			return host.outcome;
		},
		/* The quiet member too, so this suite run against the pre-fix screen (which
		 *  called it and then navigated unconditionally) fails on the BEHAVIOUR — a
		 *  refused connect landing on home — not on a missing function. */
		connectCustom: async (input: unknown) => {
			host.connected.push(input);
		},
	}),
}));
const flatten = (children: unknown): string =>
	Array.isArray(children)
		? children.map(flatten).join("")
		: typeof children === "string"
			? children
			: "";
vi.mock("@/ui/components/alert", () => ({
	Alert: (props: Props) => {
		host.alerts.push({
			testID: props.testID as string | undefined,
			title: props.title as string | undefined,
			body: flatten(props.children),
		});
		const action = props.action as
			| { testID: string; onPress: () => void }
			| undefined;
		if (action) host.presses.set(action.testID, action.onPress);
		return null;
	},
}));
vi.mock("@/ui/components/button", () => ({
	Button: (props: Props) => {
		if (typeof props.testID === "string" && !props.disabled)
			host.presses.set(props.testID, props.onPress as () => void);
		else if (typeof props.testID === "string")
			host.presses.delete(props.testID);
		return null;
	},
}));
vi.mock("@/ui/components/input", () => ({
	Input: (props: Props) => {
		host.inputs.set(props.testID as string, {
			value: props.value as string,
			onChangeText: props.onChangeText as (v: string) => void,
		});
		return null;
	},
}));
vi.mock("@/ui/components/screen", () => ({
	Screen: (props: Props) => (props.children ?? null) as ReactNode,
}));
vi.mock("@/ui/components/back-button", () => ({ BackButton: () => null }));
vi.mock("@/ui/components/command-block", () => ({ CommandBlock: () => null }));
vi.mock("@/ui/components/divider", () => ({ Divider: () => null }));
vi.mock("@/ui/components/section-header", () => ({
	SectionHeader: () => null,
}));

const { default: OwnTunnel } = await import("./own-tunnel");

const URL_FIELD = "custom-url-field";
const PASSWORD_FIELD = "custom-password-field";
const TEST = "own-tunnel-test";
const CONNECT = "custom-connect";
const RETRY = "own-tunnel-connect-retry";
const REFUSED = "own-tunnel-connect-refused";
const UNSAVED = "own-tunnel-unsaved";
/* Placeholder host only (AGENTS.md: never a real tunnel hostname). */
const ADDRESS = "https://relay.example.com";

let root: ReturnType<typeof createRoot> | null = null;
const press = (id: string) =>
	act(async () => {
		const handler = host.presses.get(id);
		expect(handler, `${id} is pressable`).toBeDefined();
		handler?.();
	});
const type = (id: string, value: string) =>
	act(async () => {
		host.inputs.get(id)?.onChangeText(value);
	});
/** The alerts of the LAST render pass only. */
const lastAlert = (testID: string) =>
	host.alerts.filter((alert) => alert.testID === testID).at(-1);

async function fillAndTest() {
	await type(URL_FIELD, ADDRESS);
	await type(PASSWORD_FIELD, "test-only");
	await press(TEST);
}

beforeEach(async () => {
	host.alerts.length = 0;
	host.presses.clear();
	host.inputs.clear();
	host.replaced.length = 0;
	host.saved.length = 0;
	host.connected.length = 0;
	host.outcome = { status: "live" };
	host.stored = { persistent: true, storageRefusal: null };
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
	root = createRoot({
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		ownerDocument: doc,
		addEventListener() {},
		removeEventListener() {},
	} as unknown as Element);
	await act(async () => root?.render(createElement(OwnTunnel)));
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	vi.unstubAllGlobals();
});

describe("own-tunnel Save and connect", () => {
	it("navigates home when the route goes live", async () => {
		await fillAndTest();
		await press(CONNECT);
		expect(host.connected).toHaveLength(1);
		expect(host.replaced).toEqual(["/"]);
		expect(lastAlert(REFUSED)).toBeUndefined();
	});

	it("stays on the form with the reason and the draft when the connect is refused", async () => {
		host.outcome = {
			status: "refused",
			detail: "The relay password was not accepted.",
			storageRefusal: null,
		};
		await fillAndTest();
		await press(CONNECT);
		// No navigation: the refused reader is not dropped on home.
		expect(host.replaced).toEqual([]);
		const refused = lastAlert(REFUSED);
		expect(refused?.title).toBe("Couldn't connect");
		expect(refused?.body).toBe("The relay password was not accepted.");
		// The draft survives: both fields still hold what was typed.
		expect(host.inputs.get(URL_FIELD)?.value).toBe(ADDRESS);
		expect(host.inputs.get(PASSWORD_FIELD)?.value).toBe("test-only");
		// Retry re-runs the SAME draft and, once live, goes home.
		host.outcome = { status: "live" };
		await press(RETRY);
		expect(host.connected).toHaveLength(2);
		expect(host.connected[1]).toEqual(host.connected[0]);
		expect(host.replaced).toEqual(["/"]);
	});

	it("says the device's secure storage refused, with its code, and never the platform message", async () => {
		host.outcome = {
			status: "refused",
			detail: null,
			storageRefusal: {
				step: "clear",
				kind: "CodedError",
				code: "ERR_KEY_CHAIN -34018",
			},
		};
		await fillAndTest();
		await press(CONNECT);
		expect(host.replaced).toEqual([]);
		expect(lastAlert(REFUSED)?.body).toBe(
			"This device's secure storage refused the request (code ERR_KEY_CHAIN -34018). Try again, or reinstall the app if it keeps happening.",
		);
	});

	it("falls back to a sentence that still says the entries are kept", async () => {
		host.outcome = { status: "refused", detail: null, storageRefusal: null };
		await fillAndTest();
		await press(CONNECT);
		expect(lastAlert(REFUSED)?.body).toContain(
			"Your address and password are still here",
		);
	});

	it("does nothing visible for a superseded attempt", async () => {
		host.outcome = { status: "superseded" };
		await fillAndTest();
		await press(CONNECT);
		expect(host.replaced).toEqual([]);
		expect(lastAlert(REFUSED)).toBeUndefined();
	});

	it("tells the reader when the route works but was not saved, then continues home", async () => {
		host.stored = {
			persistent: false,
			storageRefusal: { step: "write", kind: "CodedError", code: null },
		};
		await fillAndTest();
		await press(CONNECT);
		expect(host.replaced).toEqual([]);
		const unsaved = lastAlert(UNSAVED);
		expect(unsaved?.title).toBe("Connected, but not saved");
		expect(unsaved?.body).toContain(
			"This device's secure storage refused the request.",
		);
		expect(unsaved?.body).toContain("after the app restarts");
		await press("own-tunnel-unsaved-continue");
		expect(host.replaced).toEqual(["/"]);
	});
});
