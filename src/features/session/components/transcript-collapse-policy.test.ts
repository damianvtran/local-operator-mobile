import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * WHICH rows fold, per kind — the policy half of design item 9.
 *
 * The probe records every `CollapsedRow` the row decides to use, so an assertion
 * is about the DECISION (fold / do not fold, and what the summary line says)
 * rather than about pixels. The primitive's own behaviour — one line, press to
 * expand in place, `aria-expanded` — is `collapsed-row.test.ts`.
 *
 * The never-collapsible kinds are asserted here as absences, which is the only
 * way to state "never": the assistant's answer (it is the page), the reader's
 * own prompt and steers and every error notice (review round 1, R1-2 / U1 / D2:
 * the relay and the desktop both keep them open), a settled `ask` receipt and
 * the tool rows (already one-line disclosures of their own — folding them
 * again would nest one fold in another).
 */

type FoldSeen = {
	glyph: string;
	label?: string;
	summary: string;
	meta?: string;
	accessibilityLabel?: string;
	action?: unknown;
};

const folds = vi.hoisted(() => ({ seen: [] as FoldSeen[] }));

vi.mock("react-native", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		children ?? null;
	return {
		Platform: { OS: "web" },
		View: passthrough,
		Text: passthrough,
		Pressable: passthrough,
		ScrollView: passthrough,
		StyleSheet: {
			create: (value: unknown) => value,
			flatten: (v: unknown) => v,
		},
	};
});

/* The row's choices, with the fold recorded instead of drawn. */
vi.mock(
	"@/features/session/components/collapsed-row",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@/features/session/components/collapsed-row")
			>();
		return {
			...actual,
			/* Recorded, and its expanded content drawn as if open — so an
			 *  assertion can ask what the reader gets once they expand it. */
			CollapsedRow: (props: FoldSeen & { children?: unknown }) => {
				folds.seen.push({
					glyph: props.glyph,
					label: props.label,
					summary: props.summary,
					meta: props.meta,
					accessibilityLabel: props.accessibilityLabel,
					action: props.action,
				});
				return (props.children ?? null) as never;
			},
		};
	},
);

/* `collapsed-row.tsx` reads the text scale (its large-text stack, D1); the
 *  real provider pulls the native `react-native` tree this harness stubs. */
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1, scale: 1 }),
}));
vi.mock("@/features/session/components/markdown", () => ({
	Markdown: () => null,
}));
vi.mock("@/features/session/components/tool-row", () => ({
	ToolRow: () => null,
}));
vi.mock("@/features/session/components/ask-response-row", () => ({
	AskResponseRow: () => null,
}));
/* The reader's bubble reads its native fill from the active palette
 *  (`transcript-row.tsx`'s `UserBox`); the real module reaches `uniwind`,
 *  which Node cannot load. Same stub as `transcript-fold-state.test.ts`. */
vi.mock("@/ui/appearance", () => ({
	useTheme: () => ({ active: { colors: {} } }),
}));
vi.mock("@/features/session/components/transcript-image", () => ({
	TranscriptImage: () => null,
}));
vi.mock("@/features/session/components/imagegen-card", () => ({
	ImageGenCard: () => null,
}));

const { TranscriptRow } = await import(
	"@/features/session/components/transcript-row"
);
const { shouldFold, firstLine } = await import(
	"@/features/session/components/collapsed-row"
);

const seed = JSON.parse(
	readFileSync(
		new URL("../../../../fixtures/relay/http/history-ok.json", import.meta.url),
		"utf8",
	),
).body.entries[0] as TranscriptEntry;

const LONG = `${"A peer asked whether the deploy had finished. ".repeat(3)}`;
const SHORT = "done";

const entry = (over: Partial<TranscriptEntry>): TranscriptEntry => ({
	...seed,
	id: "collapse-row",
	text: "",
	images: [],
	details: {},
	...over,
});

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;

