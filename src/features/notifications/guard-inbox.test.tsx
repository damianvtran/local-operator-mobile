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
import {
	type CatalogueKey,
	renderFor,
	resetLocaleSource,
	setLocaleSource,
} from "@/i18n";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { DirectionProvider } from "@/ui/direction";

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
	/** `useIsFocused` (the live refresh only runs on a focused screen). */
	focused: true,
	/** An AppState double: the refresh subscribes to foreground changes. */
	app: {
		currentState: "active",
		listeners: new Set<(state: string) => void>(),
		addEventListener(_type: "change", listener: (state: string) => void) {
			host.app.listeners.add(listener);
			return { remove: () => void host.app.listeners.delete(listener) };
		},
		set(state: string) {
			host.app.currentState = state;
			for (const listener of [...host.app.listeners]) listener(state);
		},
	},
}));
vi.mock("expo-router", () => ({ useIsFocused: () => host.focused }));
/** The base-direction hint a primitive was handed, as a marker node placed just
 *  BEFORE the text it governs. This mock stands in for the NATIVE target
 *  (`Platform.OS` "ios"), where `useComposedDir()` answers a `writingDirection`
 *  style — the DirectionProvider's web effect needs a real `document`, and the
 *  web `dir` prop is pinned against real react-native-web in `guard-text.test.tsx`.
 *  Empty when none was passed. */
type DirHint = { style?: { writingDirection?: string } };
const dirMark = (name: string, hint: DirHint | undefined) =>
	typeof hint?.style?.writingDirection === "string"
		? `⟦${name}:${hint.style.writingDirection}⟧`
		: null;
