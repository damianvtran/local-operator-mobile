import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import type { TranscriptItem } from "@/features/session/turn-condensing";
import { UNDERFLOW_FILL_PAGES } from "@/features/session/underflow-fill";
import { useUnderflowFill } from "@/features/session/use-underflow-fill";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The glue `TranscriptList` mounts (issue #322), through react-dom and the
 * repository's DOM shim: the effect asks for a page when the rows or the
 * reader's state change, and the returned callback asks when a height lands.
 * The decision itself is `underflow-fill.test.ts`'s.
 */

const row = (id: string, over: Partial<TranscriptEntry>): TranscriptEntry => ({
	id,
	kind: "assistant",
	text: "",
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
	...over,
});
const item = (entry: TranscriptEntry): TranscriptItem => ({
	kind: "entry",
	id: entry.id,
	entry,
});
const quiet = (): TranscriptItem[] => [
	item(row("m-p", { kind: "peer_message", text: "handoff" })),
];
const talk = (): TranscriptItem[] => [
	item(row("m-u", { kind: "user", text: "Ship it." })),
];

type HostProps = {
	items: readonly TranscriptItem[];
	olderReady: boolean;
	loadOlder: () => Promise<void>;
};
let measured: ((contentPt: number) => void) | null = null;
function Host({ items, olderReady, loadOlder }: HostProps) {
	measured = useUnderflowFill({
		sessionId: "s1",
		items,
		olderReady,
		hasError: false,
		loadOlder,
		positioned: () => true,
		viewportPt: () => 600,
	});
	return null;
}

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;
const render = (props: HostProps) =>
	act(async () => root?.render(createElement(Host, props)));

beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	measured = null;
	dom?.dispose();
	dom = null;
});

describe("useUnderflowFill", () => {
	it("pages once per arrival while the window shows no conversation, within the budget", async () => {
		const loadOlder = vi.fn(async () => undefined);
		await render({ items: quiet(), olderReady: false, loadOlder });
		expect(loadOlder).not.toHaveBeenCalled();
		await render({ items: quiet(), olderReady: true, loadOlder });
		expect(loadOlder).toHaveBeenCalledTimes(1);
		for (let page = 0; page < UNDERFLOW_FILL_PAGES + 2; page += 1)
			await render({ items: quiet(), olderReady: true, loadOlder });
		expect(loadOlder).toHaveBeenCalledTimes(UNDERFLOW_FILL_PAGES);
	});

	it("pages on a short measured height and stops once the screen is full", async () => {
		const loadOlder = vi.fn(async () => undefined);
		const shown = talk();
		await render({ items: shown, olderReady: true, loadOlder });
		// Conversation is shown and no height is known yet: nothing to do.
		expect(loadOlder).not.toHaveBeenCalled();
		await act(async () => measured?.(120));
		expect(loadOlder).toHaveBeenCalledTimes(1);
		const grown = talk();
		await render({ items: grown, olderReady: true, loadOlder });
		await act(async () => measured?.(900));
		expect(loadOlder).toHaveBeenCalledTimes(1);
	});
});