const render = async (
	row: TranscriptEntry,
	extra: { onOpenAgent?: (jobId: string) => void } = {},
) => {
	folds.seen.length = 0;
	await act(async () =>
		root?.render(createElement(TranscriptRow, { entry: row, ...extra })),
	);
	return folds.seen;
};

type TextNode = { nodeValue?: unknown; childNodes?: TextNode[] };
/** Every string the row put in the tree, in order. */
const textOf = (node: TextNode): string =>
	String(node.nodeValue ?? "") + (node.childNodes ?? []).map(textOf).join("");

beforeEach(() => {
	dom = installDomShim();
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	vi.unstubAllGlobals();
});

describe("the fold threshold, stated once", () => {
	it("folds a body that does not fit one line, and leaves a short one alone", () => {
		expect(shouldFold(SHORT)).toBe(false);
		expect(shouldFold("x".repeat(80))).toBe(false);
		expect(shouldFold("x".repeat(81))).toBe(true);
		expect(shouldFold(`first line\nsecond line`)).toBe(true);
		// A body that merely OPENS with a blank line still has one line.
		expect(shouldFold(`\n\n${SHORT}\n`)).toBe(false);
		expect(shouldFold("   ")).toBe(false);
	});

	it("summarises with the first line that carries anything", () => {
		expect(firstLine("\n\n  first real line\nsecond")).toBe("first real line");
		expect(firstLine("")).toBe("");
	});
});

