import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL } from "@/ui/a11y";

/**
 * The Settings account card, MOUNTED and PRESSED (PR #258 review R1, B1).
 *
 * The first fix keyed the sign-in button on `accountLabel == null`, which no
 * production code ever makes false, so every signed-in Radient reader got a
 * button that retires their grant and ends their route; a source-text test
 * pinned that defect in place. These render the real `AccountCard` against a
 * stubbed connection (only leaf primitives are stubbed: Node has no React
 * Native host) and assert what a reader can press:
 *  - signed in with Radient → a plain card, no sign-in control;
 *  - signed out → a button that calls the provider's `signInWithRadient`;
 *  - signed out WITH a working direct route → a confirm first (R1 m1).
 */
type Route = { mode: "radient" | "direct"; baseUrl: string } | null;
const host = vi.hoisted(() => ({
	connection: {
		radientSignedIn: false,
		coldStartSettled: true,
		busy: false,
		restoredAccount: false,
		refusal: null as object | null,
		signInState: { kind: "idle" } as { kind: string },
		signInDiagnostics: [] as unknown[],
		signInWithRadient: vi.fn(async () => undefined),
	},
	state: {
		route: null as Route,
		accountLabel: null as string | null,
		computers: [] as { name: string }[],
	},
	presses: new Map<string, () => void>(),
	roles: new Map<string, string | undefined>(),
	labels: new Map<string, string | undefined>(),
	texts: [] as string[],
	cards: 0,
	dialog: null as null | {
		visible: boolean;
		title: string;
		body: string;
		confirmLabel: string;
		onConfirm: () => void;
		onCancel: () => void;
	},
	replace: vi.fn(),
}));

vi.mock("expo-router", () => ({
	useRouter: () => ({ replace: host.replace, push: vi.fn() }),
}));
vi.mock("lucide-react-native", () => ({
	ChevronLeft: () => null,
	ChevronRight: () => null,
}));
vi.mock("react-native", () => ({
	View: ({ children }: { children?: ReactNode }) => children ?? null,
	Text: ({ children }: { children?: ReactNode }) => {
		if (typeof children === "string") host.texts.push(children);
		return children ?? null;
	},
	Pressable: ({
		children,
		testID,
		onPress,
		accessibilityRole,
		accessibilityLabel,
	}: {
		children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
		testID?: string;
		onPress?: () => void;
		accessibilityRole?: string;
		accessibilityLabel?: string;
	}) => {
		if (testID && onPress) host.presses.set(testID, onPress);
		if (testID) {
			host.roles.set(testID, accessibilityRole);
			host.labels.set(testID, accessibilityLabel);
		}
		return (
			(typeof children === "function"
				? children({ pressed: false })
				: children) ?? null
		);
	},
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => host.connection,
	useConnectionState: <T,>(select: (state: typeof host.state) => T) =>
		select(host.state),
}));
vi.mock("@/features/auth/sign-in-panel", () => ({ SignInPanel: () => null }));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "black" }));
vi.mock("@/ui/direction", () => ({
	useComposedDir: () => ({}),
	useIsRTL: () => false,
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/ui/components/avatar", () => ({
	Avatar: () => null,
	initialsOf: (name: string) => name.slice(0, 2),
}));
vi.mock("@/ui/components/card", () => ({
	Card: ({ children }: { children?: ReactNode }) => {
		host.cards += 1;
		return children ?? null;
	},
}));
vi.mock("@/ui/components/dialog", () => ({
	Dialog: (props: NonNullable<typeof host.dialog>) => {
		host.dialog = props;
		return null;
	},
}));

