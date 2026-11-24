/**
 * The subagent screen, mounted for real against a fixture relay.
 *
 * THE REPORT (TestFlight, operator): "subagent transcripts don't properly show
 * … Should use the same transcript components as the main view. Also the
 * subagent title text is way too large". A RUNNING qa-tester child 24 minutes
 * in drew "This subagent has no transcript rows of its own." The screen drew
 * `detail.transcript`, which a current Core always sends empty (Core
 * `mobile/projection.py`: "transcript is intentionally left empty here"); the
 * rows live behind `GET …/agents/{job}/history`, which nothing called.
 *
 * WHAT IS REAL HERE. The screen module (`app/(app)/session/[id]/agent/[jobId].tsx`),
 * `useSubagentTranscript`, the main view's `HistoryWindow` and its merge, the
 * status badge, the copy. WHAT IS STUBBED, and why: the Node host cannot load
 * `TranscriptList` (its react-native dependencies ship Flow source — `import`
 * fails with "Unexpected token 'typeof'"), so it is replaced by a recorder of
 * the props the screen hands it — the assertion is on what the SAME list the
 * main view uses is given. The kit's `Screen`/controls (uniwind, safe-area) are
 * likewise recorders; the title's size class is asserted against the real
 * `BridgeThreadTitleView` drawing below. The rendered frames are QA's.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, createElement, isValidElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	HistoryResponse,
	SubagentDetail,
	TranscriptEntry,
} from "@/contracts";
import { RelayError } from "@/relay/errors";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL } from "@/ui/a11y";

const host = vi.hoisted(() => ({
	list: null as null | Record<string, unknown>,
	screen: null as null | Record<string, unknown>,
	presses: new Map<string, () => void>(),
	texts: [] as string[],
	runtime: null as null | Record<string, unknown>,
}));

vi.mock("expo-router", () => ({
	useLocalSearchParams: () => ({ id: "root", jobId: "job-qa" }),
	useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/features/session/use-session", () => ({
	useSessionRuntime: () => host.runtime,
}));
vi.mock("@/features/session/components/transcript-list", () => ({
	TranscriptList: (props: Record<string, unknown>) => {
		host.list = props;
		return (props.entries as unknown[]).length === 0
			? ((props.empty as ReactNode) ?? null)
			: null;
	},
}));
vi.mock("@/features/session/components/todos-panel", () => ({
	TodosPanel: () => null,
}));
vi.mock("@/features/session/components/user-message-clamp", () => ({
	UserMessageClamp: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/team-bridge/thread-chrome", () => ({
	BridgeThreadTitle: () => null,
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000000" }));
// The title's real drawing is loaded below (`importActual`); these are the
// boundaries its module graph reaches that the Node host cannot load — the
// same stubs `thread-chrome.test.tsx` uses.
vi.mock("lucide-react-native", () => ({ Paperclip: () => null }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/ui/components/textarea", () => ({ Textarea: () => null }));
vi.mock("@/ui/layout", () => ({ useCompactChrome: () => false }));
vi.mock("@/ui/components/back-icon", () => ({ BackIcon: () => null }));
vi.mock("@/ui/components", () => ({
	Screen: (props: Record<string, unknown> & { children: ReactNode }) => {
		host.screen = props;
		return props.children;
	},
	Badge: ({ label }: { label: string }) => {
		host.texts.push(`badge:${label}`);
		return null;
	},
	Button: ({
		label,
		onPress,
		testID,
	}: {
		label: string;
		onPress: () => void;
		testID: string;
	}) => {
		host.presses.set(testID, onPress);
		host.texts.push(label);
		return null;
	},
	EmptyState: ({ headline }: { headline: string }) => {
		host.texts.push(headline);
		return null;
	},
	IconButton: () => null,
	Skeleton: ({ testID }: { testID: string }) => {
		host.texts.push(`skeleton:${testID}`);
		return null;
	},
}));
vi.mock("react-native", () => ({
	View: ({ children }: { children?: ReactNode }) => children ?? null,
	Text: ({ children }: { children?: ReactNode }) => {
		const flat = Array.isArray(children) ? children.join("") : children;
		if (typeof flat === "string") host.texts.push(flat);
		return null;
	},
}));

const { default: Subagent } = await import(
	"../../../app/(app)/session/[id]/agent/[jobId]"
);
const { BridgeThreadTitleView } = await vi.importActual<
	typeof import("@/features/team-bridge/thread-chrome")
>("@/features/team-bridge/thread-chrome");
const { sessionHeaderTitle } = await import("./header");
const { SUBAGENT_POLL_MS } = await import("./use-subagent-transcript");

const row = (id: string, text = id): TranscriptEntry => ({
	id,
	kind: "assistant",
	text,
	tool_call_id: "",
	tool_name: "",
	tool_state: "done",
	summary: "",
	intent: "",
	diff_added: 0,
	diff_removed: 0,
	elapsed_s: 0,
	error: "",
	details: {},
	images: [],
	files: [],
	videos: [],
	final: true,
	text_complete: true,
});

const detailOf = (over: Partial<SubagentDetail> = {}): SubagentDetail => ({
	job_id: "job-qa",
	label: "as481-qa",
	agent: "qa-tester",
	status: "running",
	progress: "",
	elapsed_s: 1475,
	model_label: "anthropic/claude-opus-5-5",
	result_text: "",
	error_text: "",
	parent_job_id: null,
	session_id: null,
	prompt: "OPERATOR REQUEST (verbatim): add a Bedrock provider",
	launch_message_id: "m1",
	effort: "",
	ancestors: [],
	ancestor_ids: [],
	child_ids: [],
	peer_ids: [],
	// What a current Core sends: ALWAYS empty on the detail route.
	transcript: [],
	todos: [],
	activity: "",
	version: 1,
	...over,
});

type Relay = {
	detail: () => Promise<SubagentDetail | null>;
	history: (before?: string) => Promise<HistoryResponse>;
};

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
let relay: Relay;
const historyCalls: (string | undefined)[] = [];

const mount = async () => {
	host.runtime = {
		projection: { conversation_name: "Add Bedrock provider" },
		loadAgent: vi.fn(() => relay.detail()),
		loadAgentHistory: (_job: string, before?: string) => {
			historyCalls.push(before);
			return relay.history(before);
		},
	};
	await act(async () => root.render(createElement(Subagent)));
	await act(async () => {
		await Promise.resolve();
	});
};
const settle = () =>
	act(async () => {
		for (let i = 0; i < 5; i += 1) await Promise.resolve();
	});
const listIds = () =>
	((host.list?.entries as TranscriptEntry[] | undefined) ?? []).map(
		(entry) => entry.id,
	);
const say = (text: string) => host.texts.some((seen) => seen.includes(text));

beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as Element);
	host.list = null;
	host.screen = null;
	host.presses.clear();
	host.texts = [];
	historyCalls.length = 0;
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	vi.useRealTimers();
});

describe("the subagent screen's transcript", () => {
	it("draws the child's /history rows in the main view's list when the detail carries none (TestFlight report)", async () => {
		relay = {
			detail: async () => detailOf({ status: "completed" }),
			history: async () => ({
				entries: [row("e1"), row("e2"), row("e3")],
				has_more: false,
			}),
		};
		await mount();
		await settle();
		expect(listIds()).toEqual(["e1", "e2", "e3"]);
		expect(say("This subagent has no transcript rows of its own.")).toBe(false);
		// The main view's paging props, so the list behaves as it does there.
		expect(typeof host.list?.loadOlder).toBe("function");
		expect(typeof host.list?.retryHistory).toBe("function");
	});

	it("pages older rows through the main view's reader on the list's loadOlder", async () => {
		relay = {
			detail: async () => detailOf({ status: "completed" }),
			history: async (before) =>
				before === undefined
					? { entries: [row("e3"), row("e4")], has_more: true }
					: { entries: [row("e1"), row("e2")], has_more: false },
		};
		await mount();
		await settle();
		expect(listIds()).toEqual(["e3", "e4"]);
		expect(host.list?.hasOlder).toBe(true);
		await act(async () => {
			await (host.list?.loadOlder as (() => Promise<void>) | undefined)?.();
		});
		expect(historyCalls.at(-1)).toBe("e3");
		expect(listIds()).toEqual(["e1", "e2", "e3", "e4"]);
		expect(host.list?.hasOlder).toBe(false);
	});

	it("keeps a running child's tail fresh, merging by id, and stops once it settles", async () => {
		vi.useFakeTimers();
		let tail = [row("e1"), row("e2")];
		let status: SubagentDetail["status"] = "running";
		relay = {
			detail: async () => detailOf({ status }),
			history: async () => ({ entries: tail, has_more: false }),
		};
		await mount();
		await settle();
		expect(listIds()).toEqual(["e1", "e2"]);
		expect(host.list?.turnLive).toBe(true);

		// The child writes a row and edits its last one; the next tick merges both.
		tail = [row("e1"), row("e2", "e2 grown"), row("e3")];
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS);
		});
		await settle();
		expect(listIds()).toEqual(["e1", "e2", "e3"]);
		expect(
			((host.list?.entries ?? []) as TranscriptEntry[]).find(
				(r) => r.id === "e2",
			)?.text,
		).toBe("e2 grown");

		// The child settles: the detail refresh flips the badge and ends the poll.
		status = "completed";
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS);
		});
		await settle();
		expect(say("badge:completed")).toBe(true);
		expect(host.list?.turnLive).toBe(false);
		const settled = historyCalls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS * 5);
		});
		expect(historyCalls.length).toBe(settled);
	});

	it("stops polling a running child once the screen unmounts", async () => {
		vi.useFakeTimers();
		relay = {
			detail: async () => detailOf({ status: "running" }),
			history: async () => ({ entries: [row("e1")], has_more: false }),
		};
		await mount();
		await settle();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS);
		});
		expect(historyCalls.length).toBeGreaterThanOrEqual(2);
		await act(async () => root.unmount());
		const after = historyCalls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SUBAGENT_POLL_MS * 5);
		});
		expect(historyCalls.length).toBe(after);
		// A fresh root for the shared teardown's unmount.
		root = createRoot(dom.container as Element);
	});

	it("falls back to the detail's inline rows when /history 404s (older Core)", async () => {
		relay = {
			detail: async () =>
				detailOf({ status: "completed", transcript: [row("inline-1")] }),
			history: async () => {
				throw new RelayError("rejected", "Not Found", { status: 404 });
			},
		};
		await mount();
		await settle();
		expect(listIds()).toEqual(["inline-1"]);
		// No journal behind inline rows: no paging edge.
		expect(host.list?.loadOlder).toBeUndefined();
	});

	it("says the transcript is not kept — never 'no rows' — when /history 404s and nothing is inline", async () => {
		relay = {
			detail: async () => detailOf({ status: "completed" }),
			history: async () => {
				throw new RelayError("rejected", "Not Found", { status: 404 });
			},
		};
		await mount();
		await settle();
		expect(say("This subagent has no transcript rows of its own.")).toBe(false);
		expect(say("Its transcript was not kept")).toBe(true);
	});

	it("only a successful EMPTY read says the child has no rows", async () => {
		relay = {
			detail: async () => detailOf({ status: "completed" }),
			history: async () => ({ entries: [], has_more: false }),
		};
		await mount();
		await settle();
		expect(say("This subagent has no transcript rows of its own.")).toBe(true);
	});

	it("a dropped link is a retryable state, not the empty line", async () => {
		let fail = true;
		relay = {
			detail: async () => detailOf({ status: "completed" }),
			history: async () => {
				if (fail) throw new RelayError("transport", "offline");
				return { entries: [row("e1")], has_more: false };
			},
		};
		await mount();
		await settle();
		expect(say("This subagent has no transcript rows of its own.")).toBe(false);
		expect(say("The latest messages could not be loaded.")).toBe(true);
		const retry = host.presses.get(CONTROL.subagentRetry);
		expect(retry).toBeTypeOf("function");
		fail = false;
		await act(async () => retry?.());
		await settle();
		expect(listIds()).toEqual(["e1"]);
	});
});

describe("the subagent screen's header", () => {
	it("draws the child's label at the conversation header's size, not the 28 pt display title", async () => {
		relay = {
			detail: async () => detailOf({ status: "completed" }),
			history: async () => ({ entries: [], has_more: false }),
		};
		await mount();
		await settle();
		const node = host.screen?.titleNode;
		expect(isValidElement(node)).toBe(true);
		const props = (node as { props: { title: string; subtitle: string } })
			.props;
		expect(props.title).toBe("as481-qa");
		expect(props.subtitle).toContain("job-qa");
		expect(host.screen?.compact).toBe(false);

		// The real drawing the title node resolves to: the session header's step.
		const markup = renderToStaticMarkup(
			createElement(BridgeThreadTitleView, {
				title: props.title,
				subtitle: props.subtitle,
				compact: false,
				stacked: false,
			}),
		);
		const style = sessionHeaderTitle({ compact: false, stacked: false });
		expect(style.className).toContain("text-heading");
		expect(markup).toContain("as481-qa");
		expect(markup).not.toContain("text-display");
	});

	it("keeps the screen's back control and testIDs", () => {
		const source = readFileSync(
			fileURLToPath(
				new URL(
					"../../../app/(app)/session/[id]/agent/[jobId].tsx",
					import.meta.url,
				),
			),
			"utf8",
		);
		for (const id of [
			"CONTROL.subagentBack",
			"SCREEN.subagent",
			"SURFACE.subagentCrumb",
			"SURFACE.subagentStatus",
			"SURFACE.subagentPrompt",
			"SURFACE.subagentTranscript",
			"backToParentLabel(",
		]) {
			expect(source).toContain(id);
		}
	});
});
