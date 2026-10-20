import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingView } from "../pending";
import { ConnectionBanner } from "./connection-banner";
import { PendingCard } from "./pending-card";

// Actual component hooks/handlers, null native adapters only. These checks are
// not rendered pixels, real measurement, native selection/focus or gesture proof.
type Props = Record<string, unknown>;
const host = vi.hoisted(() => ({
	records: [] as { kind: string; props: Props; body: boolean }[],
	mounts: 0,
	unmounts: 0,
	bodyContext: null as unknown,
}));
vi.mock("react-native", async () => {
	const React = await import("react");
	const Body = React.createContext(false);
	host.bodyContext = Body;
	function view(kind: string) {
		return (props: Props) => {
			const body = React.useContext(Body);
			host.records.push({ kind, props, body });
			return kind === "ScrollView"
				? React.createElement(
						Body.Provider,
						{ value: true },
						props.children as React.ReactNode,
					)
				: (props.children ?? null);
		};
	}
	return {
		Platform: { OS: "web" },
		View: view("View"),
		ScrollView: view("ScrollView"),
		Pressable: view("Pressable"),
		Text: (props: Props) => {
			host.records.push({ kind: "Text", props, body: React.useContext(Body) });
			return null;
		},
		TextInput: (props: Props) => {
			host.records.push({
				kind: "TextInput",
				props,
				body: React.useContext(Body),
			});
			React.useEffect(() => {
				host.mounts++;
				return () => {
					host.unmounts++;
				};
			}, []);
			return null;
		},
	};
});
vi.mock("@/ui/components", async () => {
	const React = await import("react");
	return {
		Button: (props: Props) => {
			host.records.push({
				kind: "Button",
				props,
				body: React.useContext(host.bodyContext as React.Context<boolean>),
			});
			return null;
		},
	};
});
let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => {
	host.records.length = 0;
	host.mounts = 0;
	host.unmounts = 0;
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
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
	root = createRoot({
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		ownerDocument: doc,
		addEventListener() {},
		removeEventListener() {},
	} as unknown as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	vi.unstubAllGlobals();
});

const find = (kind: string, id?: string) => {
	const record = host.records
		.filter(
			(x) => x.kind === kind && (id === undefined || x.props.testID === id),
		)
		.at(-1);
	if (!record) throw new Error(`Missing ${kind}/${id ?? "any"}`);
	return record;
};
const base = {
	request_id: "recovery-question",
	kind: "approval" as const,
	title: "bash",
	detail: "run: sleep 20",
	options: [],
	secret: false,
	question_index: 0,
	question_total: 1,
	recommended: null,
	persist: false,
};
function view(ask = false) {
	return pendingView({
		pending: { ...base, kind: ask ? "ask" : "approval" },
		sessionKind: "daemon",
		ended: false,
		pendingCount: 1,
		computerLabel: "test",
		cwd: "~/work",
	});
}
const action = vi.fn();
const notice = createElement(ConnectionBanner, {
	view: {
		id: "C5",
		tone: "danger",
		text: "Your Radient session expired. Sign in to reconnect to this computer.",
		action: {
			kind: "sign-in",
			label: "Sign in again",
			testID: "recover-action",
		},
		testIDs: [],
	},
	onAction: action,
});
async function render(show: boolean, ask = false, onPinnedLayout = vi.fn()) {
	host.records.length = 0;
	await act(async () =>
		root?.render(
			createElement(PendingCard, {
				view: view(ask),
				bodyMaxHeight: 56,
				bodyNotice: show ? notice : null,
				onPinnedLayout,
			}),
		),
	);
}
describe("pending recovery single body host", () => {
	it("renders full copy and one real CTA in the existing body, with decisions outside", async () => {
		await render(true);
		expect(
			host.records.filter((x) => x.props.accessibilityRole === "alert"),
		).toHaveLength(1);
		expect(host.records.filter((x) => x.kind === "ScrollView")).toHaveLength(1);
		expect(find("ScrollView").props.style).toMatchObject({
			minHeight: 56,
			maxHeight: 56,
		});
		expect(
			host.records.some(
				(x) =>
					x.kind === "Text" &&
					x.props.children ===
						"Your Radient session expired. Sign in to reconnect to this computer." &&
					x.body,
			),
		).toBe(true);
		const buttons = host.records.filter((x) => x.kind === "Button");
		expect(buttons.map((x) => x.props.label)).toEqual([
			"Sign in again",
			"Approve",
			"Deny",
		]);
		expect(buttons.map((x) => x.body)).toEqual([true, false, false]);
		const scroll = find("ScrollView").props;
		// Actual onScroll handler accepts real-shaped geometry and updates body cue state.
		await act(async () =>
			(scroll.onScroll as (e: unknown) => void)({
				nativeEvent: {
					contentOffset: { y: 300 },
					contentSize: { height: 500 },
					layoutMeasurement: { height: 56 },
				},
			}),
		);
		action.mockClear();
		(find("Button", "recover-action").props.onPress as () => void)();
		expect(action).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "sign-in" }),
		);
	});
	it("retains local free-text answer across notice insertion/removal and reports pinned measurements", async () => {
		const measured = vi.fn();
		await render(false, true, measured);
		await act(async () =>
			(find("TextInput").props.onChangeText as (s: string) => void)(
				"retained answer",
			),
		);
		await render(true, true, measured);
		expect(find("TextInput").props.value).toBe("retained answer");
		const regions = host.records.filter(
			(x) =>
				x.kind === "View" &&
				["shrink-0 pb-1", "shrink-0 pt-2"].includes(String(x.props.className)),
		);
		regions.forEach((x, i) => {
			(x.props.onLayout as (e: unknown) => void)({
				nativeEvent: { layout: { height: i ? 56 : 71 } },
			});
		});
		expect(measured.mock.calls).toEqual([
			["header", 71],
			["controls", 56],
		]);
		await render(false, true, measured);
		expect(find("TextInput").props.value).toBe("retained answer");
		expect(host.mounts).toBe(1);
		expect(host.unmounts).toBe(0);
		expect(
			host.records.filter((x) => x.props.accessibilityRole === "alert"),
		).toHaveLength(0);
	});
});
