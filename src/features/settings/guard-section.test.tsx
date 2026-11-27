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
 * Settings → Radient Guard, MOUNTED through the real availability gate, the real
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
vi.mock("react-native", () => ({
	AppState: host.app,
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

const { GuardSection } = await import("./guard-section");

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
	await act(async () => root.render(<GuardSection />));
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

describe("availability gate", () => {
	it("a host that does not advertise Guard: one calm sentence and ZERO requests", async () => {
		host.list = { capabilities: { features: {} }, frameCount: 3 };
		const calls = install({});
		await mount();
		const s = snapshot();
		expect(s.texts).toContain("Radient Guard");
		expect(s.texts.join(" ")).toMatch(
			/can’t show Radient Guard to your phone yet/,
		);
		expect(s.ids).toContain("guard-unsupported");
		expect(calls).toEqual([]);
	});

	it("before the relay has spoken, nothing is drawn and nothing is requested", async () => {
		host.list = { capabilities: {}, frameCount: 0 };
		const calls = install({});
		await mount();
		expect(snapshot().texts).toEqual([]);
		expect(calls).toEqual([]);
	});

	it("offline: says to connect, requests nothing", async () => {
		host.conn = { phase: "offline", route: null };
		const calls = install({});
		await mount();
		expect(snapshot().texts).toContain(
			"Connect to a computer to see Radient Guard.",
		);
		expect(calls).toEqual([]);
	});

	it("a degraded stream says it is reconnecting (R1-8), not 'connect a computer', and requests nothing", async () => {
		host.stream = "degraded";
		const calls = install({});
		await mount();
		const text = snapshot().texts.join(" ");
		expect(text).toContain("Reconnecting to your computer…");
		expect(text).not.toContain("Connect to a computer");
		expect(calls).toEqual([]);
	});

	it("a failed read is stated without implying anything about sharing, with Try again", async () => {
		const calls = install({
			guardStatus: () => {
				throw new Error("down");
			},
		});
		await mount();
		await settle();
		await act(async () => root.render(<GuardSection />));
		const s = snapshot();
		expect(s.texts.join(" ")).toMatch(/Couldn’t read Radient Guard/);
		expect(s.buttons.map((b) => b.testID)).toContain("guard-retry");
		expect(calls.map((c) => c.name)).toEqual(["guardStatus"]);
	});
});

describe("states", () => {
	it("Team org, sharing: the indicator, what is shared, the computer, Stop sharing", async () => {
		install({ guardStatus: () => status() });
		await mount();
		await act(async () => root.render(<GuardSection />));
		const s = snapshot();
		expect(s.texts).toContain("Guard: sharing with Example Org");
		expect(s.texts.join(" ")).toContain("guardrail results and task time");
		expect(s.texts).toContain("This computer: Example Mac");
		expect(s.buttons.map((b) => b.testID)).toEqual(["guard-stop"]);
	});

	it("a pending widening is never drawn as paused, and keeps Stop + Review", async () => {
		install({
			guardStatus: () =>
				status({
					orgs: [
						waitingOrg({
							state: "sharing_pending",
							scopes_shared: ["decisions"],
							can_revoke: true,
						}),
					],
				}),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		const s = snapshot();
		expect(s.texts.join(" ")).toContain(
			"Guard: sharing with Example Org · new items waiting for your choice",
		);
		expect(s.texts.join(" ")).not.toMatch(/paused/i);
		expect(s.buttons.map((b) => b.testID)).toEqual([
			"guard-review",
			"guard-stop",
		]);
	});

	it("a stopped org offers Share again, and nothing else", async () => {
		install({
			guardStatus: () =>
				status({
					orgs: [
						org({
							state: "not_sharing",
							scopes_shared: [],
							can_revoke: false,
							can_share_again: true,
						}),
					],
				}),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		expect(snapshot().buttons.map((b) => b.testID)).toEqual([
			"guard-share-again",
		]);
	});

	it("a waiting request with no card (no operator key) offers no Review on the phone", async () => {
		const w = waitingOrg();
		install({
			guardStatus: () =>
				status({
					orgs: [{ ...w, prompt: { ...w.prompt!, approval_id: null } }],
				}),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		const s = snapshot();
		expect(s.texts).toContain("Guard: Example Org is waiting for your choice");
		expect(s.buttons.map((b) => b.testID)).not.toContain("guard-review");
	});

	it("no org has asked / a damaged store", async () => {
		install({ guardStatus: () => status({ mode: "none", orgs: [] }) });
		await mount();
		await act(async () => root.render(<GuardSection />));
		expect(snapshot().texts).toContain(
			"No organization has asked you to share Guard stats.",
		);
		install({ guardStatus: () => status({ mode: "unavailable", orgs: [] }) });
		await act(async () => root.unmount());
		root = createRoot(dom.container as Element);
		await mount();
		await act(async () => root.render(<GuardSection />));
		expect(snapshot().texts.join(" ")).toMatch(/Nothing was shared or sent/);
	});
});

describe("non-Team card (§14'): zero Guard writes, role-shaped", () => {
	const url = "https://console.radienthq.com/dashboard/team";
	async function nonTeam(role: string | undefined, trial: number | null) {
		const calls = install({
			guardStatus: () => nonTeamStatus(),
			guardNonTeamCard: () => ({ trial_days: trial, org: null, url, role }),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		return { calls, s: snapshot() };
	}

	it("owner, eligible: the trial CTA opens the first-party page", async () => {
		const { calls, s } = await nonTeam("owner", 14);
		expect(s.texts).toContain("Radient Guard is part of Radient Team");
		expect(s.buttons.map((b) => b.label)).toContain("Start 14-day free trial");
		expect(s.texts).toContain("Nothing is collected from this account.");
		await press("guard-non-team-cta");
		expect(host.opened).toEqual([url]);
		expect(calls.map((c) => c.name)).toEqual([
			"guardStatus",
			"guardNonTeamCard",
		]);
	});

	it("admin: ask your owner, no CTA button", async () => {
		const { s } = await nonTeam("admin", 14);
		expect(s.texts).toContain("Ask your owner to upgrade");
		expect(s.buttons.map((b) => b.testID)).not.toContain("guard-non-team-cta");
	});

	it("member: NOTHING — not even the section header", async () => {
		const { s, calls } = await nonTeam("member", 14);
		expect(s.texts).toEqual([]);
		expect(s.ids).not.toContain("settings-section-guard");
		expect(
			calls.every((c) => ["guardStatus", "guardNonTeamCard"].includes(c.name)),
		).toBe(true);
	});
});

describe("answering from the phone", () => {
	const waiting = () => status({ orgs: [waitingOrg()] });

	it("Review opens the card read from the host: title, reason, scopes, and the order of the buttons", async () => {
		const calls = install({
			guardStatus: waiting,
			guardConsentCard: () => card(),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		await press("guard-review");
		await act(async () => root.render(<GuardSection />));
		const s = snapshot();
		expect(calls.map((c) => c.name)).toEqual([
			"guardStatus",
			"guardConsentCard",
		]);
		expect(s.texts).toContain("Share Guard stats with Example Org?");
		expect(s.texts).toContain("Example Org turned on Radient Guard.");
		expect(s.texts).toContain("From this computer, Guard would send:");
		expect(
			s.texts.some((t) => t.includes("Task time, in ranges such as 5–15 min")),
		).toBe(true);
		expect(s.texts).toContain(
			"Never sent: file paths, commands, prompts, code, model output or tool arguments.",
		);
		// "Don't share" first, never pre-selected; the yes is last.
		expect(
			s.buttons
				.filter((b) => b.testID?.startsWith("guard-consent"))
				.map((b) => b.testID),
		).toEqual([
			"guard-consent-dont-share",
			"guard-consent-later",
			"guard-consent-share",
		]);
		expect(calls.map((c) => c.name)).not.toContain("acceptGuardConsent");
	});

	it("Share inside the debounce sends nothing; after it, only the digests", async () => {
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
		await act(async () => root.render(<GuardSection />));
		await press("guard-review");
		await act(async () => root.render(<GuardSection />));
		await press("guard-consent-share");
		expect(calls.map((c) => c.name)).not.toContain("acceptGuardConsent");
		vi.setSystemTime(Date.now() + 600);
		await press("guard-consent-share");
		const accept = calls.find((c) => c.name === "acceptGuardConsent");
		expect(accept?.args).toEqual([
			APPROVAL,
			{ request_digest: DIGEST_A, disclosure_digest: DIGEST_B },
		]);
	});

	it("Decide later sends nothing at all", async () => {
		const calls = install({
			guardStatus: waiting,
			guardConsentCard: () => card(),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		await press("guard-review");
		await act(async () => root.render(<GuardSection />));
		vi.setSystemTime(Date.now() + 600);
		await press("guard-consent-later");
		expect(calls.map((c) => c.name)).toEqual([
			"guardStatus",
			"guardConsentCard",
		]);
	});

	it("a scope the app cannot describe withholds Share and Don't share", async () => {
		install({
			guardStatus: waiting,
			guardConsentCard: () =>
				card({ asked_scopes: ["decisions", "telepathy"] }),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		await press("guard-review");
		await act(async () => root.render(<GuardSection />));
		const s = snapshot();
		expect(
			s.buttons
				.filter((b) => b.testID.startsWith("guard-consent"))
				.map((b) => b.testID),
		).toEqual(["guard-consent-later"]);
		expect(s.texts.join(" ")).toMatch(/can’t describe yet/);
	});

	it("a widening reads 'Keep current' / 'Share the new items'", async () => {
		const w = waitingOrg();
		install({
			guardStatus: () =>
				status({
					orgs: [
						{
							...w,
							state: "sharing_pending",
							prompt: {
								...w.prompt!,
								reason: "widened",
								widening: true,
								asked_scopes: ["admin_share"],
							},
						},
					],
				}),
			guardConsentCard: () =>
				card({
					reason: "widened",
					widening: true,
					asked_scopes: ["admin_share"],
				}),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		await press("guard-review");
		await act(async () => root.render(<GuardSection />));
		const labels = snapshot()
			.buttons.filter((b) => b.testID.startsWith("guard-consent"))
			.map((b) => b.label);
		expect(labels).toEqual([
			"Keep current",
			"Decide later",
			"Share the new items",
		]);
	});
});

describe("stop sharing", () => {
	it("opens the C2 confirm; Keep sharing sends nothing; Stop sharing sends one revoke", async () => {
		const calls = install({
			guardStatus: () => status(),
			guardRevoke: () => ({
				tenant: TENANT,
				status: "revoked",
				code: "",
				org: null,
			}),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		await press("guard-stop");
		await act(async () => root.render(<GuardSection />));
		const s = snapshot();
		expect(s.texts).toContain("Stop sharing with Example Org?");
		expect(s.texts).toContain(
			"Guard stops sending from all your computers now.",
		);
		expect(s.texts).toContain(
			"Other records you already sent stay until they expire: stats after 90 days, reports after 180 days.",
		);
		await press("guard-stop-keep");
		expect(calls.map((c) => c.name)).toEqual(["guardStatus"]);
		await act(async () => root.render(<GuardSection />));
		await press("guard-stop");
		await act(async () => root.render(<GuardSection />));
		await press("guard-stop-confirm");
		expect(calls.filter((c) => c.name === "guardRevoke")).toHaveLength(1);
	});

	it("the trace-detail sentence names the host-measured backup days — never a literal", async () => {
		install({
			guardStatus: () =>
				status({
					backup_days: 31,
					orgs: [org({ scopes_shared: ["decisions", "trace_detail"] })],
				}),
		});
		await mount();
		await act(async () => root.render(<GuardSection />));
		await press("guard-stop");
		await act(async () => root.render(<GuardSection />));
		expect(snapshot().texts.join(" ")).toContain(
			"deletes your step-by-step timing. Copies in backups are gone within 31 days.",
		);
		install({
			guardStatus: () =>
				status({
					backup_days: null,
					orgs: [org({ scopes_shared: ["trace_detail"] })],
				}),
		});
		await act(async () => root.unmount());
		root = createRoot(dom.container as Element);
		await mount();
		await act(async () => root.render(<GuardSection />));
		await press("guard-stop");
		await act(async () => root.render(<GuardSection />));
		expect(snapshot().texts.join(" ")).not.toContain("Copies in backups");
	});
});

/** R1-5: the section re-reads while open (no push exists), and only where Guard
 *  is advertised. A non-Team account re-reads the status but not the trial card. */
describe("the section stays live while it is open", () => {
	const REFRESH = 20_000;
	const tick = async (ms: number) => {
		await act(async () => {
			vi.advanceTimersByTime(ms);
		});
		await settle();
	};

	it("a request that lands while Settings is open appears on the next interval", async () => {
		let body = status({ orgs: [org()] });
		const calls = install({ guardStatus: () => body });
		await mount();
		expect(snapshot().buttons.map((b) => b.testID)).not.toContain(
			"guard-review",
		);
		body = status({ orgs: [waitingOrg()] });
		await tick(REFRESH);
		expect(snapshot().buttons.map((b) => b.testID)).toContain("guard-review");
		expect(calls.map((c) => c.name)).toEqual(["guardStatus", "guardStatus"]);
	});

	it("a non-Team account re-reads the status on the timer but not the trial card", async () => {
		const calls = install({
			guardStatus: () => nonTeamStatus(),
			guardNonTeamCard: () => ({
				trial_days: 14,
				org: null,
				url: "https://console.radienthq.com/dashboard/team",
			}),
		});
		await mount();
		await tick(2 * REFRESH);
		const names = calls.map((c) => c.name);
		expect(names.filter((n) => n === "guardNonTeamCard")).toHaveLength(1);
		expect(names.filter((n) => n === "guardStatus")).toHaveLength(3);
	});

	it("an older host or an unknown capability: zero requests and zero timers", async () => {
		for (const list of [
			{ capabilities: { features: {} }, frameCount: 3 },
			{ capabilities: {}, frameCount: 0 },
		]) {
			host.list = list;
			const calls = install({});
			await mount();
			await tick(10 * REFRESH);
			expect(calls).toEqual([]);
			expect(vi.getTimerCount()).toBe(0);
		}
	});
});
