import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type BridgeCardBody,
	type TranscriptEntry,
	transcriptEntrySchema,
} from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/* The region subscribes to `AppState` to re-read on return to the foreground;
 * the listeners are captured so a test can play that return. */
const appState = vi.hoisted(() => ({
	listeners: new Set<(next: string) => void>(),
}));

/**
 * The inbound Team Bridge card (local-operator #4238): rendered through the
 * real row: the old-relay path keeps the receipt text and gains no body region
 * (asserted by content, not a byte comparison with a pre-change render), and
 * the new path renders the body region. The Node host is the server renderer (no
 * effects run), so the fetching shell is asserted in its loading frame and each
 * resolved state through `BridgeCardBodyLines`. Mocks follow
 * `transcript-row-blank.test.tsx`.
 */
vi.mock("react-native", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-native")>();
	const { createElement } = await import("react");
	type HostProps = {
		children?: import("react").ReactNode;
		className?: string;
		testID?: string;
	};
	const host =
		(tag: string) =>
		({ children, className, testID }: HostProps) =>
			createElement(
				tag,
				{ "data-class": className, "data-testid": testID },
				children,
			);
	return {
		...actual,
		View: host("div"),
		Text: host("span"),
		Pressable: host("div"),
		ScrollView: host("div"),
		AppState: {
			currentState: "active",
			addEventListener: (_type: string, fn: (next: string) => void) => {
				appState.listeners.add(fn);
				return { remove: () => appState.listeners.delete(fn) };
			},
		},
	};
});

vi.mock("@/ui/appearance", () => ({
	useReducedMotion: () => false,
	useTheme: () => ({ active: "light" }),
	useTokenColor: (role: string) => `token:${role}`,
}));

vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));

/* The prose arm's renderer pulls native modules the Node host cannot load; a
 * marker stands in so the test can tell the prose arm from the blank one. */
vi.mock("@/features/session/components/markdown", async () => {
	const { createElement } = await import("react");
	return {
		Markdown: ({ text }: { text: string }) =>
			createElement("p", { "data-md": "" }, text),
	};
});

/* Arms this file never renders, whose imports reach `expo` (no `__DEV__` in
 * Node): stubbed so the row module loads; the blank and prose arms are real. */
vi.mock("@/features/session/components/imagegen-card", () => ({
	ImageGenCard: () => null,
}));
vi.mock("@/features/session/components/transcript-image", () => ({
	TranscriptImage: () => null,
}));
vi.mock("@/features/session/components/tool-row", () => ({
	ToolRow: () => null,
}));
/* Integration of #234 with #235: the row now imports the user arm's
 * Show-more clamp, whose `react-native-svg` fade the Node host cannot load
 * (the suite failed to import with "SyntaxError: Unexpected token 'typeof'").
 * This file never renders the user arm, so it is stubbed like the arms above. */
vi.mock("@/features/session/components/user-message-clamp", () => ({
	UserMessageClamp: () => null,
}));

vi.mock("@/ui/components/button", () => ({
	Button: ({ label }: { label: string }) =>
		createElement("button", { type: "button" }, label),
}));

import { BridgeCardBodyLines, BridgeCardBodyRegion } from "./bridge-card-body";
import { TranscriptRow } from "./transcript-row";

const receipt = (): TranscriptEntry => ({
	id: "e-bridge-1",
	kind: "notice",
	text: "Ada · #release",
	custom_type: "team_bridge_message",
	tool_call_id: "",
	tool_name: "",
	tool_state: "done",
	summary: "",
	intent: "",
	diff_added: 0,
	diff_removed: 0,
	elapsed_s: 0,
	error: "",
	details: {
		bridge_receipt: {
			v: 1,
			sender: { name: "Ada" },
			conversation: { kind: "channel", label: "release" },
		},
	},
	images: [],
	final: true,
	text_complete: true,
});

const lines = (view: Parameters<typeof BridgeCardBodyLines>[0]["view"]) =>
	renderToStaticMarkup(createElement(BridgeCardBodyLines, { view }));

