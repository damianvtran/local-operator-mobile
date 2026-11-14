import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingEcho } from "@/features/session/pending-echo";

/**
 * Operator report, TestFlight 906 (2026-11-13), asserted on RENDERED markup
 * (the Node server renderer with host primitives serialised as data
 * attributes — `steer-bubble.test.tsx`'s pattern):
 *
 *  1. "remove this conversation started banner at the top of conversations
 *     started on mobile" — no idle row; only a compact needs-answer row.
 *  2. "make sure that the user message appears smoothly in the view
 *     optimistically … and that the thinking state … [is] resolved
 *     immediately" — before the start returns, the preview carries the
 *     message and the working line.
 *  4. "The image attachment doesn't appear optimistically with the user
 *     message" — the pending row paints the envelope's own image, and seeds the
 *     cache the settled row reads, so handover keeps the picture.
 */

vi.mock("react-native", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-native")>();
	const { createElement } = await import("react");
	type HostProps = {
		children?: import("react").ReactNode;
		className?: string;
		testID?: string;
		accessibilityLabel?: string;
	};
	const host =
		(tag: string) =>
		({ children, className, testID, accessibilityLabel }: HostProps) =>
			createElement(
				tag,
				{
					"data-class": className,
					"data-testid": testID,
					"aria-label": accessibilityLabel,
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
vi.mock("@/features/session/components/user-message-clamp", async () => {
	const { createElement } = await import("react");
	return {
		UserMessageClamp: ({ children }: { children: React.ReactNode }) =>
			createElement("section", { "data-clamp": "" }, children),
	};
});
/* The image view stands in for `expo-image`: it prints what the real
 * component's FIRST frame would paint — the cache's synchronous answer for
 * exactly the (loader, entry, index) it was handed. */
vi.mock("@/features/session/components/transcript-image", async () => {
	const { createElement } = await import("react");
	const { transcriptImages } = await import("@/features/session/image-cache");
	return {
		TranscriptImage: ({
			entryId,
			index,
			load,
			testID,
		}: {
			entryId: string;
			index: number;
			load: (id: string, i: number) => Promise<string | null>;
			testID: string;
		}) =>
			createElement("img", {
				"data-testid": testID,
				"data-entry": entryId,
				src: transcriptImages.peek(load, entryId, index)?.uri ?? "SKELETON",
			}),
	};
});
vi.mock("@/features/session/components/working-line", async () => {
	const { createElement } = await import("react");
	return {
		WorkingLine: ({ activity, testID }: { activity: string; testID: string }) =>
			createElement("p", { "data-testid": testID }, activity),
	};
});
const runtime = {
	streaming: false,
	entries: [] as unknown[],
	projection: null as null | Record<string, unknown>,
	streamingRowId: null,
	loadImage: async () => null,
	supplements: [],
	projectionPid: null,
	loadSupplementDocument: () => undefined,
	loadSupplementFile: () => undefined,
	loadSupplementSound: () => undefined,
	supplementCommand: () => undefined,
};
vi.mock("@/features/session/use-session", () => ({
	useSessionRuntime: () => runtime,
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: () => {} }) }));
/* The list stands in as its own three slots, in the order it renders them:
 * the empty state (only with no rows), then the pending footer. */
vi.mock("@/features/session/components/transcript-list", async () => {
	const { createElement } = await import("react");
	return {
		TranscriptList: ({
			entries,
			empty,
			pending,
			testID,
		}: {
			entries: unknown[];
			empty?: React.ReactElement | null;
			pending?: React.ReactElement | null;
			testID: string;
		}) =>
			createElement(
				"main",
				{ "data-testid": testID },
				entries.length === 0 ? (empty ?? null) : null,
				pending ?? null,
			),
	};
});

const { StartupPreview, StartupTranscript } = await import(
	"./startup-transcript"
);
const { PendingEchoRow } = await import(
	"@/features/session/components/pending-echo-row"
);
const { transcriptImages } = await import("@/features/session/image-cache");
const { echoImageUri, LOCAL_ECHO_IMAGES } = await import(
	"@/features/session/pending-echo"
);
const { t } = await import("@/i18n");

const IMAGE = { data_b64: "iVBORw0KGgo=", mime_type: "image/png" };
const echo = (overrides: Partial<PendingEcho> = {}): PendingEcho => ({
	commandId: "cmd-1",
	text: "look at this",
	imageCount: 1,
	images: [IMAGE],
	op: "prompt",
	accepted: false,
	...overrides,
});

beforeEach(() => {
	runtime.projection = null;
	runtime.entries = [];
});

describe("1 — no 'Conversation started' banner", () => {
	it("renders no idle row above a just-started conversation", () => {
		runtime.projection = { pending: null, streaming: false, activity: "" };
		const markup = renderToStaticMarkup(
			createElement(StartupTranscript, {
				sessionId: "s1",
				onStreaming: () => {},
			}),
		);
		expect(markup).not.toContain("Conversation started");
		expect(markup).not.toContain(t("mobile.session.conversation_details"));
		expect(markup).not.toContain('data-testid="startup-open-conversation"');
		expect(markup).not.toContain('data-testid="startup-needs-answer"');
	});

	it("keeps one compact, catalogued row when the agent needs an answer", () => {
		runtime.projection = {
			pending: { kind: "ask" },
			streaming: false,
			activity: "",
		};
		const markup = renderToStaticMarkup(
			createElement(StartupTranscript, {
				sessionId: "s1",
				onStreaming: () => {},
			}),
		);
		expect(markup).toContain('data-testid="startup-needs-answer"');
		expect(markup).toContain(t("mobile.home.transcript.needs_answer"));
		expect(markup).not.toContain("This conversation needs your answer.");
		expect(markup).toContain('data-testid="startup-open-conversation"');
		/* Design round 1, D2: the one action on the row reads as a button (the
		 *  outline variant's control border), not as the label's quiet ink.
		 *  Source-level: this file's host mocks do not render Button's frame. */
		const source = readFileSync(
			new URL("./startup-transcript.tsx", import.meta.url),
			"utf8",
		);
		const action = source.slice(
			source.indexOf("answer_in_conversation"),
			source.indexOf("testID={CONTROL.startupOpenConversation}"),
		);
		expect(action).toContain('variant="outline"');
		expect(action).not.toContain('variant="quiet"');
	});
});

describe("2 — the first message is on screen before the start returns", () => {
	it("the preview paints the message, its image and the working line at once", () => {
		const markup = renderToStaticMarkup(
			createElement(StartupPreview, { echoes: [echo()] }),
		);
		expect(markup).toContain("look at this");
		expect(markup).toContain('data-testid="pending-echo-cmd-1"');
		expect(markup).toContain(t("mobile.session.pending_echo.sending"));
		expect(markup).toContain('data-testid="startup-working-line"');
		expect(markup).toContain(t("relay.chrome.session.subtitle.working_plain"));
	});

	it("a failed row is marked and gets no working line spinning beside it", () => {
		const markup = renderToStaticMarkup(
			createElement(StartupPreview, {
				echoes: [echo({ failure: "unconfirmed" })],
			}),
		);
		/* QA round 1, Q3: this screen has no Retry (a start is never resent),
		 *  so the caption states the fact and points at nothing. */
		expect(markup).toContain(
			t("mobile.session.pending_echo.not_confirmed_plain"),
		);
		expect(markup).not.toContain(
			t("mobile.session.pending_echo.not_confirmed"),
		);
		expect(markup).not.toContain('data-testid="startup-working-line"');
	});

	it("after adoption the row sits in the transcript, not under a 'waiting' line", () => {
		const markup = renderToStaticMarkup(
			createElement(StartupTranscript, {
				sessionId: "s1",
				onStreaming: () => {},
				echoes: [echo({ accepted: true })],
			}),
		);
		expect(markup).toContain('data-testid="pending-echo-cmd-1"');
		expect(markup).toContain('data-testid="startup-working-line"');
		expect(markup).not.toContain(t("mobile.home.transcript.waiting"));
	});

	it("hands over to the real entry with the same id: never both on screen", () => {
		runtime.entries = [{ id: "cmd-1", kind: "user", text: "look at this" }];
		const markup = renderToStaticMarkup(
			createElement(StartupTranscript, {
				sessionId: "s1",
				onStreaming: () => {},
				echoes: [echo({ accepted: true })],
			}),
		);
		expect(markup).not.toContain('data-testid="pending-echo-cmd-1"');
	});
});

describe("4 — the image is in the optimistic bubble, and stays at handover", () => {
	it("paints the envelope's own bytes on the first frame, not a count", () => {
		const loader = async () => "relay-uri";
		const markup = renderToStaticMarkup(
			createElement(PendingEchoRow, {
				echo: echo({ commandId: "cmd-img" }),
				streaming: false,
				loadImage: loader,
			}),
		);
		expect(markup).toContain(`src="${echoImageUri(IMAGE)}"`);
		expect(markup).not.toContain("SKELETON");
		expect(markup).not.toContain(
			t("mobile.session.pending_echo.images", { count: 1 }),
		);
		// The SETTLED row (entry id = command id, image index 0, same loader)
		// peeks a settled source: no skeleton, no fetch at handover.
		expect(transcriptImages.peek(loader, "cmd-img", 0)?.uri).toBe(
			echoImageUri(IMAGE),
		);
	});

	it("paints before a session exists, under the local loader", () => {
		const markup = renderToStaticMarkup(
			createElement(PendingEchoRow, {
				echo: echo({ commandId: "cmd-pre" }),
				streaming: false,
			}),
		);
		expect(markup).toContain(`src="${echoImageUri(IMAGE)}"`);
		expect(
			transcriptImages.peek(LOCAL_ECHO_IMAGES, "cmd-pre", 0),
		).toBeDefined();
	});

	it("never overwrites the relay's own answer with the local copy", () => {
		const loader = async () => "x";
		transcriptImages.seed(loader, "cmd-known", 0, "relay-answer");
		renderToStaticMarkup(
			createElement(PendingEchoRow, {
				echo: echo({ commandId: "cmd-known" }),
				streaming: false,
				loadImage: loader,
			}),
		);
		expect(transcriptImages.peek(loader, "cmd-known", 0)?.uri).toBe(
			"relay-answer",
		);
	});

	/* Agent review round 1, M1: each seed is a whole file as a `data:` string,
	 *  so it is held under the ONE loader the settled row asks, and it leaves
	 *  at the auth boundary with the echoes. */
	it("seeds under the session's loader only, and the auth boundary drops it", async () => {
		const { clearPendingEchoes } = await import(
			"@/features/session/pending-echo"
		);
		const loader = async () => "x";
		transcriptImages.seed(loader, "relay-row", 0, "blob:relay");
		renderToStaticMarkup(
			createElement(PendingEchoRow, {
				echo: echo({ commandId: "cmd-session" }),
				streaming: false,
				loadImage: loader,
			}),
		);
		expect(transcriptImages.peek(loader, "cmd-session", 0)?.uri).toBe(
			echoImageUri(IMAGE),
		);
		expect(
			transcriptImages.peek(LOCAL_ECHO_IMAGES, "cmd-session", 0),
		).toBeUndefined();
		clearPendingEchoes();
		expect(transcriptImages.peek(loader, "cmd-session", 0)).toBeUndefined();
		// A relay answer is not a seed and stays.
		expect(transcriptImages.peek(loader, "relay-row", 0)?.uri).toBe(
			"blob:relay",
		);
	});
});
