import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import { transcriptRowTestID } from "@/features/session/projection";
import { SURFACE } from "@/ui/a11y";

/**
 * Operator report, iOS build 836: uneven gaps inside an expanded action group.
 * The live projection carries a blank assistant row per tool batch; painted as
 * prose (`px-4 py-1` around an empty Markdown) it opened a hole between two
 * tool rows. It must render a zero-size box that still carries the row's
 * testID and anchors — asserted on the RENDERED row (PR #234 R1-3), so a
 * refactor that keeps the behaviour keeps the test green.
 *
 * The Node host is the server renderer; the host primitives serialise
 * `className`/`testID` as `data-class`/`data-testid` (`live-glyph.test.tsx`'s
 * pattern), and the native-only modules the row reaches are stubbed.
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

import { TranscriptRow } from "./transcript-row";

const assistant = (id: string, text: string): TranscriptEntry => ({
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
	final: true,
	text_complete: true,
});

const render = (entry: TranscriptEntry, streaming = false) =>
	renderToStaticMarkup(createElement(TranscriptRow, { entry, streaming }));

describe("a blank assistant row paints nothing", () => {
	it("renders a bare box carrying its testID, with no prose padding or body", () => {
		const entry = assistant("a1", "");
		const markup = render(entry);
		expect(markup).toBe(
			`<div data-testid="${transcriptRowTestID(entry)}"></div>`,
		);
		expect(markup).not.toContain("py-1");
		expect(markup).not.toContain("data-md");
	});

	it("still carries the streaming anchor", () => {
		const markup = render(assistant("a1", "  \n "), true);
		expect(markup).toContain(`data-testid="${SURFACE.transcriptStreaming}"`);
		expect(markup).not.toContain("py-1");
	});

	it("turns back into prose once text arrives (control)", () => {
		const markup = render(assistant("a1", "on it"));
		expect(markup).toContain("py-1");
		expect(markup).toContain("data-md");
	});
});