describe("inbound Team Bridge card", () => {
	it("keeps today's receipt row when the relay does not serve bodies", () => {
		const markup = renderToStaticMarkup(
			createElement(TranscriptRow, { entry: receipt() }),
		);
		expect(markup).toContain("Ada · #release");
		expect(markup).not.toContain("bridge-body");
		expect(markup).not.toContain("Loading message");
	});

	it("paints the live peer_message echo as the same card when bodies are served (QA Q2)", () => {
		// The exact row `note_peer_message` emits for a live card when the owner
		// has not negotiated peer_cycles: kind peer_message, text = the
		// model-facing METADATA card, the typed marks only on the sender
		// (`deliver_wake`: account_id, source, name, validated receipt).
		// Untyped on purpose: this is the WIRE row, extra sender keys included.
		const live = {
			...receipt(),
			id: "peer-f4c46524ac674537a2b37cc766690742",
			kind: "peer_message",
			custom_type: undefined,
			text: "<team-bridge>\nDirect message · from Ola (human, same tenant)\nmessage_id: bcmsg_live0001",
			details: {
				sender: {
					account_id: "acc_local_1",
					source: "team_bridge_message",
					name: "Ola",
					bridge_receipt: {
						v: 1,
						sender: { name: "Ola", kind: "human" },
						conversation: { kind: "dm" },
					},
				},
			},
		};
		const parsed = transcriptEntrySchema.parse(live);
		const load = vi.fn(async () => null);
		const markup = renderToStaticMarkup(
			createElement(TranscriptRow, { entry: parsed, loadBridgeBody: load }),
		);
		expect(markup).toContain("Ola · DM");
		expect(markup).toContain("Loading message…");
		expect(markup).toContain("-bridge-body");
		expect(markup).not.toContain("another session");
		// The metadata card (ids, envelope) is never painted on the card.
		expect(markup).not.toContain("bcmsg_live0001");
		expect(markup).not.toContain("&lt;team-bridge&gt;");

		// An old relay: the echo stays the peer row it always was.
		const old = renderToStaticMarkup(
			createElement(TranscriptRow, { entry: parsed }),
		);
		expect(old).not.toContain("-bridge-body");
		expect(old).not.toContain("Ola · DM");
	});

	it("paints the live notice arm (custom_kind only) as the card", () => {
		const notice = {
			...receipt(),
			id: "peer-0001",
			custom_type: undefined,
			details: {
				notice_kind: "cross_session_boundary",
				custom_kind: "team_bridge_message",
				sender: { account_id: "acc_local_1", source: "team_bridge_message" },
				bridge_receipt: {
					v: 1,
					sender: { name: "Ada" },
					conversation: { kind: "dm" },
				},
			},
		};
		const markup = renderToStaticMarkup(
			createElement(TranscriptRow, {
				entry: transcriptEntrySchema.parse(notice),
				loadBridgeBody: async () => null,
			}),
		);
		expect(markup).toContain("Ada · DM");
		expect(markup).toContain("-bridge-body");
	});

	it("never treats an ordinary peer message as a card", () => {
		const peer: TranscriptEntry = {
			...receipt(),
			id: "peer-plain",
			kind: "peer_message",
			custom_type: undefined,
			text: "hello from a session",
			details: {
				sender: { session_id: "abcdef012345", conversation_name: "Planner" },
			},
		};
		const markup = renderToStaticMarkup(
			createElement(TranscriptRow, {
				entry: peer,
				loadBridgeBody: async () => null,
			}),
		);
		expect(markup).not.toContain("-bridge-body");
		expect(markup).toContain("Planner");
	});

	it("asks for the body of THIS row and shows loading until it answers", () => {
		const load = vi.fn(async () => null);
		const markup = renderToStaticMarkup(
			createElement(TranscriptRow, { entry: receipt(), loadBridgeBody: load }),
		);
		expect(markup).toContain("Ada · #release");
		expect(markup).toContain("Loading message…");
		expect(markup).toContain("-bridge-body");
		// The receipt text is the caption's own words; it is not painted twice.
		expect(markup.match(/Ada · #release/g)).toHaveLength(1);
	});

	it("renders an admitted body as markdown under the untrusted framing", () => {
		const markup = lines({
			lines: [{ kind: "body", markdown: "**ship it**" }],
			more: 0,
		});
		expect(markup).toContain("External message · untrusted content");
		expect(markup).toContain('data-md=""');
		expect(markup).toContain("**ship it**");
		// The untrusted rail is the control edge, not the blockquote hairline (D3).
		expect(markup).toContain("border-border-control");
		expect(markup.indexOf("untrusted content")).toBeLessThan(
			markup.indexOf("ship it"),
		);
	});

	it.each([
		["held", "Held for review."],
		["held_transient", "Waiting for screening — not shown to your agent yet."],
		["refused", "Refused by moderation."],
		["pending", "Waiting to be delivered to your agent."],
		["deleted", "This message was deleted."],
		["offline", "Couldn't reach Radient — retrying."],
		["unavailable", "Message body unavailable."],
	] as const)("says %s in words, with no untrusted framing", (state, copy) => {
		const markup = lines({ lines: [{ kind: "state", state }], more: 0 });
		expect(markup).toContain(copy.replace("'", "&#x27;"));
		expect(markup).not.toContain("untrusted content");
		expect(markup).not.toContain('data-md=""');
	});

	it("counts the messages the relay did not itemise", () => {
		const markup = lines({
			lines: [{ kind: "state", state: "pending" }],
			more: 2,
		});
		expect(markup).toContain("2 more messages in this card");
	});

	it("the fetching shell starts in its loading frame", () => {
		const markup = renderToStaticMarkup(
			createElement(BridgeCardBodyRegion, {
				entryId: "e-bridge-1",
				load: async () => null,
			}),
		);
		expect(markup).toContain("Loading message…");
	});
});

/**
 * The fetching shell, MOUNTED (effects run): the regression for a card read
 * once while `pending` that never showed the body delivered later. Fake
 * timers drive the backoff (`bridge-card-reread.ts`); the text is read off the
 * DOM shim the reconciler renders into.
 */
describe("inbound Team Bridge card body, mounted", () => {
	let dom: DomShim | null = null;
	let root: ReturnType<typeof createRoot> | null = null;

	type Node = {
		nodeType: number;
		nodeValue?: string | null;
		textContent?: string | null;
		childNodes: Node[];
	};
	const textOf = (node: Node): string =>
		node.nodeType === 3
			? (node.nodeValue ?? "")
			: node.childNodes.length === 0
				? (node.textContent ?? "")
				: node.childNodes.map(textOf).join("|");
	const shown = () => textOf(dom?.container as Node);

	const body = (...items: BridgeCardBody["items"]): BridgeCardBody => ({
		v: 1,
		items,
		more: 0,
	});
	const PENDING = body({ state: "pending" });
	const ADMITTED = body({ state: "admitted", body: "the screened body" });

	const mount = (props: {
		entryId: string;
		load: (id: string) => Promise<BridgeCardBody | null>;
	}) =>
		act(async () => root?.render(createElement(BridgeCardBodyRegion, props)));

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		dom = installDomShim();
		root = createRoot(dom.container as Element);
		appState.listeners.clear();
	});
	afterEach(async () => {
		await act(async () => root?.unmount());
		root = null;
		dom?.dispose();
		dom = null;
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("shows the body once a pending card is delivered, while it stays open", async () => {
		const queue = [PENDING, PENDING, ADMITTED];
		const load = vi.fn(async (_id: string) => queue.shift() ?? ADMITTED);
		await mount({ entryId: "e-1", load });
		expect(shown()).toContain("Waiting to be delivered to your agent.");
		await act(async () => vi.advanceTimersByTimeAsync(5_000));
		expect(load).toHaveBeenCalledTimes(2);
		expect(shown()).toContain("Waiting to be delivered to your agent.");
		await act(async () => vi.advanceTimersByTimeAsync(10_000));
		expect(load).toHaveBeenCalledTimes(3);
		expect(shown()).toContain("the screened body");
		expect(shown()).toContain("External message · untrusted content");
		expect(shown()).not.toContain("Waiting to be delivered");
		// Final: the backoff stops.
		await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000));
		expect(load).toHaveBeenCalledTimes(3);
		expect(load.mock.calls.every(([id]) => id === "e-1")).toBe(true);
	});

	it("keeps the last answer on screen during a re-read (no flash to Loading)", async () => {
		let release: (value: BridgeCardBody) => void = () => {};
		const load = vi
			.fn<(id: string) => Promise<BridgeCardBody | null>>()
			.mockResolvedValueOnce(PENDING)
			.mockImplementationOnce(
				() =>
					new Promise((r) => {
						release = r;
					}),
			);
		await mount({ entryId: "e-1", load });
		await act(async () => vi.advanceTimersByTimeAsync(5_000));
		expect(load).toHaveBeenCalledTimes(2);
		// The second read is in flight: the pending sentence stays.
		expect(shown()).toContain("Waiting to be delivered to your agent.");
		expect(shown()).not.toContain("Loading message");
		await act(async () => release(ADMITTED));
		expect(shown()).toContain("the screened body");
	});

	it.each([
		["refused", body({ state: "refused" }), "Refused by moderation."],
		[
			"a review hold, until it is refused",
			body({ state: "held", hold: { class: "awaiting_review" } }),
			"Held for review.",
		],
	])(
		"says %s in words, never 'still being delivered'",
		async (_l, first, copy) => {
			const load = vi.fn(async () => first);
			await mount({ entryId: "e-1", load });
			expect(shown()).toContain(copy);
			expect(shown()).not.toContain("Waiting to be delivered");
		},
	);

	it("re-reads a review hold until it settles as refused, then stops", async () => {
		const queue = [
			body({ state: "held", hold: { class: "awaiting_review" } }),
			body({ state: "refused" }),
		];
		const load = vi.fn(async () => queue.shift() ?? body({ state: "refused" }));
		await mount({ entryId: "e-1", load });
		expect(shown()).toContain("Held for review.");
		await act(async () => vi.advanceTimersByTimeAsync(5_000));
		expect(shown()).toContain("Refused by moderation.");
		await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000));
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("stops re-reading on unmount", async () => {
		const load = vi.fn(async () => PENDING);
		await mount({ entryId: "e-1", load });
		await act(async () => root?.unmount());
		root = null;
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(load).toHaveBeenCalledTimes(1);
		expect(appState.listeners.size).toBe(0);
	});

	it("re-reads at once when the app returns to the foreground", async () => {
		const queue = [PENDING, ADMITTED];
		const load = vi.fn(async () => queue.shift() ?? ADMITTED);
		await mount({ entryId: "e-1", load });
		await act(async () => {
			for (const fn of appState.listeners) fn("active");
		});
		expect(load).toHaveBeenCalledTimes(2);
		expect(shown()).toContain("the screened body");
	});

	it("starts over for a new entry and never shows the old card's answer", async () => {
		const load = vi.fn(async (id: string) =>
			id === "e-1" ? ADMITTED : PENDING,
		);
		await mount({ entryId: "e-1", load });
		expect(shown()).toContain("the screened body");
		await mount({ entryId: "e-2", load });
		expect(shown()).not.toContain("the screened body");
		expect(load).toHaveBeenLastCalledWith("e-2");
	});
});

describe("card receipt context rendering", () => {
	it("shows localized receipt date/time and thread reply alongside untrusted body", () => {
		const received_at = "2026-11-21T15:11:44Z";
		const markup = lines({
			lines: [{ kind: "body", markdown: "screened body" }],
			more: 0,
			card: { received_at, thread_reply: true },
		});
		const formatted = new Intl.DateTimeFormat("en", {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(received_at));
		expect(markup).toContain(formatted);
		expect(markup).toContain("Thread reply");
		expect(markup).toContain("External message · untrusted content");
		expect(markup.indexOf("Thread reply")).toBeLessThan(
			markup.indexOf("screened body"),
		);
	});
	it("does not invent a thread marker for a top-level or older-relay card", () => {
		for (const card of [
			undefined,
			{ thread_reply: false },
			{ received_at: "invalid" },
		]) {
			const markup = lines({
				lines: [{ kind: "body", markdown: "screened body" }],
				more: 0,
				card,
			});
			expect(markup).not.toContain("Thread reply");
			expect(markup).not.toContain("Invalid Date");
			expect(markup).toContain("screened body");
		}
	});
});