vi.mock("react-native", () => ({
	Platform: { OS: "ios" },
	AppState: host.app,
	View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
		<>
			{testID ? `⟦id:${testID}⟧` : null}
			{children}
		</>
	),
	Text: ({
		children,
		testID,
		style,
	}: {
		children?: ReactNode;
		testID?: string;
		style?: DirHint["style"];
	}) => (
		<>
			{testID ? `⟦id:${testID}⟧` : null}
			{dirMark("dir", { style })}
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
	Alert: ({ children, bodyDir }: { children: string; bodyDir?: DirHint }) => (
		<>
			{dirMark("dir", bodyDir)}
			{children}
		</>
	),
}));
vi.mock("@/ui/components/section-header", () => ({
	SectionHeader: ({
		label,
		labelDir,
	}: {
		label: string;
		labelDir?: DirHint;
	}) => (
		<>
			{dirMark("dir", labelDir)}
			{label}
		</>
	),
}));
vi.mock("@/ui/components/divider", () => ({ Divider: () => null }));
vi.mock("@/ui/components/sheet", () => ({
	Sheet: ({
		visible,
		title,
		children,
		footer,
		testID,
		titleDir,
	}: {
		visible: boolean;
		title: string;
		titleDir?: DirHint;
		children?: ReactNode;
		footer?: ReactNode;
		testID?: string;
	}) => {
		if (!visible) return null;
		return (
			<>
				{`⟦id:${testID}⟧`}
				{dirMark("dir", titleDir)}
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
async function mount(direction: "ltr" | "rtl" = "ltr", locale = "en") {
	host.handlers = {};
	await act(async () =>
		root.render(
			<DirectionProvider direction={direction} locale={locale}>
				<GuardInboxItem />
			</DirectionProvider>,
		),
	);
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
	host.focused = true;
	host.app.currentState = "active";
	// setInterval is faked too: the live refresh is an interval, and a test that
	// never advances it must never see it fire.
	vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
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

/**
 * R1-5: Guard sends no push, so the row is the only way to learn a request
 * arrived — it must show up while the inbox is already open, without polling
 * where Guard does not exist.
 */
describe("the inbox row stays live while it is open", () => {
	const REFRESH = 20_000;
	const tick = async (ms: number) => {
		await act(async () => {
			vi.advanceTimersByTime(ms);
		});
		await settle();
	};

	it("a request that lands while the inbox is open appears on the next interval", async () => {
		let body = status({ orgs: [org()] });
		const calls = install({ guardStatus: () => body });
		await mount();
		expect(snapshot().ids).not.toContain("guard-inbox-row");
		body = waiting();
		await tick(REFRESH);
		expect(snapshot().ids).toContain("guard-inbox-row");
		expect(calls.map((c) => c.name)).toEqual(["guardStatus", "guardStatus"]);
	});

	it("returning to the foreground re-reads once; the background does not poll", async () => {
		const calls = install({ guardStatus: waiting });
		await mount();
		await act(async () => host.app.set("background"));
		await tick(5 * REFRESH);
		expect(calls).toHaveLength(1);
		await act(async () => host.app.set("active"));
		await settle();
		expect(calls).toHaveLength(2);
	});

	it("an unfocused screen does not poll, and refocusing re-reads once", async () => {
		const calls = install({ guardStatus: waiting });
		await mount();
		host.focused = false;
		await mount();
		await tick(5 * REFRESH);
		expect(calls).toHaveLength(1);
		host.focused = true;
		await mount();
		expect(calls).toHaveLength(2);
	});

	it("a host without features.guard: zero requests and zero timers, however long it is open", async () => {
		host.list = { capabilities: { features: {} }, frameCount: 3 };
		const calls = install({});
		await mount();
		await tick(10 * REFRESH);
		expect(calls).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("leaving the screen stops the refresh", async () => {
		const calls = install({ guardStatus: waiting });
		await mount();
		await act(async () => root.unmount());
		await act(async () => vi.advanceTimersByTime(10 * REFRESH));
		expect(calls).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(0);
		root = createRoot(dom.container as Element);
	});
});

/**
 * RTL rendering (PR #402, i18n auditor 1). In Urdu the consent heading
 * (`Guard کے اعداد و شمار {org} کے ساتھ شیئر کریں؟`) opens with a Latin token, so
 * react-native-web's `dir="auto"` computed `direction: ltr` for it inside the RTL
 * sheet and reordered its Urdu/Latin runs. The catalogue is byte-pinned, so the
 * views must state the page's base themselves. WITHOUT the fix no element below
 * carries a `dir` hint and each assertion fails.
 */
/** The marker node directly before `text` in the frame, or `null` if the node
 *  before it is not a marker (i.e. the element stated no direction). */
const renderForUr = (key: CatalogueKey, args: Record<string, string>): string =>
	renderFor(key, args, "ur");
const markBefore = (text: string): string | null => {
	const raw = frameText();
	const at = raw.findIndex((x) => x === text);
	if (at < 0) throw new Error(`no text ${JSON.stringify(text)} in the frame`);
	const before = raw[at - 1];
	return before?.startsWith("⟦dir:") ? before : null;
};

describe("Guard renders its lines in the locale's direction", () => {
	it("Urdu: the section label, the row title, the reason and the consent sheet's heading and body each state rtl", async () => {
		setLocaleSource(() => "ur");
		install({ guardStatus: waiting, guardConsentCard: () => card() });
		await mount("rtl", "ur");
		const title = renderForUr("mobile.guard.prompt_title", {
			org: "Example Org",
		});
		// The premise: the heading really mixes scripts, opening with Latin.
		expect(title).toMatch(/^[A-Za-z]/);
		expect(title).toMatch(/[\u0600-\u06FF]/);
		expect(markBefore(renderForUr("mobile.guard.screen_title", {}))).toBe(
			"⟦dir:rtl⟧",
		);
		expect(markBefore(title)).toBe("⟦dir:rtl⟧");
		await press("guard-review");
		vi.setSystemTime(Date.now() + 600);
		const sheetTitle = markBefore(title);
		expect(sheetTitle).toBe("⟦dir:rtl⟧");
		// Every guard text node in the open sheet's frame carries the hint: the
		// sheet title is the only one this test names, so also count markers
		// against the number of Text/Alert/title/label elements drawn.
		const raw = frameText();
		const sheetAt = raw.indexOf("⟦id:guard-consent-sheet⟧");
		expect(sheetAt).toBeGreaterThan(-1);
		const inSheet = raw.slice(sheetAt + 1);
		expect(inSheet[0]).toBe("⟦dir:rtl⟧"); // the heading
		const lines = inSheet.filter((x) => !x.startsWith("⟦"));
		const marks = inSheet.filter((x) => x === "⟦dir:rtl⟧");
		expect(lines.length).toBeGreaterThan(3);
		// One marker per text line (heading, body paragraphs, scope bullets).
		expect(marks.length).toBe(lines.length);
	});

	it("English: no element states a direction (the LTR catalogues are unchanged)", async () => {
		install({ guardStatus: waiting, guardConsentCard: () => card() });
		await mount("ltr", "en");
		await press("guard-review");
		expect(frameText().some((x) => x.startsWith("⟦dir:"))).toBe(false);
		expect(snapshot().texts).toContain("Share Guard stats with Example Org?");
	});
});