const { AccountCard } = await import("./account-card");

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const render = () => {
	host.presses.clear();
	host.roles.clear();
	host.labels.clear();
	host.texts = [];
	host.cards = 0;
	host.dialog = null;
	return act(async () => root.render(<AccountCard />));
};
const press = (id: string) => act(async () => host.presses.get(id)?.());
const SIGN_IN = CONTROL.settingsAccountSignIn;

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(host.connection, {
		radientSignedIn: false,
		coldStartSettled: true,
		busy: false,
		restoredAccount: false,
		refusal: null,
		signInState: { kind: "idle" },
	});
	Object.assign(host.state, { route: null, accountLabel: null, computers: [] });
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("signed in with Radient: a plain card, nothing to press", () => {
	it("renders the plain card with no sign-in control, even with accountLabel null", async () => {
		host.connection.radientSignedIn = true;
		host.state.route = { mode: "radient", baseUrl: "https://m.example" };
		/* The production shape: nothing writes a non-null accountLabel. */
		host.state.accountLabel = null;
		await render();
		expect(host.cards).toBe(1);
		expect(host.presses.has(SIGN_IN)).toBe(false);
		expect(host.texts).toContain(
			t("mobile.settings.account.signed_in_radient"),
		);
		expect(host.texts).not.toContain(
			t("mobile.settings.account.not_signed_in"),
		);
		expect(host.texts).not.toContain(t("mobile.signin.start"));
	});
	it("stays inert before the cold start settles, while tokens may still be restoring", async () => {
		host.connection.coldStartSettled = false;
		await render();
		expect(host.cards).toBe(1);
		expect(host.presses.has(SIGN_IN)).toBe(false);
	});
});

describe("not signed in with Radient: the card is the sign-in button", () => {
	it("is a role-button labelled as the action, and calls signInWithRadient", async () => {
		await render();
		expect(host.cards).toBe(0);
		expect(host.roles.get(SIGN_IN)).toBe("button");
		expect(host.labels.get(SIGN_IN)).toBe(t("mobile.signin.start"));
		expect(host.texts).toContain(t("mobile.settings.account.not_signed_in"));
		expect(host.texts).toContain(t("mobile.signin.start"));
		await press(SIGN_IN);
		expect(host.connection.signInWithRadient).toHaveBeenCalledTimes(1);
		expect(host.dialog?.visible).toBe(false);
	});
	it("starts directly from a refused route: nothing working is lost", async () => {
		host.state.route = { mode: "direct", baseUrl: "https://mac.example" };
		host.connection.refusal = { surface: "computer-offline" };
		await render();
		await press(SIGN_IN);
		expect(host.connection.signInWithRadient).toHaveBeenCalledTimes(1);
	});
});

describe("R1 m1: a working direct route is not ended on one tap", () => {
	beforeEach(() => {
		host.state.route = { mode: "direct", baseUrl: "https://mac.example" };
	});
	it("confirms first, naming the effect, and Cancel leaves the route alone", async () => {
		await render();
		await press(SIGN_IN);
		expect(host.connection.signInWithRadient).not.toHaveBeenCalled();
		expect(host.dialog?.visible).toBe(true);
		expect(host.dialog?.title).toBe(t("mobile.settings.sign_in_confirm.title"));
		expect(host.dialog?.body).toBe(t("mobile.settings.sign_in_confirm.body"));
		expect(host.dialog?.body).toMatch(/ends your current connection/);
		await act(async () => host.dialog?.onCancel());
		expect(host.dialog?.visible).toBe(false);
		expect(host.connection.signInWithRadient).not.toHaveBeenCalled();
	});
	it("Confirm starts the same sign-in and closes the dialog", async () => {
		await render();
		await press(SIGN_IN);
		await act(async () => host.dialog?.onConfirm());
		expect(host.connection.signInWithRadient).toHaveBeenCalledTimes(1);
		expect(host.dialog?.visible).toBe(false);
	});
});

describe("lands like Welcome once its own attempt completes", () => {
	it("navigates through signInPresentation after this card's attempt only", async () => {
		host.connection.restoredAccount = true;
		await render();
		expect(host.replace).not.toHaveBeenCalled();
		await press(SIGN_IN);
		host.state.route = { mode: "radient", baseUrl: "https://m.example" };
		host.connection.radientSignedIn = true;
		await render();
		expect(host.replace).toHaveBeenCalledWith("/");
	});
});
