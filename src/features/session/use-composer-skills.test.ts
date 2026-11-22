/**
 * The `$skill` send path through the REAL composer hook (`use-composer.ts`): the
 * body carries `expand_skills: true` only when the relay licenses it for this
 * conversation AND the draft holds a `$` AND it is not a slash command; the
 * receipt's skipped names become ONE notice that the next keystroke retires; and
 * `422 skills_too_large` is the localized remedy with the draft kept.
 *
 * The harness is `use-composer-echo.test.ts`'s: an adopted `editor` drives the
 * draft, the envelope store is the real one over an in-memory backing.
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptImage } from "@/contracts";
import { outbox } from "@/features/session/outbox";
import { clearPendingEchoes } from "@/features/session/pending-echo";
import {
	type ComposerState,
	useComposer,
} from "@/features/session/use-composer";
import { type RelayEndpoints, RelayError } from "@/relay";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

const SENT_WITHOUT = /Sent without/;
const REMOVE_ONE = /Remove one skill and send again/;

vi.mock("expo-crypto", async () => ({
	randomUUID: (await import("node:crypto")).randomUUID,
}));

vi.mock("@/features/session/envelope-store", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/features/session/envelope-store")>();
	const relay = await import("@/relay");
	const stores = new Map<
		string,
		InstanceType<typeof relay.RetryEnvelopeStore>
	>();
	return {
		...original,
		envelopeStoreFor: (sessionId: string) => {
			let store = stores.get(sessionId);
			if (store === undefined) {
				store = new relay.RetryEnvelopeStore({
					store: relay.memoryEnvelopeStore(),
				});
				stores.set(sessionId, store);
			}
			return store;
		},
	};
});

let SID = "s-skills-0";
let sessions = 0;
let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let composer: ComposerState | null = null;
const c = () => composer as ComposerState;

function Host({
	client,
	initial,
	expandSkills,
}: {
	client: RelayEndpoints;
	initial: string;
	expandSkills: boolean;
}) {
	const [draft, setDraft] = useState(initial);
	const [images, setImages] = useState<PromptImage[]>([]);
	composer = useComposer({
		sessionId: SID,
		source: {
			endpoints: client,
			baseUrl: null,
			fromOrigin: false,
			reason: "ok",
		},
		streaming: false,
		ended: false,
		capabilities: null,
		editor: { draft, images, setDraft, setImages },
		expandSkills,
	});
	return null;
}

const bodies: Record<string, unknown>[] = [];
const clientFor = (
	answer: (body: Record<string, unknown>) => unknown,
): RelayEndpoints =>
	({
		command: async (_id: string, body: Record<string, unknown>) => {
			bodies.push(body);
			return answer(body);
		},
	}) as unknown as RelayEndpoints;

const mount = async (
	client: RelayEndpoints,
	initial: string,
	expandSkills = true,
) => {
	await act(async () =>
		root?.render(createElement(Host, { client, initial, expandSkills })),
	);
};
const settle = async () => {
	for (let i = 0; i < 5; i++)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
};
const send = async () => {
	await act(async () => c().send());
	await settle();
};

beforeEach(() => {
	sessions += 1;
	SID = `s-skills-${sessions}`;
	bodies.length = 0;
	clearPendingEchoes();
	composer = null;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});

afterEach(async () => {
	outbox.abandonAll();
	await act(async () => root?.unmount());
	root = null;
	dom?.dispose();
	dom = null;
	clearPendingEchoes();
});

const ok = { ok: true, detail: "prompt admitted" };

describe("expand_skills on a real send", () => {
	it("is sent when licensed and the draft carries a $", async () => {
		await mount(
			clientFor(() => ok),
			"use $research please",
		);
		await send();
		expect(bodies).toHaveLength(1);
		expect(bodies[0]?.expand_skills).toBe(true);
		expect(bodies[0]?.text).toBe("use $research please");
	});

	it("is omitted when the draft has no $", async () => {
		await mount(
			clientFor(() => ok),
			"plain words",
		);
		await send();
		expect(bodies).toHaveLength(1);
		expect("expand_skills" in (bodies[0] ?? {})).toBe(false);
	});

	it("is omitted when the conversation is not licensed (older relay, or remote)", async () => {
		await mount(
			clientFor(() => ok),
			"use $research",
			false,
		);
		await send();
		expect(bodies).toHaveLength(1);
		expect("expand_skills" in (bodies[0] ?? {})).toBe(false);
	});

	it("never rides a slash command", async () => {
		await mount(
			clientFor(() => ok),
			"/rename my $thing",
		);
		await send();
		expect(bodies.every((body) => !("expand_skills" in body))).toBe(true);
		expect(bodies.every((body) => body.op !== "prompt")).toBe(true);
	});
});

describe("the receipt", () => {
	const skipped = (names: string[]) =>
		clientFor(() => ({
			...ok,
			skills: { attached: ["research"], skipped: names },
		}));

	it("raises ONE notice naming the skipped skills, and the next keystroke retires it", async () => {
		await mount(
			skipped(["empty-skill", "other"]),
			"$research $empty-skill $other",
		);
		await send();
		expect(c().notice).toContain("$empty-skill");
		expect(c().notice).toContain("$other");
		expect(c().notice).toMatch(SENT_WITHOUT);
		await act(async () => c().setDraft("next message"));
		expect(c().notice).toBeNull();
	});

	it("says nothing when nothing was skipped", async () => {
		await mount(skipped([]), "$research");
		await send();
		expect(c().notice).toBeNull();
	});
});

describe("422 skills_too_large", () => {
	it("is the localized remedy and the draft stays", async () => {
		const refusal = new RelayError(
			"rejected",
			"the selected skills are too large to send together",
			{
				status: 422,
				code: "skills_too_large",
				serverError: "the selected skills are too large to send together",
				envelope: "clear",
				retry: "never",
			},
		);
		await mount(
			clientFor(() => {
				throw refusal;
			}),
			"$a $b $c",
		);
		await send();
		expect(c().error).toMatch(REMOVE_ONE);
		expect(c().draft).toBe("$a $b $c");
	});
});