describe("which event kinds fold", () => {
	it.each([
		["peer message", { kind: "peer_message", text: LONG }],
		["parent message", { kind: "parent_message", text: LONG }],
		["subagent message", { kind: "subagent_message", text: LONG }],
		["notice", { kind: "notice", text: LONG }],
		["compaction", { kind: "compaction", text: LONG }],
		[
			"warning notice",
			{ kind: "notice", text: LONG, details: { severity: "warning" } },
		],
	] as [string, Partial<TranscriptEntry>][])(
		"folds a %s to one line",
		async (_name, over) => {
			const seen = await render(entry(over));
			expect(seen).toHaveLength(1);
			expect(seen[0]?.summary).toBe(firstLine(String(over.text)));
		},
	);

	it.each([
		["long sent message", { kind: "user", text: LONG }],
		["multi-line sent message", { kind: "user", text: "one\ntwo\nthree" }],
		["long steer", { kind: "steer", text: LONG }],
		[
			"error notice",
			{
				kind: "notice",
				text: `${LONG}\n${LONG}`,
				details: { severity: "error" },
			},
		],
	] as [string, Partial<TranscriptEntry>][])(
		"never folds a %s, at any length (R1-2 / U1 / D2)",
		async (_name, over) => {
			expect(await render(entry(over))).toHaveLength(0);
			// …and the whole text is on screen.
			expect(textOf(dom?.container as TextNode)).toContain(String(over.text));
		},
	);

	it("keeps a folded wake notice's cause on the bar (m5 / Q6)", async () => {
		const seen = await render(
			entry({ kind: "notice", text: LONG, details: { notice_kind: "wake" } }),
		);
		expect(seen[0]?.meta).toBe("woken");
		expect(seen[0]?.accessibilityLabel).toContain("woken");
	});

	it("keeps a folded subagent row's open route and its hub line (R1-3)", async () => {
		const opened: string[] = [];
		const seen = await render(
			entry({
				kind: "subagent_message",
				text: LONG,
				details: {
					direction: "to_parent",
					job_id: "job-7",
					label: "coder",
				},
			}),
			{ onOpenAgent: (jobId) => opened.push(jobId) },
		);
		expect(seen).toHaveLength(1);
		// The route lives on the bar, so it is there folded AND expanded.
		/* A named button since round 2 (D10 / U12), not a bare `Text`. */
		const action = seen[0]?.action as {
			props: {
				onPress: () => void;
				accessibilityRole: string;
				accessibilityLabel: string;
			};
		};
		expect(action.props.accessibilityRole).toBe("button");
		expect(action.props.accessibilityLabel).toBe("Open coder");
		action.props.onPress();
		expect(opened).toEqual(["job-7"]);
		// The expanded body carries the Job line; the raw wire direction
		// (`to_parent`) is never painted — it read as the message's first words.
		const drawn = textOf(dom?.container as TextNode);
		expect(drawn).toContain("Job job-7");
		expect(drawn).not.toContain("to_parent");
		expect(drawn).toContain(LONG);
	});

	it("names a folded row by kind, sender and summary, not its whole body (U7)", async () => {
		const seen = await render(
			entry({
				kind: "peer_message",
				text: `first line\n${LONG}`,
				details: {
					sender: { conversation_name: "reviewer", session_id: "s-2" },
				},
			}),
		);
		expect(seen[0]?.accessibilityLabel).toBe("peer reviewer: first line");
	});

	it("keeps a short sent message as it was, with no chevron", async () => {
		expect(await render(entry({ kind: "user", text: SHORT }))).toHaveLength(0);
	});

	it("never folds a sent message that carries an image", async () => {
		expect(
			await render(
				entry({
					kind: "user",
					text: LONG,
					images: [{ index: 0, mime_type: "image/png" }],
				}),
			),
		).toHaveLength(0);
	});

	it("never folds the assistant's answer", async () => {
		expect(await render(entry({ kind: "assistant", text: LONG }))).toHaveLength(
			0,
		);
	});

	it("never folds an ask", async () => {
		expect(
			await render(entry({ kind: "ask_response", text: LONG })),
		).toHaveLength(0);
		expect(
			await render(entry({ kind: "ask_timeout", text: LONG })),
		).toHaveLength(0);
	});

	it("never folds a tool row — it is already a one-line disclosure", async () => {
		expect(
			await render(
				entry({
					kind: "tool",
					text: LONG,
					tool_name: "read_file",
					tool_state: "done",
				}),
			),
		).toHaveLength(0);
	});

	it("names who a folded peer message came from, and its intent as meta", async () => {
		const seen = await render(
			entry({
				kind: "parent_message",
				text: LONG,
				details: {
					sender: { conversation_name: "manager", session_id: "s-1" },
					direction: "to_child",
					expects_reply: true,
				},
			}),
		);
		expect(seen[0]?.glyph).toBe("↳");
		expect(seen[0]?.label).toBe("Hub · From manager");
		expect(seen[0]?.meta).toBe("Reply requested");
	});

	it("folds a SHORT hub receipt too, in both directions, without wire tokens", async () => {
		for (const direction of ["to_child", "to_parent"] as const) {
			const seen = await render(
				entry({
					kind:
						direction === "to_child" ? "parent_message" : "subagent_message",
					text: "ok",
					details: { direction, label: "coder" },
				}),
			);
			// Under the 80-char budget a peer body stays open; a hub one does not.
			expect(seen, direction).toHaveLength(1);
			expect(seen[0]?.label).toBe("Hub · From coder");
			expect(seen[0]?.summary).toBe("ok");
			expect(textOf(dom?.container as TextNode)).not.toContain(direction);
		}
	});

	it("keeps a SHORT peer message open (negative control for the hub fold)", async () => {
		const seen = await render(
			entry({
				kind: "peer_message",
				text: "ok",
				details: {
					sender: { conversation_name: "reviewer", session_id: "s-2" },
				},
			}),
		);
		expect(seen).toHaveLength(0);
	});

	it("gives a peer message the peer glyph and its sender as the label", async () => {
		const seen = await render(
			entry({
				kind: "peer_message",
				text: LONG,
				details: {
					sender: { conversation_name: "reviewer", session_id: "s-2" },
				},
			}),
		);
		expect(seen[0]?.glyph).toBe("↔");
		expect(seen[0]?.label).toBe("reviewer");
	});
});
