import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The refusal surface shows a terminal command ONLY behind "Using a terminal?"
 * (M1), asserted on RENDERED markup rather than source strings (PR #261 R8:
 * the round-1 version matched exact whitespace, so a reformat broke it while
 * a real regression in a sibling branch passed).
 *
 * Node renders the web build's primitives (react-native → react-native-web,
 * `vitest.config.ts`). The stubs below are the modules Node cannot import —
 * `uniwind` behind the text scale and the appearance, Expo's native modules,
 * and `react-native-svg` behind the icons — each replaced by the smallest
 * thing that keeps the asserted structure: the command block renders its
 * command as text, an icon renders its name.
 */
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000",
	useKeyboardAppearance: () => "default",
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/ui/components/sheet", () => ({ Sheet: () => null }));
vi.mock("@/ui/components/command-block", async () => {
	const { createElement } = await import("react");
	return {
		CommandBlock: ({ command }: { command: string }) =>
			createElement("code", null, command),
	};
});
vi.mock("lucide-react-native", async () => {
	const { createElement } = await import("react");
	const mark = (name: string) => () =>
		createElement("i", { "data-icon": name });
	return {
		AlertTriangle: mark("alert"),
		ChevronDown: mark("chevron-down"),
		ChevronUp: mark("chevron-up"),
	};
});

const { RefusalSurface, disclosureIcon } = await import(
	"@/ui/components/refusal-surface"
);
const { SetupComputer } = await import("@/features/auth/setup-computer");
const { CONTROL, REGION } = await import("@/ui/a11y");
const { DirectionProvider } = await import("@/ui/direction");

const render = (props: Parameters<typeof RefusalSurface>[0]) =>
	renderToStaticMarkup(h(RefusalSurface, props));

/** The toggle's own element, found by its testID. */
const toggle = (html: string, id: string) =>
	html.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

describe("commands live only behind the terminal disclosure", () => {
	it("renders closed by default: no command, a collapsed toggle, a down chevron", () => {
		const html = render({
			kind: "computer-offline",
			subject: "Studio Mac",
			remedy: "lop tunnel status",
			onRetry: () => {},
		});
		expect(html).not.toContain("lop tunnel status");
		/* react-native-web omits `aria-expanded` for a false state, so "closed"
		 *  is the toggle present without `aria-expanded="true"`. */
		const button = toggle(html, CONTROL.refusalTerminalToggle);
		expect(button).not.toBe("");
		expect(button).not.toContain('aria-expanded="true"');
		expect(html).toContain("Using a terminal?");
		expect(html).toContain('data-icon="chevron-down"');
	});

	it("draws the open/closed mark from the same state (D3)", () => {
		const icon = (open: boolean) =>
			renderToStaticMarkup(
				h(() => disclosureIcon(open)({ color: "#000", size: 14 })),
			);
		expect(icon(false)).toContain("chevron-down");
		expect(icon(true)).toContain("chevron-up");
	});

	it("shows a named cause's own words and buttons, never the gateway sentence", () => {
		const html = render({
			kind: "console",
			subject: "Studio Mac",
			detail: "Radient says this tunnel isn't active right now.",
			remedy: null,
			copy: {
				cause: "balance-out",
				title: "Your Radient balance has run out.",
				body: "Add credit — your computer reconnects by itself. Then tap Retry.",
				actions: [
					{ id: "add-credit", label: "Add credit", url: "https://x.example" },
					{ id: "retry", label: "Retry" },
				],
				help: null,
				accountCause: true,
			},
			onRetry: () => {},
			onUseAnotherAddress: () => {},
		});
		expect(html).toContain("Your Radient balance has run out.");
		expect(html).not.toContain("isn't active");
		expect(html).toContain(`data-testid="${CONTROL.refusalActionRetry}"`);
		/* U10: the own-relay route cannot fix an account cause. */
		expect(html).not.toContain(
			`data-testid="${CONTROL.refusalAnotherAddress}"`,
		);
		expect(html).not.toContain(
			`data-testid="${CONTROL.refusalTerminalToggle}"`,
		);
	});

	it("renders Sign in again for a real sign-out, whatever error sat beside it (R2)", () => {
		/* `refusalFromError` now returns `copy: null` for the sign-in surface
		 *  (tunnel-refusal.test.ts); this is what that renders. */
		const html = render({
			kind: "sign-in",
			subject: "Studio Mac",
			copy: null,
			onSignIn: () => {},
		});
		expect(html).toContain("Sign in again");
	});

	it("keeps Use another address where the cause is not the account (negative control)", () => {
		const html = render({
			kind: "computer-offline",
			subject: "Studio Mac",
			copy: {
				cause: "computer-offline",
				title: "Studio Mac is asleep or offline.",
				body: null,
				actions: [{ id: "retry", label: "Retry" }],
				help: null,
				accountCause: false,
			},
			onRetry: () => {},
			onUseAnotherAddress: () => {},
		});
		expect(html).toContain(`data-testid="${CONTROL.refusalAnotherAddress}"`);
	});
});

