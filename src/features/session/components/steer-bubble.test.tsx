import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import type { PendingEcho } from "@/features/session/pending-echo";
import { USER_BUBBLE_BOX_CLASS } from "@/features/session/user-bubble";
import { THEMES } from "@/ui/tokens.gen";

/**
 * Operator report, iOS 2026-11-11: a message sent while the agent was running
 * (a STEER) rendered as bare indented text with no bubble, so it did not read
 * as his own message. A steer now takes the user bubble — same fill, shape,
 * alignment and eight-line `Show more` clamp as a prompt — both in flight
 * (`PendingEchoRow`) and settled (`TranscriptRow`), so handover is the caption
 * leaving and nothing else.
 *
 * Asserted on the RENDERED rows (the Node server renderer, with host
 * primitives serialising `className`/`testID`/`style.backgroundColor` as data
 * attributes — `transcript-row-blank.test.tsx`'s pattern), so a refactor that
 * keeps the behaviour keeps this green and one that drops the bubble fails.
 */
const PALETTE = THEMES[0];
if (PALETTE === undefined) throw new Error("no shipped theme");
const FILL = PALETTE.colors["user-bubble"];

vi.mock("react-native", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-native")>();
	const { createElement } = await import("react");
	type HostProps = {
		children?: import("react").ReactNode;
		className?: string;
		testID?: string;
		style?: { backgroundColor?: string };
	};
	const host =
		(tag: string) =>
		({ children, className, testID, style }: HostProps) =>
			createElement(
				tag,
				{
					"data-class": className,
					"data-testid": testID,
					"data-bg": style?.backgroundColor,
				},
				children,
			);
	return {
		...actual,
		View: host("div"),
		Text: host("span"),
		Pressable: host("div"),
		ScrollView: host("div"),
	};
});

vi.mock("@/ui/appearance", async () => {
	const { THEMES } = await import("@/ui/tokens.gen");
	return {
		useReducedMotion: () => false,
		useTheme: () => ({ active: THEMES[0] }),
		useTokenColor: (role: string) => `token:${role}`,
	};
});

vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));

/* The clamp's `react-native-svg` fade cannot load in Node; a marker stands in
 * so the test can see WHETHER the text is clamped (the clamp's own behaviour is
 * `user-message-clamp.test.ts`'s). */
vi.mock("@/features/session/components/user-message-clamp", async () => {
	const { createElement } = await import("react");
	return {
		// The row's body is a render function handed the clamp's `expand`.
		UserMessageClamp: ({
			children,
		}: {
			children: React.ReactNode | ((expand: () => void) => React.ReactNode);
		}) =>
			createElement(
				"section",
				{ "data-clamp": "" },
				typeof children === "function" ? children(() => {}) : children,
			),
	};
});

/* Arms this file never renders, whose imports reach `expo`. */
vi.mock("@/features/session/components/markdown", () => ({
	Markdown: () => null,
}));
vi.mock("@/features/session/components/imagegen-card", () => ({
	ImageGenCard: () => null,
}));
vi.mock("@/features/session/components/transcript-image", () => ({
	TranscriptImage: () => null,
}));
vi.mock("@/features/session/components/tool-row", () => ({
	ToolRow: () => null,
}));

import { PendingEchoRow } from "./pending-echo-row";
import { TranscriptRow } from "./transcript-row";

const entry = (kind: "user" | "steer", text: string): TranscriptEntry => ({
	id: `${kind}-1`,
	kind,
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
	final: true,
	text_complete: true,
});

const echo = (op: "prompt" | "steer", text: string): PendingEcho => ({
	commandId: `c-${op}`,
	text,
	imageCount: 0,
	op,
	accepted: true,
});

/** The bubble box: its classes and its explicit native fill, in that order. */
const BUBBLE = new RegExp(
	`data-class="[^"]*${USER_BUBBLE_BOX_CLASS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" data-bg="${FILL}"`,
);

const settled = (kind: "user" | "steer", text: string): string =>
	renderToStaticMarkup(
		createElement(TranscriptRow, { entry: entry(kind, text), streaming: true }),
	);
const pending = (op: "prompt" | "steer", text: string): string =>
	renderToStaticMarkup(
		createElement(PendingEchoRow, { echo: echo(op, text), streaming: true }),
	);

/** The markup with the one thing allowed to differ between a prompt and a
 *  steer removed: the row's own ids. */
const shape = (markup: string): string =>
	markup.replace(/data-testid="[^"]*"/g, "").replace(/c-(prompt|steer)/g, "");

describe("a steer is the reader's own message", () => {
	it("settled: renders inside the filled, clamped user bubble", () => {
		const markup = settled("steer", "also check the logs");
		expect(markup).toMatch(BUBBLE);
		expect(markup).toContain("data-clamp");
		expect(markup).toContain("also check the logs");
		// Full-strength ink, as a prompt: not the old quiet muted block.
		expect(markup).toContain("text-body-read text-ink");
		expect(markup).not.toContain("text-ink-muted");
		expect(markup).not.toContain('data-class="max-w-[85%] px-1"');
	});

	it("settled: paints exactly as a prompt does", () => {
		expect(shape(settled("steer", "same words"))).toBe(
			shape(settled("user", "same words")),
		);
	});

	it("in flight: renders inside the same filled, clamped bubble", () => {
		const markup = pending("steer", "also check the logs");
		expect(markup).toMatch(BUBBLE);
		expect(markup).toContain("data-clamp");
		expect(markup).toContain("also check the logs");
		expect(markup).not.toContain('data-class="max-w-[85%] items-end px-1"');
	});

	it("in flight: the box matches a pending prompt's (only the caption differs)", () => {
		const box = (markup: string): string =>
			markup.slice(0, markup.indexOf("</div>"));
		expect(shape(box(pending("steer", "same words")))).toBe(
			shape(box(pending("prompt", "same words"))),
		);
	});
});
