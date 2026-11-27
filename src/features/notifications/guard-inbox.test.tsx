import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	APPROVAL,
	card,
	DIGEST_A,
	DIGEST_B,
	nonTeamStatus,
	org,
	status,
	TENANT,
	waitingOrg,
} from "@/features/guard/guard-fixtures";
import { resetLocaleSource, setLocaleSource } from "@/i18n";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The inbox's Radient Guard item, MOUNTED through the real availability gate, the real
 * controller and the real views; only the leaf primitives (Node has no React
 * Native host) and the connection seam are stubbed. The client is a scripted
 * fake so every request the section makes is on the record — which is how the
 * "zero Guard calls" claims are proved rather than asserted.
 */
type Pressable = {
	testID: string | undefined;
	label: string;
	onPress: () => void;
	disabled: boolean;
};
const host = vi.hoisted(() => ({
	conn: { phase: "live", route: { mode: "direct" } as object | null },
	stream: "live",
	list: { capabilities: {} as Record<string, unknown>, frameCount: 1 },
	client: null as unknown,
	handlers: {} as Record<string, () => void>,
	opened: [] as string[],
}));
vi.mock("react-native", () => ({
	View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
		<>
			{testID ? `⟦id:${testID}⟧` : null}
			{children}
		</>
	),
	Text: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
		<>
			{testID ? `⟦id:${testID}⟧` : null}
			{children}
		</>
	),
	Linking: {
		openURL: (url: string) => {
			host.opened.push(url);
			return Promise.resolve();
		},
	},
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({
		relay: () => host.client,
		streamHealth: host.stream,
	}),
	useConnectionState: <T,>(select: (s: typeof host.conn) => T) =>
		select(host.conn),
	useListState: <T,>(select: (s: typeof host.list) => T) => select(host.list),
	useLocaleFrame: () => null,
}));
vi.mock("@/ui/components/button", () => ({
	Button: (props: Pressable & { label: string }) => {
		host.handlers[props.testID ?? ""] = props.onPress;
		return <>{`⟦btn:${props.testID}:${props.label}⟧`}</>;
	},
}));
vi.mock("@/ui/components/alert", () => ({
	Alert: ({ children }: { children: string }) => <>{children}</>,
}));
vi.mock("@/ui/components/section-header", () => ({
	SectionHeader: ({ label }: { label: string }) => <>{label}</>,
}));
vi.mock("@/ui/components/divider", () => ({ Divider: () => null }));
vi.mock("@/ui/components/sheet", () => ({
	Sheet: ({
		visible,
		title,
		children,
		footer,
		testID,
	}: {
		visible: boolean;
		title: string;
		children?: ReactNode;
		footer?: ReactNode;
		testID?: string;
	}) => {
		if (!visible) return null;
		return (
			<>
				{`⟦id:${testID}⟧`}
				{title}
				{children}
				{footer}
			</>
		);
	},
}));

const { GuardInboxItem } = await import("./guard-inbox");

type Script = Record<string, (...args: never[]) => unknown>;
function install(script: Script) {
	const calls: { name: string; args: unknown[] }[] = [];
	host.client = new Proxy(
		{},
		{
			get:
				(_t, name: string) =>
				async (...args: unknown[]) => {
					calls.push({ name, args });
					const fn = script[name];
					if (fn === undefined) throw new Error(`unscripted ${name}`);
					return (fn as (...a: unknown[]) => unknown)(...args);
				},
		},
	);
	return calls;
}
/** The CURRENT frame, read back from the rendered text nodes (not from a log of
 *  every past render), so a state that has been replaced cannot satisfy an
 *  assertion. Buttons and test ids render as ⟦…⟧ markers in the mocks. */
type Node = { nodeValue?: string | null; childNodes?: Node[] };
const frameText = (): string[] => {
	const out: string[] = [];
	const walk = (node: Node) => {
		if (typeof node.nodeValue === "string" && node.nodeValue !== "")
			out.push(node.nodeValue);
		for (const child of node.childNodes ?? []) walk(child);
	};
	walk(dom.container as unknown as Node);
	return out;
};
const snapshot = () => {
	const raw = frameText();
	const buttons = raw
		.filter((x) => x.startsWith("⟦btn:"))
		.map((x) => {
			const [, testID = "", ...rest] = x.slice(1, -1).split(":");
			return { testID, label: rest.join(":") };
		});
	return {
		texts: raw.filter((x) => !x.startsWith("⟦")),
		buttons,
		ids: raw.filter((x) => x.startsWith("⟦id:")).map((x) => x.slice(4, -1)),
	};
};
const press = async (testID: string) => {
	const present = snapshot().buttons.some((b) => b.testID === testID);
	const handler = host.handlers[testID];
	if (!present || handler === undefined) throw new Error(`no button ${testID}`);
	await act(async () => handler());
};
const settle = () => act(async () => undefined);

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
async function mount() {
	host.handlers = {};
	await act(async () => root.render(<GuardInboxItem />));
	await settle();
}

beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as Element);
	setLocaleSource(() => "en");
	host.conn = { phase: "live", route: { mode: "direct" } };
	host.stream = "live";
	host.list = { capabilities: { features: { guard: 1 } }, frameCount: 1 };
	host.opened = [];
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	resetLocaleSource();
	vi.useRealTimers();
});

const waiting = () => status({ orgs: [waitingOrg()] });

describe("the inbox's Guard item", () => {
	it("a waiting request is a pinned row with a Review button, and nothing is sent but the status read", async () => {
		const calls = install({ guardStatus: waiting });
		await mount();
		const s = snapshot();
		expect(s.ids).toContain("guard-inbox-row");
		expect(s.texts).toContain("Share Guard stats with Example Org?");
		expect(s.texts).toContain("Example Org turned on Radient Guard.");
		expect(s.buttons.map((b) => b.label)).toEqual(["Review"]);
		expect(calls.map((c) => c.name)).toEqual(["guardStatus"]);
	});

	it("nothing waiting → nothing drawn (no empty band in the inbox)", async () => {
		install({ guardStatus: () => status() });
		await mount();
		expect(snapshot().texts).toEqual([]);
		expect(snapshot().ids).toEqual([]);
	});

	it("a non-Team account draws nothing and makes no Guard write and no card read (the inbox never shows the card)", async () => {
		const calls = install({
			guardStatus: () => nonTeamStatus(),
			guardNonTeamCard: () => ({
				trial_days: 14,
				org: null,
				url: "https://console.radienthq.com/x",
				role: "owner",
			}),
		});
		await mount();
		expect(snapshot().texts).toEqual([]);
		// The inbox has no use for the card's trial length; only Settings reads it.
		expect(calls.map((c) => c.name)).toEqual(["guardStatus"]);
	});

	it("a host that does not advertise Guard: no request at all, nothing drawn", async () => {
		host.list = { capabilities: {}, frameCount: 3 };
		const calls = install({});
		await mount();
		expect(calls).toEqual([]);
		expect(snapshot().texts).toEqual([]);
	});

	it("offline: nothing drawn, no request", async () => {
		host.conn = { phase: "reconnecting", route: null };
		const calls = install({});
		await mount();
		expect(calls).toEqual([]);
		expect(snapshot().texts).toEqual([]);
	});

	it("a failed read draws no error band in the inbox (Settings states it)", async () => {
		install({
			guardStatus: () => {
				throw new Error("offline");
			},
		});
		await mount();
		expect(snapshot().texts).toEqual([]);
	});

	it("a request with no approval id (no operator key on the host) offers no Review", async () => {
		const w = waitingOrg();
		install({
			guardStatus: () =>
				status({
					orgs: [{ ...w, prompt: { ...w.prompt!, approval_id: null } }],
				}),
		});
		await mount();
		const s = snapshot();
		expect(s.texts).toContain("Share Guard stats with Example Org?");
		expect(s.buttons).toEqual([]);
	});

	it("Review opens the card; Don't share relays a bare decline and the row reports it", async () => {
		let answered = false;
		const calls = install({
			guardStatus: () =>
				answered
					? status({
							orgs: [
								org({
									state: "not_sharing",
									can_revoke: false,
									scopes_shared: [],
								}),
							],
						})
					: waiting(),
			guardConsentCard: () => card(),
			declineGuardConsent: () => {
				answered = true;
				return { approval_id: APPROVAL, state: "denied", tenant: TENANT };
			},
		});
		await mount();
		await press("guard-review");
		expect(snapshot().ids).toContain("guard-consent-sheet");
		vi.setSystemTime(Date.now() + 600);
		await press("guard-consent-dont-share");
		await settle();
		expect(calls.filter((c) => c.name === "declineGuardConsent")).toHaveLength(
			1,
		);
		expect(calls.map((c) => c.name)).not.toContain("acceptGuardConsent");
		expect(snapshot().texts).toContain("Not sharing with Example Org.");
	});

	it("Share relays only the card's two digests", async () => {
		const calls = install({
			guardStatus: waiting,
			guardConsentCard: () => card(),
			acceptGuardConsent: () => ({
				approval_id: APPROVAL,
				state: "granted",
				tenant: TENANT,
			}),
		});
		await mount();
		await press("guard-review");
		vi.setSystemTime(Date.now() + 600);
		await press("guard-consent-share");
		expect(calls.find((c) => c.name === "acceptGuardConsent")?.args).toEqual([
			APPROVAL,
			{ request_digest: DIGEST_A, disclosure_digest: DIGEST_B },
		]);
	});

	it("the card never opens by itself on arrival", async () => {
		install({ guardStatus: waiting });
		await mount();
		expect(snapshot().ids).not.toContain("guard-consent-sheet");
	});
});