/*
 * Merge of #257 into #261 (round 7): #257 keyed the kind-default buttons and
 * #261 added the named-cause actions beside them. These pin that the merge kept
 * BOTH: the Retry button on every retry-capable kind, now with #257's keyed
 * label, and #257's UR-C1 direction carried onto #261's own action buttons.
 */
describe("Retry and keyed labels after the #257 merge", () => {
	const RETRY_LABEL = {
		"computer-offline": "Try again",
		"relay-stopped": "Try again",
		password: "Try again",
		retry: "Try now",
		diagnostic: "Retry",
	} as const;

	it.each(Object.entries(RETRY_LABEL) as [keyof typeof RETRY_LABEL, string][])(
		"%s without named copy: the prominent Retry renders, keyed",
		(kind, label) => {
			const html = render({
				kind,
				subject: "Studio Mac",
				copy: null,
				onRetry: () => {},
			});
			expect(html).toContain(
				`data-testid="${REGION.connectionErrorRetryProminent}"`,
			);
			expect(html).toContain(`>${label}<`);
		},
	);

	it("a named cause with a retry action renders it in the prominent region", () => {
		const html = render({
			kind: "computer-offline",
			subject: "Studio Mac",
			copy: {
				cause: "computer-offline",
				title: "Studio Mac is asleep or offline.",
				body: null,
				actions: [{ id: "retry", label: "Retry" }],
				help: null,
			},
			onRetry: () => {},
		});
		expect(html).toContain(`data-testid="${CONTROL.refusalActionRetry}"`);
		expect(html).toContain(
			`data-testid="${REGION.connectionErrorRetryProminent}"`,
		);
	});

	it("the kind defaults render #257's keys, not the English literals they replaced", () => {
		const html = render({
			kind: "console",
			subject: "Studio Mac",
			copy: null,
			onOpenConsole: () => {},
			onUseAnotherAddress: () => {},
		});
		expect(html).toContain(">Open the Radient console<");
		expect(html).toContain(">Use another address<");
	});

	it("a named cause's action labels state the page's base on an RTL page (UR-C1)", () => {
		/* ur `Radient بلنگ کھولیں` / `Radient کنسول کھولیں` open with Latin, so
		 *  without `labelDir` `dir="auto"` lays them LTR on an RTL page. */
		const children = h(RefusalSurface, {
			kind: "console",
			subject: "Studio Mac",
			copy: {
				cause: "balance-out",
				title: "t",
				body: null,
				actions: [
					{
						id: "open-billing",
						label: "BILLING",
						url: "https://x.example",
					},
					{ id: "retry", label: "RETRY" },
				],
				help: null,
			},
			onRetry: () => {},
		});
		const surface = (direction: "ltr" | "rtl") =>
			renderToStaticMarkup(
				h(DirectionProvider, {
					direction,
					locale: direction === "rtl" ? "ur" : "en",
					children,
				}),
			);
		const tagOf = (markup: string, text: string) => {
			const at = markup.indexOf(`>${text}<`);
			expect(at, text).toBeGreaterThan(-1);
			return markup.slice(markup.lastIndexOf("<", at), at + 1);
		};
		const rtl = surface("rtl");
		for (const label of ["BILLING", "RETRY"]) {
			expect(tagOf(rtl, label)).toContain('dir="rtl"');
			// LTR emits nothing: the inferred base is kept (negative control).
			expect(tagOf(surface("ltr"), label)).not.toContain('dir="rtl"');
		}
	});
});

describe("the set-up screen", () => {
	const setup = (
		billing: Parameters<typeof SetupComputer>[0]["billing"] = null,
	) =>
		renderToStaticMarkup(
			h(SetupComputer, {
				billing,
				onWaitForConnector: () => {},
				waiting: false,
				onCheckAgain: () => {},
				checking: false,
			}),
		);

	it("keeps every command behind its closed disclosure, and Check again outside it (U2)", () => {
		const html = setup();
		expect(html).not.toMatch(/lop (login|tunnel)/);
		const button = toggle(html, CONTROL.setupTerminalToggle);
		expect(button).not.toBe("");
		expect(button).not.toContain('aria-expanded="true"');
		expect(html).toContain(`data-testid="${CONTROL.setupCheckAgain}"`);
		expect(html).toContain("Settings → Radient account → Phone access");
	});

	it("says what is wrong with billing in phone-access words, keyed (R5)", () => {
		const off = setup({ active: false, eligible: false, message: "x" });
		expect(off).toContain(
			"Phone access isn&#x27;t turned on for your Radient account yet.",
		);
		expect(off).not.toContain("Remote access");
		const out = setup({ active: true, eligible: false, message: "x" });
		expect(out).toContain("Your Radient balance has run out.");
		expect(
			setup({ active: true, eligible: true, message: null }),
		).not.toContain("balance");
	});
});
